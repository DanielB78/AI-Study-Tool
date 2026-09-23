import 'dart:async';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../../core/canvas/models/ids.dart';
import '../controller/editor_controller.dart';
import '../interaction/canvas_interactor.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';
import 'canvas_renderer.dart';
import 'element_renderers.dart';
import 'text_edit_overlay.dart';

/// Decoded image cache keyed by ImageElement.src reference.
final imageCacheProvider = Provider<Map<String, ui.Image>>((ref) => {});

/// Raw bytes for image refs (local session). Keeps CanvasDocument free of blobs.
final imageBytesCacheProvider = Provider<Map<String, Uint8List>>((ref) => {});

/// Infinite canvas surface with overlays for text editing.
class EditorCanvasView extends ConsumerStatefulWidget {
  const EditorCanvasView({super.key});

  @override
  ConsumerState<EditorCanvasView> createState() => _EditorCanvasViewState();
}

class _EditorCanvasViewState extends ConsumerState<EditorCanvasView> {
  CanvasInteractor? _interactor;
  final FocusNode _focusNode = FocusNode(debugLabel: 'editor-canvas');
  int? _activePointer;
  Offset? _lastTapPos;
  DateTime? _lastTapTime;
  Offset? _downPos;
  bool _movedSinceDown = false;

  CanvasInteractor get interactor {
    return _interactor ??= CanvasInteractor(
      editor: ref.read(editorControllerProvider.notifier),
      interaction: ref.read(interactionControllerProvider.notifier),
    );
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  Point _toPoint(Offset offset) => Point(offset.dx, offset.dy);

  bool get _shift => HardwareKeyboard.instance.isShiftPressed;
  bool get _proportional => HardwareKeyboard.instance.isShiftPressed;

  @override
  Widget build(BuildContext context) {
    final editorState = ref.watch(editorControllerProvider);
    final interaction = ref.watch(interactionControllerProvider);
    final tool = editorState.activeTool;
    final imageCache = ref.watch(imageCacheProvider);

    // Prefetch images
    for (final el in editorState.document.getElementsByType(CanvasElementType.image)) {
      final img = el as ImageElement;
      if (img.src.isNotEmpty && !imageCache.containsKey(img.src)) {
        unawaited(_loadImage(img.src));
      }
    }

    final cursor = switch (tool) {
      EditorTool.pan => interaction.gesture is GesturePanning
          ? SystemMouseCursors.grabbing
          : SystemMouseCursors.grab,
      EditorTool.text => SystemMouseCursors.text,
      EditorTool.pen => SystemMouseCursors.precise,
      _ => SystemMouseCursors.basic,
    };

    return Focus(
      focusNode: _focusNode,
      onKeyEvent: _onKeyEvent,
      child: MouseRegion(
        cursor: cursor,
        onHover: (event) {
          interactor.onPointerHover(_toPoint(event.localPosition));
        },
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: _onPointerDown,
          onPointerMove: _onPointerMove,
          onPointerUp: _onPointerUp,
          onPointerCancel: _onPointerCancel,
          onPointerSignal: _onPointerSignal,
          child: Stack(
            fit: StackFit.expand,
            children: [
              RepaintBoundary(
                child: CustomPaint(
                  painter: CanvasPainter(
                    document: editorState.document,
                    selectedIds: editorState.selectedIds,
                    gesture: interaction.gesture,
                    guides: interaction.alignmentGuides,
                    editingTextId: interaction.editingTextId ??
                        interaction.editingShapeLabelId,
                    imageCache: imageCache,
                  ),
                  isComplex: true,
                  willChange: true,
                  child: const SizedBox.expand(),
                ),
              ),
              if (interaction.editingTextId != null)
                TextEditOverlay(
                  elementId: interaction.editingTextId!,
                  isShapeLabel: false,
                ),
              if (interaction.editingShapeLabelId != null)
                TextEditOverlay(
                  elementId: interaction.editingShapeLabelId!,
                  isShapeLabel: true,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _loadImage(String src) async {
    final bytes = ref.read(imageBytesCacheProvider)[src];
    if (bytes == null) return;
    final img = await decodeUiImage(bytes);
    if (img != null && mounted) {
      ref.read(imageCacheProvider)[src] = img;
      setState(() {});
    }
  }

  KeyEventResult _onKeyEvent(FocusNode node, KeyEvent event) {
    if (ref.read(interactionControllerProvider).isEditingText) {
      return KeyEventResult.ignored;
    }
    if (event is KeyDownEvent) {
      if (event.logicalKey == LogicalKeyboardKey.space) {
        ref.read(interactionControllerProvider.notifier).update(
              (s) => s.copyWith(spacePanHeld: true),
            );
        return KeyEventResult.handled;
      }
    }
    if (event is KeyUpEvent) {
      if (event.logicalKey == LogicalKeyboardKey.space) {
        ref.read(interactionControllerProvider.notifier).update(
              (s) => s.copyWith(spacePanHeld: false),
            );
        return KeyEventResult.handled;
      }
    }
    return KeyEventResult.ignored;
  }

  void _onPointerDown(PointerDownEvent event) {
    _focusNode.requestFocus();
    final isPrimaryMouse = event.kind == PointerDeviceKind.mouse &&
        (event.buttons == 0 || (event.buttons & kPrimaryButton) != 0);
    final isTouchLike = event.kind == PointerDeviceKind.touch ||
        event.kind == PointerDeviceKind.stylus ||
        event.kind == PointerDeviceKind.unknown;
    if (!isPrimaryMouse && !isTouchLike) return;

    final pos = event.localPosition;

    // Image tool: pick file on click
    if (ref.read(editorControllerProvider).activeTool == EditorTool.image) {
      unawaited(_pickAndInsertImage());
      return;
    }

    _activePointer = event.pointer;
    _downPos = pos;
    _movedSinceDown = false;
    interactor.onPointerDown(
      _toPoint(pos),
      shiftKey: _shift,
      proportional: _proportional,
    );
  }

  void _onPointerMove(PointerMoveEvent event) {
    if (_activePointer == null || event.pointer != _activePointer) return;
    if (_downPos != null && (event.localPosition - _downPos!).distance > 4) {
      _movedSinceDown = true;
    }
    interactor.onPointerMove(
      _toPoint(event.localPosition),
      proportional: _proportional,
    );
  }

  void _onPointerUp(PointerUpEvent event) {
    if (_activePointer != null && event.pointer != _activePointer) return;
    final pos = event.localPosition;
    interactor.onPointerUp(_toPoint(pos));

    // Double-click only if this was a click (no drag).
    if (!_movedSinceDown) {
      final now = DateTime.now();
      if (_lastTapTime != null &&
          _lastTapPos != null &&
          now.difference(_lastTapTime!) < const Duration(milliseconds: 350) &&
          (pos - _lastTapPos!).distance < 12) {
        interactor.onDoubleTap(_toPoint(pos));
        _lastTapTime = null;
        _lastTapPos = null;
      } else {
        _lastTapTime = now;
        _lastTapPos = pos;
      }
    } else {
      _lastTapTime = null;
      _lastTapPos = null;
    }

    _activePointer = null;
    _downPos = null;
    _movedSinceDown = false;
  }

  void _onPointerCancel(PointerCancelEvent event) {
    if (_activePointer != null && event.pointer != _activePointer) return;
    interactor.onPointerCancel();
    _activePointer = null;
  }

  void _onPointerSignal(PointerSignalEvent signal) {
    if (signal is! PointerScrollEvent) return;
    final position = _toPoint(signal.localPosition);
    final wantsZoom = HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed;
    if (wantsZoom || signal.kind == PointerDeviceKind.mouse) {
      interactor.onScrollZoom(position, signal.scrollDelta.dy);
      return;
    }
    interactor.panByScreenDelta(
      -signal.scrollDelta.dx,
      -signal.scrollDelta.dy,
    );
  }

  Future<void> _pickAndInsertImage() async {
    final result = await FilePicker.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (result == null || result.files.isEmpty) {
      ref.read(editorControllerProvider.notifier).setTool(EditorTool.select);
      return;
    }
    final file = result.files.first;
    final bytes = file.bytes;
    if (bytes == null) {
      ref.read(editorControllerProvider.notifier).setTool(EditorTool.select);
      return;
    }

    // Stable local reference — later replaceable by file/Supabase storage keys.
    final src = 'local://${generateId()}_${file.name}';
    ref.read(imageBytesCacheProvider)[src] = bytes;

    final uiImage = await decodeUiImage(bytes);
    if (uiImage != null) {
      ref.read(imageCacheProvider)[src] = uiImage;
    }

    if (!mounted) return;
    final editor = ref.read(editorControllerProvider.notifier);
    final cam = editor.document.camera;
    final size = MediaQuery.sizeOf(context);
    final center = screenToWorld(Point(size.width / 2, size.height / 2), cam);

    var w = (uiImage?.width ?? 320).toDouble();
    var h = (uiImage?.height ?? 240).toDouble();
    const maxDim = 420.0;
    if (w > maxDim || h > maxDim) {
      final scale = maxDim / (w > h ? w : h);
      w *= scale;
      h *= scale;
    }

    final element = ImageElement.create(
      x: center.x - w / 2,
      y: center.y - h / 2,
      width: w,
      height: h,
      src: src,
      naturalWidth: (uiImage?.width ?? w).toDouble(),
      naturalHeight: (uiImage?.height ?? h).toDouble(),
      zIndex: editor.document.nextZIndex,
    );
    editor.createElement(element);
    editor.setTool(EditorTool.select);
    setState(() {});
  }
}

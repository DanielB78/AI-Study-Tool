import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/geometry/point.dart';
import '../controller/editor_controller.dart';
import '../interaction/canvas_interactor.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';
import 'canvas_renderer.dart';

/// Infinite canvas surface — raw pointer events → [CanvasInteractor] → commands.
class EditorCanvasView extends ConsumerStatefulWidget {
  const EditorCanvasView({super.key});

  @override
  ConsumerState<EditorCanvasView> createState() => _EditorCanvasViewState();
}

class _EditorCanvasViewState extends ConsumerState<EditorCanvasView> {
  CanvasInteractor? _interactor;
  final FocusNode _focusNode = FocusNode(debugLabel: 'editor-canvas');
  int? _activePointer;

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

  @override
  Widget build(BuildContext context) {
    final editorState = ref.watch(editorControllerProvider);
    final interaction = ref.watch(interactionControllerProvider);
    final tool = editorState.activeTool;

    final cursor = switch (tool) {
      EditorTool.pan => interaction.gesture is GesturePanning
          ? SystemMouseCursors.grabbing
          : SystemMouseCursors.grab,
      _ => SystemMouseCursors.basic,
    };

    return Focus(
      focusNode: _focusNode,
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
          child: RepaintBoundary(
            child: CustomPaint(
              painter: CanvasPainter(
                document: editorState.document,
                selectedIds: editorState.selectedIds,
                gesture: interaction.gesture,
              ),
              isComplex: true,
              willChange: true,
              child: const SizedBox.expand(),
            ),
          ),
        ),
      ),
    );
  }

  void _onPointerDown(PointerDownEvent event) {
    _focusNode.requestFocus();

    // Accept primary mouse / touch / stylus. Some desktop embeds report
    // buttons==0 on down; still treat mouse downs as primary.
    final isPrimaryMouse = event.kind == PointerDeviceKind.mouse &&
        (event.buttons == 0 || (event.buttons & kPrimaryButton) != 0);
    final isTouchLike = event.kind == PointerDeviceKind.touch ||
        event.kind == PointerDeviceKind.stylus ||
        event.kind == PointerDeviceKind.unknown;
    if (!isPrimaryMouse && !isTouchLike) {
      return;
    }

    _activePointer = event.pointer;
    interactor.onPointerDown(_toPoint(event.localPosition));
  }

  void _onPointerMove(PointerMoveEvent event) {
    if (_activePointer == null || event.pointer != _activePointer) return;
    interactor.onPointerMove(_toPoint(event.localPosition));
  }

  void _onPointerUp(PointerUpEvent event) {
    if (_activePointer != null && event.pointer != _activePointer) return;
    interactor.onPointerUp(_toPoint(event.localPosition));
    _activePointer = null;
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
}

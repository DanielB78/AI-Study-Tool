import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/models/camera_state.dart';
import '../controller/editor_controller.dart';
import '../interaction/canvas_interactor.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';
import 'canvas_renderer.dart';

/// Infinite canvas surface — pointer events → [CanvasInteractor] → commands.
class EditorCanvasView extends ConsumerStatefulWidget {
  const EditorCanvasView({super.key});

  @override
  ConsumerState<EditorCanvasView> createState() => _EditorCanvasViewState();
}

class _EditorCanvasViewState extends ConsumerState<EditorCanvasView> {
  CanvasInteractor? _interactor;
  double? _pinchStartZoom;

  CanvasInteractor get interactor {
    return _interactor ??= CanvasInteractor(
      editor: ref.read(editorControllerProvider.notifier),
      interaction: ref.read(interactionControllerProvider.notifier),
    );
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

    return MouseRegion(
      cursor: cursor,
      onHover: (event) {
        interactor.onPointerHover(_toPoint(event.localPosition));
      },
      child: Listener(
        onPointerSignal: _onPointerSignal,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onScaleStart: _onScaleStart,
          onScaleUpdate: _onScaleUpdate,
          onScaleEnd: _onScaleEnd,
          child: RepaintBoundary(
            child: CustomPaint(
              painter: CanvasPainter(
                document: editorState.document,
                selectedIds: editorState.selectedIds,
                gesture: interaction.gesture,
              ),
              child: const SizedBox.expand(),
            ),
          ),
        ),
      ),
    );
  }

  void _onPointerSignal(PointerSignalEvent signal) {
    if (signal is! PointerScrollEvent) return;

    final position = _toPoint(signal.localPosition);
    final wantsZoom = HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed;

    if (wantsZoom) {
      interactor.onScrollZoom(position, signal.scrollDelta.dy);
      return;
    }

    // Mouse wheel → zoom around pointer (desktop convention).
    if (signal.kind == PointerDeviceKind.mouse) {
      interactor.onScrollZoom(position, signal.scrollDelta.dy);
      return;
    }

    // Trackpad two-finger scroll → pan.
    interactor.panByScreenDelta(
      -signal.scrollDelta.dx,
      -signal.scrollDelta.dy,
    );
  }

  void _onScaleStart(ScaleStartDetails details) {
    if (details.pointerCount > 1) {
      _pinchStartZoom =
          ref.read(editorControllerProvider).document.camera.zoom;
      return;
    }
    interactor.onPointerDown(_toPoint(details.localFocalPoint));
  }

  void _onScaleUpdate(ScaleUpdateDetails details) {
    if (details.pointerCount > 1) {
      final startZoom = _pinchStartZoom ??
          ref.read(editorControllerProvider).document.camera.zoom;
      final camera = ref.read(editorControllerProvider).document.camera;
      final focal = _toPoint(details.localFocalPoint);
      final next = zoomAtPoint(
        camera.copyWith(zoom: startZoom),
        focal,
        startZoom * details.scale,
      );
      ref.read(editorControllerProvider.notifier).setCamera(next);
      return;
    }
    interactor.onPointerMove(_toPoint(details.localFocalPoint));
  }

  void _onScaleEnd(ScaleEndDetails details) {
    _pinchStartZoom = null;
    // Use last known pointer from interaction state when available.
    final pointer =
        ref.read(interactionControllerProvider).pointerScreen ?? Point.zero;
    interactor.onPointerUp(pointer);
  }
}

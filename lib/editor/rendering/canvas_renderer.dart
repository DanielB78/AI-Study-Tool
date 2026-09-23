import 'package:flutter/material.dart';

import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../state/interaction_state.dart';
import 'element_renderers.dart';

/// Central canvas renderer — reads [CanvasDocument], never owns state.
class CanvasRenderer {
  CanvasRenderer({
    Map<CanvasElementType, ElementRenderer>? renderers,
  }) : renderers = renderers ??
            {
              CanvasElementType.shape: const ShapeElementRenderer(),
              CanvasElementType.text: const TextElementRenderer(),
              CanvasElementType.drawing: const DrawingElementRenderer(),
              CanvasElementType.image: const ImageElementRenderer(),
              CanvasElementType.connector: const ConnectorElementRenderer(),
            };

  final Map<CanvasElementType, ElementRenderer> renderers;

  void paint(
    Canvas canvas,
    Size size, {
    required CanvasDocument document,
    required Set<String> selectedIds,
    GestureState gesture = const GestureIdle(),
  }) {
    _paintBackground(canvas, size);
    _paintGrid(canvas, size, document.camera);

    canvas.save();
    final camera = document.camera;
    canvas.translate(camera.x, camera.y);
    canvas.scale(camera.zoom);

    final liveOffsets = _liveOffsets(gesture);

    for (final element in document.elementsInZOrder) {
      final offset = liveOffsets[element.id] ?? Offset.zero;
      renderElement(
        canvas,
        element,
        selected: selectedIds.contains(element.id),
        liveOffset: offset,
      );
    }

    // Selection outlines above content.
    for (final id in selectedIds) {
      final element = document.getElementById(id);
      if (element == null) continue;
      final offset = liveOffsets[id] ?? Offset.zero;
      _paintSelectionBounds(canvas, element, offset);
    }

    canvas.restore();
  }

  void renderElement(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    final renderer = renderers[element.type];
    renderer?.paint(
      canvas,
      element,
      selected: selected,
      liveOffset: liveOffset,
    );
  }

  Map<String, Offset> _liveOffsets(GestureState gesture) {
    if (gesture is! GestureDraggingElements) return const {};
    final dx = gesture.dx;
    final dy = gesture.dy;
    return {
      for (final id in gesture.elementIds) id: Offset(dx, dy),
    };
  }

  void _paintBackground(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = const Color(0xFFF4F5F7),
    );
  }

  void _paintGrid(Canvas canvas, Size size, CameraState camera) {
    const worldStep = 40.0;
    final screenStep = worldStep * camera.zoom;
    if (screenStep < 8) return;

    final paint = Paint()
      ..color = const Color(0x14000000)
      ..strokeWidth = 1;

    final originX = camera.x % screenStep;
    final originY = camera.y % screenStep;

    for (var x = originX; x < size.width; x += screenStep) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = originY; y < size.height; y += screenStep) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  void _paintSelectionBounds(
    Canvas canvas,
    CanvasElement element,
    Offset liveOffset,
  ) {
    final rect = Rect.fromLTWH(
      element.x + liveOffset.dx,
      element.y + liveOffset.dy,
      element.width,
      element.height,
    ).inflate(2);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = const Color(0xFF3B82F6);
    canvas.drawRect(rect, stroke);

    const handle = 6.0;
    final fillPaint = Paint()..color = const Color(0xFFFFFFFF);
    final handleStroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.25
      ..color = const Color(0xFF3B82F6);
    for (final c in [rect.topLeft, rect.topRight, rect.bottomLeft, rect.bottomRight]) {
      final hr = Rect.fromCenter(center: c, width: handle, height: handle);
      canvas.drawRect(hr, fillPaint);
      canvas.drawRect(hr, handleStroke);
    }
  }
}

/// [CustomPainter] bridge — holds no application state of its own.
class CanvasPainter extends CustomPainter {
  CanvasPainter({
    required this.document,
    required this.selectedIds,
    required this.gesture,
    CanvasRenderer? renderer,
  }) : renderer = renderer ?? CanvasRenderer();

  final CanvasDocument document;
  final Set<String> selectedIds;
  final GestureState gesture;
  final CanvasRenderer renderer;

  @override
  void paint(Canvas canvas, Size size) {
    renderer.paint(
      canvas,
      size,
      document: document,
      selectedIds: selectedIds,
      gesture: gesture,
    );
  }

  @override
  bool shouldRepaint(covariant CanvasPainter oldDelegate) {
    return document != oldDelegate.document ||
        !_setEq(selectedIds, oldDelegate.selectedIds) ||
        gesture != oldDelegate.gesture;
  }

  bool _setEq(Set<String> a, Set<String> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    return a.containsAll(b);
  }
}

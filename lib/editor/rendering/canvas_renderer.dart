import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../geometry/transform_handles.dart';
import '../state/interaction_state.dart';
import 'element_renderers.dart';

/// Central canvas renderer — reads [CanvasDocument], never owns state.
class CanvasRenderer {
  CanvasRenderer({
    Map<CanvasElementType, ElementRenderer>? renderers,
    this.imageCache,
  }) : renderers = renderers ??
            {
              CanvasElementType.shape: const ShapeElementRenderer(),
              CanvasElementType.text: const TextElementRenderer(),
              CanvasElementType.drawing: const DrawingElementRenderer(),
              CanvasElementType.image: ImageElementRenderer(imageCache: imageCache),
              CanvasElementType.connector: const ConnectorElementRenderer(),
            };

  final Map<CanvasElementType, ElementRenderer> renderers;
  final Map<String, ui.Image>? imageCache;
  final _handles = const TransformHandleHitTester();

  void paint(
    Canvas canvas,
    Size size, {
    required CanvasDocument document,
    required Set<String> selectedIds,
    GestureState gesture = const GestureIdle(),
    List<AlignmentGuide> guides = const [],
    String? editingTextId,
  }) {
    _paintBackground(canvas, size);
    _paintGrid(canvas, size, document.camera);

    canvas.save();
    final camera = document.camera;
    canvas.translate(camera.x, camera.y);
    canvas.scale(camera.zoom);

    final liveOffsets = _liveOffsets(gesture);

    for (final element in document.elementsInZOrder) {
      // Hide committed text while overlay edits it.
      if (editingTextId != null && element.id == editingTextId) continue;
      final offset = liveOffsets[element.id] ?? Offset.zero;
      renderElement(
        canvas,
        element,
        selected: selectedIds.contains(element.id),
        liveOffset: offset,
      );
    }

    // Live creation previews
    _paintCreationPreview(canvas, gesture);

    // Selection outlines + handles
    for (final id in selectedIds) {
      if (editingTextId == id) continue;
      final element = document.getElementById(id);
      if (element == null) continue;
      final offset = liveOffsets[id] ?? Offset.zero;
      final liveBounds = element.bounds.translate(offset.dx, offset.dy);
      // Apply live transform preview
      final paintBounds = gesture is GestureTransforming &&
              gesture.elementId == id &&
              gesture.handle != TransformHandle.rotate
          ? applyResize(
              origin: gesture.originBounds,
              handle: gesture.handle,
              current: gesture.currentWorld,
              keepAspect: element is ImageElement,
            )
          : liveBounds;
      _paintSelectionBounds(
        canvas,
        paintBounds,
        showHandles: selectedIds.length == 1 && element is! DrawingElement,
        zoom: camera.zoom,
      );
    }

    // Marquee
    if (gesture is GestureMarqueeSelect) {
      final r = gesture.rect;
      canvas.drawRect(
        Rect.fromLTWH(r.x, r.y, r.width, r.height),
        Paint()..color = const Color(0x333B82F6),
      );
      canvas.drawRect(
        Rect.fromLTWH(r.x, r.y, r.width, r.height),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1 / camera.zoom
          ..color = const Color(0xFF3B82F6),
      );
    }

    // Alignment guides
    for (final g in guides) {
      final paint = Paint()
        ..color = const Color(0xFFE11D48)
        ..strokeWidth = 1 / camera.zoom;
      if (g.orientation == GuideOrientation.vertical) {
        canvas.drawLine(
          Offset(g.position, -100000),
          Offset(g.position, 100000),
          paint,
        );
      } else {
        canvas.drawLine(
          Offset(-100000, g.position),
          Offset(100000, g.position),
          paint,
        );
      }
    }

    canvas.restore();
  }

  void renderElement(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    // Keep image renderer cache in sync
    final renderer = renderers[element.type];
    if (element.type == CanvasElementType.image && imageCache != null) {
      (renderer as ImageElementRenderer);
    }
    renderer?.paint(
      canvas,
      element,
      selected: selected,
      liveOffset: liveOffset,
    );
  }

  Map<String, Offset> _liveOffsets(GestureState gesture) {
    if (gesture is! GestureDraggingElements) return const {};
    return {
      for (final id in gesture.elementIds) id: Offset(gesture.dx, gesture.dy),
    };
  }

  void _paintCreationPreview(Canvas canvas, GestureState gesture) {
    if (gesture is GestureCreatingShape) {
      final r = gesture.rect;
      final preview = ShapeElement.create(
        x: r.x,
        y: r.y,
        width: r.width.clamp(1, 100000),
        height: r.height.clamp(1, 100000),
        shapeKind: gesture.kind,
      );
      const ShapeElementRenderer().paint(
        canvas,
        preview.copyWithBase(opacity: 0.7),
        selected: false,
      );
    } else if (gesture is GestureCreatingConnector) {
      final isArrow = gesture.kind == ConnectorKind.arrow;
      final preview = ConnectorElement.create(
        startX: gesture.startWorld.x,
        startY: gesture.startWorld.y,
        endX: gesture.currentWorld.x,
        endY: gesture.currentWorld.y,
        connectorKind: gesture.kind,
        arrowHeads: isArrow ? ArrowHeads.end : ArrowHeads.none,
      );
      const ConnectorElementRenderer()
          .paint(canvas, preview, selected: false);
    } else if (gesture is GestureDrawingStroke && gesture.points.length >= 4) {
      final preview = DrawingElement.fromPoints(
        absolutePoints: gesture.points,
        color: '#1A1A1A',
        strokeWidth: 3,
      );
      const DrawingElementRenderer().paint(canvas, preview, selected: false);
    }
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
    dynamic bounds, {
    required bool showHandles,
    required double zoom,
  }) {
    final rect = Rect.fromLTWH(
      bounds.x as double,
      bounds.y as double,
      bounds.width as double,
      bounds.height as double,
    ).inflate(2 / zoom);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5 / zoom
      ..color = const Color(0xFF3B82F6);
    canvas.drawRect(rect, stroke);

    if (!showHandles) return;

    final handleRects = _handles.handleRects(
      // ignore: unnecessary_cast
      bounds,
      zoom: zoom,
    );
    final fillPaint = Paint()..color = const Color(0xFFFFFFFF);
    final handleStroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.25 / zoom
      ..color = const Color(0xFF3B82F6);

    for (final entry in handleRects.entries) {
      if (entry.key == TransformHandle.rotate) {
        // Rotation stem
        canvas.drawLine(
          Offset(rect.center.dx, rect.top),
          Offset(rect.center.dx, entry.value.center.y),
          stroke,
        );
      }
      final hr = Rect.fromLTWH(
        entry.value.x,
        entry.value.y,
        entry.value.width,
        entry.value.height,
      );
      if (entry.key == TransformHandle.rotate) {
        canvas.drawCircle(hr.center, hr.width / 2, fillPaint);
        canvas.drawCircle(hr.center, hr.width / 2, handleStroke);
      } else {
        canvas.drawRect(hr, fillPaint);
        canvas.drawRect(hr, handleStroke);
      }
    }
  }
}

class CanvasPainter extends CustomPainter {
  CanvasPainter({
    required this.document,
    required this.selectedIds,
    required this.gesture,
    this.guides = const [],
    this.editingTextId,
    this.imageCache,
    CanvasRenderer? renderer,
  }) : renderer = renderer ??
            CanvasRenderer(imageCache: imageCache);

  final CanvasDocument document;
  final Set<String> selectedIds;
  final GestureState gesture;
  final List<AlignmentGuide> guides;
  final String? editingTextId;
  final Map<String, ui.Image>? imageCache;
  final CanvasRenderer renderer;

  @override
  void paint(Canvas canvas, Size size) {
    renderer.paint(
      canvas,
      size,
      document: document,
      selectedIds: selectedIds,
      gesture: gesture,
      guides: guides,
      editingTextId: editingTextId,
    );
  }

  @override
  bool shouldRepaint(covariant CanvasPainter oldDelegate) {
    return document != oldDelegate.document ||
        !_setEq(selectedIds, oldDelegate.selectedIds) ||
        gesture != oldDelegate.gesture ||
        guides != oldDelegate.guides ||
        editingTextId != oldDelegate.editingTextId ||
        imageCache != oldDelegate.imageCache;
  }

  bool _setEq(Set<String> a, Set<String> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    return a.containsAll(b);
  }
}

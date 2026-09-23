import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/geometry/rect.dart';
import '../../core/canvas/geometry/shape_geometry.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';

/// Hit-testing separated from rendering.
class CanvasHitTester {
  const CanvasHitTester();

  CanvasElement? hitTest(CanvasDocument document, Point worldPoint) {
    for (final element in document.elementsTopFirst) {
      if (hitsElement(element, worldPoint)) {
        return element;
      }
    }
    return null;
  }

  List<CanvasElement> hitTestRect(CanvasDocument document, Rect2 area) {
    return document.elementsInZOrder
        .where((e) => e.bounds.intersects(area))
        .toList();
  }

  bool hitsElement(CanvasElement element, Point worldPoint) {
    return switch (element) {
      ShapeElement(:final shapeKind) =>
        _hitShape(element, shapeKind, worldPoint),
      TextElement() => element.bounds.containsPoint(worldPoint),
      ImageElement() => element.bounds.containsPoint(worldPoint),
      DrawingElement(:final points, :final strokeWidth) =>
        distanceToPolyline(worldPoint, points) <= (strokeWidth / 2 + 4),
      ConnectorElement() => _hitConnector(element, worldPoint),
    };
  }

  bool _hitShape(ShapeElement element, ShapeKind kind, Point worldPoint) {
    final bounds = element.bounds;
    return switch (kind) {
      ShapeKind.ellipse => _hitEllipse(bounds, worldPoint),
      ShapeKind.rectangle || ShapeKind.roundedRect =>
        bounds.containsPoint(worldPoint),
      _ => pointInPolygon(
          worldPoint,
          shapePolygon(
            kind,
            bounds,
            starPoints: element.starPoints,
            starInnerRatio: element.starInnerRatio,
          ),
        ),
    };
  }

  bool _hitEllipse(Rect2 bounds, Point point) {
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    final cx = bounds.center.x;
    final cy = bounds.center.y;
    final rx = bounds.width / 2;
    final ry = bounds.height / 2;
    final dx = (point.x - cx) / rx;
    final dy = (point.y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }

  bool _hitConnector(
    ConnectorElement element,
    Point point, {
    double tolerance = 6,
  }) {
    return distanceToSegment(
          point,
          Point(element.startX, element.startY),
          Point(element.endX, element.endY),
        ) <=
        (tolerance + element.strokeWidth / 2);
  }
}

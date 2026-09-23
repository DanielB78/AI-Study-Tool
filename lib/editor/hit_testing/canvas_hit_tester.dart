import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/geometry/rect.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';

/// Hit-testing separated from rendering.
///
/// Phase 1: axis-aligned bounding boxes.
/// Element types can later provide precise geometry (circles, strokes, etc.).
class CanvasHitTester {
  const CanvasHitTester();

  /// Returns the top-most element under [worldPoint], or null.
  CanvasElement? hitTest(CanvasDocument document, Point worldPoint) {
    for (final element in document.elementsTopFirst) {
      if (hitsElement(element, worldPoint)) {
        return element;
      }
    }
    return null;
  }

  bool hitsElement(CanvasElement element, Point worldPoint) {
    return switch (element) {
      ShapeElement(:final shapeKind) =>
        _hitShape(element, shapeKind, worldPoint),
      TextElement() => element.bounds.containsPoint(worldPoint),
      ImageElement() => element.bounds.containsPoint(worldPoint),
      DrawingElement() => element.bounds.containsPoint(worldPoint),
      ConnectorElement() => _hitConnector(element, worldPoint),
    };
  }

  bool _hitShape(ShapeElement element, ShapeKind kind, Point worldPoint) {
    final bounds = element.bounds;
    return switch (kind) {
      ShapeKind.ellipse => _hitEllipse(bounds, worldPoint),
      ShapeKind.rectangle || ShapeKind.roundedRect =>
        bounds.containsPoint(worldPoint),
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

  /// Rough connector hit: proximity to the line segment.
  bool _hitConnector(
    ConnectorElement element,
    Point point, {
    double tolerance = 6,
  }) {
    final x1 = element.startX;
    final y1 = element.startY;
    final x2 = element.endX;
    final y2 = element.endY;
    final dx = x2 - x1;
    final dy = y2 - y1;
    final lengthSq = dx * dx + dy * dy;
    if (lengthSq == 0) {
      final ddx = point.x - x1;
      final ddy = point.y - y1;
      return ddx * ddx + ddy * ddy <= tolerance * tolerance;
    }
    var t = ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSq;
    t = t.clamp(0.0, 1.0);
    final projX = x1 + t * dx;
    final projY = y1 + t * dy;
    final ddx = point.x - projX;
    final ddy = point.y - projY;
    return ddx * ddx + ddy * ddy <= tolerance * tolerance;
  }
}

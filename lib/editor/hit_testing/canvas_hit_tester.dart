import 'dart:math' as math;

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
    final local = _toLocal(element, worldPoint);
    return switch (element) {
      ShapeElement(:final shapeKind) => _hitShape(element, shapeKind, local),
      TextElement() => element.bounds.containsPoint(local),
      ImageElement() => element.bounds.containsPoint(local),
      DrawingElement(:final points, :final strokeWidth) =>
        distanceToPolyline(local, points) <= (strokeWidth / 2 + 4),
      ConnectorElement() => _hitConnector(element, local),
    };
  }

  /// Inverse-rotate the world point into the element's unrotated local space.
  Point _toLocal(CanvasElement element, Point worldPoint) {
    if (element.rotation == 0) return worldPoint;
    final cx = element.x + element.width / 2;
    final cy = element.y + element.height / 2;
    final dx = worldPoint.x - cx;
    final dy = worldPoint.y - cy;
    final cos = math.cos(-element.rotation);
    final sin = math.sin(-element.rotation);
    return Point(
      cx + dx * cos - dy * sin,
      cy + dx * sin + dy * cos,
    );
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

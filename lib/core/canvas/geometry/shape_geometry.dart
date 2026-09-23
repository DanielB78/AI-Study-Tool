import 'dart:math' as math;

import '../models/canvas_element.dart';
import 'point.dart';
import 'rect.dart';

/// Build a closed polygon path (list of points) for a shape in world bounds.
List<Point> shapePolygon(ShapeKind kind, Rect2 bounds, {int starPoints = 5, double starInnerRatio = 0.45}) {
  final cx = bounds.center.x;
  final cy = bounds.center.y;
  final w = bounds.width;
  final h = bounds.height;
  final left = bounds.left;
  final top = bounds.top;
  final right = bounds.right;
  final bottom = bounds.bottom;

  switch (kind) {
    case ShapeKind.rectangle:
    case ShapeKind.roundedRect:
      return [
        Point(left, top),
        Point(right, top),
        Point(right, bottom),
        Point(left, bottom),
      ];
    case ShapeKind.ellipse:
      // Approximate for hit-testing polygons; ellipse uses dedicated hit.
      const n = 32;
      return [
        for (var i = 0; i < n; i++)
          Point(
            cx + (w / 2) * math.cos(2 * math.pi * i / n),
            cy + (h / 2) * math.sin(2 * math.pi * i / n),
          ),
      ];
    case ShapeKind.triangle:
      return [
        Point(cx, top),
        Point(right, bottom),
        Point(left, bottom),
      ];
    case ShapeKind.diamond:
      return [
        Point(cx, top),
        Point(right, cy),
        Point(cx, bottom),
        Point(left, cy),
      ];
    case ShapeKind.pentagon:
      return _regularPolygon(cx, cy, w / 2, h / 2, 5, -math.pi / 2);
    case ShapeKind.hexagon:
      return _regularPolygon(cx, cy, w / 2, h / 2, 6, 0);
    case ShapeKind.star:
      return _star(cx, cy, w / 2, h / 2, starPoints, starInnerRatio);
    case ShapeKind.parallelogram:
      final skew = w * 0.25;
      return [
        Point(left + skew, top),
        Point(right, top),
        Point(right - skew, bottom),
        Point(left, bottom),
      ];
    case ShapeKind.callout:
      final tailH = h * 0.22;
      final bodyBottom = bottom - tailH;
      return [
        Point(left, top),
        Point(right, top),
        Point(right, bodyBottom),
        Point(left + w * 0.45, bodyBottom),
        Point(left + w * 0.28, bottom),
        Point(left + w * 0.35, bodyBottom),
        Point(left, bodyBottom),
      ];
  }
}

List<Point> _regularPolygon(
  double cx,
  double cy,
  double rx,
  double ry,
  int sides,
  double startAngle,
) {
  return [
    for (var i = 0; i < sides; i++)
      Point(
        cx + rx * math.cos(startAngle + 2 * math.pi * i / sides),
        cy + ry * math.sin(startAngle + 2 * math.pi * i / sides),
      ),
  ];
}

List<Point> _star(
  double cx,
  double cy,
  double rx,
  double ry,
  int points,
  double innerRatio,
) {
  final result = <Point>[];
  final n = points * 2;
  for (var i = 0; i < n; i++) {
    final angle = -math.pi / 2 + math.pi * i / points;
    final outer = i.isEven;
    final rScale = outer ? 1.0 : innerRatio;
    result.add(Point(
      cx + rx * rScale * math.cos(angle),
      cy + ry * rScale * math.sin(angle),
    ));
  }
  return result;
}

bool pointInPolygon(Point point, List<Point> polygon) {
  if (polygon.length < 3) return false;
  var inside = false;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    final xi = polygon[i].x;
    final yi = polygon[i].y;
    final xj = polygon[j].x;
    final yj = polygon[j].y;
    final intersect = ((yi > point.y) != (yj > point.y)) &&
        (point.x <
            (xj - xi) * (point.y - yi) / ((yj - yi) == 0 ? 1e-9 : (yj - yi)) +
                xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

double distanceToSegment(Point p, Point a, Point b) {
  final dx = b.x - a.x;
  final dy = b.y - a.y;
  final lengthSq = dx * dx + dy * dy;
  if (lengthSq == 0) {
    final ddx = p.x - a.x;
    final ddy = p.y - a.y;
    return math.sqrt(ddx * ddx + ddy * ddy);
  }
  var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = t.clamp(0.0, 1.0);
  final projX = a.x + t * dx;
  final projY = a.y + t * dy;
  final ddx = p.x - projX;
  final ddy = p.y - projY;
  return math.sqrt(ddx * ddx + ddy * ddy);
}

double distanceToPolyline(Point p, List<double> points) {
  if (points.length < 4) return double.infinity;
  var min = double.infinity;
  for (var i = 0; i + 3 < points.length; i += 2) {
    final d = distanceToSegment(
      p,
      Point(points[i], points[i + 1]),
      Point(points[i + 2], points[i + 3]),
    );
    if (d < min) min = d;
  }
  return min;
}

Rect2 normalizeRect(double x1, double y1, double x2, double y2) {
  return Rect2.fromPoints(Point(x1, y1), Point(x2, y2));
}

/// Constrain to square / circle when shift is held.
Rect2 constrainProportional(Rect2 rect, Point start, Point current) {
  final size = math.max(rect.width, rect.height);
  final dx = current.x >= start.x ? size : -size;
  final dy = current.y >= start.y ? size : -size;
  return Rect2.fromPoints(start, Point(start.x + dx, start.y + dy));
}

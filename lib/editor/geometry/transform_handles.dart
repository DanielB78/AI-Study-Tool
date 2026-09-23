import 'dart:math' as math;

import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/geometry/rect.dart';
import '../state/interaction_state.dart';

/// Hit-test resize/rotate handles around a selection bounds (world space).
class TransformHandleHitTester {
  const TransformHandleHitTester({this.handleSize = 10});

  final double handleSize;

  Map<TransformHandle, Rect2> handleRects(Rect2 bounds, {double zoom = 1}) {
    final size = handleSize / zoom;
    final half = size / 2;
    final c = bounds.center;
    return {
      TransformHandle.topLeft: Rect2(
          x: bounds.left - half, y: bounds.top - half, width: size, height: size),
      TransformHandle.top:
          Rect2(x: c.x - half, y: bounds.top - half, width: size, height: size),
      TransformHandle.topRight: Rect2(
          x: bounds.right - half, y: bounds.top - half, width: size, height: size),
      TransformHandle.right:
          Rect2(x: bounds.right - half, y: c.y - half, width: size, height: size),
      TransformHandle.bottomRight: Rect2(
          x: bounds.right - half,
          y: bounds.bottom - half,
          width: size,
          height: size),
      TransformHandle.bottom: Rect2(
          x: c.x - half, y: bounds.bottom - half, width: size, height: size),
      TransformHandle.bottomLeft: Rect2(
          x: bounds.left - half,
          y: bounds.bottom - half,
          width: size,
          height: size),
      TransformHandle.left:
          Rect2(x: bounds.left - half, y: c.y - half, width: size, height: size),
      TransformHandle.rotate: Rect2(
          x: c.x - half,
          y: bounds.top - half - 24 / zoom,
          width: size,
          height: size),
    };
  }

  TransformHandle? hitTest(Rect2 bounds, Point world, {double zoom = 1}) {
    final rects = handleRects(bounds, zoom: zoom);
    for (final entry in rects.entries) {
      if (entry.value.containsPoint(world)) return entry.key;
    }
    return null;
  }
}

/// Compute new bounds from a transform drag.
Rect2 applyResize({
  required Rect2 origin,
  required TransformHandle handle,
  required Point current,
  bool keepAspect = false,
}) {
  var left = origin.left;
  var top = origin.top;
  var right = origin.right;
  var bottom = origin.bottom;

  switch (handle) {
    case TransformHandle.topLeft:
      left = current.x;
      top = current.y;
    case TransformHandle.top:
      top = current.y;
    case TransformHandle.topRight:
      right = current.x;
      top = current.y;
    case TransformHandle.right:
      right = current.x;
    case TransformHandle.bottomRight:
      right = current.x;
      bottom = current.y;
    case TransformHandle.bottom:
      bottom = current.y;
    case TransformHandle.bottomLeft:
      left = current.x;
      bottom = current.y;
    case TransformHandle.left:
      left = current.x;
    case TransformHandle.rotate:
      return origin;
  }

  var rect = Rect2.fromPoints(Point(left, top), Point(right, bottom));
  if (rect.width < 8) {
    rect = Rect2(x: rect.x, y: rect.y, width: 8, height: rect.height);
  }
  if (rect.height < 8) {
    rect = Rect2(x: rect.x, y: rect.y, width: rect.width, height: 8);
  }

  if (keepAspect && origin.width > 0 && origin.height > 0) {
    final aspect = origin.width / origin.height;
    if (rect.width / rect.height > aspect) {
      final h = rect.width / aspect;
      rect = Rect2(x: rect.x, y: rect.y, width: rect.width, height: h);
    } else {
      final w = rect.height * aspect;
      rect = Rect2(x: rect.x, y: rect.y, width: w, height: rect.height);
    }
  }
  return rect;
}

double applyRotation({
  required Rect2 origin,
  required Point current,
}) {
  final c = origin.center;
  return math.atan2(current.y - c.y, current.x - c.x) + math.pi / 2;
}

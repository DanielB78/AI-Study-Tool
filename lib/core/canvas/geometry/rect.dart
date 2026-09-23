import 'package:equatable/equatable.dart';

import 'point.dart';

/// Axis-aligned rectangle in world (or screen) coordinates.
class Rect2 extends Equatable {
  const Rect2({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  final double x;
  final double y;
  final double width;
  final double height;

  double get left => x;
  double get top => y;
  double get right => x + width;
  double get bottom => y + height;
  Point get center => Point(x + width / 2, y + height / 2);

  bool containsPoint(Point point) {
    return point.x >= left &&
        point.x <= right &&
        point.y >= top &&
        point.y <= bottom;
  }

  bool intersects(Rect2 other) {
    return left < other.right &&
        right > other.left &&
        top < other.bottom &&
        bottom > other.top;
  }

  Rect2 expand(double padding) {
    return Rect2(
      x: x - padding,
      y: y - padding,
      width: width + padding * 2,
      height: height + padding * 2,
    );
  }

  Rect2 translate(double dx, double dy) {
    return Rect2(x: x + dx, y: y + dy, width: width, height: height);
  }

  static Rect2 fromPoints(Point a, Point b) {
    final left = a.x < b.x ? a.x : b.x;
    final top = a.y < b.y ? a.y : b.y;
    return Rect2(
      x: left,
      y: top,
      width: (a.x - b.x).abs(),
      height: (a.y - b.y).abs(),
    );
  }

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'width': width,
        'height': height,
      };

  factory Rect2.fromJson(Map<String, dynamic> json) {
    return Rect2(
      x: (json['x'] as num).toDouble(),
      y: (json['y'] as num).toDouble(),
      width: (json['width'] as num).toDouble(),
      height: (json['height'] as num).toDouble(),
    );
  }

  @override
  List<Object?> get props => [x, y, width, height];
}

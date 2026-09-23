import 'package:equatable/equatable.dart';

/// Simple 2D point used for world/screen coordinate math (not a Flutter Offset).
class Point extends Equatable {
  const Point(this.x, this.y);

  final double x;
  final double y;

  static const zero = Point(0, 0);

  Point operator +(Point other) => Point(x + other.x, y + other.y);
  Point operator -(Point other) => Point(x - other.x, y - other.y);
  Point operator *(double scale) => Point(x * scale, y * scale);

  Point translate(double dx, double dy) => Point(x + dx, y + dy);

  Map<String, dynamic> toJson() => {'x': x, 'y': y};

  factory Point.fromJson(Map<String, dynamic> json) {
    return Point(
      (json['x'] as num).toDouble(),
      (json['y'] as num).toDouble(),
    );
  }

  @override
  List<Object?> get props => [x, y];

  @override
  String toString() => 'Point($x, $y)';
}

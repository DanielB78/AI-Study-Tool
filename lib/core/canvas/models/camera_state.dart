import 'package:equatable/equatable.dart';

import '../geometry/point.dart';

/// Minimum / maximum zoom for the infinite canvas.
const double kMinZoom = 0.1;
const double kMaxZoom = 8.0;

/// Camera / viewport transform in screen space.
///
/// Elements live in world coordinates. The camera converts between
/// screen and world via [screenToWorld] / [worldToScreen].
class CameraState extends Equatable {
  const CameraState({
    this.x = 0,
    this.y = 0,
    this.zoom = 1,
  });

  /// Screen-space offset of the world origin.
  final double x;
  final double y;

  /// Uniform scale factor (1 = 100%).
  final double zoom;

  static const identity = CameraState();

  CameraState copyWith({double? x, double? y, double? zoom}) {
    return CameraState(
      x: x ?? this.x,
      y: y ?? this.y,
      zoom: zoom ?? this.zoom,
    );
  }

  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'zoom': zoom};

  factory CameraState.fromJson(Map<String, dynamic> json) {
    return CameraState(
      x: (json['x'] as num?)?.toDouble() ?? 0,
      y: (json['y'] as num?)?.toDouble() ?? 0,
      zoom: (json['zoom'] as num?)?.toDouble() ?? 1,
    );
  }

  @override
  List<Object?> get props => [x, y, zoom];
}

double clampZoom(double zoom) => zoom.clamp(kMinZoom, kMaxZoom);

/// Convert a screen-space point (relative to the canvas widget) into world coordinates.
Point screenToWorld(Point screen, CameraState camera) {
  return Point(
    (screen.x - camera.x) / camera.zoom,
    (screen.y - camera.y) / camera.zoom,
  );
}

/// Convert a world-space point into screen coordinates.
Point worldToScreen(Point world, CameraState camera) {
  return Point(
    world.x * camera.zoom + camera.x,
    world.y * camera.zoom + camera.y,
  );
}

/// Zoom around a screen-space pointer so the world point under the cursor stays fixed.
CameraState zoomAtPoint(
  CameraState camera,
  Point screenPoint,
  double nextZoom,
) {
  final zoom = clampZoom(nextZoom);
  final world = screenToWorld(screenPoint, camera);
  return CameraState(
    zoom: zoom,
    x: screenPoint.x - world.x * zoom,
    y: screenPoint.y - world.y * zoom,
  );
}

/// Pan the camera by a screen-space delta.
CameraState panBy(CameraState camera, double dx, double dy) {
  return camera.copyWith(x: camera.x + dx, y: camera.y + dy);
}

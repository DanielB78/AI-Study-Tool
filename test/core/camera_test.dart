import 'package:ai_study_tool/core/canvas/geometry/point.dart';
import 'package:ai_study_tool/core/canvas/models/camera_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('camera transforms', () {
    test('screenToWorld and worldToScreen are inverses', () {
      const camera = CameraState(x: 100, y: 50, zoom: 2);
      const screen = Point(140, 90);
      final world = screenToWorld(screen, camera);
      expect(world.x, closeTo(20, 1e-9));
      expect(world.y, closeTo(20, 1e-9));
      final back = worldToScreen(world, camera);
      expect(back.x, closeTo(screen.x, 1e-9));
      expect(back.y, closeTo(screen.y, 1e-9));
    });

    test('zoomAtPoint keeps world point under cursor fixed', () {
      const camera = CameraState(x: 0, y: 0, zoom: 1);
      const screen = Point(200, 100);
      final worldBefore = screenToWorld(screen, camera);
      final zoomed = zoomAtPoint(camera, screen, 2);
      final worldAfter = screenToWorld(screen, zoomed);
      expect(worldAfter.x, closeTo(worldBefore.x, 1e-9));
      expect(worldAfter.y, closeTo(worldBefore.y, 1e-9));
      expect(zoomed.zoom, 2);
    });

    test('clampZoom respects min and max', () {
      expect(clampZoom(0.01), kMinZoom);
      expect(clampZoom(100), kMaxZoom);
      expect(clampZoom(1.5), 1.5);
    });

    test('panBy shifts camera offset', () {
      const camera = CameraState(x: 10, y: 20, zoom: 1);
      final panned = panBy(camera, 5, -3);
      expect(panned.x, 15);
      expect(panned.y, 17);
      expect(panned.zoom, 1);
    });
  });
}

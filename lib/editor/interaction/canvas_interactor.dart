import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/commands/document_commands.dart';
import '../controller/editor_controller.dart';
import '../hit_testing/canvas_hit_tester.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';

/// Pointer-agnostic interaction handling for the canvas.
///
/// Desktop mouse / trackpad and future touch / stylus all funnel through
/// pointer APIs here — not mouse-specific names.
class CanvasInteractor {
  CanvasInteractor({
    required this.editor,
    required this.interaction,
    this.hitTester = const CanvasHitTester(),
  });

  final EditorController editor;
  final InteractionController interaction;
  final CanvasHitTester hitTester;

  CanvasDocument get _doc => editor.document;
  CameraState get _camera => _doc.camera;

  void onPointerHover(Point screen) {
    final world = screenToWorld(screen, _camera);
    final hit = hitTester.hitTest(_doc, world);
    interaction.update(
      (s) => s.copyWith(
        pointerScreen: screen,
        hoverElementId: hit?.id,
        clearHover: hit == null,
      ),
    );
  }

  void onPointerDown(Point screen, {bool isPrimary = true}) {
    if (!isPrimary) return;
    final world = screenToWorld(screen, _camera);
    final tool = editor.session.activeTool;

    if (tool == EditorTool.pan) {
      interaction.update(
        (s) => s.copyWith(
          gesture: GesturePanning(lastScreen: screen),
          pointerScreen: screen,
        ),
      );
      return;
    }

    // Select tool
    final hit = hitTester.hitTest(_doc, world);
    if (hit == null) {
      editor.clearSelection();
      interaction.update(
        (s) => s.copyWith(
          gesture: const GestureIdle(),
          pointerScreen: screen,
          clearHover: true,
        ),
      );
      return;
    }

    final alreadySelected = editor.session.selectedIds.contains(hit.id);
    if (!alreadySelected) {
      editor.selectSingle(hit.id);
    }

    if (hit.locked) {
      interaction.update((s) => s.copyWith(pointerScreen: screen));
      return;
    }

    final selected =
        alreadySelected ? editor.session.selectedIds : {hit.id};
    final origins = <String, Point>{};
    for (final id in selected) {
      final el = _doc.getElementById(id);
      if (el != null && !el.locked) {
        origins[id] = Point(el.x, el.y);
      }
    }

    interaction.update(
      (s) => s.copyWith(
        gesture: GestureDraggingElements(
          elementIds: origins.keys.toSet(),
          startWorld: world,
          currentWorld: world,
          originPositions: origins,
        ),
        pointerScreen: screen,
      ),
    );
  }

  void onPointerMove(Point screen) {
    final gesture = interaction.current.gesture;

    if (gesture is GesturePanning) {
      final dx = screen.x - gesture.lastScreen.x;
      final dy = screen.y - gesture.lastScreen.y;
      editor.setCamera(panBy(_camera, dx, dy));
      interaction.update(
        (s) => s.copyWith(
          gesture: GesturePanning(lastScreen: screen),
          pointerScreen: screen,
        ),
      );
      return;
    }

    if (gesture is GestureDraggingElements) {
      final world = screenToWorld(screen, _camera);
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.copyWithCurrent(world),
          pointerScreen: screen,
        ),
      );
      return;
    }

    onPointerHover(screen);
  }

  void onPointerUp(Point screen) {
    final gesture = interaction.current.gesture;

    if (gesture is GestureDraggingElements) {
      final world = screenToWorld(screen, _camera);
      final dx = world.x - gesture.startWorld.x;
      final dy = world.y - gesture.startWorld.y;
      final moves = <String, MoveDelta>{};
      for (final entry in gesture.originPositions.entries) {
        moves[entry.key] = MoveDelta(
          fromX: entry.value.x,
          fromY: entry.value.y,
          toX: entry.value.x + dx,
          toY: entry.value.y + dy,
        );
      }
      editor.commitMove(moves: moves);
      interaction.resetGesture();
      return;
    }

    if (gesture is GesturePanning) {
      interaction.resetGesture();
      return;
    }
  }

  void onPointerCancel() {
    interaction.resetGesture();
  }

  /// Zoom around the pointer (trackpad / mouse wheel).
  void onScrollZoom(Point screen, double scrollDeltaY) {
    final factor = scrollDeltaY < 0 ? 1.1 : 1 / 1.1;
    final next = zoomAtPoint(_camera, screen, _camera.zoom * factor);
    editor.setCamera(next);
  }

  /// Pan via screen-space delta (trackpad scroll, etc.).
  void panByScreenDelta(double dx, double dy) {
    editor.setCamera(panBy(_camera, dx, dy));
  }
}

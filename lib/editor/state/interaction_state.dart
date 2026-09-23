import 'package:equatable/equatable.dart';

import '../../core/canvas/geometry/point.dart';

/// High-frequency pointer / gesture state — not part of CanvasDocument.
sealed class GestureState extends Equatable {
  const GestureState();

  @override
  List<Object?> get props => [];
}

class GestureIdle extends GestureState {
  const GestureIdle();
}

class GesturePanning extends GestureState {
  const GesturePanning({required this.lastScreen});

  final Point lastScreen;

  @override
  List<Object?> get props => [lastScreen];
}

/// Dragging selected elements; live positions apply as an overlay until commit.
class GestureDraggingElements extends GestureState {
  const GestureDraggingElements({
    required this.elementIds,
    required this.startWorld,
    required this.currentWorld,
    required this.originPositions,
  });

  final Set<String> elementIds;
  final Point startWorld;
  final Point currentWorld;

  /// elementId → original (x, y) when the drag began.
  final Map<String, Point> originPositions;

  double get dx => currentWorld.x - startWorld.x;
  double get dy => currentWorld.y - startWorld.y;

  GestureDraggingElements copyWithCurrent(Point currentWorld) {
    return GestureDraggingElements(
      elementIds: elementIds,
      startWorld: startWorld,
      currentWorld: currentWorld,
      originPositions: originPositions,
    );
  }

  @override
  List<Object?> get props =>
      [elementIds, startWorld, currentWorld, originPositions];
}

/// Transient interaction state kept separate from the persistent document.
class InteractionState extends Equatable {
  const InteractionState({
    this.gesture = const GestureIdle(),
    this.hoverElementId,
    this.pointerScreen,
  });

  final GestureState gesture;
  final String? hoverElementId;
  final Point? pointerScreen;

  InteractionState copyWith({
    GestureState? gesture,
    String? hoverElementId,
    Point? pointerScreen,
    bool clearHover = false,
    bool clearPointer = false,
  }) {
    return InteractionState(
      gesture: gesture ?? this.gesture,
      hoverElementId:
          clearHover ? null : (hoverElementId ?? this.hoverElementId),
      pointerScreen:
          clearPointer ? null : (pointerScreen ?? this.pointerScreen),
    );
  }

  @override
  List<Object?> get props => [gesture, hoverElementId, pointerScreen];
}

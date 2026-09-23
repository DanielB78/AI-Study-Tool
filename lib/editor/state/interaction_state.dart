import 'package:equatable/equatable.dart';

import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/geometry/rect.dart';
import '../../core/canvas/models/canvas_element.dart';

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

class GestureMarqueeSelect extends GestureState {
  const GestureMarqueeSelect({
    required this.startWorld,
    required this.currentWorld,
  });

  final Point startWorld;
  final Point currentWorld;

  Rect2 get rect => Rect2.fromPoints(startWorld, currentWorld);

  GestureMarqueeSelect copyWithCurrent(Point currentWorld) {
    return GestureMarqueeSelect(
      startWorld: startWorld,
      currentWorld: currentWorld,
    );
  }

  @override
  List<Object?> get props => [startWorld, currentWorld];
}

class GestureCreatingShape extends GestureState {
  const GestureCreatingShape({
    required this.kind,
    required this.startWorld,
    required this.currentWorld,
    this.proportional = false,
  });

  final ShapeKind kind;
  final Point startWorld;
  final Point currentWorld;
  final bool proportional;

  Rect2 get rect {
    final raw = Rect2.fromPoints(startWorld, currentWorld);
    if (!proportional) return raw;
    final size = raw.width > raw.height ? raw.width : raw.height;
    final dx = currentWorld.x >= startWorld.x ? size : -size;
    final dy = currentWorld.y >= startWorld.y ? size : -size;
    return Rect2.fromPoints(
      startWorld,
      Point(startWorld.x + dx, startWorld.y + dy),
    );
  }

  GestureCreatingShape copyWith({
    Point? currentWorld,
    bool? proportional,
  }) {
    return GestureCreatingShape(
      kind: kind,
      startWorld: startWorld,
      currentWorld: currentWorld ?? this.currentWorld,
      proportional: proportional ?? this.proportional,
    );
  }

  @override
  List<Object?> get props => [kind, startWorld, currentWorld, proportional];
}

class GestureCreatingConnector extends GestureState {
  const GestureCreatingConnector({
    required this.kind,
    required this.startWorld,
    required this.currentWorld,
  });

  final ConnectorKind kind;
  final Point startWorld;
  final Point currentWorld;

  GestureCreatingConnector copyWithCurrent(Point currentWorld) {
    return GestureCreatingConnector(
      kind: kind,
      startWorld: startWorld,
      currentWorld: currentWorld,
    );
  }

  @override
  List<Object?> get props => [kind, startWorld, currentWorld];
}

class GestureDrawingStroke extends GestureState {
  const GestureDrawingStroke({required this.points});

  /// Absolute world points flattened.
  final List<double> points;

  GestureDrawingStroke append(Point p) {
    return GestureDrawingStroke(points: [...points, p.x, p.y]);
  }

  @override
  List<Object?> get props => [points];
}

enum TransformHandle {
  topLeft,
  top,
  topRight,
  right,
  bottomRight,
  bottom,
  bottomLeft,
  left,
  rotate,
}

class GestureTransforming extends GestureState {
  const GestureTransforming({
    required this.elementId,
    required this.handle,
    required this.startWorld,
    required this.currentWorld,
    required this.originBounds,
    required this.originRotation,
  });

  final String elementId;
  final TransformHandle handle;
  final Point startWorld;
  final Point currentWorld;
  final Rect2 originBounds;
  final double originRotation;

  GestureTransforming copyWithCurrent(Point currentWorld) {
    return GestureTransforming(
      elementId: elementId,
      handle: handle,
      startWorld: startWorld,
      currentWorld: currentWorld,
      originBounds: originBounds,
      originRotation: originRotation,
    );
  }

  @override
  List<Object?> get props =>
      [elementId, handle, startWorld, currentWorld, originBounds, originRotation];
}

/// Transient interaction state kept separate from the persistent document.
class InteractionState extends Equatable {
  const InteractionState({
    this.gesture = const GestureIdle(),
    this.hoverElementId,
    this.pointerScreen,
    this.editingTextId,
    this.editingShapeLabelId,
    this.spacePanHeld = false,
    this.alignmentGuides = const [],
  });

  final GestureState gesture;
  final String? hoverElementId;
  final Point? pointerScreen;

  /// When non-null, a TextElement is being edited in an overlay.
  final String? editingTextId;

  /// When non-null, a ShapeElement label is being edited.
  final String? editingShapeLabelId;

  /// Spacebar temporary pan.
  final bool spacePanHeld;

  /// Transient snap guides (world-space lines).
  final List<AlignmentGuide> alignmentGuides;

  bool get isEditingText =>
      editingTextId != null || editingShapeLabelId != null;

  InteractionState copyWith({
    GestureState? gesture,
    String? hoverElementId,
    Point? pointerScreen,
    String? editingTextId,
    String? editingShapeLabelId,
    bool? spacePanHeld,
    List<AlignmentGuide>? alignmentGuides,
    bool clearHover = false,
    bool clearPointer = false,
    bool clearEditingText = false,
    bool clearEditingShapeLabel = false,
    bool clearGuides = false,
  }) {
    return InteractionState(
      gesture: gesture ?? this.gesture,
      hoverElementId:
          clearHover ? null : (hoverElementId ?? this.hoverElementId),
      pointerScreen:
          clearPointer ? null : (pointerScreen ?? this.pointerScreen),
      editingTextId:
          clearEditingText ? null : (editingTextId ?? this.editingTextId),
      editingShapeLabelId: clearEditingShapeLabel
          ? null
          : (editingShapeLabelId ?? this.editingShapeLabelId),
      spacePanHeld: spacePanHeld ?? this.spacePanHeld,
      alignmentGuides:
          clearGuides ? const [] : (alignmentGuides ?? this.alignmentGuides),
    );
  }

  @override
  List<Object?> get props => [
        gesture,
        hoverElementId,
        pointerScreen,
        editingTextId,
        editingShapeLabelId,
        spacePanHeld,
        alignmentGuides,
      ];
}

enum GuideOrientation { horizontal, vertical }

class AlignmentGuide extends Equatable {
  const AlignmentGuide({
    required this.orientation,
    required this.position,
  });

  final GuideOrientation orientation;

  /// X for vertical, Y for horizontal (world).
  final double position;

  @override
  List<Object?> get props => [orientation, position];
}

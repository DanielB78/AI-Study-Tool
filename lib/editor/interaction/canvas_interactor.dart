import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/geometry/rect.dart';
import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../../core/commands/document_commands.dart';
import '../controller/editor_controller.dart';
import '../defaults/tool_defaults.dart';
import '../geometry/transform_handles.dart';
import '../hit_testing/canvas_hit_tester.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';

/// Pointer-agnostic interaction handling for the canvas.
class CanvasInteractor {
  CanvasInteractor({
    required this.editor,
    required this.interaction,
    this.hitTester = const CanvasHitTester(),
    this.handleTester = const TransformHandleHitTester(),
  });

  final EditorController editor;
  final InteractionController interaction;
  final CanvasHitTester hitTester;
  final TransformHandleHitTester handleTester;

  CanvasDocument get _doc => editor.document;
  CameraState get _camera => _doc.camera;
  ToolDefaults get _defaults => editor.defaults;

  void onPointerHover(Point screen) {
    if (interaction.current.isEditingText) return;
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

  void onPointerDown(
    Point screen, {
    bool isPrimary = true,
    bool shiftKey = false,
    bool proportional = false,
  }) {
    if (!isPrimary) return;
    if (interaction.current.isEditingText) {
      // Click outside commits — handled by overlay; ignore canvas down.
      return;
    }

    final world = screenToWorld(screen, _camera);
    final tool = editor.session.activeTool;
    final spacePan = interaction.current.spacePanHeld;

    if (tool == EditorTool.pan || spacePan) {
      interaction.update(
        (s) => s.copyWith(
          gesture: GesturePanning(lastScreen: screen),
          pointerScreen: screen,
        ),
      );
      return;
    }

    switch (tool) {
      case EditorTool.select:
        _onSelectDown(world, screen, shiftKey: shiftKey);
      case EditorTool.text:
        _onTextDown(world);
      case EditorTool.shape:
        interaction.update(
          (s) => s.copyWith(
            gesture: GestureCreatingShape(
              kind: _defaults.shapeKind,
              startWorld: world,
              currentWorld: world,
              proportional: proportional,
            ),
            pointerScreen: screen,
          ),
        );
      case EditorTool.pen:
        interaction.update(
          (s) => s.copyWith(
            gesture: GestureDrawingStroke(points: [world.x, world.y]),
            pointerScreen: screen,
          ),
        );
      case EditorTool.line:
        interaction.update(
          (s) => s.copyWith(
            gesture: GestureCreatingConnector(
              kind: ConnectorKind.line,
              startWorld: world,
              currentWorld: world,
            ),
            pointerScreen: screen,
          ),
        );
      case EditorTool.arrow:
        interaction.update(
          (s) => s.copyWith(
            gesture: GestureCreatingConnector(
              kind: ConnectorKind.arrow,
              startWorld: world,
              currentWorld: world,
            ),
            pointerScreen: screen,
          ),
        );
      case EditorTool.image:
        // Image tool opens file picker from UI; click is a no-op.
        break;
      case EditorTool.pan:
        break;
    }
  }

  void _onSelectDown(Point world, Point screen, {required bool shiftKey}) {
    // Transform handles for single selection.
    if (editor.session.selectedIds.length == 1) {
      final id = editor.session.selectedIds.first;
      final el = _doc.getElementById(id);
      if (el != null && !el.locked) {
        final handle = (el is DrawingElement || el is ConnectorElement)
            ? null
            : handleTester.hitTest(
                el.bounds,
                world,
                zoom: _camera.zoom,
              );
        if (handle != null) {
          interaction.update(
            (s) => s.copyWith(
              gesture: GestureTransforming(
                elementId: id,
                handle: handle,
                startWorld: world,
                currentWorld: world,
                originBounds: el.bounds,
                originRotation: el.rotation,
              ),
              pointerScreen: screen,
            ),
          );
          return;
        }
      }
    }

    final hit = hitTester.hitTest(_doc, world);
    if (hit == null) {
      if (!shiftKey) editor.clearSelection();
      interaction.update(
        (s) => s.copyWith(
          gesture: GestureMarqueeSelect(
            startWorld: world,
            currentWorld: world,
          ),
          pointerScreen: screen,
          clearHover: true,
        ),
      );
      return;
    }

    if (shiftKey) {
      editor.toggleSelection(hit.id);
    } else if (!editor.session.selectedIds.contains(hit.id)) {
      editor.selectSingle(hit.id);
    }

    if (hit.locked) {
      interaction.update((s) => s.copyWith(pointerScreen: screen));
      return;
    }

    final selected = editor.session.selectedIds.contains(hit.id)
        ? editor.session.selectedIds
        : {hit.id};
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

  void _onTextDown(Point world) {
    final text = TextElement.create(
      x: world.x,
      y: world.y,
      width: 220,
      height: 48,
      zIndex: _doc.nextZIndex,
      fontFamily: _defaults.textFontFamily,
      fontSize: _defaults.textFontSize,
      fontWeight: _defaults.textFontWeight,
      italic: _defaults.textItalic,
      underline: _defaults.textUnderline,
      strikethrough: _defaults.textStrikethrough,
      textColor: _defaults.textColor,
      backgroundColor: _defaults.textBackgroundColor,
      textAlign: _defaults.textAlign,
    );
    editor.createElement(text);
    interaction.beginTextEdit(text.id);
    editor.setTool(EditorTool.select);
  }

  void onPointerMove(
    Point screen, {
    bool proportional = false,
  }) {
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

    final world = screenToWorld(screen, _camera);

    if (gesture is GestureDraggingElements) {
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.copyWithCurrent(world),
          pointerScreen: screen,
          alignmentGuides: _computeGuides(gesture, world),
        ),
      );
      return;
    }

    if (gesture is GestureMarqueeSelect) {
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.copyWithCurrent(world),
          pointerScreen: screen,
        ),
      );
      return;
    }

    if (gesture is GestureCreatingShape) {
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.copyWith(
            currentWorld: world,
            proportional: proportional,
          ),
          pointerScreen: screen,
        ),
      );
      return;
    }

    if (gesture is GestureCreatingConnector) {
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.copyWithCurrent(world),
          pointerScreen: screen,
        ),
      );
      return;
    }

    if (gesture is GestureDrawingStroke) {
      final pts = gesture.points;
      if (pts.length >= 2) {
        final lx = pts[pts.length - 2];
        final ly = pts[pts.length - 1];
        final dx = world.x - lx;
        final dy = world.y - ly;
        if (dx * dx + dy * dy < 1.5) {
          interaction.update((s) => s.copyWith(pointerScreen: screen));
          return;
        }
      }
      interaction.update(
        (s) => s.copyWith(
          gesture: gesture.append(world),
          pointerScreen: screen,
        ),
      );
      return;
    }

    if (gesture is GestureTransforming) {
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
    final world = screenToWorld(screen, _camera);

    if (gesture is GestureDraggingElements) {
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

    if (gesture is GestureMarqueeSelect) {
      final hits = hitTester.hitTestRect(_doc, gesture.rect);
      editor.select(hits.map((e) => e.id).toSet());
      interaction.resetGesture();
      return;
    }

    if (gesture is GestureCreatingShape) {
      final rect = gesture.rect;
      if (rect.width >= 4 && rect.height >= 4) {
        final shape = ShapeElement.create(
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          shapeKind: gesture.kind,
          fill: _defaults.shapeFill,
          stroke: _defaults.shapeStroke,
          strokeWidth: _defaults.shapeStrokeWidth,
          strokeStyle: _defaults.shapeStrokeStyle,
          cornerRadius: _defaults.shapeCornerRadius,
          zIndex: _doc.nextZIndex,
        ).copyWithBase(opacity: _defaults.shapeOpacity);
        editor.createElement(shape);
      }
      interaction.resetGesture();
      editor.setTool(EditorTool.select);
      return;
    }

    if (gesture is GestureCreatingConnector) {
      final dx = gesture.currentWorld.x - gesture.startWorld.x;
      final dy = gesture.currentWorld.y - gesture.startWorld.y;
      if (dx * dx + dy * dy >= 16) {
        final isArrow = gesture.kind == ConnectorKind.arrow;
        final connector = ConnectorElement.create(
          startX: gesture.startWorld.x,
          startY: gesture.startWorld.y,
          endX: gesture.currentWorld.x,
          endY: gesture.currentWorld.y,
          stroke: isArrow ? _defaults.arrowColor : _defaults.lineColor,
          strokeWidth: isArrow ? _defaults.arrowWidth : _defaults.lineWidth,
          strokeStyle:
              isArrow ? _defaults.arrowStrokeStyle : _defaults.lineStrokeStyle,
          connectorKind: gesture.kind,
          arrowHeads: isArrow ? _defaults.arrowHeads : ArrowHeads.none,
          zIndex: _doc.nextZIndex,
        );
        editor.createElement(connector);
      }
      interaction.resetGesture();
      editor.setTool(EditorTool.select);
      return;
    }

    if (gesture is GestureDrawingStroke) {
      if (gesture.points.length >= 4) {
        final drawing = DrawingElement.fromPoints(
          absolutePoints: gesture.points,
          color: _defaults.penColor,
          strokeWidth: _defaults.penWidth,
          zIndex: _doc.nextZIndex,
        ).copyWithBase(opacity: _defaults.penOpacity);
        editor.createElement(drawing);
      }
      interaction.resetGesture();
      return;
    }

    if (gesture is GestureTransforming) {
      _commitTransform(gesture, world);
      interaction.resetGesture();
      return;
    }

    if (gesture is GesturePanning) {
      interaction.resetGesture();
    }
  }

  void _commitTransform(GestureTransforming gesture, Point world) {
    final el = _doc.getElementById(gesture.elementId);
    if (el == null || el.locked) return;
    // Path-based elements are moved, not box-resized.
    if (el is DrawingElement || el is ConnectorElement) return;

    if (gesture.handle == TransformHandle.rotate) {
      final rot = applyRotation(origin: gesture.originBounds, current: world);
      editor.commitUpdate(
        el,
        el.copyWithBase(rotation: rot, updatedAt: DateTime.now().toUtc()),
      );
      return;
    }

    final keepAspect = el is ImageElement;
    final rect = applyResize(
      origin: gesture.originBounds,
      handle: gesture.handle,
      current: world,
      keepAspect: keepAspect,
    );

    // Text: resize box (don't scale glyphs). Shapes/images update AABB.
    final after = el.copyWithBase(
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      updatedAt: DateTime.now().toUtc(),
    );
    editor.commitUpdate(el, after);
  }

  void onPointerCancel() {
    interaction.resetGesture();
  }

  void onDoubleTap(Point screen) {
    final world = screenToWorld(screen, _camera);
    final hit = hitTester.hitTest(_doc, world);
    if (hit == null || hit.locked) return;
    if (hit is TextElement) {
      editor.selectSingle(hit.id);
      interaction.beginTextEdit(hit.id);
    } else if (hit is ShapeElement) {
      editor.selectSingle(hit.id);
      interaction.beginShapeLabelEdit(hit.id);
    }
  }

  void onScrollZoom(Point screen, double scrollDeltaY) {
    final factor = scrollDeltaY < 0 ? 1.1 : 1 / 1.1;
    editor.setCamera(zoomAtPoint(_camera, screen, _camera.zoom * factor));
  }

  void panByScreenDelta(double dx, double dy) {
    editor.setCamera(panBy(_camera, dx, dy));
  }

  void cancelOrEscape() {
    final g = interaction.current.gesture;
    if (g is! GestureIdle) {
      interaction.resetGesture();
      return;
    }
    if (interaction.current.isEditingText) {
      interaction.endEditing();
      return;
    }
    if (editor.session.shapesPopoverOpen) {
      editor.setShapesPopoverOpen(false);
      return;
    }
    editor.clearSelection();
  }

  List<AlignmentGuide> _computeGuides(
    GestureDraggingElements gesture,
    Point world,
  ) {
    // Lightweight guides: snap to other element edges within threshold.
    const threshold = 6.0;
    final dx = world.x - gesture.startWorld.x;
    final dy = world.y - gesture.startWorld.y;
    final guides = <AlignmentGuide>[];
    if (gesture.originPositions.isEmpty) return guides;

    final primaryId = gesture.elementIds.first;
    final origin = gesture.originPositions[primaryId];
    final el = _doc.getElementById(primaryId);
    if (origin == null || el == null) return guides;

    final moving = Rect2(
      x: origin.x + dx,
      y: origin.y + dy,
      width: el.width,
      height: el.height,
    );

    for (final other in _doc.elementsInZOrder) {
      if (gesture.elementIds.contains(other.id)) continue;
      final b = other.bounds;
      for (final pair in [
        (moving.left, b.left),
        (moving.right, b.right),
        (moving.left, b.right),
        (moving.right, b.left),
        (moving.center.x, b.center.x),
      ]) {
        if ((pair.$1 - pair.$2).abs() <= threshold) {
          guides.add(AlignmentGuide(
            orientation: GuideOrientation.vertical,
            position: pair.$2,
          ));
        }
      }
      for (final pair in [
        (moving.top, b.top),
        (moving.bottom, b.bottom),
        (moving.top, b.bottom),
        (moving.bottom, b.top),
        (moving.center.y, b.center.y),
      ]) {
        if ((pair.$1 - pair.$2).abs() <= threshold) {
          guides.add(AlignmentGuide(
            orientation: GuideOrientation.horizontal,
            position: pair.$2,
          ));
        }
      }
    }
    return guides;
  }
}

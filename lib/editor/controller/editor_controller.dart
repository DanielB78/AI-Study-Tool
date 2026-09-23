import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/geometry/point.dart';
import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../../core/canvas/models/ids.dart';
import '../../core/commands/document_commands.dart';
import '../../core/commands/editor_command.dart';
import '../defaults/tool_defaults.dart';
import '../hit_testing/canvas_hit_tester.dart';
import '../state/editor_state.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';

/// Owns document mutations via the command system + session selection/tool.
class EditorController extends Notifier<EditorState> {
  final CanvasHitTester hitTester = const CanvasHitTester();

  /// Clipboard for copy/paste (element snapshots).
  List<CanvasElement> clipboard = [];

  @override
  EditorState build() {
    return EditorState(document: CanvasDocument.withDemoShape());
  }

  EditorState get session => state;
  CanvasDocument get document => state.document;
  ToolDefaults get defaults => state.defaults;

  // --- Session ---

  void setTool(EditorTool tool) {
    state = state.copyWith(
      activeTool: tool,
      shapesPopoverOpen: tool == EditorTool.shape ? state.shapesPopoverOpen : false,
    );
  }

  void setShapesPopoverOpen(bool open) {
    state = state.copyWith(shapesPopoverOpen: open);
  }

  void selectShapeKind(ShapeKind kind) {
    state = state.copyWith(
      defaults: defaults.copyWith(shapeKind: kind),
      activeTool: EditorTool.shape,
      shapesPopoverOpen: false,
    );
  }

  void updateDefaults(ToolDefaults next) {
    state = state.copyWith(defaults: next);
  }

  void select(Set<String> ids) {
    final valid = ids.where(document.elementsById.containsKey).toSet();
    state = state.copyWith(selectedIds: valid);
  }

  void selectSingle(String? id) {
    if (id == null) {
      clearSelection();
      return;
    }
    select({id});
  }

  void clearSelection() {
    state = state.copyWith(selectedIds: const {});
  }

  void toggleSelection(String id) {
    final next = Set<String>.from(state.selectedIds);
    if (next.contains(id)) {
      next.remove(id);
    } else {
      next.add(id);
    }
    select(next);
  }

  void addToSelection(String id) {
    select({...state.selectedIds, id});
  }

  // --- Camera ---

  void setCamera(CameraState camera) {
    state = state.copyWith(document: document.withCamera(camera));
  }

  // --- Commands ---

  void dispatch(EditorCommand command) {
    final nextDoc = command.execute(document);
    state.history.push(command);
    var nextSelection = state.selectedIds;
    if (command is DeleteElementCommand) {
      nextSelection = Set<String>.from(nextSelection)..remove(command.element.id);
    } else if (command is DeleteElementsCommand) {
      final removed = command.elements.map((e) => e.id).toSet();
      nextSelection =
          nextSelection.where((id) => !removed.contains(id)).toSet();
    }
    nextSelection =
        nextSelection.where(nextDoc.elementsById.containsKey).toSet();
    state = state.copyWith(document: nextDoc, selectedIds: nextSelection);
  }

  void dispatchTransaction(CommandTransaction transaction) {
    final command = transaction.build();
    if (command == null) return;
    dispatch(command);
  }

  void undo() {
    final command = state.history.popUndo();
    if (command == null) return;
    final nextDoc = command.undo(document);
    final nextSelection =
        state.selectedIds.where(nextDoc.elementsById.containsKey).toSet();
    state = state.copyWith(document: nextDoc, selectedIds: nextSelection);
  }

  void redo() {
    final command = state.history.popRedo();
    if (command == null) return;
    final nextDoc = command.execute(document);
    final nextSelection =
        state.selectedIds.where(nextDoc.elementsById.containsKey).toSet();
    state = state.copyWith(document: nextDoc, selectedIds: nextSelection);
  }

  void createElement(CanvasElement element, {bool selectCreated = true}) {
    dispatch(CreateElementCommand(element));
    if (selectCreated) selectSingle(element.id);
  }

  void deleteSelection() {
    final ids = state.selectedIds;
    if (ids.isEmpty) return;
    final snapshots = <CanvasElement>[];
    for (final id in ids) {
      final el = document.getElementById(id);
      if (el != null && !el.locked) snapshots.add(el);
    }
    if (snapshots.isEmpty) return;
    dispatch(DeleteElementsCommand(snapshots));
  }

  void commitMove({required Map<String, MoveDelta> moves}) {
    final meaningful = Map.fromEntries(
      moves.entries.where((e) => !e.value.isZero),
    );
    if (meaningful.isEmpty) return;
    dispatch(MoveElementsCommand(meaningful));
  }

  void commitUpdate(CanvasElement before, CanvasElement after) {
    if (before == after) return;
    dispatch(UpdateElementCommand(before: before, after: after));
  }

  void commitUpdates(List<CanvasElement> before, List<CanvasElement> after) {
    if (before.isEmpty) return;
    dispatch(UpdateElementsCommand(before: before, after: after));
  }

  /// Update selected elements' shared properties via a mapper; one undo step.
  void updateSelected(CanvasElement Function(CanvasElement el) map) {
    final before = <CanvasElement>[];
    final after = <CanvasElement>[];
    for (final id in state.selectedIds) {
      final el = document.getElementById(id);
      if (el == null || el.locked) continue;
      before.add(el);
      after.add(map(el));
    }
    if (after.isEmpty) return;
    commitUpdates(before, after);
  }

  void copySelection() {
    final items = <CanvasElement>[];
    for (final id in state.selectedIds) {
      final el = document.getElementById(id);
      if (el != null) items.add(el);
    }
    clipboard = items;
  }

  void pasteClipboard({double offset = 24}) {
    if (clipboard.isEmpty) return;
    final created = <CanvasElement>[];
    for (final el in clipboard) {
      created.add(el.duplicate(newId: generateId(), dx: offset, dy: offset));
    }
    dispatch(CreateElementsCommand(created));
    select(created.map((e) => e.id).toSet());
    // Offset clipboard so repeated paste keeps shifting.
    clipboard = [
      for (final el in clipboard)
        el.duplicate(newId: el.id, dx: offset, dy: offset),
    ];
  }

  void duplicateSelection({double offset = 24}) {
    final ids = state.selectedIds.toList();
    if (ids.isEmpty) return;
    final created = <CanvasElement>[];
    for (final id in ids) {
      final el = document.getElementById(id);
      if (el == null) continue;
      created.add(el.duplicate(newId: generateId(), dx: offset, dy: offset));
    }
    if (created.isEmpty) return;
    dispatch(CreateElementsCommand(created));
    select(created.map((e) => e.id).toSet());
  }

  void bringToFront() {
    _reorderSelected((order, id) {
      order.remove(id);
      order.add(id);
    });
  }

  void sendToBack() {
    _reorderSelected((order, id) {
      order.remove(id);
      order.insert(0, id);
    });
  }

  void bringForward() {
    _reorderSelected((order, id) {
      final i = order.indexOf(id);
      if (i < 0 || i >= order.length - 1) return;
      order.removeAt(i);
      order.insert(i + 1, id);
    });
  }

  void sendBackward() {
    _reorderSelected((order, id) {
      final i = order.indexOf(id);
      if (i <= 0) return;
      order.removeAt(i);
      order.insert(i - 1, id);
    });
  }

  void _reorderSelected(void Function(List<String> order, String id) mutate) {
    if (state.selectedIds.isEmpty) return;
    final beforeOrder = List<String>.from(document.zOrder);
    final afterOrder = List<String>.from(document.zOrder);
    for (final id in state.selectedIds) {
      mutate(afterOrder, id);
    }
    if (listEquals(beforeOrder, afterOrder)) return;
    final beforeEls = <String, CanvasElement>{};
    final afterEls = <String, CanvasElement>{};
    for (var i = 0; i < afterOrder.length; i++) {
      final id = afterOrder[i];
      final el = document.getElementById(id);
      if (el == null) continue;
      beforeEls[id] = el;
      afterEls[id] = el.copyWithBase(
        zIndex: i,
        updatedAt: DateTime.now().toUtc(),
      );
    }
    dispatch(ReorderElementsCommand(
      beforeOrder: beforeOrder,
      afterOrder: afterOrder,
      beforeElements: beforeEls,
      afterElements: afterEls,
    ));
  }

  void toggleLockSelection() {
    updateSelected((el) => el.copyWithBase(
          locked: !el.locked,
          updatedAt: DateTime.now().toUtc(),
        ));
  }

  void alignSelection(AlignMode mode) {
    final els = _selectedUnlocked();
    if (els.length < 2) return;
    final bounds = els.map((e) => e.bounds).toList();
    late double target;
    switch (mode) {
      case AlignMode.left:
        target = bounds.map((b) => b.left).reduce((a, b) => a < b ? a : b);
      case AlignMode.right:
        target = bounds.map((b) => b.right).reduce((a, b) => a > b ? a : b);
      case AlignMode.top:
        target = bounds.map((b) => b.top).reduce((a, b) => a < b ? a : b);
      case AlignMode.bottom:
        target = bounds.map((b) => b.bottom).reduce((a, b) => a > b ? a : b);
      case AlignMode.centerH:
        final minL = bounds.map((b) => b.left).reduce((a, b) => a < b ? a : b);
        final maxR = bounds.map((b) => b.right).reduce((a, b) => a > b ? a : b);
        target = (minL + maxR) / 2;
      case AlignMode.centerV:
        final minT = bounds.map((b) => b.top).reduce((a, b) => a < b ? a : b);
        final maxB = bounds.map((b) => b.bottom).reduce((a, b) => a > b ? a : b);
        target = (minT + maxB) / 2;
    }

    final before = <CanvasElement>[];
    final after = <CanvasElement>[];
    for (final el in els) {
      before.add(el);
      double dx = 0, dy = 0;
      switch (mode) {
        case AlignMode.left:
          dx = target - el.x;
        case AlignMode.right:
          dx = target - (el.x + el.width);
        case AlignMode.centerH:
          dx = target - (el.x + el.width / 2);
        case AlignMode.top:
          dy = target - el.y;
        case AlignMode.bottom:
          dy = target - (el.y + el.height);
        case AlignMode.centerV:
          dy = target - (el.y + el.height / 2);
      }
      after.add(_nudge(el, dx, dy));
    }
    commitUpdates(before, after);
  }

  void distributeSelection({required bool horizontal}) {
    final els = _selectedUnlocked()
      ..sort((a, b) => horizontal ? a.x.compareTo(b.x) : a.y.compareTo(b.y));
    if (els.length < 3) return;

    final before = List<CanvasElement>.from(els);
    final after = <CanvasElement>[];
    if (horizontal) {
      final minL = els.first.x;
      final maxR = els.last.x + els.last.width;
      final totalW = els.fold<double>(0, (s, e) => s + e.width);
      final gap = (maxR - minL - totalW) / (els.length - 1);
      var cursor = minL;
      for (final el in els) {
        after.add(_nudge(el, cursor - el.x, 0));
        cursor += el.width + gap;
      }
    } else {
      final minT = els.first.y;
      final maxB = els.last.y + els.last.height;
      final totalH = els.fold<double>(0, (s, e) => s + e.height);
      final gap = (maxB - minT - totalH) / (els.length - 1);
      var cursor = minT;
      for (final el in els) {
        after.add(_nudge(el, 0, cursor - el.y));
        cursor += el.height + gap;
      }
    }
    commitUpdates(before, after);
  }

  List<CanvasElement> _selectedUnlocked() {
    final out = <CanvasElement>[];
    for (final id in state.selectedIds) {
      final el = document.getElementById(id);
      if (el != null && !el.locked) out.add(el);
    }
    return out;
  }

  CanvasElement _nudge(CanvasElement el, double dx, double dy) {
    if (dx == 0 && dy == 0) return el;
    return switch (el) {
      DrawingElement() => el.movedBy(dx, dy),
      ConnectorElement() => el.movedBy(dx, dy),
      _ => el.copyWithBase(
          x: el.x + dx,
          y: el.y + dy,
          updatedAt: DateTime.now().toUtc(),
        ),
    };
  }

  /// Viewport-centred world point for placing images etc.
  Point viewportCenterWorld(SizeLike viewport) {
    final cam = document.camera;
    return screenToWorld(
      Point(viewport.width / 2, viewport.height / 2),
      cam,
    );
  }

  CanvasElement? getElementById(String id) => document.getElementById(id);

  List<CanvasElement> getElementsByType(CanvasElementType type) =>
      document.getElementsByType(type);
}

/// Lightweight size to avoid importing Flutter in pure logic if desired.
class SizeLike {
  const SizeLike(this.width, this.height);
  final double width;
  final double height;
}

enum AlignMode { left, centerH, right, top, centerV, bottom }

bool listEquals<T>(List<T> a, List<T> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

final editorControllerProvider =
    NotifierProvider<EditorController, EditorState>(EditorController.new);

class InteractionController extends Notifier<InteractionState> {
  @override
  InteractionState build() => const InteractionState();

  InteractionState get current => state;

  void set(InteractionState next) => state = next;

  void update(InteractionState Function(InteractionState current) fn) {
    state = fn(state);
  }

  void resetGesture() {
    state = state.copyWith(gesture: const GestureIdle(), clearGuides: true);
  }

  void clear() => state = const InteractionState();

  void beginTextEdit(String id) {
    state = state.copyWith(editingTextId: id, clearEditingShapeLabel: true);
  }

  void beginShapeLabelEdit(String id) {
    state = state.copyWith(editingShapeLabelId: id, clearEditingText: true);
  }

  void endEditing() {
    state = state.copyWith(
      clearEditingText: true,
      clearEditingShapeLabel: true,
    );
  }
}

final interactionControllerProvider =
    NotifierProvider<InteractionController, InteractionState>(
  InteractionController.new,
);

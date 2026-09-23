import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_document.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../../core/commands/document_commands.dart';
import '../../core/commands/editor_command.dart';
import '../hit_testing/canvas_hit_tester.dart';
import '../state/editor_state.dart';
import '../state/editor_tool.dart';
import '../state/interaction_state.dart';

/// Owns document mutations via the command system + session selection/tool.
class EditorController extends Notifier<EditorState> {
  final CanvasHitTester hitTester = const CanvasHitTester();

  @override
  EditorState build() {
    return EditorState(document: CanvasDocument.withDemoShape());
  }

  /// Public read of session state for collaborators (e.g. [CanvasInteractor]).
  EditorState get session => state;

  CanvasDocument get document => state.document;

  // --- Session ---

  void setTool(EditorTool tool) {
    if (!tool.isImplemented) return;
    state = state.copyWith(activeTool: tool);
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

  // --- Camera (not undoable) ---

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
    // Drop selection for IDs that no longer exist.
    nextSelection =
        nextSelection.where(nextDoc.elementsById.containsKey).toSet();
    state = state.copyWith(
      document: nextDoc,
      selectedIds: nextSelection,
    );
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

  void createElement(CanvasElement element) {
    dispatch(CreateElementCommand(element));
  }

  void deleteSelection() {
    final ids = state.selectedIds;
    if (ids.isEmpty) return;
    final snapshots = <CanvasElement>[];
    for (final id in ids) {
      final el = document.getElementById(id);
      if (el != null && !el.locked) {
        snapshots.add(el);
      }
    }
    if (snapshots.isEmpty) return;
    dispatch(DeleteElementsCommand(snapshots));
  }

  void commitMove({
    required Map<String, MoveDelta> moves,
  }) {
    final meaningful = Map.fromEntries(
      moves.entries.where((e) => !e.value.isZero),
    );
    if (meaningful.isEmpty) return;
    dispatch(MoveElementsCommand(meaningful));
  }

  /// Query helpers for future AI / RAG (no UI coupling).
  CanvasElement? getElementById(String id) => document.getElementById(id);

  List<CanvasElement> getElementsByType(CanvasElementType type) =>
      document.getElementsByType(type);
}

final editorControllerProvider =
    NotifierProvider<EditorController, EditorState>(EditorController.new);

/// High-frequency pointer state — separate provider to limit rebuild scope.
class InteractionController extends Notifier<InteractionState> {
  @override
  InteractionState build() => const InteractionState();

  InteractionState get current => state;

  void set(InteractionState next) => state = next;

  void update(InteractionState Function(InteractionState current) fn) {
    state = fn(state);
  }

  void resetGesture() {
    state = state.copyWith(gesture: const GestureIdle());
  }

  void clear() => state = const InteractionState();
}

final interactionControllerProvider =
    NotifierProvider<InteractionController, InteractionState>(
  InteractionController.new,
);

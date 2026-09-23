import 'package:equatable/equatable.dart';

import '../../core/canvas/models/canvas_document.dart';
import '../../core/history/history_stack.dart';
import 'editor_tool.dart';

/// Persistent + session editor state (excluding high-frequency pointer noise).
class EditorState extends Equatable {
  EditorState({
    required this.document,
    Set<String>? selectedIds,
    this.activeTool = EditorTool.select,
    HistoryStack? history,
  })  : selectedIds = Set.unmodifiable(selectedIds ?? const {}),
        history = history ?? HistoryStack();

  final CanvasDocument document;
  final Set<String> selectedIds;
  final EditorTool activeTool;
  final HistoryStack history;

  bool get canUndo => history.canUndo;
  bool get canRedo => history.canRedo;

  String? get primarySelectedId =>
      selectedIds.isEmpty ? null : selectedIds.first;

  EditorState copyWith({
    CanvasDocument? document,
    Set<String>? selectedIds,
    EditorTool? activeTool,
    HistoryStack? history,
  }) {
    return EditorState(
      document: document ?? this.document,
      selectedIds: selectedIds ?? this.selectedIds,
      activeTool: activeTool ?? this.activeTool,
      history: history ?? this.history,
    );
  }

  @override
  List<Object?> get props =>
      [document, selectedIds, activeTool, history.canUndo, history.canRedo];
}

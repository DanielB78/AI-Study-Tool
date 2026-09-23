import 'package:equatable/equatable.dart';

import '../../core/canvas/models/canvas_document.dart';
import '../../core/history/history_stack.dart';
import '../defaults/tool_defaults.dart';
import 'editor_tool.dart';

/// Persistent + session editor state (excluding high-frequency pointer noise).
class EditorState extends Equatable {
  EditorState({
    required this.document,
    Set<String>? selectedIds,
    this.activeTool = EditorTool.select,
    HistoryStack? history,
    this.defaults = const ToolDefaults(),
    this.shapesPopoverOpen = false,
  })  : selectedIds = Set.unmodifiable(selectedIds ?? const {}),
        history = history ?? HistoryStack();

  final CanvasDocument document;
  final Set<String> selectedIds;
  final EditorTool activeTool;
  final HistoryStack history;
  final ToolDefaults defaults;
  final bool shapesPopoverOpen;

  bool get canUndo => history.canUndo;
  bool get canRedo => history.canRedo;

  String? get primarySelectedId =>
      selectedIds.isEmpty ? null : selectedIds.first;

  bool get hasMultipleSelection => selectedIds.length > 1;

  EditorState copyWith({
    CanvasDocument? document,
    Set<String>? selectedIds,
    EditorTool? activeTool,
    HistoryStack? history,
    ToolDefaults? defaults,
    bool? shapesPopoverOpen,
  }) {
    return EditorState(
      document: document ?? this.document,
      selectedIds: selectedIds ?? this.selectedIds,
      activeTool: activeTool ?? this.activeTool,
      history: history ?? this.history,
      defaults: defaults ?? this.defaults,
      shapesPopoverOpen: shapesPopoverOpen ?? this.shapesPopoverOpen,
    );
  }

  @override
  List<Object?> get props => [
        document,
        selectedIds,
        activeTool,
        history.canUndo,
        history.canRedo,
        defaults,
        shapesPopoverOpen,
      ];
}

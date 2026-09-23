import '../commands/editor_command.dart';

/// Undo/redo stack at the document-operation level.
///
/// Drag gestures should commit a single [EditorCommand], not per-move entries.
class HistoryStack {
  HistoryStack({this.maxDepth = 100});

  final int maxDepth;
  final List<EditorCommand> _undo = [];
  final List<EditorCommand> _redo = [];

  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;

  List<EditorCommand> get undoStack => List.unmodifiable(_undo);
  List<EditorCommand> get redoStack => List.unmodifiable(_redo);

  void push(EditorCommand command) {
    _undo.add(command);
    if (_undo.length > maxDepth) {
      _undo.removeAt(0);
    }
    _redo.clear();
  }

  EditorCommand? popUndo() {
    if (_undo.isEmpty) return null;
    final command = _undo.removeLast();
    _redo.add(command);
    return command;
  }

  EditorCommand? popRedo() {
    if (_redo.isEmpty) return null;
    final command = _redo.removeLast();
    _undo.add(command);
    return command;
  }

  void clear() {
    _undo.clear();
    _redo.clear();
  }
}

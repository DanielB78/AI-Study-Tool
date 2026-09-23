import '../canvas/models/canvas_document.dart';

/// A reversible mutation of [CanvasDocument].
///
/// UI and future AI systems both issue commands; they never mutate the
/// document directly. Compound/transactions group multiple commands into
/// one undoable history entry.
abstract class EditorCommand {
  String get label;

  CanvasDocument execute(CanvasDocument document);

  /// Inverse of [execute]. Must restore the prior document state when applied
  /// to the post-execute document.
  CanvasDocument undo(CanvasDocument document);
}

/// Groups multiple commands into a single undo/redo unit (e.g. future AI ops).
class CompoundCommand implements EditorCommand {
  CompoundCommand({
    required this.commands,
    this.label = 'Compound',
  }) : assert(commands.isNotEmpty, 'CompoundCommand requires at least one command');

  final List<EditorCommand> commands;

  @override
  final String label;

  @override
  CanvasDocument execute(CanvasDocument document) {
    var doc = document;
    for (final command in commands) {
      doc = command.execute(doc);
    }
    return doc;
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    var doc = document;
    for (final command in commands.reversed) {
      doc = command.undo(doc);
    }
    return doc;
  }
}

/// Convenience builder for transactional AI/user multi-step edits.
class CommandTransaction {
  CommandTransaction({this.label = 'Transaction'});

  final String label;
  final List<EditorCommand> _commands = [];

  void add(EditorCommand command) => _commands.add(command);

  bool get isEmpty => _commands.isEmpty;

  EditorCommand? build() {
    if (_commands.isEmpty) return null;
    if (_commands.length == 1) return _commands.first;
    return CompoundCommand(commands: List.unmodifiable(_commands), label: label);
  }
}

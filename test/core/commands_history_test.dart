import 'package:ai_study_tool/core/canvas/models/canvas_document.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_element.dart';
import 'package:ai_study_tool/core/commands/document_commands.dart';
import 'package:ai_study_tool/core/commands/editor_command.dart';
import 'package:ai_study_tool/core/history/history_stack.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('document commands + history', () {
    test('create element uses stable unique ids', () {
      final a = ShapeElement.create(x: 0, y: 0);
      final b = ShapeElement.create(x: 10, y: 10);
      expect(a.id, isNotEmpty);
      expect(a.id, isNot(b.id));
    });

    test('create / delete / undo / redo', () {
      var doc = CanvasDocument.empty();
      final history = HistoryStack();
      final shape = ShapeElement.create(x: 5, y: 5, width: 40, height: 30);

      final create = CreateElementCommand(shape);
      doc = create.execute(doc);
      history.push(create);
      expect(doc.getElementById(shape.id), isNotNull);

      final delete = DeleteElementCommand(shape);
      doc = delete.execute(doc);
      history.push(delete);
      expect(doc.getElementById(shape.id), isNull);

      final undone = history.popUndo()!;
      doc = undone.undo(doc);
      expect(doc.getElementById(shape.id), isNotNull);

      final redone = history.popRedo()!;
      doc = redone.execute(doc);
      expect(doc.getElementById(shape.id), isNull);
    });

    test('move is one history operation', () {
      final shape = ShapeElement.create(x: 0, y: 0);
      var doc = CanvasDocument.empty().upsertElement(shape);
      final history = HistoryStack();

      final move = MoveElementsCommand({
        shape.id: const MoveDelta(fromX: 0, fromY: 0, toX: 100, toY: 50),
      });
      doc = move.execute(doc);
      history.push(move);

      expect(doc.getElementById(shape.id)!.x, 100);
      expect(doc.getElementById(shape.id)!.y, 50);
      expect(history.undoStack, hasLength(1));

      doc = history.popUndo()!.undo(doc);
      expect(doc.getElementById(shape.id)!.x, 0);
      expect(doc.getElementById(shape.id)!.y, 0);
    });

    test('locked elements are not moved by MoveElementsCommand', () {
      final shape = ShapeElement.create(x: 0, y: 0, locked: true);
      var doc = CanvasDocument.empty().upsertElement(shape);
      final move = MoveElementsCommand({
        shape.id: const MoveDelta(fromX: 0, fromY: 0, toX: 40, toY: 40),
      });
      doc = move.execute(doc);
      expect(doc.getElementById(shape.id)!.x, 0);
      expect(doc.getElementById(shape.id)!.y, 0);
    });

    test('compound command undoes as one unit', () {
      final a = ShapeElement.create(x: 0, y: 0);
      final b = ShapeElement.create(x: 10, y: 10);
      var doc = CanvasDocument.empty();
      final history = HistoryStack();

      final compound = CompoundCommand(
        label: 'AI diagram',
        commands: [
          CreateElementCommand(a),
          CreateElementCommand(b),
        ],
      );
      doc = compound.execute(doc);
      history.push(compound);
      expect(doc.elementsById, hasLength(2));

      doc = history.popUndo()!.undo(doc);
      expect(doc.elementsById, isEmpty);
    });
  });
}

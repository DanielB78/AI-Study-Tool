import 'package:ai_study_tool/core/canvas/geometry/point.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_document.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_element.dart';
import 'package:ai_study_tool/core/canvas/models/ids.dart';
import 'package:ai_study_tool/core/commands/document_commands.dart';
import 'package:ai_study_tool/core/commands/editor_command.dart';
import 'package:ai_study_tool/core/history/history_stack.dart';
import 'package:ai_study_tool/core/serialization/canvas_document_codec.dart';
import 'package:ai_study_tool/editor/hit_testing/canvas_hit_tester.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('serialization v2', () {
    test('round-trips all element types with rich properties', () {
      final text = TextElement.create(
        x: 1,
        y: 2,
        text: 'hello\nworld',
        fontSize: 22,
        fontWeight: FontWeightKind.bold,
        italic: true,
        underline: true,
        textColor: '#FF0000',
        backgroundColor: '#FFFF00',
        textAlign: TextAlignment.center,
      );
      final shape = ShapeElement.create(
        x: 10,
        y: 20,
        shapeKind: ShapeKind.star,
        fill: '#00FF00',
        strokeStyle: StrokeStyle.dashed,
        label: 'Node',
      );
      final drawing = DrawingElement.fromPoints(
        absolutePoints: [0, 0, 10, 10, 20, 5],
        color: '#0000FF',
        strokeWidth: 4,
      );
      final image = ImageElement.create(
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        src: '/tmp/a.png',
        naturalWidth: 200,
        naturalHeight: 160,
      );
      final connector = ConnectorElement.create(
        startX: 0,
        startY: 0,
        endX: 50,
        endY: 50,
        connectorKind: ConnectorKind.arrow,
        arrowHeads: ArrowHeads.both,
        startBindingId: shape.id,
        endBindingId: text.id,
      );

      var doc = CanvasDocument.empty(id: 'board');
      for (final el in [text, shape, drawing, image, connector]) {
        doc = doc.upsertElement(el);
      }

      const codec = CanvasDocumentCodec();
      final restored = codec.decodeFromString(codec.encodeToString(doc));
      expect(restored.version, kCanvasDocumentVersion);
      expect((restored.getElementById(text.id)! as TextElement).text, 'hello\nworld');
      expect((restored.getElementById(shape.id)! as ShapeElement).shapeKind,
          ShapeKind.star);
      expect((restored.getElementById(shape.id)! as ShapeElement).label, 'Node');
      expect((restored.getElementById(drawing.id)! as DrawingElement).points.length,
          6);
      expect((restored.getElementById(image.id)! as ImageElement).src, '/tmp/a.png');
      final c = restored.getElementById(connector.id)! as ConnectorElement;
      expect(c.arrowHeads, ArrowHeads.both);
      expect(c.startBindingId, shape.id);
    });
  });

  group('commands', () {
    test('duplicate creates new ids', () {
      final a = ShapeElement.create(x: 0, y: 0);
      final b = a.duplicate(newId: generateId(), dx: 10, dy: 10);
      expect(b.id, isNot(a.id));
      expect(b.x, 10);
    });

    test('compound create undoes as one unit', () {
      final a = ShapeElement.create(x: 0, y: 0);
      final b = TextElement.create(x: 1, y: 1, text: 't');
      var doc = CanvasDocument.empty();
      final history = HistoryStack();
      final cmd = CompoundCommand(commands: [
        CreateElementCommand(a),
        CreateElementCommand(b),
      ]);
      doc = cmd.execute(doc);
      history.push(cmd);
      expect(doc.elementsById.length, 2);
      doc = history.popUndo()!.undo(doc);
      expect(doc.elementsById, isEmpty);
    });

    test('move drawing updates stroke points', () {
      final d = DrawingElement.fromPoints(
        absolutePoints: [0, 0, 10, 0],
        color: '#000',
        strokeWidth: 2,
      );
      var doc = CanvasDocument.empty().upsertElement(d);
      final move = MoveElementsCommand({
        d.id: MoveDelta(fromX: d.x, fromY: d.y, toX: d.x + 5, toY: d.y + 5),
      });
      doc = move.execute(doc);
      final moved = doc.getElementById(d.id)! as DrawingElement;
      expect(moved.points[0], 5);
      expect(moved.points[1], 5);
    });

    test('update element properties undo', () {
      final s = ShapeElement.create(x: 0, y: 0, fill: '#111111');
      var doc = CanvasDocument.empty().upsertElement(s);
      final history = HistoryStack();
      final after = s.copyWithBase(fill: '#FFFFFF');
      final cmd = UpdateElementCommand(before: s, after: after);
      doc = cmd.execute(doc);
      history.push(cmd);
      expect((doc.getElementById(s.id)! as ShapeElement).fill, '#FFFFFF');
      doc = history.popUndo()!.undo(doc);
      expect((doc.getElementById(s.id)! as ShapeElement).fill, '#111111');
    });
  });

  group('hit testing', () {
    test('star uses polygon hit', () {
      final star = ShapeElement.create(
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        shapeKind: ShapeKind.star,
      );
      const tester = CanvasHitTester();
      expect(tester.hitsElement(star, const Point(50, 50)), isTrue);
      expect(tester.hitsElement(star, const Point(5, 5)), isFalse);
    });

    test('drawing hits near stroke', () {
      final d = DrawingElement.fromPoints(
        absolutePoints: [0, 0, 100, 0],
        color: '#000',
        strokeWidth: 4,
      );
      const tester = CanvasHitTester();
      expect(tester.hitsElement(d, const Point(50, 2)), isTrue);
      expect(tester.hitsElement(d, const Point(50, 40)), isFalse);
    });
  });
}

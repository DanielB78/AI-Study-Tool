import 'package:ai_study_tool/core/canvas/geometry/point.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_document.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_element.dart';
import 'package:ai_study_tool/core/serialization/canvas_document_codec.dart';
import 'package:ai_study_tool/editor/hit_testing/canvas_hit_tester.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('serialization', () {
    test('round-trips CanvasDocument including element types', () {
      final shape = ShapeElement.create(x: 12, y: 34, width: 80, height: 60);
      final text = TextElement.create(x: 1, y: 2, text: 'hello');
      final connector = ConnectorElement.create(
        startX: 0,
        startY: 0,
        endX: 50,
        endY: 50,
        startBindingId: shape.id,
        endBindingId: text.id,
      );

      var doc = CanvasDocument.empty(id: 'board-1');
      doc = doc.upsertElement(shape);
      doc = doc.upsertElement(text);
      doc = doc.upsertElement(connector);

      const codec = CanvasDocumentCodec();
      final encoded = codec.encodeToString(doc);
      final restored = codec.decodeFromString(encoded);

      expect(restored.id, 'board-1');
      expect(restored.version, kCanvasDocumentVersion);
      expect(
        restored.elementsById.keys,
        containsAll([shape.id, text.id, connector.id]),
      );
      expect(restored.getElementById(shape.id), isA<ShapeElement>());
      expect((restored.getElementById(text.id)! as TextElement).text, 'hello');
      final c = restored.getElementById(connector.id)! as ConnectorElement;
      expect(c.startBindingId, shape.id);
      expect(c.endBindingId, text.id);
    });

    test('demo document serializes stably by id', () {
      final doc = CanvasDocument.withDemoShape(id: 'demo');
      const codec = CanvasDocumentCodec();
      final again = codec.decode(codec.encode(doc));
      expect(again.id, 'demo');
      expect(again.elementsById.length, 1);
      expect(again.elementsById.keys.first, doc.elementsById.keys.first);
    });
  });

  group('hit testing', () {
    test('finds top-most element under world point', () {
      final bottom =
          ShapeElement.create(x: 0, y: 0, width: 100, height: 100, zIndex: 0);
      final top =
          ShapeElement.create(x: 20, y: 20, width: 100, height: 100, zIndex: 1);
      final doc = CanvasDocument(
        id: 'h',
        elementsById: {bottom.id: bottom, top.id: top},
        zOrder: [bottom.id, top.id],
      );

      const tester = CanvasHitTester();
      final hit = tester.hitTest(doc, const Point(30, 30));
      expect(hit?.id, top.id);

      final miss = tester.hitTest(doc, const Point(500, 500));
      expect(miss, isNull);
    });

    test('ellipse uses oval hit region', () {
      final oval = ShapeElement.create(
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        shapeKind: ShapeKind.ellipse,
      );
      const tester = CanvasHitTester();
      expect(tester.hitsElement(oval, const Point(50, 50)), isTrue);
      expect(tester.hitsElement(oval, const Point(5, 5)), isFalse);
    });
  });
}

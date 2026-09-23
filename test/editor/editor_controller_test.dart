import 'package:ai_study_tool/core/canvas/models/canvas_element.dart';
import 'package:ai_study_tool/core/commands/document_commands.dart';
import 'package:ai_study_tool/editor/controller/editor_controller.dart';
import 'package:ai_study_tool/editor/state/editor_tool.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('EditorController selection, move, delete, undo', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final editor = container.read(editorControllerProvider.notifier);
    final demoId = editor.document.elementsById.keys.single;

    editor.selectSingle(demoId);
    expect(container.read(editorControllerProvider).selectedIds, {demoId});

    editor.commitMove(moves: {
      demoId: MoveDelta(
        fromX: editor.document.getElementById(demoId)!.x,
        fromY: editor.document.getElementById(demoId)!.y,
        toX: 400,
        toY: 300,
      ),
    });
    expect(editor.document.getElementById(demoId)!.x, 400);

    editor.deleteSelection();
    expect(editor.document.elementsById, isEmpty);
    expect(container.read(editorControllerProvider).selectedIds, isEmpty);

    editor.undo();
    expect(editor.document.getElementById(demoId), isNotNull);

    editor.undo();
    expect(editor.document.getElementById(demoId)!.x, isNot(400));

    editor.setTool(EditorTool.pan);
    expect(container.read(editorControllerProvider).activeTool, EditorTool.pan);

    editor.setTool(EditorTool.text); // not implemented — ignored
    expect(container.read(editorControllerProvider).activeTool, EditorTool.pan);
  });

  test('createElement goes through command history', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final editor = container.read(editorControllerProvider.notifier);
    final before = editor.document.elementsById.length;

    final shape = ShapeElement.create(x: 1, y: 2);
    editor.createElement(shape);
    expect(editor.document.elementsById.length, before + 1);
    expect(container.read(editorControllerProvider).canUndo, isTrue);

    editor.undo();
    expect(editor.document.getElementById(shape.id), isNull);
  });
}

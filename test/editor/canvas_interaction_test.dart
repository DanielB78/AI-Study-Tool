import 'package:ai_study_tool/app/study_app.dart';
import 'package:ai_study_tool/core/canvas/geometry/point.dart';
import 'package:ai_study_tool/core/canvas/models/camera_state.dart';
import 'package:ai_study_tool/core/canvas/models/canvas_element.dart';
import 'package:ai_study_tool/editor/controller/editor_controller.dart';
import 'package:ai_study_tool/editor/state/editor_tool.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('select, drag, delete, undo via pointer and shortcuts',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const StudyApp());
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(MaterialApp)),
    );
    final editor = container.read(editorControllerProvider.notifier);
    final demoId = editor.document.elementsById.keys.single;
    final el = editor.document.getElementById(demoId)!;
    final camera = editor.document.camera;

    final screen = worldToScreen(
      Point(el.x + el.width / 2, el.y + el.height / 2),
      camera,
    );

    await tester.tapAt(Offset(screen.x, screen.y));
    await tester.pump();
    expect(container.read(editorControllerProvider).selectedIds, {demoId});

    final start = Offset(screen.x, screen.y);
    await tester.dragFrom(start, const Offset(80, 40));
    await tester.pumpAndSettle();
    final moved = editor.document.getElementById(demoId)!;
    expect(moved.x, closeTo(el.x + 80 / camera.zoom, 1));
    expect(moved.y, closeTo(el.y + 40 / camera.zoom, 1));

    await tester.sendKeyEvent(LogicalKeyboardKey.delete);
    await tester.pump();
    expect(editor.document.getElementById(demoId), isNull);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyZ);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();
    expect(editor.document.getElementById(demoId), isNotNull);

    editor.setTool(EditorTool.pan);
    await tester.pump();
    expect(container.read(editorControllerProvider).activeTool, EditorTool.pan);
  });

  testWidgets('pen, line, arrow, and shape creation via pointer', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const StudyApp());
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(MaterialApp)),
    );
    final editor = container.read(editorControllerProvider.notifier);
    final before = editor.document.elementsById.length;

    // Pen stroke
    editor.setTool(EditorTool.pen);
    await tester.pump();
    await tester.dragFrom(const Offset(500, 400), const Offset(80, 40));
    await tester.pumpAndSettle();
    expect(editor.document.elementsById.length, before + 1);
    expect(
      editor.document.elementsById.values.last,
      isA<DrawingElement>(),
    );

    // Line
    editor.setTool(EditorTool.line);
    await tester.pump();
    await tester.dragFrom(const Offset(300, 300), const Offset(100, 0));
    await tester.pumpAndSettle();
    expect(
      editor.document.elementsById.values.whereType<ConnectorElement>().length,
      1,
    );

    // Arrow
    editor.setTool(EditorTool.arrow);
    await tester.pump();
    await tester.dragFrom(const Offset(300, 500), const Offset(120, -40));
    await tester.pumpAndSettle();
    final arrows = editor.document.elementsById.values
        .whereType<ConnectorElement>()
        .where((c) => c.connectorKind == ConnectorKind.arrow);
    expect(arrows.length, 1);

    // Shape
    editor.selectShapeKind(ShapeKind.ellipse);
    await tester.pump();
    await tester.dragFrom(const Offset(700, 200), const Offset(90, 70));
    await tester.pumpAndSettle();
    expect(
      editor.document.elementsById.values.whereType<ShapeElement>().any(
            (s) => s.shapeKind == ShapeKind.ellipse,
          ),
      isTrue,
    );
  });
}

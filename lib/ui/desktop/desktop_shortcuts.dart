import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../editor/controller/editor_controller.dart';
import '../../editor/state/editor_tool.dart';

/// Desktop keyboard shortcuts — thin adapter over [EditorController].
class DesktopShortcuts extends ConsumerWidget {
  const DesktopShortcuts({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);

    return Shortcuts(
      shortcuts: <ShortcutActivator, Intent>{
        const SingleActivator(LogicalKeyboardKey.delete):
            const _DeleteSelectionIntent(),
        const SingleActivator(LogicalKeyboardKey.backspace):
            const _DeleteSelectionIntent(),
        const SingleActivator(LogicalKeyboardKey.escape):
            const _ClearSelectionIntent(),
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true):
            const _UndoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true):
            const _UndoIntent(),
        const SingleActivator(
          LogicalKeyboardKey.keyZ,
          control: true,
          shift: true,
        ): const _RedoIntent(),
        const SingleActivator(
          LogicalKeyboardKey.keyZ,
          meta: true,
          shift: true,
        ): const _RedoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyY, control: true):
            const _RedoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyY, meta: true):
            const _RedoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyV):
            const _SetToolIntent(EditorTool.select),
        const SingleActivator(LogicalKeyboardKey.keyH):
            const _SetToolIntent(EditorTool.pan),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _DeleteSelectionIntent: CallbackAction<_DeleteSelectionIntent>(
            onInvoke: (_) {
              editor.deleteSelection();
              return null;
            },
          ),
          _ClearSelectionIntent: CallbackAction<_ClearSelectionIntent>(
            onInvoke: (_) {
              editor.clearSelection();
              return null;
            },
          ),
          _UndoIntent: CallbackAction<_UndoIntent>(
            onInvoke: (_) {
              editor.undo();
              return null;
            },
          ),
          _RedoIntent: CallbackAction<_RedoIntent>(
            onInvoke: (_) {
              editor.redo();
              return null;
            },
          ),
          _SetToolIntent: CallbackAction<_SetToolIntent>(
            onInvoke: (intent) {
              editor.setTool(intent.tool);
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: child,
        ),
      ),
    );
  }
}

class _DeleteSelectionIntent extends Intent {
  const _DeleteSelectionIntent();
}

class _ClearSelectionIntent extends Intent {
  const _ClearSelectionIntent();
}

class _UndoIntent extends Intent {
  const _UndoIntent();
}

class _RedoIntent extends Intent {
  const _RedoIntent();
}

class _SetToolIntent extends Intent {
  const _SetToolIntent(this.tool);
  final EditorTool tool;
}

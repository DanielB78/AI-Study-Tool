import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../editor/controller/editor_controller.dart';
import '../../editor/interaction/canvas_interactor.dart';
import '../../editor/state/editor_tool.dart';

/// Desktop keyboard shortcuts — thin adapter over editor commands.
class DesktopShortcuts extends ConsumerStatefulWidget {
  const DesktopShortcuts({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<DesktopShortcuts> createState() => _DesktopShortcutsState();
}

class _DesktopShortcutsState extends ConsumerState<DesktopShortcuts> {
  final FocusNode _focusNode = FocusNode(debugLabel: 'desktop-shortcuts');

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  bool get _editing =>
      ref.read(interactionControllerProvider).isEditingText;

  @override
  Widget build(BuildContext context) {
    final editor = ref.read(editorControllerProvider.notifier);

    return Shortcuts(
      shortcuts: <ShortcutActivator, Intent>{
        const SingleActivator(LogicalKeyboardKey.delete):
            const _DeleteIntent(),
        const SingleActivator(LogicalKeyboardKey.backspace):
            const _DeleteIntent(),
        const SingleActivator(LogicalKeyboardKey.escape):
            const _EscapeIntent(),
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
        const SingleActivator(LogicalKeyboardKey.keyC, control: true):
            const _CopyIntent(),
        const SingleActivator(LogicalKeyboardKey.keyC, meta: true):
            const _CopyIntent(),
        const SingleActivator(LogicalKeyboardKey.keyV, control: true):
            const _PasteIntent(),
        const SingleActivator(LogicalKeyboardKey.keyV, meta: true):
            const _PasteIntent(),
        const SingleActivator(LogicalKeyboardKey.keyD, control: true):
            const _DuplicateIntent(),
        const SingleActivator(LogicalKeyboardKey.keyD, meta: true):
            const _DuplicateIntent(),
        const SingleActivator(LogicalKeyboardKey.keyV):
            const _SetToolIntent(EditorTool.select),
        const SingleActivator(LogicalKeyboardKey.keyH):
            const _SetToolIntent(EditorTool.pan),
        const SingleActivator(LogicalKeyboardKey.keyT):
            const _SetToolIntent(EditorTool.text),
        const SingleActivator(LogicalKeyboardKey.keyP):
            const _SetToolIntent(EditorTool.pen),
        const SingleActivator(LogicalKeyboardKey.keyS):
            const _SetToolIntent(EditorTool.shape),
        const SingleActivator(LogicalKeyboardKey.keyL):
            const _SetToolIntent(EditorTool.line),
        const SingleActivator(LogicalKeyboardKey.keyA):
            const _SetToolIntent(EditorTool.arrow),
        const SingleActivator(LogicalKeyboardKey.keyI):
            const _SetToolIntent(EditorTool.image),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _DeleteIntent: CallbackAction<_DeleteIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.deleteSelection();
              return null;
            },
          ),
          _EscapeIntent: CallbackAction<_EscapeIntent>(
            onInvoke: (_) {
              CanvasInteractor(
                editor: editor,
                interaction:
                    ref.read(interactionControllerProvider.notifier),
              ).cancelOrEscape();
              return null;
            },
          ),
          _UndoIntent: CallbackAction<_UndoIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.undo();
              return null;
            },
          ),
          _RedoIntent: CallbackAction<_RedoIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.redo();
              return null;
            },
          ),
          _CopyIntent: CallbackAction<_CopyIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.copySelection();
              return null;
            },
          ),
          _PasteIntent: CallbackAction<_PasteIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.pasteClipboard();
              return null;
            },
          ),
          _DuplicateIntent: CallbackAction<_DuplicateIntent>(
            onInvoke: (_) {
              if (_editing) return null;
              editor.duplicateSelection();
              return null;
            },
          ),
          _SetToolIntent: CallbackAction<_SetToolIntent>(
            onInvoke: (intent) {
              if (_editing) return null;
              editor.setTool(intent.tool);
              if (intent.tool == EditorTool.shape) {
                editor.setShapesPopoverOpen(true);
              }
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: _focusNode,
          autofocus: true,
          child: widget.child,
        ),
      ),
    );
  }
}

class _DeleteIntent extends Intent {
  const _DeleteIntent();
}

class _EscapeIntent extends Intent {
  const _EscapeIntent();
}

class _UndoIntent extends Intent {
  const _UndoIntent();
}

class _RedoIntent extends Intent {
  const _RedoIntent();
}

class _CopyIntent extends Intent {
  const _CopyIntent();
}

class _PasteIntent extends Intent {
  const _PasteIntent();
}

class _DuplicateIntent extends Intent {
  const _DuplicateIntent();
}

class _SetToolIntent extends Intent {
  const _SetToolIntent(this.tool);
  final EditorTool tool;
}

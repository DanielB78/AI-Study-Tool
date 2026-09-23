import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../editor/controller/editor_controller.dart';
import '../../editor/rendering/editor_canvas_view.dart';
import 'contextual/contextual_toolbar.dart';
import 'desktop_shortcuts.dart';
import 'toolbar/desktop_floating_toolbar.dart';

/// Desktop application shell: full-bleed canvas + floating chrome.
class DesktopShell extends StatelessWidget {
  const DesktopShell({super.key});

  @override
  Widget build(BuildContext context) {
    return DesktopShortcuts(
      child: Scaffold(
        backgroundColor: const Color(0xFFF4F5F7),
        body: Stack(
          fit: StackFit.expand,
          clipBehavior: Clip.none,
          children: [
            const EditorCanvasView(),
            const Positioned(
              left: 16,
              top: 0,
              bottom: 0,
              child: _LeftEdgeToolbarHost(),
            ),
            const Positioned(
              top: 16,
              left: 0,
              right: 0,
              child: Align(
                alignment: Alignment.topCenter,
                child: ContextualToolbar(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LeftEdgeToolbarHost extends ConsumerStatefulWidget {
  const _LeftEdgeToolbarHost();

  @override
  ConsumerState<_LeftEdgeToolbarHost> createState() =>
      _LeftEdgeToolbarHostState();
}

class _LeftEdgeToolbarHostState extends ConsumerState<_LeftEdgeToolbarHost> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final shapesOpen = ref.watch(
      editorControllerProvider.select((s) => s.shapesPopoverOpen),
    );
    final visible = _hovered || shapesOpen;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) {
        Future.delayed(const Duration(milliseconds: 280), () {
          if (!mounted) return;
          if (ref.read(editorControllerProvider).shapesPopoverOpen) return;
          setState(() => _hovered = false);
        });
      },
      // Widen while the shapes popout is open so it receives pointer events
      // (overflow alone does not expand hit-testing).
      child: SizedBox(
        width: shapesOpen ? 320 : 72,
        child: Align(
          alignment: Alignment.centerLeft,
          child: AnimatedOpacity(
            duration: const Duration(milliseconds: 200),
            opacity: visible ? 1 : 0.35,
            child: const DesktopFloatingToolbar(),
          ),
        ),
      ),
    );
  }
}

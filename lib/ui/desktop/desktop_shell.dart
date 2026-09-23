import 'package:flutter/material.dart';

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

class _LeftEdgeToolbarHost extends StatefulWidget {
  const _LeftEdgeToolbarHost();

  @override
  State<_LeftEdgeToolbarHost> createState() => _LeftEdgeToolbarHostState();
}

class _LeftEdgeToolbarHostState extends State<_LeftEdgeToolbarHost> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _visible = true),
      onExit: (_) {
        Future.delayed(const Duration(milliseconds: 250), () {
          if (mounted) setState(() => _visible = false);
        });
      },
      // Narrow hit target so the canvas remains clickable; popout paints
      // outside via Stack overflow (clipBehavior: none on parent).
      child: SizedBox(
        width: 72,
        child: Align(
          alignment: Alignment.centerLeft,
          child: AnimatedOpacity(
            duration: const Duration(milliseconds: 200),
            opacity: _visible ? 1 : 0.35,
            child: const DesktopFloatingToolbar(),
          ),
        ),
      ),
    );
  }
}

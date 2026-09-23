import 'package:flutter/material.dart';

import 'desktop_floating_toolbar.dart';
import 'desktop_shortcuts.dart';
import '../../editor/rendering/editor_canvas_view.dart';

/// Desktop application shell: full-bleed canvas + floating toolbar.
///
/// Editor logic is not embedded here — only layout and desktop chrome.
class DesktopShell extends StatelessWidget {
  const DesktopShell({super.key});

  @override
  Widget build(BuildContext context) {
    return DesktopShortcuts(
      child: Scaffold(
        backgroundColor: const Color(0xFFF4F5F7),
        body: Stack(
          fit: StackFit.expand,
          children: [
            const EditorCanvasView(),
            // Left-edge hover reveal zone + floating toolbar.
            const Positioned(
              left: 16,
              top: 0,
              bottom: 0,
              child: _LeftEdgeToolbarHost(),
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
      onExit: (_) => setState(() => _visible = false),
      child: SizedBox(
        width: 72,
        child: Align(
          alignment: Alignment.centerLeft,
          child: AnimatedSlide(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            offset: _visible ? Offset.zero : const Offset(-0.15, 0),
            child: AnimatedOpacity(
              duration: const Duration(milliseconds: 200),
              opacity: _visible ? 1 : 0.35,
              child: const DesktopFloatingToolbar(),
            ),
          ),
        ),
      ),
    );
  }
}

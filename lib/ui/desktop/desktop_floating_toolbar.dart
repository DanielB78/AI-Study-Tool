import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../editor/controller/editor_controller.dart';
import '../../editor/state/editor_tool.dart';

/// Floating vertical pill toolbar for desktop.
///
/// Reveals fully on left-edge / self hover. Editor logic stays in
/// [EditorController] — this widget only dispatches tool changes.
class DesktopFloatingToolbar extends ConsumerStatefulWidget {
  const DesktopFloatingToolbar({super.key});

  @override
  ConsumerState<DesktopFloatingToolbar> createState() =>
      _DesktopFloatingToolbarState();
}

class _DesktopFloatingToolbarState
    extends ConsumerState<DesktopFloatingToolbar> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final activeTool = ref.watch(
      editorControllerProvider.select((s) => s.activeTool),
    );
    final editor = ref.read(editorControllerProvider.notifier);

    return MouseRegion(
      onEnter: (_) => setState(() => _expanded = true),
      onExit: (_) => setState(() => _expanded = false),
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 180),
        opacity: _expanded ? 1 : 0.55,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFFAFBFC),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0x22000000)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x1A000000),
                blurRadius: 18,
                offset: Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ToolIconButton(
                icon: Icons.near_me_outlined,
                tooltip: 'Select (V)',
                selected: activeTool == EditorTool.select,
                onPressed: () => editor.setTool(EditorTool.select),
              ),
              const SizedBox(height: 6),
              _ToolIconButton(
                icon: Icons.pan_tool_alt_outlined,
                tooltip: 'Pan (H)',
                selected: activeTool == EditorTool.pan,
                onPressed: () => editor.setTool(EditorTool.pan),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ToolIconButton extends StatelessWidget {
  const _ToolIconButton({
    required this.icon,
    required this.tooltip,
    required this.selected,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      waitDuration: const Duration(milliseconds: 400),
      child: Material(
        color: selected ? const Color(0x1A3B82F6) : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(
              icon,
              size: 22,
              color: selected
                  ? const Color(0xFF2563EB)
                  : const Color(0xFF374151),
            ),
          ),
        ),
      ),
    );
  }
}

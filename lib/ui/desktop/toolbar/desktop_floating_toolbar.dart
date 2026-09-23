import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/canvas/models/canvas_element.dart';
import '../../../editor/controller/editor_controller.dart';
import '../../../editor/state/editor_tool.dart';

/// Floating vertical stadium toolbar — reveal on left-edge hover.
class DesktopFloatingToolbar extends ConsumerStatefulWidget {
  const DesktopFloatingToolbar({super.key});

  @override
  ConsumerState<DesktopFloatingToolbar> createState() =>
      _DesktopFloatingToolbarState();
}

class _DesktopFloatingToolbarState
    extends ConsumerState<DesktopFloatingToolbar> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(editorControllerProvider);
    final editor = ref.read(editorControllerProvider.notifier);
    final active = state.activeTool;
    final shapesOpen = state.shapesPopoverOpen;

    final visible = _hovered || shapesOpen;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) {
        Future.delayed(const Duration(milliseconds: 220), () {
          if (!mounted) return;
          if (!ref.read(editorControllerProvider).shapesPopoverOpen) {
            setState(() => _hovered = false);
          }
        });
      },
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 180),
        opacity: visible ? 1 : 0.28,
        child: AnimatedSlide(
          duration: const Duration(milliseconds: 180),
          offset: visible ? Offset.zero : const Offset(-0.12, 0),
          child: Material(
            color: const Color(0xFFFAFBFC),
            elevation: 6,
            shadowColor: const Color(0x33000000),
            shape: const StadiumBorder(
              side: BorderSide(color: Color(0x22000000)),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _tool(Icons.near_me_outlined, 'Select (V)', EditorTool.select,
                      active, () => editor.setTool(EditorTool.select)),
                  _tool(Icons.pan_tool_alt_outlined, 'Pan (H)', EditorTool.pan,
                      active, () => editor.setTool(EditorTool.pan)),
                  const _Divider(),
                  _tool(Icons.title, 'Text (T)', EditorTool.text, active,
                      () => editor.setTool(EditorTool.text)),
                  _tool(Icons.edit_outlined, 'Pen (P)', EditorTool.pen, active,
                      () => editor.setTool(EditorTool.pen)),
                  _ShapeToolButton(
                    selected: active == EditorTool.shape,
                    open: shapesOpen,
                    onOpen: () {
                      editor.setTool(EditorTool.shape);
                      editor.setShapesPopoverOpen(true);
                      setState(() => _hovered = true);
                    },
                    onClose: () => editor.setShapesPopoverOpen(false),
                  ),
                  _tool(Icons.remove, 'Line (L)', EditorTool.line, active,
                      () => editor.setTool(EditorTool.line)),
                  _tool(Icons.arrow_right_alt, 'Arrow (A)', EditorTool.arrow,
                      active, () => editor.setTool(EditorTool.arrow)),
                  _tool(Icons.image_outlined, 'Image (I)', EditorTool.image,
                      active, () => editor.setTool(EditorTool.image)),
                  const _Divider(),
                  _action(Icons.undo, 'Undo', state.canUndo, editor.undo),
                  _action(Icons.redo, 'Redo', state.canRedo, editor.redo),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tool(
    IconData icon,
    String tip,
    EditorTool tool,
    EditorTool active,
    VoidCallback onTap,
  ) {
    return _IconBtn(
      icon: icon,
      tip: tip,
      selected: active == tool,
      onTap: onTap,
    );
  }

  Widget _action(
    IconData icon,
    String tip,
    bool enabled,
    VoidCallback onTap,
  ) {
    return Opacity(
      opacity: enabled ? 1 : 0.35,
      child: _IconBtn(
        icon: icon,
        tip: tip,
        selected: false,
        onTap: enabled ? onTap : null,
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      width: 24,
      height: 1,
      color: const Color(0x22000000),
    );
  }
}

class _IconBtn extends StatelessWidget {
  const _IconBtn({
    required this.icon,
    required this.tip,
    required this.selected,
    this.onTap,
  });

  final IconData icon;
  final String tip;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tip,
      waitDuration: const Duration(milliseconds: 350),
      child: Material(
        color: selected ? const Color(0x1A3B82F6) : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
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

class _ShapeToolButton extends ConsumerWidget {
  const _ShapeToolButton({
    required this.selected,
    required this.open,
    required this.onOpen,
    required this.onClose,
  });

  final bool selected;
  final bool open;
  final VoidCallback onOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        _IconBtn(
          icon: Icons.category_outlined,
          tip: 'Shapes (S)',
          selected: selected || open,
          onTap: () {
            if (open) {
              onClose();
            } else {
              onOpen();
            }
          },
        ),
        if (open)
          Positioned(
            left: 52,
            top: -40,
            child: _ShapesPopout(onClose: onClose),
          ),
      ],
    );
  }
}

class _ShapesPopout extends ConsumerWidget {
  const _ShapesPopout({required this.onClose});

  final VoidCallback onClose;

  static const _kinds = <(ShapeKind, IconData, String)>[
    (ShapeKind.rectangle, Icons.rectangle_outlined, 'Rectangle'),
    (ShapeKind.roundedRect, Icons.rounded_corner, 'Rounded'),
    (ShapeKind.ellipse, Icons.circle_outlined, 'Ellipse'),
    (ShapeKind.triangle, Icons.change_history, 'Triangle'),
    (ShapeKind.diamond, Icons.diamond_outlined, 'Diamond'),
    (ShapeKind.pentagon, Icons.pentagon_outlined, 'Pentagon'),
    (ShapeKind.hexagon, Icons.hexagon_outlined, 'Hexagon'),
    (ShapeKind.star, Icons.star_outline, 'Star'),
    (ShapeKind.parallelogram, Icons.crop_landscape, 'Parallelogram'),
    (ShapeKind.callout, Icons.chat_bubble_outline, 'Callout'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    final current = ref.watch(
      editorControllerProvider.select((s) => s.defaults.shapeKind),
    );

    return MouseRegion(
      onExit: (_) {
        // Delay close so user can move back to toolbar.
        Future.delayed(const Duration(milliseconds: 250), () {
          // Popover stays open until selection or explicit close.
        });
      },
      child: Material(
        elevation: 8,
        color: const Color(0xFFFAFBFC),
        shadowColor: const Color(0x33000000),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 220,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0x22000000)),
          ),
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final (kind, icon, tip) in _kinds)
                Tooltip(
                  message: tip,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () {
                      editor.selectShapeKind(kind);
                      onClose();
                    },
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: current == kind
                            ? const Color(0x1A3B82F6)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        icon,
                        color: current == kind
                            ? const Color(0xFF2563EB)
                            : const Color(0xFF374151),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

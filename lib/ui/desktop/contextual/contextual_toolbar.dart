import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/canvas/models/canvas_element.dart';
import '../../../editor/controller/editor_controller.dart';
import '../../../editor/defaults/tool_defaults.dart';
import '../../../editor/state/editor_tool.dart';
import '../../shared/color_picker/color_swatch_button.dart';

/// Top-centre contextual stadium toolbar — shown only when relevant.
class ContextualToolbar extends ConsumerWidget {
  const ContextualToolbar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(editorControllerProvider);
    final selected = [
      for (final id in state.selectedIds)
        if (state.document.getElementById(id) != null)
          state.document.getElementById(id)!,
    ];
    final tool = state.activeTool;

    Widget? body;
    if (selected.length > 1) {
      body = _MultiSelectBar(count: selected.length);
    } else if (selected.length == 1) {
      body = switch (selected.first) {
        TextElement() => _TextBar(element: selected.first as TextElement),
        ShapeElement() => _ShapeBar(element: selected.first as ShapeElement),
        DrawingElement() =>
          _PenBar(element: selected.first as DrawingElement),
        ConnectorElement() =>
          _ConnectorBar(element: selected.first as ConnectorElement),
        ImageElement() => _ImageBar(element: selected.first as ImageElement),
      };
    } else if (tool == EditorTool.text) {
      body = const _TextDefaultsBar();
    } else if (tool == EditorTool.shape) {
      body = const _ShapeDefaultsBar();
    } else if (tool == EditorTool.pen) {
      body = const _PenDefaultsBar();
    } else if (tool == EditorTool.line || tool == EditorTool.arrow) {
      body = _LineDefaultsBar(isArrow: tool == EditorTool.arrow);
    }

    if (body == null) return const SizedBox.shrink();

    return IgnorePointer(
      ignoring: false,
      child: Material(
        elevation: 6,
        shadowColor: const Color(0x33000000),
        color: const Color(0xFFFAFBFC),
        shape: const StadiumBorder(
          side: BorderSide(color: Color(0x22000000)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: body,
        ),
      ),
    );
  }
}

class _ToolbarRow extends StatelessWidget {
  const _ToolbarRow({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const SizedBox(width: 4),
          children[i],
        ],
      ],
    );
  }
}

class _IconToggle extends StatelessWidget {
  const _IconToggle({
    required this.icon,
    required this.selected,
    required this.onTap,
    required this.tooltip,
  });

  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: selected ? const Color(0x1A3B82F6) : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: SizedBox(
            width: 34,
            height: 34,
            child: Icon(
              icon,
              size: 18,
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

class _MoreMenu extends ConsumerWidget {
  const _MoreMenu({this.showAlign = false});

  final bool showAlign;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    return PopupMenuButton<String>(
      tooltip: 'More',
      icon: const Icon(Icons.more_horiz, size: 18),
      onSelected: (value) {
        switch (value) {
          case 'front':
            editor.bringToFront();
          case 'forward':
            editor.bringForward();
          case 'backward':
            editor.sendBackward();
          case 'back':
            editor.sendToBack();
          case 'lock':
            editor.toggleLockSelection();
          case 'dup':
            editor.duplicateSelection();
          case 'alignL':
            editor.alignSelection(AlignMode.left);
          case 'alignCH':
            editor.alignSelection(AlignMode.centerH);
          case 'alignR':
            editor.alignSelection(AlignMode.right);
          case 'alignT':
            editor.alignSelection(AlignMode.top);
          case 'alignCV':
            editor.alignSelection(AlignMode.centerV);
          case 'alignB':
            editor.alignSelection(AlignMode.bottom);
          case 'distH':
            editor.distributeSelection(horizontal: true);
          case 'distV':
            editor.distributeSelection(horizontal: false);
        }
      },
      itemBuilder: (context) => [
        if (showAlign) ...[
          const PopupMenuItem(value: 'alignL', child: Text('Align left')),
          const PopupMenuItem(value: 'alignCH', child: Text('Align centre H')),
          const PopupMenuItem(value: 'alignR', child: Text('Align right')),
          const PopupMenuItem(value: 'alignT', child: Text('Align top')),
          const PopupMenuItem(value: 'alignCV', child: Text('Align centre V')),
          const PopupMenuItem(value: 'alignB', child: Text('Align bottom')),
          const PopupMenuItem(value: 'distH', child: Text('Distribute H')),
          const PopupMenuItem(value: 'distV', child: Text('Distribute V')),
          const PopupMenuDivider(),
        ],
        const PopupMenuItem(value: 'front', child: Text('Bring to front')),
        const PopupMenuItem(value: 'forward', child: Text('Bring forward')),
        const PopupMenuItem(value: 'backward', child: Text('Send backward')),
        const PopupMenuItem(value: 'back', child: Text('Send to back')),
        const PopupMenuDivider(),
        const PopupMenuItem(value: 'lock', child: Text('Lock / unlock')),
        const PopupMenuItem(value: 'dup', child: Text('Duplicate')),
      ],
    );
  }
}

class _OpacityButton extends StatelessWidget {
  const _OpacityButton({required this.value, required this.onCommit});

  final double value;
  final ValueChanged<double> onCommit;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Opacity',
      child: PopupMenuButton<double>(
      tooltip: 'Opacity',
      itemBuilder: (context) => [
          PopupMenuItem(
            enabled: false,
            child: SizedBox(
              width: 180,
              child: StatefulBuilder(
                builder: (context, setLocal) {
                  var local = value;
                  return Slider(
                    value: local.clamp(0.05, 1),
                    min: 0.05,
                    max: 1,
                    onChanged: (v) => setLocal(() => local = v),
                    onChangeEnd: onCommit,
                  );
                },
              ),
            ),
          ),
        ],
        child: const SizedBox(
          width: 34,
          height: 34,
          child: Icon(Icons.opacity, size: 18),
        ),
      ),
    );
  }
}

class _StrokeWidthButton extends StatelessWidget {
  const _StrokeWidthButton({required this.value, required this.onChanged});

  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<double>(
      tooltip: 'Stroke width',
      onSelected: onChanged,
      child: const SizedBox(
        width: 34,
        height: 34,
        child: Icon(Icons.line_weight, size: 18),
      ),
      itemBuilder: (context) => [
        for (final w in [1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0])
          PopupMenuItem(value: w, child: Text('${w.toInt()}px')),
      ],
    );
  }
}

class _StrokeStyleButton extends StatelessWidget {
  const _StrokeStyleButton({required this.value, required this.onChanged});

  final StrokeStyle value;
  final ValueChanged<StrokeStyle> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<StrokeStyle>(
      tooltip: 'Stroke style',
      onSelected: onChanged,
      itemBuilder: (context) => const [
        PopupMenuItem(value: StrokeStyle.solid, child: Text('Solid')),
        PopupMenuItem(value: StrokeStyle.dashed, child: Text('Dashed')),
        PopupMenuItem(value: StrokeStyle.dotted, child: Text('Dotted')),
      ],
      child: const SizedBox(
        width: 34,
        height: 34,
        child: Icon(Icons.more_horiz, size: 18),
      ),
    );
  }
}

// --- Bars ---

class _TextBar extends ConsumerWidget {
  const _TextBar({required this.element});
  final TextElement element;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    void update(TextElement Function(TextElement e) fn) {
      editor.commitUpdate(element, fn(element));
    }

    return _ToolbarRow(children: [
      _FontFamilyButton(
        value: element.fontFamily,
        onChanged: (v) => update((e) => e.copyWithBase(fontFamily: v)),
      ),
      _FontSizeButton(
        value: element.fontSize,
        onChanged: (v) => update((e) => e.copyWithBase(fontSize: v)),
      ),
      _IconToggle(
        icon: Icons.format_bold,
        selected: element.fontWeight == FontWeightKind.bold,
        tooltip: 'Bold',
        onTap: () => update((e) => e.copyWithBase(
              fontWeight: e.fontWeight == FontWeightKind.bold
                  ? FontWeightKind.normal
                  : FontWeightKind.bold,
            )),
      ),
      _IconToggle(
        icon: Icons.format_italic,
        selected: element.italic,
        tooltip: 'Italic',
        onTap: () => update((e) => e.copyWithBase(italic: !e.italic)),
      ),
      _IconToggle(
        icon: Icons.format_underline,
        selected: element.underline,
        tooltip: 'Underline',
        onTap: () => update((e) => e.copyWithBase(underline: !e.underline)),
      ),
      _IconToggle(
        icon: Icons.format_strikethrough,
        selected: element.strikethrough,
        tooltip: 'Strikethrough',
        onTap: () =>
            update((e) => e.copyWithBase(strikethrough: !e.strikethrough)),
      ),
      _IconToggle(
        icon: Icons.format_align_left,
        selected: element.textAlign == TextAlignment.left,
        tooltip: 'Align left',
        onTap: () =>
            update((e) => e.copyWithBase(textAlign: TextAlignment.left)),
      ),
      _IconToggle(
        icon: Icons.format_align_center,
        selected: element.textAlign == TextAlignment.center,
        tooltip: 'Align centre',
        onTap: () =>
            update((e) => e.copyWithBase(textAlign: TextAlignment.center)),
      ),
      _IconToggle(
        icon: Icons.format_align_right,
        selected: element.textAlign == TextAlignment.right,
        tooltip: 'Align right',
        onTap: () =>
            update((e) => e.copyWithBase(textAlign: TextAlignment.right)),
      ),
      ColorSwatchButton(
        color: element.textColor,
        allowTransparent: false,
        tooltip: 'Text colour',
        onChanged: (c) {
          if (c != null) update((e) => e.copyWithBase(textColor: c));
        },
      ),
      ColorSwatchButton(
        color: element.backgroundColor,
        tooltip: 'Background',
        onChanged: (c) => update((e) => e.copyWithBase(
              backgroundColor: c,
              clearBackground: c == null,
            )),
      ),
      _OpacityButton(
        value: element.opacity,
        onCommit: (v) => update((e) => e.copyWithBase(opacity: v)),
      ),
      const _MoreMenu(),
    ]);
  }
}

class _TextDefaultsBar extends ConsumerWidget {
  const _TextDefaultsBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final defaults = ref.watch(editorControllerProvider.select((s) => s.defaults));
    final editor = ref.read(editorControllerProvider.notifier);
    void set(ToolDefaults d) => editor.updateDefaults(d);

    return _ToolbarRow(children: [
      _FontSizeButton(
        value: defaults.textFontSize,
        onChanged: (v) => set(defaults.copyWith(textFontSize: v)),
      ),
      _IconToggle(
        icon: Icons.format_bold,
        selected: defaults.textFontWeight == FontWeightKind.bold,
        tooltip: 'Bold',
        onTap: () => set(defaults.copyWith(
          textFontWeight: defaults.textFontWeight == FontWeightKind.bold
              ? FontWeightKind.normal
              : FontWeightKind.bold,
        )),
      ),
      ColorSwatchButton(
        color: defaults.textColor,
        allowTransparent: false,
        onChanged: (c) {
          if (c != null) set(defaults.copyWith(textColor: c));
        },
      ),
      ColorSwatchButton(
        color: defaults.textBackgroundColor,
        onChanged: (c) => set(defaults.copyWith(
          textBackgroundColor: c,
          clearTextBackground: c == null,
        )),
      ),
    ]);
  }
}

class _ShapeBar extends ConsumerWidget {
  const _ShapeBar({required this.element});
  final ShapeElement element;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    void update(ShapeElement Function(ShapeElement e) fn) {
      editor.commitUpdate(element, fn(element));
    }

    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: element.fill,
        tooltip: 'Fill',
        onChanged: (c) => update((e) => e.copyWithBase(
              fill: c,
              clearFill: c == null,
            )),
      ),
      ColorSwatchButton(
        color: element.stroke,
        tooltip: 'Stroke',
        onChanged: (c) => update((e) => e.copyWithBase(
              stroke: c,
              clearStroke: c == null,
            )),
      ),
      _StrokeWidthButton(
        value: element.strokeWidth,
        onChanged: (v) => update((e) => e.copyWithBase(strokeWidth: v)),
      ),
      _StrokeStyleButton(
        value: element.strokeStyle,
        onChanged: (v) => update((e) => e.copyWithBase(strokeStyle: v)),
      ),
      _OpacityButton(
        value: element.opacity,
        onCommit: (v) => update((e) => e.copyWithBase(opacity: v)),
      ),
      const _MoreMenu(),
    ]);
  }
}

class _ShapeDefaultsBar extends ConsumerWidget {
  const _ShapeDefaultsBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final defaults = ref.watch(editorControllerProvider.select((s) => s.defaults));
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: defaults.shapeFill,
        tooltip: 'Fill',
        onChanged: (c) => editor.updateDefaults(defaults.copyWith(
          shapeFill: c,
          clearShapeFill: c == null,
        )),
      ),
      ColorSwatchButton(
        color: defaults.shapeStroke,
        tooltip: 'Stroke',
        onChanged: (c) => editor.updateDefaults(defaults.copyWith(
          shapeStroke: c,
          clearShapeStroke: c == null,
        )),
      ),
      _StrokeWidthButton(
        value: defaults.shapeStrokeWidth,
        onChanged: (v) =>
            editor.updateDefaults(defaults.copyWith(shapeStrokeWidth: v)),
      ),
    ]);
  }
}

class _PenBar extends ConsumerWidget {
  const _PenBar({required this.element});
  final DrawingElement element;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: element.color,
        allowTransparent: false,
        onChanged: (c) {
          if (c != null) {
            editor.commitUpdate(
              element,
              element.copyWithBase(color: c),
            );
          }
        },
      ),
      _StrokeWidthButton(
        value: element.strokeWidth,
        onChanged: (v) => editor.commitUpdate(
          element,
          element.copyWithBase(strokeWidth: v),
        ),
      ),
      _OpacityButton(
        value: element.opacity,
        onCommit: (v) => editor.commitUpdate(
          element,
          element.copyWithBase(opacity: v),
        ),
      ),
      const _MoreMenu(),
    ]);
  }
}

class _PenDefaultsBar extends ConsumerWidget {
  const _PenDefaultsBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final defaults = ref.watch(editorControllerProvider.select((s) => s.defaults));
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: defaults.penColor,
        allowTransparent: false,
        onChanged: (c) {
          if (c != null) {
            editor.updateDefaults(defaults.copyWith(penColor: c));
          }
        },
      ),
      _StrokeWidthButton(
        value: defaults.penWidth,
        onChanged: (v) =>
            editor.updateDefaults(defaults.copyWith(penWidth: v)),
      ),
    ]);
  }
}

class _ConnectorBar extends ConsumerWidget {
  const _ConnectorBar({required this.element});
  final ConnectorElement element;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: element.stroke,
        allowTransparent: false,
        onChanged: (c) {
          if (c != null) {
            editor.commitUpdate(element, element.copyWithBase(stroke: c));
          }
        },
      ),
      _StrokeWidthButton(
        value: element.strokeWidth,
        onChanged: (v) =>
            editor.commitUpdate(element, element.copyWithBase(strokeWidth: v)),
      ),
      _StrokeStyleButton(
        value: element.strokeStyle,
        onChanged: (v) =>
            editor.commitUpdate(element, element.copyWithBase(strokeStyle: v)),
      ),
      _OpacityButton(
        value: element.opacity,
        onCommit: (v) =>
            editor.commitUpdate(element, element.copyWithBase(opacity: v)),
      ),
      const _MoreMenu(),
    ]);
  }
}

class _LineDefaultsBar extends ConsumerWidget {
  const _LineDefaultsBar({required this.isArrow});
  final bool isArrow;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final defaults = ref.watch(editorControllerProvider.select((s) => s.defaults));
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      ColorSwatchButton(
        color: isArrow ? defaults.arrowColor : defaults.lineColor,
        allowTransparent: false,
        onChanged: (c) {
          if (c == null) return;
          editor.updateDefaults(
            isArrow
                ? defaults.copyWith(arrowColor: c)
                : defaults.copyWith(lineColor: c),
          );
        },
      ),
      _StrokeWidthButton(
        value: isArrow ? defaults.arrowWidth : defaults.lineWidth,
        onChanged: (v) => editor.updateDefaults(
          isArrow
              ? defaults.copyWith(arrowWidth: v)
              : defaults.copyWith(lineWidth: v),
        ),
      ),
    ]);
  }
}

class _ImageBar extends ConsumerWidget {
  const _ImageBar({required this.element});
  final ImageElement element;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editor = ref.read(editorControllerProvider.notifier);
    return _ToolbarRow(children: [
      _OpacityButton(
        value: element.opacity,
        onCommit: (v) =>
            editor.commitUpdate(element, element.copyWithBase(opacity: v)),
      ),
      const _MoreMenu(),
    ]);
  }
}

class _MultiSelectBar extends ConsumerWidget {
  const _MultiSelectBar({required this.count});
  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _ToolbarRow(children: [
      Text('$count selected', style: const TextStyle(fontSize: 12)),
      const _MoreMenu(showAlign: true),
    ]);
  }
}

class _FontFamilyButton extends StatelessWidget {
  const _FontFamilyButton({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;

  static const fonts = ['Roboto', 'Georgia', 'Courier New', 'Arial'];

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Font',
      onSelected: onChanged,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Text(value, style: const TextStyle(fontSize: 12)),
      ),
      itemBuilder: (context) => [
        for (final f in fonts) PopupMenuItem(value: f, child: Text(f)),
      ],
    );
  }
}

class _FontSizeButton extends StatelessWidget {
  const _FontSizeButton({required this.value, required this.onChanged});
  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<double>(
      tooltip: 'Font size',
      onSelected: onChanged,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Text('${value.round()}', style: const TextStyle(fontSize: 12)),
      ),
      itemBuilder: (context) => [
        for (final s in [12.0, 14.0, 16.0, 18.0, 20.0, 24.0, 32.0, 48.0])
          PopupMenuItem(value: s, child: Text('${s.round()}')),
      ],
    );
  }
}

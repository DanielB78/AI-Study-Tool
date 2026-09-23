import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/canvas/models/camera_state.dart';
import '../../core/canvas/models/canvas_element.dart';
import '../../core/canvas/geometry/point.dart';
import '../controller/editor_controller.dart';

/// Positions a [TextField] overlay over a text or shape-label element.
class TextEditOverlay extends ConsumerStatefulWidget {
  const TextEditOverlay({
    super.key,
    required this.elementId,
    required this.isShapeLabel,
  });

  final String elementId;
  final bool isShapeLabel;

  @override
  ConsumerState<TextEditOverlay> createState() => _TextEditOverlayState();
}

class _TextEditOverlayState extends ConsumerState<TextEditOverlay> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  String _initial = '';

  @override
  void initState() {
    super.initState();
    final editor = ref.read(editorControllerProvider.notifier);
    final el = editor.document.getElementById(widget.elementId);
    if (widget.isShapeLabel && el is ShapeElement) {
      _initial = el.label;
    } else if (el is TextElement) {
      _initial = el.text;
    }
    _controller = TextEditingController(text: _initial);
    _focusNode = FocusNode();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _commit() {
    final editor = ref.read(editorControllerProvider.notifier);
    final interaction = ref.read(interactionControllerProvider.notifier);
    final el = editor.document.getElementById(widget.elementId);
    if (el == null) {
      interaction.endEditing();
      return;
    }
    final text = _controller.text;
    if (widget.isShapeLabel && el is ShapeElement) {
      if (text != el.label) {
        editor.commitUpdate(
          el,
          el.copyWithBase(label: text, updatedAt: DateTime.now().toUtc()),
        );
      }
    } else if (el is TextElement) {
      if (text != el.text) {
        editor.commitUpdate(
          el,
          el.copyWithBase(text: text, updatedAt: DateTime.now().toUtc()),
        );
      }
    }
    interaction.endEditing();
  }

  @override
  Widget build(BuildContext context) {
    final editorState = ref.watch(editorControllerProvider);
    final el = editorState.document.getElementById(widget.elementId);
    if (el == null) return const SizedBox.shrink();

    final camera = editorState.document.camera;
    final topLeft = worldToScreen(Point(el.x, el.y), camera);

    TextStyle style;
    TextAlign align;
    Color? fill;
    double padding = 8;
    double radius = 0;

    if (widget.isShapeLabel && el is ShapeElement) {
      style = TextStyle(
        color: _parse(el.labelColor),
        fontSize: el.labelFontSize * camera.zoom,
        fontFamily: el.labelFontFamily,
        fontWeight: el.labelFontWeight == FontWeightKind.bold
            ? FontWeight.w700
            : FontWeight.w400,
        fontStyle: el.labelItalic ? FontStyle.italic : FontStyle.normal,
      );
      align = TextAlign.center;
      padding = 8 * camera.zoom;
    } else if (el is TextElement) {
      style = TextStyle(
        color: _parse(el.textColor),
        fontSize: el.fontSize * camera.zoom,
        fontFamily: el.fontFamily,
        fontWeight: el.fontWeight == FontWeightKind.bold
            ? FontWeight.w700
            : FontWeight.w400,
        fontStyle: el.italic ? FontStyle.italic : FontStyle.normal,
        decoration: TextDecoration.combine([
          if (el.underline) TextDecoration.underline,
          if (el.strikethrough) TextDecoration.lineThrough,
        ]),
        height: el.lineHeight,
      );
      align = switch (el.textAlign) {
        TextAlignment.left => TextAlign.left,
        TextAlignment.center => TextAlign.center,
        TextAlignment.right => TextAlign.right,
      };
      if (el.backgroundColor != null) {
        fill = _parse(el.backgroundColor!);
      }
      padding = el.padding * camera.zoom;
      radius = el.borderRadius * camera.zoom;
    } else {
      return const SizedBox.shrink();
    }

    final width = el.width * camera.zoom;
    final height = el.height * camera.zoom;

    return Positioned(
      left: topLeft.x,
      top: topLeft.y,
      width: width,
      height: height,
      child: TapRegion(
        onTapOutside: (_) => _commit(),
        child: Material(
          color: fill ?? Colors.transparent,
          borderRadius: BorderRadius.circular(radius),
          child: TextField(
            controller: _controller,
            focusNode: _focusNode,
            maxLines: null,
            expands: true,
            textAlign: align,
            style: style,
            cursorColor: const Color(0xFF2563EB),
            decoration: InputDecoration(
              isDense: true,
              contentPadding: EdgeInsets.all(padding),
              border: InputBorder.none,
            ),
            onSubmitted: (_) => _commit(),
            // Escape handled via Shortcuts higher up when not focused;
            // use callback for cancel:
            onTapOutside: (_) => _commit(),
          ),
        ),
      ),
    );
  }

  Color _parse(String hex) {
    var value = hex.replaceFirst('#', '');
    if (value.length == 6) value = 'FF$value';
    return Color(int.parse(value, radix: 16));
  }
}

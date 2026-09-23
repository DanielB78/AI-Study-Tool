import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Compact reusable colour control with swatches + hex + transparent.
class ColorSwatchButton extends StatelessWidget {
  const ColorSwatchButton({
    super.key,
    required this.color,
    required this.onChanged,
    this.allowTransparent = true,
    this.tooltip = 'Colour',
  });

  final String? color;
  final ValueChanged<String?> onChanged;
  final bool allowTransparent;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final parsed = color == null ? null : _parse(color!);
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => _open(context),
        child: SizedBox(
          width: 32,
          height: 32,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.water_drop_outlined, size: 16),
              const SizedBox(height: 2),
              Container(
                width: 16,
                height: 3,
                decoration: BoxDecoration(
                  color: parsed ?? Colors.transparent,
                  border: Border.all(color: const Color(0x33000000)),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context) async {
    final result = await showDialog<String?>(
      context: context,
      barrierColor: Colors.black26,
      builder: (ctx) => _ColorPickerDialog(
        initial: color,
        allowTransparent: allowTransparent,
      ),
    );
    // null from dismiss vs transparent: use a sentinel — dialog pops with
    // special values.
    if (!context.mounted) return;
    if (result == '__dismiss__') return;
    if (result == '__transparent__') {
      onChanged(null);
    } else if (result != null) {
      onChanged(result);
    }
  }

  static Color _parse(String hex) {
    var value = hex.replaceFirst('#', '');
    if (value.length == 6) value = 'FF$value';
    return Color(int.parse(value, radix: 16));
  }
}

class _ColorPickerDialog extends StatefulWidget {
  const _ColorPickerDialog({
    required this.initial,
    required this.allowTransparent,
  });

  final String? initial;
  final bool allowTransparent;

  @override
  State<_ColorPickerDialog> createState() => _ColorPickerDialogState();
}

class _ColorPickerDialogState extends State<_ColorPickerDialog> {
  static const presets = [
    '#000000',
    '#FFFFFF',
    '#EF4444',
    '#F97316',
    '#EAB308',
    '#22C55E',
    '#14B8A6',
    '#3B82F6',
    '#8B5CF6',
    '#EC4899',
    '#6B7280',
    '#5B8DEF',
    '#1A1A1A',
    '#F4F5F7',
  ];

  late final TextEditingController _hex;
  String? _current;

  @override
  void initState() {
    super.initState();
    _current = widget.initial;
    _hex = TextEditingController(
      text: (widget.initial ?? '').replaceFirst('#', ''),
    );
  }

  @override
  void dispose() {
    _hex.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 280),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Colour', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in presets)
                    GestureDetector(
                      onTap: () => Navigator.pop(context, c),
                      child: Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: ColorSwatchButton._parse(c),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: _current == c
                                ? const Color(0xFF2563EB)
                                : const Color(0x33000000),
                            width: _current == c ? 2 : 1,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Text('#'),
                  const SizedBox(width: 4),
                  Expanded(
                    child: TextField(
                      controller: _hex,
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9a-fA-F]')),
                        LengthLimitingTextInputFormatter(6),
                      ],
                      decoration: const InputDecoration(
                        isDense: true,
                        border: OutlineInputBorder(),
                        hintText: 'RRGGBB',
                      ),
                      onSubmitted: (v) {
                        if (v.length == 6) {
                          Navigator.pop(context, '#$v');
                        }
                      },
                    ),
                  ),
                  IconButton(
                    tooltip: 'Apply hex',
                    onPressed: () {
                      final v = _hex.text;
                      if (v.length == 6) Navigator.pop(context, '#$v');
                    },
                    icon: const Icon(Icons.check, size: 18),
                  ),
                ],
              ),
              if (widget.allowTransparent) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => Navigator.pop(context, '__transparent__'),
                  child: const Text('Transparent / none'),
                ),
              ],
              TextButton(
                onPressed: () => Navigator.pop(context, '__dismiss__'),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

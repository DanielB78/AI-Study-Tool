import 'package:flutter/material.dart';

import '../../core/canvas/models/canvas_element.dart';

/// Dispatches painting for a single element type.
abstract class ElementRenderer {
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  });
}

class ShapeElementRenderer implements ElementRenderer {
  const ShapeElementRenderer();

  @override
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    if (element is! ShapeElement) return;
    final rect = Rect.fromLTWH(
      element.x + liveOffset.dx,
      element.y + liveOffset.dy,
      element.width,
      element.height,
    );

    canvas.save();
    if (element.opacity < 1) {
      canvas.saveLayer(rect.inflate(8), Paint()..color = Color.fromRGBO(0, 0, 0, element.opacity));
    }

    final rrect = switch (element.shapeKind) {
      ShapeKind.roundedRect => RRect.fromRectAndRadius(rect, const Radius.circular(12)),
      ShapeKind.rectangle || ShapeKind.ellipse => null,
    };

    if (element.fill != null) {
      final fillPaint = Paint()
        ..style = PaintingStyle.fill
        ..color = _parseColor(element.fill!);
      switch (element.shapeKind) {
        case ShapeKind.ellipse:
          canvas.drawOval(rect, fillPaint);
        case ShapeKind.roundedRect:
          canvas.drawRRect(rrect!, fillPaint);
        case ShapeKind.rectangle:
          canvas.drawRect(rect, fillPaint);
      }
    }

    if (element.stroke != null && element.strokeWidth > 0) {
      final strokePaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = element.strokeWidth
        ..color = _parseColor(element.stroke!);
      switch (element.shapeKind) {
        case ShapeKind.ellipse:
          canvas.drawOval(rect, strokePaint);
        case ShapeKind.roundedRect:
          canvas.drawRRect(rrect!, strokePaint);
        case ShapeKind.rectangle:
          canvas.drawRect(rect, strokePaint);
      }
    }

    if (element.opacity < 1) {
      canvas.restore();
    }
    canvas.restore();
  }
}

/// Placeholder painters — establish the dispatch pattern without full features.
class TextElementRenderer implements ElementRenderer {
  const TextElementRenderer();

  @override
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    if (element is! TextElement) return;
    final rect = Rect.fromLTWH(
      element.x + liveOffset.dx,
      element.y + liveOffset.dy,
      element.width,
      element.height,
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..color = const Color(0xFF999999);
    canvas.drawRect(rect, paint);
    final tp = TextPainter(
      text: TextSpan(
        text: element.text.isEmpty ? 'Text' : element.text,
        style: TextStyle(
          color: _parseColor(element.color),
          fontSize: element.fontSize,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: element.width);
    tp.paint(canvas, Offset(rect.left, rect.top));
  }
}

class DrawingElementRenderer implements ElementRenderer {
  const DrawingElementRenderer();

  @override
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    if (element is! DrawingElement) return;
    if (element.points.length < 4) return;
    final path = Path();
    path.moveTo(
      element.points[0] + liveOffset.dx,
      element.points[1] + liveOffset.dy,
    );
    for (var i = 2; i + 1 < element.points.length; i += 2) {
      path.lineTo(
        element.points[i] + liveOffset.dx,
        element.points[i + 1] + liveOffset.dy,
      );
    }
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = element.strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = _parseColor(element.color),
    );
  }
}

class ImageElementRenderer implements ElementRenderer {
  const ImageElementRenderer();

  @override
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    if (element is! ImageElement) return;
    final rect = Rect.fromLTWH(
      element.x + liveOffset.dx,
      element.y + liveOffset.dy,
      element.width,
      element.height,
    );
    canvas.drawRect(rect, Paint()..color = const Color(0xFFE8E8E8));
    canvas.drawRect(
      rect,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFFB0B0B0),
    );
  }
}

class ConnectorElementRenderer implements ElementRenderer {
  const ConnectorElementRenderer();

  @override
  void paint(
    Canvas canvas,
    CanvasElement element, {
    required bool selected,
    Offset liveOffset = Offset.zero,
  }) {
    if (element is! ConnectorElement) return;
    canvas.drawLine(
      Offset(element.startX + liveOffset.dx, element.startY + liveOffset.dy),
      Offset(element.endX + liveOffset.dx, element.endY + liveOffset.dy),
      Paint()
        ..color = _parseColor(element.stroke)
        ..strokeWidth = element.strokeWidth
        ..strokeCap = StrokeCap.round,
    );
  }
}

Color _parseColor(String hex) {
  var value = hex.replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  if (value.length != 8) return const Color(0xFF888888);
  return Color(int.parse(value, radix: 16));
}

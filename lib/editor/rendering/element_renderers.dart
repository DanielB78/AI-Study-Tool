import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/canvas/geometry/shape_geometry.dart';
import '../../core/canvas/models/canvas_element.dart';

Color parseCanvasColor(String hex, {double opacity = 1}) {
  var value = hex.replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  if (value.length != 8) return Color.fromRGBO(136, 136, 136, opacity);
  final c = Color(int.parse(value, radix: 16));
  // Color.a is 0..1 in current Flutter (not 0..255).
  return c.withValues(alpha: (c.a * opacity).clamp(0.0, 1.0));
}

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
      canvas.saveLayer(
        rect.inflate(8),
        Paint()..color = Color.fromRGBO(0, 0, 0, element.opacity),
      );
    }

    final path = _shapePath(element, rect);
    if (element.fill != null) {
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.fill
          ..color = parseCanvasColor(element.fill!),
      );
    }
    if (element.stroke != null && element.strokeWidth > 0) {
      final strokePaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = element.strokeWidth
        ..color = parseCanvasColor(element.stroke!);
      if (element.strokeStyle == StrokeStyle.dashed) {
        _drawDashedPath(canvas, path, strokePaint, [8, 6]);
      } else if (element.strokeStyle == StrokeStyle.dotted) {
        _drawDashedPath(canvas, path, strokePaint, [2, 6]);
      } else {
        strokePaint.strokeCap = StrokeCap.round;
        canvas.drawPath(path, strokePaint);
      }
    }

    if (element.label.isNotEmpty) {
      final tp = TextPainter(
        text: TextSpan(
          text: element.label,
          style: TextStyle(
            color: parseCanvasColor(element.labelColor),
            fontSize: element.labelFontSize,
            fontFamily: element.labelFontFamily,
            fontWeight: element.labelFontWeight == FontWeightKind.bold
                ? FontWeight.w700
                : FontWeight.w400,
            fontStyle:
                element.labelItalic ? FontStyle.italic : FontStyle.normal,
          ),
        ),
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: math.max(8, element.width - 16));
      tp.paint(
        canvas,
        Offset(
          rect.center.dx - tp.width / 2,
          rect.center.dy - tp.height / 2,
        ),
      );
    }

    if (element.opacity < 1) canvas.restore();
    canvas.restore();
  }

  Path _shapePath(ShapeElement element, Rect rect) {
    final bounds = element.bounds.translate(
      rect.left - element.x,
      rect.top - element.y,
    );
    // Use world-relative polygon then offset — simpler: rebuild from rect.
    final kind = element.shapeKind;
    if (kind == ShapeKind.ellipse) {
      return Path()..addOval(rect);
    }
    if (kind == ShapeKind.roundedRect) {
      return Path()
        ..addRRect(RRect.fromRectAndRadius(
          rect,
          Radius.circular(element.cornerRadius),
        ));
    }
    if (kind == ShapeKind.rectangle) {
      return Path()..addRect(rect);
    }
    final poly = shapePolygon(
      kind,
      bounds,
      starPoints: element.starPoints,
      starInnerRatio: element.starInnerRatio,
    );
    final path = Path();
    if (poly.isEmpty) return path;
    path.moveTo(poly.first.x, poly.first.y);
    for (var i = 1; i < poly.length; i++) {
      path.lineTo(poly[i].x, poly[i].y);
    }
    path.close();
    return path;
  }
}

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

    canvas.save();
    if (element.opacity < 1) {
      canvas.saveLayer(
        rect.inflate(4),
        Paint()..color = Color.fromRGBO(0, 0, 0, element.opacity),
      );
    }

    if (element.backgroundColor != null) {
      final rrect = RRect.fromRectAndRadius(
        rect,
        Radius.circular(element.borderRadius),
      );
      canvas.drawRRect(
        rrect,
        Paint()..color = parseCanvasColor(element.backgroundColor!),
      );
    }

    final align = switch (element.textAlign) {
      TextAlignment.left => TextAlign.left,
      TextAlignment.center => TextAlign.center,
      TextAlignment.right => TextAlign.right,
    };

    final style = TextStyle(
      color: parseCanvasColor(element.textColor),
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      fontWeight: element.fontWeight == FontWeightKind.bold
          ? FontWeight.w700
          : FontWeight.w400,
      fontStyle: element.italic ? FontStyle.italic : FontStyle.normal,
      decoration: TextDecoration.combine([
        if (element.underline) TextDecoration.underline,
        if (element.strikethrough) TextDecoration.lineThrough,
      ]),
      height: element.lineHeight,
    );

    final tp = TextPainter(
      text: TextSpan(
        text: element.text.isEmpty ? 'Text' : element.text,
        style: style.copyWith(
          color: element.text.isEmpty
              ? parseCanvasColor(element.textColor, opacity: 0.35)
              : style.color,
        ),
      ),
      textAlign: align,
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: math.max(8, element.width - element.padding * 2));

    final dx = switch (element.textAlign) {
      TextAlignment.left => rect.left + element.padding,
      TextAlignment.center =>
        rect.left + (rect.width - tp.width) / 2,
      TextAlignment.right => rect.right - element.padding - tp.width,
    };
    tp.paint(canvas, Offset(dx, rect.top + element.padding));

    if (element.opacity < 1) canvas.restore();
    canvas.restore();
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
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = element.strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = parseCanvasColor(element.color, opacity: element.opacity);
    if (element.strokeStyle == StrokeStyle.dashed) {
      _drawDashedPath(canvas, path, paint, [8, 6]);
    } else if (element.strokeStyle == StrokeStyle.dotted) {
      _drawDashedPath(canvas, path, paint, [2, 6]);
    } else {
      canvas.drawPath(path, paint);
    }
  }
}

class ImageElementRenderer implements ElementRenderer {
  ImageElementRenderer({this.imageCache});

  /// Optional shared cache: src → decoded image.
  final Map<String, ui.Image>? imageCache;

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

    final cached = imageCache?[element.src];
    if (cached != null) {
      paintImage(
        canvas: canvas,
        rect: rect,
        image: cached,
        fit: BoxFit.fill,
        opacity: element.opacity,
      );
      return;
    }

    canvas.drawRect(
      rect,
      Paint()..color = const Color(0xFFE8E8E8).withValues(alpha: element.opacity),
    );
    canvas.drawRect(
      rect,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFFB0B0B0),
    );
    final tp = TextPainter(
      text: const TextSpan(
        text: 'Image',
        style: TextStyle(color: Color(0xFF888888), fontSize: 14),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(
      canvas,
      Offset(rect.center.dx - tp.width / 2, rect.center.dy - tp.height / 2),
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
    final a = Offset(
      element.startX + liveOffset.dx,
      element.startY + liveOffset.dy,
    );
    final b = Offset(
      element.endX + liveOffset.dx,
      element.endY + liveOffset.dy,
    );
    final paint = Paint()
      ..color = parseCanvasColor(element.stroke, opacity: element.opacity)
      ..strokeWidth = element.strokeWidth
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final path = Path()
      ..moveTo(a.dx, a.dy)
      ..lineTo(b.dx, b.dy);

    if (element.strokeStyle == StrokeStyle.dashed) {
      _drawDashedPath(canvas, path, paint, [10, 6]);
    } else if (element.strokeStyle == StrokeStyle.dotted) {
      _drawDashedPath(canvas, path, paint, [2, 6]);
    } else {
      canvas.drawPath(path, paint);
    }

    final heads = element.arrowHeads;
    if (heads == ArrowHeads.end || heads == ArrowHeads.both) {
      _drawArrowHead(canvas, a, b, paint.color, element.strokeWidth);
    }
    if (heads == ArrowHeads.start || heads == ArrowHeads.both) {
      _drawArrowHead(canvas, b, a, paint.color, element.strokeWidth);
    }
  }

  void _drawArrowHead(
    Canvas canvas,
    Offset from,
    Offset to,
    Color color,
    double strokeWidth,
  ) {
    final angle = math.atan2(to.dy - from.dy, to.dx - from.dx);
    final size = 10 + strokeWidth;
    final path = Path()
      ..moveTo(to.dx, to.dy)
      ..lineTo(
        to.dx - size * math.cos(angle - 0.4),
        to.dy - size * math.sin(angle - 0.4),
      )
      ..lineTo(
        to.dx - size * math.cos(angle + 0.4),
        to.dy - size * math.sin(angle + 0.4),
      )
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }
}

void _drawDashedPath(
  Canvas canvas,
  Path source,
  Paint paint,
  List<double> pattern,
) {
  final metrics = source.computeMetrics();
  for (final metric in metrics) {
    var distance = 0.0;
    var draw = true;
    var patternIndex = 0;
    while (distance < metric.length) {
      final len = pattern[patternIndex % pattern.length];
      final next = math.min(distance + len, metric.length);
      if (draw) {
        canvas.drawPath(metric.extractPath(distance, next), paint);
      }
      distance = next;
      draw = !draw;
      patternIndex++;
    }
  }
}

/// Decode image bytes into a ui.Image for the cache.
Future<ui.Image?> decodeUiImage(Uint8List bytes) async {
  try {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  } catch (_) {
    return null;
  }
}

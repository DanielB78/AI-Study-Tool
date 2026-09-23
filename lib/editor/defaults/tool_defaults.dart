import 'package:equatable/equatable.dart';

import '../../core/canvas/models/canvas_element.dart';

/// Defaults applied when creating new elements (and when Text/shape tools are
/// active with nothing selected).
class ToolDefaults extends Equatable {
  const ToolDefaults({
    this.textFontFamily = 'Roboto',
    this.textFontSize = 18,
    this.textFontWeight = FontWeightKind.normal,
    this.textItalic = false,
    this.textUnderline = false,
    this.textStrikethrough = false,
    this.textColor = '#1A1A1A',
    this.textBackgroundColor,
    this.textAlign = TextAlignment.left,
    this.shapeKind = ShapeKind.rectangle,
    this.shapeFill = '#5B8DEF',
    this.shapeStroke = '#2F5FBF',
    this.shapeStrokeWidth = 2,
    this.shapeStrokeStyle = StrokeStyle.solid,
    this.shapeCornerRadius = 12,
    this.shapeOpacity = 1,
    this.penColor = '#1A1A1A',
    this.penWidth = 3,
    this.penOpacity = 1,
    this.lineColor = '#666666',
    this.lineWidth = 2,
    this.lineStrokeStyle = StrokeStyle.solid,
    this.arrowColor = '#666666',
    this.arrowWidth = 2,
    this.arrowStrokeStyle = StrokeStyle.solid,
    this.arrowHeads = ArrowHeads.end,
  });

  final String textFontFamily;
  final double textFontSize;
  final FontWeightKind textFontWeight;
  final bool textItalic;
  final bool textUnderline;
  final bool textStrikethrough;
  final String textColor;
  final String? textBackgroundColor;
  final TextAlignment textAlign;

  final ShapeKind shapeKind;
  final String? shapeFill;
  final String? shapeStroke;
  final double shapeStrokeWidth;
  final StrokeStyle shapeStrokeStyle;
  final double shapeCornerRadius;
  final double shapeOpacity;

  final String penColor;
  final double penWidth;
  final double penOpacity;

  final String lineColor;
  final double lineWidth;
  final StrokeStyle lineStrokeStyle;

  final String arrowColor;
  final double arrowWidth;
  final StrokeStyle arrowStrokeStyle;
  final ArrowHeads arrowHeads;

  ToolDefaults copyWith({
    String? textFontFamily,
    double? textFontSize,
    FontWeightKind? textFontWeight,
    bool? textItalic,
    bool? textUnderline,
    bool? textStrikethrough,
    String? textColor,
    String? textBackgroundColor,
    bool clearTextBackground = false,
    TextAlignment? textAlign,
    ShapeKind? shapeKind,
    String? shapeFill,
    String? shapeStroke,
    bool clearShapeFill = false,
    bool clearShapeStroke = false,
    double? shapeStrokeWidth,
    StrokeStyle? shapeStrokeStyle,
    double? shapeCornerRadius,
    double? shapeOpacity,
    String? penColor,
    double? penWidth,
    double? penOpacity,
    String? lineColor,
    double? lineWidth,
    StrokeStyle? lineStrokeStyle,
    String? arrowColor,
    double? arrowWidth,
    StrokeStyle? arrowStrokeStyle,
    ArrowHeads? arrowHeads,
  }) {
    return ToolDefaults(
      textFontFamily: textFontFamily ?? this.textFontFamily,
      textFontSize: textFontSize ?? this.textFontSize,
      textFontWeight: textFontWeight ?? this.textFontWeight,
      textItalic: textItalic ?? this.textItalic,
      textUnderline: textUnderline ?? this.textUnderline,
      textStrikethrough: textStrikethrough ?? this.textStrikethrough,
      textColor: textColor ?? this.textColor,
      textBackgroundColor: clearTextBackground
          ? null
          : (textBackgroundColor ?? this.textBackgroundColor),
      textAlign: textAlign ?? this.textAlign,
      shapeKind: shapeKind ?? this.shapeKind,
      shapeFill: clearShapeFill ? null : (shapeFill ?? this.shapeFill),
      shapeStroke: clearShapeStroke ? null : (shapeStroke ?? this.shapeStroke),
      shapeStrokeWidth: shapeStrokeWidth ?? this.shapeStrokeWidth,
      shapeStrokeStyle: shapeStrokeStyle ?? this.shapeStrokeStyle,
      shapeCornerRadius: shapeCornerRadius ?? this.shapeCornerRadius,
      shapeOpacity: shapeOpacity ?? this.shapeOpacity,
      penColor: penColor ?? this.penColor,
      penWidth: penWidth ?? this.penWidth,
      penOpacity: penOpacity ?? this.penOpacity,
      lineColor: lineColor ?? this.lineColor,
      lineWidth: lineWidth ?? this.lineWidth,
      lineStrokeStyle: lineStrokeStyle ?? this.lineStrokeStyle,
      arrowColor: arrowColor ?? this.arrowColor,
      arrowWidth: arrowWidth ?? this.arrowWidth,
      arrowStrokeStyle: arrowStrokeStyle ?? this.arrowStrokeStyle,
      arrowHeads: arrowHeads ?? this.arrowHeads,
    );
  }

  @override
  List<Object?> get props => [
        textFontFamily,
        textFontSize,
        textFontWeight,
        textItalic,
        textUnderline,
        textStrikethrough,
        textColor,
        textBackgroundColor,
        textAlign,
        shapeKind,
        shapeFill,
        shapeStroke,
        shapeStrokeWidth,
        shapeStrokeStyle,
        shapeCornerRadius,
        shapeOpacity,
        penColor,
        penWidth,
        penOpacity,
        lineColor,
        lineWidth,
        lineStrokeStyle,
        arrowColor,
        arrowWidth,
        arrowStrokeStyle,
        arrowHeads,
      ];
}

import 'package:equatable/equatable.dart';

import '../geometry/rect.dart';
import 'ids.dart';
import 'style_enums.dart';

export 'style_enums.dart';

/// Element type discriminant for serialization and queries.
enum CanvasElementType {
  text,
  shape,
  drawing,
  image,
  connector;

  String get wireName => name;

  static CanvasElementType fromWire(String value) {
    return CanvasElementType.values.firstWhere(
      (e) => e.name == value,
      orElse: () => throw ArgumentError('Unknown element type: $value'),
    );
  }
}

/// Shape kinds for [ShapeElement].
enum ShapeKind {
  rectangle,
  roundedRect,
  ellipse,
  triangle,
  diamond,
  pentagon,
  hexagon,
  star,
  parallelogram,
  callout;

  String get wireName => name;

  static ShapeKind fromWire(String value) {
    return ShapeKind.values.firstWhere(
      (e) => e.name == value,
      orElse: () => ShapeKind.rectangle,
    );
  }
}

/// Common geometry and identity for every canvas object (world coordinates).
sealed class CanvasElement extends Equatable {
  const CanvasElement({
    required this.id,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.rotation = 0,
    this.zIndex = 0,
    this.opacity = 1,
    this.locked = false,
    required this.createdAt,
    required this.updatedAt,
    this.metadata = const {},
  });

  final String id;
  final double x;
  final double y;
  final double width;
  final double height;
  final double rotation;
  final int zIndex;
  final double opacity;
  final bool locked;
  final DateTime createdAt;
  final DateTime updatedAt;
  final Map<String, Object?> metadata;

  CanvasElementType get type;

  Rect2 get bounds => Rect2(x: x, y: y, width: width, height: height);

  CanvasElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
  });

  /// Duplicate with a fresh stable ID (and optional offset).
  CanvasElement duplicate({required String newId, double dx = 0, double dy = 0});

  Map<String, dynamic> toJson();

  static CanvasElement fromJson(Map<String, dynamic> json) {
    final type = CanvasElementType.fromWire(json['type'] as String);
    return switch (type) {
      CanvasElementType.text => TextElement.fromJson(json),
      CanvasElementType.shape => ShapeElement.fromJson(json),
      CanvasElementType.drawing => DrawingElement.fromJson(json),
      CanvasElementType.image => ImageElement.fromJson(json),
      CanvasElementType.connector => ConnectorElement.fromJson(json),
    };
  }

  static Map<String, dynamic> baseToJson(CanvasElement e) => {
        'id': e.id,
        'type': e.type.wireName,
        'x': e.x,
        'y': e.y,
        'width': e.width,
        'height': e.height,
        'rotation': e.rotation,
        'zIndex': e.zIndex,
        'opacity': e.opacity,
        'locked': e.locked,
        'createdAt': e.createdAt.toIso8601String(),
        'updatedAt': e.updatedAt.toIso8601String(),
        'metadata': e.metadata,
      };

  static (
    String id,
    double x,
    double y,
    double width,
    double height,
    double rotation,
    int zIndex,
    double opacity,
    bool locked,
    DateTime createdAt,
    DateTime updatedAt,
    Map<String, Object?> metadata,
  ) parseBase(Map<String, dynamic> json) {
    return (
      json['id'] as String,
      (json['x'] as num).toDouble(),
      (json['y'] as num).toDouble(),
      (json['width'] as num).toDouble(),
      (json['height'] as num).toDouble(),
      (json['rotation'] as num?)?.toDouble() ?? 0,
      (json['zIndex'] as num?)?.toInt() ?? 0,
      (json['opacity'] as num?)?.toDouble() ?? 1,
      json['locked'] as bool? ?? false,
      DateTime.parse(json['createdAt'] as String),
      DateTime.parse(json['updatedAt'] as String),
      Map<String, Object?>.from(
        (json['metadata'] as Map?)?.cast<String, Object?>() ?? const {},
      ),
    );
  }

  @override
  List<Object?> get props => [
        id,
        type,
        x,
        y,
        width,
        height,
        rotation,
        zIndex,
        opacity,
        locked,
        createdAt,
        updatedAt,
        metadata,
      ];
}

/// Structured text — never rasterized.
final class TextElement extends CanvasElement {
  const TextElement({
    required super.id,
    required super.x,
    required super.y,
    required super.width,
    required super.height,
    super.rotation,
    super.zIndex,
    super.opacity,
    super.locked,
    required super.createdAt,
    required super.updatedAt,
    super.metadata,
    this.text = '',
    this.fontFamily = 'Roboto',
    this.fontSize = 18,
    this.fontWeight = FontWeightKind.normal,
    this.italic = false,
    this.underline = false,
    this.strikethrough = false,
    this.textColor = '#1A1A1A',
    this.backgroundColor,
    this.textAlign = TextAlignment.left,
    this.lineHeight = 1.35,
    this.padding = 8,
    this.borderRadius = 0,
  });

  final String text;
  final String fontFamily;
  final double fontSize;
  final FontWeightKind fontWeight;
  final bool italic;
  final bool underline;
  final bool strikethrough;
  final String textColor;
  final String? backgroundColor;
  final TextAlignment textAlign;
  final double lineHeight;
  final double padding;
  final double borderRadius;

  @override
  CanvasElementType get type => CanvasElementType.text;

  factory TextElement.create({
    required double x,
    required double y,
    double width = 220,
    double height = 48,
    String text = '',
    int zIndex = 0,
    String? id,
    String fontFamily = 'Roboto',
    double fontSize = 18,
    FontWeightKind fontWeight = FontWeightKind.normal,
    bool italic = false,
    bool underline = false,
    bool strikethrough = false,
    String textColor = '#1A1A1A',
    String? backgroundColor,
    TextAlignment textAlign = TextAlignment.left,
  }) {
    final now = DateTime.now().toUtc();
    return TextElement(
      id: id ?? generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      text: text,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      italic: italic,
      underline: underline,
      strikethrough: strikethrough,
      textColor: textColor,
      backgroundColor: backgroundColor,
      textAlign: textAlign,
    );
  }

  @override
  TextElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
    String? text,
    String? fontFamily,
    double? fontSize,
    FontWeightKind? fontWeight,
    bool? italic,
    bool? underline,
    bool? strikethrough,
    String? textColor,
    String? backgroundColor,
    bool clearBackground = false,
    TextAlignment? textAlign,
    double? lineHeight,
    double? padding,
    double? borderRadius,
  }) {
    return TextElement(
      id: id,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotation: rotation ?? this.rotation,
      zIndex: zIndex ?? this.zIndex,
      opacity: opacity ?? this.opacity,
      locked: locked ?? this.locked,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      text: text ?? this.text,
      fontFamily: fontFamily ?? this.fontFamily,
      fontSize: fontSize ?? this.fontSize,
      fontWeight: fontWeight ?? this.fontWeight,
      italic: italic ?? this.italic,
      underline: underline ?? this.underline,
      strikethrough: strikethrough ?? this.strikethrough,
      textColor: textColor ?? this.textColor,
      backgroundColor:
          clearBackground ? null : (backgroundColor ?? this.backgroundColor),
      textAlign: textAlign ?? this.textAlign,
      lineHeight: lineHeight ?? this.lineHeight,
      padding: padding ?? this.padding,
      borderRadius: borderRadius ?? this.borderRadius,
    );
  }

  @override
  TextElement duplicate({required String newId, double dx = 0, double dy = 0}) {
    final now = DateTime.now().toUtc();
    return copyWithBase(x: x + dx, y: y + dy, updatedAt: now).copyWithId(newId);
  }

  TextElement copyWithId(String newId) {
    return TextElement(
      id: newId,
      x: x,
      y: y,
      width: width,
      height: height,
      rotation: rotation,
      zIndex: zIndex,
      opacity: opacity,
      locked: locked,
      createdAt: DateTime.now().toUtc(),
      updatedAt: DateTime.now().toUtc(),
      metadata: metadata,
      text: text,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      italic: italic,
      underline: underline,
      strikethrough: strikethrough,
      textColor: textColor,
      backgroundColor: backgroundColor,
      textAlign: textAlign,
      lineHeight: lineHeight,
      padding: padding,
      borderRadius: borderRadius,
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'text': text,
        'fontFamily': fontFamily,
        'fontSize': fontSize,
        'fontWeight': fontWeight.wireName,
        'italic': italic,
        'underline': underline,
        'strikethrough': strikethrough,
        'textColor': textColor,
        'color': textColor, // v1 compat
        'backgroundColor': backgroundColor,
        'textAlign': textAlign.wireName,
        'lineHeight': lineHeight,
        'padding': padding,
        'borderRadius': borderRadius,
      };

  factory TextElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
    return TextElement(
      id: b.$1,
      x: b.$2,
      y: b.$3,
      width: b.$4,
      height: b.$5,
      rotation: b.$6,
      zIndex: b.$7,
      opacity: b.$8,
      locked: b.$9,
      createdAt: b.$10,
      updatedAt: b.$11,
      metadata: b.$12,
      text: json['text'] as String? ?? '',
      fontFamily: json['fontFamily'] as String? ?? 'Roboto',
      fontSize: (json['fontSize'] as num?)?.toDouble() ?? 18,
      fontWeight: FontWeightKind.fromWire(json['fontWeight'] as String?),
      italic: json['italic'] as bool? ?? json['fontItalic'] as bool? ?? false,
      underline: json['underline'] as bool? ?? false,
      strikethrough: json['strikethrough'] as bool? ?? false,
      textColor: json['textColor'] as String? ??
          json['color'] as String? ??
          '#1A1A1A',
      backgroundColor: json['backgroundColor'] as String?,
      textAlign: TextAlignment.fromWire(
        json['textAlign'] as String? ?? json['alignment'] as String?,
      ),
      lineHeight: (json['lineHeight'] as num?)?.toDouble() ?? 1.35,
      padding: (json['padding'] as num?)?.toDouble() ?? 8,
      borderRadius: (json['borderRadius'] as num?)?.toDouble() ??
          (json['cornerRadius'] as num?)?.toDouble() ??
          0,
    );
  }

  @override
  List<Object?> get props => [
        ...super.props,
        text,
        fontFamily,
        fontSize,
        fontWeight,
        italic,
        underline,
        strikethrough,
        textColor,
        backgroundColor,
        textAlign,
        lineHeight,
        padding,
        borderRadius,
      ];
}

/// Structured shape with optional semantic label for RAG.
final class ShapeElement extends CanvasElement {
  const ShapeElement({
    required super.id,
    required super.x,
    required super.y,
    required super.width,
    required super.height,
    super.rotation,
    super.zIndex,
    super.opacity,
    super.locked,
    required super.createdAt,
    required super.updatedAt,
    super.metadata,
    this.shapeKind = ShapeKind.rectangle,
    this.fill = '#5B8DEF',
    this.stroke = '#2F5FBF',
    this.strokeWidth = 2,
    this.strokeStyle = StrokeStyle.solid,
    this.cornerRadius = 12,
    this.starPoints = 5,
    this.starInnerRatio = 0.45,
    this.label = '',
    this.labelFontSize = 16,
    this.labelFontFamily = 'Roboto',
    this.labelFontWeight = FontWeightKind.normal,
    this.labelItalic = false,
    this.labelColor = '#1A1A1A',
  });

  final ShapeKind shapeKind;
  final String? fill;
  final String? stroke;
  final double strokeWidth;
  final StrokeStyle strokeStyle;
  final double cornerRadius;
  final int starPoints;
  final double starInnerRatio;

  /// Semantic label text rendered inside the shape (RAG-readable).
  final String label;
  final double labelFontSize;
  final String labelFontFamily;
  final FontWeightKind labelFontWeight;
  final bool labelItalic;
  final String labelColor;

  @override
  CanvasElementType get type => CanvasElementType.shape;

  factory ShapeElement.create({
    required double x,
    required double y,
    double width = 160,
    double height = 100,
    ShapeKind shapeKind = ShapeKind.rectangle,
    String? fill = '#5B8DEF',
    String? stroke = '#2F5FBF',
    double strokeWidth = 2,
    StrokeStyle strokeStyle = StrokeStyle.solid,
    double cornerRadius = 12,
    int zIndex = 0,
    bool locked = false,
    String? id,
    String label = '',
  }) {
    final now = DateTime.now().toUtc();
    return ShapeElement(
      id: id ?? generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      locked: locked,
      createdAt: now,
      updatedAt: now,
      shapeKind: shapeKind,
      fill: fill,
      stroke: stroke,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      cornerRadius: cornerRadius,
      label: label,
    );
  }

  @override
  ShapeElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
    ShapeKind? shapeKind,
    String? fill,
    String? stroke,
    double? strokeWidth,
    StrokeStyle? strokeStyle,
    double? cornerRadius,
    int? starPoints,
    double? starInnerRatio,
    String? label,
    double? labelFontSize,
    String? labelFontFamily,
    FontWeightKind? labelFontWeight,
    bool? labelItalic,
    String? labelColor,
    bool clearFill = false,
    bool clearStroke = false,
  }) {
    return ShapeElement(
      id: id,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotation: rotation ?? this.rotation,
      zIndex: zIndex ?? this.zIndex,
      opacity: opacity ?? this.opacity,
      locked: locked ?? this.locked,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      shapeKind: shapeKind ?? this.shapeKind,
      fill: clearFill ? null : (fill ?? this.fill),
      stroke: clearStroke ? null : (stroke ?? this.stroke),
      strokeWidth: strokeWidth ?? this.strokeWidth,
      strokeStyle: strokeStyle ?? this.strokeStyle,
      cornerRadius: cornerRadius ?? this.cornerRadius,
      starPoints: starPoints ?? this.starPoints,
      starInnerRatio: starInnerRatio ?? this.starInnerRatio,
      label: label ?? this.label,
      labelFontSize: labelFontSize ?? this.labelFontSize,
      labelFontFamily: labelFontFamily ?? this.labelFontFamily,
      labelFontWeight: labelFontWeight ?? this.labelFontWeight,
      labelItalic: labelItalic ?? this.labelItalic,
      labelColor: labelColor ?? this.labelColor,
    );
  }

  @override
  ShapeElement duplicate({required String newId, double dx = 0, double dy = 0}) {
    final now = DateTime.now().toUtc();
    return ShapeElement(
      id: newId,
      x: x + dx,
      y: y + dy,
      width: width,
      height: height,
      rotation: rotation,
      zIndex: zIndex,
      opacity: opacity,
      locked: locked,
      createdAt: now,
      updatedAt: now,
      metadata: metadata,
      shapeKind: shapeKind,
      fill: fill,
      stroke: stroke,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      cornerRadius: cornerRadius,
      starPoints: starPoints,
      starInnerRatio: starInnerRatio,
      label: label,
      labelFontSize: labelFontSize,
      labelFontFamily: labelFontFamily,
      labelFontWeight: labelFontWeight,
      labelItalic: labelItalic,
      labelColor: labelColor,
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'shapeKind': shapeKind.wireName,
        'fill': fill,
        'stroke': stroke,
        'strokeWidth': strokeWidth,
        'strokeStyle': strokeStyle.wireName,
        'cornerRadius': cornerRadius,
        'starPoints': starPoints,
        'starInnerRatio': starInnerRatio,
        'label': label,
        'labelFontSize': labelFontSize,
        'labelFontFamily': labelFontFamily,
        'labelFontWeight': labelFontWeight.wireName,
        'labelItalic': labelItalic,
        'labelColor': labelColor,
      };

  factory ShapeElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
    return ShapeElement(
      id: b.$1,
      x: b.$2,
      y: b.$3,
      width: b.$4,
      height: b.$5,
      rotation: b.$6,
      zIndex: b.$7,
      opacity: b.$8,
      locked: b.$9,
      createdAt: b.$10,
      updatedAt: b.$11,
      metadata: b.$12,
      shapeKind: ShapeKind.fromWire(json['shapeKind'] as String? ?? 'rectangle'),
      fill: json['fill'] as String?,
      stroke: json['stroke'] as String?,
      strokeWidth: (json['strokeWidth'] as num?)?.toDouble() ?? 2,
      strokeStyle: StrokeStyle.fromWire(json['strokeStyle'] as String?),
      cornerRadius: (json['cornerRadius'] as num?)?.toDouble() ?? 12,
      starPoints: (json['starPoints'] as num?)?.toInt() ?? 5,
      starInnerRatio: (json['starInnerRatio'] as num?)?.toDouble() ?? 0.45,
      label: json['label'] as String? ?? '',
      labelFontSize: (json['labelFontSize'] as num?)?.toDouble() ?? 16,
      labelFontFamily: json['labelFontFamily'] as String? ?? 'Roboto',
      labelFontWeight:
          FontWeightKind.fromWire(json['labelFontWeight'] as String?),
      labelItalic: json['labelItalic'] as bool? ?? false,
      labelColor: json['labelColor'] as String? ?? '#1A1A1A',
    );
  }

  @override
  List<Object?> get props => [
        ...super.props,
        shapeKind,
        fill,
        stroke,
        strokeWidth,
        strokeStyle,
        cornerRadius,
        starPoints,
        starInnerRatio,
        label,
        labelFontSize,
        labelFontFamily,
        labelFontWeight,
        labelItalic,
        labelColor,
      ];
}

/// Freehand stroke — points are absolute world coordinates [x0,y0,x1,y1,...].
final class DrawingElement extends CanvasElement {
  const DrawingElement({
    required super.id,
    required super.x,
    required super.y,
    required super.width,
    required super.height,
    super.rotation,
    super.zIndex,
    super.opacity,
    super.locked,
    required super.createdAt,
    required super.updatedAt,
    super.metadata,
    this.points = const [],
    this.color = '#1A1A1A',
    this.strokeWidth = 3,
    this.strokeStyle = StrokeStyle.solid,
  });

  final List<double> points;
  final String color;
  final double strokeWidth;
  final StrokeStyle strokeStyle;

  @override
  CanvasElementType get type => CanvasElementType.drawing;

  factory DrawingElement.fromPoints({
    required List<double> absolutePoints,
    required String color,
    required double strokeWidth,
    StrokeStyle strokeStyle = StrokeStyle.solid,
    int zIndex = 0,
    String? id,
  }) {
    assert(absolutePoints.length >= 4);
    var minX = absolutePoints[0];
    var minY = absolutePoints[1];
    var maxX = minX;
    var maxY = minY;
    for (var i = 0; i < absolutePoints.length; i += 2) {
      final px = absolutePoints[i];
      final py = absolutePoints[i + 1];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    final pad = strokeWidth;
    final now = DateTime.now().toUtc();
    return DrawingElement(
      id: id ?? generateId(),
      x: minX - pad,
      y: minY - pad,
      width: (maxX - minX) + pad * 2,
      height: (maxY - minY) + pad * 2,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      points: List<double>.from(absolutePoints),
      color: color,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
    );
  }

  @override
  DrawingElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
    List<double>? points,
    String? color,
    double? strokeWidth,
    StrokeStyle? strokeStyle,
  }) {
    return DrawingElement(
      id: id,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotation: rotation ?? this.rotation,
      zIndex: zIndex ?? this.zIndex,
      opacity: opacity ?? this.opacity,
      locked: locked ?? this.locked,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      points: points ?? this.points,
      color: color ?? this.color,
      strokeWidth: strokeWidth ?? this.strokeWidth,
      strokeStyle: strokeStyle ?? this.strokeStyle,
    );
  }

  @override
  DrawingElement duplicate({required String newId, double dx = 0, double dy = 0}) {
    final now = DateTime.now().toUtc();
    final shifted = <double>[];
    for (var i = 0; i < points.length; i += 2) {
      shifted.add(points[i] + dx);
      shifted.add(points[i + 1] + dy);
    }
    return DrawingElement(
      id: newId,
      x: x + dx,
      y: y + dy,
      width: width,
      height: height,
      rotation: rotation,
      zIndex: zIndex,
      opacity: opacity,
      locked: locked,
      createdAt: now,
      updatedAt: now,
      metadata: metadata,
      points: shifted,
      color: color,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
    );
  }

  /// Translate stroke points when the element is moved.
  DrawingElement movedBy(double dx, double dy) {
    final shifted = <double>[];
    for (var i = 0; i < points.length; i += 2) {
      shifted.add(points[i] + dx);
      shifted.add(points[i + 1] + dy);
    }
    return copyWithBase(
      x: x + dx,
      y: y + dy,
      points: shifted,
      updatedAt: DateTime.now().toUtc(),
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'points': points,
        'color': color,
        'strokeWidth': strokeWidth,
        'strokeStyle': strokeStyle.wireName,
      };

  factory DrawingElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
    return DrawingElement(
      id: b.$1,
      x: b.$2,
      y: b.$3,
      width: b.$4,
      height: b.$5,
      rotation: b.$6,
      zIndex: b.$7,
      opacity: b.$8,
      locked: b.$9,
      createdAt: b.$10,
      updatedAt: b.$11,
      metadata: b.$12,
      points: (json['points'] as List?)
              ?.map((e) => (e as num).toDouble())
              .toList() ??
          const [],
      color: json['color'] as String? ?? '#1A1A1A',
      strokeWidth: (json['strokeWidth'] as num?)?.toDouble() ?? 3,
      strokeStyle: StrokeStyle.fromWire(json['strokeStyle'] as String?),
    );
  }

  @override
  List<Object?> get props =>
      [...super.props, points, color, strokeWidth, strokeStyle];
}

/// Image referenced by a local/storage URI — not necessarily embedded bytes.
final class ImageElement extends CanvasElement {
  const ImageElement({
    required super.id,
    required super.x,
    required super.y,
    required super.width,
    required super.height,
    super.rotation,
    super.zIndex,
    super.opacity,
    super.locked,
    required super.createdAt,
    required super.updatedAt,
    super.metadata,
    this.src = '',
    this.naturalWidth = 0,
    this.naturalHeight = 0,
  });

  /// File path, asset key, or future cloud URL.
  final String src;
  final double naturalWidth;
  final double naturalHeight;

  @override
  CanvasElementType get type => CanvasElementType.image;

  factory ImageElement.create({
    required double x,
    required double y,
    required double width,
    required double height,
    required String src,
    double naturalWidth = 0,
    double naturalHeight = 0,
    int zIndex = 0,
    String? id,
  }) {
    final now = DateTime.now().toUtc();
    return ImageElement(
      id: id ?? generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      src: src,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
    );
  }

  @override
  ImageElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
    String? src,
    double? naturalWidth,
    double? naturalHeight,
  }) {
    return ImageElement(
      id: id,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotation: rotation ?? this.rotation,
      zIndex: zIndex ?? this.zIndex,
      opacity: opacity ?? this.opacity,
      locked: locked ?? this.locked,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      src: src ?? this.src,
      naturalWidth: naturalWidth ?? this.naturalWidth,
      naturalHeight: naturalHeight ?? this.naturalHeight,
    );
  }

  @override
  ImageElement duplicate({required String newId, double dx = 0, double dy = 0}) {
    final now = DateTime.now().toUtc();
    return ImageElement(
      id: newId,
      x: x + dx,
      y: y + dy,
      width: width,
      height: height,
      rotation: rotation,
      zIndex: zIndex,
      opacity: opacity,
      locked: locked,
      createdAt: now,
      updatedAt: now,
      metadata: metadata,
      src: src,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'src': src,
        'naturalWidth': naturalWidth,
        'naturalHeight': naturalHeight,
      };

  factory ImageElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
    return ImageElement(
      id: b.$1,
      x: b.$2,
      y: b.$3,
      width: b.$4,
      height: b.$5,
      rotation: b.$6,
      zIndex: b.$7,
      opacity: b.$8,
      locked: b.$9,
      createdAt: b.$10,
      updatedAt: b.$11,
      metadata: b.$12,
      src: json['src'] as String? ?? '',
      naturalWidth: (json['naturalWidth'] as num?)?.toDouble() ?? 0,
      naturalHeight: (json['naturalHeight'] as num?)?.toDouble() ?? 0,
    );
  }

  @override
  List<Object?> get props =>
      [...super.props, src, naturalWidth, naturalHeight];
}

/// Line / arrow connector — future RAG graph edge via binding IDs.
final class ConnectorElement extends CanvasElement {
  const ConnectorElement({
    required super.id,
    required super.x,
    required super.y,
    required super.width,
    required super.height,
    super.rotation,
    super.zIndex,
    super.opacity,
    super.locked,
    required super.createdAt,
    required super.updatedAt,
    super.metadata,
    this.startX = 0,
    this.startY = 0,
    this.endX = 0,
    this.endY = 0,
    this.startBindingId,
    this.endBindingId,
    this.stroke = '#666666',
    this.strokeWidth = 2,
    this.strokeStyle = StrokeStyle.solid,
    this.connectorKind = ConnectorKind.line,
    this.arrowHeads = ArrowHeads.none,
  });

  final double startX;
  final double startY;
  final double endX;
  final double endY;
  final String? startBindingId;
  final String? endBindingId;
  final String stroke;
  final double strokeWidth;
  final StrokeStyle strokeStyle;
  final ConnectorKind connectorKind;
  final ArrowHeads arrowHeads;

  @override
  CanvasElementType get type => CanvasElementType.connector;

  factory ConnectorElement.create({
    required double startX,
    required double startY,
    required double endX,
    required double endY,
    String? startBindingId,
    String? endBindingId,
    String stroke = '#666666',
    double strokeWidth = 2,
    StrokeStyle strokeStyle = StrokeStyle.solid,
    ConnectorKind connectorKind = ConnectorKind.line,
    ArrowHeads arrowHeads = ArrowHeads.none,
    int zIndex = 0,
    String? id,
  }) {
    final now = DateTime.now().toUtc();
    final minX = startX < endX ? startX : endX;
    final minY = startY < endY ? startY : endY;
    final pad = strokeWidth * 4;
    return ConnectorElement(
      id: id ?? generateId(),
      x: minX - pad,
      y: minY - pad,
      width: (endX - startX).abs() + pad * 2,
      height: (endY - startY).abs() + pad * 2,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      startBindingId: startBindingId,
      endBindingId: endBindingId,
      stroke: stroke,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      connectorKind: connectorKind,
      arrowHeads: arrowHeads,
    );
  }

  @override
  ConnectorElement copyWithBase({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotation,
    int? zIndex,
    double? opacity,
    bool? locked,
    DateTime? updatedAt,
    Map<String, Object?>? metadata,
    double? startX,
    double? startY,
    double? endX,
    double? endY,
    String? startBindingId,
    String? endBindingId,
    String? stroke,
    double? strokeWidth,
    StrokeStyle? strokeStyle,
    ConnectorKind? connectorKind,
    ArrowHeads? arrowHeads,
    bool clearStartBinding = false,
    bool clearEndBinding = false,
  }) {
    return ConnectorElement(
      id: id,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotation: rotation ?? this.rotation,
      zIndex: zIndex ?? this.zIndex,
      opacity: opacity ?? this.opacity,
      locked: locked ?? this.locked,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      startX: startX ?? this.startX,
      startY: startY ?? this.startY,
      endX: endX ?? this.endX,
      endY: endY ?? this.endY,
      startBindingId:
          clearStartBinding ? null : (startBindingId ?? this.startBindingId),
      endBindingId:
          clearEndBinding ? null : (endBindingId ?? this.endBindingId),
      stroke: stroke ?? this.stroke,
      strokeWidth: strokeWidth ?? this.strokeWidth,
      strokeStyle: strokeStyle ?? this.strokeStyle,
      connectorKind: connectorKind ?? this.connectorKind,
      arrowHeads: arrowHeads ?? this.arrowHeads,
    );
  }

  @override
  ConnectorElement duplicate({
    required String newId,
    double dx = 0,
    double dy = 0,
  }) {
    return ConnectorElement.create(
      id: newId,
      startX: startX + dx,
      startY: startY + dy,
      endX: endX + dx,
      endY: endY + dy,
      stroke: stroke,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      connectorKind: connectorKind,
      arrowHeads: arrowHeads,
      zIndex: zIndex,
      // Bindings intentionally cleared on duplicate — remapped by caller if needed.
    ).copyWithBase(opacity: opacity, locked: locked);
  }

  ConnectorElement movedBy(double dx, double dy) {
    return ConnectorElement.create(
      id: id,
      startX: startX + dx,
      startY: startY + dy,
      endX: endX + dx,
      endY: endY + dy,
      startBindingId: startBindingId,
      endBindingId: endBindingId,
      stroke: stroke,
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      connectorKind: connectorKind,
      arrowHeads: arrowHeads,
      zIndex: zIndex,
    ).copyWithBase(
      opacity: opacity,
      locked: locked,
      rotation: rotation,
      metadata: metadata,
      updatedAt: DateTime.now().toUtc(),
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'startX': startX,
        'startY': startY,
        'endX': endX,
        'endY': endY,
        'startBindingId': startBindingId,
        'endBindingId': endBindingId,
        'stroke': stroke,
        'strokeWidth': strokeWidth,
        'strokeStyle': strokeStyle.wireName,
        'connectorKind': connectorKind.wireName,
        'arrowHeads': arrowHeads.wireName,
      };

  factory ConnectorElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
    final kind = ConnectorKind.fromWire(json['connectorKind'] as String?);
    var heads = ArrowHeads.fromWire(json['arrowHeads'] as String?);
    if (json['arrowHeads'] == null && kind == ConnectorKind.arrow) {
      heads = ArrowHeads.end;
    }
    return ConnectorElement(
      id: b.$1,
      x: b.$2,
      y: b.$3,
      width: b.$4,
      height: b.$5,
      rotation: b.$6,
      zIndex: b.$7,
      opacity: b.$8,
      locked: b.$9,
      createdAt: b.$10,
      updatedAt: b.$11,
      metadata: b.$12,
      startX: (json['startX'] as num?)?.toDouble() ?? 0,
      startY: (json['startY'] as num?)?.toDouble() ?? 0,
      endX: (json['endX'] as num?)?.toDouble() ?? 0,
      endY: (json['endY'] as num?)?.toDouble() ?? 0,
      startBindingId: json['startBindingId'] as String?,
      endBindingId: json['endBindingId'] as String?,
      stroke: json['stroke'] as String? ?? '#666666',
      strokeWidth: (json['strokeWidth'] as num?)?.toDouble() ?? 2,
      strokeStyle: StrokeStyle.fromWire(json['strokeStyle'] as String?),
      connectorKind: kind,
      arrowHeads: heads,
    );
  }

  @override
  List<Object?> get props => [
        ...super.props,
        startX,
        startY,
        endX,
        endY,
        startBindingId,
        endBindingId,
        stroke,
        strokeWidth,
        strokeStyle,
        connectorKind,
        arrowHeads,
      ];
}

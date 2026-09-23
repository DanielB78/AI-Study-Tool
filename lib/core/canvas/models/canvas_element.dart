import 'package:equatable/equatable.dart';

import '../geometry/rect.dart';
import 'ids.dart';

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

/// Common geometry and identity for every canvas object.
///
/// Elements exist in **world coordinates**. The renderer + camera convert
/// to screen space; element positions are never viewport-relative.
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

  /// Extensible bag for future AI/RAG annotations without schema churn.
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

/// Placeholder text element — rendering/editing comes later.
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
    this.fontSize = 16,
    this.color = '#1A1A1A',
  });

  final String text;
  final double fontSize;
  final String color;

  @override
  CanvasElementType get type => CanvasElementType.text;

  factory TextElement.create({
    required double x,
    required double y,
    double width = 200,
    double height = 40,
    String text = '',
    int zIndex = 0,
  }) {
    final now = DateTime.now().toUtc();
    return TextElement(
      id: generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      text: text,
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
    double? fontSize,
    String? color,
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
      fontSize: fontSize ?? this.fontSize,
      color: color ?? this.color,
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'text': text,
        'fontSize': fontSize,
        'color': color,
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
      fontSize: (json['fontSize'] as num?)?.toDouble() ?? 16,
      color: json['color'] as String? ?? '#1A1A1A',
    );
  }

  @override
  List<Object?> get props => [...super.props, text, fontSize, color];
}

/// Shape kinds supported by [ShapeElement] (extensible).
enum ShapeKind {
  rectangle,
  ellipse,
  roundedRect;

  String get wireName => name;

  static ShapeKind fromWire(String value) {
    return ShapeKind.values.firstWhere(
      (e) => e.name == value,
      orElse: () => ShapeKind.rectangle,
    );
  }
}

/// Shape element — demo rectangles use this type fully in phase 1.
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
  });

  final ShapeKind shapeKind;
  final String? fill;
  final String? stroke;
  final double strokeWidth;

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
    int zIndex = 0,
    bool locked = false,
    String? id,
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
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'shapeKind': shapeKind.wireName,
        'fill': fill,
        'stroke': stroke,
        'strokeWidth': strokeWidth,
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
    );
  }

  @override
  List<Object?> get props =>
      [...super.props, shapeKind, fill, stroke, strokeWidth];
}

/// Freehand stroke placeholder.
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
    this.strokeWidth = 2,
  });

  /// Flattened [x0,y0,x1,y1,...] in world coordinates relative to [x],[y]
  /// or absolute — convention reserved for a later drawing tool.
  final List<double> points;
  final String color;
  final double strokeWidth;

  @override
  CanvasElementType get type => CanvasElementType.drawing;

  factory DrawingElement.create({
    required double x,
    required double y,
    double width = 0,
    double height = 0,
    List<double> points = const [],
    int zIndex = 0,
  }) {
    final now = DateTime.now().toUtc();
    return DrawingElement(
      id: generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      points: points,
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
    );
  }

  @override
  Map<String, dynamic> toJson() => {
        ...CanvasElement.baseToJson(this),
        'points': points,
        'color': color,
        'strokeWidth': strokeWidth,
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
      strokeWidth: (json['strokeWidth'] as num?)?.toDouble() ?? 2,
    );
  }

  @override
  List<Object?> get props => [...super.props, points, color, strokeWidth];
}

/// Raster image placeholder.
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

  final String src;
  final double naturalWidth;
  final double naturalHeight;

  @override
  CanvasElementType get type => CanvasElementType.image;

  factory ImageElement.create({
    required double x,
    required double y,
    double width = 200,
    double height = 150,
    String src = '',
    int zIndex = 0,
  }) {
    final now = DateTime.now().toUtc();
    return ImageElement(
      id: generateId(),
      x: x,
      y: y,
      width: width,
      height: height,
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      src: src,
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

/// Connector / relationship placeholder for future graph / RAG edges.
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
  });

  final double startX;
  final double startY;
  final double endX;
  final double endY;

  /// Future: element IDs this connector binds to (graph edges for RAG).
  final String? startBindingId;
  final String? endBindingId;
  final String stroke;
  final double strokeWidth;

  @override
  CanvasElementType get type => CanvasElementType.connector;

  factory ConnectorElement.create({
    required double startX,
    required double startY,
    required double endX,
    required double endY,
    String? startBindingId,
    String? endBindingId,
    int zIndex = 0,
  }) {
    final now = DateTime.now().toUtc();
    final minX = startX < endX ? startX : endX;
    final minY = startY < endY ? startY : endY;
    return ConnectorElement(
      id: generateId(),
      x: minX,
      y: minY,
      width: (endX - startX).abs(),
      height: (endY - startY).abs(),
      zIndex: zIndex,
      createdAt: now,
      updatedAt: now,
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      startBindingId: startBindingId,
      endBindingId: endBindingId,
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
      };

  factory ConnectorElement.fromJson(Map<String, dynamic> json) {
    final b = CanvasElement.parseBase(json);
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
      ];
}

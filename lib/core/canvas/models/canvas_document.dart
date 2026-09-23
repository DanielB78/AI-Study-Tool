import 'package:equatable/equatable.dart';
import 'package:collection/collection.dart';

import '../geometry/rect.dart';
import 'camera_state.dart';
import 'canvas_element.dart';
import 'ids.dart';

/// Current on-disk / wire schema version for [CanvasDocument].
const int kCanvasDocumentVersion = 2;

/// Structured canvas document — the source of truth for the board.
///
/// The Flutter renderer and UI read this model; they never own it.
/// Elements are stored by stable ID with deterministic z-order rendering.
class CanvasDocument extends Equatable {
  CanvasDocument({
    required this.id,
    this.version = kCanvasDocumentVersion,
    Map<String, CanvasElement>? elementsById,
    List<String>? zOrder,
    this.camera = CameraState.identity,
    this.metadata = const {},
  })  : elementsById = Map.unmodifiable(elementsById ?? const {}),
        zOrder = List.unmodifiable(zOrder ?? const []);

  final String id;

  /// Schema version for serialization migrations.
  final int version;

  /// O(1) lookup by stable element ID.
  final Map<String, CanvasElement> elementsById;

  /// Bottom → top paint order (element IDs). Explicit; not accidental list order.
  final List<String> zOrder;

  final CameraState camera;
  final Map<String, Object?> metadata;

  /// Elements in bottom-to-top z-order.
  List<CanvasElement> get elementsInZOrder {
    return [
      for (final id in zOrder)
        if (elementsById.containsKey(id)) elementsById[id]!,
    ];
  }

  /// Top-to-bottom (useful for hit testing).
  List<CanvasElement> get elementsTopFirst =>
      elementsInZOrder.reversed.toList(growable: false);

  CanvasElement? getElementById(String id) => elementsById[id];

  List<CanvasElement> getElementsByType(CanvasElementType type) {
    return elementsById.values.where((e) => e.type == type).toList();
  }

  List<TextElement> get textElements =>
      getElementsByType(CanvasElementType.text).cast<TextElement>().toList();

  /// Axis-aligned area query (no spatial index yet).
  List<CanvasElement> getElementsInArea(Rect2 area) {
    return elementsById.values
        .where((e) => e.bounds.intersects(area))
        .toList();
  }

  List<CanvasElement> getNearbyElements(
    double worldX,
    double worldY, {
    double radius = 100,
  }) {
    final area = Rect2(
      x: worldX - radius,
      y: worldY - radius,
      width: radius * 2,
      height: radius * 2,
    );
    return getElementsInArea(area);
  }

  int get nextZIndex {
    if (zOrder.isEmpty) return 0;
    final maxZ = elementsById.values.map((e) => e.zIndex).maxOrNull ?? 0;
    return maxZ + 1;
  }

  factory CanvasDocument.empty({String? id, CameraState? camera}) {
    return CanvasDocument(
      id: id ?? generateId(),
      camera: camera ?? CameraState.identity,
    );
  }

  /// Demo board with one selectable rectangle for foundation verification.
  factory CanvasDocument.withDemoShape({String? id}) {
    final shape = ShapeElement.create(
      x: 120,
      y: 100,
      width: 180,
      height: 110,
      zIndex: 0,
    );
    return CanvasDocument(
      id: id ?? generateId(),
      elementsById: {shape.id: shape},
      zOrder: [shape.id],
      camera: const CameraState(x: 80, y: 60, zoom: 1),
    );
  }

  CanvasDocument copyWith({
    int? version,
    Map<String, CanvasElement>? elementsById,
    List<String>? zOrder,
    CameraState? camera,
    Map<String, Object?>? metadata,
  }) {
    return CanvasDocument(
      id: id,
      version: version ?? this.version,
      elementsById: elementsById ?? this.elementsById,
      zOrder: zOrder ?? this.zOrder,
      camera: camera ?? this.camera,
      metadata: metadata ?? this.metadata,
    );
  }

  CanvasDocument withCamera(CameraState camera) => copyWith(camera: camera);

  CanvasDocument upsertElement(CanvasElement element) {
    final nextMap = Map<String, CanvasElement>.from(elementsById);
    final nextOrder = List<String>.from(zOrder);
    final isNew = !nextMap.containsKey(element.id);
    nextMap[element.id] = element;
    if (isNew) {
      nextOrder.add(element.id);
    }
    return copyWith(elementsById: nextMap, zOrder: nextOrder);
  }

  CanvasDocument removeElement(String elementId) {
    if (!elementsById.containsKey(elementId)) return this;
    final nextMap = Map<String, CanvasElement>.from(elementsById)
      ..remove(elementId);
    final nextOrder = List<String>.from(zOrder)..remove(elementId);
    return copyWith(elementsById: nextMap, zOrder: nextOrder);
  }

  CanvasDocument replaceElements(Map<String, CanvasElement> updates) {
    final nextMap = Map<String, CanvasElement>.from(elementsById);
    for (final entry in updates.entries) {
      nextMap[entry.key] = entry.value;
    }
    return copyWith(elementsById: nextMap);
  }

  /// Reorder: place [elementId] at the end of [zOrder] (front) or start (back).
  CanvasDocument bringToFront(String elementId) {
    if (!elementsById.containsKey(elementId)) return this;
    final nextOrder = List<String>.from(zOrder)
      ..remove(elementId)
      ..add(elementId);
    final el = elementsById[elementId]!;
    return copyWith(
      zOrder: nextOrder,
      elementsById: {
        ...elementsById,
        elementId: el.copyWithBase(
          zIndex: nextZIndex,
          updatedAt: DateTime.now().toUtc(),
        ),
      },
    );
  }

  CanvasDocument sendToBack(String elementId) {
    if (!elementsById.containsKey(elementId)) return this;
    final nextOrder = List<String>.from(zOrder)
      ..remove(elementId)
      ..insert(0, elementId);
    final el = elementsById[elementId]!;
    return copyWith(
      zOrder: nextOrder,
      elementsById: {
        ...elementsById,
        elementId: el.copyWithBase(
          zIndex: 0,
          updatedAt: DateTime.now().toUtc(),
        ),
      },
    );
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'id': id,
        'camera': camera.toJson(),
        'metadata': metadata,
        'zOrder': zOrder,
        'elements': [
          for (final id in zOrder)
            if (elementsById.containsKey(id)) elementsById[id]!.toJson(),
        ],
      };

  factory CanvasDocument.fromJson(Map<String, dynamic> json) {
    final elementsList = (json['elements'] as List? ?? const [])
        .cast<Map<String, dynamic>>();
    final map = <String, CanvasElement>{};
    for (final raw in elementsList) {
      final el = CanvasElement.fromJson(raw);
      map[el.id] = el;
    }
    final order = (json['zOrder'] as List?)?.cast<String>();
    final resolvedOrder = order ??
        (map.values.toList()
              ..sort((a, b) => a.zIndex.compareTo(b.zIndex)))
            .map((e) => e.id)
            .toList();

    return CanvasDocument(
      id: json['id'] as String? ?? generateId(),
      version: (json['version'] as num?)?.toInt() ?? kCanvasDocumentVersion,
      elementsById: map,
      zOrder: resolvedOrder.where(map.containsKey).toList(),
      camera: json['camera'] is Map<String, dynamic>
          ? CameraState.fromJson(json['camera'] as Map<String, dynamic>)
          : CameraState.identity,
      metadata: Map<String, Object?>.from(
        (json['metadata'] as Map?)?.cast<String, Object?>() ?? const {},
      ),
    );
  }

  @override
  List<Object?> get props =>
      [id, version, elementsById, zOrder, camera, metadata];
}

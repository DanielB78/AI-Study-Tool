import '../canvas/models/canvas_document.dart';
import '../canvas/models/canvas_element.dart';
import 'editor_command.dart';

class CreateElementCommand implements EditorCommand {
  CreateElementCommand(this.element);

  final CanvasElement element;

  @override
  String get label => 'Create ${element.type.wireName}';

  @override
  CanvasDocument execute(CanvasDocument document) {
    return document.upsertElement(element);
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    return document.removeElement(element.id);
  }
}

class CreateElementsCommand implements EditorCommand {
  CreateElementsCommand(this.elements);

  final List<CanvasElement> elements;

  @override
  String get label =>
      elements.length == 1 ? 'Create element' : 'Create ${elements.length} elements';

  @override
  CanvasDocument execute(CanvasDocument document) {
    var doc = document;
    for (final el in elements) {
      doc = doc.upsertElement(el);
    }
    return doc;
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    var doc = document;
    for (final el in elements.reversed) {
      doc = doc.removeElement(el.id);
    }
    return doc;
  }
}

class DeleteElementCommand implements EditorCommand {
  DeleteElementCommand(this.element);

  final CanvasElement element;

  @override
  String get label => 'Delete ${element.type.wireName}';

  @override
  CanvasDocument execute(CanvasDocument document) {
    return document.removeElement(element.id);
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    return document.upsertElement(element);
  }
}

class DeleteElementsCommand implements EditorCommand {
  DeleteElementsCommand(this.elements);

  final List<CanvasElement> elements;

  @override
  String get label =>
      elements.length == 1 ? 'Delete element' : 'Delete ${elements.length} elements';

  @override
  CanvasDocument execute(CanvasDocument document) {
    var doc = document;
    for (final el in elements) {
      doc = doc.removeElement(el.id);
    }
    return doc;
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    var doc = document;
    for (final el in elements) {
      doc = doc.upsertElement(el);
    }
    return doc;
  }
}

class MoveDelta {
  const MoveDelta({
    required this.fromX,
    required this.fromY,
    required this.toX,
    required this.toY,
  });

  final double fromX;
  final double fromY;
  final double toX;
  final double toY;

  double get dx => toX - fromX;
  double get dy => toY - fromY;

  bool get isZero => dx == 0 && dy == 0;
}

/// Moves one or more elements. One history entry for an entire drag gesture.
class MoveElementsCommand implements EditorCommand {
  MoveElementsCommand(this.moves);

  final Map<String, MoveDelta> moves;

  @override
  String get label =>
      moves.length == 1 ? 'Move element' : 'Move ${moves.length} elements';

  CanvasElement _applyMove(CanvasElement el, double dx, double dy) {
    final now = DateTime.now().toUtc();
    return switch (el) {
      DrawingElement() => el.movedBy(dx, dy),
      ConnectorElement() => el.movedBy(dx, dy),
      _ => el.copyWithBase(x: el.x + dx, y: el.y + dy, updatedAt: now),
    };
  }

  @override
  CanvasDocument execute(CanvasDocument document) {
    final updates = <String, CanvasElement>{};
    for (final entry in moves.entries) {
      final el = document.getElementById(entry.key);
      if (el == null || el.locked) continue;
      updates[entry.key] = _applyMove(el, entry.value.dx, entry.value.dy);
    }
    return document.replaceElements(updates);
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    final updates = <String, CanvasElement>{};
    for (final entry in moves.entries) {
      final el = document.getElementById(entry.key);
      if (el == null) continue;
      updates[entry.key] = _applyMove(el, -entry.value.dx, -entry.value.dy);
    }
    return document.replaceElements(updates);
  }
}

class UpdateElementCommand implements EditorCommand {
  UpdateElementCommand({
    required this.before,
    required this.after,
  }) : assert(before.id == after.id);

  final CanvasElement before;
  final CanvasElement after;

  @override
  String get label => 'Update ${after.type.wireName}';

  @override
  CanvasDocument execute(CanvasDocument document) {
    return document.upsertElement(after);
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    return document.upsertElement(before);
  }
}

class UpdateElementsCommand implements EditorCommand {
  UpdateElementsCommand({
    required this.before,
    required this.after,
  }) : assert(before.length == after.length);

  final List<CanvasElement> before;
  final List<CanvasElement> after;

  @override
  String get label =>
      after.length == 1 ? 'Update element' : 'Update ${after.length} elements';

  @override
  CanvasDocument execute(CanvasDocument document) {
    var doc = document;
    for (final el in after) {
      doc = doc.upsertElement(el);
    }
    return doc;
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    var doc = document;
    for (final el in before) {
      doc = doc.upsertElement(el);
    }
    return doc;
  }
}

class ReorderElementCommand implements EditorCommand {
  ReorderElementCommand({
    required this.elementId,
    required this.beforeOrder,
    required this.afterOrder,
    required this.beforeElement,
    required this.afterElement,
  });

  final String elementId;
  final List<String> beforeOrder;
  final List<String> afterOrder;
  final CanvasElement beforeElement;
  final CanvasElement afterElement;

  @override
  String get label => 'Reorder element';

  @override
  CanvasDocument execute(CanvasDocument document) {
    return document.copyWith(
      zOrder: afterOrder,
      elementsById: {
        ...document.elementsById,
        elementId: afterElement,
      },
    );
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    return document.copyWith(
      zOrder: beforeOrder,
      elementsById: {
        ...document.elementsById,
        elementId: beforeElement,
      },
    );
  }
}

/// Replace entire z-order (and optional element zIndex values) in one step.
class ReorderElementsCommand implements EditorCommand {
  ReorderElementsCommand({
    required this.beforeOrder,
    required this.afterOrder,
    this.beforeElements = const {},
    this.afterElements = const {},
  });

  final List<String> beforeOrder;
  final List<String> afterOrder;
  final Map<String, CanvasElement> beforeElements;
  final Map<String, CanvasElement> afterElements;

  @override
  String get label => 'Reorder elements';

  @override
  CanvasDocument execute(CanvasDocument document) {
    return document.copyWith(
      zOrder: afterOrder,
      elementsById: afterElements.isEmpty
          ? document.elementsById
          : {...document.elementsById, ...afterElements},
    );
  }

  @override
  CanvasDocument undo(CanvasDocument document) {
    return document.copyWith(
      zOrder: beforeOrder,
      elementsById: beforeElements.isEmpty
          ? document.elementsById
          : {...document.elementsById, ...beforeElements},
    );
  }
}

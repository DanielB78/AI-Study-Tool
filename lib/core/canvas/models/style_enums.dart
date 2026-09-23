/// Shared visual style enums for canvas elements.
library;

enum StrokeStyle {
  solid,
  dashed,
  dotted;

  String get wireName => name;

  static StrokeStyle fromWire(String? value) {
    return StrokeStyle.values.firstWhere(
      (e) => e.name == value,
      orElse: () => StrokeStyle.solid,
    );
  }
}

enum TextAlignment {
  left,
  center,
  right;

  String get wireName => name;

  static TextAlignment fromWire(String? value) {
    return TextAlignment.values.firstWhere(
      (e) => e.name == value,
      orElse: () => TextAlignment.left,
    );
  }
}

enum FontWeightKind {
  normal,
  bold;

  String get wireName => name;

  static FontWeightKind fromWire(String? value) {
    return FontWeightKind.values.firstWhere(
      (e) => e.name == value,
      orElse: () => FontWeightKind.normal,
    );
  }
}

enum ArrowHeads {
  none,
  end,
  start,
  both;

  String get wireName => name;

  static ArrowHeads fromWire(String? value) {
    return ArrowHeads.values.firstWhere(
      (e) => e.name == value,
      orElse: () => ArrowHeads.end,
    );
  }
}

enum ConnectorKind {
  line,
  arrow;

  String get wireName => name;

  static ConnectorKind fromWire(String? value) {
    return ConnectorKind.values.firstWhere(
      (e) => e.name == value,
      orElse: () => ConnectorKind.line,
    );
  }
}

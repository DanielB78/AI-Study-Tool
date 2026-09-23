import 'dart:convert';

import '../canvas/models/canvas_document.dart';

/// Versioned JSON serialization for [CanvasDocument].
///
/// Serializes the structured document only — never Flutter widgets,
/// painters, or transient UI/session state.
class CanvasDocumentCodec {
  const CanvasDocumentCodec();

  Map<String, dynamic> encode(CanvasDocument document) => document.toJson();

  CanvasDocument decode(Map<String, dynamic> json) =>
      CanvasDocument.fromJson(json);

  String encodeToString(CanvasDocument document, {bool pretty = false}) {
    final json = encode(document);
    return pretty
        ? const JsonEncoder.withIndent('  ').convert(json)
        : jsonEncode(json);
  }

  CanvasDocument decodeFromString(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! Map<String, dynamic>) {
      throw FormatException('CanvasDocument JSON must be an object');
    }
    return decode(decoded);
  }
}

import 'package:uuid/uuid.dart';

const _uuid = Uuid();

/// Generates a stable unique ID for canvas elements and documents.
String generateId() => _uuid.v4();

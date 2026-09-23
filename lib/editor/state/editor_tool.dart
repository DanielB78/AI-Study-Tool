/// Active editor tool.
///
/// All tools listed here are implemented in phase 2 except as noted.
enum EditorTool {
  select,
  pan,
  text,
  pen,
  shape,
  line,
  arrow,
  image;

  bool get isCreationTool =>
      this == text ||
      this == pen ||
      this == shape ||
      this == line ||
      this == arrow ||
      this == image;

  bool get usesTopContextualBar =>
      this == text ||
      this == pen ||
      this == shape ||
      this == line ||
      this == arrow ||
      this == image;
}

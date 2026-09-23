/// Active editor tool.
///
/// Only [select] and [pan] are implemented in phase 1.
/// Other values exist so the model is ready for future tools — do not
/// invent fake behavior for unfinished tools.
enum EditorTool {
  select,
  pan,
  text,
  pen,
  shape,
  line,
  arrow,
  image;

  bool get isImplemented => this == select || this == pan;
}

# AI Study Tool

Flutter infinite-canvas study application.

## Architecture (phase 1 foundation)

- **CanvasDocument** is the source of truth (not the renderer).
- **Commands** mutate the document; UI and future AI share the same ops.
- **CustomPainter** reads the document and paints; it holds no app state.
- **Desktop UI** (`lib/ui/desktop`) is isolated from the editor core so
  mobile can later share the same engine.

## Run (Windows)

```bash
flutter run -d windows
```

## Run (Linux / macOS / Chrome — for development)

```bash
flutter run -d linux
# or
flutter run -d chrome
```

## Tests

```bash
flutter test
flutter analyze
```

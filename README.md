# AI Study Tool

Flutter infinite-canvas study application.

## Architecture (phase 1 foundation)

- **CanvasDocument** is the source of truth (not the renderer).
- **Commands** mutate the document; UI and future AI share the same ops.
- **CustomPainter** reads the document and paints; it holds no app state.
- **Desktop UI** (`lib/ui/desktop`) is isolated from the editor core so
  mobile can later share the same engine.

## Platforms

The app includes native desktop targets for **Windows**, Linux, and macOS,
plus web / iOS / Android scaffolds. The editor core does not use
Windows-only APIs.

| Command | Where it works |
|---|---|
| `flutter run -d windows` | **Windows PC only** (Visual Studio + Flutter) |
| `flutter run -d linux` | Linux |
| `flutter run -d macos` | macOS |
| `flutter run -d chrome` | Any host with Chrome |

Flutter cannot cross-compile: you cannot run `-d windows` from Linux/macOS.

## Run on Windows (your PC)

1. Install [Flutter](https://docs.flutter.dev/get-started/install/windows) (stable).
2. Install **Visual Studio 2022** with the workload
   **“Desktop development with C++”**
   (Windows 10/11 SDK + MSVC toolchain).
3. In a Developer / normal terminal:

```bat
git clone <this-repo>
cd AI-Study-Tool
flutter pub get
flutter config --enable-windows-desktop
flutter doctor
flutter run -d windows
```

Release build:

```bat
flutter build windows --release
```

The executable is at:

`build\windows\x64\runner\Release\ai_study_tool.exe`

### CI Windows builds

Pushes/PRs build a Windows release on `windows-latest` and upload the
`ai-study-tool-windows` artifact (Actions → workflow run → Artifacts).

## Run on Linux / Chrome (this cloud agent)

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

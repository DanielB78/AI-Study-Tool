# AI Study Tool — StudyBoard

Phase 1: infinite-canvas study/note editor (frontend only).

## Stack

- React + TypeScript + Vite
- react-konva / Konva for rendering
- Zustand for structured canvas state

## Run

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — local development server
- `npm run build` — typecheck + production build
- `npm run typecheck` — TypeScript only
- `npm run lint` — oxlint
- `npm run preview` — preview production build

## Architecture notes

Board state is a structured `CanvasDocument` (elements + camera). Konva is a view layer only — never the source of truth. Elements use a TypeScript discriminated union (`text`, `shape`, `drawing`, `image`, `connector`) so a future AI/RAG layer can query and manipulate objects by id, type, geometry, and connector bindings.

# EVA Electron -> Tauri Migration Plan

## Goals

- Keep existing frontend UI and interaction patterns.
- Replace Electron shell with Tauri (Rust backend + WebView frontend).
- Remove Python runtime dependency.
- Remove current RAG module and related coupling.
- Deliver in small, testable steps.

## Current Status

- [x] Initialize Vite + React + TypeScript in eva.
- [x] Initialize Tauri project in eva/src-tauri.
- [x] Migrate renderer source and static assets from super-dashboard.
- [x] Align frontend build config (Vite alias, Tailwind/PostCSS, tsconfig).
- [x] Add temporary desktop API bridge to avoid runtime crashes from window.api.
- [x] Hide AIEngine/MyGPT entry points from navigation to start Python/RAG decoupling.
- [x] Validate successful build:
  - npm run build
  - npm run tauri:build -- --no-bundle

## Phased Execution

### Phase 1: Shell Migration Foundation (Done)

- Buildable Tauri shell with migrated frontend.
- No Python process startup in new app.
- No RAG entry from main navigation.

### Phase 2: API Compatibility Layer (Next)

- Introduce typed Tauri commands for high-frequency desktop capabilities:
  - settings get/set
  - navigation data CRUD
  - open in browser / open in finder / select folder
  - hotkey config read/write (placeholder first, system integration later)
- Replace temporary JS bridge methods one-by-one with invoke-based calls.
- Keep unsupported APIs as explicit "not implemented" responses.

Deliverable:
- App startup without critical console errors.
- Dashboard + Navigation + Settings core workflow usable.

### Phase 3: Remove Python Dependency (Core)

- Delete Python service lifecycle logic in frontend:
  - usePythonService and dependent UI state
  - AI engine setup wizard pages tied to Python env management
- Remove Python-related commands from API surface.
- Remove Python-related docs/config references in eva.

Deliverable:
- No pythonStart/pythonStop/pythonGetInfo usage in active code path.
- No runtime requirement for Python executable or venv.

### Phase 4: Remove RAG Module (Core)

- Remove knowledge base/RAG hooks, pages, and settings entries:
  - knowledge base management
  - RAG status/indexing UI
  - RAG API calls
- If chat remains, keep only non-RAG chat path (or disable chat temporarily).

Deliverable:
- No active references to RAG endpoints/workflows.
- Build passes after dead code removal.

### Phase 5: Native Tauri Service Replacement

- Replace selected Electron-node services with Rust implementations incrementally:
  - local storage and app data paths
  - file dialog/open path
  - basic process/network helpers where needed
- Optional: for hard Node-specific features, evaluate sidecar strategy only if strictly necessary.

Deliverable:
- Core local features powered by Tauri commands.

### Phase 6: Cleanup and Packaging

- Remove obsolete Electron artifacts and configs from eva.
- Reduce bundle size with route-level lazy loading.
- Finalize identifier/icons/signing metadata for release.
- Add migration notes and test checklist.

Deliverable:
- tauri:build release-ready output.

## Technical Principles

- Prefer feature flags and route-level isolation before hard deletion.
- Keep one stable main branch and merge each phase after build verification.
- Every phase must end with:
  - npm run build
  - npm run tauri:build -- --no-bundle

## Risk Control

- Main risk: large window.api surface from Electron preload.
- Mitigation: implement typed compatibility facade and replace by priority.
- Main risk: hidden Python/RAG coupling in chat/tool pages.
- Mitigation: remove entrances first, then remove hooks and APIs in batches.

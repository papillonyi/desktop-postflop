# Web React Rewrite Design

## Goal

Rewrite the web frontend from Vue 3 to React while preserving the single-user web-server architecture and current solver behavior. The Rust HTTP server and API contract remain the backend boundary. Desktop/Tauri frontend compatibility is not a goal for this branch.

## Scope

The rewrite replaces the Vue component tree, Pinia stores, Vue chart wrapper, Vue tooltip wrapper, and Vue-specific tooling. The web frontend may be reorganized by feature area. Existing business helpers should be reused when they are framework-neutral.

Keep:

- `src/invokes.ts` as the API boundary, adjusted to become web-only if needed.
- `src/db.ts` and `src/db-migration.ts` for IndexedDB saved ranges/configurations.
- `src/result-types.ts` for solver result data contracts.
- `src/utils.ts` where functions are framework-neutral.
- Tailwind and existing visual language unless a direct React port requires minor markup changes.

Replace:

- `src/components/*.vue` with React TSX components.
- `src/store.ts` Pinia stores with Redux Toolkit slices.
- Vue routerless view state with React Router routes.
- `@heroicons/vue` with `@heroicons/react`.
- `vue-chartjs` with `react-chartjs-2`.
- `vue-tippy` with a small Floating UI based tooltip component.

## Dependencies

Runtime dependencies:

- `react` and `react-dom` for the UI runtime.
- `react-router` for URL-driven web navigation.
- `@reduxjs/toolkit` and `react-redux` for app/config/solver/result state.
- `@heroicons/react` for icons.
- `react-chartjs-2` for Chart.js React bindings.
- `@floating-ui/react` for tooltip/popover positioning.

Development dependencies:

- `@vitejs/plugin-react` for Vite React support.
- `@types/react` and `@types/react-dom` for TypeScript.
- `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` for React lint rules.

Do not add a large UI component library, Next.js, Remix, or TanStack Query in the first rewrite. The current API is command-oriented and single-user, so Redux async thunks/listeners are a better first fit than a server-state cache.

## Architecture

The React app is a Vite SPA served by the existing Rust web server in production and proxied to the Rust API during frontend development.

```text
Browser
  React + TypeScript + React Router
  Redux Toolkit store
  Feature modules
  IndexedDB via Dexie
        |
        | HTTP JSON and file upload/download through src/invokes.ts
        v
Rust axum web server
  single-user solver state
        |
        v
postflop-solver
```

Recommended source layout:

```text
src/
  app/
    App.tsx
    main.tsx
    router.tsx
    store.ts
    layout/
  features/
    board/
    bunching/
    database/
    ranges/
    results/
    solver/
    tree/
  shared/
    components/
    hooks/
    lib/
  invokes.ts
  db.ts
  db-migration.ts
  result-types.ts
  utils.ts
  style.css
```

Use routes for major view boundaries:

- `/solver/ranges/oop`
- `/solver/ranges/ip`
- `/solver/board`
- `/solver/tree`
- `/solver/bunching`
- `/solver/run`
- `/results`
- `/about`

Redirect `/` to `/solver/ranges/oop`.

## State Model

Redux slices:

- `appSlice`: navigation-derived UI state, solver flags, finalizing state, bunching flags.
- `configSlice`: board and tree configuration fields that were previously in `useConfigStore`.
- `configSnapshotsSlice`: temporary and saved config snapshots for tree editing and run-solver comparisons.
- `rangesSlice`: six 13x13 range matrices.
- `resultsSlice`: result view selections, display options, loaded result payloads.

Keep command-heavy solver work in component-local async functions or typed thunks. Do not convert every API call to RTK Query in this phase.

## Component Strategy

Port by behavior, not by one-to-one syntax conversion. Small presentational components should become focused TSX components. Large Vue files should be split when doing so reduces coupling:

- `DbItemPicker.vue` can become a feature-local database picker plus import/export helpers.
- `TreeConfig.vue` can split inputs, validation, and editor launch.
- `ResultTable.vue` can split table columns, virtualized rows, summary/export, and formatting helpers.
- `ResultNav.vue` can split navigation tree rendering and chance-card handling.

No intentional UI redesign is part of this branch. Layout, colors, labels, and workflows should stay recognizable.

## Error Handling

`src/invokes.ts` remains responsible for HTTP error normalization. React components should show the same validation messages and operation states as the Vue app. Browser file import/export should use `File`, `Blob`, object URLs, and hidden file inputs where needed.

## Verification

Minimum before completion:

- `pixi run lint`
- `pixi run frontend-build`
- `pixi run server-check`
- Browser smoke through the web server:
  - app loads
  - range edit works
  - board edit works
  - tree config validates and tree editor loads
  - solver run view can build/allocate enough to call server APIs
  - results route renders when solver state exists
  - JSON import/export and game save/load remain browser-compatible

## Non-Goals

- Multi-user frontend sessions.
- A new design system.
- Replacing Tailwind.
- Rewriting the Rust API contract.
- Making Tauri frontend compatibility pass.

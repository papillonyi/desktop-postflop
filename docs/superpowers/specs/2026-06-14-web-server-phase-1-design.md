# Desktop Postflop Web Server Phase 1 Design

## Goal

Convert Desktop Postflop from a Tauri desktop app into a single-user web-server architecture while keeping the current Vue UI and solver behavior as close to the desktop version as possible.

Phase 1 is an architecture migration, not a React rewrite and not a multi-user product. The browser UI should look and behave like the current desktop UI, while solver computation moves behind HTTP APIs served by a local Rust process.

## Non-Goals

- Do not rewrite the Vue frontend to React in phase 1.
- Do not add multi-user sessions, authentication, quotas, or remote account management.
- Do not redesign the solver UI or result visualization.
- Do not change the external `../postflop-solver` crate except where a compile-time API mismatch forces it.
- Do not introduce a database-backed server persistence model in phase 1.

## Architecture

Phase 1 uses one Rust server process and one active application state.

```text
Browser
  Vue 3 + TypeScript + Pinia + Tailwind
  IndexedDB for saved ranges/configurations
  fetch-based API client
        |
        | HTTP JSON + file upload/download
        v
Rust web server
  AppState {
    ranges: Mutex<RangeManager>,
    tree: Mutex<ActionTree>,
    bunching: Mutex<Option<BunchingData>>,
    game: Mutex<PostFlopGame>,
    pool: Mutex<ThreadPool>,
  }
        |
        v
postflop-solver crate
```

The server owns the compute-heavy and solver-native state. The browser owns UI state and local saved range/configuration data, matching the current Dexie model.

## Frontend Design

Keep the current Vue component tree. The main frontend boundary is `src/invokes.ts`.

Current:

```ts
await invoke("game_solve_step", { currentIteration });
```

Phase 1:

```ts
await apiPost("/api/game/solve-step", { currentIteration });
```

Most Vue components should continue importing `src/invokes.ts`. Component edits should be limited to places that use Tauri-only browser integration:

- `@tauri-apps/api` `invoke` in `src/invokes.ts`
- Tauri dialog and fs calls in `DbItemPicker.vue`
- Tauri dialog and fs calls in `ResultTable.vue`
- Tauri dialog messages and hard-coded save/load paths in solver save/load helpers

`src/db.ts` can remain Dexie/IndexedDB in phase 1 because single-user browser-local saved ranges/configurations are acceptable and preserve current behavior.

## Backend Design

Create a Rust web server target alongside or instead of the Tauri entrypoint. The server should reuse the existing domain modules where practical:

- `range.rs`
- `tree.rs`
- `bunching.rs`
- `solver.rs`

The first implementation can keep Tauri command-shaped functions conceptually, but handlers should accept and return JSON-compatible request/response types.

Recommended Rust stack:

- `axum` for HTTP routing
- `tower-http` for static file serving and CORS during development
- `tokio` runtime
- `serde` for JSON request/response structs

The server listens on a local port in development. In production, it can serve the built Vite `dist/` directory and the API from the same origin.

## API Shape

The first API contract should be a near 1:1 migration of Tauri commands to reduce frontend risk.

System:

- `GET /api/system/os-name`
- `GET /api/system/memory`
- `POST /api/system/threads`

Ranges:

- `GET /api/range/:player/num-combos`
- `POST /api/range/:player/clear`
- `POST /api/range/:player/invert`
- `POST /api/range/:player/update`
- `POST /api/range/:player/from-string`
- `GET /api/range/:player/to-string`
- `GET /api/range/:player/weights`
- `GET /api/range/:player/raw-data`

Tree:

- `POST /api/tree/new`
- `GET /api/tree/added-lines`
- `GET /api/tree/removed-lines`
- `GET /api/tree/invalid-terminals`
- `GET /api/tree/actions`
- `GET /api/tree/is-terminal-node`
- `GET /api/tree/is-chance-node`
- `POST /api/tree/back-to-root`
- `POST /api/tree/apply-history`
- `POST /api/tree/play`
- `GET /api/tree/total-bet-amount`
- `POST /api/tree/add-bet-action`
- `POST /api/tree/remove-current-node`
- `POST /api/tree/delete-added-line`
- `POST /api/tree/delete-removed-line`

Bunching:

- `POST /api/bunching/init`
- `POST /api/bunching/clear`
- `POST /api/bunching/progress`

Game:

- `POST /api/game/init`
- `GET /api/game/private-cards`
- `GET /api/game/memory-usage`
- `GET /api/game/memory-usage-bunching`
- `POST /api/game/allocate-memory`
- `POST /api/game/set-bunching`
- `POST /api/game/solve-step`
- `GET /api/game/exploitability`
- `POST /api/game/finalize`
- `POST /api/game/apply-history`
- `POST /api/game/total-bet-amount`
- `POST /api/game/actions-after`
- `GET /api/game/possible-cards`
- `GET /api/game/results`
- `POST /api/game/chance-reports`

Game files:

- `GET /api/game/file` downloads the current game as `.bin`.
- `POST /api/game/file` uploads and loads a `.bin` file.
- `GET /api/game/board` returns the board from the loaded game.

## Solver Execution Model

Keep the current frontend-driven loop for phase 1:

1. Frontend calls `game/init`.
2. Frontend calls `game/allocate-memory`.
3. Frontend repeatedly calls `game/solve-step`.
4. Frontend periodically calls `game/exploitability`.
5. Frontend calls `game/finalize`.

This preserves pause/resume/terminate behavior with minimal UI changes.

The backend should use the same `ThreadPool` model as the Tauri app. Because phase 1 is single-user, one global `AppState` is acceptable.

## File Handling

Browser-compatible file handling replaces Tauri dialog/fs APIs.

JSON import/export for saved ranges/configurations:

- Import uses an `<input type="file">` and `File.text()`.
- Export uses `Blob`, `URL.createObjectURL`, and an `<a download>` click.

CSV export:

- Use a client-side Blob download.

Game save/load:

- Save downloads the current server-side `PostFlopGame` as a `.bin`.
- Load uploads a `.bin` to the server and replaces server-side `PostFlopGame`.
- After loading, frontend refreshes board and ranges from API responses.

## Development Commands

Add Pixi tasks for the web architecture:

- `pixi run frontend-dev`: existing Vite frontend dev server.
- `pixi run server-dev`: run the Rust web server.
- `pixi run web-dev`: optional convenience command for running both if the project chooses a process runner.
- `pixi run frontend-build`: existing Vite build.
- `pixi run server-check`: check the Rust web server target.

Keep existing Tauri commands during migration if practical, but the web-server path is the phase 1 target.

## Error Handling

HTTP errors should return a consistent JSON shape:

```json
{ "error": "message" }
```

The frontend API client should:

- Throw an `Error` for non-2xx responses.
- Preserve current command return behavior where the UI expects `string | null` validation errors.
- Convert snake_case backend response fields to the current frontend camelCase types where `src/invokes.ts` already does so.

## Testing and Verification

Minimum verification for phase 1:

- `pixi run lint`
- `pixi run frontend-build`
- `pixi run server-check`
- Manual browser smoke test:
  - load app
  - edit ranges
  - build tree
  - run at least one solver step
  - view results
  - export CSV
  - export/import JSON
  - save/load game file

If the Tauri desktop path is intentionally kept during migration, also run:

- `pixi run cargo-check`

## Migration Order

1. Add Rust server target and shared `AppState`.
2. Add JSON API handlers matching current Tauri commands.
3. Add frontend API client helpers in `src/invokes.ts`.
4. Replace Tauri dialog/fs usage with browser file upload/download.
5. Add Pixi tasks and build configuration.
6. Run verification and browser smoke test.

## Open Decisions

Phase 1 decisions are fixed as:

- Single-user only.
- Keep Vue.
- Use HTTP API between browser and Rust server.
- Keep frontend-driven solver loop.
- Keep IndexedDB for saved ranges/configurations.

Potential later-phase decisions:

- Convert solver loop to server-side background jobs.
- Add WebSocket or server-sent events for progress.
- Add multi-user sessions.
- Rewrite frontend to React after API contract stabilizes.

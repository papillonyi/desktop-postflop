# Repository Guidelines

## Project Structure & Module Organization

Desktop Postflop is a single-user web-server app with a React/TypeScript frontend and Rust Axum backend. Frontend code lives in `src/`: React features are grouped under `src/features/`, shared state is in `src/store.ts`, database/migration logic is in `src/db*.ts`, and static assets are in `src/assets/` and `public/`. The Rust HTTP API lives in `src-tauri/src/web/`, with the server entry at `src-tauri/src/bin/web_server.rs`. The solver engine is an external sibling checkout at `../postflop-solver`, referenced from `src-tauri/Cargo.toml`.

## Build, Test, and Development Commands

- `pixi install`: create the local Rust/Node dev environment from `pixi.toml`.
- `pixi run install`: run `npm install` inside the Pixi environment.
- `pixi run dev` / `pixi run server-dev`: run the Rust web server on `127.0.0.1:3000`.
- `pixi run frontend-dev`: start the Vite frontend only.
- `pixi run frontend-build`: build the React frontend into `dist/`.
- `pixi run build` / `pixi run server-build`: build the release web-server binary.
- `pixi run server-start`: run the release web-server binary.
- `pixi run lint` / `pixi run format`: run ESLint or Prettier on frontend files.
- `pixi run server-check` / `pixi run cargo-check`: check the Rust web-server crate.
- `pixi run solver-test`: run tests in the sibling `../postflop-solver` crate.

## Coding Style & Naming Conventions

Use TypeScript, React components, Redux Toolkit state, React Router, and Tailwind utility classes on the frontend. Follow the existing two-space indentation in `.tsx` and `.ts` files, PascalCase component filenames such as `ResultViewer.tsx`, and focused feature directories. Frontend formatting is handled by Prettier with `trailingComma: "es5"`; linting uses React Hooks and TypeScript ESLint rules. Rust code should follow `rustfmt`, snake_case module/function names, and small Axum handlers registered from `src-tauri/src/web/mod.rs`.

## Testing Guidelines

There is no frontend test runner configured, so use `pixi run lint` and `pixi run frontend-build` as the minimum frontend verification. Add Rust unit tests near implementation code or integration tests under `../postflop-solver/tests/`, following existing examples like `kuhn.rs` and `leduc.rs`. Keep solver tests deterministic and small enough for local runs.

## Commit & Pull Request Guidelines

Recent commits use short, lower-case imperative messages such as `add load method`; keep subjects concise and focused. For pull requests, include a clear description, affected frontend/backend areas, test commands run, and screenshots or recordings for visible UI changes. Link related issues when available.

## Security & Configuration Tips

Do not commit generated outputs such as `dist/`, `node_modules/`, `src-tauri/target/`, or local solver save files. Keep solver source changes in the sibling `../postflop-solver` repository. Build performance can depend on Rust toolchain and CPU features; see `README.md` before changing `src-tauri/.cargo/config.toml` or solver dependency features.

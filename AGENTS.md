# Repository Guidelines

## Project Structure & Module Organization

Desktop Postflop is a Tauri desktop app with a Vue 3/TypeScript frontend and Rust backend. Frontend code lives in `src/`: Vue components are in `src/components/`, shared state is in `src/store.ts`, database/migration logic is in `src/db*.ts`, and static assets are in `src/assets/` and `public/`. Tauri backend commands live in `src-tauri/src/`. The solver engine is an external sibling checkout at `../postflop-solver`, referenced from `src-tauri/Cargo.toml`.

## Build, Test, and Development Commands

- `pixi install`: create the local Rust/Node dev environment from `pixi.toml`.
- `pixi run install`: run `npm install` inside the Pixi environment.
- `pixi run dev`: run the full Tauri desktop app.
- `pixi run frontend-dev`: start the Vite frontend only.
- `pixi run build`: build distributable desktop bundles under `src-tauri/target/release/bundle/`.
- `pixi run lint` / `pixi run format`: run ESLint or Prettier on frontend files.
- `pixi run cargo-check`: check the Tauri Rust crate.
- `pixi run solver-test`: run tests in the sibling `../postflop-solver` crate.

## Coding Style & Naming Conventions

Use TypeScript, Vue single-file components, Pinia stores, and Tailwind utility classes on the frontend. Follow the existing two-space indentation in `.vue` and `.ts` files, PascalCase component filenames such as `ResultViewer.vue`, and `useXStore` naming for Pinia stores. Frontend formatting is handled by Prettier with `trailingComma: "es5"`; linting uses Vue 3 and TypeScript ESLint rules. Rust code should follow `rustfmt`, snake_case module/function names, and small command handlers registered in `src-tauri/src/main.rs`.

## Testing Guidelines

There is no frontend test runner configured, so use `pixi run lint` and `pixi run frontend-build` as the minimum frontend verification. Add Rust unit tests near implementation code or integration tests under `../postflop-solver/tests/`, following existing examples like `kuhn.rs` and `leduc.rs`. Keep solver tests deterministic and small enough for local runs.

## Commit & Pull Request Guidelines

Recent commits use short, lower-case imperative messages such as `add load method`; keep subjects concise and focused. For pull requests, include a clear description, affected frontend/backend areas, test commands run, and screenshots or recordings for visible UI changes. Link related issues when available.

## Security & Configuration Tips

Do not commit generated outputs such as `dist/`, `node_modules/`, `src-tauri/target/`, or local solver save files. Keep solver source changes in the sibling `../postflop-solver` repository. Build performance can depend on Rust toolchain and CPU features; see `README.md` before changing `src-tauri/.cargo/config.toml` or solver dependency features.

# Repository Guidelines

## Project Structure & Module Organization

Desktop Postflop is a Tauri desktop app with a Vue 3/TypeScript frontend and Rust backend. Frontend code lives in `src/`: Vue components are in `src/components/`, shared state is in `src/store.ts`, database/migration logic is in `src/db*.ts`, and static frontend assets are in `src/assets/` and `public/`. Tauri backend commands live in `src-tauri/src/`. The solver engine is vendored as the Rust crate `src-tauri/postflop-solver/`, with its own `tests/`, `examples/`, and source modules.

## Build, Test, and Development Commands

- `npm install`: install Node and Tauri CLI dependencies.
- `npm run dev`: start the Vite frontend only.
- `npm run tauri dev`: run the full desktop app in development mode.
- `npm run build`: type-check Vue/TypeScript with `vue-tsc`, then build Vite assets.
- `npm run tauri build`: build distributable desktop bundles under `src-tauri/target/release/bundle/`.
- `npm run lint`: run ESLint on `src/**/*.{ts,vue}`.
- `npm run format`: apply Prettier to frontend TypeScript and Vue files.
- `cargo test --manifest-path src-tauri/postflop-solver/Cargo.toml`: run solver crate tests.

## Coding Style & Naming Conventions

Use TypeScript, Vue single-file components, Pinia stores, and Tailwind utility classes on the frontend. Follow the existing two-space indentation in `.vue` and `.ts` files, PascalCase component filenames such as `ResultViewer.vue`, and `useXStore` naming for Pinia stores. Frontend formatting is handled by Prettier with `trailingComma: "es5"`; linting uses Vue 3 and TypeScript ESLint rules. Rust code should follow `rustfmt`, snake_case module/function names, and small command handlers registered in `src-tauri/src/main.rs`.

## Testing Guidelines

There is no frontend test runner configured, so use `npm run lint` and `npm run build` as the minimum frontend verification. Add Rust unit tests near implementation code or integration tests under `src-tauri/postflop-solver/tests/`, following existing examples like `kuhn.rs` and `leduc.rs`. Keep solver tests deterministic and small enough for local runs.

## Commit & Pull Request Guidelines

Recent commits use short, lower-case imperative messages such as `add load method`; keep subjects concise and focused. For pull requests, include a clear description, affected frontend/backend areas, test commands run, and screenshots or recordings for visible UI changes. Link related issues when available.

## Security & Configuration Tips

Do not commit generated outputs such as `dist/`, `node_modules/`, `src-tauri/target/`, or local solver save files. Build performance can depend on Rust toolchain and CPU features; see `README.md` before changing `src-tauri/.cargo/config.toml` or solver dependency features.

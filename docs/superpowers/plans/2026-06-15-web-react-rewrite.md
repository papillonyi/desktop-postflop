# Web React Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vue web frontend with a React Router + Redux Toolkit frontend that preserves current single-user solver behavior.

**Architecture:** Keep the Rust web server and `src/invokes.ts` HTTP boundary. Replace Vue SFCs and Pinia stores with React TSX feature modules, React Router routes, and Redux Toolkit slices. Reuse framework-neutral DB, result type, and utility code.

**Tech Stack:** React, React DOM, React Router, Redux Toolkit, React Redux, Vite React plugin, TypeScript, Tailwind, Chart.js, react-chartjs-2, Floating UI React, Dexie.

---

## File Structure

- Modify `package.json` and `package-lock.json`: replace Vue dependencies/tooling with React dependencies/tooling.
- Modify `vite.config.ts`: use `@vitejs/plugin-react`.
- Modify `tsconfig.json`: include TSX and React JSX support.
- Modify `.eslintrc.cjs`: replace Vue ESLint config with React hooks/refresh rules.
- Modify `pixi.toml`: update format/lint globs from Vue to TSX.
- Delete `src/main.ts` after replacing it with `src/main.tsx`.
- Delete `src/store.ts` after replacing it with Redux slices under `src/app/`.
- Delete `src/components/*.vue` after equivalent React modules exist.
- Create `src/app/main.tsx`, `src/app/App.tsx`, `src/app/router.tsx`, `src/app/store.ts`, `src/app/hooks.ts`.
- Create `src/app/slices/` for app/config/ranges/results state.
- Create `src/app/layout/` for shell navigation and sidebar.
- Create `src/shared/components/` for cards, poker cards, tooltips, loading/error states, and repeated controls.
- Create `src/features/` modules for board, ranges, tree, bunching, solver, results, and database picker.
- Keep and adjust `src/invokes.ts`, `src/db.ts`, `src/db-migration.ts`, `src/result-types.ts`, `src/utils.ts`, `src/style.css`, assets.

## Task 1: React Tooling Baseline

- [x] Add React, Router, Redux, chart, icon, and tooltip dependencies with npm.
- [x] Remove Vue, Pinia, Vue chart, Vue tooltip, Vue icon, and Vue ESLint dependencies.
- [x] Update Vite, TypeScript, ESLint, package scripts, and Pixi globs for React/TSX.
- [x] Create a minimal React entry and app shell that compiles.
- [x] Run `pixi run lint` and `pixi run frontend-build`.
- [ ] Commit with `switch frontend tooling to react`.

## Task 2: Shared State And Routing

- [x] Create Redux store, typed hooks, and slices for app/config/config snapshots/ranges/results.
- [x] Implement React Router route map and redirects.
- [x] Port top nav, side nav, app layout, and About page.
- [x] Preserve the old solver section labels and active navigation behavior through routes.
- [x] Run `pixi run lint` and `pixi run frontend-build`.
- [ ] Commit with `add react app state and routes`.

## Task 3: Setup Workflow Views

- [x] Port board selection components.
- [x] Port range editor and mini viewer.
- [x] Port tree configuration validation and tree editor.
- [x] Port database item picker and browser JSON import/export.
- [x] Run `pixi run lint` and `pixi run frontend-build`.
- [ ] Commit with `port solver setup views to react`.

## Task 4: Bunching And Solver Run Views

- [x] Port bunching effect UI and polling workflow.
- [x] Port run solver UI, tree build, memory allocation, solve loop, pause/resume/terminate, finalize, and game save/load.
- [x] Preserve browser-compatible file flows.
- [x] Run `pixi run lint`, `pixi run frontend-build`, and `pixi run server-check`.
- [ ] Commit with `port solver execution views to react`.

## Task 5: Results Views

- [x] Port result viewer shell.
- [x] Port result navigation tree and chance card interactions.
- [ ] Port basics, graphs, compare, middle controls, chance chart, and result table.
- [x] Preserve CSV export behavior.
- [x] Run `pixi run lint`, `pixi run frontend-build`, and `pixi run server-check`.
- [ ] Commit with `port results views to react`.

## Task 6: Cleanup And Verification

- [ ] Remove remaining Vue files and imports.
- [ ] Confirm `rg -n "vue|pinia|\\.vue|@heroicons/vue|vue-chartjs|vue-tippy" src package.json vite.config.ts .eslintrc.cjs tsconfig.json` has no unintended runtime references.
- [ ] Run Prettier.
- [ ] Run `pixi run lint`.
- [ ] Run `pixi run frontend-build`.
- [ ] Run `pixi run server-check`.
- [ ] Start `pixi run server-dev` and smoke-test HTTP/static serving.
- [ ] Commit with `finish react web rewrite`.

# Desktop Postflop

> [!IMPORTANT]
> **As of October 2023, upstream open-source development was suspended. See [this issue] for more information.**

[this issue]: https://github.com/b-inary/postflop-solver/issues/46

**Desktop Postflop** is a single-user web-server GTO solver for Texas hold'em poker.

The app is now split into:

- React/TypeScript frontend in `src/`, built by Vite into `dist/`.
- Rust Axum web server in `src-tauri/src/bin/web_server.rs` and `src-tauri/src/web/`.
- Solver engine from the sibling checkout `../postflop-solver`.

The server owns all solver state in memory and exposes it through `/api/*`. The React app is served from the same Rust process in production-style runs, so the browser talks to the local server at `http://127.0.0.1:3000`.

## Requirements

- Pixi
- The sibling solver checkout at `../postflop-solver`
- macOS Apple silicon or Linux x86_64 for the checked-in Pixi platforms (`osx-arm64`, `linux-64`)

Install the local Node/Rust environment and npm dependencies:

```sh
pixi install
pixi run install
```

## Development Startup

Build the frontend once, then start the Rust web server:

```sh
pixi run frontend-build
pixi run server-dev
```

Open:

```text
http://127.0.0.1:3000
```

For frontend HMR, run the API server and Vite dev server in separate terminals:

```sh
pixi run server-dev
pixi run frontend-dev
```

Open the Vite URL printed by `frontend-dev`. Vite proxies `/api` requests to `http://127.0.0.1:3000`.

The frontend dev server prefers `0.0.0.0:30001` and falls back to the next free port if that is already in use. Use the Vite URL printed by `frontend-dev`; from another machine, replace the host with the Linux host's IP address, for example `http://<linux-host-ip>:30001`.

## Production-Style Local Run

Build the static frontend and release server binary:

```sh
pixi run frontend-build
pixi run server-build
```

Run the release binary:

```sh
pixi run server-start
```

Then open:

```text
http://127.0.0.1:3000
```

The current server serves `dist/` from this checkout and binds to `127.0.0.1:3000`.

## Training Data Workflow

Training profiles live in `training-profiles/`. Profiles reference range files by `oopRangePath` and `ipRangePath`; the checked-in source ranges live under `training-ranges/`. The 6-max profile set uses `training-ranges/6max`, copied from `~/workspace/gto/ranges/6max_range`, and `training-profiles/smoke.json` uses tiny `AA` vs `KK` ranges for fast development checks.

Profile amounts use `1 = 1bb`. Because the solver stores pot and stack as integers, half-bb preflop pots are rounded to the nearest bb in the checked-in profiles. Stack depth variants are listed under `stackVariants`, for example `100bb weight 50` and `200bb weight 50`; the training session picker first samples the profile by `weight`, then samples the stack variant by `stackWeight`, then samples a solved flop for that stack.

Tree sizes are profile data, not Rust presets. `treeConfig.flop/turn/river` define OOP/IP bet sizes, raise size, and donk size. The formal 6-max profiles use `30%,80%,150%` bets, `3x` raises, and `50%` donks. The solver has no separate flop-donk field, so when a profile includes `treeConfig.flop.donk`, it is represented as the OOP flop bet size for that spot.

Generated solver files are not committed. Write precomputed training libraries outside this repo, for example:

```sh
pixi run training-precompute-release --config training-profiles/smoke.json --out ../training-games-dev --overwrite
```

Use `training-profiles/dev-light.json` for real 6-max BTN-vs-BB range jobs with a lightweight inline tree config. It has one flop and the same 100bb/200bb stack variants as the formal profiles; add `--limit 1` when you only want one quick end-to-end job:

```sh
pixi run training-precompute-release --config training-profiles/dev-light.json --out ../training-games-dev --overwrite --limit 1
```

For a quick profile/path validation without generating `.bin` files:

```sh
pixi run training-precompute-release --config training-profiles/6max-heads-up.json --out /tmp/desktop-postflop-6max-dry-run --dry-run --limit 3 --overwrite
```

The precompute command prints per-job progress plus intra-job stages such as `build_tree`, `memory_estimate`, `allocate_memory`, `initial_exploitability`, and iteration starts/checkpoints. Intra-job stage lines include `elapsed_ms` from the start of that job. The training library manifest is written to `<out>/manifest.json`, and solved jobs are stored as `<out>/<potType>/<profileId>/*.bin`. The Training page defaults to `../training-games-dev`; pass a different root in the page input if you generated data elsewhere.

## Checks

```sh
pixi run lint
pixi run frontend-build
pixi run server-check
```

Optional solver tests live in the sibling solver crate:

```sh
pixi run solver-test
```

## License

Copyright (C) 2022 Wataru Inariba

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

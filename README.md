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

The frontend dev server listens on `0.0.0.0:30000`, so it can be reached from another machine through the Linux host's IP address, for example `http://<linux-host-ip>:30000`.

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

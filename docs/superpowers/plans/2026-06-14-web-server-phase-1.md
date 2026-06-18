# Web Server Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user Rust HTTP server for Desktop Postflop while keeping the current Vue UI and solver behavior.

**Architecture:** Add an axum web-server path beside the existing Tauri path. The server owns one global solver state and exposes HTTP JSON/file endpoints that mirror the current Tauri commands. The Vue frontend keeps its component structure and replaces Tauri IPC/file APIs with fetch plus browser upload/download helpers.

**Tech Stack:** Rust 1.88+, axum, tokio, tower-http, tracing, thiserror, tempfile, Vue 3, TypeScript, Pinia, Dexie, Vite.

---

## File Structure

- Modify `pixi.toml`: raise Rust baseline and add server tasks.
- Modify `src-tauri/Cargo.toml`: raise `rust-version`, add web dependencies, add a `web-server` binary.
- Create `src-tauri/src/lib.rs`: expose shared modules to both Tauri and web binaries.
- Modify `src-tauri/src/main.rs`: import shared modules from the library crate instead of declaring local modules.
- Create `src-tauri/src/app_state.rs`: define the single-user server state.
- Create `src-tauri/src/web/mod.rs`: axum router assembly.
- Create `src-tauri/src/web/error.rs`: JSON error response type.
- Create `src-tauri/src/web/system.rs`: system endpoints.
- Create `src-tauri/src/web/range.rs`: range endpoints.
- Create `src-tauri/src/web/tree.rs`: tree endpoints.
- Create `src-tauri/src/web/bunching.rs`: bunching endpoints.
- Create `src-tauri/src/web/game.rs`: game endpoints.
- Create `src-tauri/src/web/files.rs`: game `.bin` upload/download endpoints.
- Create `src-tauri/src/bin/web_server.rs`: server binary entrypoint.
- Modify `vite.config.ts`: add `/api` proxy for frontend dev.
- Modify `src/invokes.ts`: replace Tauri `invoke` with fetch-based API functions.
- Create `src/browser-file.ts`: browser upload/download helper functions.
- Modify `src/components/DbItemPicker.vue`: replace Tauri JSON import/export.
- Modify `src/components/ResultTable.vue`: replace Tauri CSV export.
- Modify `src/components/RunSolver.vue`: replace hard-coded Tauri game save/load.
- Modify `package.json`: remove direct frontend dependency on `@tauri-apps/api` only after all imports are gone.

## Task 1: Upgrade Toolchain And Add Dependencies

**Files:**
- Modify: `pixi.toml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/bin/web_server.rs`
- Modify: `src-tauri/src/solver.rs`

- [ ] **Step 1: Edit `pixi.toml`**

Set Rust to a modern stable baseline and add server commands:

```toml
[tasks]
install = "npm install"
dev = "RUSTFLAGS='-A dangerous_implicit_autorefs' npm run tauri dev"
frontend-dev = "npm run dev"
server-dev = "RUSTFLAGS='-A dangerous_implicit_autorefs' cargo run --manifest-path src-tauri/Cargo.toml --bin web-server"
server-check = "RUSTFLAGS='-A dangerous_implicit_autorefs' cargo check --manifest-path src-tauri/Cargo.toml --bin web-server"
build = "RUSTFLAGS='-A dangerous_implicit_autorefs' npm run tauri build"
frontend-build = "npm run build"
lint = "npm run lint"
format = "prettier --write src/**/*.{ts,vue}"
cargo-check = "RUSTFLAGS='-A dangerous_implicit_autorefs' cargo check --manifest-path src-tauri/Cargo.toml"
solver-test = "RUSTFLAGS='-A dangerous_implicit_autorefs' cargo test --manifest-path postflop-solver/Cargo.toml"

[dependencies]
nodejs = ">=20,<21"
rust = ">=1.88,<2"
```

`postflop-solver` currently contains raw-pointer indexing code that triggers Rust 1.88+'s `dangerous_implicit_autorefs` deny-by-default lint. Keep the compatibility flag scoped to Rust Pixi tasks until the solver crate is updated.

- [ ] **Step 2: Edit `src-tauri/Cargo.toml`**

Raise the Rust version and add web dependencies:

```toml
rust-version = "1.88"

[[bin]]
name = "web-server"
path = "src/bin/web_server.rs"

[dependencies]
serde_json = "1.0.107"
serde = { version = "1.0.188", features = ["derive"] }
tauri = { version = "1.5.0", features = ["dialog-all", "fs-read-file", "fs-write-file", "shell-open"] }
postflop-solver = { path = "../postflop-solver" }
rayon = "1.8.0"
sysinfo = "0.29.10"
bincode = "=2.0.0-rc.3"
axum = { version = "0.8", features = ["multipart"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["cors", "fs", "limit", "trace"] }
tracing = "0.1"
tracing-subscriber = "0.3"
thiserror = "2"
tempfile = "3"
tokio-util = { version = "0.7", features = ["io"] }
```

Use the stable Rust path for Phase 1. The solver's `custom-alloc` feature requires nightly Rust and conflicts with the stable Pixi baseline. Pin `bincode` exactly to `2.0.0-rc.3` so Cargo does not resolve `bincode_derive` to an incompatible newer release.

- [ ] **Step 3: Create placeholder `src-tauri/src/bin/web_server.rs`**

```rust
fn main() {
    eprintln!("web-server entrypoint is not implemented yet");
}
```

This keeps `cargo check --bin web-server` valid until the real server entrypoint is added in Task 4.

- [ ] **Step 4: Keep desktop save checkable**

Keep the existing local game-save serialization path in `src-tauri/src/solver.rs`, including its ability to save non-finished solver states. Add the missing local `encode_into_std_write` helper and call `bincode::encode_into_std_write(..., bincode::config::standard())` so `pixi run cargo-check` compiles under the pinned bincode rc.3 dependency without introducing the solver crate's `is_ready_to_save()` restriction.

- [ ] **Step 5: Refresh dependency lock**

Run:

```bash
pixi lock
```

Expected: `pixi.lock` updates successfully.

- [ ] **Step 6: Verify existing frontend still installs**

Run:

```bash
pixi install
```

Expected: Pixi environment resolves with Rust 1.88+ and Node 20.

- [ ] **Step 7: Verify Rust targets**

Run:

```bash
pixi run server-check
pixi run cargo-check
```

Expected: both commands pass. Warnings from the `postflop-solver` crate are allowed in this phase.

- [ ] **Step 8: Commit**

```bash
git add pixi.toml pixi.lock src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/bin/web_server.rs src-tauri/src/solver.rs
git commit -m "add web server dependencies"
```

## Task 2: Expose Shared Rust Library Modules

**Files:**
- Create: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `src-tauri/src/lib.rs`**

```rust
pub mod app_state;
pub mod bunching;
pub mod range;
pub mod solver;
pub mod tree;
pub mod web;
```

- [ ] **Step 2: Update `src-tauri/src/main.rs` imports**

Remove these local declarations:

```rust
mod bunching;
mod range;
mod solver;
mod tree;
use crate::bunching::*;
use crate::range::*;
use crate::solver::*;
use crate::tree::*;
```

Add these imports:

```rust
use desktop_postflop::bunching::*;
use desktop_postflop::range::*;
use desktop_postflop::solver::*;
use desktop_postflop::tree::*;
```

- [ ] **Step 3: Verify Tauri target still checks**

Run:

```bash
pixi run cargo-check
```

Expected: compile reaches the same dependency set as before and does not fail on missing modules.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "expose shared rust modules"
```

## Task 3: Add Server App State And Error Type

**Files:**
- Create: `src-tauri/src/app_state.rs`
- Create: `src-tauri/src/web/error.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/app_state.rs`**

```rust
use crate::bunching::BunchingData;
use crate::range::RangeManager;
use crate::tree::default_action_tree;
use postflop_solver::{ActionTree, PostFlopGame};
use rayon::{ThreadPool, ThreadPoolBuilder};
use std::sync::{Arc, Mutex};

pub type SharedAppState = Arc<AppState>;

pub struct AppState {
    pub ranges: Mutex<RangeManager>,
    pub tree: Mutex<ActionTree>,
    pub bunching: Mutex<Option<BunchingData>>,
    pub game: Mutex<PostFlopGame>,
    pub pool: Mutex<ThreadPool>,
}

impl AppState {
    pub fn new() -> SharedAppState {
        Arc::new(Self {
            ranges: Mutex::new(RangeManager::default()),
            tree: Mutex::new(default_action_tree()),
            bunching: Mutex::new(None),
            game: Mutex::new(PostFlopGame::default()),
            pool: Mutex::new(ThreadPoolBuilder::new().build().unwrap()),
        })
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/web/error.rs`**

```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = Json(ErrorBody {
            error: self.to_string(),
        });
        (status, body).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 3: Create initial `src-tauri/src/web/mod.rs`**

```rust
pub mod error;

use crate::app_state::SharedAppState;
use axum::{routing::get, Router};

async fn health() -> &'static str {
    "ok"
}

pub fn router(state: SharedAppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .with_state(state)
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/app_state.rs src-tauri/src/web/error.rs src-tauri/src/web/mod.rs
git commit -m "add web server app state"
```

## Task 4: Add Web Server Binary

**Files:**
- Create: `src-tauri/src/bin/web_server.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/bin/web_server.rs`**

```rust
use desktop_postflop::{app_state::AppState, web};
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = AppState::new();
    let app = web::router(state).layer(TraceLayer::new_for_http());
    let addr = SocketAddr::from(([127, 0, 0, 1], 3030));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind web server");

    tracing::info!("web server listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("web server failed");
}
```

- [ ] **Step 2: Check server binary**

Run:

```bash
pixi run server-check
```

Expected: `web-server` compiles.

- [ ] **Step 3: Run server and health check**

Run in one terminal:

```bash
pixi run server-dev
```

Run in another terminal:

```bash
curl http://127.0.0.1:3030/api/health
```

Expected: response body is `ok`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/bin/web_server.rs
git commit -m "add axum server entrypoint"
```

## Task 5: Add System Endpoints

**Files:**
- Create: `src-tauri/src/web/system.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/web/system.rs`**

```rust
use crate::app_state::SharedAppState;
use axum::{extract::State, Json};
use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use sysinfo::{System, SystemExt};

#[derive(Serialize)]
pub struct OsNameResponse {
    os_name: &'static str,
}

#[derive(Serialize)]
pub struct MemoryResponse {
    available: u64,
    total: u64,
}

#[derive(Deserialize)]
pub struct SetThreadsRequest {
    num_threads: usize,
}

pub async fn os_name() -> Json<OsNameResponse> {
    let os_name = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    Json(OsNameResponse { os_name })
}

pub async fn memory() -> Json<MemoryResponse> {
    let mut system = System::new_all();
    system.refresh_memory();
    Json(MemoryResponse {
        available: system.available_memory(),
        total: system.total_memory(),
    })
}

pub async fn set_threads(
    State(state): State<SharedAppState>,
    Json(req): Json<SetThreadsRequest>,
) {
    *state.pool.lock().unwrap() = ThreadPoolBuilder::new()
        .num_threads(req.num_threads)
        .build()
        .unwrap();
}
```

- [ ] **Step 2: Register routes in `src-tauri/src/web/mod.rs`**

```rust
pub mod error;
pub mod system;

use crate::app_state::SharedAppState;
use axum::{
    routing::{get, post},
    Router,
};

async fn health() -> &'static str {
    "ok"
}

pub fn router(state: SharedAppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/system/os-name", get(system::os_name))
        .route("/api/system/memory", get(system::memory))
        .route("/api/system/threads", post(system::set_threads))
        .with_state(state)
}
```

- [ ] **Step 3: Verify endpoints**

Run:

```bash
pixi run server-check
```

Expected: server binary compiles.

Run with the server started:

```bash
curl http://127.0.0.1:3030/api/system/os-name
curl http://127.0.0.1:3030/api/system/memory
curl -X POST http://127.0.0.1:3030/api/system/threads \
  -H 'content-type: application/json' \
  -d '{"num_threads":4}'
```

Expected: OS and memory return JSON, `threads` returns `200 OK`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/web/system.rs src-tauri/src/web/mod.rs
git commit -m "add system web endpoints"
```

## Task 6: Add Range Endpoints

**Files:**
- Create: `src-tauri/src/web/range.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/web/range.rs`**

Implement handlers that mirror `src-tauri/src/range.rs`:

```rust
use crate::app_state::SharedAppState;
use axum::{
    extract::{Path, State},
    Json,
};
use postflop_solver::Range;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Serialize)]
pub struct NumCombosResponse {
    value: f64,
}

#[derive(Serialize)]
pub struct StringResponse {
    value: String,
}

#[derive(Serialize)]
pub struct OptionalErrorResponse {
    error: Option<String>,
}

#[derive(Serialize)]
pub struct NumbersResponse<T> {
    value: Vec<T>,
}

#[derive(Deserialize)]
pub struct UpdateRequest {
    row: u8,
    col: u8,
    weight: f32,
}

#[derive(Deserialize)]
pub struct FromStringRequest {
    str: String,
}

pub async fn num_combos(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
) -> Json<NumCombosResponse> {
    let ranges = state.ranges.lock().unwrap();
    let range = &ranges.0[player];
    Json(NumCombosResponse {
        value: range.raw_data().iter().fold(0.0, |acc, &x| acc + x as f64),
    })
}

pub async fn clear(State(state): State<SharedAppState>, Path(player): Path<usize>) {
    state.ranges.lock().unwrap().0[player].clear();
}

pub async fn invert(State(state): State<SharedAppState>, Path(player): Path<usize>) {
    state.ranges.lock().unwrap().0[player].invert();
}

pub async fn update(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
    Json(req): Json<UpdateRequest>,
) {
    let mut ranges = state.ranges.lock().unwrap();
    let range = &mut ranges.0[player];
    let rank1 = 13 - req.row;
    let rank2 = 13 - req.col;
    match req.row.cmp(&req.col) {
        Ordering::Equal => range.set_weight_pair(rank1, req.weight),
        Ordering::Less => range.set_weight_suited(rank1, rank2, req.weight),
        Ordering::Greater => range.set_weight_offsuit(rank1, rank2, req.weight),
    }
}

pub async fn from_string(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
    Json(req): Json<FromStringRequest>,
) -> Json<OptionalErrorResponse> {
    let result = Range::from_sanitized_str(req.str.as_str());
    match result {
        Ok(range) => {
            state.ranges.lock().unwrap().0[player] = range;
            Json(OptionalErrorResponse { error: None })
        }
        Err(error) => Json(OptionalErrorResponse { error: Some(error) }),
    }
}

pub async fn to_string(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
) -> Json<StringResponse> {
    Json(StringResponse {
        value: state.ranges.lock().unwrap().0[player].to_string(),
    })
}

pub async fn weights(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
) -> Json<NumbersResponse<f32>> {
    let ranges = state.ranges.lock().unwrap();
    let range = &ranges.0[player];
    let mut weights = vec![0.0; 13 * 13];

    for row in 0..13 {
        for col in 0..13 {
            let rank1 = 12 - row as u8;
            let rank2 = 12 - col as u8;
            weights[row * 13 + col] = match row.cmp(&col) {
                Ordering::Equal => range.get_weight_pair(rank1),
                Ordering::Less => range.get_weight_suited(rank1, rank2),
                Ordering::Greater => range.get_weight_offsuit(rank1, rank2),
            };
        }
    }

    Json(NumbersResponse { value: weights })
}

pub async fn raw_data(
    State(state): State<SharedAppState>,
    Path(player): Path<usize>,
) -> Json<NumbersResponse<f32>> {
    Json(NumbersResponse {
        value: state.ranges.lock().unwrap().0[player].raw_data().to_vec(),
    })
}
```

- [ ] **Step 2: Register range routes**

Add `pub mod range;` and nest these routes in `web/mod.rs`:

```rust
.route("/api/range/:player/num-combos", get(range::num_combos))
.route("/api/range/:player/clear", post(range::clear))
.route("/api/range/:player/invert", post(range::invert))
.route("/api/range/:player/update", post(range::update))
.route("/api/range/:player/from-string", post(range::from_string))
.route("/api/range/:player/to-string", get(range::to_string))
.route("/api/range/:player/weights", get(range::weights))
.route("/api/range/:player/raw-data", get(range::raw_data))
```

- [ ] **Step 3: Verify range endpoints**

Run:

```bash
pixi run server-check
```

Expected: server binary compiles.

Run with server started:

```bash
curl http://127.0.0.1:3030/api/range/0/to-string
curl -X POST http://127.0.0.1:3030/api/range/0/from-string \
  -H 'content-type: application/json' \
  -d '{"str":"AA"}'
curl http://127.0.0.1:3030/api/range/0/weights
```

Expected: first request returns a JSON string wrapper, second returns `{"error":null}`, third returns a 169-element `value` array.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/web/range.rs src-tauri/src/web/mod.rs
git commit -m "add range web endpoints"
```

## Task 7: Add Tree, Bunching, And Game JSON Endpoints

**Files:**
- Create: `src-tauri/src/web/tree.rs`
- Create: `src-tauri/src/web/bunching.rs`
- Create: `src-tauri/src/web/game.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Implement `src-tauri/src/web/tree.rs`**

Copy the action encoding/decoding helpers from `src-tauri/src/tree.rs`. Use `SharedAppState.tree` instead of `tauri::State<Mutex<ActionTree>>`. Request/response structs use snake_case JSON fields matching the frontend API client.

Required handlers:

```rust
pub async fn new_tree(State(state): State<SharedAppState>, Json(req): Json<TreeNewRequest>) -> Json<BoolResponse>
pub async fn added_lines(State(state): State<SharedAppState>) -> Json<StringResponse>
pub async fn removed_lines(State(state): State<SharedAppState>) -> Json<StringResponse>
pub async fn invalid_terminals(State(state): State<SharedAppState>) -> Json<StringResponse>
pub async fn actions(State(state): State<SharedAppState>) -> Json<StringsResponse>
pub async fn is_terminal_node(State(state): State<SharedAppState>) -> Json<BoolResponse>
pub async fn is_chance_node(State(state): State<SharedAppState>) -> Json<BoolResponse>
pub async fn back_to_root(State(state): State<SharedAppState>)
pub async fn apply_history(State(state): State<SharedAppState>, Json(req): Json<ApplyHistoryRequest>)
pub async fn play(State(state): State<SharedAppState>, Json(req): Json<PlayRequest>) -> Json<IntResponse>
pub async fn total_bet_amount(State(state): State<SharedAppState>) -> Json<IntArrayResponse>
pub async fn add_bet_action(State(state): State<SharedAppState>, Json(req): Json<AddBetActionRequest>)
pub async fn remove_current_node(State(state): State<SharedAppState>)
pub async fn delete_added_line(State(state): State<SharedAppState>, Json(req): Json<LineRequest>)
pub async fn delete_removed_line(State(state): State<SharedAppState>, Json(req): Json<LineRequest>)
```

Use the same algorithm bodies as the existing Tauri commands. For `TreeNewRequest`, fields are:

```rust
board_len: i32,
starting_pot: i32,
effective_stack: i32,
donk_option: bool,
oop_flop_bet: String,
oop_flop_raise: String,
oop_turn_bet: String,
oop_turn_raise: String,
oop_turn_donk: String,
oop_river_bet: String,
oop_river_raise: String,
oop_river_donk: String,
ip_flop_bet: String,
ip_flop_raise: String,
ip_turn_bet: String,
ip_turn_raise: String,
ip_river_bet: String,
ip_river_raise: String,
add_allin_threshold: f64,
force_allin_threshold: f64,
merging_threshold: f64,
added_lines: String,
removed_lines: String,
```

- [ ] **Step 2: Implement `src-tauri/src/web/bunching.rs`**

Mirror `src-tauri/src/bunching.rs` with handlers:

```rust
pub async fn init(State(state): State<SharedAppState>, Json(req): Json<BunchingInitRequest>) -> Json<OptionalErrorResponse>
pub async fn clear(State(state): State<SharedAppState>)
pub async fn progress(State(state): State<SharedAppState>) -> Json<ByteArrayResponse>
```

Use `state.ranges`, `state.bunching`, and `state.pool`.

- [ ] **Step 3: Implement `src-tauri/src/web/game.rs`**

Mirror `src-tauri/src/solver.rs` with handlers for all game JSON APIs except file upload/download:

```rust
pub async fn init(State(state): State<SharedAppState>, Json(req): Json<GameInitRequest>) -> Json<OptionalErrorResponse>
pub async fn private_cards(State(state): State<SharedAppState>) -> Json<PrivateCardsResponse>
pub async fn memory_usage(State(state): State<SharedAppState>) -> Json<U64ArrayResponse>
pub async fn memory_usage_bunching(State(state): State<SharedAppState>) -> Json<U64Response>
pub async fn allocate_memory(State(state): State<SharedAppState>, Json(req): Json<AllocateMemoryRequest>)
pub async fn set_bunching(State(state): State<SharedAppState>) -> Json<OptionalErrorResponse>
pub async fn solve_step(State(state): State<SharedAppState>, Json(req): Json<SolveStepRequest>)
pub async fn exploitability(State(state): State<SharedAppState>) -> Json<F32Response>
pub async fn finalize(State(state): State<SharedAppState>)
pub async fn apply_history(State(state): State<SharedAppState>, Json(req): Json<GameApplyHistoryRequest>)
pub async fn total_bet_amount(State(state): State<SharedAppState>, Json(req): Json<AppendRequest>) -> Json<IntArrayResponse>
pub async fn actions_after(State(state): State<SharedAppState>, Json(req): Json<AppendRequest>) -> Json<StringsResponse>
pub async fn possible_cards(State(state): State<SharedAppState>) -> Json<U64Response>
pub async fn results(State(state): State<SharedAppState>) -> Json<GameResultsResponse>
pub async fn chance_reports(State(state): State<SharedAppState>, Json(req): Json<ChanceReportsRequest>) -> Json<GameChanceReportsResponse>
pub async fn board(State(state): State<SharedAppState>) -> Json<ByteVecResponse>
```

Move `GameResultsResponse` and `GameChanceReportsResponse` derives to include `serde::Serialize` and reuse the field names from the Tauri response.

- [ ] **Step 4: Register routes in `web/mod.rs`**

Add `pub mod tree;`, `pub mod bunching;`, and `pub mod game;`. Register all routes from the spec using `get` and `post` with matching paths.

- [ ] **Step 5: Verify compile**

Run:

```bash
pixi run server-check
```

Expected: server binary compiles.

- [ ] **Step 6: Probe representative endpoints**

Run with server started:

```bash
curl http://127.0.0.1:3030/api/tree/actions
curl -X POST http://127.0.0.1:3030/api/bunching/clear
curl http://127.0.0.1:3030/api/game/memory-usage
```

Expected: tree actions and memory usage return JSON; bunching clear returns `200 OK`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/web/tree.rs src-tauri/src/web/bunching.rs src-tauri/src/web/game.rs src-tauri/src/web/mod.rs
git commit -m "add solver web endpoints"
```

## Task 8: Add Game File Upload And Download

**Files:**
- Create: `src-tauri/src/web/files.rs`
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/web/files.rs`**

Implement two handlers:

```rust
use crate::{app_state::SharedAppState, web::error::{AppError, AppResult}};
use axum::{
    body::Body,
    extract::{Multipart, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bincode::enc::{Encode, Encoder};
use postflop_solver::{encode_into_std_write, load_data_from_file, DataType, PostFlopGame};
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use tempfile::NamedTempFile;

const MAGIC: u32 = 0x09f15790;
const VERSION: u8 = 1;

struct EncodableGame<'a>(&'a Mutex<PostFlopGame>);

impl Encode for EncodableGame<'_> {
    fn encode<E: Encoder>(&self, encoder: &mut E) -> Result<(), bincode::error::EncodeError> {
        self.0.lock().unwrap().encode(encoder)
    }
}

pub async fn download(State(state): State<SharedAppState>) -> AppResult<Response> {
    let mut tmp = NamedTempFile::new().map_err(|e| AppError::Internal(e.to_string()))?;
    {
        let mut writer = BufWriter::new(tmp.as_file_mut());
        let compression_level: Option<i32> = None;
        let memo = "memo string";

        encode_into_std_write(MAGIC, &mut writer, "Failed to write magic number")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(VERSION, &mut writer, "Failed to write version number")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(compression_level.is_some() as u8, &mut writer, "Failed to write compression type")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(DataType::Game as u8, &mut writer, "Failed to write data type")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(
            state.game.lock().unwrap().estimated_memory_usage(),
            &mut writer,
            "Failed to write memory usage",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(memo, &mut writer, "Failed to write memo")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        encode_into_std_write(EncodableGame(&state.game), &mut writer, "Failed to write data")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        writer.flush().map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let bytes = tokio::fs::read(tmp.path())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"desktop-postflop-game.bin\""),
        ],
        Body::from(bytes),
    )
        .into_response())
}

pub async fn upload(
    State(state): State<SharedAppState>,
    mut multipart: Multipart,
) -> AppResult<StatusCode> {
    let mut tmp = NamedTempFile::new().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut found_file = false;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() == Some("file") {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            tmp.write_all(&bytes)
                .map_err(|e| AppError::Internal(e.to_string()))?;
            found_file = true;
        }
    }

    if !found_file {
        return Err(AppError::BadRequest("missing file field".to_string()));
    }

    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError::Internal("temporary path is not valid unicode".to_string()))?
        .to_string();
    let (game, _memo): (PostFlopGame, _) =
        load_data_from_file(path, None).map_err(|e| AppError::BadRequest(e.to_string()))?;
    *state.game.lock().unwrap() = game;
    let game_ranges = state.game.lock().unwrap().card_config().range;
    let mut ranges = state.ranges.lock().unwrap();
    ranges.0[0] = game_ranges[0];
    ranges.0[1] = game_ranges[1];

    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Register file routes**

Add `pub mod files;` and routes:

```rust
.route("/api/game/file", get(files::download).post(files::upload))
```

- [ ] **Step 3: Compile**

Run:

```bash
pixi run server-check
```

Expected: server binary compiles.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/web/files.rs src-tauri/src/web/mod.rs
git commit -m "add game file endpoints"
```

## Task 9: Configure Frontend Dev Proxy

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Add Vite proxy**

Inside `server`, keep `strictPort` and add `/api` proxy:

```ts
server: {
  strictPort: true,
  proxy: {
    "/api": {
      target: "http://127.0.0.1:3030",
      changeOrigin: true,
    },
  },
},
```

- [ ] **Step 2: Run frontend build**

Run:

```bash
pixi run frontend-build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "proxy api requests in vite"
```

## Task 10: Replace Tauri Invoke Client With Fetch Client

**Files:**
- Modify: `src/invokes.ts`

- [ ] **Step 1: Remove Tauri imports**

Remove:

```ts
import { invoke } from "@tauri-apps/api";
import { message } from "@tauri-apps/api/dialog";
```

- [ ] **Step 2: Add API helpers at top of `src/invokes.ts`**

```ts
const apiJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let error = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) error = body.error;
    } catch {
      // keep HTTP status text
    }
    throw new Error(error);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const apiGet = <T>(path: string) => apiJson<T>(path);

const apiPost = <T>(path: string, body?: unknown) =>
  apiJson<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
```

- [ ] **Step 3: Replace simple wrappers**

Use these conversion patterns:

```ts
export const osName = async (): Promise<"windows" | "macos" | "linux"> => {
  const response = await apiGet<{ os_name: "windows" | "macos" | "linux" }>(
    "/api/system/os-name"
  );
  return response.os_name;
};

export const memory = async (): Promise<number[]> => {
  const response = await apiGet<{ available: number; total: number }>(
    "/api/system/memory"
  );
  return [response.available, response.total];
};

export const setNumThreads = async (numThreads: number) => {
  await apiPost<void>("/api/system/threads", { num_threads: numThreads });
};
```

Convert the remaining functions with the same rule:

- path uses the API path from the spec.
- request fields sent to Rust are snake_case.
- responses unwrap `{ value }`, `{ error }`, `{ os_name }`, or typed response bodies.
- `gameGetResults` and `gameGetChanceReports` keep the existing snake_case to camelCase mapping.

- [ ] **Step 4: Add file API helpers**

Add:

```ts
export const saveGameToBin = async (): Promise<Blob> => {
  const response = await fetch("/api/game/file");
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.blob();
};

export const loadGameFromBin = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/game/file", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
};
```

- [ ] **Step 5: Type-check frontend**

Run:

```bash
pixi run frontend-build
```

Expected: build fails only where components still call old file signatures; fix those in later tasks before committing this task. If it already passes, commit now.

- [ ] **Step 6: Commit after component call sites compile**

```bash
git add src/invokes.ts
git commit -m "replace tauri invoke client"
```

## Task 11: Add Browser File Helpers

**Files:**
- Create: `src/browser-file.ts`

- [ ] **Step 1: Create `src/browser-file.ts`**

```ts
export const downloadTextFile = (
  filename: string,
  contents: string,
  type = "text/plain"
) => {
  downloadBlob(filename, new Blob([contents], { type }));
};

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const chooseFile = (accept: string): Promise<File | null> => {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/browser-file.ts
git commit -m "add browser file helpers"
```

## Task 12: Replace JSON Import Export In DbItemPicker

**Files:**
- Modify: `src/components/DbItemPicker.vue`

- [ ] **Step 1: Replace imports**

Remove:

```ts
import { open, save } from "@tauri-apps/api/dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";
```

Add:

```ts
import { chooseFile, downloadTextFile } from "../browser-file";
```

- [ ] **Step 2: Replace `importJson` file selection**

Replace the Tauri open/read block with:

```ts
  const file = await chooseFile("application/json,.json");
  if (!file) return;

  importError.value = "";

  const text = await file.text();
```

Keep the existing JSON parse, validation, `Db.bulkAdd`, broadcast, and `loadData()` logic.

- [ ] **Step 3: Replace `exportJson` save block**

Replace the Tauri save/write block with:

```ts
  downloadTextFile(`${props.storeName}.json`, jsonStr, "application/json");
```

- [ ] **Step 4: Verify frontend compile**

Run:

```bash
pixi run frontend-build
```

Expected: no TypeScript errors from `DbItemPicker.vue`.

- [ ] **Step 5: Commit**

```bash
git add src/components/DbItemPicker.vue
git commit -m "use browser json import export"
```

## Task 13: Replace CSV Export In ResultTable

**Files:**
- Modify: `src/components/ResultTable.vue`

- [ ] **Step 1: Replace imports**

Remove:

```ts
import { save } from "@tauri-apps/api/dialog";
import { writeTextFile } from "@tauri-apps/api/fs";
```

Add:

```ts
import { downloadTextFile } from "../browser-file";
```

- [ ] **Step 2: Replace Tauri save block**

Replace:

```ts
  const filePath = await save({
    defaultPath: "summary.csv",
    filters: [{ name: "CSV Files", extensions: ["csv"] }],
  });

  if (filePath) {
    await writeTextFile(filePath, data.join("\n"));
  }
```

With:

```ts
  downloadTextFile("summary.csv", data.join("\n"), "text/csv");
```

- [ ] **Step 3: Verify frontend compile**

Run:

```bash
pixi run frontend-build
```

Expected: no TypeScript errors from `ResultTable.vue`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ResultTable.vue
git commit -m "use browser csv export"
```

## Task 14: Replace Game Save Load In RunSolver

**Files:**
- Modify: `src/components/RunSolver.vue`

- [ ] **Step 1: Add browser helper import**

Add:

```ts
import { chooseFile, downloadBlob } from "../browser-file";
```

- [ ] **Step 2: Replace `saveGame`**

Replace current hard-coded Windows path implementation with:

```ts
const saveGame = async () => {
  const blob = await invokes.saveGameToBin();
  downloadBlob("desktop-postflop-game.bin", blob);
};
```

- [ ] **Step 3: Replace `loadGame`**

Replace current hard-coded Windows path implementation with:

```ts
const loadGame = async () => {
  const file = await chooseFile("application/octet-stream,.bin");
  if (!file) return;

  await invokes.loadGameFromBin(file);
  config.board = await invokes.loadBoardFromGame();
  for (let player = 0; player < 2; ++player) {
    store.ranges[player] = await invokes.rangeGetWeights(player);
  }
};
```

- [ ] **Step 4: Verify frontend compile**

Run:

```bash
pixi run frontend-build
```

Expected: no TypeScript errors from `RunSolver.vue`.

- [ ] **Step 5: Commit**

```bash
git add src/components/RunSolver.vue src/invokes.ts
git commit -m "use browser game save load"
```

## Task 15: Remove Frontend Tauri API Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm no frontend Tauri imports remain**

Run:

```bash
rg -n "@tauri-apps/api|readTextFile|writeTextFile|open\\(|save\\(|message\\(" src
```

Expected: no matches except unrelated canvas `ctx.save()` if the regex catches plain `save(` in drawing code.

- [ ] **Step 2: Remove dependency**

Run:

```bash
npm uninstall @tauri-apps/api
```

Expected: `package.json` and `package-lock.json` remove `@tauri-apps/api`.

- [ ] **Step 3: Verify frontend**

Run:

```bash
pixi run lint
pixi run frontend-build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "remove frontend tauri api dependency"
```

## Task 16: Static Frontend Serving And Final Verification

**Files:**
- Modify: `src-tauri/src/web/mod.rs`

- [ ] **Step 1: Add static file service**

In `web/mod.rs`, add `ServeDir`/`ServeFile` imports and keep every API route registered before the fallback. The `server-dev` Pixi task runs from the repository root, so the static directory is `dist`:

```rust
use tower_http::services::{ServeDir, ServeFile};

pub fn router(state: SharedAppState) -> Router {
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/system/os-name", get(system::os_name))
        .route("/api/system/memory", get(system::memory))
        .route("/api/system/threads", post(system::set_threads))
        .route("/api/range/:player/num-combos", get(range::num_combos))
        .route("/api/range/:player/clear", post(range::clear))
        .route("/api/range/:player/invert", post(range::invert))
        .route("/api/range/:player/update", post(range::update))
        .route("/api/range/:player/from-string", post(range::from_string))
        .route("/api/range/:player/to-string", get(range::to_string))
        .route("/api/range/:player/weights", get(range::weights))
        .route("/api/range/:player/raw-data", get(range::raw_data))
        .route("/api/game/file", get(files::download).post(files::upload))
        .with_state(state);

    api.fallback_service(
        ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
    )
}
```

- [ ] **Step 2: Build frontend**

Run:

```bash
pixi run frontend-build
```

Expected: `dist/` is generated.

- [ ] **Step 3: Check server**

Run:

```bash
pixi run server-check
```

Expected: server binary compiles.

- [ ] **Step 4: Run full server**

Run:

```bash
pixi run server-dev
```

Open:

```text
http://127.0.0.1:3030
```

Expected: the Vue app loads from the Rust server.

- [ ] **Step 5: Manual smoke test**

Perform these checks in the browser:

- Load app.
- Edit OOP and IP ranges.
- Build a tree.
- Run at least one solver step.
- Open results view.
- Export CSV and confirm a file downloads.
- Export JSON ranges/configurations and confirm files download.
- Import JSON ranges/configurations and confirm the list updates.
- Save game file and confirm `.bin` downloads.
- Load the downloaded `.bin` and confirm board/ranges refresh.

- [ ] **Step 6: Final verification**

Run:

```bash
pixi run lint
pixi run frontend-build
pixi run server-check
pixi run cargo-check
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/web/mod.rs
git commit -m "serve frontend from rust server"
```

## Self-Review Notes

Spec coverage:

- Single-user server state is covered by Tasks 3 and 4.
- HTTP API migration is covered by Tasks 5 through 10.
- Browser file handling is covered by Tasks 8 and 11 through 14.
- Development commands and Rust upgrade are covered by Task 1.
- Static production serving is covered by Task 16.
- Verification commands match the spec in Task 16.

Implementation constraints:

- Keep Vue and Pinia.
- Keep frontend-driven solver loop.
- Keep IndexedDB via `src/db.ts`.
- Avoid React and multi-user sessions in this phase.

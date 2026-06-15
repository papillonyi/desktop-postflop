use axum::{extract::State, Json};
use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sysinfo::{System, SystemExt};

use crate::web::SharedAppState;

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
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<SetThreadsRequest>,
) {
    *state.pool_state.lock().unwrap() = ThreadPoolBuilder::new()
        .num_threads(req.num_threads)
        .build()
        .unwrap();
}

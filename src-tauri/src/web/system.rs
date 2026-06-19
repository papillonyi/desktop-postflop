use axum::{extract::State, Json};
use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
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

#[derive(Serialize)]
pub struct ServerStatusResponse {
    status: &'static str,
    version: &'static str,
    uptime_seconds: u64,
    now_unix_seconds: u64,
    memory: MemoryResponse,
    thread_pool: ThreadPoolResponse,
    requests: RequestMetricsResponse,
}

#[derive(Serialize)]
pub struct ThreadPoolResponse {
    threads: usize,
}

#[derive(Serialize)]
pub struct RequestMetricsResponse {
    total: u64,
    completed: u64,
    failed: u64,
    in_flight: u64,
    total_latency_ms: u64,
    average_latency_ms: f64,
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
    Json(memory_snapshot())
}

pub async fn status(State(state): State<Arc<SharedAppState>>) -> Json<ServerStatusResponse> {
    let metrics = state.server_metrics.snapshot();
    let thread_pool = ThreadPoolResponse {
        threads: state.pool_state.lock().unwrap().current_num_threads(),
    };

    Json(ServerStatusResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_seconds: metrics.uptime.as_secs(),
        now_unix_seconds: now_unix_seconds(),
        memory: memory_snapshot(),
        thread_pool,
        requests: RequestMetricsResponse {
            total: metrics.requests_total,
            completed: metrics.responses_total,
            failed: metrics.failures_total,
            in_flight: metrics.inflight_requests.saturating_sub(1),
            total_latency_ms: metrics.total_latency_micros / 1_000,
            average_latency_ms: metrics.average_latency_micros as f64 / 1_000.0,
        },
    })
}

fn memory_snapshot() -> MemoryResponse {
    let mut system = System::new_all();
    system.refresh_memory();
    MemoryResponse {
        available: system.available_memory(),
        total: system.total_memory(),
    }
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
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

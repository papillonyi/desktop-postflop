use crate::web::{range::RangeManager, tree::default_action_tree};
use postflop_solver::{ActionTree, BunchingData, PostFlopGame};
use rayon::ThreadPoolBuilder;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

pub struct SharedAppState {
    pub range_state: Mutex<RangeManager>,
    pub tree_state: Mutex<ActionTree>,
    pub bunching_state: Mutex<Option<BunchingData>>,
    pub game_state: Mutex<PostFlopGame>,
    pub active_training_session: Mutex<Option<ActiveTrainingSession>>,
    pub pool_state: Mutex<rayon::ThreadPool>,
    pub server_metrics: ServerMetrics,
}

#[derive(Clone)]
pub struct ActiveTrainingSession {
    pub root: String,
    pub profile_id: String,
    pub profile_weight: u32,
    pub stack_weight: u32,
    pub spot: String,
    pub pot_type: String,
    pub oop_position: String,
    pub ip_position: String,
    pub path: String,
}

impl SharedAppState {
    pub fn single_user() -> Self {
        Self {
            range_state: Mutex::new(RangeManager::default()),
            tree_state: Mutex::new(default_action_tree()),
            bunching_state: Mutex::new(None),
            game_state: Mutex::new(PostFlopGame::default()),
            active_training_session: Mutex::new(None),
            pool_state: Mutex::new(
                ThreadPoolBuilder::new()
                    .num_threads(default_thread_count())
                    .build()
                    .unwrap(),
            ),
            server_metrics: ServerMetrics::new(),
        }
    }
}

pub struct ServerMetrics {
    started_at: Instant,
    requests_total: AtomicU64,
    responses_total: AtomicU64,
    failures_total: AtomicU64,
    inflight_requests: AtomicU64,
    total_latency_micros: AtomicU64,
}

#[derive(Clone, Copy, Debug)]
pub struct ServerMetricsSnapshot {
    pub uptime: Duration,
    pub requests_total: u64,
    pub responses_total: u64,
    pub failures_total: u64,
    pub inflight_requests: u64,
    pub total_latency_micros: u64,
    pub average_latency_micros: u64,
}

impl ServerMetrics {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
            requests_total: AtomicU64::new(0),
            responses_total: AtomicU64::new(0),
            failures_total: AtomicU64::new(0),
            inflight_requests: AtomicU64::new(0),
            total_latency_micros: AtomicU64::new(0),
        }
    }

    pub fn request_started(&self) {
        self.requests_total.fetch_add(1, Ordering::Relaxed);
        self.inflight_requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn request_finished(&self, failed: bool, latency: Duration) {
        self.responses_total.fetch_add(1, Ordering::Relaxed);
        if failed {
            self.failures_total.fetch_add(1, Ordering::Relaxed);
        }
        self.inflight_requests.fetch_sub(1, Ordering::Relaxed);
        self.total_latency_micros
            .fetch_add(duration_micros(latency), Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> ServerMetricsSnapshot {
        let responses_total = self.responses_total.load(Ordering::Relaxed);
        let total_latency_micros = self.total_latency_micros.load(Ordering::Relaxed);
        let average_latency_micros = if responses_total == 0 {
            0
        } else {
            total_latency_micros / responses_total
        };

        ServerMetricsSnapshot {
            uptime: self.started_at.elapsed(),
            requests_total: self.requests_total.load(Ordering::Relaxed),
            responses_total,
            failures_total: self.failures_total.load(Ordering::Relaxed),
            inflight_requests: self.inflight_requests.load(Ordering::Relaxed),
            total_latency_micros,
            average_latency_micros,
        }
    }
}

fn duration_micros(duration: Duration) -> u64 {
    duration.as_micros().min(u128::from(u64::MAX)) as u64
}

fn default_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|threads| threads.get())
        .unwrap_or(1)
        .min(4)
}

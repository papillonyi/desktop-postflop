use crate::web::{range::RangeManager, tree::default_action_tree};
use postflop_solver::{ActionTree, BunchingData, PostFlopGame};
use rayon::ThreadPoolBuilder;
use std::sync::Mutex;

pub struct SharedAppState {
    pub range_state: Mutex<RangeManager>,
    pub tree_state: Mutex<ActionTree>,
    pub bunching_state: Mutex<Option<BunchingData>>,
    pub game_state: Mutex<PostFlopGame>,
    pub pool_state: Mutex<rayon::ThreadPool>,
}

impl SharedAppState {
    pub fn single_user() -> Self {
        Self {
            range_state: Mutex::new(RangeManager::default()),
            tree_state: Mutex::new(default_action_tree()),
            bunching_state: Mutex::new(None),
            game_state: Mutex::new(PostFlopGame::default()),
            pool_state: Mutex::new(
                ThreadPoolBuilder::new()
                    .num_threads(default_thread_count())
                    .build()
                    .unwrap(),
            ),
        }
    }
}

fn default_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|threads| threads.get())
        .unwrap_or(1)
        .min(4)
}

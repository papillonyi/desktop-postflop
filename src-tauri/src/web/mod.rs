use axum::{
    extract::State,
    routing::{get, post},
    Router,
};
use std::path::PathBuf;
use tower_http::services::{ServeDir, ServeFile};

mod app_state;
pub mod bunching;
pub mod files;
pub mod game;
pub mod range;
mod system;
pub mod tree;

pub use app_state::SharedAppState;

pub fn app_with_state(state: SharedAppState) -> Router {
    let dist_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    let static_files =
        ServeDir::new(&dist_dir).not_found_service(ServeFile::new(dist_dir.join("index.html")));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/system/os-name", get(system::os_name))
        .route("/api/system/memory", get(system::memory))
        .route("/api/system/threads", post(system::set_threads))
        .route("/api/range/{player}/num-combos", get(range::num_combos))
        .route("/api/range/{player}/clear", post(range::clear))
        .route("/api/range/{player}/invert", post(range::invert))
        .route("/api/range/{player}/update", post(range::update))
        .route("/api/range/{player}/from-string", post(range::from_string))
        .route("/api/range/{player}/to-string", get(range::to_string))
        .route("/api/range/{player}/weights", get(range::weights))
        .route("/api/range/{player}/raw-data", get(range::raw_data))
        .route("/api/bunching/init", post(bunching::init))
        .route("/api/bunching/clear", post(bunching::clear))
        .route("/api/bunching/progress", get(bunching::progress))
        .route("/api/tree/new", post(tree::new_tree))
        .route("/api/tree/added-lines", get(tree::added_lines))
        .route("/api/tree/removed-lines", get(tree::removed_lines))
        .route("/api/tree/invalid-terminals", get(tree::invalid_terminals))
        .route("/api/tree/actions", get(tree::actions))
        .route("/api/tree/terminal-node", get(tree::is_terminal_node))
        .route("/api/tree/chance-node", get(tree::is_chance_node))
        .route("/api/tree/back-to-root", post(tree::back_to_root))
        .route("/api/tree/apply-history", post(tree::apply_history))
        .route("/api/tree/play", post(tree::play))
        .route("/api/tree/total-bet-amount", get(tree::total_bet_amount))
        .route("/api/tree/add-bet-action", post(tree::add_bet_action))
        .route(
            "/api/tree/remove-current-node",
            post(tree::remove_current_node),
        )
        .route("/api/tree/delete-added-line", post(tree::delete_added_line))
        .route(
            "/api/tree/delete-removed-line",
            post(tree::delete_removed_line),
        )
        .route("/api/game/init", post(game::init))
        .route("/api/game/private-cards", get(game::private_cards))
        .route("/api/game/memory-usage", get(game::memory_usage))
        .route(
            "/api/game/memory-usage-bunching",
            get(game::memory_usage_bunching),
        )
        .route("/api/game/allocate-memory", post(game::allocate_memory))
        .route("/api/game/set-bunching", post(game::set_bunching))
        .route("/api/game/solve-step", post(game::solve_step))
        .route("/api/game/exploitability", get(game::exploitability))
        .route("/api/game/finalize", post(game::finalize))
        .route("/api/game/apply-history", post(game::apply_history))
        .route("/api/game/total-bet-amount", post(game::total_bet_amount))
        .route("/api/game/actions-after", post(game::game_actions_after))
        .route("/api/game/possible-cards", get(game::possible_cards))
        .route("/api/game/results", get(game::get_results))
        .route("/api/game/chance-reports", post(game::chance_reports))
        .route("/api/game/load", post(game::load_from_file))
        .route("/api/game/load-board", get(game::load_board))
        .route("/api/game/file", get(files::download).post(files::upload))
        .fallback_service(static_files)
        .with_state(std::sync::Arc::new(state))
}

async fn health(State(_): State<std::sync::Arc<SharedAppState>>) -> &'static str {
    "ok"
}

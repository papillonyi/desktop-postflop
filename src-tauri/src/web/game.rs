use crate::web::{memory_guard, SharedAppState};
use axum::{extract::State, Json};
use postflop_solver::{
    compute_exploitability, finalize as solver_finalize, load_data_from_file,
    solve_step as solver_solve_step, Action, PostFlopGame,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct InitRequest {
    board: Vec<u8>,
    starting_pot: i32,
    effective_stack: i32,
    rake_rate: f64,
    rake_cap: f64,
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
}

#[derive(Deserialize)]
pub struct HistoryRequest {
    history: Vec<usize>,
}

#[derive(Deserialize)]
pub struct AppendRequest {
    append: Vec<isize>,
}

#[derive(Deserialize)]
pub struct ChanceReportsRequest {
    append: Vec<isize>,
    num_actions: usize,
}

#[derive(Deserialize)]
pub struct ThreadRequest {
    enable_compression: bool,
    #[serde(default)]
    include_bunching: bool,
}

#[derive(Serialize)]
pub struct PrivateCardsResponse {
    value: [Vec<u16>; 2],
}

#[derive(Serialize)]
pub struct TwoU64 {
    value: (u64, u64),
}

#[derive(Serialize)]
pub struct OneU64 {
    value: u64,
}

#[derive(Serialize)]
pub struct I32ArrayResponse {
    value: [i32; 2],
}

#[derive(Serialize)]
pub struct F64ValueResponse {
    value: f64,
}

#[derive(Serialize)]
pub struct StringListResponse {
    value: Vec<String>,
}

#[derive(Serialize)]
pub struct NumListResponse {
    value: Vec<u64>,
}

#[derive(Serialize)]
pub struct OptionalErrorResponse {
    error: Option<String>,
}

#[derive(Serialize)]
pub struct GameResultsResponse {
    current_player: String,
    num_actions: usize,
    is_empty: i32,
    eqr_base: [i32; 2],
    weights: [Vec<f64>; 2],
    normalizer: [Vec<f64>; 2],
    equity: [Vec<f64>; 2],
    ev: [Vec<f64>; 2],
    eqr: [Vec<f64>; 2],
    strategy: Vec<f64>,
    action_ev: Vec<f64>,
}

#[derive(Serialize)]
pub struct GameChanceReportsResponse {
    status: Vec<i32>,
    combos: [Vec<f64>; 2],
    equity: [Vec<f64>; 2],
    ev: [Vec<f64>; 2],
    eqr: [Vec<f64>; 2],
    strategy: Vec<f64>,
}

fn round(value: f64) -> f64 {
    if value < 1.0 {
        (value * 1000000.0).round() / 1000000.0
    } else if value < 10.0 {
        (value * 100000.0).round() / 100000.0
    } else if value < 100.0 {
        (value * 10000.0).round() / 10000.0
    } else if value < 1000.0 {
        (value * 1000.0).round() / 1000.0
    } else if value < 10000.0 {
        (value * 100.0).round() / 100.0
    } else {
        (value * 10.0).round() / 10.0
    }
}

#[inline]
fn action_usize(action: isize) -> usize {
    match action {
        -1 => usize::MAX,
        a => a as usize,
    }
}

fn round_iter<'a>(iter: impl Iterator<Item = &'a f32> + 'a) -> impl Iterator<Item = f64> + 'a {
    iter.map(|&x| round(x as f64))
}

fn weighted_average(slice: &[f32], weights: &[f32]) -> f64 {
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for (&value, &weight) in slice.iter().zip(weights.iter()) {
        sum += value as f64 * weight as f64;
        weight_sum += weight as f64;
    }
    sum / weight_sum
}

fn actions(game: &PostFlopGame) -> Vec<String> {
    if game.is_terminal_node() {
        vec!["terminal".to_string()]
    } else if game.is_chance_node() {
        vec!["chance".to_string()]
    } else {
        game.available_actions()
            .iter()
            .map(|&x| match x {
                Action::Fold => "Fold:0".to_string(),
                Action::Check => "Check:0".to_string(),
                Action::Call => "Call:0".to_string(),
                Action::Bet(amount) => format!("Bet:{amount}"),
                Action::Raise(amount) => format!("Raise:{amount}"),
                Action::AllIn(amount) => format!("Allin:{amount}"),
                _ => unreachable!(),
            })
            .collect()
    }
}

fn current_player(game: &PostFlopGame) -> String {
    if game.is_terminal_node() {
        "terminal".to_string()
    } else if game.is_chance_node() {
        "chance".to_string()
    } else if game.current_player() == 0 {
        "oop".to_string()
    } else {
        "ip".to_string()
    }
}

fn num_actions(game: &PostFlopGame) -> usize {
    match game.is_chance_node() {
        true => 0,
        false => game.available_actions().len(),
    }
}

pub async fn init(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<InitRequest>,
) -> Json<Option<String>> {
    let (turn, river, board_state) = match req.board.len() {
        3 => (
            postflop_solver::NOT_DEALT,
            postflop_solver::NOT_DEALT,
            postflop_solver::BoardState::Flop,
        ),
        4 => (
            req.board[3],
            postflop_solver::NOT_DEALT,
            postflop_solver::BoardState::Turn,
        ),
        5 => (
            req.board[3],
            req.board[4],
            postflop_solver::BoardState::River,
        ),
        _ => return Json(Some("Invalid board length".to_string())),
    };

    let ranges = &state.range_state.lock().unwrap().0;
    let card_config = postflop_solver::CardConfig {
        range: ranges[..2].try_into().unwrap(),
        flop: req.board[..3].try_into().unwrap(),
        turn,
        river,
    };

    let config = postflop_solver::TreeConfig {
        initial_state: board_state,
        starting_pot: req.starting_pot,
        effective_stack: req.effective_stack,
        rake_rate: req.rake_rate,
        rake_cap: req.rake_cap,
        flop_bet_sizes: [
            postflop_solver::BetSizeOptions::try_from((
                req.oop_flop_bet.as_str(),
                req.oop_flop_raise.as_str(),
            ))
            .unwrap(),
            postflop_solver::BetSizeOptions::try_from((
                req.ip_flop_bet.as_str(),
                req.ip_flop_raise.as_str(),
            ))
            .unwrap(),
        ],
        turn_bet_sizes: [
            postflop_solver::BetSizeOptions::try_from((
                req.oop_turn_bet.as_str(),
                req.oop_turn_raise.as_str(),
            ))
            .unwrap(),
            postflop_solver::BetSizeOptions::try_from((
                req.ip_turn_bet.as_str(),
                req.ip_turn_raise.as_str(),
            ))
            .unwrap(),
        ],
        river_bet_sizes: [
            postflop_solver::BetSizeOptions::try_from((
                req.oop_river_bet.as_str(),
                req.oop_river_raise.as_str(),
            ))
            .unwrap(),
            postflop_solver::BetSizeOptions::try_from((
                req.ip_river_bet.as_str(),
                req.ip_river_raise.as_str(),
            ))
            .unwrap(),
        ],
        turn_donk_sizes: match req.donk_option {
            false => None,
            true => postflop_solver::DonkSizeOptions::try_from(req.oop_turn_donk.as_str()).ok(),
        },
        river_donk_sizes: match req.donk_option {
            false => None,
            true => postflop_solver::DonkSizeOptions::try_from(req.oop_river_donk.as_str()).ok(),
        },
        add_allin_threshold: req.add_allin_threshold,
        force_allin_threshold: req.force_allin_threshold,
        merging_threshold: req.merging_threshold,
    };

    let mut action_tree = postflop_solver::ActionTree::new(config).unwrap();

    if !req.added_lines.is_empty() {
        for added_line in req.added_lines.split(',') {
            let line = added_line
                .split(&['-', '|'][..])
                .map(|x| match x {
                    "F" => Action::Fold,
                    "X" => Action::Check,
                    "C" => Action::Call,
                    _ => {
                        let mut chars = x.chars();
                        let first_char = chars.next().unwrap();
                        let amount = chars.as_str().parse().unwrap();
                        match first_char {
                            'B' => Action::Bet(amount),
                            'R' => Action::Raise(amount),
                            'A' => Action::AllIn(amount),
                            _ => unreachable!(),
                        }
                    }
                })
                .collect::<Vec<_>>();
            if action_tree.add_line(&line).is_err() {
                return Json(Some("Failed to add line (loaded broken tree?)".to_string()));
            }
        }
    }

    if !req.removed_lines.is_empty() {
        for removed_line in req.removed_lines.split(',') {
            let line = removed_line
                .split(&['-', '|'][..])
                .map(|x| match x {
                    "F" => Action::Fold,
                    "X" => Action::Check,
                    "C" => Action::Call,
                    _ => {
                        let mut chars = x.chars();
                        let first_char = chars.next().unwrap();
                        let amount = chars.as_str().parse().unwrap();
                        match first_char {
                            'B' => Action::Bet(amount),
                            'R' => Action::Raise(amount),
                            'A' => Action::AllIn(amount),
                            _ => unreachable!(),
                        }
                    }
                })
                .collect::<Vec<_>>();
            if action_tree.remove_line(&line).is_err() {
                return Json(Some(
                    "Failed to remove line (loaded broken tree?)".to_string(),
                ));
            }
        }
    }

    let mut game = state.game_state.lock().unwrap();
    let result = game.update_config(card_config, action_tree);
    if result.is_ok() {
        *state.active_training_session.lock().unwrap() = None;
    }
    Json(result.err())
}

pub async fn private_cards(State(state): State<Arc<SharedAppState>>) -> Json<PrivateCardsResponse> {
    let game = state.game_state.lock().unwrap();
    let convert = |player: usize| {
        game.private_cards(player)
            .iter()
            .map(|&(c1, c2)| (c1 as u16) | (c2 as u16) << 8)
            .collect()
    };
    Json(PrivateCardsResponse {
        value: [convert(0), convert(1)],
    })
}

pub async fn memory_usage(State(state): State<Arc<SharedAppState>>) -> Json<TwoU64> {
    let game = state.game_state.lock().unwrap();
    Json(TwoU64 {
        value: game.memory_usage(),
    })
}

pub async fn memory_usage_bunching(State(state): State<Arc<SharedAppState>>) -> Json<OneU64> {
    let game = state.game_state.lock().unwrap();
    Json(OneU64 {
        value: game.memory_usage_bunching(),
    })
}

pub async fn allocate_memory(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<ThreadRequest>,
) -> Json<OptionalErrorResponse> {
    let mut game = state.game_state.lock().unwrap();
    let memory_usage = game.memory_usage();
    let estimated_bytes = if req.enable_compression {
        memory_usage.1
    } else {
        memory_usage.0
    };
    let estimated_bytes = if req.include_bunching {
        estimated_bytes.saturating_add(game.memory_usage_bunching())
    } else {
        estimated_bytes
    };
    if let Err(error) =
        memory_guard::check_memory_limit(estimated_bytes, memory_guard::default_game_memory_limit())
    {
        return Json(OptionalErrorResponse { error: Some(error) });
    }
    game.allocate_memory(req.enable_compression);
    Json(OptionalErrorResponse { error: None })
}

pub async fn set_bunching(State(state): State<Arc<SharedAppState>>) -> Json<Option<String>> {
    let bunching_data = state.bunching_state.lock().unwrap();
    let bunching_data = bunching_data.as_ref().unwrap();
    let mut game = state.game_state.lock().unwrap();
    Json(game.set_bunching_effect(bunching_data).err())
}

pub async fn solve_step(State(state): State<Arc<SharedAppState>>, Json(req): Json<u32>) {
    let game = state.game_state.lock().unwrap();
    let pool = state.pool_state.lock().unwrap();
    pool.install(|| solver_solve_step(&*game, req));
}

pub async fn exploitability(State(state): State<Arc<SharedAppState>>) -> Json<F64ValueResponse> {
    let game = state.game_state.lock().unwrap();
    let pool = state.pool_state.lock().unwrap();
    Json(F64ValueResponse {
        value: pool.install(|| compute_exploitability(&*game)) as f64,
    })
}

pub async fn finalize(State(state): State<Arc<SharedAppState>>) {
    let pool = state.pool_state.lock().unwrap();
    pool.install(|| solver_finalize(&mut *state.game_state.lock().unwrap()));
}

pub async fn apply_history(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<HistoryRequest>,
) {
    state.game_state.lock().unwrap().apply_history(&req.history);
}

pub async fn total_bet_amount(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<AppendRequest>,
) -> Json<I32ArrayResponse> {
    let mut game = state.game_state.lock().unwrap();
    if req.append.is_empty() {
        return Json(I32ArrayResponse {
            value: game.total_bet_amount(),
        });
    }

    let history = game.history().to_vec();
    for &action in &req.append {
        game.play(action_usize(action));
    }
    let ret = game.total_bet_amount();
    game.apply_history(&history);
    Json(I32ArrayResponse { value: ret })
}

pub async fn game_actions_after(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<AppendRequest>,
) -> Json<StringListResponse> {
    let mut game = state.game_state.lock().unwrap();
    if req.append.is_empty() {
        return Json(StringListResponse {
            value: actions(&game),
        });
    }
    let history = game.history().to_vec();
    for &action in &req.append {
        game.play(action_usize(action));
    }
    let ret = actions(&game);
    game.apply_history(&history);
    Json(StringListResponse { value: ret })
}

pub async fn possible_cards(State(state): State<Arc<SharedAppState>>) -> Json<OneU64> {
    let game = state.game_state.lock().unwrap();
    Json(OneU64 {
        value: game.possible_cards(),
    })
}

pub async fn get_results(State(state): State<Arc<SharedAppState>>) -> Json<GameResultsResponse> {
    let mut game = state.game_state.lock().unwrap();

    let total_bet_amount = game.total_bet_amount();
    let pot_base = game.tree_config().starting_pot + total_bet_amount.iter().min().unwrap();
    let eqr_base = [
        pot_base + total_bet_amount[0],
        pot_base + total_bet_amount[1],
    ];
    let trunc = |&w: &f32| if w < 0.0005 { 0.0 } else { round(w as f64) };
    let weights = [
        game.weights(0).iter().map(trunc).collect::<Vec<_>>(),
        game.weights(1).iter().map(trunc).collect::<Vec<_>>(),
    ];

    let is_empty = |player: usize| weights[player].iter().all(|&w| w == 0.0);
    let is_empty_flag = is_empty(0) as i32 + 2 * is_empty(1) as i32;

    let mut normalizer = [Vec::new(), Vec::new()];
    let mut equity = [Vec::new(), Vec::new()];
    let mut ev = [Vec::new(), Vec::new()];
    let mut eqr = [Vec::new(), Vec::new()];

    if is_empty_flag > 0 {
        normalizer[0].extend(weights[0].iter().copied());
        normalizer[1].extend(weights[1].iter().copied());
    } else {
        game.cache_normalized_weights();

        normalizer[0].extend(round_iter(game.normalized_weights(0).iter()));
        normalizer[1].extend(round_iter(game.normalized_weights(1).iter()));

        let equity_raw = [game.equity(0), game.equity(1)];
        let ev_raw = [game.expected_values(0), game.expected_values(1)];

        equity[0].extend(round_iter(equity_raw[0].iter()));
        equity[1].extend(round_iter(equity_raw[1].iter()));
        ev[0].extend(round_iter(ev_raw[0].iter()));
        ev[1].extend(round_iter(ev_raw[1].iter()));

        for player in 0..2 {
            let pot = eqr_base[player] as f64;
            for (&eq, &evv) in equity_raw[player].iter().zip(ev_raw[player].iter()) {
                let (eq, evv) = (eq as f64, evv as f64);
                if eq < 5e-7 {
                    eqr[player].push(evv / 0.0);
                } else {
                    eqr[player].push(round(evv / (pot * eq)));
                }
            }
        }
    }

    let mut strategy = Vec::new();
    let mut action_ev = Vec::new();
    if !game.is_terminal_node() && !game.is_chance_node() {
        strategy.extend(round_iter(game.strategy().iter()));
        if is_empty_flag == 0 {
            action_ev.extend(round_iter(
                game.expected_values_detail(game.current_player()).iter(),
            ));
        }
    }

    Json(GameResultsResponse {
        current_player: current_player(&game),
        num_actions: num_actions(&game),
        is_empty: is_empty_flag,
        eqr_base,
        weights,
        normalizer,
        equity,
        ev,
        eqr,
        strategy,
        action_ev,
    })
}

pub async fn chance_reports(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<ChanceReportsRequest>,
) -> Json<GameChanceReportsResponse> {
    let mut game = state.game_state.lock().unwrap();
    let history = game.history().to_vec();
    let mut status = vec![0; 52];
    let mut combos = [vec![0.0; 52], vec![0.0; 52]];
    let mut equity = [vec![0.0; 52], vec![0.0; 52]];
    let mut ev = [vec![0.0; 52], vec![0.0; 52]];
    let mut eqr = [vec![0.0; 52], vec![0.0; 52]];
    let mut strategy = vec![0.0; req.num_actions * 52];

    let possible_cards = game.possible_cards();
    for chance in 0..52 {
        if possible_cards & (1 << chance) == 0 {
            continue;
        }

        game.play(chance);
        if req.append.len() > 1 {
            for &action in req.append[1..].iter() {
                game.play(action_usize(action));
            }
        }

        let trunc = |&w: &f32| if w < 0.0005 { 0.0 } else { w };
        let weights = [
            game.weights(0).iter().map(trunc).collect::<Vec<_>>(),
            game.weights(1).iter().map(trunc).collect::<Vec<_>>(),
        ];

        combos[0][chance] = round(weights[0].iter().fold(0.0, |acc, &w| acc + w as f64));
        combos[1][chance] = round(weights[1].iter().fold(0.0, |acc, &w| acc + w as f64));

        let is_empty = |player: usize| weights[player].iter().all(|&w| w == 0.0);
        let is_empty_flag = [is_empty(0), is_empty(1)];

        game.cache_normalized_weights();
        let normalizer = [game.normalized_weights(0), game.normalized_weights(1)];

        if !game.is_terminal_node() {
            let current = game.current_player();
            if !is_empty_flag[current] {
                let strategy_tmp = game.strategy();
                let num_hands = game.private_cards(current).len();
                let ws = if is_empty_flag[current ^ 1] {
                    &weights[current]
                } else {
                    normalizer[current]
                };
                for action in 0..req.num_actions {
                    let slice = &strategy_tmp[action * num_hands..(action + 1) * num_hands];
                    let strategy_summary = weighted_average(slice, ws);
                    strategy[action * 52 + chance] = round(strategy_summary);
                }
            }
        }

        if is_empty_flag[0] || is_empty_flag[1] {
            status[chance] = 1;
            game.apply_history(&history);
            continue;
        }

        status[chance] = 2;
        let total_bet_amount = game.total_bet_amount();
        let pot_base = game.tree_config().starting_pot + total_bet_amount.iter().min().unwrap();

        for player in 0..2 {
            let pot = (pot_base + total_bet_amount[player]) as f32;
            let equity_tmp = weighted_average(&game.equity(player), normalizer[player]);
            let ev_tmp = weighted_average(&game.expected_values(player), normalizer[player]);
            equity[player][chance] = round(equity_tmp);
            ev[player][chance] = round(ev_tmp);
            eqr[player][chance] = round(ev_tmp / (pot as f64 * equity_tmp));
        }
        game.apply_history(&history);
    }

    Json(GameChanceReportsResponse {
        status,
        combos,
        equity,
        ev,
        eqr,
        strategy,
    })
}

pub async fn load_from_file(
    State(state): State<Arc<SharedAppState>>,
    Json(path): Json<String>,
) -> Json<OptionalErrorResponse> {
    state.clear_loaded_game();
    let (game, _memo_string): (PostFlopGame, _) =
        match load_data_from_file(&path, memory_guard::default_game_memory_limit()) {
            Ok(v) => v,
            Err(err) => {
                return Json(OptionalErrorResponse {
                    error: Some(err.to_string()),
                })
            }
        };
    *state.game_state.lock().unwrap() = game;
    let game_ranges = state.game_state.lock().unwrap().card_config().range;
    let mut ranges = state.range_state.lock().unwrap();
    ranges.0[0] = game_ranges[0];
    ranges.0[1] = game_ranges[1];
    *state.active_training_session.lock().unwrap() = None;
    Json(OptionalErrorResponse { error: None })
}

pub async fn load_board(State(state): State<Arc<SharedAppState>>) -> Json<NumListResponse> {
    let board = state
        .game_state
        .lock()
        .unwrap()
        .card_config()
        .flop
        .iter()
        .copied()
        .map(|x| x as u64)
        .collect();
    Json(NumListResponse { value: board })
}

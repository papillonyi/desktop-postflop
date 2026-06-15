use crate::web::SharedAppState;
use axum::{extract::Json, extract::State};
use postflop_solver::Action;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[inline]
fn action_to_string(action: Action) -> String {
    match action {
        Action::Fold => "Fold:0".to_string(),
        Action::Check => "Check:0".to_string(),
        Action::Call => "Call:0".to_string(),
        Action::Bet(amount) => format!("Bet:{amount}"),
        Action::Raise(amount) => format!("Raise:{amount}"),
        Action::AllIn(amount) => format!("Allin:{amount}"),
        _ => unreachable!(),
    }
}

#[inline]
fn encode_action(action: Action) -> String {
    match action {
        Action::Fold => "F".to_string(),
        Action::Check => "X".to_string(),
        Action::Call => "C".to_string(),
        Action::Bet(amount) => format!("B{amount}"),
        Action::Raise(amount) => format!("R{amount}"),
        Action::AllIn(amount) => format!("A{amount}"),
        _ => unreachable!(),
    }
}

fn encode_line(line: &[Action]) -> String {
    let mut flag = 0;
    let mut encoded = String::new();

    if line.is_empty() {
        return "(Root)".to_string();
    }

    for &action in line {
        if !encoded.is_empty() {
            let delimiter = if flag == 2 { "|" } else { "-" };
            flag = if flag == 2 { 0 } else { flag };
            encoded.push_str(delimiter);
        }
        match action {
            Action::Check => flag += 1,
            Action::Call => flag = 2,
            _ => flag = 0,
        }
        encoded.push_str(&encode_action(action));
    }

    encoded
}

#[inline]
fn decode_action(action: &str) -> Action {
    match action {
        "F" => Action::Fold,
        "X" => Action::Check,
        "C" => Action::Call,
        _ => {
            let mut chars = action.chars();
            let first_char = chars.next().unwrap();
            let amount = chars.as_str().parse().unwrap();
            match first_char {
                'B' => Action::Bet(amount),
                'R' => Action::Raise(amount),
                'A' => Action::AllIn(amount),
                _ => unreachable!(),
            }
        }
    }
}

#[derive(Serialize)]
pub struct BoolResponse {
    value: bool,
}

#[derive(Serialize)]
pub struct StringResponse {
    value: String,
}

#[derive(Serialize)]
pub struct StringsResponse {
    value: Vec<String>,
}

#[derive(Deserialize)]
pub struct TreeNewRequest {
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
}

#[derive(Deserialize)]
pub struct ApplyHistoryRequest {
    line: Vec<String>,
}

#[derive(Deserialize)]
pub struct PlayRequest {
    action: String,
}

#[derive(Deserialize)]
pub struct BetActionRequest {
    amount: i32,
    is_raise: bool,
}

#[derive(Deserialize)]
pub struct DeleteLineRequest {
    line: String,
}

#[derive(Serialize)]
pub struct I32Response {
    value: i32,
}

#[derive(Serialize)]
pub struct BetArrayResponse {
    value: [i32; 2],
}

pub async fn new_tree(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<TreeNewRequest>,
) -> Json<BoolResponse> {
    let initial_state = match req.board_len {
        len if len <= 3 => postflop_solver::BoardState::Flop,
        4 => postflop_solver::BoardState::Turn,
        5 => postflop_solver::BoardState::River,
        _ => panic!("Invalid board length"),
    };

    let config = postflop_solver::TreeConfig {
        initial_state,
        starting_pot: req.starting_pot,
        effective_stack: req.effective_stack,
        rake_rate: 0.0,
        rake_cap: 0.0,
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

    let mut tree = postflop_solver::ActionTree::new(config).unwrap();

    if !req.added_lines.is_empty() {
        for line in req.added_lines.split(',') {
            let line = line
                .split(&['-', '|'][..])
                .map(decode_action)
                .collect::<Vec<_>>();
            if tree.add_line(&line).is_err() {
                return Json(BoolResponse { value: false });
            }
        }
    }

    if !req.removed_lines.is_empty() {
        for line in req.removed_lines.split(',') {
            let line = line
                .split(&['-', '|'][..])
                .map(decode_action)
                .collect::<Vec<_>>();
            if tree.remove_line(&line).is_err() {
                return Json(BoolResponse { value: false });
            }
        }
    }

    *state.tree_state.lock().unwrap() = tree;
    Json(BoolResponse { value: true })
}

pub async fn added_lines(State(state): State<Arc<SharedAppState>>) -> Json<StringResponse> {
    let tree = state.tree_state.lock().unwrap();
    Json(StringResponse {
        value: tree
            .added_lines()
            .iter()
            .map(|l| encode_line(l))
            .collect::<Vec<_>>()
            .join(","),
    })
}

pub async fn removed_lines(State(state): State<Arc<SharedAppState>>) -> Json<StringResponse> {
    let tree = state.tree_state.lock().unwrap();
    Json(StringResponse {
        value: tree
            .removed_lines()
            .iter()
            .map(|l| encode_line(l))
            .collect::<Vec<_>>()
            .join(","),
    })
}

pub async fn invalid_terminals(State(state): State<Arc<SharedAppState>>) -> Json<StringResponse> {
    let tree = state.tree_state.lock().unwrap();
    Json(StringResponse {
        value: tree
            .invalid_terminals()
            .iter()
            .map(|l| encode_line(l))
            .collect::<Vec<_>>()
            .join(","),
    })
}

pub async fn actions(State(state): State<Arc<SharedAppState>>) -> Json<StringsResponse> {
    let tree = state.tree_state.lock().unwrap();
    Json(StringsResponse {
        value: tree
            .available_actions()
            .iter()
            .cloned()
            .map(action_to_string)
            .collect(),
    })
}

pub async fn is_terminal_node(State(state): State<Arc<SharedAppState>>) -> Json<BoolResponse> {
    Json(BoolResponse {
        value: state.tree_state.lock().unwrap().is_terminal_node(),
    })
}

pub async fn is_chance_node(State(state): State<Arc<SharedAppState>>) -> Json<BoolResponse> {
    Json(BoolResponse {
        value: state.tree_state.lock().unwrap().is_chance_node(),
    })
}

pub async fn back_to_root(State(state): State<Arc<SharedAppState>>) {
    state.tree_state.lock().unwrap().back_to_root();
}

pub async fn apply_history(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<ApplyHistoryRequest>,
) {
    let mut tree = state.tree_state.lock().unwrap();
    let line = req
        .line
        .iter()
        .map(|l| decode_action(l.as_str()))
        .collect::<Vec<_>>();
    tree.apply_history(&line).unwrap();
}

pub async fn play(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<PlayRequest>,
) -> Json<I32Response> {
    let mut tree = state.tree_state.lock().unwrap();
    let action = decode_action(&req.action);
    let available_actions = tree.available_actions();
    if let Some(index) = available_actions.iter().position(|&a| a == action) {
        tree.play(action).unwrap();
        Json(I32Response {
            value: index as i32,
        })
    } else {
        Json(I32Response { value: -1 })
    }
}

pub async fn total_bet_amount(State(state): State<Arc<SharedAppState>>) -> Json<BetArrayResponse> {
    Json(BetArrayResponse {
        value: state.tree_state.lock().unwrap().total_bet_amount(),
    })
}

pub async fn add_bet_action(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<BetActionRequest>,
) {
    let mut tree = state.tree_state.lock().unwrap();
    let action = match req.is_raise {
        false => Action::Bet(req.amount),
        true => Action::Raise(req.amount),
    };
    tree.add_action(action).unwrap();
}

pub async fn remove_current_node(State(state): State<Arc<SharedAppState>>) {
    state
        .tree_state
        .lock()
        .unwrap()
        .remove_current_node()
        .unwrap();
}

pub async fn delete_added_line(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<DeleteLineRequest>,
) {
    let mut tree = state.tree_state.lock().unwrap();
    let line = req
        .line
        .split(&['-', '|'][..])
        .map(decode_action)
        .collect::<Vec<_>>();
    tree.remove_line(&line).unwrap();
}

pub async fn delete_removed_line(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<DeleteLineRequest>,
) {
    let mut tree = state.tree_state.lock().unwrap();
    let line = req
        .line
        .split(&['-', '|'][..])
        .map(decode_action)
        .collect::<Vec<_>>();
    tree.add_line(&line).unwrap();
}

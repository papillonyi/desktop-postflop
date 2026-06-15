use axum::{
    extract::{Path, State},
    Json,
};
use postflop_solver::Range;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::sync::Arc;

use crate::web::SharedAppState;

#[derive(Default)]
pub struct RangeManager(pub [Range; 6]);

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
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
) -> Json<NumCombosResponse> {
    let ranges = state.range_state.lock().unwrap();
    let range = &ranges.0[player];
    Json(NumCombosResponse {
        value: range.raw_data().iter().fold(0.0, |acc, &x| acc + x as f64),
    })
}

pub async fn clear(State(state): State<Arc<SharedAppState>>, Path(player): Path<usize>) {
    state.range_state.lock().unwrap().0[player].clear();
}

pub async fn invert(State(state): State<Arc<SharedAppState>>, Path(player): Path<usize>) {
    state.range_state.lock().unwrap().0[player].invert();
}

pub async fn update(
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
    Json(req): Json<UpdateRequest>,
) {
    let mut ranges = state.range_state.lock().unwrap();
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
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
    Json(req): Json<FromStringRequest>,
) -> Json<OptionalErrorResponse> {
    let result = Range::from_sanitized_str(req.str.as_str());
    match result {
        Ok(range) => {
            state.range_state.lock().unwrap().0[player] = range;
            Json(OptionalErrorResponse { error: None })
        }
        Err(error) => Json(OptionalErrorResponse { error: Some(error) }),
    }
}

pub async fn to_string(
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
) -> Json<StringResponse> {
    Json(StringResponse {
        value: state.range_state.lock().unwrap().0[player].to_string(),
    })
}

pub async fn weights(
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
) -> Json<NumbersResponse<f32>> {
    let ranges = state.range_state.lock().unwrap();
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
    State(state): State<Arc<SharedAppState>>,
    Path(player): Path<usize>,
) -> Json<NumbersResponse<f32>> {
    Json(NumbersResponse {
        value: state.range_state.lock().unwrap().0[player]
            .raw_data()
            .to_vec(),
    })
}

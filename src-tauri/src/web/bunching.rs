use axum::{extract::State, Json};
use std::sync::Arc;

use crate::web::SharedAppState;

#[derive(serde::Serialize)]
pub struct ProgressResponse {
    pub value: [u8; 2],
}

#[derive(serde::Deserialize)]
pub struct InitRequest {
    board: Vec<u8>,
}

pub async fn init(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<InitRequest>,
) -> Json<Option<String>> {
    if req.board.len() < 3 {
        return Json(Some("Board must have at least 3 cards".to_string()));
    }

    let ranges = &state.range_state.lock().unwrap().0;
    let bunching_data =
        postflop_solver::BunchingData::new(&ranges[2..], req.board[..3].try_into().unwrap());

    match bunching_data {
        Ok(bunching) => {
            *state.bunching_state.lock().unwrap() = Some(bunching);
            Json(None)
        }
        Err(err) => {
            *state.bunching_state.lock().unwrap() = None;
            Json(Some(err))
        }
    }
}

pub async fn clear(State(state): State<Arc<SharedAppState>>) {
    *state.bunching_state.lock().unwrap() = None;
}

pub async fn progress(State(state): State<Arc<SharedAppState>>) -> Json<ProgressResponse> {
    let mut bunching_data = state.bunching_state.lock().unwrap();
    let bunching_data = bunching_data.as_mut().unwrap();
    let phase = bunching_data.phase();
    let percent = bunching_data.progress_percent();
    if phase == 3 && percent == 100 {
        return Json(ProgressResponse { value: [3, 100] });
    }

    let pool = state.pool_state.lock().unwrap();
    pool.install(|| {
        if phase == 0 {
            bunching_data.phase1_prepare();
        } else if phase == 1 {
            if percent < 100 {
                bunching_data.phase1_proceed_by_percent();
            } else {
                bunching_data.phase2_prepare();
            }
        } else if phase == 2 {
            if percent < 100 {
                bunching_data.phase2_proceed_by_percent();
            } else {
                bunching_data.phase3_prepare();
            }
        } else if phase == 3 {
            bunching_data.phase3_proceed_by_percent();
        }
    });

    if phase == 0 || percent == 100 {
        Json(ProgressResponse {
            value: [phase + 1, 0],
        })
    } else {
        Json(ProgressResponse {
            value: [phase, percent + 1],
        })
    }
}

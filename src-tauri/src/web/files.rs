use axum::{
    body::Body,
    extract::{Multipart, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use std::io::{BufWriter, Write};
use std::sync::Arc;
use tempfile::NamedTempFile;
use tokio_util::io::ReaderStream;

use crate::web::{memory_guard, SharedAppState};
use postflop_solver::{load_data_from_file, DataType, FileData, PostFlopGame};

pub async fn download(State(state): State<Arc<SharedAppState>>) -> Response {
    let tmp = NamedTempFile::new().expect("failed to create temp file");
    let path = tmp.path().to_str().unwrap().to_string();
    {
        let mut writer = BufWriter::new(std::fs::File::create(&path).unwrap());
        let file = tmp.path();
        std::fs::create_dir_all(file.parent().unwrap()).ok();
        let compression_level: Option<i32> = None;
        let memo = "memo string";
        let game = state.game_state.lock().unwrap();

        bincode::encode_into_std_write(0x09f15790u32, &mut writer, bincode::config::standard())
            .unwrap();
        bincode::encode_into_std_write(1u8, &mut writer, bincode::config::standard()).unwrap();
        bincode::encode_into_std_write(
            compression_level.is_some() as u8,
            &mut writer,
            bincode::config::standard(),
        )
        .unwrap();
        bincode::encode_into_std_write(
            DataType::Game as u8,
            &mut writer,
            bincode::config::standard(),
        )
        .unwrap();
        bincode::encode_into_std_write(
            game.estimated_memory_usage(),
            &mut writer,
            bincode::config::standard(),
        )
        .unwrap();
        bincode::encode_into_std_write(memo, &mut writer, bincode::config::standard()).unwrap();

        struct EncodableGame<'a>(&'a PostFlopGame);
        impl bincode::enc::Encode for EncodableGame<'_> {
            fn encode<E: bincode::enc::Encoder>(
                &self,
                encoder: &mut E,
            ) -> Result<(), bincode::error::EncodeError> {
                self.0.encode(encoder)
            }
        }

        bincode::encode_into_std_write(
            EncodableGame(&game),
            &mut writer,
            bincode::config::standard(),
        )
        .unwrap();
        writer.flush().unwrap();
    }

    let file = tokio::fs::File::open(&path)
        .await
        .expect("failed to open saved game file");
    let stream = ReaderStream::new(file);
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"desktop-postflop-game.bin\"",
            ),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

pub async fn upload(
    State(state): State<Arc<SharedAppState>>,
    mut multipart: Multipart,
) -> StatusCode {
    let mut tmp = NamedTempFile::new().expect("failed to create temp file");
    let mut found = false;
    while let Some(field) = multipart.next_field().await.expect("invalid multipart") {
        if field.name() == Some("file") {
            let mut field = field;
            while let Some(chunk) = match field.chunk().await {
                Ok(chunk) => chunk,
                Err(_) => return StatusCode::BAD_REQUEST,
            } {
                if std::io::Write::write_all(&mut tmp, &chunk).is_err() {
                    return StatusCode::INTERNAL_SERVER_ERROR;
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        return StatusCode::BAD_REQUEST;
    }
    let path = tmp
        .path()
        .to_str()
        .expect("temporary path invalid")
        .to_string();
    let (game, _memo): (PostFlopGame, _) =
        match load_data_from_file(path, memory_guard::default_game_memory_limit()) {
            Ok(v) => v,
            Err(_) => return StatusCode::BAD_REQUEST,
        };
    *state.game_state.lock().unwrap() = game;
    let game_ranges = state.game_state.lock().unwrap().card_config().range;
    let mut ranges = state.range_state.lock().unwrap();
    ranges.0[0] = game_ranges[0];
    ranges.0[1] = game_ranges[1];
    *state.active_training_session.lock().unwrap() = None;
    StatusCode::NO_CONTENT
}

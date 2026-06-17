use crate::training_precompute::{flop_from_string, JobManifestEntry, JobStatus, Manifest};
use crate::web::SharedAppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use postflop_solver::{load_data_from_file, PostFlopGame, NOT_DEALT};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_TRAINING_ROOT: &str = "../training-games-formal";
const SIX_MAX_POSITIONS: [&str; 6] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummaryRequest {
    pub root: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartRequest {
    pub root: Option<String>,
    pub hero_position: String,
    pub pot_types: Option<Vec<String>>,
    pub profile_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayRequest {
    pub root: Option<String>,
    pub hero_position: String,
    pub path: String,
    pub hero_hand: Option<TrainingHandSelection>,
    pub villain_hand: Option<TrainingHandSelection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMetadata {
    pub version: u32,
    pub generated_at: String,
    pub config_path: Option<String>,
    pub output_dir: String,
    pub job_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingValidationError {
    pub profile_id: Option<String>,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummaryResponse {
    pub root: String,
    pub manifest: ManifestMetadata,
    pub solved_job_count: usize,
    pub counts_by_hero_position: BTreeMap<String, usize>,
    pub counts_by_pot_type: BTreeMap<String, usize>,
    pub counts_by_profile_id: BTreeMap<String, usize>,
    pub validation_errors: Vec<TrainingValidationError>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingHandSelection {
    pub packed: u16,
    pub index: usize,
    pub cards: [u8; 2],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartResponse {
    pub root: String,
    pub profile_id: String,
    pub profile_weight: u32,
    pub stack_weight: u32,
    pub spot: String,
    pub pot_type: String,
    pub oop_position: String,
    pub ip_position: String,
    pub board: Vec<u8>,
    pub starting_pot: i32,
    pub effective_stack: i32,
    pub hero_position: String,
    pub villain_position: String,
    pub hero_player: String,
    pub villain_player: String,
    pub hero_hand: TrainingHandSelection,
    pub villain_hand: TrainingHandSelection,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingErrorResponse {
    pub error: String,
    pub validation_errors: Vec<TrainingValidationError>,
}

#[derive(Debug)]
pub struct TrainingApiError {
    status: StatusCode,
    message: String,
    validation_errors: Vec<TrainingValidationError>,
}

impl TrainingApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            validation_errors: Vec::new(),
        }
    }

    fn with_validation(
        status: StatusCode,
        message: impl Into<String>,
        validation_errors: Vec<TrainingValidationError>,
    ) -> Self {
        Self {
            status,
            message: message.into(),
            validation_errors,
        }
    }
}

impl IntoResponse for TrainingApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(TrainingErrorResponse {
                error: self.message,
                validation_errors: self.validation_errors,
            }),
        )
            .into_response()
    }
}

#[derive(Debug)]
struct TrainingLibrary {
    root: PathBuf,
    manifest: Manifest,
}

#[derive(Debug, Clone)]
struct ResolvedJob<'a> {
    job: &'a JobManifestEntry,
    path: PathBuf,
}

pub async fn library_summary(
    Json(req): Json<LibrarySummaryRequest>,
) -> Result<Json<LibrarySummaryResponse>, TrainingApiError> {
    library_summary_for_root(req.root.as_deref()).map(Json)
}

pub async fn session_start(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<SessionStartRequest>,
) -> Result<Json<SessionStartResponse>, TrainingApiError> {
    start_session_from_request(state, req).map(Json)
}

pub async fn session_replay(
    State(state): State<Arc<SharedAppState>>,
    Json(req): Json<SessionReplayRequest>,
) -> Result<Json<SessionStartResponse>, TrainingApiError> {
    replay_session_from_request(state, req).map(Json)
}

fn library_summary_for_root(
    root: Option<&str>,
) -> Result<LibrarySummaryResponse, TrainingApiError> {
    let library = load_training_library(root)?;
    let (solved_jobs, validation_errors) = collect_solved_jobs(&library);
    let mut counts_by_hero_position = BTreeMap::new();
    let mut counts_by_pot_type = BTreeMap::new();
    let mut counts_by_profile_id = BTreeMap::new();

    for resolved in &solved_jobs {
        increment(&mut counts_by_pot_type, &resolved.job.pot_type);
        increment(&mut counts_by_profile_id, &resolved.job.profile_id);
        increment(&mut counts_by_hero_position, &resolved.job.oop_position);
        if resolved.job.ip_position != resolved.job.oop_position {
            increment(&mut counts_by_hero_position, &resolved.job.ip_position);
        }
    }

    Ok(LibrarySummaryResponse {
        root: display_path(&library.root),
        manifest: manifest_metadata(&library.manifest),
        solved_job_count: solved_jobs.len(),
        counts_by_hero_position,
        counts_by_pot_type,
        counts_by_profile_id,
        validation_errors,
    })
}

fn start_session_from_request(
    state: Arc<SharedAppState>,
    req: SessionStartRequest,
) -> Result<SessionStartResponse, TrainingApiError> {
    validate_position(&req.hero_position)?;
    let library = load_training_library(req.root.as_deref())?;
    let (solved_jobs, validation_errors) = collect_solved_jobs(&library);
    let matching = filter_session_jobs(&solved_jobs, &req);
    if matching.is_empty() {
        return Err(TrainingApiError::with_validation(
            StatusCode::NOT_FOUND,
            "no solved training jobs match the requested filters",
            validation_errors,
        ));
    }

    let mut rng = Lcg::new(random_seed());
    let mut candidates = matching;
    let mut start_errors = validation_errors;
    while !candidates.is_empty() {
        let selected_index = choose_session_job_index(&candidates, &mut rng);
        let selected = candidates.swap_remove(selected_index);
        match build_session_from_job(
            state.clone(),
            &library.root,
            &req,
            &selected,
            &mut rng,
            None,
            None,
        ) {
            Ok(response) => return Ok(response),
            Err(err) => {
                start_errors.push(TrainingValidationError {
                    profile_id: Some(selected.job.profile_id.clone()),
                    path: Some(display_path(&selected.path)),
                    message: err.message,
                });
            }
        }
    }

    Err(TrainingApiError::with_validation(
        StatusCode::BAD_REQUEST,
        "no loadable training jobs match the requested filters",
        start_errors,
    ))
}

fn replay_session_from_request(
    state: Arc<SharedAppState>,
    req: SessionReplayRequest,
) -> Result<SessionStartResponse, TrainingApiError> {
    validate_position(&req.hero_position)?;
    if req.path.trim().is_empty() {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            "path is required to replay a training session",
        ));
    }

    let library = load_training_library(req.root.as_deref())?;
    let (solved_jobs, validation_errors) = collect_solved_jobs(&library);
    let selected =
        find_solved_job_by_path(&solved_jobs, &library.root, &req.path).ok_or_else(|| {
            TrainingApiError::with_validation(
                StatusCode::NOT_FOUND,
                "no solved training job matches the replay path",
                validation_errors,
            )
        })?;

    if selected.job.oop_position != req.hero_position
        && selected.job.ip_position != req.hero_position
    {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "heroPosition {} is not part of selected replay spot",
                req.hero_position
            ),
        ));
    }

    let fixed_hero_hand = req.hero_hand.clone();
    let excluded_villain_hand = req.villain_hand.clone();
    let start_req = SessionStartRequest {
        root: req.root,
        hero_position: req.hero_position,
        pot_types: None,
        profile_ids: None,
    };
    let mut rng = Lcg::new(random_seed());
    build_session_from_job(
        state,
        &library.root,
        &start_req,
        &selected,
        &mut rng,
        fixed_hero_hand.as_ref(),
        excluded_villain_hand.as_ref(),
    )
}

fn build_session_from_job(
    state: Arc<SharedAppState>,
    root: &Path,
    req: &SessionStartRequest,
    selected: &ResolvedJob<'_>,
    rng: &mut Lcg,
    fixed_hero_hand: Option<&TrainingHandSelection>,
    excluded_villain_hand: Option<&TrainingHandSelection>,
) -> Result<SessionStartResponse, TrainingApiError> {
    let path = selected.path.clone();
    let (mut game, memo): (PostFlopGame, String) =
        load_data_from_file(&path, None).map_err(|err| {
            TrainingApiError::new(
                StatusCode::BAD_REQUEST,
                format!("failed to load selected game {}: {err}", path.display()),
            )
        })?;
    validate_loaded_game(selected.job, &game, &memo)?;
    game.apply_history(&[]);

    let hero_player_index = if selected.job.oop_position == req.hero_position {
        0
    } else {
        1
    };
    let villain_player_index = hero_player_index ^ 1;
    let (hero_hand, villain_hand) = if let Some(fixed_hero_hand) = fixed_hero_hand {
        sample_villain_for_fixed_hero(
            &game,
            hero_player_index,
            fixed_hero_hand,
            excluded_villain_hand,
            rng,
        )
    } else {
        sample_hand_pair(&game, hero_player_index, rng)
    }
    .map_err(|message| TrainingApiError::new(StatusCode::BAD_REQUEST, message))?;

    let board = board_from_game(&game);
    let starting_pot = game.tree_config().starting_pot;
    let effective_stack = game.tree_config().effective_stack;
    let game_ranges = game.card_config().range;

    *state.game_state.lock().unwrap() = game;
    let mut ranges = state.range_state.lock().unwrap();
    ranges.0[0] = game_ranges[0];
    ranges.0[1] = game_ranges[1];

    Ok(SessionStartResponse {
        root: display_path(root),
        profile_id: selected.job.profile_id.clone(),
        profile_weight: selected.job.profile_weight,
        stack_weight: selected.job.stack_weight,
        spot: selected.job.spot.clone(),
        pot_type: selected.job.pot_type.clone(),
        oop_position: selected.job.oop_position.clone(),
        ip_position: selected.job.ip_position.clone(),
        board,
        starting_pot,
        effective_stack,
        hero_position: req.hero_position.clone(),
        villain_position: if villain_player_index == 0 {
            selected.job.oop_position.clone()
        } else {
            selected.job.ip_position.clone()
        },
        hero_player: player_name(hero_player_index).to_string(),
        villain_player: player_name(villain_player_index).to_string(),
        hero_hand,
        villain_hand,
        path: display_path(&selected.path),
    })
}

fn validate_loaded_game(
    job: &JobManifestEntry,
    game: &PostFlopGame,
    memo: &str,
) -> Result<(), TrainingApiError> {
    let expected_flop = flop_from_string(&job.flop).map_err(|err| {
        TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!("manifest has invalid flop for {}: {err}", job.profile_id),
        )
    })?;
    if game.card_config().flop != expected_flop {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "loaded game flop does not match manifest for {}",
                job.profile_id
            ),
        ));
    }
    if game.tree_config().starting_pot != job.starting_pot {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "loaded game starting pot does not match manifest for {}",
                job.profile_id
            ),
        ));
    }
    if game.tree_config().effective_stack != job.effective_stack {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "loaded game effective stack does not match manifest for {}",
                job.profile_id
            ),
        ));
    }
    if !job.profile_fingerprint.is_empty()
        && !memo_has_key_value(memo, "profile_fingerprint", &job.profile_fingerprint)
    {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "loaded game profile fingerprint does not match manifest for {}",
                job.profile_id
            ),
        ));
    }
    if !job.range_fingerprint.is_empty()
        && !memo_has_key_value(memo, "range_fingerprint", &job.range_fingerprint)
    {
        return Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "loaded game range fingerprint does not match manifest for {}",
                job.profile_id
            ),
        ));
    }

    Ok(())
}

fn memo_has_key_value(memo: &str, key: &str, value: &str) -> bool {
    memo.split(',').any(|part| part == format!("{key}={value}"))
}

fn load_training_library(root: Option<&str>) -> Result<TrainingLibrary, TrainingApiError> {
    let root = resolve_root(root)?;
    let manifest_path = root.join("manifest.json");
    let mut manifest = read_manifest_file(&manifest_path)?;
    for backup_path in manifest_backup_paths(&root, &manifest_path)? {
        let backup = read_manifest_file(&backup_path)?;
        manifest.jobs.extend(backup.jobs);
    }
    Ok(TrainingLibrary { root, manifest })
}

fn read_manifest_file(path: &Path) -> Result<Manifest, TrainingApiError> {
    let raw = std::fs::read_to_string(path).map_err(|err| {
        TrainingApiError::new(
            StatusCode::NOT_FOUND,
            format!("failed to read manifest {}: {err}", path.display()),
        )
    })?;
    serde_json::from_str::<Manifest>(&raw).map_err(|err| {
        TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!("failed to parse manifest {}: {err}", path.display()),
        )
    })
}

fn manifest_backup_paths(
    root: &Path,
    primary_manifest: &Path,
) -> Result<Vec<PathBuf>, TrainingApiError> {
    let entries = std::fs::read_dir(root).map_err(|err| {
        TrainingApiError::new(
            StatusCode::NOT_FOUND,
            format!("failed to read training root {}: {err}", root.display()),
        )
    })?;
    let mut paths = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|err| {
            TrainingApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "failed to read training root entry in {}: {err}",
                    root.display()
                ),
            )
        })?;
        let path = entry.path();
        if path == primary_manifest || !is_manifest_backup_path(&path) {
            continue;
        }
        paths.push(path);
    }

    paths.sort();
    Ok(paths)
}

fn is_manifest_backup_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    file_name.starts_with("manifest")
        && file_name.ends_with(".json")
        && !file_name.contains(".tmp.")
}

fn resolve_root(root: Option<&str>) -> Result<PathBuf, TrainingApiError> {
    let raw = root
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_TRAINING_ROOT);
    let path = expand_home(raw)?;
    if path.is_absolute() {
        Ok(path)
    } else {
        let current_dir = std::env::current_dir().map_err(|err| {
            TrainingApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to resolve current directory: {err}"),
            )
        })?;
        Ok(current_dir.join(path))
    }
}

fn expand_home(raw: &str) -> Result<PathBuf, TrainingApiError> {
    if raw == "~" || raw.starts_with("~/") {
        let home = std::env::var_os("HOME").ok_or_else(|| {
            TrainingApiError::new(
                StatusCode::BAD_REQUEST,
                "cannot expand training root because HOME is not set",
            )
        })?;
        let mut path = PathBuf::from(home);
        if raw.len() > 2 {
            path.push(&raw[2..]);
        }
        Ok(path)
    } else {
        Ok(PathBuf::from(raw))
    }
}

fn manifest_metadata(manifest: &Manifest) -> ManifestMetadata {
    ManifestMetadata {
        version: manifest.version,
        generated_at: manifest.generated_at.clone(),
        config_path: manifest.config_path.as_ref().map(|path| display_path(path)),
        output_dir: display_path(&manifest.output_dir),
        job_count: manifest.jobs.len(),
    }
}

fn collect_solved_jobs(
    library: &TrainingLibrary,
) -> (Vec<ResolvedJob<'_>>, Vec<TrainingValidationError>) {
    let mut solved = Vec::new();
    let mut errors = Vec::new();
    let mut seen_paths = BTreeSet::new();

    for job in &library.manifest.jobs {
        if !is_loadable_job_status(job.status) {
            continue;
        }

        if job.path.is_none() && job.output_relative_path.is_none() {
            if reports_missing_loadable_file(job.status) {
                errors.push(TrainingValidationError {
                    profile_id: Some(job.profile_id.clone()),
                    path: None,
                    message: "solved job is missing a file path".to_string(),
                });
            }
            continue;
        }

        let resolved_path = resolve_job_path(
            &library.root,
            &library.manifest,
            job.output_relative_path.as_deref(),
            job.path.as_deref(),
        );
        if resolved_path.exists() {
            if !seen_paths.insert(resolved_path.clone()) {
                continue;
            }
            solved.push(ResolvedJob {
                job,
                path: resolved_path,
            });
        } else if reports_missing_loadable_file(job.status) {
            errors.push(TrainingValidationError {
                profile_id: Some(job.profile_id.clone()),
                path: Some(display_path(&resolved_path)),
                message: "solved job file is missing".to_string(),
            });
        }
    }

    (solved, errors)
}

fn is_loadable_job_status(status: JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Solved | JobStatus::SkippedExisting | JobStatus::Planned
    )
}

fn reports_missing_loadable_file(status: JobStatus) -> bool {
    matches!(status, JobStatus::Solved | JobStatus::SkippedExisting)
}

fn resolve_job_path(
    root: &Path,
    manifest: &Manifest,
    output_relative_path: Option<&Path>,
    path: Option<&Path>,
) -> PathBuf {
    let mut candidates = Vec::new();

    if let Some(relative_path) = output_relative_path {
        if is_safe_relative_path(relative_path) {
            push_candidate(&mut candidates, root.join(relative_path));
        }
    }

    if let Some(path) = path {
        if path.is_absolute() {
            if path_stays_under_root(root, path) {
                push_candidate(&mut candidates, path.to_path_buf());
            }
        } else if is_safe_relative_path(path) {
            push_candidate(&mut candidates, root.join(path));
        }
        if let Ok(relative) = path.strip_prefix(&manifest.output_dir) {
            if is_safe_relative_path(relative) {
                push_candidate(&mut candidates, root.join(relative));
            }
        }
    }

    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .unwrap_or_else(|| {
            candidates
                .into_iter()
                .next()
                .unwrap_or_else(|| root.join("missing.bin"))
        })
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn path_stays_under_root(root: &Path, path: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    path.starts_with(root)
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn filter_session_jobs<'a>(
    jobs: &'a [ResolvedJob<'a>],
    req: &SessionStartRequest,
) -> Vec<ResolvedJob<'a>> {
    jobs.iter()
        .filter(|resolved| {
            let job = resolved.job;
            (job.oop_position == req.hero_position || job.ip_position == req.hero_position)
                && req.pot_types.as_ref().is_none_or(|pot_types| {
                    pot_types.is_empty() || pot_types.contains(&job.pot_type)
                })
                && req.profile_ids.as_ref().is_none_or(|profile_ids| {
                    profile_ids.is_empty() || profile_ids.contains(&job.profile_id)
                })
        })
        .cloned()
        .collect()
}

fn find_solved_job_by_path<'a>(
    jobs: &'a [ResolvedJob<'a>],
    root: &Path,
    requested: &str,
) -> Option<ResolvedJob<'a>> {
    let requested = requested.trim();
    let raw_path = PathBuf::from(requested);
    let mut candidates = vec![raw_path.clone()];
    if raw_path.is_relative() && is_safe_relative_path(&raw_path) {
        candidates.push(root.join(&raw_path));
    }

    jobs.iter()
        .find(|resolved| {
            display_path(&resolved.path) == requested
                || candidates
                    .iter()
                    .any(|candidate| paths_refer_to_same_file(&resolved.path, candidate))
        })
        .cloned()
}

fn paths_refer_to_same_file(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn choose_session_job_index(jobs: &[ResolvedJob<'_>], rng: &mut Lcg) -> usize {
    let mut profile_groups: BTreeMap<&str, (u32, Vec<usize>)> = BTreeMap::new();
    for (index, resolved) in jobs.iter().enumerate() {
        let entry = profile_groups
            .entry(&resolved.job.profile_id)
            .or_insert((resolved.job.profile_weight, Vec::new()));
        entry.0 = entry.0.max(resolved.job.profile_weight);
        entry.1.push(index);
    }

    let groups = profile_groups.into_values().collect::<Vec<_>>();
    let profile_weights = groups.iter().map(|(weight, _)| *weight).collect::<Vec<_>>();
    let group_index = choose_weighted_index(&profile_weights, rng);

    let mut stack_groups: BTreeMap<i32, (u32, Vec<usize>)> = BTreeMap::new();
    for job_index in &groups[group_index].1 {
        let job = jobs[*job_index].job;
        let entry = stack_groups
            .entry(job.effective_stack)
            .or_insert((job.stack_weight, Vec::new()));
        entry.0 = entry.0.max(job.stack_weight);
        entry.1.push(*job_index);
    }

    let stack_groups = stack_groups.into_values().collect::<Vec<_>>();
    let stack_weights = stack_groups
        .iter()
        .map(|(weight, _)| *weight)
        .collect::<Vec<_>>();
    let stack_group_index = choose_weighted_index(&stack_weights, rng);
    let job_indices = &stack_groups[stack_group_index].1;
    job_indices[rng.next_usize(job_indices.len())]
}

fn choose_weighted_index(weights: &[u32], rng: &mut Lcg) -> usize {
    let total_weight = weights
        .iter()
        .fold(0u64, |sum, weight| sum + u64::from(*weight));
    if total_weight == 0 {
        return rng.next_usize(weights.len());
    }

    let mut ticket = rng.next_u64() % total_weight;
    for (index, weight) in weights.iter().enumerate() {
        let weight = u64::from(*weight);
        if ticket < weight {
            return index;
        }
        ticket -= weight;
    }

    weights.len().saturating_sub(1)
}

fn sample_hand_pair(
    game: &PostFlopGame,
    hero_player: usize,
    rng: &mut Lcg,
) -> Result<(TrainingHandSelection, TrainingHandSelection), String> {
    let villain_player = hero_player ^ 1;
    let hero_cards = game.private_cards(hero_player);
    let villain_cards = game.private_cards(villain_player);
    let hero_weights = game.weights(hero_player);
    let villain_weights = game.weights(villain_player);

    let mut total = 0.0f64;
    for (hero_index, hero_hand) in hero_cards.iter().enumerate() {
        let hero_weight = f64::from(hero_weights[hero_index]);
        if hero_weight <= 0.0 {
            continue;
        }
        for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
            let villain_weight = f64::from(villain_weights[villain_index]);
            if villain_weight > 0.0 && !hands_overlap(*hero_hand, *villain_hand) {
                total += hero_weight * villain_weight;
            }
        }
    }

    if total <= 0.0 {
        return Err("selected game has no non-overlapping weighted hand pairs".to_string());
    }

    let mut ticket = rng.next_f64() * total;
    for (hero_index, hero_hand) in hero_cards.iter().enumerate() {
        let hero_weight = f64::from(hero_weights[hero_index]);
        if hero_weight <= 0.0 {
            continue;
        }
        for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
            let villain_weight = f64::from(villain_weights[villain_index]);
            if villain_weight <= 0.0 || hands_overlap(*hero_hand, *villain_hand) {
                continue;
            }
            let weight = hero_weight * villain_weight;
            if ticket <= weight {
                return Ok((
                    hand_selection(hero_index, *hero_hand),
                    hand_selection(villain_index, *villain_hand),
                ));
            }
            ticket -= weight;
        }
    }

    for (hero_index, hero_hand) in hero_cards.iter().enumerate() {
        for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
            if hero_weights[hero_index] > 0.0
                && villain_weights[villain_index] > 0.0
                && !hands_overlap(*hero_hand, *villain_hand)
            {
                return Ok((
                    hand_selection(hero_index, *hero_hand),
                    hand_selection(villain_index, *villain_hand),
                ));
            }
        }
    }

    Err("selected game has no non-overlapping weighted hand pairs".to_string())
}

fn sample_villain_for_fixed_hero(
    game: &PostFlopGame,
    hero_player: usize,
    fixed_hero_hand: &TrainingHandSelection,
    excluded_villain_hand: Option<&TrainingHandSelection>,
    rng: &mut Lcg,
) -> Result<(TrainingHandSelection, TrainingHandSelection), String> {
    let villain_player = hero_player ^ 1;
    let hero_cards = game.private_cards(hero_player);
    let villain_cards = game.private_cards(villain_player);
    let hero_weights = game.weights(hero_player);
    let villain_weights = game.weights(villain_player);
    let (hero_index, hero_hand) =
        resolve_requested_hand(hero_cards, hero_weights, fixed_hero_hand, "hero")?;
    let excluded_villain_index = excluded_villain_hand
        .map(|hand| resolve_requested_hand(villain_cards, villain_weights, hand, "villain"))
        .transpose()?
        .map(|(index, _)| index);

    let mut total = 0.0f64;
    for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
        if Some(villain_index) == excluded_villain_index {
            continue;
        }
        let villain_weight = f64::from(villain_weights[villain_index]);
        if villain_weight > 0.0 && !hands_overlap(hero_hand, *villain_hand) {
            total += villain_weight;
        }
    }

    if total <= 0.0 {
        return Err(if excluded_villain_index.is_some() {
            "selected game has no different non-overlapping weighted villain hands for the requested hero hand"
                .to_string()
        } else {
            "selected game has no non-overlapping weighted villain hands for the requested hero hand"
                .to_string()
        });
    }

    let mut ticket = rng.next_f64() * total;
    for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
        if Some(villain_index) == excluded_villain_index {
            continue;
        }
        let villain_weight = f64::from(villain_weights[villain_index]);
        if villain_weight <= 0.0 || hands_overlap(hero_hand, *villain_hand) {
            continue;
        }
        if ticket <= villain_weight {
            return Ok((
                hand_selection(hero_index, hero_hand),
                hand_selection(villain_index, *villain_hand),
            ));
        }
        ticket -= villain_weight;
    }

    for (villain_index, villain_hand) in villain_cards.iter().enumerate() {
        if Some(villain_index) != excluded_villain_index
            && villain_weights[villain_index] > 0.0
            && !hands_overlap(hero_hand, *villain_hand)
        {
            return Ok((
                hand_selection(hero_index, hero_hand),
                hand_selection(villain_index, *villain_hand),
            ));
        }
    }

    Err(
        "selected game has no non-overlapping weighted villain hands for the requested hero hand"
            .to_string(),
    )
}

fn resolve_requested_hand(
    cards: &[(u8, u8)],
    weights: &[f32],
    selection: &TrainingHandSelection,
    role: &str,
) -> Result<(usize, (u8, u8)), String> {
    let hand = cards
        .get(selection.index)
        .copied()
        .ok_or_else(|| format!("{role} hand index {} is out of range", selection.index))?;
    if packed_hand(hand) != selection.packed || hand_cards(hand) != selection.cards {
        return Err(format!(
            "{role} hand selection does not match the selected replay game"
        ));
    }
    if weights.get(selection.index).copied().unwrap_or(0.0) <= 0.0 {
        return Err(format!(
            "{role} hand selection has no weight in the selected replay game"
        ));
    }

    Ok((selection.index, hand))
}

fn hand_selection(index: usize, hand: (u8, u8)) -> TrainingHandSelection {
    TrainingHandSelection {
        packed: packed_hand(hand),
        index,
        cards: hand_cards(hand),
    }
}

fn packed_hand(hand: (u8, u8)) -> u16 {
    u16::from(hand.0) | (u16::from(hand.1) << 8)
}

fn hand_cards(hand: (u8, u8)) -> [u8; 2] {
    [hand.0, hand.1]
}

fn hands_overlap(a: (u8, u8), b: (u8, u8)) -> bool {
    a.0 == b.0 || a.0 == b.1 || a.1 == b.0 || a.1 == b.1
}

fn board_from_game(game: &PostFlopGame) -> Vec<u8> {
    let config = game.card_config();
    let mut board = config.flop.to_vec();
    if config.turn != NOT_DEALT {
        board.push(config.turn);
    }
    if config.river != NOT_DEALT {
        board.push(config.river);
    }
    board
}

fn validate_position(position: &str) -> Result<(), TrainingApiError> {
    if SIX_MAX_POSITIONS.contains(&position) {
        Ok(())
    } else {
        Err(TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "heroPosition must be one of {}",
                SIX_MAX_POSITIONS.join(", ")
            ),
        ))
    }
}

fn increment(counts: &mut BTreeMap<String, usize>, key: &str) {
    *counts.entry(key.to_string()).or_default() += 1;
}

fn player_name(player: usize) -> &'static str {
    if player == 0 {
        "oop"
    } else {
        "ip"
    }
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

fn random_seed() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    (nanos as u64) ^ ((nanos >> 64) as u64) ^ u64::from(std::process::id())
}

struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x517c_c1b7_2722_0a95,
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.state
    }

    fn next_usize(&mut self, upper: usize) -> usize {
        (self.next_u64() as usize) % upper
    }

    fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::training_precompute::{
        execute_job, range_fingerprint, JobManifestEntry, LoadedProfileRanges,
        ProfileStreetTreeConfig, ProfileTreeConfig, StackVariant, TrainingProfile,
    };

    fn street_tree(
        oop_bet: &str,
        ip_bet: &str,
        raise: &str,
        donk: Option<&str>,
    ) -> ProfileStreetTreeConfig {
        ProfileStreetTreeConfig {
            oop_bet: oop_bet.to_string(),
            ip_bet: ip_bet.to_string(),
            raise: raise.to_string(),
            donk: donk.map(str::to_string),
        }
    }

    fn standard_tree_config() -> ProfileTreeConfig {
        ProfileTreeConfig {
            flop: street_tree("50%", "30%,80%,150%", "3x", Some("50%")),
            turn: street_tree("30%,80%,150%", "30%,80%,150%", "3x", Some("50%")),
            river: street_tree("30%,80%,150%", "30%,80%,150%", "3x", Some("50%")),
            add_allin_threshold: 1.5,
            force_allin_threshold: 0.15,
            merging_threshold: 0.1,
        }
    }

    fn profile(id: &str) -> TrainingProfile {
        TrainingProfile {
            id: id.to_string(),
            enabled: true,
            weight: 7,
            spot: "Smoke BTN open vs BB call".to_string(),
            pot_type: "2bp".to_string(),
            oop_position: "BB".to_string(),
            ip_position: "BTN".to_string(),
            starting_pot: 6,
            effective_stack: None,
            stack_variants: vec![StackVariant {
                effective_stack: 100,
                weight: 1,
            }],
            rake_rate: 0.0,
            rake_cap: 0.0,
            oop_range_path: "oop.txt".into(),
            ip_range_path: "ip.txt".into(),
            tree_preset: None,
            tree_config: Some(standard_tree_config()),
            flop_count: 1,
            seed: 1,
            target_exploitability: 10_000.0,
            max_iterations: 1,
            enable_compression: false,
        }
    }

    fn first_stack(profile: &TrainingProfile) -> StackVariant {
        profile.stack_variants_for_plan()[0].clone()
    }

    fn ranges() -> LoadedProfileRanges {
        ranges_with("AA", "KK")
    }

    fn ranges_with(oop_range: &str, ip_range: &str) -> LoadedProfileRanges {
        LoadedProfileRanges {
            oop_range: oop_range.to_string(),
            ip_range: ip_range.to_string(),
            range_fingerprint: range_fingerprint(oop_range, ip_range),
        }
    }

    fn manifest_with_jobs(root: &Path, jobs: Vec<JobManifestEntry>) -> Manifest {
        Manifest {
            version: 1,
            generated_at: "test".to_string(),
            config_path: None,
            output_dir: root.to_path_buf(),
            jobs,
        }
    }

    fn write_manifest(root: &Path, manifest: &Manifest) {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_string_pretty(manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn summary_ignores_non_solved_and_missing_jobs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("p1");
        let existing_path = root.join("p1.bin");
        std::fs::write(&existing_path, b"not loaded by summary").unwrap();

        let ranges = ranges();
        let stack = first_stack(&profile);
        let mut solved =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [0, 4, 8], root);
        solved.output_relative_path = Some("p1.bin".into());
        solved.path = Some(existing_path.clone());
        solved.status = JobStatus::Solved;
        let mut failed =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [1, 5, 9], root);
        failed.status = JobStatus::Failed;
        let mut missing =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [2, 6, 10], root);
        missing.output_relative_path = Some("missing.bin".into());
        missing.path = Some(root.join("missing.bin"));
        missing.status = JobStatus::Solved;
        let manifest = manifest_with_jobs(root, vec![solved, failed, missing]);
        write_manifest(root, &manifest);

        let summary = library_summary_for_root(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(summary.solved_job_count, 1);
        assert_eq!(summary.counts_by_profile_id.get("p1"), Some(&1));
        assert_eq!(summary.counts_by_pot_type.get("2bp"), Some(&1));
        assert_eq!(summary.counts_by_hero_position.get("BB"), Some(&1));
        assert_eq!(summary.counts_by_hero_position.get("BTN"), Some(&1));
        assert_eq!(summary.validation_errors.len(), 1);
        assert!(summary.validation_errors[0]
            .message
            .contains("file is missing"));
    }

    #[test]
    fn summary_counts_skipped_existing_jobs_with_existing_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("p1");
        let relative_path = PathBuf::from("p1.bin");
        let existing_path = root.join(&relative_path);
        std::fs::write(&existing_path, b"not loaded by summary").unwrap();

        let ranges = ranges();
        let stack = first_stack(&profile);
        let mut skipped =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [0, 4, 8], root);
        skipped.output_relative_path = Some(relative_path);
        skipped.path = Some(existing_path);
        skipped.status = JobStatus::SkippedExisting;
        let manifest = manifest_with_jobs(root, vec![skipped]);
        write_manifest(root, &manifest);

        let summary = library_summary_for_root(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(summary.solved_job_count, 1);
        assert_eq!(summary.counts_by_profile_id.get("p1"), Some(&1));
        assert!(summary.validation_errors.is_empty());
    }

    #[test]
    fn summary_counts_planned_jobs_with_existing_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("p1");
        let relative_path = PathBuf::from("p1.bin");
        let existing_path = root.join(&relative_path);
        std::fs::write(&existing_path, b"not loaded by summary").unwrap();

        let ranges = ranges();
        let stack = first_stack(&profile);
        let mut planned =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [0, 4, 8], root);
        planned.output_relative_path = Some(relative_path);
        planned.path = Some(existing_path);
        let manifest = manifest_with_jobs(root, vec![planned]);
        write_manifest(root, &manifest);

        let summary = library_summary_for_root(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(summary.solved_job_count, 1);
        assert_eq!(summary.counts_by_profile_id.get("p1"), Some(&1));
        assert!(summary.validation_errors.is_empty());
    }

    #[test]
    fn summary_ignores_planned_jobs_with_missing_files_without_validation_error() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("p1");
        let ranges = ranges();
        let stack = first_stack(&profile);
        let mut planned =
            JobManifestEntry::planned(&profile, &stack, Some(&ranges), [0, 4, 8], root);
        planned.output_relative_path = Some("missing.bin".into());
        planned.path = Some(root.join("missing.bin"));
        let manifest = manifest_with_jobs(root, vec![planned]);
        write_manifest(root, &manifest);

        let summary = library_summary_for_root(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(summary.solved_job_count, 0);
        assert!(summary.validation_errors.is_empty());
    }

    #[test]
    fn summary_includes_loadable_jobs_from_manifest_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile_old = profile("p_old");
        let profile_new = profile("p_new");
        let ranges = ranges();

        let old_relative_path = PathBuf::from("old.bin");
        let new_relative_path = PathBuf::from("new.bin");
        std::fs::write(root.join(&old_relative_path), b"old").unwrap();
        std::fs::write(root.join(&new_relative_path), b"new").unwrap();

        let mut old_job = JobManifestEntry::planned(
            &profile_old,
            &first_stack(&profile_old),
            Some(&ranges),
            [0, 4, 8],
            root,
        );
        old_job.output_relative_path = Some(old_relative_path);
        old_job.path = Some(root.join("old.bin"));
        old_job.status = JobStatus::Solved;

        let mut new_job = JobManifestEntry::planned(
            &profile_new,
            &first_stack(&profile_new),
            Some(&ranges),
            [1, 5, 9],
            root,
        );
        new_job.output_relative_path = Some(new_relative_path);
        new_job.path = Some(root.join("new.bin"));
        new_job.status = JobStatus::Solved;

        std::fs::write(
            root.join("manifest.before-new-run.json"),
            serde_json::to_string_pretty(&manifest_with_jobs(root, vec![old_job])).unwrap(),
        )
        .unwrap();
        write_manifest(root, &manifest_with_jobs(root, vec![new_job]));

        let summary = library_summary_for_root(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(summary.solved_job_count, 2);
        assert_eq!(summary.counts_by_profile_id.get("p_old"), Some(&1));
        assert_eq!(summary.counts_by_profile_id.get("p_new"), Some(&1));
        assert!(summary.validation_errors.is_empty());
    }

    #[test]
    fn filtering_matches_hero_position_for_oop_and_ip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let path = root.join("job.bin");
        std::fs::write(&path, b"exists").unwrap();
        let profile = profile("p1");
        let ranges = ranges();
        let mut job = JobManifestEntry::planned(
            &profile,
            &first_stack(&profile),
            Some(&ranges),
            [0, 4, 8],
            root,
        );
        job.output_relative_path = Some("job.bin".into());
        job.path = Some(path);
        job.status = JobStatus::Solved;
        let manifest = manifest_with_jobs(root, vec![job]);
        let library = TrainingLibrary {
            root: root.to_path_buf(),
            manifest,
        };
        let (solved, errors) = collect_solved_jobs(&library);
        assert!(errors.is_empty());

        let oop_request = SessionStartRequest {
            root: None,
            hero_position: "BB".to_string(),
            pot_types: None,
            profile_ids: None,
        };
        let ip_request = SessionStartRequest {
            root: None,
            hero_position: "BTN".to_string(),
            pot_types: None,
            profile_ids: None,
        };
        assert_eq!(filter_session_jobs(&solved, &oop_request).len(), 1);
        assert_eq!(filter_session_jobs(&solved, &ip_request).len(), 1);
    }

    #[test]
    fn session_selection_respects_stack_weight_within_profile() {
        let root = Path::new("training-games");
        let profile = profile("p1");
        let ranges = ranges();
        let stack_100 = StackVariant {
            effective_stack: 100,
            weight: 0,
        };
        let stack_200 = StackVariant {
            effective_stack: 200,
            weight: 10,
        };
        let mut job_100 =
            JobManifestEntry::planned(&profile, &stack_100, Some(&ranges), [0, 4, 8], root);
        let mut job_200 =
            JobManifestEntry::planned(&profile, &stack_200, Some(&ranges), [1, 5, 9], root);
        job_100.status = JobStatus::Solved;
        job_200.status = JobStatus::Solved;
        let jobs = vec![job_100, job_200];
        let resolved = jobs
            .iter()
            .map(|job| ResolvedJob {
                job,
                path: PathBuf::from("job.bin"),
            })
            .collect::<Vec<_>>();

        for seed in 1..20 {
            let mut rng = Lcg::new(seed);
            let selected = choose_session_job_index(&resolved, &mut rng);
            assert_eq!(resolved[selected].job.effective_stack, 200);
        }
    }

    #[test]
    fn resolve_root_expands_home() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };

        let resolved = resolve_root(Some("~/training-games-test")).unwrap();
        assert_eq!(resolved, PathBuf::from(home).join("training-games-test"));
    }

    #[test]
    fn resolve_root_uses_formal_default() {
        let current_dir = std::env::current_dir().unwrap();
        let resolved = resolve_root(None).unwrap();
        assert_eq!(resolved, current_dir.join("../training-games-formal"));
    }

    #[test]
    fn collect_solved_jobs_prefers_output_relative_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let relative_path = PathBuf::from("2bp/p1/job.bin");
        let solved_path = root.join(&relative_path);
        std::fs::create_dir_all(solved_path.parent().unwrap()).unwrap();
        std::fs::write(&solved_path, b"exists").unwrap();

        let profile = profile("p1");
        let ranges = ranges();
        let mut job = JobManifestEntry::planned(
            &profile,
            &first_stack(&profile),
            Some(&ranges),
            [0, 4, 8],
            root,
        );
        job.status = JobStatus::Solved;
        job.output_relative_path = Some(relative_path);
        job.path = Some(PathBuf::from("wrong/job.bin"));

        let library = TrainingLibrary {
            root: root.to_path_buf(),
            manifest: manifest_with_jobs(root, vec![job]),
        };
        let (solved, errors) = collect_solved_jobs(&library);

        assert!(errors.is_empty());
        assert_eq!(solved.len(), 1);
        assert_eq!(solved[0].path, solved_path);
    }

    #[test]
    fn collect_solved_jobs_rejects_paths_outside_root() {
        let root_tmp = tempfile::tempdir().unwrap();
        let outside_tmp = tempfile::tempdir().unwrap();
        let root = root_tmp.path();
        let outside_path = outside_tmp.path().join("job.bin");
        std::fs::write(&outside_path, b"exists").unwrap();

        let profile = profile("p1");
        let ranges = ranges();
        let mut relative_escape = JobManifestEntry::planned(
            &profile,
            &first_stack(&profile),
            Some(&ranges),
            [0, 4, 8],
            root,
        );
        relative_escape.status = JobStatus::Solved;
        relative_escape.output_relative_path = Some("../job.bin".into());
        relative_escape.path = None;

        let mut absolute_escape = JobManifestEntry::planned(
            &profile,
            &first_stack(&profile),
            Some(&ranges),
            [1, 5, 9],
            root,
        );
        absolute_escape.status = JobStatus::Solved;
        absolute_escape.output_relative_path = None;
        absolute_escape.path = Some(outside_path);

        let library = TrainingLibrary {
            root: root.to_path_buf(),
            manifest: manifest_with_jobs(root, vec![relative_escape, absolute_escape]),
        };
        let (solved, errors) = collect_solved_jobs(&library);

        assert!(solved.is_empty());
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn loaded_game_must_match_manifest_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("smoke_2bp_btn_vs_bb_100bb");
        let ranges = ranges();
        let flop = [0, 4, 8];
        let mut job =
            JobManifestEntry::planned(&profile, &first_stack(&profile), Some(&ranges), flop, root);
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        let (game, memo): (PostFlopGame, String) =
            load_data_from_file(job.path.as_ref().unwrap(), None).unwrap();

        assert!(validate_loaded_game(&job, &game, &memo).is_ok());

        let mut bad_job = job;
        bad_job.flop = "2d3c4c".to_string();
        assert!(validate_loaded_game(&bad_job, &game, &memo).is_err());
    }

    #[test]
    fn replay_path_matches_display_absolute_and_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("p1");
        let ranges = ranges();
        let relative_path = PathBuf::from("2bp/p1/job.bin");
        let absolute_path = root.join(&relative_path);
        std::fs::create_dir_all(absolute_path.parent().unwrap()).unwrap();
        std::fs::write(&absolute_path, b"exists").unwrap();

        let mut job = JobManifestEntry::planned(
            &profile,
            &first_stack(&profile),
            Some(&ranges),
            [0, 4, 8],
            root,
        );
        job.status = JobStatus::Solved;
        job.output_relative_path = Some(relative_path.clone());
        job.path = Some(absolute_path.clone());
        let jobs = vec![job];
        let resolved = jobs
            .iter()
            .map(|job| ResolvedJob {
                job,
                path: absolute_path.clone(),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            find_solved_job_by_path(&resolved, root, absolute_path.to_str().unwrap())
                .unwrap()
                .path,
            absolute_path
        );
        assert_eq!(
            find_solved_job_by_path(&resolved, root, relative_path.to_str().unwrap())
                .unwrap()
                .path,
            absolute_path
        );
    }

    #[test]
    fn session_start_loads_game_and_samples_non_overlapping_hands() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("smoke_2bp_btn_vs_bb_100bb");
        let ranges = ranges();
        let flop = [0, 4, 8];
        let mut job =
            JobManifestEntry::planned(&profile, &first_stack(&profile), Some(&ranges), flop, root);
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        let manifest = manifest_with_jobs(root, vec![job]);
        write_manifest(root, &manifest);

        let state = Arc::new(SharedAppState::single_user());
        let response = start_session_from_request(
            state.clone(),
            SessionStartRequest {
                root: Some(root.to_str().unwrap().to_string()),
                hero_position: "BTN".to_string(),
                pot_types: Some(vec!["2bp".to_string()]),
                profile_ids: None,
            },
        )
        .unwrap();

        assert_eq!(response.hero_player, "ip");
        assert_eq!(response.villain_player, "oop");
        for hero_card in response.hero_hand.cards {
            assert!(!response.villain_hand.cards.contains(&hero_card));
        }
        let cards = state.game_state.lock().unwrap().private_cards(1).to_vec();
        assert_eq!(
            packed_hand(cards[response.hero_hand.index]),
            response.hero_hand.packed
        );
        assert_eq!(state.range_state.lock().unwrap().0[0].to_string(), "AA");
    }

    #[test]
    fn session_replay_can_keep_hero_hand_and_resample_villain() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("smoke_replay_same_hero_new_villain");
        let ranges = ranges_with("KK,QQ", "AA");
        let flop = [0, 4, 8];
        let mut job =
            JobManifestEntry::planned(&profile, &first_stack(&profile), Some(&ranges), flop, root);
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        let manifest = manifest_with_jobs(root, vec![job]);
        write_manifest(root, &manifest);

        let state = Arc::new(SharedAppState::single_user());
        let response = start_session_from_request(
            state.clone(),
            SessionStartRequest {
                root: Some(root.to_str().unwrap().to_string()),
                hero_position: "BTN".to_string(),
                pot_types: Some(vec!["2bp".to_string()]),
                profile_ids: None,
            },
        )
        .unwrap();

        let replayed = replay_session_from_request(
            state,
            SessionReplayRequest {
                root: Some(root.to_str().unwrap().to_string()),
                hero_position: response.hero_position.clone(),
                path: response.path.clone(),
                hero_hand: Some(response.hero_hand.clone()),
                villain_hand: Some(response.villain_hand.clone()),
            },
        )
        .unwrap();

        assert_eq!(replayed.hero_hand.index, response.hero_hand.index);
        assert_eq!(replayed.hero_hand.packed, response.hero_hand.packed);
        assert_eq!(replayed.hero_hand.cards, response.hero_hand.cards);
        assert_ne!(replayed.villain_hand.packed, response.villain_hand.packed);
        for hero_card in replayed.hero_hand.cards {
            assert!(!replayed.villain_hand.cards.contains(&hero_card));
        }
    }

    #[test]
    fn missing_manifest_returns_structured_error() {
        let tmp = tempfile::tempdir().unwrap();
        let err = library_summary_for_root(Some(tmp.path().to_str().unwrap())).unwrap_err();
        assert_eq!(err.status, StatusCode::NOT_FOUND);
        assert!(err.message.contains("failed to read manifest"));
    }

    #[test]
    fn old_manifest_jobs_default_profile_weight_to_one() {
        let raw = r#"{
            "version": 1,
            "generatedAt": "test",
            "configPath": null,
            "outputDir": "training-games",
            "jobs": [{
                "profileId": "p1",
                "spot": "spot",
                "potType": "2bp",
                "oopPosition": "BB",
                "ipPosition": "BTN",
                "flop": "2c3c4c",
                "startingPot": 550,
                "effectiveStack": 10000,
                "treePreset": "standard_srp",
                "profileFingerprint": "abc",
                "targetExploitability": 0.3,
                "maxIterations": 1,
                "iterationsCompleted": 1,
                "finalExploitability": 0.0,
                "status": "solved",
                "path": "p1.bin",
                "durationMs": 1,
                "error": null
            }]
        }"#;
        let manifest = serde_json::from_str::<Manifest>(raw).unwrap();
        assert_eq!(manifest.jobs[0].profile_weight, 1);
    }
}

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
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_TRAINING_ROOT: &str = "../training-games";
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

#[derive(Debug, Clone, Serialize)]
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
        match build_session_from_job(state.clone(), &library.root, &req, &selected, &mut rng) {
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

fn build_session_from_job(
    state: Arc<SharedAppState>,
    root: &Path,
    req: &SessionStartRequest,
    selected: &ResolvedJob<'_>,
    rng: &mut Lcg,
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
    let (hero_hand, villain_hand) = sample_hand_pair(&game, hero_player_index, rng)
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
    let raw = std::fs::read_to_string(&manifest_path).map_err(|err| {
        TrainingApiError::new(
            StatusCode::NOT_FOUND,
            format!("failed to read manifest {}: {err}", manifest_path.display()),
        )
    })?;
    let manifest = serde_json::from_str::<Manifest>(&raw).map_err(|err| {
        TrainingApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "failed to parse manifest {}: {err}",
                manifest_path.display()
            ),
        )
    })?;
    Ok(TrainingLibrary { root, manifest })
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

    for job in &library.manifest.jobs {
        if job.status != JobStatus::Solved {
            continue;
        }

        if job.path.is_none() && job.output_relative_path.is_none() {
            errors.push(TrainingValidationError {
                profile_id: Some(job.profile_id.clone()),
                path: None,
                message: "solved job is missing a file path".to_string(),
            });
            continue;
        }

        let resolved_path = resolve_job_path(
            &library.root,
            &library.manifest,
            job.output_relative_path.as_deref(),
            job.path.as_deref(),
        );
        if resolved_path.exists() {
            solved.push(ResolvedJob {
                job,
                path: resolved_path,
            });
        } else {
            errors.push(TrainingValidationError {
                profile_id: Some(job.profile_id.clone()),
                path: Some(display_path(&resolved_path)),
                message: "solved job file is missing".to_string(),
            });
        }
    }

    (solved, errors)
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
    let total_weight = groups
        .iter()
        .fold(0u64, |sum, (weight, _)| sum + u64::from(*weight));
    let group_index = if total_weight == 0 {
        rng.next_usize(groups.len())
    } else {
        let mut ticket = rng.next_u64() % total_weight;
        let mut selected = 0;
        for (index, (weight, _)) in groups.iter().enumerate() {
            let weight = u64::from(*weight);
            if ticket < weight {
                selected = index;
                break;
            }
            ticket -= weight;
        }
        selected
    };
    let job_indices = &groups[group_index].1;
    job_indices[rng.next_usize(job_indices.len())]
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

fn hand_selection(index: usize, hand: (u8, u8)) -> TrainingHandSelection {
    TrainingHandSelection {
        packed: packed_hand(hand),
        index,
        cards: [hand.0, hand.1],
    }
}

fn packed_hand(hand: (u8, u8)) -> u16 {
    u16::from(hand.0) | (u16::from(hand.1) << 8)
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
        execute_job, range_fingerprint, JobManifestEntry, LoadedProfileRanges, TrainingProfile,
    };

    fn profile(id: &str) -> TrainingProfile {
        TrainingProfile {
            id: id.to_string(),
            enabled: true,
            weight: 7,
            spot: "Smoke BTN open vs BB call".to_string(),
            pot_type: "2bp".to_string(),
            oop_position: "BB".to_string(),
            ip_position: "BTN".to_string(),
            starting_pot: 550,
            effective_stack: 10000,
            rake_rate: 0.0,
            rake_cap: 0.0,
            oop_range_path: "oop.txt".into(),
            ip_range_path: "ip.txt".into(),
            tree_preset: "standard_srp".to_string(),
            flop_count: 1,
            seed: 1,
            target_exploitability: 10_000.0,
            max_iterations: 1,
            enable_compression: false,
        }
    }

    fn ranges() -> LoadedProfileRanges {
        LoadedProfileRanges {
            oop_range: "AA".to_string(),
            ip_range: "KK".to_string(),
            range_fingerprint: range_fingerprint("AA", "KK"),
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
        let mut solved = JobManifestEntry::planned(&profile, Some(&ranges), [0, 4, 8], root);
        solved.output_relative_path = Some("p1.bin".into());
        solved.path = Some(existing_path.clone());
        solved.status = JobStatus::Solved;
        let mut planned = JobManifestEntry::planned(&profile, Some(&ranges), [1, 5, 9], root);
        planned.status = JobStatus::Planned;
        let mut missing = JobManifestEntry::planned(&profile, Some(&ranges), [2, 6, 10], root);
        missing.output_relative_path = Some("missing.bin".into());
        missing.path = Some(root.join("missing.bin"));
        missing.status = JobStatus::Solved;
        let manifest = manifest_with_jobs(root, vec![solved, planned, missing]);
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
    fn filtering_matches_hero_position_for_oop_and_ip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let path = root.join("job.bin");
        std::fs::write(&path, b"exists").unwrap();
        let profile = profile("p1");
        let ranges = ranges();
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), [0, 4, 8], root);
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
    fn resolve_root_expands_home() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };

        let resolved = resolve_root(Some("~/training-games-test")).unwrap();
        assert_eq!(resolved, PathBuf::from(home).join("training-games-test"));
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
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), [0, 4, 8], root);
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
        let mut relative_escape =
            JobManifestEntry::planned(&profile, Some(&ranges), [0, 4, 8], root);
        relative_escape.status = JobStatus::Solved;
        relative_escape.output_relative_path = Some("../job.bin".into());
        relative_escape.path = None;

        let mut absolute_escape =
            JobManifestEntry::planned(&profile, Some(&ranges), [1, 5, 9], root);
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
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), flop, root);
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        let (game, memo): (PostFlopGame, String) =
            load_data_from_file(job.path.as_ref().unwrap(), None).unwrap();

        assert!(validate_loaded_game(&job, &game, &memo).is_ok());

        let mut bad_job = job;
        bad_job.flop = "2d3c4c".to_string();
        assert!(validate_loaded_game(&bad_job, &game, &memo).is_err());
    }

    #[test]
    fn session_start_loads_game_and_samples_non_overlapping_hands() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let profile = profile("smoke_2bp_btn_vs_bb_100bb");
        let ranges = ranges();
        let flop = [0, 4, 8];
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), flop, root);
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

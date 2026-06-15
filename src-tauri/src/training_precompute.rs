use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use postflop_solver::{
    compute_exploitability, finalize, load_data_from_file, save_data_to_file, solve_step,
    ActionTree, BetSizeOptions, BoardState, CardConfig, DonkSizeOptions, PostFlopGame, TreeConfig,
    NOT_DEALT,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOptions {
    pub config_path: PathBuf,
    pub output_dir: PathBuf,
    pub profile: Option<String>,
    pub seed: Option<u64>,
    pub limit: Option<usize>,
    pub overwrite: bool,
    pub dry_run: bool,
}

impl CliOptions {
    pub fn parse_env() -> Result<Self, String> {
        Self::parse_from(std::env::args_os())
    }

    pub fn parse_from<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        let mut args = args.into_iter().map(Into::into);
        let _program = args.next();

        let mut config_path = None;
        let mut output_dir = None;
        let mut profile = None;
        let mut seed = None;
        let mut limit = None;
        let mut overwrite = false;
        let mut dry_run = false;

        while let Some(arg) = args.next() {
            let arg = arg
                .into_string()
                .map_err(|_| "arguments must be valid UTF-8".to_string())?;
            match arg.as_str() {
                "--config" => {
                    config_path = Some(PathBuf::from(next_arg(&mut args, "--config")?));
                }
                "--out" => {
                    output_dir = Some(PathBuf::from(next_arg(&mut args, "--out")?));
                }
                "--profile" => {
                    profile = Some(next_arg(&mut args, "--profile")?);
                }
                "--seed" => {
                    let raw = next_arg(&mut args, "--seed")?;
                    seed = Some(
                        raw.parse::<u64>()
                            .map_err(|_| format!("invalid --seed value: {raw}"))?,
                    );
                }
                "--limit" => {
                    let raw = next_arg(&mut args, "--limit")?;
                    limit = Some(
                        raw.parse::<usize>()
                            .map_err(|_| format!("invalid --limit value: {raw}"))?,
                    );
                }
                "--overwrite" => overwrite = true,
                "--dry-run" => dry_run = true,
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        let mut missing = Vec::new();
        if config_path.is_none() {
            missing.push("--config");
        }
        if output_dir.is_none() {
            missing.push("--out");
        }
        if !missing.is_empty() {
            return Err(format!(
                "missing required argument(s): {}",
                missing.join(", ")
            ));
        }

        Ok(Self {
            config_path: config_path.unwrap(),
            output_dir: output_dir.unwrap(),
            profile,
            seed,
            limit,
            overwrite,
            dry_run,
        })
    }
}

fn next_arg<I>(args: &mut I, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = OsString>,
{
    args.next()
        .ok_or_else(|| format!("{flag} requires a value"))?
        .into_string()
        .map_err(|_| format!("{flag} value must be valid UTF-8"))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrainingConfig {
    pub version: u32,
    pub profiles: Vec<TrainingProfile>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrainingProfile {
    pub id: String,
    pub enabled: bool,
    pub weight: u32,
    pub spot: String,
    #[serde(rename = "potType")]
    pub pot_type: String,
    #[serde(rename = "oopPosition")]
    pub oop_position: String,
    #[serde(rename = "ipPosition")]
    pub ip_position: String,
    #[serde(rename = "startingPot")]
    pub starting_pot: i32,
    #[serde(rename = "effectiveStack")]
    pub effective_stack: i32,
    #[serde(rename = "rakeRate")]
    pub rake_rate: f64,
    #[serde(rename = "rakeCap")]
    pub rake_cap: f64,
    #[serde(default, rename = "oopRangePath")]
    pub oop_range_path: PathBuf,
    #[serde(default, rename = "ipRangePath")]
    pub ip_range_path: PathBuf,
    #[serde(rename = "treePreset")]
    pub tree_preset: String,
    #[serde(rename = "flopCount")]
    pub flop_count: usize,
    pub seed: u64,
    #[serde(rename = "targetExploitability")]
    pub target_exploitability: f32,
    #[serde(rename = "maxIterations")]
    pub max_iterations: u32,
    #[serde(rename = "enableCompression")]
    pub enable_compression: bool,
}

impl TrainingProfile {
    pub fn run_status_precheck(&self) -> Option<JobStatus> {
        if self.oop_range_path.as_os_str().is_empty() || self.ip_range_path.as_os_str().is_empty() {
            Some(JobStatus::MissingRange)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedProfileRanges {
    pub oop_range: String,
    pub ip_range: String,
    pub range_fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Planned,
    SkippedExisting,
    MissingRange,
    Solved,
    Failed,
}

#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    pub profile: Option<String>,
    pub seed: Option<u64>,
    pub limit: Option<usize>,
    pub overwrite: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub generated_at: String,
    pub config_path: Option<PathBuf>,
    pub output_dir: PathBuf,
    pub jobs: Vec<JobManifestEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobManifestEntry {
    pub profile_id: String,
    #[serde(default = "default_profile_weight")]
    pub profile_weight: u32,
    pub spot: String,
    pub pot_type: String,
    pub oop_position: String,
    pub ip_position: String,
    pub flop: String,
    pub starting_pot: i32,
    pub effective_stack: i32,
    pub tree_preset: String,
    pub profile_fingerprint: String,
    #[serde(default)]
    pub oop_range_path: PathBuf,
    #[serde(default)]
    pub ip_range_path: PathBuf,
    #[serde(default)]
    pub range_fingerprint: String,
    pub target_exploitability: f32,
    pub max_iterations: u32,
    pub iterations_completed: u32,
    pub final_exploitability: Option<f32>,
    pub status: JobStatus,
    #[serde(default)]
    pub output_relative_path: Option<PathBuf>,
    pub path: Option<PathBuf>,
    pub duration_ms: Option<u128>,
    pub error: Option<String>,
}

impl JobManifestEntry {
    pub fn planned(
        profile: &TrainingProfile,
        ranges: Option<&LoadedProfileRanges>,
        flop: [u8; 3],
        output_dir: &Path,
    ) -> Self {
        let range_fingerprint = ranges
            .map(|ranges| ranges.range_fingerprint.clone())
            .unwrap_or_default();
        let profile_fingerprint = profile_fingerprint(profile, &range_fingerprint);
        let output_relative_path = output_relative_path(profile, &profile_fingerprint, flop);
        let path = output_dir.join(&output_relative_path);
        Self {
            profile_id: profile.id.clone(),
            profile_weight: profile.weight,
            spot: profile.spot.clone(),
            pot_type: profile.pot_type.clone(),
            oop_position: profile.oop_position.clone(),
            ip_position: profile.ip_position.clone(),
            flop: flop_to_string(flop),
            starting_pot: profile.starting_pot,
            effective_stack: profile.effective_stack,
            tree_preset: profile.tree_preset.clone(),
            profile_fingerprint,
            oop_range_path: profile.oop_range_path.clone(),
            ip_range_path: profile.ip_range_path.clone(),
            range_fingerprint,
            target_exploitability: profile.target_exploitability,
            max_iterations: profile.max_iterations,
            iterations_completed: 0,
            final_exploitability: None,
            status: JobStatus::Planned,
            output_relative_path: Some(output_relative_path),
            path: Some(path),
            duration_ms: None,
            error: None,
        }
    }
}

fn default_profile_weight() -> u32 {
    1
}

pub fn validate_config(config: &TrainingConfig) -> Result<(), String> {
    if config.version != 1 {
        return Err(format!("unsupported config version: {}", config.version));
    }

    let mut ids = HashSet::new();
    for profile in &config.profiles {
        if profile.id.trim().is_empty() {
            return Err("profile id cannot be empty".to_string());
        }
        validate_path_component("profile id", &profile.id)?;
        validate_path_component("potType", &profile.pot_type)?;
        if !ids.insert(profile.id.as_str()) {
            return Err(format!("duplicate profile id: {}", profile.id));
        }
        if profile.oop_range_path.as_os_str().is_empty() {
            return Err(format!("oopRangePath cannot be empty for {}", profile.id));
        }
        if profile.ip_range_path.as_os_str().is_empty() {
            return Err(format!("ipRangePath cannot be empty for {}", profile.id));
        }
    }

    Ok(())
}

fn validate_path_component(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value == "." || value == ".." {
        return Err(format!(
            "{label} cannot be a reserved path component: {value}"
        ));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(format!(
            "{label} can only contain ASCII letters, digits, underscores, and hyphens: {value}"
        ));
    }
    Ok(())
}

pub fn sample_flops(seed: u64, count: usize) -> Vec<[u8; 3]> {
    let mut rng = Lcg::new(seed);
    let mut flops = HashSet::new();
    let target = count.min(22_100);

    while flops.len() < target {
        let mut deck = [0u8; 52];
        for (index, card) in deck.iter_mut().enumerate() {
            *card = index as u8;
        }

        for index in 0..3 {
            let swap = index + rng.next_usize(52 - index);
            deck.swap(index, swap);
        }

        let mut flop = [deck[0], deck[1], deck[2]];
        flop.sort_unstable();
        flops.insert(flop);
    }

    let mut ret = flops.into_iter().collect::<Vec<_>>();
    ret.sort_unstable();
    ret
}

pub fn card_to_string(card: u8) -> String {
    const RANKS: [&str; 13] = [
        "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A",
    ];
    const SUITS: [&str; 4] = ["c", "d", "h", "s"];
    format!(
        "{}{}",
        RANKS[(card >> 2) as usize],
        SUITS[(card & 3) as usize]
    )
}

pub fn flop_to_string(flop: [u8; 3]) -> String {
    let mut flop = flop;
    flop.sort_unstable();
    flop.into_iter()
        .map(card_to_string)
        .collect::<Vec<_>>()
        .join("")
}

pub fn output_relative_path(
    profile: &TrainingProfile,
    profile_fingerprint: &str,
    flop: [u8; 3],
) -> PathBuf {
    PathBuf::from(&profile.pot_type)
        .join(&profile.id)
        .join(format!(
            "{}__cfg{}__flop_{}__pot{}__stack{}.bin",
            profile.id,
            profile_fingerprint,
            flop_to_string(flop),
            profile.starting_pot,
            profile.effective_stack
        ))
}

pub fn output_path(
    output_dir: &Path,
    profile: &TrainingProfile,
    profile_fingerprint: &str,
    flop: [u8; 3],
) -> PathBuf {
    output_dir.join(output_relative_path(profile, profile_fingerprint, flop))
}

pub fn load_profile_ranges(
    config_path: &Path,
    profile: &TrainingProfile,
) -> Result<LoadedProfileRanges, String> {
    let config_dir = config_path.parent().unwrap_or_else(|| Path::new("."));
    let oop_path = resolve_profile_relative_path(config_dir, &profile.oop_range_path);
    let ip_path = resolve_profile_relative_path(config_dir, &profile.ip_range_path);

    let oop_range = std::fs::read_to_string(&oop_path).map_err(|err| {
        format!(
            "failed to read oopRangePath for {} ({}): {err}",
            profile.id,
            oop_path.display()
        )
    })?;
    let ip_range = std::fs::read_to_string(&ip_path).map_err(|err| {
        format!(
            "failed to read ipRangePath for {} ({}): {err}",
            profile.id,
            ip_path.display()
        )
    })?;

    let oop_range = oop_range.trim().to_string();
    let ip_range = ip_range.trim().to_string();
    if oop_range.is_empty() {
        return Err(format!(
            "oopRangePath for {} is empty ({})",
            profile.id,
            oop_path.display()
        ));
    }
    if ip_range.is_empty() {
        return Err(format!(
            "ipRangePath for {} is empty ({})",
            profile.id,
            ip_path.display()
        ));
    }

    Ok(LoadedProfileRanges {
        range_fingerprint: range_fingerprint(&oop_range, &ip_range),
        oop_range,
        ip_range,
    })
}

fn resolve_profile_relative_path(config_dir: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        config_dir.join(path)
    }
}

pub fn range_fingerprint(oop_range: &str, ip_range: &str) -> String {
    let mut payload = String::new();
    append_fingerprint_field(&mut payload, "oop_range", oop_range.trim());
    append_fingerprint_field(&mut payload, "ip_range", ip_range.trim());
    fingerprint_payload(&payload)
}

pub fn profile_fingerprint(profile: &TrainingProfile, range_fingerprint: &str) -> String {
    let mut payload = String::new();
    append_fingerprint_field(&mut payload, "id", &profile.id);
    append_fingerprint_field(&mut payload, "pot_type", &profile.pot_type);
    append_fingerprint_field(&mut payload, "oop_position", &profile.oop_position);
    append_fingerprint_field(&mut payload, "ip_position", &profile.ip_position);
    append_fingerprint_field(&mut payload, "starting_pot", profile.starting_pot);
    append_fingerprint_field(&mut payload, "effective_stack", profile.effective_stack);
    append_fingerprint_field(&mut payload, "rake_rate_bits", profile.rake_rate.to_bits());
    append_fingerprint_field(&mut payload, "rake_cap_bits", profile.rake_cap.to_bits());
    append_fingerprint_field(&mut payload, "range_fingerprint", range_fingerprint);
    append_fingerprint_field(&mut payload, "tree_preset", &profile.tree_preset);
    append_fingerprint_field(
        &mut payload,
        "target_exploitability_bits",
        profile.target_exploitability.to_bits(),
    );
    append_fingerprint_field(&mut payload, "max_iterations", profile.max_iterations);
    append_fingerprint_field(
        &mut payload,
        "enable_compression",
        profile.enable_compression,
    );

    fingerprint_payload(&payload)
}

fn fingerprint_payload(payload: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in payload.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }

    format!("{hash:016x}")
}

fn append_fingerprint_field<T: std::fmt::Display>(payload: &mut String, key: &str, value: T) {
    let _ = writeln!(payload, "{key}={value}");
}

pub fn build_job_plan(
    config: &TrainingConfig,
    config_path: &Path,
    output_dir: &Path,
    opts: &RunOptions,
) -> Result<Manifest, String> {
    validate_config(config)?;

    if let Some(profile_id) = &opts.profile {
        if !config
            .profiles
            .iter()
            .any(|profile| profile.id == *profile_id)
        {
            return Err(format!("unknown profile: {profile_id}"));
        }
    }

    let mut jobs = Vec::new();
    for profile in &config.profiles {
        if !profile.enabled {
            continue;
        }
        if opts
            .profile
            .as_ref()
            .is_some_and(|profile_id| profile_id != &profile.id)
        {
            continue;
        }

        let loaded_ranges = match profile.run_status_precheck() {
            Some(_) => Err("profile is missing one or both range paths".to_string()),
            None => load_profile_ranges(config_path, profile),
        };
        let loaded_ranges_ref = loaded_ranges.as_ref().ok();
        let range_error = loaded_ranges.as_ref().err().cloned();

        let seed = opts.seed.unwrap_or(profile.seed);
        let count = profile.flop_count.max(1);
        for flop in sample_flops(seed, count) {
            if opts.limit.is_some_and(|limit| jobs.len() >= limit) {
                break;
            }

            let mut job = JobManifestEntry::planned(profile, loaded_ranges_ref, flop, output_dir);
            if let Some(error) = &range_error {
                job.status = JobStatus::MissingRange;
                job.error = Some(error.clone());
            } else if job.path.as_ref().is_some_and(|path| path.exists()) && !opts.overwrite {
                job.status = JobStatus::SkippedExisting;
            }
            jobs.push(job);
        }
    }

    Ok(Manifest {
        version: 1,
        generated_at: generated_at(),
        config_path: None,
        output_dir: output_dir.to_path_buf(),
        jobs,
    })
}

pub fn tree_config_for_preset(
    preset: &str,
    starting_pot: i32,
    effective_stack: i32,
    rake_rate: f64,
    rake_cap: f64,
) -> Result<TreeConfig, String> {
    let (flop_bet, flop_raise, turn_bet, turn_raise, river_bet, river_raise, donk) = match preset {
        "standard_srp" => (
            "50%,75%", "2.5x", "50%,75%", "2.5x", "50%,75%", "2.5x", "50%",
        ),
        "standard_3bp" => (
            "33%,75%", "2.5x", "50%,75%", "2.5x", "50%,75%", "2.5x", "50%",
        ),
        "standard_4bp" => ("25%,50%", "2.5x", "50%", "2.5x", "50%", "2.5x", "50%"),
        other => return Err(format!("unknown tree preset: {other}")),
    };

    let flop_sizes = [
        bet_size_options(flop_bet, flop_raise)?,
        bet_size_options(flop_bet, flop_raise)?,
    ];
    let turn_sizes = [
        bet_size_options(turn_bet, turn_raise)?,
        bet_size_options(turn_bet, turn_raise)?,
    ];
    let river_sizes = [
        bet_size_options(river_bet, river_raise)?,
        bet_size_options(river_bet, river_raise)?,
    ];

    Ok(TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot,
        effective_stack,
        rake_rate,
        rake_cap,
        flop_bet_sizes: flop_sizes,
        turn_bet_sizes: turn_sizes,
        river_bet_sizes: river_sizes,
        turn_donk_sizes: Some(
            DonkSizeOptions::try_from(donk)
                .map_err(|err| format!("invalid turn donk size for {preset}: {err}"))?,
        ),
        river_donk_sizes: Some(
            DonkSizeOptions::try_from(donk)
                .map_err(|err| format!("invalid river donk size for {preset}: {err}"))?,
        ),
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    })
}

fn bet_size_options(bet: &str, raise: &str) -> Result<BetSizeOptions, String> {
    BetSizeOptions::try_from((bet, raise))
        .map_err(|err| format!("invalid bet size options ({bet}, {raise}): {err}"))
}

pub fn execute_job(
    profile: &TrainingProfile,
    ranges: &LoadedProfileRanges,
    flop: [u8; 3],
    job: &mut JobManifestEntry,
    overwrite: bool,
) -> Result<(), String> {
    let start = Instant::now();
    let path = job
        .path
        .clone()
        .ok_or_else(|| "job has no output path".to_string())?;

    if path.exists() && !overwrite {
        job.status = JobStatus::SkippedExisting;
        job.duration_ms = Some(start.elapsed().as_millis());
        return Ok(());
    }

    let oop_range = ranges
        .oop_range
        .parse()
        .map_err(|err| format!("invalid OOP range for {}: {err}", profile.id))?;
    let ip_range = ranges
        .ip_range
        .parse()
        .map_err(|err| format!("invalid IP range for {}: {err}", profile.id))?;

    let card_config = CardConfig {
        range: [oop_range, ip_range],
        flop,
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };

    let tree_config = tree_config_for_preset(
        &profile.tree_preset,
        profile.starting_pot,
        profile.effective_stack,
        profile.rake_rate,
        profile.rake_cap,
    )?;
    let action_tree = ActionTree::new(tree_config)
        .map_err(|err| format!("failed to build action tree for {}: {err}", profile.id))?;
    let mut game = PostFlopGame::with_config(card_config, action_tree)
        .map_err(|err| format!("failed to build game for {}: {err}", profile.id))?;

    game.allocate_memory(profile.enable_compression);
    let solve_report = solve_with_report(
        &mut game,
        profile.max_iterations,
        profile.target_exploitability,
    );

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create output directory: {err}"))?;
    }

    let memo = format!(
        "profile={},spot={},flop={},profile_fingerprint={},range_fingerprint={}",
        profile.id,
        profile.spot,
        flop_to_string(flop),
        job.profile_fingerprint,
        ranges.range_fingerprint
    );
    save_data_to_file(&game, &memo, &path, None)
        .map_err(|err| format!("failed to save {}: {err}", path.display()))?;

    let (loaded, _memo): (PostFlopGame, _) = load_data_from_file(&path, None)
        .map_err(|err| format!("failed to verify saved file {}: {err}", path.display()))?;
    if loaded.card_config().flop != flop {
        return Err(format!(
            "verified file has unexpected flop: {}",
            flop_to_string(loaded.card_config().flop)
        ));
    }
    if loaded.tree_config().starting_pot != profile.starting_pot {
        return Err("verified file has unexpected starting pot".to_string());
    }
    if loaded.tree_config().effective_stack != profile.effective_stack {
        return Err("verified file has unexpected effective stack".to_string());
    }

    job.status = JobStatus::Solved;
    job.iterations_completed = solve_report.iterations_completed;
    job.final_exploitability = Some(solve_report.final_exploitability);
    job.duration_ms = Some(start.elapsed().as_millis());
    job.error = None;
    Ok(())
}

struct SolveReport {
    iterations_completed: u32,
    final_exploitability: f32,
}

fn solve_with_report(
    game: &mut PostFlopGame,
    max_iterations: u32,
    target_exploitability: f32,
) -> SolveReport {
    let mut exploitability = compute_exploitability(&*game);
    let mut iterations_completed = 0;

    for iteration in 0..max_iterations {
        if exploitability <= target_exploitability {
            break;
        }

        solve_step(&*game, iteration);
        iterations_completed += 1;

        if iterations_completed % 10 == 0 || iterations_completed == max_iterations {
            exploitability = compute_exploitability(&*game);
        }
    }

    finalize(game);

    SolveReport {
        iterations_completed,
        final_exploitability: exploitability,
    }
}

pub fn run_cli(opts: CliOptions) -> Result<(), String> {
    let raw_config = std::fs::read_to_string(&opts.config_path).map_err(|err| {
        format!(
            "failed to read config {}: {err}",
            opts.config_path.display()
        )
    })?;
    let config: TrainingConfig = serde_json::from_str(&raw_config).map_err(|err| {
        format!(
            "failed to parse config {}: {err}",
            opts.config_path.display()
        )
    })?;

    let run_options = RunOptions {
        profile: opts.profile.clone(),
        seed: opts.seed,
        limit: opts.limit,
        overwrite: opts.overwrite,
        dry_run: opts.dry_run,
    };
    let mut manifest = build_job_plan(&config, &opts.config_path, &opts.output_dir, &run_options)?;
    manifest.config_path = Some(opts.config_path.clone());
    write_manifest(&manifest)?;

    if !run_options.dry_run {
        let output_dir = manifest.output_dir.clone();
        for index in 0..manifest.jobs.len() {
            if manifest.jobs[index].status != JobStatus::Planned {
                continue;
            }

            let profile_id = manifest.jobs[index].profile_id.clone();
            let Some(profile) = config
                .profiles
                .iter()
                .find(|profile| profile.id == profile_id)
            else {
                manifest.jobs[index].status = JobStatus::Failed;
                manifest.jobs[index].error = Some(format!("profile not found: {profile_id}"));
                write_manifest(&manifest)?;
                continue;
            };

            let flop_text = manifest.jobs[index].flop.clone();
            let flop = match flop_from_string(&flop_text) {
                Ok(flop) => flop,
                Err(err) => {
                    manifest.jobs[index].status = JobStatus::Failed;
                    manifest.jobs[index].error = Some(err);
                    write_manifest(&manifest)?;
                    continue;
                }
            };

            let ranges = match load_profile_ranges(&opts.config_path, profile) {
                Ok(ranges) => ranges,
                Err(err) => {
                    manifest.jobs[index].status = JobStatus::MissingRange;
                    manifest.jobs[index].error = Some(err);
                    write_manifest(&manifest)?;
                    continue;
                }
            };

            {
                let job = &mut manifest.jobs[index];
                job.range_fingerprint = ranges.range_fingerprint.clone();
                job.profile_fingerprint = profile_fingerprint(profile, &job.range_fingerprint);
                let relative_path = output_relative_path(profile, &job.profile_fingerprint, flop);
                job.output_relative_path = Some(relative_path.clone());
                job.path = Some(output_dir.join(relative_path));
            }

            let result = {
                let job = &mut manifest.jobs[index];
                execute_job(profile, &ranges, flop, job, run_options.overwrite)
            };
            if let Err(err) = result {
                manifest.jobs[index].status = JobStatus::Failed;
                manifest.jobs[index].error = Some(err);
            }
            write_manifest(&manifest)?;
        }
    }

    Ok(())
}

fn write_manifest(manifest: &Manifest) -> Result<(), String> {
    std::fs::create_dir_all(&manifest.output_dir)
        .map_err(|err| format!("failed to create output directory: {err}"))?;
    let path = manifest.output_dir.join("manifest.json");
    let tmp_path = manifest
        .output_dir
        .join(format!("manifest.json.tmp.{}", std::process::id()));
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|err| format!("failed to serialize manifest: {err}"))?;
    std::fs::write(&tmp_path, json)
        .map_err(|err| format!("failed to write manifest {}: {err}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &path).map_err(|err| {
        format!(
            "failed to replace manifest {} with {}: {err}",
            path.display(),
            tmp_path.display()
        )
    })
}

pub(crate) fn flop_from_string(text: &str) -> Result<[u8; 3], String> {
    if text.len() != 6 {
        return Err(format!("invalid flop string: {text}"));
    }

    let cards = [
        card_from_string(&text[0..2])?,
        card_from_string(&text[2..4])?,
        card_from_string(&text[4..6])?,
    ];

    let mut unique = HashSet::new();
    if !cards.iter().all(|card| unique.insert(*card)) {
        return Err(format!("flop contains duplicate cards: {text}"));
    }

    Ok(cards)
}

fn card_from_string(text: &str) -> Result<u8, String> {
    let bytes = text.as_bytes();
    if bytes.len() != 2 {
        return Err(format!("invalid card string: {text}"));
    }

    let rank = match bytes[0] {
        b'2' => 0,
        b'3' => 1,
        b'4' => 2,
        b'5' => 3,
        b'6' => 4,
        b'7' => 5,
        b'8' => 6,
        b'9' => 7,
        b'T' | b't' => 8,
        b'J' | b'j' => 9,
        b'Q' | b'q' => 10,
        b'K' | b'k' => 11,
        b'A' | b'a' => 12,
        _ => return Err(format!("invalid card rank: {text}")),
    };
    let suit = match bytes[1] {
        b'c' => 0,
        b'd' => 1,
        b'h' => 2,
        b's' => 3,
        _ => return Err(format!("invalid card suit: {text}")),
    };

    Ok(4 * rank + suit)
}

fn generated_at() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs().to_string(),
        Err(_) => "0".to_string(),
    }
}

struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x9e37_79b9_7f4a_7c15,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};

    fn path_profile(id: &str, oop_range_path: PathBuf, ip_range_path: PathBuf) -> TrainingProfile {
        TrainingProfile {
            id: id.to_string(),
            enabled: true,
            weight: 1,
            spot: "Test spot".to_string(),
            pot_type: "2bp".to_string(),
            oop_position: "BB".to_string(),
            ip_position: "BTN".to_string(),
            starting_pot: 550,
            effective_stack: 10000,
            rake_rate: 0.0,
            rake_cap: 0.0,
            oop_range_path,
            ip_range_path,
            tree_preset: "standard_srp".to_string(),
            flop_count: 10,
            seed: 1,
            target_exploitability: 0.3,
            max_iterations: 1000,
            enable_compression: true,
        }
    }

    fn minimal_profile(id: &str) -> TrainingProfile {
        path_profile(id, PathBuf::from("oop.txt"), PathBuf::from("ip.txt"))
    }

    fn runnable_profile(id: &str) -> TrainingProfile {
        minimal_profile(id)
    }

    fn smoke_profile() -> TrainingProfile {
        TrainingProfile {
            flop_count: 1,
            target_exploitability: 10_000.0,
            max_iterations: 1,
            enable_compression: false,
            ..runnable_profile("smoke_2bp_btn_vs_bb_100bb")
        }
    }

    fn smoke_ranges() -> LoadedProfileRanges {
        LoadedProfileRanges {
            oop_range: "AA".to_string(),
            ip_range: "KK".to_string(),
            range_fingerprint: range_fingerprint("AA", "KK"),
        }
    }

    #[test]
    fn parse_cli_requires_config_and_out() {
        let err = CliOptions::parse_from(["training-precompute"]).unwrap_err();
        assert!(err.contains("--config"));
        assert!(err.contains("--out"));
    }

    #[test]
    fn validate_config_rejects_duplicate_profile_ids() {
        let cfg = TrainingConfig {
            version: 1,
            profiles: vec![minimal_profile("p1"), minimal_profile("p1")],
        };
        let err = validate_config(&cfg).unwrap_err();
        assert!(err.contains("duplicate profile id: p1"));
    }

    #[test]
    fn deserialize_profile_uses_range_paths() {
        let raw = r#"{
            "id": "p1",
            "enabled": true,
            "weight": 1,
            "spot": "Test spot",
            "potType": "2bp",
            "oopPosition": "BB",
            "ipPosition": "BTN",
            "startingPot": 550,
            "effectiveStack": 10000,
            "rakeRate": 0.0,
            "rakeCap": 0.0,
            "oopRangePath": "../ranges/oop.txt",
            "ipRangePath": "../ranges/ip.txt",
            "treePreset": "standard_srp",
            "flopCount": 1,
            "seed": 1,
            "targetExploitability": 0.3,
            "maxIterations": 1,
            "enableCompression": false
        }"#;
        let profile: TrainingProfile = serde_json::from_str(raw).unwrap();
        assert_eq!(profile.oop_range_path, PathBuf::from("../ranges/oop.txt"));
        assert_eq!(profile.ip_range_path, PathBuf::from("../ranges/ip.txt"));
    }

    #[test]
    fn missing_range_paths_are_not_runnable() {
        let profile = path_profile("p1", PathBuf::new(), PathBuf::from("ip.txt"));
        assert_eq!(profile.run_status_precheck(), Some(JobStatus::MissingRange));
    }

    #[test]
    fn validate_config_rejects_empty_range_paths() {
        let cfg = TrainingConfig {
            version: 1,
            profiles: vec![path_profile("p1", PathBuf::new(), PathBuf::from("ip.txt"))],
        };
        let err = validate_config(&cfg).unwrap_err();
        assert!(err.contains("oopRangePath"));
    }

    #[test]
    fn validate_config_rejects_unsafe_output_path_components() {
        let mut profile = minimal_profile("../bad");
        let cfg = TrainingConfig {
            version: 1,
            profiles: vec![profile.clone()],
        };
        let err = validate_config(&cfg).unwrap_err();
        assert!(err.contains("profile id"));

        profile.id = "p1".to_string();
        profile.pot_type = "../bad".to_string();
        let cfg = TrainingConfig {
            version: 1,
            profiles: vec![profile],
        };
        let err = validate_config(&cfg).unwrap_err();
        assert!(err.contains("potType"));
    }

    #[test]
    fn old_inline_range_profile_parses_but_fails_validation() {
        let raw = r#"{
            "version": 1,
            "profiles": [{
                "id": "p1",
                "enabled": true,
                "weight": 1,
                "spot": "Test spot",
                "potType": "2bp",
                "oopPosition": "BB",
                "ipPosition": "BTN",
                "startingPot": 550,
                "effectiveStack": 10000,
                "rakeRate": 0.0,
                "rakeCap": 0.0,
                "oopRange": "AA",
                "ipRange": "KK",
                "treePreset": "standard_srp",
                "flopCount": 1,
                "seed": 1,
                "targetExploitability": 0.3,
                "maxIterations": 1,
                "enableCompression": false
            }]
        }"#;
        let config: TrainingConfig = serde_json::from_str(raw).unwrap();
        let err = validate_config(&config).unwrap_err();
        assert!(err.contains("oopRangePath"));
    }

    #[test]
    fn load_profile_ranges_reads_paths_relative_to_config_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let ranges = tmp.path().join("ranges");
        std::fs::create_dir_all(&ranges).unwrap();
        std::fs::write(ranges.join("oop.txt"), "AA\n").unwrap();
        std::fs::write(ranges.join("ip.txt"), "KK\n").unwrap();
        let config_path = tmp.path().join("profiles/config.json");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();

        let profile = path_profile(
            "p1",
            PathBuf::from("../ranges/oop.txt"),
            PathBuf::from("../ranges/ip.txt"),
        );
        let loaded = load_profile_ranges(&config_path, &profile).unwrap();

        assert_eq!(loaded.oop_range, "AA");
        assert_eq!(loaded.ip_range, "KK");
        assert_eq!(loaded.range_fingerprint, range_fingerprint("AA", "KK"));
    }

    #[test]
    fn load_profile_ranges_rejects_empty_files() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        std::fs::write(tmp.path().join("oop.txt"), "").unwrap();
        std::fs::write(tmp.path().join("ip.txt"), "KK").unwrap();
        let profile = minimal_profile("p1");

        let err = load_profile_ranges(&config_path, &profile).unwrap_err();
        assert!(err.contains("oopRangePath"));
        assert!(err.contains("p1"));
    }

    #[test]
    fn sample_flops_is_deterministic_and_unique() {
        let a = sample_flops(42, 10);
        let b = sample_flops(42, 10);
        assert_eq!(a, b);
        assert_eq!(a.len(), 10);
        let unique = a.iter().collect::<BTreeSet<_>>();
        assert_eq!(unique.len(), 10);
    }

    #[test]
    fn output_path_uses_profile_flop_pot_and_stack() {
        let profile = runnable_profile("2bp_btn_vs_bb_100bb");
        let ranges = smoke_ranges();
        let flop = [51, 21, 0];
        let fingerprint = profile_fingerprint(&profile, &ranges.range_fingerprint);
        let path = output_path(Path::new("training-games"), &profile, &fingerprint, flop);
        assert_eq!(
            path,
            PathBuf::from(format!(
                "training-games/2bp/2bp_btn_vs_bb_100bb/2bp_btn_vs_bb_100bb__cfg{fingerprint}__flop_2c7dAs__pot550__stack10000.bin"
            ))
        );
    }

    #[test]
    fn output_path_changes_when_range_fingerprint_changes() {
        let profile = runnable_profile("p1");
        let flop = [51, 21, 0];
        let original_range_fingerprint = range_fingerprint("AA", "KK");
        let changed_range_fingerprint = range_fingerprint("QQ", "KK");
        let original_profile_fingerprint =
            profile_fingerprint(&profile, &original_range_fingerprint);
        let changed_profile_fingerprint = profile_fingerprint(&profile, &changed_range_fingerprint);
        let original = output_path(
            Path::new("training-games"),
            &profile,
            &original_profile_fingerprint,
            flop,
        );

        let changed = output_path(
            Path::new("training-games"),
            &profile,
            &changed_profile_fingerprint,
            flop,
        );

        assert_ne!(original, changed);
    }

    #[test]
    fn build_plan_marks_missing_ranges_without_solving() {
        let cfg = TrainingConfig {
            version: 1,
            profiles: vec![minimal_profile("p1")],
        };
        let plan = build_job_plan(
            &cfg,
            Path::new("config.json"),
            Path::new("out"),
            &RunOptions::default(),
        )
        .unwrap();
        assert_eq!(plan.jobs[0].status, JobStatus::MissingRange);
    }

    #[test]
    fn known_tree_presets_expand() {
        assert!(tree_config_for_preset("standard_srp", 550, 10000, 0.0, 0.0).is_ok());
        assert!(tree_config_for_preset("standard_3bp", 2100, 10000, 0.0, 0.0).is_ok());
        assert!(tree_config_for_preset("standard_4bp", 4500, 10000, 0.0, 0.0).is_ok());
    }

    #[test]
    fn unknown_tree_preset_errors() {
        let err = tree_config_for_preset("unknown", 550, 10000, 0.0, 0.0).unwrap_err();
        assert!(err.contains("unknown tree preset"));
    }

    #[test]
    fn execute_job_writes_importable_bin() {
        let tmp = tempfile::tempdir().unwrap();
        let profile = smoke_profile();
        let ranges = smoke_ranges();
        let flop = [48, 32, 16];
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), flop, tmp.path());
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        assert_eq!(job.status, JobStatus::Solved);
        let (_game, _memo): (postflop_solver::PostFlopGame, _) =
            postflop_solver::load_data_from_file(job.path.as_ref().unwrap(), None).unwrap();
    }

    #[test]
    fn execute_job_reports_actual_iterations_completed() {
        let tmp = tempfile::tempdir().unwrap();
        let profile = smoke_profile();
        let ranges = smoke_ranges();
        let flop = [48, 32, 16];
        let mut job = JobManifestEntry::planned(&profile, Some(&ranges), flop, tmp.path());
        execute_job(&profile, &ranges, flop, &mut job, true).unwrap();
        assert_eq!(job.iterations_completed, 0);
    }

    #[test]
    fn run_dry_run_writes_manifest_with_planned_jobs() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        std::fs::write(tmp.path().join("oop.txt"), "AA").unwrap();
        std::fs::write(tmp.path().join("ip.txt"), "KK").unwrap();
        std::fs::write(
            &config_path,
            serde_json::to_string(&TrainingConfig {
                version: 1,
                profiles: vec![runnable_profile("p1")],
            })
            .unwrap(),
        )
        .unwrap();

        let opts = CliOptions {
            config_path,
            output_dir: tmp.path().join("out"),
            profile: None,
            seed: Some(7),
            limit: Some(1),
            overwrite: false,
            dry_run: true,
        };
        run_cli(opts).unwrap();
        let manifest = std::fs::read_to_string(tmp.path().join("out/manifest.json")).unwrap();
        assert!(manifest.contains("\"status\": \"planned\""));
        let tmp_manifest_count = std::fs::read_dir(tmp.path().join("out"))
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("manifest.json.tmp.")
            })
            .count();
        assert_eq!(tmp_manifest_count, 0);
    }
}

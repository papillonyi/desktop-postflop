# Training Precompute CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline CLI that expands fixed training profiles into solved `.bin` game files and a manifest that the web app can import later.

**Architecture:** Add a reusable Rust module at `src-tauri/src/training_precompute.rs` for config parsing, deterministic flop sampling, output naming, manifest records, and job execution. Add a thin binary at `src-tauri/src/bin/training_precompute.rs` that parses CLI arguments and calls the module. Keep the generated `.bin` format compatible by using `postflop_solver::save_data_to_file` and verifying with `load_data_from_file`.

**Tech Stack:** Rust 2021, `serde`, `serde_json`, `postflop-solver`, existing Pixi/Cargo commands.

---

## File Structure

- Create `src-tauri/src/training_precompute.rs`: owns profile structs, CLI options, deterministic card/flop helpers, tree presets, manifest structs, and run orchestration.
- Create `src-tauri/src/bin/training_precompute.rs`: thin CLI entrypoint.
- Modify `src-tauri/src/lib.rs`: export the new module.
- Modify `src-tauri/Cargo.toml`: add `training-precompute` bin and `serde_json`.
- Modify `pixi.toml`: add `training-precompute` task.
- Create `training-profiles/example.json`: fixed profile scaffold with empty ranges.
- Create `training-profiles/smoke.json`: tiny runnable profile for fast local verification.

## Task 1: Config Model, CLI Args, and Validation

**Files:**
- Create: `src-tauri/src/training_precompute.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write failing tests for CLI parsing and config validation**

Add tests inside `src-tauri/src/training_precompute.rs`:

```rust
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
fn missing_ranges_are_valid_but_not_runnable() {
    let profile = minimal_profile("p1");
    assert_eq!(profile.run_status_precheck(), Some(JobStatus::MissingRange));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::parse_cli_requires_config_and_out training_precompute::tests::validate_config_rejects_duplicate_profile_ids training_precompute::tests::missing_ranges_are_valid_but_not_runnable
```

Expected: FAIL because `training_precompute` module and types do not exist.

- [ ] **Step 3: Implement config structs, CLI parser, validation, and module export**

Define:

```rust
pub struct CliOptions {
    pub config_path: PathBuf,
    pub output_dir: PathBuf,
    pub profile: Option<String>,
    pub seed: Option<u64>,
    pub limit: Option<usize>,
    pub overwrite: bool,
    pub dry_run: bool,
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
    #[serde(rename = "oopRange")]
    pub oop_range: String,
    #[serde(rename = "ipRange")]
    pub ip_range: String,
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
```

Add `pub mod training_precompute;` to `src-tauri/src/lib.rs`, add `serde_json = "1"` and the new `[[bin]]` to `src-tauri/Cargo.toml`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same `pixi run cargo test ...` command. Expected: PASS.

## Task 2: Flop Sampling, Naming, and Manifest Planning

**Files:**
- Modify: `src-tauri/src/training_precompute.rs`

- [ ] **Step 1: Write failing tests for deterministic sampling, file naming, and dry-run planning**

Add tests:

```rust
#[test]
fn sample_flops_is_deterministic_and_unique() {
    let a = sample_flops(42, 10);
    let b = sample_flops(42, 10);
    assert_eq!(a, b);
    assert_eq!(a.len(), 10);
    let unique = a.iter().collect::<std::collections::BTreeSet<_>>();
    assert_eq!(unique.len(), 10);
}

#[test]
fn output_path_uses_profile_flop_pot_and_stack() {
    let profile = runnable_profile("2bp_btn_vs_bb_100bb");
    let flop = [50, 21, 0];
    let path = output_path(Path::new("training-games"), &profile, flop);
    assert_eq!(
        path,
        PathBuf::from("training-games/2bp_btn_vs_bb_100bb/2bp_btn_vs_bb_100bb__flop_2c7dAs__pot550__stack10000.bin")
    );
}

#[test]
fn build_plan_marks_missing_ranges_without_solving() {
    let cfg = TrainingConfig {
        version: 1,
        profiles: vec![minimal_profile("p1")],
    };
    let plan = build_job_plan(&cfg, Path::new("out"), &RunOptions::default()).unwrap();
    assert_eq!(plan.jobs[0].status, JobStatus::MissingRange);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::sample_flops_is_deterministic_and_unique training_precompute::tests::output_path_uses_profile_flop_pot_and_stack training_precompute::tests::build_plan_marks_missing_ranges_without_solving
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement deterministic sampler, card strings, output path, status, and job plan**

Implement:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Planned,
    SkippedExisting,
    MissingRange,
    Solved,
    Failed,
}

pub fn sample_flops(seed: u64, count: usize) -> Vec<[u8; 3]>;
pub fn card_to_string(card: u8) -> String;
pub fn flop_to_string(flop: [u8; 3]) -> String;
pub fn output_path(output_dir: &Path, profile: &TrainingProfile, flop: [u8; 3]) -> PathBuf;
pub fn build_job_plan(
    cfg: &TrainingConfig,
    output_dir: &Path,
    opts: &RunOptions,
) -> Result<Manifest, String>;
```

Use an internal deterministic LCG/shuffle to avoid adding `rand`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same targeted tests. Expected: PASS.

## Task 3: Tree Presets and Solver Job Execution

**Files:**
- Modify: `src-tauri/src/training_precompute.rs`

- [ ] **Step 1: Write failing tests for tree preset expansion and import-compatible smoke run**

Add tests:

```rust
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
    let mut job = JobManifestEntry::planned(&profile, [48, 32, 16], output_path(tmp.path(), &profile, [48, 32, 16]));
    execute_job(&profile, [48, 32, 16], &mut job, true).unwrap();
    assert_eq!(job.status, JobStatus::Solved);
    let (_game, _memo): (postflop_solver::PostFlopGame, _) =
        postflop_solver::load_data_from_file(job.path.as_ref().unwrap(), None).unwrap();
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::known_tree_presets_expand training_precompute::tests::unknown_tree_preset_errors training_precompute::tests::execute_job_writes_importable_bin
```

Expected: FAIL because preset and execution helpers do not exist.

- [ ] **Step 3: Implement presets and job execution**

Implement:

```rust
pub fn tree_config_for_preset(
    preset: &str,
    starting_pot: i32,
    effective_stack: i32,
    rake_rate: f64,
    rake_cap: f64,
) -> Result<TreeConfig, String>;

pub fn execute_job(
    profile: &TrainingProfile,
    flop: [u8; 3],
    job: &mut JobManifestEntry,
    overwrite: bool,
) -> Result<(), String>;
```

Use `ActionTree::new`, `PostFlopGame::with_config`, `game.allocate_memory(profile.enable_compression)`, `solve(&mut game, profile.max_iterations, profile.target_exploitability, false)`, and `save_data_to_file(&game, memo, path, None)`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same targeted tests. Expected: PASS.

## Task 4: CLI Entrypoint, Example Configs, and Pixi Task

**Files:**
- Create: `src-tauri/src/bin/training_precompute.rs`
- Create: `training-profiles/example.json`
- Create: `training-profiles/smoke.json`
- Modify: `pixi.toml`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write failing test for dry-run manifest JSON**

Add a test:

```rust
#[test]
fn run_dry_run_writes_manifest_with_planned_jobs() {
    let tmp = tempfile::tempdir().unwrap();
    let config_path = tmp.path().join("config.json");
    std::fs::write(&config_path, serde_json::to_string(&TrainingConfig {
        version: 1,
        profiles: vec![runnable_profile("p1")],
    }).unwrap()).unwrap();

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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::run_dry_run_writes_manifest_with_planned_jobs
```

Expected: FAIL because `run_cli` does not exist.

- [ ] **Step 3: Implement `run_cli`, bin main, and config files**

Implement:

```rust
pub fn run_cli(opts: CliOptions) -> Result<(), String>;
```

The bin should call:

```rust
fn main() {
    match desktop_postflop::training_precompute::CliOptions::parse_env()
        .and_then(desktop_postflop::training_precompute::run_cli)
    {
        Ok(()) => {}
        Err(err) => {
            eprintln!("error: {err}");
            std::process::exit(1);
        }
    }
}
```

Add `training-profiles/example.json` with fixed profile ids and empty ranges. Add `training-profiles/smoke.json` with one tiny valid profile, `flopCount: 1`, and very low `maxIterations`.

- [ ] **Step 4: Run test and dry-run command**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::run_dry_run_writes_manifest_with_planned_jobs
pixi run training-precompute --config training-profiles/example.json --out /tmp/training-games --dry-run
```

Expected: both exit 0, and dry-run writes `/tmp/training-games/manifest.json`.

## Task 5: Final Verification

**Files:**
- Verify all files changed in prior tasks.

- [ ] **Step 1: Run Rust tests for the module**

Run:

```sh
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute
```

Expected: PASS.

- [ ] **Step 2: Run smoke CLI**

Run:

```sh
pixi run training-precompute --config training-profiles/smoke.json --out /tmp/training-games-smoke --limit 1 --overwrite
```

Expected: exits 0, writes one `.bin`, and writes `manifest.json` with `solved`.

- [ ] **Step 3: Run backend compile check**

Run:

```sh
pixi run server-check
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```sh
git status --short
```

Expected: implementation files are modified/added; `.idea/` remains untracked and unstaged.

# GTO Training System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 GTO training system from the approved design: repo-local range/profile source data, repo-external precomputed solver files, manifest-backed training APIs, and a React single-hand training flow.

**Architecture:** Keep the existing React + Axum web-server architecture and finish the current uncommitted training direction. The Rust CLI reads path-based profiles and range files, writes solved `.bin` jobs outside the repo, and records manifest metadata. The web backend loads manifest entries into existing game state, while the React Training page reuses `ResultNavigator` for action/chance navigation and immediate feedback.

**Tech Stack:** Rust 1.88, Axum, postflop-solver, serde/serde_json, React 19, TypeScript, React Router, Tailwind, Pixi task runner.

---

## File Structure

- Modify: `.gitignore` - ignore generated training libraries if a developer accidentally creates them in the repo.
- Create: `training-ranges/6max/**` - copy source range text files from `/home/ronin/workspace/gto/ranges/6max_range`, excluding `.DS_Store` and `*:Zone.Identifier`.
- Modify: `training-profiles/6max-heads-up.json` - migrate profile range fields from embedded strings to repo-relative range paths.
- Modify: `training-profiles/smoke.json` - use path-based range fields and a tiny development solve profile.
- Modify: `src-tauri/src/training_precompute.rs` - path-based profile schema, range loading, fingerprints, pot-type output directories, relative manifest paths, incremental manifest writes, and tests.
- Modify: `src-tauri/src/web/training.rs` - support expanded roots, new manifest fields, session retry on bad hand sampling, and tests that use path-based profiles.
- Modify: `src/invokes.ts` - preserve structured backend training error messages.
- Modify: `src/features/training/TrainingPage.tsx` - default to repo-external training root, improve library summary display, and keep hero-position + pot-type UI only.
- Modify: `src/app/navigation.ts` - add Training to top navigation and header selection.
- Modify: `README.md` - document range data, precompute commands, repo-external `.bin` output, and training UI startup.

## Task 1: Copy Source Ranges Into Repo

**Files:**
- Modify: `.gitignore`
- Create: `training-ranges/6max/**`

- [ ] **Step 1: Add generated training output ignores**

Append these lines to `.gitignore`:

```gitignore

# generated training solver outputs
/training-games/
/training-games-dev/
```

- [ ] **Step 2: Copy source range files into the repo**

Run:

```bash
mkdir -p training-ranges/6max
rsync -a \
  --exclude '.DS_Store' \
  --exclude '*.DS_Store' \
  --exclude '*:Zone.Identifier' \
  /home/ronin/workspace/gto/ranges/6max_range/ \
  training-ranges/6max/
```

Expected: `training-ranges/6max/BTN/2.5bb/BB/Call/BTN_range.txt` exists.

- [ ] **Step 3: Verify source range copy**

Run:

```bash
find training-ranges/6max -type f | wc -l
find training-ranges/6max -name '*Zone.Identifier' -o -name '.DS_Store'
test -f training-ranges/6max/BTN/2.5bb/BB/Call/BTN_range.txt
test -f training-ranges/6max/BTN/2.5bb/BB/Call/BB_range.txt
```

Expected: file count is greater than `1000`, the `find ... Zone.Identifier` command prints nothing, and both `test -f` commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add .gitignore training-ranges/6max
git commit -m "add 6max training ranges"
```

## Task 2: Migrate CLI Profile Schema To Range Paths

**Files:**
- Modify: `src-tauri/src/training_precompute.rs`

- [ ] **Step 1: Write failing Rust tests for path-based profiles**

Add these tests inside `#[cfg(test)] mod tests` in `src-tauri/src/training_precompute.rs`:

```rust
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

#[test]
fn load_profile_ranges_reads_paths_relative_to_config_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let ranges = tmp.path().join("ranges");
    std::fs::create_dir_all(&ranges).unwrap();
    std::fs::write(ranges.join("oop.txt"), "AA").unwrap();
    std::fs::write(ranges.join("ip.txt"), "KK").unwrap();
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
    assert!(!loaded.range_fingerprint.is_empty());
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::load_profile_ranges_reads_paths_relative_to_config_dir training_precompute::tests::validate_config_rejects_empty_range_paths
```

Expected: FAIL because `TrainingProfile` has `oop_range`/`ip_range` fields and `load_profile_ranges` does not exist.

- [ ] **Step 3: Replace embedded range fields with path fields**

In `TrainingProfile`, replace:

```rust
#[serde(rename = "oopRange")]
pub oop_range: String,
#[serde(rename = "ipRange")]
pub ip_range: String,
```

with:

```rust
#[serde(rename = "oopRangePath")]
pub oop_range_path: PathBuf,
#[serde(rename = "ipRangePath")]
pub ip_range_path: PathBuf,
```

Add this struct near `TrainingProfile`:

```rust
#[derive(Debug, Clone)]
pub struct LoadedProfileRanges {
    pub oop_range: String,
    pub ip_range: String,
    pub range_fingerprint: String,
}
```

- [ ] **Step 4: Add range loading helpers**

Add these helpers in `src-tauri/src/training_precompute.rs`:

```rust
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
        return Err(format!("oopRangePath for {} is empty", profile.id));
    }
    if ip_range.is_empty() {
        return Err(format!("ipRangePath for {} is empty", profile.id));
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

fn fingerprint_payload(payload: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in payload.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}
```

- [ ] **Step 5: Update validation for path fields**

Update `validate_config` profile checks so it rejects empty range paths:

```rust
if profile.oop_range_path.as_os_str().is_empty() {
    return Err(format!("oopRangePath cannot be empty for {}", profile.id));
}
if profile.ip_range_path.as_os_str().is_empty() {
    return Err(format!("ipRangePath cannot be empty for {}", profile.id));
}
if !matches!(profile.pot_type.as_str(), "2bp" | "3bp" | "4bp") {
    return Err(format!("unsupported potType for {}: {}", profile.id, profile.pot_type));
}
if profile.starting_pot <= 0 {
    return Err(format!("startingPot must be positive for {}", profile.id));
}
if profile.effective_stack <= 0 {
    return Err(format!("effectiveStack must be positive for {}", profile.id));
}
```

- [ ] **Step 6: Update profile fingerprint to use paths and solve inputs**

In `profile_fingerprint`, remove embedded range content fields and use path fields:

```rust
append_fingerprint_field(&mut payload, "oop_range_path", profile.oop_range_path.display());
append_fingerprint_field(&mut payload, "ip_range_path", profile.ip_range_path.display());
```

Change the final hash line to:

```rust
fingerprint_payload(&payload)
```

- [ ] **Step 7: Update tests and helper profiles to path fields**

Replace old `minimal_profile`, `runnable_profile`, and `smoke_profile` helper construction so every `TrainingProfile` uses `oop_range_path` and `ip_range_path`.

Use temp files in tests that need runnable ranges:

```rust
fn write_test_ranges(root: &Path) -> (PathBuf, PathBuf) {
    std::fs::create_dir_all(root).unwrap();
    let oop = root.join("oop_range.txt");
    let ip = root.join("ip_range.txt");
    std::fs::write(&oop, "AA").unwrap();
    std::fs::write(&ip, "KK").unwrap();
    (oop, ip)
}
```

- [ ] **Step 8: Run focused Rust tests**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/training_precompute.rs
git commit -m "use range paths in training profiles"
```

## Task 3: Update Manifest Paths, Fingerprints, And Incremental Writes

**Files:**
- Modify: `src-tauri/src/training_precompute.rs`

- [ ] **Step 1: Write failing tests for pot-type output and manifest fields**

Add tests:

```rust
#[test]
fn output_path_groups_by_pot_type_and_profile() {
    let tmp = tempfile::tempdir().unwrap();
    let (oop, ip) = write_test_ranges(tmp.path());
    let profile = path_profile("2bp_btn_vs_bb_100bb", oop, ip);
    let flop = [51, 21, 0];
    let path = output_path(Path::new("/games"), &profile, flop);
    let fingerprint = profile_fingerprint(&profile);
    assert_eq!(
        path,
        PathBuf::from(format!(
            "/games/2bp/2bp_btn_vs_bb_100bb/2bp_btn_vs_bb_100bb__cfg{fingerprint}__flop_2c7dAs__pot550__stack10000.bin"
        ))
    );
}

#[test]
fn planned_job_records_range_paths_and_fingerprint() {
    let tmp = tempfile::tempdir().unwrap();
    let (oop, ip) = write_test_ranges(tmp.path());
    let profile = path_profile("p1", oop.clone(), ip.clone());
    let loaded = load_profile_ranges(Path::new("profiles/config.json"), &profile).unwrap();
    let job = JobManifestEntry::planned(
        &profile,
        loaded.range_fingerprint.clone(),
        [0, 4, 8],
        PathBuf::from("2bp/p1/p1.bin"),
    );

    assert_eq!(job.oop_range_path, oop);
    assert_eq!(job.ip_range_path, ip);
    assert_eq!(job.range_fingerprint, loaded.range_fingerprint);
    assert_eq!(job.path, Some(PathBuf::from("2bp/p1/p1.bin")));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests::output_path_groups_by_pot_type_and_profile training_precompute::tests::planned_job_records_range_paths_and_fingerprint
```

Expected: FAIL because output paths currently omit `potType` and manifest entries omit range path/fingerprint fields.

- [ ] **Step 3: Add manifest fields**

Add these fields to `JobManifestEntry` after `tree_preset`:

```rust
pub oop_range_path: PathBuf,
pub ip_range_path: PathBuf,
pub range_fingerprint: String,
```

Update `JobManifestEntry::planned` signature:

```rust
pub fn planned(
    profile: &TrainingProfile,
    range_fingerprint: String,
    flop: [u8; 3],
    path: PathBuf,
) -> Self
```

Set the new fields:

```rust
oop_range_path: profile.oop_range_path.clone(),
ip_range_path: profile.ip_range_path.clone(),
range_fingerprint,
```

- [ ] **Step 4: Group output by pot type and profile id**

Replace `output_path` body with:

```rust
pub fn output_path(output_dir: &Path, profile: &TrainingProfile, flop: [u8; 3]) -> PathBuf {
    output_dir.join(output_relative_path(profile, flop))
}

pub fn output_relative_path(profile: &TrainingProfile, flop: [u8; 3]) -> PathBuf {
    let fingerprint = profile_fingerprint(profile);
    PathBuf::from(&profile.pot_type).join(&profile.id).join(format!(
        "{}__cfg{}__flop_{}__pot{}__stack{}.bin",
        profile.id,
        fingerprint,
        flop_to_string(flop),
        profile.starting_pot,
        profile.effective_stack
    ))
}
```

- [ ] **Step 5: Load ranges during job planning**

Change `build_job_plan` signature to include config path:

```rust
pub fn build_job_plan(
    config: &TrainingConfig,
    config_path: &Path,
    output_dir: &Path,
    opts: &RunOptions,
) -> Result<Manifest, String>
```

When building each planned job, load ranges and use relative output path:

```rust
let loaded_ranges = match load_profile_ranges(config_path, profile) {
    Ok(ranges) => ranges,
    Err(err) => {
        for flop in sample_flops(seed, count) {
            let mut job = JobManifestEntry::planned(
                profile,
                String::new(),
                flop,
                output_relative_path(profile, flop),
            );
            job.status = JobStatus::MissingRange;
            job.error = Some(err.clone());
            jobs.push(job);
        }
        continue;
    }
};

let path = output_relative_path(profile, flop);
let mut job = JobManifestEntry::planned(
    profile,
    loaded_ranges.range_fingerprint.clone(),
    flop,
    path,
);
let absolute_path = output_dir.join(job.path.as_ref().unwrap());
if absolute_path.exists() && !opts.overwrite {
    job.status = JobStatus::SkippedExisting;
}
```

- [ ] **Step 6: Execute jobs with loaded ranges and absolute paths**

Change `execute_job` signature:

```rust
pub fn execute_job(
    profile: &TrainingProfile,
    ranges: &LoadedProfileRanges,
    flop: [u8; 3],
    output_dir: &Path,
    job: &mut JobManifestEntry,
    overwrite: bool,
) -> Result<(), String>
```

Resolve the output path:

```rust
let relative_path = job
    .path
    .clone()
    .ok_or_else(|| "job has no output path".to_string())?;
let path = if relative_path.is_absolute() {
    relative_path
} else {
    output_dir.join(relative_path)
};
```

Parse ranges from `ranges`:

```rust
let oop_range = ranges
    .oop_range
    .parse()
    .map_err(|err| format!("invalid OOP range for {}: {err}", profile.id))?;
let ip_range = ranges
    .ip_range
    .parse()
    .map_err(|err| format!("invalid IP range for {}: {err}", profile.id))?;
```

In `run_cli`, update the call site so each planned job reloads the current range files before solving:

```rust
let ranges = match load_profile_ranges(&opts.config_path, profile) {
    Ok(ranges) => ranges,
    Err(err) => {
        job.status = JobStatus::MissingRange;
        job.error = Some(err);
        write_manifest(&manifest)?;
        continue;
    }
};

if let Err(err) = execute_job(
    profile,
    &ranges,
    flop,
    &opts.output_dir,
    job,
    run_options.overwrite,
) {
    job.status = JobStatus::Failed;
    job.error = Some(err);
}
```

- [ ] **Step 7: Write manifest after every job**

Inside `run_cli`, after each job is skipped, solved, or failed, call:

```rust
write_manifest(&manifest)?;
```

Keep the final `write_manifest(&manifest)` after the loop.

- [ ] **Step 8: Run focused Rust tests**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/training_precompute.rs
git commit -m "index training jobs by pot type"
```

## Task 4: Migrate Training Profile JSON Files

**Files:**
- Modify: `training-profiles/6max-heads-up.json`
- Modify: `training-profiles/smoke.json`

- [ ] **Step 1: Replace embedded ranges in `training-profiles/smoke.json`**

Use:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "smoke_2bp_btn_vs_bb_100bb",
      "enabled": true,
      "weight": 1,
      "spot": "Smoke BTN open vs BB call",
      "potType": "2bp",
      "oopPosition": "BB",
      "ipPosition": "BTN",
      "startingPot": 550,
      "effectiveStack": 10000,
      "rakeRate": 0.0,
      "rakeCap": 0.0,
      "oopRangePath": "training-ranges/6max/BTN/2.5bb/BB/Call/BB_range.txt",
      "ipRangePath": "training-ranges/6max/BTN/2.5bb/BB/Call/BTN_range.txt",
      "treePreset": "standard_srp",
      "flopCount": 1,
      "seed": 1,
      "targetExploitability": 10000.0,
      "maxIterations": 1,
      "enableCompression": false
    }
  ]
}
```

- [ ] **Step 2: Replace embedded ranges in `training-profiles/6max-heads-up.json`**

For each profile, remove `oopRange` and `ipRange`, and add the mapped paths:

```text
2bp_btn_vs_bb_100bb:
  oopRangePath = training-ranges/6max/BTN/2.5bb/BB/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/BTN/2.5bb/BB/Call/BTN_range.txt
2bp_co_vs_bb_100bb:
  oopRangePath = training-ranges/6max/CO/2.5bb/BB/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/CO/2.5bb/BB/Call/CO_range.txt
2bp_mp_vs_bb_100bb:
  oopRangePath = training-ranges/6max/MP/2.5bb/BB/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/MP/2.5bb/BB/Call/MP_range.txt
2bp_utg_vs_bb_100bb:
  oopRangePath = training-ranges/6max/UTG/2.5bb/BB/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/UTG/2.5bb/BB/Call/UTG_range.txt
2bp_sb_vs_bb_100bb:
  oopRangePath = training-ranges/6max/SB/3.0bb/BB/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/SB/3.0bb/BB/Call/BB_range.txt
3bp_btn_vs_bb_100bb:
  oopRangePath = training-ranges/6max/BTN/2.5bb/BB/11.0bb/BTN/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/BTN/2.5bb/BB/11.0bb/BTN/Call/BTN_range.txt
3bp_btn_vs_sb_100bb:
  oopRangePath = training-ranges/6max/BTN/2.5bb/SB/11.0bb/BTN/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/BTN/2.5bb/SB/11.0bb/BTN/Call/BTN_range.txt
3bp_co_vs_btn_100bb:
  oopRangePath = training-ranges/6max/CO/2.5bb/BTN/8.5bb/CO/Call/CO_range.txt
  ipRangePath  = training-ranges/6max/CO/2.5bb/BTN/8.5bb/CO/Call/BTN_range.txt
3bp_co_vs_sb_100bb:
  oopRangePath = training-ranges/6max/CO/2.5bb/SB/11.0bb/CO/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/CO/2.5bb/SB/11.0bb/CO/Call/CO_range.txt
3bp_sb_vs_bb_100bb:
  oopRangePath = training-ranges/6max/SB/3.0bb/BB/9.0bb/SB/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/SB/3.0bb/BB/9.0bb/SB/Call/BB_range.txt
4bp_btn_vs_bb_100bb:
  oopRangePath = training-ranges/6max/BTN/2.5bb/BB/11.0bb/BTN/24.0bb/BB/Call/BB_range.txt
  ipRangePath  = training-ranges/6max/BTN/2.5bb/BB/11.0bb/BTN/24.0bb/BB/Call/BTN_range.txt
4bp_btn_vs_sb_100bb:
  oopRangePath = training-ranges/6max/BTN/2.5bb/SB/11.0bb/BTN/24.0bb/SB/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/BTN/2.5bb/SB/11.0bb/BTN/24.0bb/SB/Call/BTN_range.txt
4bp_co_vs_btn_100bb:
  oopRangePath = training-ranges/6max/CO/2.5bb/BTN/8.5bb/CO/22.0bb/BTN/Call/CO_range.txt
  ipRangePath  = training-ranges/6max/CO/2.5bb/BTN/8.5bb/CO/22.0bb/BTN/Call/BTN_range.txt
4bp_sb_vs_bb_100bb:
  oopRangePath = training-ranges/6max/SB/3.0bb/BB/9.0bb/SB/22.0bb/BB/Call/SB_range.txt
  ipRangePath  = training-ranges/6max/SB/3.0bb/BB/9.0bb/SB/22.0bb/BB/Call/BB_range.txt
```

- [ ] **Step 3: Validate JSON syntax and range paths**

Run:

```bash
node -e "for (const f of ['training-profiles/smoke.json','training-profiles/6max-heads-up.json']) { const j=require('fs').readFileSync(f,'utf8'); JSON.parse(j); console.log(f, 'ok'); }"
node -e "const fs=require('fs'); for (const f of ['training-profiles/smoke.json','training-profiles/6max-heads-up.json']) { const p=JSON.parse(fs.readFileSync(f,'utf8')).profiles; for (const x of p) for (const k of ['oopRangePath','ipRangePath']) if (!fs.existsSync(x[k])) throw new Error(`${x.id} missing ${k}: ${x[k]}`); console.log(f, p.length, 'profiles ok'); }"
```

Expected: both commands pass.

- [ ] **Step 4: Run smoke dry-run**

Run:

```bash
pixi run training-precompute --config training-profiles/smoke.json --out ../training-games-dev --dry-run --overwrite
```

Expected: `../training-games-dev/manifest.json` is created with one `planned` job under `2bp/smoke_2bp_btn_vs_bb_100bb`.

- [ ] **Step 5: Commit**

```bash
git add training-profiles/smoke.json training-profiles/6max-heads-up.json
git commit -m "reference training ranges from profiles"
```

## Task 5: Finish Backend Training Library Loading

**Files:**
- Modify: `src-tauri/src/web/training.rs`

- [ ] **Step 1: Write failing tests for external roots and hand-sampling retry**

Add tests in `src-tauri/src/web/training.rs`:

```rust
#[test]
fn resolve_root_expands_home_prefix() {
    let home = std::env::var("HOME").unwrap();
    let resolved = resolve_root(Some("~/workspace/gto/training-games")).unwrap();
    assert!(resolved.starts_with(home));
}

#[test]
fn relative_manifest_paths_resolve_against_library_root_first() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let manifest = Manifest {
        version: 1,
        generated_at: "test".to_string(),
        config_path: None,
        output_dir: PathBuf::from("ignored-output-dir"),
        jobs: Vec::new(),
    };
    let relative = PathBuf::from("2bp/p1/job.bin");
    let expected = root.join(&relative);
    std::fs::create_dir_all(expected.parent().unwrap()).unwrap();
    std::fs::write(&expected, b"exists").unwrap();

    assert_eq!(resolve_job_path(root, &manifest, &relative), expected);
}
```

- [ ] **Step 2: Run tests to verify they fail or expose current ordering**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml web::training::tests::resolve_root_expands_home_prefix web::training::tests::relative_manifest_paths_resolve_against_library_root_first
```

Expected: home expansion fails with current code. Relative manifest path ordering may fail if current working directory has a competing path.

- [ ] **Step 3: Expand `~` and set repo-external default root**

Change:

```rust
const DEFAULT_TRAINING_ROOT: &str = "training-games";
```

to:

```rust
const DEFAULT_TRAINING_ROOT: &str = "../training-games";
```

Update `resolve_root`:

```rust
fn resolve_root(root: Option<&str>) -> Result<PathBuf, TrainingApiError> {
    let raw = root
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_TRAINING_ROOT)
        .trim();
    let expanded = expand_home(raw);
    let path = PathBuf::from(expanded);
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

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest).display().to_string();
        }
    }
    path.to_string()
}
```

- [ ] **Step 4: Prefer manifest-root relative job paths**

Change `resolve_job_path` candidate order for relative paths so `root.join(path)` is tried before current directory:

```rust
if !path.is_absolute() {
    push_candidate(&mut candidates, root.join(path));
    if let Ok(relative) = path.strip_prefix(&manifest.output_dir) {
        push_candidate(&mut candidates, root.join(relative));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        push_candidate(&mut candidates, current_dir.join(path));
    }
}
```

- [ ] **Step 5: Retry session start across candidate jobs**

Replace single-job load/sample in `start_session_from_request` with a bounded retry loop:

```rust
let mut rng = Lcg::new(random_seed());
let mut candidates = matching;
let mut last_error = None;
while !candidates.is_empty() {
    let selected_index = choose_session_job_index(&candidates, &mut rng);
    let selected = candidates.swap_remove(selected_index);
    match build_session_from_job(state.clone(), &req, &library, &selected, &mut rng) {
        Ok(response) => return Ok(response),
        Err(err) => last_error = Some(err),
    }
}

Err(last_error.unwrap_or_else(|| {
    TrainingApiError::with_validation(
        StatusCode::NOT_FOUND,
        "no solved training jobs match the requested filters",
        validation_errors,
    )
}))
```

Add this helper signature and move the existing load/sample/state-update body into it:

```rust
fn build_session_from_job(
    state: Arc<SharedAppState>,
    req: &SessionStartRequest,
    library: &TrainingLibrary,
    selected: &ResolvedJob<'_>,
    rng: &mut Lcg,
) -> Result<SessionStartResponse, TrainingApiError> {
    let path = selected.path.clone();
    let (mut game, _memo): (PostFlopGame, _) =
        load_data_from_file(&path, None).map_err(|err| {
            TrainingApiError::new(
                StatusCode::BAD_REQUEST,
                format!("failed to load selected game {}: {err}", path.display()),
            )
        })?;
    game.apply_history(&[]);

    let hero_player_index = if selected.job.oop_position == req.hero_position {
        0
    } else {
        1
    };
    let villain_player_index = hero_player_index ^ 1;
    let (hero_hand, villain_hand) =
        sample_hand_pair(&game, hero_player_index, rng).map_err(|message| {
            TrainingApiError::new(StatusCode::BAD_REQUEST, message)
        })?;

    let board = board_from_game(&game);
    let starting_pot = game.tree_config().starting_pot;
    let effective_stack = game.tree_config().effective_stack;
    let game_ranges = game.card_config().range;

    *state.game_state.lock().unwrap() = game;
    let mut ranges = state.range_state.lock().unwrap();
    ranges.0[0] = game_ranges[0];
    ranges.0[1] = game_ranges[1];

    Ok(SessionStartResponse {
        root: display_path(&library.root),
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
```

Add a weighted index chooser that returns an index into the candidate vector:

```rust
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
```

- [ ] **Step 6: Update backend tests for path-based profile helpers**

In web training tests, update `profile()` helper to use `oop_range_path` and `ip_range_path`, plus temp range files where `execute_job` is called.

- [ ] **Step 7: Run backend training tests**

Run:

```bash
pixi run cargo test --manifest-path src-tauri/Cargo.toml web::training::tests
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/web/training.rs
git commit -m "load external training libraries"
```

## Task 6: Polish Frontend Training API And Navigation

**Files:**
- Modify: `src/invokes.ts`
- Modify: `src/features/training/TrainingPage.tsx`
- Modify: `src/app/navigation.ts`

- [ ] **Step 1: Improve API error parsing**

In `src/invokes.ts`, update `apiPost` error handling:

```ts
  if (!res.ok) {
    const text = await res.text();
    let detail = `${res.status} ${res.statusText}`;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        detail = parsed.error || text;
      } catch {
        detail = text;
      }
    }
    throw new Error(`POST ${path} failed: ${detail}`);
  }
```

Make the same structured parsing change in `apiGet`.

- [ ] **Step 2: Set Training page default root outside the repo**

In `TrainingPage.tsx`, change:

```ts
const [root, setRoot] = useState("training-games");
```

to:

```ts
const [root, setRoot] = useState("../training-games-dev");
```

- [ ] **Step 3: Keep UI filters to hero position and pot type**

Confirm `TrainingPage.tsx` does not expose `profileIds`. Keep the existing request shape:

```ts
const nextSession = await invokes.trainingSessionStart({
  root,
  heroPosition,
  potTypes: enabledPotTypes,
});
```

- [ ] **Step 4: Add Training to top navigation**

In `src/app/navigation.ts`, import an icon:

```ts
AcademicCapIcon,
```

from `@heroicons/react/24/solid`, then add Training:

```ts
export const topRoutes = [
  { path: "/solver/ranges/oop", label: "Solver", icon: ComputerDesktopIcon },
  { path: "/results", label: "Results", icon: ChartBarIcon },
  { path: "/training", label: "Training", icon: AcademicCapIcon },
];
```

Update `selectHeaderForPath`:

```ts
if (pathname.startsWith("/training")) return "Training";
```

- [ ] **Step 5: Run frontend checks**

Run:

```bash
pixi run lint
pixi run frontend-build
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/invokes.ts src/features/training/TrainingPage.tsx src/app/navigation.ts
git commit -m "polish training page entry"
```

## Task 7: Document Training Data Workflow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add training data section**

Add this section to `README.md`:

````markdown
## GTO Training Data

Source preflop ranges live in `training-ranges/6max/` and training spot definitions live in `training-profiles/`.

Generated solver `.bin` files should stay outside this repository. The recommended development library is:

```sh
pixi run training-precompute --config training-profiles/smoke.json --out ../training-games-dev --overwrite
```

The recommended larger local library is:

```sh
pixi run training-precompute --config training-profiles/6max-heads-up.json --out ../training-games
```

Open `/training`, load `../training-games-dev` or `../training-games`, select a hero position and pot type, then start a new hand.
````

- [ ] **Step 2: Verify markdown formatting**

Run:

```bash
rg -n "GTO Training Data|training-precompute|training-games" README.md
```

Expected: the new section and commands are present.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "document training data workflow"
```

## Task 8: End-To-End Verification

**Files:**
- No source edits unless verification reveals a defect.

- [ ] **Step 1: Run Rust checks**

Run:

```bash
pixi run server-check
pixi run cargo test --manifest-path src-tauri/Cargo.toml training_precompute::tests web::training::tests
```

Expected: PASS.

- [ ] **Step 2: Run frontend checks**

Run:

```bash
pixi run lint
pixi run frontend-build
```

Expected: PASS.

- [ ] **Step 3: Generate smoke training library**

Run:

```bash
pixi run training-precompute --config training-profiles/smoke.json --out ../training-games-dev --overwrite
```

Expected:

```text
../training-games-dev/manifest.json
../training-games-dev/2bp/smoke_2bp_btn_vs_bb_100bb/*.bin
```

- [ ] **Step 4: Start servers for manual check**

Run backend:

```bash
pixi run server-dev
```

In a second shell, run frontend:

```bash
pixi run frontend-dev
```

Expected: backend listens on `127.0.0.1:3000`; frontend prints a Vite URL.

- [ ] **Step 5: Manual browser verification**

Open the Vite URL and go to `/training`.

Verify:

1. Library root `../training-games-dev` loads.
2. Summary shows at least one solved job.
3. Hero `BTN` and `2BP` can start a hand.
4. Hero hand, board, pot, and stack render.
5. Villain and chance nodes advance automatically.
6. Hero action buttons appear on hero decisions.
7. Clicking a hero action adds a decision log with GTO frequency and EV values.
8. Terminal reveals villain cards.
9. Next Hand starts another session without app restart.

- [ ] **Step 6: Commit verification fixes only when files changed**

If verification changed `README.md`, `src/invokes.ts`, `src/features/training/TrainingPage.tsx`, `src/app/navigation.ts`, `src-tauri/src/training_precompute.rs`, or `src-tauri/src/web/training.rs`, inspect the changed paths and commit only the files changed for the verification fix:

```bash
git status --short
git add README.md src/invokes.ts src/features/training/TrainingPage.tsx src/app/navigation.ts src-tauri/src/training_precompute.rs src-tauri/src/web/training.rs
git commit -m "fix training verification issues"
```

If no fixes were needed, do not create an empty commit.

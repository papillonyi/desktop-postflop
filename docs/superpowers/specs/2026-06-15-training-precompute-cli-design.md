# Training Precompute CLI Design

## Goal

Add an offline Rust CLI that generates solved GTO training game files from fixed postflop training profiles. The generated `.bin` files must be loadable by the existing web backend import path, so the application can later use them as a training library.

## Scope

This phase builds the precompute pipeline only:

- Read fixed profile definitions from a JSON file.
- Generate a small set of random flops per enabled profile.
- Build solver parameters from each profile and flop.
- Solve each generated spot.
- Save each solved `PostFlopGame` as a `.bin` file.
- Re-load each saved file once with `load_data_from_file` to verify import compatibility.
- Write a manifest that records each attempted output.

This phase does not build the training UI, session scoring, hand playback, or a backend batch job runner. The existing web backend only needs to keep supporting import of solver `.bin` files through the current `load_data_from_file(path, None)` path.

## Architecture

Add a second Rust binary in the existing `desktop-postflop` crate:

```text
src-tauri/src/bin/training_precompute.rs
```

The CLI uses the same in-repo solver crate as the web server:

```text
desktop-postflop CLI
  reads training profile JSON
  expands profiles into flop jobs
  builds CardConfig + TreeConfig + ActionTree
  solves PostFlopGame
  save_data_to_file(...)
  load_data_from_file(...) verification
        |
        v
training-games/
  manifest.json
  <profile_id>/
    <profile_id>__flop_<cards>__pot<chips>__stack<chips>.bin
```

The web app remains a consumer of `.bin` files. It should not depend on CLI internals. The compatibility contract is the solver file format produced by:

```rust
postflop_solver::save_data_to_file(&game, memo, output_path, None)
```

and verified by:

```rust
postflop_solver::load_data_from_file::<PostFlopGame, _>(output_path, None)
```

## CLI Interface

The default command should be:

```sh
pixi run training-precompute --config training-profiles/example.json --out training-games
```

Required flags:

- `--config <path>`: JSON file containing profile definitions.
- `--out <path>`: output directory for generated `.bin` files and manifest.

Optional flags:

- `--profile <id>`: run one profile only.
- `--seed <u64>`: override profile seeds for deterministic test runs.
- `--limit <usize>`: cap total generated jobs across profiles.
- `--overwrite`: recompute files that already exist.
- `--dry-run`: validate config and print planned jobs without solving or writing `.bin` files.

`pixi.toml` should expose:

```toml
training-precompute = "RUSTFLAGS='-A dangerous_implicit_autorefs' cargo run --manifest-path src-tauri/Cargo.toml --bin training-precompute --"
```

## Profile Configuration

Profiles are fixed spot definitions. They describe the preflop situation, OOP/IP mapping, stack, pot, ranges, tree preset, board sampling, and solve target.

Example shape:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "2bp_btn_vs_bb_100bb",
      "enabled": true,
      "weight": 70,
      "spot": "BTN open vs BB call",
      "potType": "2bp",
      "oopPosition": "BB",
      "ipPosition": "BTN",
      "startingPot": 550,
      "effectiveStack": 10000,
      "rakeRate": 0.0,
      "rakeCap": 0.0,
      "oopRange": "",
      "ipRange": "",
      "treePreset": "standard_srp",
      "flopCount": 10,
      "seed": 1,
      "targetExploitability": 0.3,
      "maxIterations": 1000,
      "enableCompression": true
    }
  ]
}
```

Empty ranges are a valid configuration state for profile authoring, but they are not runnable. The CLI should mark those profiles as `missing_range` in the manifest and skip solving them. It should not substitute fake ranges.

Initial fixed profile ids:

- `2bp_btn_vs_bb_100bb`
- `2bp_co_vs_bb_100bb`
- `2bp_lj_vs_bb_100bb`
- `2bp_sb_vs_bb_100bb`
- `3bp_btn_vs_bb_100bb`
- `3bp_btn_vs_sb_100bb`
- `3bp_co_vs_btn_100bb`
- `3bp_sb_vs_bb_100bb`
- `4bp_btn_vs_bb_100bb`
- `4bp_btn_vs_sb_100bb`
- `4bp_co_vs_btn_100bb`

These profiles can ship with empty range strings first. Accurate ranges can be filled later without changing the CLI.

## Tree Presets

The CLI should start with named tree presets instead of embedding every bet-size field directly in each profile. A preset expands into the existing solver `TreeConfig` fields.

Initial presets:

- `standard_srp`: normal 2BP tree.
- `standard_3bp`: tighter 3BP tree.
- `standard_4bp`: smaller 4BP tree.

Each preset should define:

- flop bet and raise sizes for OOP/IP
- turn bet, raise, and donk sizes
- river bet, raise, and donk sizes
- add-all-in threshold
- force-all-in threshold
- merging threshold

The first implementation may use conservative built-in values copied from current app defaults. Future profile files can be extended with explicit per-profile tree settings if fixed presets become too coarse.

## Flop Sampling

Each enabled runnable profile defaults to `flopCount: 10`.

Sampling rules:

- Generate distinct three-card flops.
- Exclude impossible duplicates inside a flop.
- Sort cards into a stable filename representation.
- Use deterministic seeded randomness per profile unless `--seed` overrides it.
- Skip an output if the target `.bin` already exists and `--overwrite` is not set.

The first version samples uniformly from legal flops. Board texture weighting can be added later through profile config without changing the file import contract.

## Solve Flow

For each job:

1. Parse OOP and IP ranges.
2. Build `CardConfig` with sampled flop and undealt turn/river.
3. Expand `treePreset` into `TreeConfig`.
4. Build `ActionTree`.
5. Build `PostFlopGame`.
6. Allocate memory using the profile compression setting.
7. Run solver iterations until target exploitability is reached or `maxIterations` is hit.
8. Finalize the game.
9. Save through `save_data_to_file`.
10. Load the saved file through `load_data_from_file` and verify basic metadata.
11. Append manifest entry.

If a job fails, the CLI should record the error and continue to the next job unless the config file itself is invalid.

## Output Naming

Output files:

```text
training-games/<profile_id>/<profile_id>__flop_<flop>__pot<starting_pot>__stack<effective_stack>.bin
```

Example:

```text
training-games/2bp_btn_vs_bb_100bb/2bp_btn_vs_bb_100bb__flop_As7d2c__pot550__stack10000.bin
```

The filename uses integer chip units. Human-readable bb values belong in `manifest.json`.

## Manifest

Write a single manifest at:

```text
training-games/manifest.json
```

Manifest fields:

- `version`
- `generatedAt`
- `configPath`
- `outputDir`
- `jobs`

Each job entry:

- `profileId`
- `spot`
- `potType`
- `oopPosition`
- `ipPosition`
- `flop`
- `startingPot`
- `effectiveStack`
- `treePreset`
- `targetExploitability`
- `maxIterations`
- `iterationsCompleted`
- `finalExploitability`
- `status`: `planned`, `skipped_existing`, `missing_range`, `solved`, `failed`
- `path`
- `durationMs`
- `error`

The manifest is the durable index that future training UI can scan before selecting random games.

## Backend Import Compatibility

The generated `.bin` files are compatible when all of these hold:

- The CLI saves with `postflop_solver::save_data_to_file`.
- The web backend can load the file with `load_data_from_file(path, None)`.
- Loaded game metadata exposes the expected flop, starting pot, effective stack, and ranges.

No custom serialization format should be introduced in this phase. Metadata that is useful for training selection belongs in `manifest.json`, not inside a custom game file wrapper.

## Error Handling

The CLI should fail before solving if:

- the config JSON cannot be read or parsed
- a profile id is duplicated
- `--profile` references an unknown profile
- output directory cannot be created
- a tree preset is unknown

Per-job failures should be recorded and should not stop the whole run:

- missing range
- invalid range syntax
- impossible flop
- solver config construction error
- solver panic caught by process exit
- save failure
- import verification failure

For the first implementation, a process-level panic can terminate the run; the manifest should still be written after ordinary recoverable errors.

## Verification

Minimum verification for the feature:

- `pixi run training-precompute --config training-profiles/example.json --out /tmp/training-games --dry-run`
- `pixi run training-precompute --config training-profiles/smoke.json --out /tmp/training-games --limit 1 --overwrite`
- Confirm the smoke run writes one `.bin` and `manifest.json`.
- Confirm the smoke `.bin` loads through `load_data_from_file`.
- `pixi run server-check`

The smoke config should use one tiny valid profile with small ranges and a low iteration cap so it is fast enough for local verification.

## Non-Goals

- Training UI.
- Scoring user decisions.
- Backend-managed long-running jobs.
- Board texture weighting.
- Dynamic profile editing in the browser.
- Multiway preflop simulation.
- Storing training metadata inside `.bin` files.

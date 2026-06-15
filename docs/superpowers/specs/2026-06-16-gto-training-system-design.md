# GTO Training System Design

## Goal

Turn Desktop Postflop into a GTO training application for single-hand postflop practice. The v1 system precomputes many solved postflop games from 6-max preflop range data, stores the generated solver files outside the repo, and lets a player load random solved hands by hero position and pot type.

## Confirmed V1 Decisions

- Use the existing React and Axum web-server architecture on `dev`.
- Reuse the current uncommitted training direction: `training_precompute`, `web/training`, `TrainingPage`, and the extracted `ResultNavigator`.
- Use `origin/game` as product reference only. Do not merge or port the old Vue/Tauri implementation directly.
- Build single-hand immediate-feedback training first.
- The player chooses a hero table position and pot types.
- The system trains every hero decision in the hand.
- Villain actions are automated from the solved strategy for the sampled villain hand.
- Turn and river cards are dealt automatically at random from legal cards.
- Player actions immediately show the sampled hand's GTO frequencies and EVs.
- Do not persist training scores or hand history in v1.
- Run batch precompute from CLI, not from the web UI.
- Store source ranges and profiles in the repo.
- Store generated `.bin` solver files outside the repo.

## Scope

V1 includes:

- `training-ranges/6max` checked into the repo, copied from `/home/ronin/workspace/gto/ranges/6max_range`.
- Profile JSON files using relative range file paths instead of embedded range strings.
- CLI precompute output under an external root such as `~/workspace/gto/training-games`.
- A small external development library such as `~/workspace/gto/training-games-dev`.
- Manifest-driven training library loading.
- Backend summary and session-start APIs.
- React training page with hero-position and pot-type filters.
- Smoke precompute flow for fast development.

V1 excludes:

- Browser-triggered batch solving.
- Training score persistence.
- Long-term leak reports.
- Board texture filters.
- Profile management UI.
- Git-tracked `.bin` solver outputs.
- Direct Vue/Tauri code migration from `origin/game`.

## Architecture

The system has three layers.

1. Training source data lives in the repo. `training-ranges/6max` holds preflop action-tree range files. `training-profiles/*.json` defines training spots, stack/pot metadata, solve settings, and relative references to those range files.

2. Offline precompute is handled by the Rust CLI. It reads profiles, loads range files, samples flops, builds solver games, solves them, writes `.bin` files outside the repo, and writes a `manifest.json` beside the generated files.

3. Online training is handled by the Axum backend and React frontend. The backend reads a manifest, filters solved jobs by hero position and pot type, loads a random `.bin`, samples legal non-overlapping hero/villain hands from range weights, and places the loaded game into existing shared game state. The frontend uses existing game APIs plus `ResultNavigator` to run the hand.

## Repository Data Layout

Source data is committed:

```text
training-ranges/
  6max/
    BTN/2.5bb/BB/Call/BTN_range.txt
    BTN/2.5bb/BB/Call/BB_range.txt
    CO/2.5bb/BB/Call/CO_range.txt
    CO/2.5bb/BB/Call/BB_range.txt
    ...

training-profiles/
  6max-heads-up.json
  smoke.json
```

Generated solver data is not committed:

```text
~/workspace/gto/training-games/
  manifest.json
  2bp/
    2bp_btn_vs_bb_100bb/
      2bp_btn_vs_bb_100bb__cfg<hash>__flop_<flop>__pot550__stack10000.bin
  3bp/
  4bp/

~/workspace/gto/training-games-dev/
  manifest.json
  2bp/
    2bp_btn_vs_bb_100bb/
      ...
```

The default production training root should be outside the repo:

```text
~/workspace/gto/training-games
```

The default development root should also be outside the repo:

```text
~/workspace/gto/training-games-dev
```

## Profile Schema

Each profile defines one postflop training spot:

```json
{
  "id": "2bp_btn_vs_bb_100bb",
  "enabled": true,
  "weight": 70,
  "spot": "BTN 2.5bb open vs BB call",
  "potType": "2bp",
  "oopPosition": "BB",
  "ipPosition": "BTN",
  "startingPot": 550,
  "effectiveStack": 10000,
  "rakeRate": 0,
  "rakeCap": 0,
  "oopRangePath": "training-ranges/6max/BTN/2.5bb/BB/Call/BB_range.txt",
  "ipRangePath": "training-ranges/6max/BTN/2.5bb/BB/Call/BTN_range.txt",
  "treePreset": "standard_srp",
  "flopCount": 10,
  "seed": 101,
  "targetExploitability": 0.3,
  "maxIterations": 1000,
  "enableCompression": true
}
```

Field meanings:

- `id`: Stable unique profile id. Used in output paths, manifest entries, and debugging.
- `enabled`: Whether the CLI includes the profile.
- `weight`: Training randomization weight. Common spots get larger values than rare 4bet pots.
- `spot`: Human-readable description for UI and manifest display.
- `potType`: One of `2bp`, `3bp`, or `4bp`. Used for output grouping and UI filtering.
- `oopPosition`: Table position of the out-of-position postflop player.
- `ipPosition`: Table position of the in-position postflop player.
- `startingPot`: Pot size at the start of the postflop game, in solver chip units.
- `effectiveStack`: Remaining effective stack at the start of the postflop game, in solver chip units.
- `rakeRate`: Rake percentage used in the solver config.
- `rakeCap`: Rake cap used in the solver config.
- `oopRangePath`: Repo-relative text file containing the OOP range string.
- `ipRangePath`: Repo-relative text file containing the IP range string.
- `treePreset`: Named postflop tree preset, such as `standard_srp`, `standard_3bp`, or `standard_4bp`.
- `flopCount`: Number of distinct random flops to precompute for this profile.
- `seed`: Deterministic random seed for flop sampling.
- `targetExploitability`: Solve target for early stopping.
- `maxIterations`: Maximum solver iterations for the job.
- `enableCompression`: Whether the solver uses compressed storage.

`effectiveStack` means the remaining stack entering the flop, not the initial 100bb stack before preflop action.

## Manifest Schema

Each training library root contains one manifest:

```text
~/workspace/gto/training-games/manifest.json
```

The manifest indexes every attempted job. Each job includes:

- `profileId`
- `profileWeight`
- `spot`
- `potType`
- `oopPosition`
- `ipPosition`
- `flop`
- `startingPot`
- `effectiveStack`
- `treePreset`
- `oopRangePath`
- `ipRangePath`
- `profileFingerprint`
- `rangeFingerprint`
- `targetExploitability`
- `maxIterations`
- `iterationsCompleted`
- `finalExploitability`
- `status`
- `path`
- `durationMs`
- `error`

`path` should be relative to the output root when possible, for example:

```text
2bp/2bp_btn_vs_bb_100bb/2bp_btn_vs_bb_100bb__cfg<hash>__flop_As7d2c__pot550__stack10000.bin
```

This keeps the training library movable. The backend resolves relative job paths against the manifest root.

`profileFingerprint` is derived from solver-relevant profile fields. `rangeFingerprint` is derived from the OOP and IP range file contents. These fingerprints prevent accidentally reusing stale solver outputs after profile or range changes.

Job statuses:

- `planned`
- `skipped_existing`
- `missing_range`
- `solved`
- `failed`

## CLI Precompute Flow

Primary command:

```bash
pixi run training-precompute \
  --config training-profiles/6max-heads-up.json \
  --out ~/workspace/gto/training-games
```

Development smoke command:

```bash
pixi run training-precompute \
  --config training-profiles/smoke.json \
  --out ~/workspace/gto/training-games-dev \
  --limit 2 \
  --overwrite
```

The CLI flow:

1. Read and parse the profile JSON.
2. Validate profile ids, enabled state, positions, pot types, stack/pot values, range paths, tree preset names, and range parsability.
3. Generate a deterministic list of distinct flops per enabled profile.
4. Build output paths under `<out>/<potType>/<profileId>/`.
5. Compute profile and range fingerprints.
6. Skip existing jobs unless `--overwrite` is set.
7. Build `CardConfig`, `TreeConfig`, `ActionTree`, and `PostFlopGame`.
8. Allocate memory using `enableCompression`.
9. Solve until `targetExploitability` or `maxIterations`.
10. Finalize and save through `postflop_solver::save_data_to_file`.
11. Reload the saved file through `postflop_solver::load_data_from_file`.
12. Verify loaded flop, starting pot, effective stack, and non-empty ranges.
13. Update `manifest.json` after each completed or failed job.

Single-job failures should be recorded in the manifest and should not stop the rest of the run. Global config errors, duplicate profile ids, invalid JSON, and unreadable profile files should stop the command.

## Backend Training API

The backend adds training endpoints while keeping existing game endpoints unchanged.

### `POST /api/training/library/summary`

Request:

```json
{
  "root": "~/workspace/gto/training-games"
}
```

Response includes:

- resolved training root
- manifest metadata
- solved job count
- counts by hero position
- counts by pot type
- counts by profile id
- validation errors for missing files or malformed entries

The Training page calls this on load and when the user reloads the library.

### `POST /api/training/session/start`

Request:

```json
{
  "root": "~/workspace/gto/training-games",
  "heroPosition": "BTN",
  "potTypes": ["2bp", "3bp"]
}
```

Flow:

1. Read `manifest.json`.
2. Keep `status=solved` jobs whose `.bin` file exists.
3. Filter jobs where `oopPosition` or `ipPosition` equals `heroPosition`.
4. Filter by selected `potTypes`.
5. Choose a profile using `profileWeight`.
6. Choose a solved flop job within that profile.
7. Load the `.bin` file into shared game state.
8. Determine whether hero is `oop` or `ip`.
9. Sample a non-overlapping hero/villain hand pair from solver range weights.
10. Return session metadata and sampled hands.

The backend does not persist session state. After session start, the frontend continues using existing game endpoints for navigation, results, legal actions, possible cards, and chance reports.

Error handling:

- Missing manifest returns a clear error telling the user to run the CLI.
- No matching solved jobs returns 404 with available library counts.
- Missing `.bin` files are reported by summary and skipped by session start.
- Failed hand sampling retries other candidate jobs. If all candidates fail, the API returns a clear error.

## Frontend Training Experience

The Training route is `/training`.

Top controls:

- Training library root input.
- Reload button.
- Hero position selector: `UTG`, `MP`, `CO`, `BTN`, `SB`, `BB`.
- Pot type toggles: `2BP`, `3BP`, `4BP`.
- New Hand button.

Main training area:

- `ResultNavigator` displays the current action path.
- Session panel shows pot type, spot, hero/villain positions, current board, hero hand, pot, and stack.
- Villain hand remains hidden until terminal.
- Action panel shows buttons only for hero decisions.
- Non-hero states show acting/dealing status.

Automation:

- Villain player nodes are played automatically from the sampled villain hand's strategy frequencies.
- Chance nodes deal a random legal turn or river card.
- Hero player nodes wait for user input.
- If a strategy row is unusable, the UI falls back to a random legal action and continues.

Feedback:

- After each hero action, the UI immediately records a decision entry.
- Each entry includes board, hero hand, chosen action, each legal action's GTO frequency, and each legal action's EV.
- The latest decision appears prominently.
- The current hand's decision log stays visible in the sidebar.
- Nothing is persisted after leaving or starting a new hand.

Terminal:

- At terminal, villain hand becomes visible.
- Next Hand starts a new random session with the same filters.

## Testing And Verification

Automated verification:

```bash
pixi run lint
pixi run frontend-build
pixi run server-check
pixi run training-precompute --config training-profiles/smoke.json --out ~/workspace/gto/training-games-dev --overwrite
```

Manual verification:

1. Start the backend and frontend.
2. Open `/training`.
3. Load `~/workspace/gto/training-games-dev`.
4. Select hero `BTN`.
5. Select `2BP`.
6. Start a new hand.
7. Confirm hero hand, flop, pot, and stack render.
8. Confirm villain actions and chance cards progress automatically.
9. Click a hero action.
10. Confirm frequencies and EVs appear immediately.
11. Reach terminal.
12. Confirm villain hand is revealed.
13. Click Next Hand and confirm another hand starts.

## Risks And Mitigations

- Range path migration can break profiles. The CLI must validate every range path and report the profile id and missing path.
- Old `.bin` files can be reused after solver inputs change. Output names and manifest entries include fingerprints.
- Large solver files can bloat the repo. `.bin` files are stored outside the repo and should remain ignored.
- Strategy data can be empty for rare states. The frontend should fall back to random legal actions and keep the session alive.
- Navigation logic is complex. V1 reuses `ResultNavigator` instead of rewriting a training-specific state machine.

## Success Criteria

The v1 system is successful when a developer can:

1. Commit source ranges and path-based profiles.
2. Generate a small external smoke training library.
3. Load that library from `/training`.
4. Start a random hand by hero position and pot type.
5. Play every hero decision while villain and chance nodes automate.
6. See immediate GTO frequency and EV feedback after each hero action.
7. Start the next hand without restarting the app.

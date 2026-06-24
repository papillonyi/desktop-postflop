# Preflop TUI Design

## Goal

Add a standalone terminal version of the existing preflop range drill.

## Scope

The first version is a line-mode Rust binary. It reads the checked-in
`training-ranges/6max` tree directly and reuses the existing preflop drill
logic. It does not add a full-screen terminal UI, scoring, persistence, or a
dependency on the local web server.

## Behavior

- Run with `pixi run preflop-tui`.
- Start at the UTG preflop drill node, matching the web drill.
- Show the current actor, node path, reach range, and numbered actions.
- For each action, show its approximate frequency and whether it is inferred.
- Accept a number to choose an action.
- Accept `q`, `quit`, or EOF to exit.
- After each action, show the selected action and advance to the next available
  decision node.
- When no next node exists, print that the hand is complete and exit.

## Architecture

Reuse the existing Rust preflop module instead of duplicating range parsing.
Expose a tiny synchronous wrapper from `src-tauri/src/web/preflop.rs` that can
start a drill and advance it without Axum request/response types. Add
`src-tauri/src/bin/preflop_tui.rs` as the only new executable surface.

The TUI uses `std::io` for prompts and output. No `ratatui`, `crossterm`, or
Node/Python wrapper is needed for this version.

## Error Handling

Range load and invalid-action errors print to stderr and exit non-zero. Invalid
number input prints a short message and re-prompts at the same node. EOF exits
cleanly.

## Testing

Add one Rust unit test for the public preflop wrapper using a temporary range
tree. Verify with:

- `pixi run cargo test --manifest-path src-tauri/Cargo.toml preflop`
- `pixi run cargo-check`

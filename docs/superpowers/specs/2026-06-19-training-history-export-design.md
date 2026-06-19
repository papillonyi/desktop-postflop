# Training History Export Design

## Goal

Add a postflop training hand history download that records the hand context and GTO decisions, and fix the active training pot display so it includes bets after the flop.

## Scope

The feature applies to the postflop Training page. It does not change preflop training, backend APIs, saved training scores, or the Results page.

## Behavior

- At game over, show a `Download History` button under the replay buttons.
- Clicking the button downloads a JSON file.
- The JSON includes export metadata, session metadata, board/current board, hero and villain positions/cards, starting pot, effective stack, live pot, current action history, and sorted hero/villain decision logs.
- Each decision includes the actor, position, hand cards, board at decision time, chosen action, and all available action probabilities and EVs.
- The Training page pot summary uses the selected navigator spot's live pot when available, including postflop bets. It falls back to `session.startingPot` before navigator data is ready.

## Architecture

Keep this frontend-only. Add a pure TypeScript export builder beside `TrainingPage.tsx`, then keep DOM download mechanics in `TrainingPage.tsx`. Use existing `ResultNavigator` update data for live pot and current history.

## Testing

There is no frontend test runner in the repo. Add a small Node-compatible TypeScript test for the export builder, compile it to `/tmp`, and run it with Node's built-in test runner. Also run `pixi run lint` and `pixi run frontend-build`.

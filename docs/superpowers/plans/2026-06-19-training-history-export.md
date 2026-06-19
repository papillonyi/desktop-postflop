# Training History Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON hand history download to postflop training and show the live pot including postflop bets.

**Architecture:** Keep the feature frontend-only. Put the export payload builder in a small pure module, wire the browser download in `TrainingPage.tsx`, and read live pot values from the existing `ResultNavigator` update.

**Tech Stack:** React 19, TypeScript, Tailwind, Heroicons, Node built-in test runner, Pixi task runner.

---

## File Structure

- Create: `src/features/training/trainingHistoryExport.ts` - pure JSON payload types and builder.
- Create: `src/features/training/trainingHistoryExport.test.ts` - Node-compatible unit test for export payload shape.
- Modify: `src/features/training/TrainingPage.tsx` - add download button, generate JSON file, and show live pot.

## Task 1: Export Payload Builder

- [ ] Write a failing test in `src/features/training/trainingHistoryExport.test.ts` that builds a mock session, one hero decision, one villain decision, live pot, current board, and current history, then asserts sorted decisions, chosen action, live pot, and filename-safe fields.
- [ ] Compile and run the test with `npx tsc --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM --outDir /tmp/desktop-postflop-export-test src/features/training/trainingHistoryExport.test.ts` and `node --test /tmp/desktop-postflop-export-test/features/training/trainingHistoryExport.test.js`; expect failure because the builder module does not exist.
- [ ] Create `trainingHistoryExport.ts` with exported `TrainingHistoryDecision`, `TrainingHistoryExportInput`, `TrainingHistoryExportPayload`, `buildTrainingHistoryExport`, and `trainingHistoryFilename`.
- [ ] Re-run the targeted compile/test command; expect pass.

## Task 2: Training Page Wiring

- [ ] Import `ArrowDownTrayIcon`, the export helper, and export decision type in `TrainingPage.tsx`.
- [ ] Reuse the helper's decision type for existing `DecisionReview` data.
- [ ] Add `handleDownloadHistory` that builds the payload from `session`, `navigatorUpdate`, `currentHistory()`, `decisionLog`, and `villainDecisionLog`, then downloads formatted JSON with a blob URL.
- [ ] Render `Download History` under `New Cards` only when `terminal` is true.
- [ ] Change the summary pot display to use `navigatorUpdate.selectedSpot.pot` when present, falling back to `session.startingPot`.
- [ ] Remove `showPotWithoutBets` from the Training page `ResultNavigator` so navigator spot pots include live bets.

## Task 3: Verification

- [ ] Run the targeted export test.
- [ ] Run `pixi run lint`.
- [ ] Run `pixi run frontend-build`.
- [ ] Inspect `git diff` to confirm only scoped files changed.

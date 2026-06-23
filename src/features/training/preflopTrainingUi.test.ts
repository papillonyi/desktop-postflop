import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreflopTimelineEntries,
  buildRangePaneEntries,
  frequencyFillPercent,
} from "./preflopTrainingUi.js";

test("frequencyFillPercent maps frequencies to vertical fill percentages", () => {
  assert.equal(frequencyFillPercent(0.5), "50%");
  assert.equal(frequencyFillPercent(0.3), "30%");
  assert.equal(frequencyFillPercent(0.333), "33.3%");
  assert.equal(frequencyFillPercent(-1), "0%");
  assert.equal(frequencyFillPercent(2), "100%");
  assert.equal(frequencyFillPercent(Number.NaN), "0%");
});

test("buildPreflopTimelineEntries keeps history before current decision", () => {
  const entries = buildPreflopTimelineEntries(
    [
      { actor: "UTG", action: "2.5bb" },
      { actor: "MP", action: "Fold" },
    ],
    "CO"
  );

  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.actor, entry.action]),
    [
      ["history", "UTG", "2.5bb"],
      ["history", "MP", "Fold"],
      ["current", "CO", null],
    ]
  );
});

test("buildPreflopTimelineEntries appends terminal row after completion", () => {
  const entries = buildPreflopTimelineEntries(
    [
      { actor: "UTG", action: "2.5bb" },
      { actor: "BB", action: "Fold" },
    ],
    null,
    true
  );

  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.actor, entry.action]),
    [
      ["history", "UTG", "2.5bb"],
      ["history", "BB", "Fold"],
      ["terminal", "Terminal", "Complete"],
    ]
  );
});

test("buildRangePaneEntries puts current range before history ranges", () => {
  const entries = buildRangePaneEntries(
    {
      actor: "CO",
      action: "8.5bb",
      frequency: 0.3,
      range: "AA:1",
      rangeSource: "direct",
      reachRange: "AA:1 KK:1",
    },
    [
      {
        actor: "UTG",
        action: "2.5bb",
        range: "KK:1",
        rangeSource: "derived",
        reachRange: null,
      },
    ]
  );

  assert.deepEqual(
    entries.map((entry) => [
      entry.kind,
      entry.title,
      entry.subtitle,
      entry.range,
      entry.rangeSource,
      entry.reachRange,
    ]),
    [
      ["current", "CO 8.5bb", "30% of reachable hands", "AA:1", "direct", "AA:1 KK:1"],
      ["history", "UTG 2.5bb", "Step 1", "KK:1", "derived", null],
    ]
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildVillainActionRange } from "./villainActionRange.js";

const pack = (card1: number, card2: number) => card1 | (card2 << 8);
const card = (rank: number, suit: number) => rank * 4 + suit;

test("buildVillainActionRange weights villain combos into a 13x13 range matrix", () => {
  const acAd = pack(card(12, 0), card(12, 1));
  const kcKd = pack(card(11, 0), card(11, 1));
  const qcQd = pack(card(10, 0), card(10, 1));

  const range = buildVillainActionRange({
    actionIndex: 1,
    cards: [[acAd, kcKd, qcQd], []],
    player: "oop",
    results: {
      normalizer: [[1, 1, 0], []],
      strategy: [0.25, 0.6, 1, 0.75, 0.4, 1],
      weights: [[1, 0.5, 1], []],
    },
  });

  assert.equal(range.totalWeight, 0.95);
  assert.deepEqual(
    range.cells.map((cell) => [cell.handClass, cell.weight, cell.comboCount]),
    [
      ["AA", 0.75, 1],
      ["KK", 0.2, 1],
    ]
  );
  assert.equal("rows" in range, false);
  assert.equal("topCombos" in range, false);
});

test("buildVillainActionRange records suit-specific combos for a hand class", () => {
  const acQc = pack(card(12, 0), card(10, 0));
  const adQd = pack(card(12, 1), card(10, 1));
  const ahQh = pack(card(12, 2), card(10, 2));
  const asQs = pack(card(12, 3), card(10, 3));

  const range = buildVillainActionRange({
    actionIndex: 0,
    cards: [[acQc, adQd, ahQh, asQs], []],
    player: "oop",
    results: {
      normalizer: [[1, 1, 1, 1], []],
      strategy: [1, 0.5, 0, 0.25],
      weights: [[1, 1, 1, 1], []],
    },
  });

  assert.equal(range.totalWeight, 1.75);
  assert.deepEqual(
    range.cells.map((cell) => [
      cell.handClass,
      cell.weight,
      cell.comboCount,
      cell.combos.map((combo) => [combo.label, combo.weight]),
    ]),
    [
      [
        "AQs",
        1.75,
        3,
        [
          ["AcQc", 1],
          ["AdQd", 0.5],
          ["AsQs", 0.25],
        ],
      ],
    ]
  );
});

test("buildVillainActionRange returns an empty summary when action has no range weight", () => {
  const acAd = pack(card(12, 0), card(12, 1));

  const range = buildVillainActionRange({
    actionIndex: 0,
    cards: [[acAd], []],
    player: "oop",
    results: {
      normalizer: [[1], []],
      strategy: [0],
      weights: [[1], []],
    },
  });

  assert.equal(range.totalWeight, 0);
  assert.deepEqual(range.cells, []);
  assert.equal("rows" in range, false);
  assert.equal("topCombos" in range, false);
});

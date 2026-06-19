import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrainingHistoryExport,
  trainingHistoryFilename,
  type TrainingHistoryDecision,
} from "./trainingHistoryExport.js";

const session = {
  root: "../training-games-formal",
  profileId: "2bp_btn_vs_bb",
  profileWeight: 70,
  stackWeight: 100,
  spot: "BTN open vs BB call",
  potType: "2bp",
  oopPosition: "BB",
  ipPosition: "BTN",
  board: [0, 48, 45],
  startingPot: 6,
  effectiveStack: 100,
  heroPosition: "BTN",
  villainPosition: "BB",
  heroPlayer: "ip",
  villainPlayer: "oop",
  heroHand: {
    packed: 100,
    index: 7,
    cards: [7, 11],
  },
  villainHand: {
    packed: 200,
    index: 12,
    cards: [32, 36],
  },
  path: "../training-games-formal/2bp/btn-vs-bb.bin",
};

const heroDecision: TrainingHistoryDecision = {
  actionLabel: "Bet 4",
  actor: "hero",
  actions: [
    {
      actionIndex: 0,
      amount: "0",
      ev: 1.25,
      isChosen: false,
      name: "Check",
      probability: 0.25,
    },
    {
      actionIndex: 1,
      amount: "4",
      ev: 1.75,
      isChosen: true,
      name: "Bet",
      probability: 0.75,
    },
  ],
  board: [0, 48, 45],
  handCards: [7, 11],
  order: 1,
  position: "BTN",
  spot: "BTN open vs BB call",
};

const villainDecision: TrainingHistoryDecision = {
  ...heroDecision,
  actionLabel: "Call",
  actor: "villain",
  handCards: [32, 36],
  order: 0,
  position: "BB",
};

test("buildTrainingHistoryExport records session context and sorted GTO decisions", () => {
  const payload = buildTrainingHistoryExport({
    currentBoard: [0, 48, 45, 18],
    currentHistory: [1, 0, 31],
    exportedAt: "2026-06-19T12:00:00.000Z",
    heroDecisions: [heroDecision],
    livePot: 14,
    session,
    villainDecisions: [villainDecision],
  });

  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, "2026-06-19T12:00:00.000Z");
  assert.deepEqual(payload.board.current, ["2c", "Ac", "Kd", "6h"]);
  assert.equal(payload.pot.live, 14);
  assert.equal(payload.pot.starting, 6);
  assert.deepEqual(payload.history, [1, 0, 31]);
  assert.deepEqual(payload.hero.cards, ["3s", "4s"]);
  assert.deepEqual(payload.villain.cards, ["Tc", "Jc"]);

  assert.equal(payload.decisions.length, 2);
  assert.equal(payload.decisions[0].actor, "villain");
  assert.equal(payload.decisions[0].chosenAction?.label, "Call");
  assert.equal(payload.decisions[1].actor, "hero");
  assert.equal(payload.decisions[1].chosenAction?.label, "Bet 4");
  assert.equal(payload.decisions[1].actions[1].probability, 0.75);
  assert.equal(payload.decisions[1].actions[1].ev, 1.75);

  assert.equal(
    trainingHistoryFilename(payload),
    "training-history-2bp-btn-open-vs-bb-call-2026-06-19T12-00-00-000Z.json"
  );
});

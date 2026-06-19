const ranks = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
];
const suitLetters = ["c", "d", "h", "s"];

export type TrainingHistoryAction = {
  actionIndex: number;
  amount: string;
  ev: number;
  isChosen: boolean;
  name: string;
  probability: number;
};

export type TrainingHistoryDecision = {
  actionLabel: string;
  actor: "hero" | "villain";
  actions: TrainingHistoryAction[];
  board: number[];
  handCards: number[];
  order: number;
  position: string;
  spot: string;
};

type TrainingHistorySession = {
  root: string;
  profileId: string;
  profileWeight: number;
  stackWeight: number;
  spot: string;
  potType: string;
  oopPosition: string;
  ipPosition: string;
  board: number[];
  startingPot: number;
  effectiveStack: number;
  heroPosition: string;
  villainPosition: string;
  heroPlayer: string;
  villainPlayer: string;
  heroHand: {
    packed: number;
    index: number;
    cards: number[];
  };
  villainHand: {
    packed: number;
    index: number;
    cards: number[];
  };
  path: string;
};

export type TrainingHistoryExportInput = {
  currentBoard: number[];
  currentHistory: number[];
  exportedAt?: string;
  heroDecisions: TrainingHistoryDecision[];
  livePot: number | null;
  session: TrainingHistorySession;
  villainDecisions: TrainingHistoryDecision[];
};

export type TrainingHistoryExportPayload = {
  version: 1;
  exportedAt: string;
  session: {
    root: string;
    path: string;
    profileId: string;
    profileWeight: number;
    stackWeight: number;
    spot: string;
    potType: string;
    players: {
      oop: string;
      ip: string;
      hero: string;
      villain: string;
    };
  };
  board: {
    starting: string[];
    current: string[];
  };
  pot: {
    starting: number;
    live: number;
  };
  stack: {
    effective: number;
  };
  hero: {
    player: string;
    position: string;
    handIndex: number;
    packedHand: number;
    cards: string[];
  };
  villain: {
    player: string;
    position: string;
    handIndex: number;
    packedHand: number;
    cards: string[];
  };
  history: number[];
  decisions: {
    actionLabel: string;
    actions: {
      actionIndex: number;
      amount: string;
      ev: number | null;
      isChosen: boolean;
      label: string;
      name: string;
      probability: number;
    }[];
    actor: "hero" | "villain";
    board: string[];
    chosenAction: {
      actionIndex: number;
      amount: string;
      ev: number | null;
      label: string;
      name: string;
      probability: number;
    } | null;
    handCards: string[];
    order: number;
    position: string;
    spot: string;
  }[];
};

function cardString(card: number) {
  return `${ranks[card >>> 2] ?? "?"}${suitLetters[card & 3] ?? "?"}`;
}

function cardStrings(cards: number[]) {
  return cards.map(cardString);
}

function actionLabel(action: { name: string; amount: string }) {
  return action.amount === "0"
    ? action.name
    : `${action.name} ${action.amount}`;
}

function finiteOrNull(value: number) {
  return Number.isFinite(value) ? value : null;
}

function normalizeDecision(decision: TrainingHistoryDecision) {
  const actions = decision.actions.map((action) => ({
    actionIndex: action.actionIndex,
    amount: action.amount,
    ev: finiteOrNull(action.ev),
    isChosen: action.isChosen,
    label: actionLabel(action),
    name: action.name,
    probability: Number.isFinite(action.probability) ? action.probability : 0,
  }));
  const chosenAction = actions.find((action) => action.isChosen) ?? null;

  return {
    actionLabel: decision.actionLabel,
    actions,
    actor: decision.actor,
    board: cardStrings(decision.board),
    chosenAction: chosenAction
      ? {
          actionIndex: chosenAction.actionIndex,
          amount: chosenAction.amount,
          ev: chosenAction.ev,
          label: decision.actionLabel,
          name: chosenAction.name,
          probability: chosenAction.probability,
        }
      : null,
    handCards: cardStrings(decision.handCards),
    order: decision.order,
    position: decision.position,
    spot: decision.spot,
  };
}

export function buildTrainingHistoryExport({
  currentBoard,
  currentHistory,
  exportedAt = new Date().toISOString(),
  heroDecisions,
  livePot,
  session,
  villainDecisions,
}: TrainingHistoryExportInput): TrainingHistoryExportPayload {
  return {
    version: 1,
    exportedAt,
    session: {
      root: session.root,
      path: session.path,
      profileId: session.profileId,
      profileWeight: session.profileWeight,
      stackWeight: session.stackWeight,
      spot: session.spot,
      potType: session.potType,
      players: {
        oop: session.oopPosition,
        ip: session.ipPosition,
        hero: session.heroPosition,
        villain: session.villainPosition,
      },
    },
    board: {
      starting: cardStrings(session.board),
      current: cardStrings(currentBoard),
    },
    pot: {
      starting: session.startingPot,
      live: livePot ?? session.startingPot,
    },
    stack: {
      effective: session.effectiveStack,
    },
    hero: {
      player: session.heroPlayer,
      position: session.heroPosition,
      handIndex: session.heroHand.index,
      packedHand: session.heroHand.packed,
      cards: cardStrings(session.heroHand.cards),
    },
    villain: {
      player: session.villainPlayer,
      position: session.villainPosition,
      handIndex: session.villainHand.index,
      packedHand: session.villainHand.packed,
      cards: cardStrings(session.villainHand.cards),
    },
    history: [...currentHistory],
    decisions: [...heroDecisions, ...villainDecisions]
      .sort((a, b) => a.order - b.order)
      .map(normalizeDecision),
  };
}

export function trainingHistoryFilename(payload: TrainingHistoryExportPayload) {
  const spot = payload.session.spot
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const exportedAt = payload.exportedAt.replace(/[^0-9A-Za-z]+/g, "-");
  return `training-history-${payload.session.potType}-${spot}-${exportedAt}.json`;
}

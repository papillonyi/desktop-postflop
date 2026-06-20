export type TrainingRangePlayer = "oop" | "ip";

type SolverResultsForRange = {
  normalizer: number[][];
  strategy: number[];
  weights: number[][];
};

export type VillainActionRangeCombo = {
  cards: [number, number];
  label: string;
  weight: number;
};

export type VillainActionRangeCell = {
  col: number;
  combos: VillainActionRangeCombo[];
  comboCount: number;
  handClass: string;
  maxComboWeight: number;
  row: number;
  weight: number;
};

export type VillainActionRangeSummary = {
  cells: VillainActionRangeCell[];
  totalWeight: number;
};

export function villainRangeCellKey(
  cell: Pick<VillainActionRangeCell, "col" | "row">
) {
  return `${cell.row}:${cell.col}`;
}

export function findVillainRangeCell(
  range: VillainActionRangeSummary | null | undefined,
  key: string | null | undefined
) {
  if (!range || !key) return null;
  return range.cells.find((cell) => villainRangeCellKey(cell) === key) ?? null;
}

const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const suitLetters = ["c", "d", "h", "s"];

function playerIndex(player: TrainingRangePlayer) {
  return player === "oop" ? 0 : 1;
}

function roundRangeWeight(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function unpackPrivateCards(packed: number) {
  const card1 = packed & 0xff;
  const card2 = packed >>> 8;
  return card2 === 0xff ? [card1] : [card1, card2];
}

function handClass(cards: number[]) {
  if (cards.length < 2) return "";
  const [card1, card2] = cards;
  const rank1 = card1 >>> 2;
  const rank2 = card2 >>> 2;
  const highRank = Math.max(rank1, rank2);
  const lowRank = Math.min(rank1, rank2);
  if (highRank === lowRank) return `${ranks[highRank]}${ranks[lowRank]}`;
  return `${ranks[highRank]}${ranks[lowRank]}${
    (card1 & 3) === (card2 & 3) ? "s" : "o"
  }`;
}

function orderedPrivateCards(cards: number[]): [number, number] {
  const sorted = [...cards].sort(
    (a, b) => (b >>> 2) - (a >>> 2) || (a & 3) - (b & 3)
  );
  return [sorted[0], sorted[1]];
}

function cardLabel(card: number) {
  return `${ranks[card >>> 2]}${suitLetters[card & 3]}`;
}

function comboLabel(cards: number[]) {
  const [card1, card2] = orderedPrivateCards(cards);
  return `${cardLabel(card1)}${cardLabel(card2)}`;
}

function cardPairCellIndex(card1: number, card2: number) {
  if (card1 > card2) [card1, card2] = [card2, card1];
  const highRank = card2 >>> 2;
  const lowRank = card1 >>> 2;
  const highSuit = card2 & 3;
  const lowSuit = card1 & 3;
  const isSuited = highSuit === lowSuit;
  return {
    row: 12 - (isSuited ? highRank : lowRank),
    col: 12 - (isSuited ? lowRank : highRank),
  };
}

export function buildVillainActionRange({
  actionIndex,
  cards,
  player,
  results,
}: {
  actionIndex: number;
  cards: number[][];
  player: TrainingRangePlayer;
  results: SolverResultsForRange;
}): VillainActionRangeSummary {
  const index = playerIndex(player);
  const playerCards = cards[index] ?? [];
  const playerWeights = results.weights[index] ?? [];
  const normalizer = results.normalizer[index] ?? [];
  const cellMap = new Map<string, VillainActionRangeCell>();
  let totalWeight = 0;

  for (let handIndex = 0; handIndex < playerCards.length; ++handIndex) {
    const baseWeight = playerWeights[handIndex] ?? 0;
    const normalizerWeight = normalizer[handIndex] ?? 0;
    const actionProbability =
      results.strategy[actionIndex * playerCards.length + handIndex] ?? 0;
    const weight = roundRangeWeight(baseWeight * actionProbability);
    if (
      !Number.isFinite(weight) ||
      !Number.isFinite(baseWeight) ||
      !Number.isFinite(normalizerWeight) ||
      !Number.isFinite(actionProbability) ||
      weight <= 0 ||
      baseWeight <= 0 ||
      normalizerWeight <= 0 ||
      actionProbability <= 0
    ) {
      continue;
    }

    const unpackedCards = unpackPrivateCards(playerCards[handIndex]);
    if (unpackedCards.length < 2) continue;

    const currentHandClass = handClass(unpackedCards);
    const { row, col } = cardPairCellIndex(unpackedCards[0], unpackedCards[1]);
    const currentCombo = {
      cards: orderedPrivateCards(unpackedCards),
      label: comboLabel(unpackedCards),
      weight,
    };
    const key = `${row}:${col}`;
    const currentCell = cellMap.get(key);
    if (currentCell) {
      currentCell.weight = roundRangeWeight(currentCell.weight + weight);
      currentCell.comboCount += 1;
      currentCell.maxComboWeight = Math.max(currentCell.maxComboWeight, weight);
      currentCell.combos.push(currentCombo);
    } else {
      cellMap.set(key, {
        col,
        combos: [currentCombo],
        comboCount: 1,
        handClass: currentHandClass,
        maxComboWeight: weight,
        row,
        weight,
      });
    }

    totalWeight = roundRangeWeight(totalWeight + weight);
  }

  return {
    cells: [...cellMap.values()]
      .map((cell) => ({
        ...cell,
        combos: [...cell.combos].sort(
          (a, b) => b.weight - a.weight || a.label.localeCompare(b.label)
        ),
      }))
      .sort((a, b) => b.weight - a.weight),
    totalWeight,
  };
}

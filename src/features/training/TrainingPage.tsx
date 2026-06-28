import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChartBarIcon,
  PlayIcon,
  UserIcon,
} from "@heroicons/react/24/solid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import {
  setSolverFinished,
  setTrainingResult,
  setTrainingResultHistory,
} from "../../app/slices/appSlice";
import { setConfig } from "../../app/slices/configSlice";
import * as invokes from "../../invokes";
import type {
  TrainingLibrarySummary,
  TrainingPlayer,
  TrainingPosition,
  TrainingPotType,
  TrainingSession,
} from "../../invokes";
import type { Results, SpotPlayer } from "../../result-types";
import { BoardCard } from "../../shared/components/BoardCard";
import { cardText, toFixed1, toFixed2 } from "../../utils";
import {
  ResultNavigator,
  type ResultNavigationUpdate,
  type ResultNavigatorHandle,
} from "../results/ResultNavigator";
import { PreflopTrainingPanel } from "./PreflopTrainingPanel";
import {
  buildTrainingHistoryExport,
  replaceDecisionAtHistoryIndex,
  selectCurrentTrainingHistory,
  trainingHistoryFilename,
  type TrainingHistoryDecision,
} from "./trainingHistoryExport";
import {
  buildVillainActionRange,
  findVillainRangeCell,
  villainRangeCellKey,
  type VillainActionRangeCell,
  type VillainActionRangeSummary,
} from "./villainActionRange";

const positions: TrainingPosition[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
const potTypes: TrainingPotType[] = ["2bp", "3bp", "4bp"];

type ActionDetail = {
  actionIndex: number;
  amount: string;
  ev: number;
  isChosen: boolean;
  name: string;
  probability: number;
};

type DecisionReview = TrainingHistoryDecision & {
  villainActionRange?: VillainActionRangeSummary;
};

type PostflopTrainingSnapshot = {
  cards: number[][];
  currentHistory: number[];
  decisionLog: DecisionReview[];
  enabledPotTypes: TrainingPotType[];
  heroPosition: TrainingPosition;
  lastReview: DecisionReview | null;
  root: string;
  session: TrainingSession | null;
  showVillainDecisionLog: boolean;
  summary: TrainingLibrarySummary | null;
  trainingMode: "postflop" | "preflop";
  villainDecisionLog: DecisionReview[];
};

let postflopTrainingSnapshot: PostflopTrainingSnapshot | null = null;

function playerIndex(player: TrainingPlayer) {
  return player === "oop" ? 0 : 1;
}

function actionLabel(action: { name: string; amount: string }) {
  return action.amount === "0"
    ? action.name
    : `${action.name} ${action.amount}`;
}

function formatHand(cards: number[]) {
  return cards
    .map((card) => {
      const text = cardText(card);
      return `${text.rank}${text.suit}`;
    })
    .join(" ");
}

function formatBoard(board: number[]) {
  return board.length ? formatHand(board) : "-";
}

function formatProbability(value: number) {
  return `${toFixed1((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function formatEv(value: number) {
  return Number.isFinite(value) ? toFixed2(value) : "-";
}

function formatRangeWeight(value: number) {
  return Number.isFinite(value) ? toFixed2(value) : "-";
}

function exactActionDetails(
  results: Results,
  cards: number[][],
  player: TrainingPlayer,
  handIndex: number,
  actions: SpotPlayer["actions"],
  chosenIndex = -1
): ActionDetail[] {
  const index = playerIndex(player);
  const handCount = cards[index]?.length ?? 0;
  return actions.map((action, actionIndex) => {
    const resultIndex = actionIndex * handCount + handIndex;
    return {
      actionIndex,
      amount: action.amount,
      ev: results.actionEv[resultIndex] ?? Number.NaN,
      isChosen: actionIndex === chosenIndex,
      name: action.name,
      probability: results.strategy[resultIndex] ?? 0,
    };
  });
}

function chooseWeightedIndex(values: number[]) {
  const total = values.reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0
  );
  if (total <= 0) {
    return Math.floor(Math.random() * values.length);
  }

  let ticket = Math.random() * total;
  for (let index = 0; index < values.length; ++index) {
    const value =
      Number.isFinite(values[index]) && values[index] > 0 ? values[index] : 0;
    if (ticket <= value) return index;
    ticket -= value;
  }
  return values.length - 1;
}

function cardList(cards: number[]) {
  return (
    <div className="flex gap-1">
      {cards.map((card) => (
        <BoardCard cardId={card} className="h-14 w-10" key={card} />
      ))}
    </div>
  );
}

const rangeRanks = [
  "A",
  "K",
  "Q",
  "J",
  "T",
  "9",
  "8",
  "7",
  "6",
  "5",
  "4",
  "3",
  "2",
];

function matrixHandClass(row: number, col: number) {
  if (row === col) return `${rangeRanks[row]}${rangeRanks[col]}`;
  if (row < col) return `${rangeRanks[row]}${rangeRanks[col]}s`;
  return `${rangeRanks[col]}${rangeRanks[row]}o`;
}

function comboCardList(cards: [number, number]) {
  return (
    <span className="flex items-center gap-1">
      {cards.map((card) => {
        const text = cardText(card);
        return (
          <span className={text.colorClass} key={card}>
            {text.rank}
            {text.suit}
          </span>
        );
      })}
    </span>
  );
}

function SessionBoardInfoCard({
  board,
  heroHand,
  session,
  terminal,
  villainHand,
}: {
  board: number[];
  heroHand: number[];
  session: TrainingSession;
  terminal: boolean;
  villainHand: number[];
}) {
  return (
    <div className="h-full rounded border border-gray-300 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-500">Board info</div>
          <div className="mt-1 text-lg font-semibold">
            {session.potType.toUpperCase()} · {session.spot}
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-600">
            {session.heroPosition} vs {session.villainPosition}
          </div>
        </div>
        <div className="text-sm text-gray-600 sm:text-right">
          <div>Stack {session.effectiveStack}</div>
          <div>Stack weight {session.stackWeight}</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
          Board
        </div>
        {cardList(board)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Hero
          </div>
          {cardList(heroHand)}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Villain
          </div>
          {terminal ? (
            cardList(villainHand)
          ) : (
            <div className="flex h-14 w-[5.25rem] items-center justify-center rounded border border-gray-300 bg-gray-100 text-sm font-semibold text-gray-500">
              Hidden
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VillainRangeDetailCard({
  cell,
  isHovering,
  review,
}: {
  cell: VillainActionRangeCell | null;
  isHovering: boolean;
  review: DecisionReview | null;
}) {
  const range = review?.villainActionRange;
  const hasRangeCells = Boolean(range?.cells.length);

  return (
    <div className="flex h-full min-h-[14rem] flex-col rounded border border-gray-300 bg-white p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-500">
            Villain range detail
          </div>
          <div className="mt-1 text-lg font-semibold">
            {range && cell
              ? cell.handClass
              : range
              ? hasRangeCells
                ? "Point to a hand"
                : "No range combos"
              : "No villain action yet"}
          </div>
          {review && range && (
            <div className="mt-1 text-sm font-semibold text-gray-600">
              {isHovering ? "Pointed hand class" : "Top hand class"} · after{" "}
              {review.actionLabel}
            </div>
          )}
        </div>
        {range && cell && (
          <div className="text-right text-sm text-gray-600">
            <div>{formatRangeWeight(cell.weight)} weighted</div>
            <div>{cell.comboCount} combos</div>
          </div>
        )}
      </div>

      {!range ? (
        <div className="mt-4 text-sm font-semibold text-gray-500">
          Villain suit pairs will appear here after villain acts.
        </div>
      ) : !hasRangeCells ? (
        <div className="mt-4 text-sm font-semibold text-gray-500">
          No villain range combos are available for this action.
        </div>
      ) : !cell ? (
        <div className="mt-4 text-sm font-semibold text-gray-500">
          Move the mouse over a highlighted hand in the villain range matrix.
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          <div className="text-xs font-semibold uppercase text-gray-500">
            Possible suit pairs
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {cell.combos.map((combo) => (
              <div
                className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm"
                key={combo.label}
              >
                <span className="font-semibold">
                  {comboCardList(combo.cards)}
                </span>
                <span className="text-gray-600">
                  {formatRangeWeight(combo.weight)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VillainActionRangePanel({
  activeCellKey,
  onHoverCell,
  review,
}: {
  activeCellKey: string | null;
  onHoverCell: (key: string | null) => void;
  review: DecisionReview | null;
}) {
  const range = review?.villainActionRange;

  if (!review || !range) {
    return (
      <div className="rounded border border-gray-300 bg-white">
        <div className="border-b border-gray-200 px-3 py-3 sm:px-4">
          <div className="text-sm font-semibold text-gray-500">
            Villain range
          </div>
          <div className="mt-1 text-lg font-semibold">
            No villain action yet
          </div>
        </div>
      </div>
    );
  }

  const cellMap = new Map(
    range.cells.map((cell) => [villainRangeCellKey(cell), cell])
  );
  const maxCellWeight = Math.max(0, ...range.cells.map((cell) => cell.weight));

  return (
    <div className="rounded border border-gray-300 bg-white">
      <div className="flex flex-col gap-2 border-b border-gray-200 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
        <div>
          <div className="text-sm font-semibold text-gray-500">
            Villain range
          </div>
          <div className="mt-1 text-lg font-semibold">
            After {review.actionLabel}
          </div>
        </div>
        <div className="text-sm font-semibold text-gray-600 sm:text-right">
          <div>{formatRangeWeight(range.totalWeight)} weighted combos</div>
          <div>{range.cells.length} hand classes</div>
        </div>
      </div>
      {range.totalWeight <= 0 || range.cells.length === 0 ? (
        <div className="px-3 py-4 text-sm font-semibold text-gray-500 sm:px-4">
          No villain range available for this action.
        </div>
      ) : (
        <div className="overflow-auto p-3 sm:p-4">
          <div className="aspect-square min-w-[22rem] max-w-[34rem]">
            <table
              className="snug h-full w-full table-fixed select-none"
              onMouseLeave={() => onHoverCell(null)}
            >
              <tbody>
                {rangeRanks.map((_, row) => (
                  <tr key={row}>
                    {rangeRanks.map((__, col) => {
                      const key = `${row}:${col}`;
                      const cell = cellMap.get(key);
                      const height =
                        cell && maxCellWeight > 0
                          ? cell.weight / maxCellWeight
                          : 0;
                      const label = matrixHandClass(row, col);
                      const isActive = activeCellKey === key;
                      const cellTitle = cell
                        ? [
                            `${label}: ${formatRangeWeight(
                              cell.weight
                            )} weighted combos`,
                            ...cell.combos.map(
                              (combo) =>
                                `${combo.label}: ${formatRangeWeight(
                                  combo.weight
                                )}`
                            ),
                          ].join("\n")
                        : label;
                      return (
                        <td
                          className={[
                            "relative border border-black outline-none transition",
                            cell ? "cursor-pointer hover:z-30 focus:z-30" : "",
                            isActive
                              ? "z-20 ring-2 ring-blue-500 ring-inset"
                              : "",
                          ].join(" ")}
                          key={`${row}-${col}`}
                          onFocus={() => onHoverCell(cell ? key : null)}
                          onMouseEnter={() => onHoverCell(cell ? key : null)}
                          tabIndex={cell ? 0 : undefined}
                          title={cellTitle}
                        >
                          <div
                            className={[
                              "absolute left-0 top-0 flex h-full w-full bg-left-bottom bg-no-repeat",
                              row === col ? "bg-neutral-700" : "bg-neutral-800",
                            ].join(" ")}
                            style={
                              cell
                                ? {
                                    backgroundImage:
                                      "linear-gradient(#eab308 0% 100%)",
                                    backgroundSize: `100% ${height * 100}%`,
                                  }
                                : undefined
                            }
                          />
                          <div
                            className={[
                              "absolute -top-px left-[0.1875rem] z-10 text-shadow",
                              cell ? "text-white" : "text-neutral-500",
                            ].join(" ")}
                            style={{
                              fontSize: "clamp(0.65rem, 0.9vw, 0.95rem)",
                            }}
                          >
                            {label}
                          </div>
                          <div
                            className="absolute bottom-px right-1 z-10 max-w-[calc(100%-0.25rem)] overflow-hidden text-shadow text-white"
                            style={{
                              fontSize: "clamp(0.55rem, 0.75vw, 0.8rem)",
                            }}
                          >
                            {cell ? formatRangeWeight(cell.weight) : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrainingPage() {
  const restoredSnapshot = postflopTrainingSnapshot;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const navigatorRef = useRef<ResultNavigatorHandle | null>(null);
  const automationInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const decisionOrderRef = useRef(
    Math.max(
      0,
      ...(restoredSnapshot?.decisionLog ?? []).map(
        (decision) => decision.order + 1
      ),
      ...(restoredSnapshot?.villainDecisionLog ?? []).map(
        (decision) => decision.order + 1
      )
    )
  );

  const [root, setRoot] = useState(
    restoredSnapshot?.root ?? "../training-games-formal"
  );
  const [summary, setSummary] = useState<TrainingLibrarySummary | null>(
    restoredSnapshot?.summary ?? null
  );
  const [heroPosition, setHeroPosition] = useState<TrainingPosition>(
    restoredSnapshot?.heroPosition ?? "BTN"
  );
  const [enabledPotTypes, setEnabledPotTypes] = useState<TrainingPotType[]>(
    restoredSnapshot?.enabledPotTypes ?? potTypes
  );
  const [trainingMode, setTrainingMode] = useState<"postflop" | "preflop">(
    restoredSnapshot?.trainingMode ?? "postflop"
  );
  const [session, setSession] = useState<TrainingSession | null>(
    restoredSnapshot?.session ?? null
  );
  const [cards, setCards] = useState<number[][]>(
    restoredSnapshot?.cards ?? [[], []]
  );
  const [navigatorKey, setNavigatorKey] = useState(0);
  const [initialHistory, setInitialHistory] = useState<number[] | null>(
    restoredSnapshot?.currentHistory ?? null
  );
  const [navigatorUpdate, setNavigatorUpdate] =
    useState<ResultNavigationUpdate | null>(null);
  const [lastReview, setLastReview] = useState<DecisionReview | null>(
    restoredSnapshot?.lastReview ?? null
  );
  const [decisionLog, setDecisionLog] = useState<DecisionReview[]>(
    restoredSnapshot?.decisionLog ?? []
  );
  const [villainDecisionLog, setVillainDecisionLog] = useState<
    DecisionReview[]
  >(restoredSnapshot?.villainDecisionLog ?? []);
  const [showVillainDecisionLog, setShowVillainDecisionLog] = useState(
    restoredSnapshot?.showVillainDecisionLog ?? false
  );
  const [error, setError] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [replayingSession, setReplayingSession] = useState(false);
  const [hoveredVillainRangeCellKey, setHoveredVillainRangeCellKey] = useState<
    string | null
  >(null);

  const terminal = navigatorUpdate?.selectedSpot?.type === "terminal";
  const visibleDecisionLog = [...decisionLog, ...villainDecisionLog].sort(
    (a, b) => a.order - b.order
  );
  const displayDecisionLog = (() => {
    const counts: Record<DecisionReview["actor"], number> = {
      hero: 0,
      villain: 0,
    };
    return visibleDecisionLog
      .map((decision) => ({
        decision,
        actorDecisionNumber: ++counts[decision.actor],
      }))
      .reverse();
  })();
  const latestVillainRangeReview = [...villainDecisionLog]
    .reverse()
    .find((decision) => decision.villainActionRange);
  const latestVillainRange = latestVillainRangeReview?.villainActionRange;
  const hoveredVillainRangeCell = findVillainRangeCell(
    latestVillainRange,
    hoveredVillainRangeCellKey
  );
  const activeVillainRangeCell =
    hoveredVillainRangeCell ?? latestVillainRange?.cells[0] ?? null;
  const activeVillainRangeCellKey = activeVillainRangeCell
    ? villainRangeCellKey(activeVillainRangeCell)
    : null;
  const heroHand = session?.heroHand.cards ?? [];
  const villainHand = session?.villainHand.cards ?? [];
  const boardCards = navigatorUpdate?.currentBoard ?? session?.board ?? [];
  const livePot = navigatorUpdate?.selectedSpot?.pot ?? session?.startingPot;
  const currentSpot =
    navigatorUpdate?.selectedSpot?.type === "player"
      ? navigatorUpdate.selectedSpot
      : null;
  const isHeroTurn =
    Boolean(session && currentSpot?.player === session.heroPlayer) &&
    !navigatorUpdate?.selectedChance;
  const reloadLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const next = await invokes.trainingLibrarySummary(root);
      setSummary(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLibrary(false);
    }
  };

  const applyResultsState = (nextSession: TrainingSession) => {
    dispatch(
      setConfig({
        board: nextSession.board,
        effectiveStack: nextSession.effectiveStack,
        startingPot: nextSession.startingPot,
      })
    );
    dispatch(setSolverFinished(true));
    dispatch(setTrainingResult(true));
  };

  const currentHistory = () =>
    selectCurrentTrainingHistory({
      initialHistory,
      navigatorHistory: navigatorRef.current?.getSnapshot()?.currentHistory,
      updateHistory: navigatorUpdate?.currentHistory,
    });

  const savePostflopSnapshot = (
    overrides: Partial<PostflopTrainingSnapshot> = {}
  ) => {
    postflopTrainingSnapshot = {
      cards,
      currentHistory: currentHistory(),
      decisionLog,
      enabledPotTypes,
      heroPosition,
      lastReview,
      root,
      session,
      showVillainDecisionLog,
      summary,
      trainingMode,
      villainDecisionLog,
      ...overrides,
    };
  };

  const resetCurrentTrainingRun = async (
    nextSession: TrainingSession,
    nextCards: number[][]
  ) => {
    await invokes.gameApplyHistory([]);
    applyResultsState(nextSession);
    dispatch(setTrainingResultHistory([]));
    setSession(nextSession);
    setCards(nextCards);
    setNavigatorUpdate(null);
    setInitialHistory([]);
    setLastReview(null);
    setDecisionLog([]);
    setVillainDecisionLog([]);
    setShowVillainDecisionLog(false);
    decisionOrderRef.current = 0;
    setNavigatorKey((key) => key + 1);
    savePostflopSnapshot({
      cards: nextCards,
      currentHistory: [],
      decisionLog: [],
      lastReview: null,
      session: nextSession,
      showVillainDecisionLog: false,
      villainDecisionLog: [],
    });
  };

  const startSession = async () => {
    setStartingSession(true);
    try {
      const nextSession = await invokes.trainingSessionStart({
        root,
        heroPosition,
        potTypes: enabledPotTypes,
      });
      const nextCards = await invokes.gamePrivateCards();
      await resetCurrentTrainingRun(nextSession, nextCards);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingSession(false);
    }
  };

  const viewResults = async () => {
    if (!session) return;
    try {
      const history = currentHistory();
      savePostflopSnapshot({ currentHistory: history });
      await invokes.gameApplyHistory(history);
      applyResultsState(session);
      dispatch(setTrainingResultHistory(history));
      navigate("/results", { state: { initialHistory: [...history] } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const replaySameHand = async () => {
    if (!session) return;
    setReplayingSession(true);
    try {
      await resetCurrentTrainingRun(session, cards);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplayingSession(false);
    }
  };

  const replaySameHero = async () => {
    if (!session) return;
    setReplayingSession(true);
    try {
      const nextSession = await invokes.trainingSessionReplay({
        root: session.root,
        heroPosition: session.heroPosition,
        path: session.path,
        heroHand: session.heroHand,
        villainHand: session.villainHand,
      });
      const nextCards = await invokes.gamePrivateCards();
      await resetCurrentTrainingRun(nextSession, nextCards);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplayingSession(false);
    }
  };

  const replayNewHand = async () => {
    if (!session) return;
    setReplayingSession(true);
    try {
      const nextSession = await invokes.trainingSessionReplay({
        root: session.root,
        heroPosition: session.heroPosition,
        path: session.path,
      });
      const nextCards = await invokes.gamePrivateCards();
      await resetCurrentTrainingRun(nextSession, nextCards);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplayingSession(false);
    }
  };

  const downloadTrainingHistory = () => {
    if (!session) return;
    const payload = buildTrainingHistoryExport({
      currentBoard: navigatorUpdate?.currentBoard ?? session.board,
      currentHistory: currentHistory(),
      heroDecisions: decisionLog,
      livePot: livePot ?? null,
      session,
      villainDecisions: villainDecisionLog,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = trainingHistoryFilename(payload);
    a.click();
    URL.revokeObjectURL(downloadUrl);
  };

  const togglePotType = (potType: TrainingPotType) => {
    setEnabledPotTypes((current) =>
      current.includes(potType)
        ? current.filter((item) => item !== potType)
        : [...current, potType]
    );
  };

  const nextDecisionOrder = useCallback(() => {
    const order = decisionOrderRef.current;
    decisionOrderRef.current += 1;
    return order;
  }, []);

  const buildReview = useCallback(
    (
      spot: SpotPlayer,
      actionIndex: number,
      actor: DecisionReview["actor"],
      player: TrainingPlayer,
      handIndex: number,
      handCards: number[],
      position: TrainingPosition,
      villainActionRange?: VillainActionRangeSummary
    ): DecisionReview | null => {
      if (!session || !navigatorUpdate) return null;
      const details = exactActionDetails(
        navigatorUpdate.results,
        cards,
        player,
        handIndex,
        spot.actions,
        actionIndex
      );
      return {
        actionLabel: actionLabel(spot.actions[actionIndex]),
        actor,
        actions: details,
        board: navigatorUpdate.currentBoard,
        handCards,
        historyIndex: spot.index - 1,
        order: nextDecisionOrder(),
        position,
        spot: session.spot,
        villainActionRange,
      };
    },
    [cards, navigatorUpdate, nextDecisionOrder, session]
  );

  const chooseHeroAction = async (spot: SpotPlayer, actionIndex: number) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      if (!session) return;
      const review = buildReview(
        spot,
        actionIndex,
        "hero",
        session.heroPlayer,
        session.heroHand.index,
        session.heroHand.cards,
        session.heroPosition
      );
      if (review) {
        setLastReview(review);
        setDecisionLog((current) => [...current, review]);
      }
      await navigatorRef.current?.playSelected(actionIndex);
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const restoreHistoricalAction = async (
    spot: SpotPlayer,
    actionIndex: number
  ) => {
    if (actionInFlightRef.current || !session || spot.selectedIndex === -1) {
      return;
    }
    actionInFlightRef.current = true;
    try {
      const historyIndex = spot.index - 1;
      const actor = spot.player === session.heroPlayer ? "hero" : "villain";
      const nextHeroDecisions =
        actor === "hero"
          ? replaceDecisionAtHistoryIndex(
              decisionLog,
              historyIndex,
              actionIndex
            )
          : decisionLog.filter(
              (decision) => decision.historyIndex < historyIndex
            );
      const nextVillainDecisions =
        actor === "villain"
          ? replaceDecisionAtHistoryIndex(
              villainDecisionLog,
              historyIndex,
              actionIndex
            ).map((decision) =>
              decision.historyIndex === historyIndex &&
              spot.selectedIndex !== actionIndex
                ? { ...decision, villainActionRange: undefined }
                : decision
            )
          : villainDecisionLog.filter(
              (decision) => decision.historyIndex < historyIndex
            );
      const nextOrder = Math.max(
        0,
        ...nextHeroDecisions.map((decision) => decision.order + 1),
        ...nextVillainDecisions.map((decision) => decision.order + 1)
      );

      decisionOrderRef.current = nextOrder;
      setDecisionLog(nextHeroDecisions);
      setVillainDecisionLog(nextVillainDecisions);
      setLastReview(nextHeroDecisions.at(-1) ?? null);
      setShowVillainDecisionLog(false);
      await navigatorRef.current?.playAt(spot.index, actionIndex);
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const handleNavigatorAction = (spot: SpotPlayer, actionIndex: number) => {
    if (!session || actionIndex < 0 || actionIndex >= spot.actions.length) {
      return false;
    }
    if (currentSpot && isHeroTurn && spot.index === currentSpot.index) {
      void chooseHeroAction(currentSpot, actionIndex);
      return false;
    }
    if (spot.selectedIndex !== -1) {
      void restoreHistoricalAction(spot, actionIndex);
    }
    return false;
  };

  const handleNavigatorUpdate = (update: ResultNavigationUpdate) => {
    setNavigatorUpdate(update);
    setInitialHistory(null);
    dispatch(setTrainingResultHistory(update.currentHistory));
  };

  useEffect(() => {
    void reloadLibrary();
    // Initial library load intentionally uses the default local path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePostflopSnapshot();
    // This snapshot intentionally mirrors route-local UI state for restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cards,
    decisionLog,
    enabledPotTypes,
    heroPosition,
    lastReview,
    navigatorUpdate,
    root,
    session,
    showVillainDecisionLog,
    summary,
    trainingMode,
    villainDecisionLog,
  ]);

  useEffect(() => {
    if (terminal) {
      setShowVillainDecisionLog(true);
    }
  }, [terminal]);

  useEffect(() => {
    setHoveredVillainRangeCellKey(null);
  }, [latestVillainRangeReview?.order]);

  useEffect(() => {
    if (!session || !navigatorUpdate || automationInFlightRef.current) return;

    const runAutomation = async () => {
      const selectedChance = navigatorUpdate.selectedChance;
      if (selectedChance && selectedChance.selectedIndex === -1) {
        const deadCards = new Set([
          ...navigatorUpdate.currentBoard,
          ...session.heroHand.cards,
          ...session.villainHand.cards,
        ]);
        const legalCards = selectedChance.cards
          .filter((card) => !card.isDead && !deadCards.has(card.card))
          .map((card) => card.card);
        if (legalCards.length > 0) {
          const card =
            legalCards[Math.floor(Math.random() * legalCards.length)];
          await navigatorRef.current?.dealSelected(card);
        }
        return;
      }

      const spot = navigatorUpdate.selectedSpot;
      if (spot?.type !== "player" || spot.player !== session.villainPlayer) {
        return;
      }
      const details = exactActionDetails(
        navigatorUpdate.results,
        cards,
        session.villainPlayer,
        session.villainHand.index,
        spot.actions
      );
      const actionIndex = chooseWeightedIndex(
        details.map((detail) => detail.probability)
      );
      const villainActionRange = buildVillainActionRange({
        actionIndex,
        cards,
        player: session.villainPlayer,
        results: navigatorUpdate.results,
      });
      const review = buildReview(
        spot,
        actionIndex,
        "villain",
        session.villainPlayer,
        session.villainHand.index,
        session.villainHand.cards,
        session.villainPosition,
        villainActionRange
      );
      if (review) {
        setVillainDecisionLog((current) => [...current, review]);
      }
      await navigatorRef.current?.playSelected(actionIndex);
    };

    automationInFlightRef.current = true;
    window.setTimeout(() => {
      runAutomation().finally(() => {
        automationInFlightRef.current = false;
      });
    }, 120);
  }, [buildReview, cards, navigatorUpdate, session]);

  const renderActionPanel = (className = "") => (
    <div
      className={[
        "rounded border border-gray-300 bg-white p-3 sm:p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <div className="text-sm font-semibold uppercase text-gray-500">
          Replay
        </div>
      </div>
      {session && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          <button
            className="button-base button-gray training-mobile-button flex items-center justify-center gap-2"
            disabled={replayingSession}
            onClick={replaySameHand}
            type="button"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Same Hand
          </button>
          <button
            className="button-base button-gray training-mobile-button flex items-center justify-center gap-2"
            disabled={replayingSession}
            onClick={replaySameHero}
            type="button"
          >
            <UserIcon className="h-5 w-5" />
            Same Hero
          </button>
          <button
            className="button-base button-gray training-mobile-button flex items-center justify-center gap-2"
            disabled={replayingSession}
            onClick={replayNewHand}
            type="button"
          >
            <PlayIcon className="h-5 w-5" />
            New Cards
          </button>
        </div>
      )}
    </div>
  );
  const trainingTabs = (
    <div className="border-b border-gray-300 bg-white px-3 pt-3 sm:px-4">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        {(["postflop", "preflop"] as const).map((mode) => (
          <button
            className={[
              "training-mobile-tab rounded-t border border-b-0 font-semibold",
              trainingMode === mode
                ? "border-gray-300 bg-gray-50 text-blue-700"
                : "border-transparent bg-white text-gray-600 hover:bg-gray-100",
            ].join(" ")}
            key={mode}
            onClick={() => setTrainingMode(mode)}
            type="button"
          >
            {mode === "postflop" ? "Postflop" : "Preflop"}
          </button>
        ))}
      </div>
    </div>
  );

  if (trainingMode === "preflop") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-gray-50">
        {trainingTabs}
        <PreflopTrainingPanel />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      {trainingTabs}
      <div className="border-b border-gray-300 bg-white px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 basis-full flex-col text-sm font-semibold sm:min-w-[18rem] sm:flex-1">
            <span>Library</span>
            <input
              className="mt-1 rounded border-gray-300 text-sm"
              onChange={(event) => setRoot(event.target.value)}
              value={root}
            />
          </label>
          <button
            className="button-base button-gray training-mobile-button flex w-full items-center justify-center gap-2 sm:w-auto"
            disabled={loadingLibrary}
            onClick={reloadLibrary}
            type="button"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Reload
          </button>
          <label className="flex min-w-[5rem] flex-1 flex-col text-sm font-semibold sm:flex-none">
            <span>Hero</span>
            <select
              className="mt-1 rounded border-gray-300 text-sm"
              onChange={(event) =>
                setHeroPosition(event.target.value as TrainingPosition)
              }
              value={heroPosition}
            >
              {positions.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </label>
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:items-center">
            {potTypes.map((potType) => (
              <label
                className="training-mobile-choice flex items-center justify-center gap-2 rounded border border-gray-300 font-semibold"
                key={potType}
              >
                <input
                  checked={enabledPotTypes.includes(potType)}
                  onChange={() => togglePotType(potType)}
                  type="checkbox"
                />
                {potType.toUpperCase()}
              </label>
            ))}
          </div>
          <button
            className="button-base button-blue training-mobile-button flex w-full items-center justify-center gap-2 sm:w-auto"
            disabled={startingSession || enabledPotTypes.length === 0}
            onClick={startSession}
            type="button"
          >
            <PlayIcon className="h-5 w-5" />
            New Hand
          </button>
          {session && (
            <button
              className="button-base button-gray training-mobile-button flex w-full items-center justify-center gap-2 sm:w-auto"
              onClick={viewResults}
              type="button"
            >
              <ChartBarIcon className="h-5 w-5" />
              View Results
            </button>
          )}
        </div>
        {summary && (
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
            <span>{summary.solvedJobCount} solved jobs</span>
            <span>{summary.manifest.jobCount} manifest jobs</span>
            <span>{summary.validationErrors.length} validation errors</span>
            <span className="break-all">{summary.root}</span>
          </div>
        )}
        {error && (
          <div className="mt-3 text-sm font-semibold text-red-600">{error}</div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session && cards[0]?.length > 0 ? (
          <div className="flex min-h-0 flex-col gap-3 p-3 sm:gap-4 sm:p-4">
            <ResultNavigator
              cards={cards}
              config={{
                board: session.board,
                effectiveStack: session.effectiveStack,
                startingPot: session.startingPot,
              }}
              dealRequest={null}
              initialHistory={initialHistory}
              key={navigatorKey}
              onActionClick={handleNavigatorAction}
              onDealHandled={() => undefined}
              onUpdate={handleNavigatorUpdate}
              readOnly
              ref={navigatorRef}
              showRates={false}
            />

            <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2 xl:items-start">
              <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
                <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-stretch">
                  {renderActionPanel()}
                  <SessionBoardInfoCard
                    board={boardCards}
                    heroHand={heroHand}
                    session={session}
                    terminal={terminal}
                    villainHand={villainHand}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                  <VillainActionRangePanel
                    activeCellKey={activeVillainRangeCellKey}
                    onHoverCell={setHoveredVillainRangeCellKey}
                    review={latestVillainRangeReview ?? null}
                  />
                  <VillainRangeDetailCard
                    cell={activeVillainRangeCell}
                    isHovering={Boolean(hoveredVillainRangeCell)}
                    review={latestVillainRangeReview ?? null}
                  />
                </div>
              </div>

              <section className="rounded border border-gray-300 bg-white p-3 sm:p-4 xl:sticky xl:top-3 xl:max-h-[calc(100vh_-_8rem)] xl:overflow-auto">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold uppercase text-gray-500">
                    Decision Log
                  </div>
                  {terminal && (
                    <button
                      className="button-base button-gray flex items-center justify-center gap-2 px-3 py-2 text-sm"
                      onClick={downloadTrainingHistory}
                      type="button"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                      Download History
                    </button>
                  )}
                </div>
                {visibleDecisionLog.length === 0 ? (
                  <div className="mt-4 text-sm text-gray-500">
                    No decisions yet.
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    {displayDecisionLog.map(
                      ({ decision, actorDecisionNumber }) => {
                        const hideVillainPrivateDetails =
                          decision.actor === "villain" && !terminal;
                        return (
                          <article
                            className="rounded border border-gray-200 bg-white px-3 py-2 shadow-sm"
                            key={`${decision.actor}-${decision.order}`}
                          >
                            <div className="flex flex-col gap-2 overflow-hidden text-xs">
                              <div className="overflow-x-auto">
                                <div className="flex min-w-max items-center gap-3">
                                  <span className="font-semibold uppercase text-gray-500">
                                    {decision.actor === "hero"
                                      ? "Hero"
                                      : "Villain"}{" "}
                                    Decision {actorDecisionNumber}
                                  </span>
                                  <span className="text-sm font-semibold text-gray-900">
                                    {decision.position}{" "}
                                    {hideVillainPrivateDetails
                                      ? "Hidden hand"
                                      : formatHand(decision.handCards)}
                                  </span>
                                  <span
                                    className={[
                                      "rounded px-2 py-1 font-semibold",
                                      decision.actor === "villain"
                                        ? "bg-red-50 text-red-700"
                                        : "bg-blue-50 text-blue-700",
                                    ].join(" ")}
                                  >
                                    {decision.actionLabel}
                                  </span>
                                  <span className="text-gray-500">
                                    {decision.spot}
                                  </span>
                                  <span className="text-gray-500">
                                    Board {formatBoard(decision.board)}
                                  </span>
                                </div>
                              </div>
                              <div className="overflow-x-auto border-t border-gray-100 pt-2">
                                {hideVillainPrivateDetails ? (
                                  <div className="min-w-max font-semibold text-gray-500">
                                    Villain hand-specific frequencies hidden
                                    until terminal.
                                  </div>
                                ) : (
                                  <div className="flex min-w-max items-center gap-3">
                                    {decision.actions.map((action) => (
                                      <span
                                        className={[
                                          "border-l border-gray-200 pl-3 first:border-l-0 first:pl-0",
                                          action.isChosen
                                            ? decision.actor === "villain"
                                              ? "font-semibold text-red-700"
                                              : "font-semibold text-blue-700"
                                            : "text-gray-600",
                                        ].join(" ")}
                                        key={action.actionIndex}
                                      >
                                        {actionLabel(action)}{" "}
                                        <span className="text-gray-500">
                                          {formatProbability(
                                            action.probability
                                          )}
                                        </span>{" "}
                                        <span className="text-gray-500">
                                          EV {formatEv(action.ev)}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      }
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[18rem] flex-1 items-center justify-center px-4 text-center text-gray-500 lg:h-full">
            Start a new hand from a solved training library.
          </div>
        )}
      </div>
    </div>
  );
}

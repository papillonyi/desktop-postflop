import {
  ArrowPathIcon,
  ChartBarIcon,
  PlayIcon,
  ForwardIcon,
} from "@heroicons/react/24/solid";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import {
  setSolverFinished,
  setTrainingResult,
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

type DecisionReview = {
  actionLabel: string;
  actions: ActionDetail[];
  board: number[];
  handCards: number[];
  position: TrainingPosition;
  spot: string;
};

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

function ActionReview({ review }: { review: DecisionReview | null }) {
  if (!review) {
    return (
      <div className="rounded border border-gray-300 bg-white p-4 text-sm font-semibold text-gray-500">
        Choose an action to reveal this hand's GTO frequencies.
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-300 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="text-sm font-semibold text-gray-500">
          {review.position} {formatHand(review.handCards)} on{" "}
          {formatBoard(review.board)}
        </div>
        <div className="mt-1 text-lg font-semibold">{review.actionLabel}</div>
      </div>
      <div className="divide-y divide-gray-100">
        {review.actions.map((action) => (
          <div
            className={[
              "grid grid-cols-[1fr_5rem_5rem] items-center gap-3 px-4 py-2 text-sm",
              action.isChosen ? "bg-blue-50 font-semibold" : "",
            ].join(" ")}
            key={action.actionIndex}
          >
            <span>{actionLabel(action)}</span>
            <span className="text-right">
              {formatProbability(action.probability)}
            </span>
            <span className="text-right text-gray-600">
              {formatEv(action.ev)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrainingPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const navigatorRef = useRef<ResultNavigatorHandle | null>(null);
  const automationInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);

  const [root, setRoot] = useState("../training-games-formal");
  const [summary, setSummary] = useState<TrainingLibrarySummary | null>(null);
  const [heroPosition, setHeroPosition] = useState<TrainingPosition>("BTN");
  const [enabledPotTypes, setEnabledPotTypes] =
    useState<TrainingPotType[]>(potTypes);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [cards, setCards] = useState<number[][]>([[], []]);
  const [navigatorKey, setNavigatorKey] = useState(0);
  const [navigatorUpdate, setNavigatorUpdate] =
    useState<ResultNavigationUpdate | null>(null);
  const [lastReview, setLastReview] = useState<DecisionReview | null>(null);
  const [decisionLog, setDecisionLog] = useState<DecisionReview[]>([]);
  const [error, setError] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [startingSession, setStartingSession] = useState(false);

  const terminal = navigatorUpdate?.selectedSpot?.type === "terminal";
  const heroHand = session?.heroHand.cards ?? [];
  const villainHand = session?.villainHand.cards ?? [];
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

  const startSession = async () => {
    setStartingSession(true);
    try {
      const nextSession = await invokes.trainingSessionStart({
        root,
        heroPosition,
        potTypes: enabledPotTypes,
      });
      await invokes.gameApplyHistory([]);
      applyResultsState(nextSession);
      const nextCards = await invokes.gamePrivateCards();
      setSession(nextSession);
      setCards(nextCards);
      setNavigatorUpdate(null);
      setLastReview(null);
      setDecisionLog([]);
      setNavigatorKey((key) => key + 1);
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
      await invokes.gameApplyHistory([]);
      applyResultsState(session);
      navigate("/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const togglePotType = (potType: TrainingPotType) => {
    setEnabledPotTypes((current) =>
      current.includes(potType)
        ? current.filter((item) => item !== potType)
        : [...current, potType]
    );
  };

  const buildReview = (
    spot: SpotPlayer,
    actionIndex: number
  ): DecisionReview | null => {
    if (!session || !navigatorUpdate) return null;
    const details = exactActionDetails(
      navigatorUpdate.results,
      cards,
      session.heroPlayer,
      session.heroHand.index,
      spot.actions,
      actionIndex
    );
    return {
      actionLabel: actionLabel(spot.actions[actionIndex]),
      actions: details,
      board: navigatorUpdate.currentBoard,
      handCards: session.heroHand.cards,
      position: session.heroPosition,
      spot: session.spot,
    };
  };

  const chooseHeroAction = async (spot: SpotPlayer, actionIndex: number) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      const review = buildReview(spot, actionIndex);
      if (review) {
        setLastReview(review);
        setDecisionLog((current) => [...current, review]);
      }
      await navigatorRef.current?.playSelected(actionIndex);
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const handleNavigatorAction = (spot: SpotPlayer, actionIndex: number) => {
    if (!session || spot.player !== session.heroPlayer) return false;
    void chooseHeroAction(spot, actionIndex);
    return false;
  };

  useEffect(() => {
    void reloadLibrary();
    // Initial library load intentionally uses the default local path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await navigatorRef.current?.playSelected(actionIndex);
    };

    automationInFlightRef.current = true;
    window.setTimeout(() => {
      runAutomation().finally(() => {
        automationInFlightRef.current = false;
      });
    }, 120);
  }, [cards, navigatorUpdate, session]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <div className="border-b border-gray-300 bg-white px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[18rem] flex-1 flex-col text-sm font-semibold">
            <span>Library</span>
            <input
              className="mt-1 rounded border-gray-300 text-sm"
              onChange={(event) => setRoot(event.target.value)}
              value={root}
            />
          </label>
          <button
            className="button-base button-gray flex items-center gap-2"
            disabled={loadingLibrary}
            onClick={reloadLibrary}
            type="button"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Reload
          </button>
          <label className="flex flex-col text-sm font-semibold">
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
          <div className="flex items-center gap-2">
            {potTypes.map((potType) => (
              <label
                className="flex items-center gap-1 rounded border border-gray-300 px-3 py-2 text-sm font-semibold"
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
            className="button-base button-blue flex items-center gap-2"
            disabled={startingSession || enabledPotTypes.length === 0}
            onClick={startSession}
            type="button"
          >
            <PlayIcon className="h-5 w-5" />
            New Hand
          </button>
          {session && (
            <button
              className="button-base button-gray flex items-center gap-2"
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
            <span>{summary.root}</span>
          </div>
        )}
        {error && (
          <div className="mt-3 text-sm font-semibold text-red-600">{error}</div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 flex-col">
          {session && cards[0]?.length > 0 ? (
            <>
              <ResultNavigator
                cards={cards}
                config={{
                  board: session.board,
                  effectiveStack: session.effectiveStack,
                  startingPot: session.startingPot,
                }}
                dealRequest={null}
                key={navigatorKey}
                onActionClick={handleNavigatorAction}
                onDealHandled={() => undefined}
                onUpdate={setNavigatorUpdate}
                ref={navigatorRef}
                showPotWithoutBets
                showRates={false}
              />
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_18rem] gap-4 p-4">
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="rounded border border-gray-300 bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-500">
                          {session.potType.toUpperCase()} · {session.spot}
                        </div>
                        <div className="mt-1 text-xl font-semibold">
                          {session.heroPosition} vs {session.villainPosition}
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <div>Pot {session.startingPot}</div>
                        <div>Stack {session.effectiveStack}</div>
                        <div>Stack weight {session.stackWeight}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-5">
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
                          Board
                        </div>
                        {cardList(
                          navigatorUpdate?.currentBoard ?? session.board
                        )}
                      </div>
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

                  <ActionReview review={lastReview} />
                </div>

                <div className="rounded border border-gray-300 bg-white p-4">
                  <div className="text-sm font-semibold uppercase text-gray-500">
                    Action
                  </div>
                  {terminal ? (
                    <button
                      className="button-base button-blue mt-4 flex w-full items-center justify-center gap-2"
                      disabled={startingSession}
                      onClick={startSession}
                      type="button"
                    >
                      <ForwardIcon className="h-5 w-5" />
                      Next Hand
                    </button>
                  ) : isHeroTurn && currentSpot ? (
                    <div className="mt-4 flex flex-col gap-2">
                      {currentSpot.actions.map((action) => (
                        <button
                          className="button-base button-blue flex items-center justify-center"
                          key={action.index}
                          onClick={() =>
                            chooseHeroAction(currentSpot, action.index)
                          }
                          type="button"
                        >
                          <span>{actionLabel(action)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 text-sm font-semibold text-gray-500">
                      {navigatorUpdate?.selectedChance
                        ? "Dealing"
                        : currentSpot
                        ? `${currentSpot.player.toUpperCase()} acting`
                        : "Loading"}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-500">
              Start a new hand from a solved training library.
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-auto border-l border-gray-300 bg-white p-4">
          <div className="text-sm font-semibold uppercase text-gray-500">
            Decision Log
          </div>
          {decisionLog.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">No decisions yet.</div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {decisionLog.map((decision, index) => (
                <article
                  className="rounded border border-gray-200 bg-white p-3 shadow-sm"
                  key={index}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase text-gray-500">
                        Decision {index + 1}
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {decision.position} {formatHand(decision.handCards)}
                      </div>
                    </div>
                    <div className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                      {decision.actionLabel}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {decision.spot}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Board {formatBoard(decision.board)}
                  </div>
                  <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100 pt-2 text-xs">
                    {decision.actions.map((action) => (
                      <div
                        className={[
                          "grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-center gap-2 py-1.5",
                          action.isChosen
                            ? "font-semibold text-blue-700"
                            : "text-gray-600",
                        ].join(" ")}
                        key={action.actionIndex}
                      >
                        <span className="truncate">{actionLabel(action)}</span>
                        <span className="text-right">
                          {formatProbability(action.probability)}
                        </span>
                        <span className="text-right">
                          {formatEv(action.ev)}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

import { CheckIcon } from "@heroicons/react/20/solid";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useAppSelector } from "../../app/hooks";
import type { TreeConfigState } from "../../app/slices/configSlice";
import type {
  ChanceReports,
  Results,
  Spot,
  SpotChance,
  SpotPlayer,
  SpotRoot,
} from "../../result-types";
import * as invokes from "../../invokes";
import { average, cardText, colorString, toFixed1 } from "../../utils";

export type ResultNavigationUpdate = {
  chanceReports: ChanceReports | null;
  currentBoard: number[];
  currentHistory: number[];
  results: Results;
  selectedChance: SpotChance | null;
  selectedSpot: Spot | null;
  totalBetAmount: number[];
};

export type ResultNavigatorConfig = Pick<
  TreeConfigState,
  "board" | "startingPot" | "effectiveStack"
>;

export type ResultNavigatorSnapshot = ResultNavigationUpdate & {
  spots: Spot[];
  selectedChanceIndex: number;
  selectedSpotIndex: number;
};

export type ResultNavigatorHandle = {
  dealSelected: (card: number) => Promise<void>;
  getSnapshot: () => ResultNavigatorSnapshot | null;
  playSelected: (actionIndex: number) => Promise<void>;
};

export type ResultNavigatorProps = {
  cards: number[][];
  className?: string;
  config?: ResultNavigatorConfig;
  dealRequest: number | null;
  initialHistory?: number[] | null;
  onActionClick?: (spot: SpotPlayer, actionIndex: number) => boolean | void;
  onDealHandled: () => void;
  onUpdate: (result: ResultNavigationUpdate) => void;
  readOnly?: boolean;
  showPotWithoutBets?: boolean;
  showRates?: boolean;
};

const foldColor = { red: 0x3b, green: 0x82, blue: 0xf6 };
const checkColor = { red: 0x22, green: 0xc5, blue: 0x5e };
const callColor = { red: 0x22, green: 0xc5, blue: 0x5e };
const betColorGradient = [
  { red: 0xf5, green: 0x9e, blue: 0x0b },
  { red: 0xf9, green: 0x73, blue: 0x16 },
  { red: 0xef, green: 0x44, blue: 0x44 },
  { red: 0xec, green: 0x48, blue: 0x99 },
  { red: 0xd9, green: 0x46, blue: 0xef },
  { red: 0xa8, green: 0x55, blue: 0xf7 },
  { red: 0x8b, green: 0x5c, blue: 0xf6 },
];

function actionColor(
  name: string,
  index: number,
  numActions: number,
  numBetActions: number
) {
  if (name === "Fold") return colorString(foldColor);
  if (name === "Check") return colorString(checkColor);
  if (name === "Call") return colorString(callColor);
  if (numBetActions <= 1) return colorString(betColorGradient[0]);
  if (index === numActions - 1) {
    const denom = numBetActions === 2 ? 2 : 1;
    return colorString(betColorGradient[(betColorGradient.length - 1) / denom]);
  }

  const betIndex = index - (numActions - numBetActions);
  const colorRate = betIndex / (numBetActions - 1);
  const gradientRate = colorRate * (betColorGradient.length - 1);
  const gradientIndex = Math.floor(gradientRate);
  const r = gradientRate - gradientIndex;
  const color1 = betColorGradient[gradientIndex];
  const color2 = betColorGradient[gradientIndex + 1];
  return colorString({
    red: Math.round(color1.red * (1 - r) + color2.red * r),
    green: Math.round(color1.green * (1 - r) + color2.green * r),
    blue: Math.round(color1.blue * (1 - r) + color2.blue * r),
  });
}

export const ResultNavigator = forwardRef<
  ResultNavigatorHandle,
  ResultNavigatorProps
>(function ResultNavigator(
  {
    cards,
    className,
    config: configOverride,
    dealRequest,
    initialHistory = null,
    onActionClick,
    onDealHandled,
    onUpdate,
    readOnly = false,
    showPotWithoutBets = false,
    showRates = true,
  },
  ref
) {
  const storeConfig = useAppSelector((state) => state.config);
  const config = configOverride ?? storeConfig;
  const navRef = useRef<HTMLDivElement | null>(null);
  const spotsRef = useRef<Spot[]>([]);
  const selectedSpotIndexRef = useRef(-1);
  const selectedChanceIndexRef = useRef(-1);
  const lockedRef = useRef(false);
  const restoringRef = useRef(false);
  const resultsRef = useRef<Results | null>(null);
  const chanceReportsRef = useRef<ChanceReports | null>(null);
  const totalBetAmountRef = useRef([0, 0]);
  const totalBetAmountAppendedRef = useRef([0, 0]);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [selectedSpotIndex, setSelectedSpotIndex] = useState(-1);
  const [selectedChanceIndex, setSelectedChanceIndex] = useState(-1);
  const [rates, setRates] = useState<number[] | null>(null);

  const setSpotsValue = (nextSpots: Spot[]) => {
    spotsRef.current = nextSpots;
    setSpots([...nextSpots]);
  };

  const isSelectedChanceSkipped = () =>
    selectedChanceIndexRef.current !== -1 &&
    (spotsRef.current[selectedChanceIndexRef.current] as SpotChance)
      ?.selectedIndex === -1;

  const currentBoardFromRefs = () => {
    const board = [...config.board];
    const endIndex =
      selectedChanceIndexRef.current === -1
        ? selectedSpotIndexRef.current
        : selectedChanceIndexRef.current;
    for (let i = 3; i < endIndex; ++i) {
      const spot = spotsRef.current[i];
      if (spot.type === "chance") {
        const card = spot.selectedIndex;
        if (card !== -1) board.push(card);
        else return board;
      }
    }
    return board;
  };

  const currentHistoryFromRefs = () => {
    const endIndex =
      selectedChanceIndexRef.current === -1
        ? selectedSpotIndexRef.current
        : selectedChanceIndexRef.current;
    return spotsRef.current
      .slice(1, endIndex)
      .map((spot) => spot.selectedIndex);
  };

  const spliceSpotsTerminal = (spotIndex: number) => {
    const results = resultsRef.current;
    if (!results) throw new Error("null results");
    const prevSpot = spotsRef.current[spotIndex - 1] as SpotPlayer;
    const prevAction = prevSpot.actions[prevSpot.selectedIndex];
    const chanceIndex = selectedChanceIndexRef.current;
    const chanceSkipped =
      chanceIndex !== -1 &&
      (spotsRef.current[chanceIndex] as SpotChance).selectedIndex === -1;

    let equityOop;
    if (prevAction.name === "Fold") {
      equityOop = prevSpot.player === "oop" ? 0 : 1;
    } else if (chanceSkipped || results.isEmpty) {
      equityOop = -1;
    } else {
      equityOop = average(results.equity[0], results.normalizer[0]);
    }

    const betSum =
      totalBetAmountAppendedRef.current[0] +
      totalBetAmountAppendedRef.current[1];
    setSpotsValue([
      ...spotsRef.current.slice(0, spotIndex),
      {
        type: "terminal",
        index: spotIndex,
        player: "end",
        selectedIndex: -1,
        prevPlayer: prevSpot.player,
        equityOop,
        pot: showPotWithoutBets
          ? config.startingPot
          : config.startingPot + betSum,
      },
    ]);
  };

  const spliceSpotsPlayer = (spotIndex: number, actions: string[]) => {
    const prevSpot = spotsRef.current[spotIndex - 1];
    const player = prevSpot.player === "oop" ? "ip" : "oop";
    const totalBetAmount = totalBetAmountRef.current;
    const pot = showPotWithoutBets
      ? config.startingPot
      : config.startingPot + totalBetAmount[0] + totalBetAmount[1];
    const stack =
      config.effectiveStack - Math.max(totalBetAmount[0], totalBetAmount[1]);
    let numBetActions = actions.length;
    if (actions[0]?.split(":")[1] === "0") numBetActions -= 1;
    if (actions[1]?.split(":")[1] === "0") numBetActions -= 1;

    setSpotsValue([
      ...spotsRef.current.slice(0, spotIndex),
      {
        type: "player",
        index: spotIndex,
        player,
        selectedIndex: -1,
        pot,
        stack,
        actions: actions.map((action, i) => {
          const [name, amount] = action.split(":");
          return {
            index: i,
            name,
            amount,
            isSelected: false,
            color: actionColor(name, i, actions.length, numBetActions),
          };
        }),
      },
    ]);
  };

  const spliceSpotsChance = async (spotIndex: number) => {
    type SpotTurn = SpotRoot | SpotChance;
    const prevSpot = spotsRef.current[spotIndex - 1] as SpotPlayer;
    const turnSpot = spotsRef.current
      .slice(0, spotIndex)
      .find((spot) => spot.player === "turn") as SpotTurn | undefined;

    let append: number[] = [];
    if (selectedChanceIndexRef.current !== -1) {
      append = spotsRef.current
        .slice(selectedChanceIndexRef.current, spotIndex)
        .map((spot) => spot.selectedIndex);
    }

    let possibleCards = 0n;
    if (!(turnSpot?.type === "chance" && turnSpot.selectedIndex === -1)) {
      possibleCards = await invokes.gamePossibleCards();
    }

    append.push(-1);
    const nextActions = await invokes.gameActionsAfter(append);
    let numBetActions = nextActions.length;
    while (
      numBetActions > 0 &&
      nextActions[nextActions.length - numBetActions].split(":")[1] === "0"
    ) {
      numBetActions -= 1;
    }

    if (selectedChanceIndexRef.current === -1) {
      chanceReportsRef.current = await invokes.gameGetChanceReports(
        append,
        "oop",
        nextActions.length
      );
    }

    setSpotsValue([
      ...spotsRef.current.slice(0, spotIndex),
      {
        type: "chance",
        index: spotIndex,
        player: turnSpot ? "river" : "turn",
        selectedIndex: -1,
        prevPlayer: prevSpot.player,
        cards: Array.from({ length: 52 }, (_, i) => ({
          card: i,
          isSelected: false,
          isDead: !(possibleCards & (1n << BigInt(i))),
        })),
        pot: showPotWithoutBets
          ? config.startingPot
          : config.startingPot + 2 * totalBetAmountAppendedRef.current[0],
        stack: config.effectiveStack - totalBetAmountAppendedRef.current[0],
      },
      {
        type: "player",
        index: spotIndex + 1,
        player: "oop",
        selectedIndex: -1,
        pot: showPotWithoutBets
          ? config.startingPot
          : config.startingPot + 2 * totalBetAmountAppendedRef.current[0],
        stack: config.effectiveStack - totalBetAmountAppendedRef.current[0],
        actions: nextActions.map((action, i) => {
          const [name, amount] = action.split(":");
          return {
            index: i,
            name,
            amount,
            isSelected: false,
            color: actionColor(name, i, nextActions.length, numBetActions),
          };
        }),
      },
    ]);
    selectedSpotIndexRef.current += 1;
    setSelectedSpotIndex(selectedSpotIndexRef.current);
    if (selectedChanceIndexRef.current === -1) {
      selectedChanceIndexRef.current = spotIndex;
      setSelectedChanceIndex(spotIndex);
    }
  };

  const emitUpdate = () => {
    if (restoringRef.current) return;
    const results = resultsRef.current;
    if (!results) return;
    onUpdate({
      chanceReports: chanceReportsRef.current,
      currentBoard: currentBoardFromRefs(),
      currentHistory: currentHistoryFromRefs(),
      results,
      selectedChance:
        selectedChanceIndexRef.current === -1
          ? null
          : (spotsRef.current[selectedChanceIndexRef.current] as SpotChance),
      selectedSpot:
        selectedSpotIndexRef.current === -1
          ? null
          : spotsRef.current[selectedSpotIndexRef.current],
      totalBetAmount: totalBetAmountRef.current,
    });
  };

  const selectSpot = async (
    spotIndex: number,
    needSplice: boolean,
    fromDeal = false
  ) => {
    if (
      lockedRef.current ||
      (!needSplice &&
        ((spotIndex === selectedSpotIndexRef.current && !fromDeal) ||
          spotIndex === selectedChanceIndexRef.current ||
          (spotsRef.current[spotIndex]?.type === "chance" &&
            isSelectedChanceSkipped() &&
            spotIndex > selectedChanceIndexRef.current)))
    ) {
      return;
    }

    if (spotIndex === 0) {
      await selectSpot(1, true);
      return;
    }

    lockedRef.current = true;

    if (fromDeal) {
      const nextSpots = [...spotsRef.current];
      const riverOffset = nextSpots
        .slice(selectedChanceIndexRef.current + 3)
        .findIndex((spot) => spot.type === "chance");
      const riverIndex =
        riverOffset === -1
          ? -1
          : riverOffset + selectedChanceIndexRef.current + 3;

      selectedChanceIndexRef.current = -1;

      if (riverIndex !== -1) {
        const riverSpot = nextSpots[riverIndex] as SpotChance;
        await invokes.gameApplyHistory(
          nextSpots.slice(1, riverIndex).map((spot) => spot.selectedIndex)
        );
        const possibleCards = await invokes.gamePossibleCards();
        let selectedIndex = riverSpot.selectedIndex;
        const cards = riverSpot.cards.map((item) => {
          const isDead = !(possibleCards & (1n << BigInt(item.card)));
          if (item.card === selectedIndex && isDead) selectedIndex = -1;
          return {
            ...item,
            isDead,
            isSelected: item.card === selectedIndex,
          };
        });
        nextSpots[riverIndex] = { ...riverSpot, cards, selectedIndex };
      }

      const riverSpot =
        riverIndex === -1 ? null : (nextSpots[riverIndex] as SpotChance);
      const riverSkipped = riverSpot?.selectedIndex === -1;
      const lastIndex = nextSpots.length - 1;
      const lastSpot = nextSpots[lastIndex];
      if (
        !riverSkipped &&
        lastSpot?.type === "terminal" &&
        lastSpot.equityOop !== 0 &&
        lastSpot.equityOop !== 1
      ) {
        await invokes.gameApplyHistory(
          nextSpots.slice(1, -1).map((spot) => spot.selectedIndex)
        );
        const terminalResults = await invokes.gameGetResults();
        nextSpots[lastIndex] = {
          ...lastSpot,
          equityOop: terminalResults.isEmpty
            ? -1
            : average(terminalResults.equity[0], terminalResults.normalizer[0]),
        };
      }

      setSpotsValue(nextSpots);
    }

    if (!needSplice && spotsRef.current[spotIndex].type === "chance") {
      selectedChanceIndexRef.current = spotIndex;
      if (selectedSpotIndexRef.current < spotIndex + 1) {
        selectedSpotIndexRef.current = spotIndex + 1;
      }
    } else {
      selectedSpotIndexRef.current = spotIndex;
      if (spotIndex <= selectedChanceIndexRef.current) {
        selectedChanceIndexRef.current = -1;
      } else if (selectedChanceIndexRef.current === -1) {
        selectedChanceIndexRef.current = spotsRef.current
          .slice(0, spotIndex)
          .findIndex(
            (spot) => spot.type === "chance" && spot.selectedIndex === -1
          );
      }
    }

    const history = currentHistoryFromRefs();

    await invokes.gameApplyHistory(history);
    resultsRef.current = await invokes.gameGetResults();

    let append: number[] = [];
    if (selectedChanceIndexRef.current !== -1) {
      append = spotsRef.current
        .slice(selectedChanceIndexRef.current, selectedSpotIndexRef.current)
        .map((spot) => spot.selectedIndex);
    }

    const nextActions = await invokes.gameActionsAfter(append);
    const canChanceReports =
      selectedChanceIndexRef.current !== -1 &&
      spotsRef.current
        .slice(selectedChanceIndexRef.current + 3, selectedSpotIndexRef.current)
        .every((spot) => spot.type !== "chance") &&
      nextActions[0] !== "chance";

    if (canChanceReports) {
      const player =
        nextActions[0] === "terminal"
          ? "terminal"
          : append.length % 2 === 1
          ? "oop"
          : "ip";
      const numActions = nextActions[0] === "terminal" ? 0 : nextActions.length;
      chanceReportsRef.current = await invokes.gameGetChanceReports(
        append,
        player,
        numActions
      );
    } else {
      chanceReportsRef.current = null;
    }
    totalBetAmountRef.current = await invokes.gameTotalBetAmount([]);
    totalBetAmountAppendedRef.current =
      await invokes.gameTotalBetAmount(append);

    if (needSplice) {
      if (nextActions[0] === "terminal") {
        spliceSpotsTerminal(spotIndex);
      } else if (nextActions[0] === "chance") {
        await spliceSpotsChance(spotIndex);
      } else {
        spliceSpotsPlayer(spotIndex, nextActions);
      }
    }

    const spot = spotsRef.current[selectedSpotIndexRef.current];
    if (
      spot?.type === "player" &&
      selectedChanceIndexRef.current === -1 &&
      resultsRef.current
    ) {
      const playerIndex = spot.player === "oop" ? 0 : 1;
      if (resultsRef.current.isEmpty & (1 << playerIndex)) {
        setRates(null);
      } else {
        const n = cards[playerIndex].length;
        setRates(
          Array.from({ length: spot.actions.length }, (_, i) => {
            const strategy = resultsRef.current!.strategy.slice(
              i * n,
              (i + 1) * n
            );
            return average(
              strategy,
              resultsRef.current!.normalizer[playerIndex]
            );
          })
        );
      }
    } else {
      setRates(null);
    }

    setSelectedSpotIndex(selectedSpotIndexRef.current);
    setSelectedChanceIndex(selectedChanceIndexRef.current);
    lockedRef.current = false;
    emitUpdate();

    window.requestAnimationFrame(() => {
      const selectedChild =
        navRef.current?.children[selectedSpotIndexRef.current];
      selectedChild?.scrollIntoView({ behavior: "smooth", inline: "center" });
    });
  };

  const play = async (spotIndex: number, actionIndex: number) => {
    const nextSpots = [...spotsRef.current];
    const spot = { ...(nextSpots[spotIndex] as SpotPlayer) };
    spot.actions = spot.actions.map((action, index) => ({
      ...action,
      isSelected: index === actionIndex,
    }));
    spot.selectedIndex = actionIndex;
    nextSpots[spotIndex] = spot;
    setSpotsValue(nextSpots);
    await selectSpot(spotIndex + 1, true);
  };

  const deal = async (spotIndex: number, card: number) => {
    const nextSpots = [...spotsRef.current];
    const spot = { ...(nextSpots[spotIndex] as SpotChance) };
    spot.cards = spot.cards.map((item) => ({
      ...item,
      isSelected: item.card === card,
    }));
    spot.selectedIndex = card;
    nextSpots[spotIndex] = spot;
    setSpotsValue(nextSpots);
    await selectSpot(selectedSpotIndexRef.current, false, true);
  };

  useImperativeHandle(ref, () => ({
    dealSelected: async (card: number) => {
      const selectedChanceIndex = selectedChanceIndexRef.current;
      if (selectedChanceIndex === -1) return;
      await deal(selectedChanceIndex, card);
    },
    getSnapshot: () => {
      const results = resultsRef.current;
      if (!results) return null;
      return {
        chanceReports: chanceReportsRef.current,
        currentBoard: currentBoardFromRefs(),
        currentHistory: currentHistoryFromRefs(),
        results,
        selectedChance:
          selectedChanceIndexRef.current === -1
            ? null
            : (spotsRef.current[selectedChanceIndexRef.current] as SpotChance),
        selectedChanceIndex: selectedChanceIndexRef.current,
        selectedSpot:
          selectedSpotIndexRef.current === -1
            ? null
            : spotsRef.current[selectedSpotIndexRef.current],
        selectedSpotIndex: selectedSpotIndexRef.current,
        spots: spotsRef.current,
        totalBetAmount: totalBetAmountRef.current,
      };
    },
    playSelected: async (actionIndex: number) => {
      const selectedSpotIndex = selectedSpotIndexRef.current;
      const selectedSpot = spotsRef.current[selectedSpotIndex];
      if (selectedSpot?.type !== "player") return;
      await play(selectedSpotIndex, actionIndex);
    },
  }));

  useEffect(() => {
    if (dealRequest === null) return;
    const selectedChanceIndex = selectedChanceIndexRef.current;
    if (selectedChanceIndex === -1) {
      onDealHandled();
      return;
    }
    deal(selectedChanceIndex, dealRequest).finally(onDealHandled);
    // Deal requests intentionally call the current navigator state machine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealRequest]);

  useEffect(() => {
    const restoreHistory = async (history: number[]) => {
      for (const selectedIndex of history) {
        const selectedChanceIndex = selectedChanceIndexRef.current;
        const selectedChance =
          selectedChanceIndex === -1
            ? null
            : (spotsRef.current[selectedChanceIndex] as SpotChance | undefined);

        if (
          selectedChance?.type === "chance" &&
          selectedChance.selectedIndex === -1
        ) {
          const card = selectedChance.cards.find(
            (item) => item.card === selectedIndex && !item.isDead
          );
          if (!card) return;
          await deal(selectedChanceIndex, selectedIndex);
          continue;
        }

        const selectedSpot = spotsRef.current[selectedSpotIndexRef.current];
        if (selectedSpot?.type !== "player") return;
        if (
          !Number.isInteger(selectedIndex) ||
          selectedIndex < 0 ||
          selectedIndex >= selectedSpot.actions.length
        ) {
          return;
        }
        await play(selectedSpotIndexRef.current, selectedIndex);
      }
    };

    const init = async () => {
      const l = config.board.length;
      const spot: SpotRoot = {
        type: "root",
        index: 0,
        player: l === 3 ? "flop" : l === 4 ? "turn" : "river",
        selectedIndex: -1,
        board: config.board,
        pot: config.startingPot,
        stack: config.effectiveStack,
      };
      setSpotsValue([spot]);
      selectedSpotIndexRef.current = -1;
      selectedChanceIndexRef.current = -1;
      const shouldRestoreHistory = Boolean(initialHistory?.length);
      restoringRef.current = shouldRestoreHistory;
      try {
        await selectSpot(1, true);
        if (initialHistory?.length) {
          await restoreHistory(initialHistory);
        }
      } finally {
        restoringRef.current = false;
        if (shouldRestoreHistory) {
          emitUpdate();
        }
      }
    };
    init();
    // Result navigation intentionally initializes from the current solved game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spotCards = (spot: SpotRoot | SpotChance) => {
    if (spot.type === "root") return spot.board.map((card) => cardText(card));
    if (spot.selectedIndex === -1) {
      return [{ rank: "?", suit: "", colorClass: "text-black" }];
    }
    return [cardText(spot.selectedIndex)];
  };

  const SpotStats = ({ pot, stack }: { pot: number; stack?: number }) => (
    <div className="border-t border-gray-200 px-1.5 py-1 text-xs font-semibold leading-tight text-gray-500">
      <div>Pot {pot}</div>
      {stack !== undefined && <div>Stack {stack}</div>}
    </div>
  );

  return (
    <div
      className={[
        "snug flex h-[11.5rem] shrink-0 gap-1 overflow-x-auto whitespace-nowrap p-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={navRef}
    >
      {spots.map((spot) => (
        <div
          className={[
            "group flex h-full min-w-[6.5rem] flex-col justify-start rounded-lg border-[3px] bg-white shadow-md transition",
            spot.type === "chance"
              ? "hover:border-red-600"
              : "hover:border-blue-600",
            spot.index === selectedSpotIndex
              ? "cursor-default border-blue-600"
              : readOnly
              ? "cursor-default border-gray-400"
              : "cursor-pointer border-gray-400",
          ].join(" ")}
          key={spot.index}
          onClick={() => {
            if (!readOnly) selectSpot(spot.index, false);
          }}
        >
          {(spot.type === "root" || spot.type === "chance") && (
            <>
              <div className="px-1.5 pb-0.5 pt-1 font-semibold opacity-70 group-hover:opacity-100">
                {spot.player.toUpperCase()}
              </div>
              <div className="flex min-h-0 flex-grow flex-col items-center justify-evenly px-3 font-semibold">
                {spotCards(spot).map((card) => (
                  <span className={card.colorClass} key={card.rank + card.suit}>
                    {card.rank}
                    {card.suit}
                  </span>
                ))}
                {spot.type === "chance" &&
                  spot.index === selectedChanceIndex && (
                    <div className="grid grid-cols-4 gap-1 text-xs">
                      {spot.cards
                        .filter((card) => !card.isDead)
                        .slice(0, 12)
                        .map((card) => {
                          const text = cardText(card.card);
                          return (
                            <button
                              className={[
                                "rounded px-1",
                                card.isSelected
                                  ? "bg-blue-100"
                                  : "hover:bg-gray-100",
                                text.colorClass,
                              ].join(" ")}
                              key={card.card}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (readOnly) return;
                                deal(spot.index, card.card);
                              }}
                              type="button"
                            >
                              {text.rank}
                              {text.suit}
                            </button>
                          );
                        })}
                    </div>
                  )}
              </div>
              <SpotStats
                pot={spot.pot ?? config.startingPot}
                stack={spot.stack}
              />
            </>
          )}

          {spot.type === "player" && (
            <>
              <div
                className={[
                  "px-1.5 py-1 font-semibold group-hover:opacity-100",
                  spot.index === selectedSpotIndex ? "" : "opacity-70",
                ].join(" ")}
              >
                {spot.player.toUpperCase()}
              </div>
              <div className="min-h-0 flex-grow overflow-y-auto px-1">
                {spot.actions.map((action) => (
                  <button
                    className={[
                      "flex w-full rounded-md px-1.5 transition-colors hover:bg-blue-100",
                      action.isSelected ? "bg-blue-100" : "",
                    ].join(" ")}
                    key={action.index}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (onActionClick?.(spot, action.index) === false) {
                        return;
                      }
                      if (readOnly) return;
                      play(spot.index, action.index);
                    }}
                    type="button"
                  >
                    <span className="relative mr-0.5 inline-block w-4">
                      {action.isSelected && (
                        <CheckIcon className="absolute -left-0.5 top-[0.1875rem] h-4 w-4" />
                      )}
                    </span>
                    <span
                      className={[
                        "pr-0.5 font-semibold group-hover:opacity-100",
                        action.isSelected || spot.index === selectedSpotIndex
                          ? ""
                          : "opacity-70",
                      ].join(" ")}
                    >
                      {action.name} {action.amount === "0" ? "" : action.amount}
                    </span>
                    {showRates && rates && spot.index === selectedSpotIndex && (
                      <span className="ml-auto text-xs text-gray-500">
                        {toFixed1((rates[action.index] ?? 0) * 100)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <SpotStats
                pot={spot.pot ?? config.startingPot}
                stack={spot.stack}
              />
            </>
          )}

          {spot.type === "terminal" && (
            <>
              <div
                className={[
                  "px-1.5 pb-0.5 pt-1 font-semibold group-hover:opacity-100",
                  spot.index === selectedSpotIndex ? "" : "opacity-70",
                ].join(" ")}
              >
                END
              </div>
              <div className="flex min-h-0 flex-grow flex-col items-center justify-evenly font-semibold">
                {(spot.equityOop === 0 || spot.equityOop === 1) && (
                  <div className="px-3">
                    {["IP", "OOP"][spot.equityOop]} Wins
                  </div>
                )}
              </div>
              <SpotStats pot={spot.pot} />
            </>
          )}
        </div>
      ))}
    </div>
  );
});

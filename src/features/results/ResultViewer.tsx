import { CheckIcon } from "@heroicons/react/20/solid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "../../app/hooks";
import type {
  ChanceReports,
  Results,
  Spot,
  SpotChance,
  SpotPlayer,
  SpotRoot,
} from "../../result-types";
import * as invokes from "../../invokes";
import {
  average,
  cardPairOrder,
  cardText,
  colorString,
  toFixed1,
  toFixed2,
  toFixedAdaptive,
} from "../../utils";

type DisplayPlayer = "oop" | "ip";

type LoadedResults = {
  cards: number[][];
  chanceReports: ChanceReports | null;
  currentBoard: number[];
  results: Results;
  selectedChance: SpotChance | null;
  selectedSpot: Spot | null;
  totalBetAmount: number[];
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

function pairText(pair: number) {
  const card1 = pair & 0xff;
  const card2 = pair >>> 8;
  if (card2 !== 0xff) {
    return [cardText(card2), cardText(card1)];
  }
  return [cardText(card1)];
}

function actionLabel(action: string) {
  const [name, amount] = action.split(":");
  return amount === "0" ? name : `${name[0]} ${amount}`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ResultTable({
  cards,
  displayPlayer,
  results,
  selectedSpot,
}: {
  cards: number[][];
  displayPlayer: DisplayPlayer;
  results: Results;
  selectedSpot: Spot | null;
}) {
  const playerIndex = displayPlayer === "oop" ? 0 : 1;
  const actions =
    selectedSpot?.type === "player" && selectedSpot.player === displayPlayer
      ? selectedSpot.actions
      : [];
  const numActions = actions.length || 0;

  const rows = useMemo(() => {
    const playerCards = cards[playerIndex] ?? [];
    const ret: number[][] = [];
    for (let i = 0; i < playerCards.length; ++i) {
      const weight = results.weights[playerIndex][i];
      const normalizer = results.normalizer[playerIndex][i];
      if (weight === 0 || normalizer === 0) continue;
      const row = [
        playerCards[i],
        weight,
        normalizer,
        results.equity[playerIndex][i] ?? Number.NaN,
        results.ev[playerIndex][i] ?? Number.NaN,
        results.eqr[playerIndex][i] ?? Number.NaN,
      ];
      for (let action = 0; action < numActions; ++action) {
        const index = action * playerCards.length + i;
        row.push(results.strategy[index] ?? 0);
        row.push(results.actionEv[index] ?? 0);
      }
      ret.push(row);
    }
    ret.sort((a, b) => cardPairOrder(a[0]) - cardPairOrder(b[0]));
    return ret;
  }, [cards, numActions, playerIndex, results]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    let normalizer = 0;
    const ret = rows[0].map(() => 0);
    for (const row of rows) {
      const n = row[2];
      normalizer += n;
      ret[1] += row[1];
      for (let i = 3; i < row.length; ++i) {
        ret[i] += row[i] * n;
      }
    }
    for (let i = 3; i < ret.length; ++i) {
      ret[i] /= normalizer;
    }
    const eqrBase = results.eqrBase[playerIndex];
    ret[5] = ret[4] / (eqrBase * ret[3]);
    if (!isFinite(ret[5])) ret[5] = Number.NaN;
    return ret;
  }, [playerIndex, results.eqrBase, rows]);

  const maxWeight = Math.max(0, ...rows.map((row) => row[1]));
  const exportCsv = () => {
    const headers = [
      "Hand",
      "Weight",
      "EQ",
      "EV",
      "EQR",
      ...actions
        .slice(0, numActions)
        .flatMap((action) => [
          `${
            action.amount === "0"
              ? action.name
              : `${action.name[0]} ${action.amount}`
          } %`,
          `${
            action.amount === "0"
              ? action.name
              : `${action.name[0]} ${action.amount}`
          } EV`,
        ]),
    ];
    const lines = [
      headers.join(","),
      ...rows.map((row) => {
        const hand = pairText(row[0])
          .map((card) => `${card.rank}${card.suitLetter}`)
          .join("");
        return [
          hand,
          row[1],
          row[3],
          row[4],
          row[5],
          ...actions
            .slice(0, numActions)
            .flatMap((_, index) => [
              row[6 + index * 2],
              row[6 + index * 2 + 1],
            ]),
        ].join(",");
      }),
    ];
    downloadText(`results-${displayPlayer}.csv`, lines.join("\n"));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-gray-300 bg-white">
      <div className="flex items-center justify-between border-b border-gray-300 px-3 py-2 text-sm font-semibold">
        <span>
          {displayPlayer.toUpperCase()} hands ({rows.length})
        </span>
        <button
          className="button-base button-blue !px-2 !py-1"
          onClick={exportCsv}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-gray-100">
            <tr>
              <th className="border-b border-gray-300 px-2 py-1 text-left">
                Hand
              </th>
              <th className="border-b border-gray-300 px-2 py-1 text-right">
                Weight
              </th>
              <th className="border-b border-gray-300 px-2 py-1 text-right">
                EQ
              </th>
              <th className="border-b border-gray-300 px-2 py-1 text-right">
                EV
              </th>
              <th className="border-b border-gray-300 px-2 py-1 text-right">
                EQR
              </th>
              {actions.slice(0, numActions).map((action, index) => (
                <th
                  className="border-b border-gray-300 px-2 py-1 text-right"
                  key={`${action.name}-${action.amount}-${index}`}
                >
                  {action.amount === "0"
                    ? action.name
                    : `${action.name[0]} ${action.amount}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary && (
              <tr className="bg-yellow-50 font-semibold">
                <td className="border-b border-gray-200 px-2 py-1">Summary</td>
                <td className="border-b border-gray-200 px-2 py-1 text-right">
                  {toFixed1(summary[1] * 100)}%
                </td>
                <td className="border-b border-gray-200 px-2 py-1 text-right">
                  {toFixed1(summary[3] * 100)}%
                </td>
                <td className="border-b border-gray-200 px-2 py-1 text-right">
                  {toFixedAdaptive(summary[4])}
                </td>
                <td className="border-b border-gray-200 px-2 py-1 text-right">
                  {toFixed1(summary[5] * 100)}%
                </td>
                {actions.slice(0, numActions).map((_, index) => (
                  <td
                    className="border-b border-gray-200 px-2 py-1 text-right"
                    key={index}
                  >
                    {toFixed1(summary[6 + index * 2] * 100)}%
                  </td>
                ))}
              </tr>
            )}
            {rows.map((row) => {
              const cards = pairText(row[0]);
              return (
                <tr className="hover:bg-blue-50" key={row[0]}>
                  <td className="border-b border-gray-100 px-2 py-1">
                    {cards.map((card) => (
                      <span
                        className={card.colorClass}
                        key={card.rank + card.suit}
                      >
                        {card.rank}
                        {card.suit}
                      </span>
                    ))}
                  </td>
                  <td className="border-b border-gray-100 px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className="inline-block h-2 bg-yellow-500"
                        style={{
                          width:
                            maxWeight > 0
                              ? `${(row[1] / maxWeight) * 3}rem`
                              : 0,
                        }}
                      />
                      {toFixed1(row[1] * 100)}%
                    </div>
                  </td>
                  <td className="border-b border-gray-100 px-2 py-1 text-right">
                    {toFixed1(row[3] * 100)}%
                  </td>
                  <td className="border-b border-gray-100 px-2 py-1 text-right">
                    {toFixedAdaptive(row[4])}
                  </td>
                  <td className="border-b border-gray-100 px-2 py-1 text-right">
                    {toFixed1(row[5] * 100)}%
                  </td>
                  {actions.slice(0, numActions).map((_, index) => (
                    <td
                      className="border-b border-gray-100 px-2 py-1 text-right"
                      key={index}
                    >
                      <div>{toFixed1(row[6 + index * 2] * 100)}%</div>
                      <div className="text-xs text-gray-500">
                        {toFixed2(row[6 + index * 2 + 1])}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultNavigator({
  cards,
  onUpdate,
}: {
  cards: number[][];
  onUpdate: (result: Omit<LoadedResults, "cards">) => void;
}) {
  const config = useAppSelector((state) => state.config);
  const navRef = useRef<HTMLDivElement | null>(null);
  const spotsRef = useRef<Spot[]>([]);
  const selectedSpotIndexRef = useRef(-1);
  const selectedChanceIndexRef = useRef(-1);
  const lockedRef = useRef(false);
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

  const selectedSpot =
    selectedSpotIndex === -1 || selectedSpotIndex >= spots.length
      ? null
      : spots[selectedSpotIndex];
  const selectedChance =
    selectedChanceIndex === -1
      ? null
      : (spots[selectedChanceIndex] as SpotChance);
  const isSelectedChanceSkipped = selectedChance?.selectedIndex === -1;
  const currentBoard = useMemo(() => {
    const board = [...config.board];
    const endIndex = selectedChance ? selectedChanceIndex : selectedSpotIndex;
    for (let i = 3; i < endIndex; ++i) {
      const spot = spots[i];
      if (spot.type === "chance") {
        const card = spot.selectedIndex;
        if (card !== -1) board.push(card);
        else return board;
      }
    }
    return board;
  }, [
    config.board,
    selectedChance,
    selectedChanceIndex,
    selectedSpotIndex,
    spots,
  ]);

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
        pot: config.startingPot + betSum,
      },
    ]);
  };

  const spliceSpotsPlayer = (spotIndex: number, actions: string[]) => {
    const prevSpot = spotsRef.current[spotIndex - 1];
    const player = prevSpot.player === "oop" ? "ip" : "oop";
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
        pot: config.startingPot + 2 * totalBetAmountAppendedRef.current[0],
        stack: config.effectiveStack - totalBetAmountAppendedRef.current[0],
      },
      {
        type: "player",
        index: spotIndex + 1,
        player: "oop",
        selectedIndex: -1,
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
    const results = resultsRef.current;
    if (!results) return;
    onUpdate({
      chanceReports: chanceReportsRef.current,
      currentBoard,
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
            isSelectedChanceSkipped &&
            spotIndex > selectedChanceIndexRef.current)))
    ) {
      return;
    }

    if (spotIndex === 0) {
      await selectSpot(1, true);
      return;
    }

    lockedRef.current = true;

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

    const endIndex =
      selectedChanceIndexRef.current === -1
        ? selectedSpotIndexRef.current
        : selectedChanceIndexRef.current;
    const history = spotsRef.current
      .slice(1, endIndex)
      .map((spot) => spot.selectedIndex);

    await invokes.gameApplyHistory(history);
    resultsRef.current = await invokes.gameGetResults();

    let append: number[] = [];
    if (selectedChanceIndexRef.current !== -1) {
      append = spotsRef.current
        .slice(selectedChanceIndexRef.current, selectedSpotIndexRef.current)
        .map((spot) => spot.selectedIndex);
    }

    const nextActions = await invokes.gameActionsAfter(append);
    chanceReportsRef.current = null;
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

  useEffect(() => {
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
      await selectSpot(1, true);
    };
    init();
  }, []);

  const spotCards = (spot: SpotRoot | SpotChance) => {
    if (spot.type === "root") return spot.board.map((card) => cardText(card));
    if (spot.selectedIndex === -1) {
      return [{ rank: "?", suit: "", colorClass: "text-black" }];
    }
    return [cardText(spot.selectedIndex)];
  };

  return (
    <div
      className="snug flex h-[10.5rem] gap-1 overflow-x-auto whitespace-nowrap p-1"
      ref={navRef}
    >
      {spots.map((spot) => (
        <div
          className={[
            "group flex h-full min-w-[5.25rem] flex-col justify-start rounded-lg border-[3px] px-1 py-0.5 shadow-md transition",
            spot.type === "chance"
              ? "hover:border-red-600"
              : "hover:border-blue-600",
            spot.index === selectedSpotIndex
              ? "cursor-default border-blue-600"
              : "cursor-pointer border-gray-400",
          ].join(" ")}
          key={spot.index}
          onClick={() => selectSpot(spot.index, false)}
        >
          {(spot.type === "root" || spot.type === "chance") && (
            <>
              <div className="px-1.5 pb-0.5 pt-1 font-semibold opacity-70 group-hover:opacity-100">
                {spot.player.toUpperCase()}
              </div>
              <div className="flex flex-grow flex-col items-center justify-evenly px-3 font-semibold">
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
              <div className="flex-grow overflow-y-auto">
                {spot.actions.map((action) => (
                  <button
                    className={[
                      "flex w-full rounded-md px-1.5 transition-colors hover:bg-blue-100",
                      action.isSelected ? "bg-blue-100" : "",
                    ].join(" ")}
                    key={action.index}
                    onClick={(event) => {
                      event.stopPropagation();
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
                    {rates && spot.index === selectedSpotIndex && (
                      <span className="ml-auto text-xs text-gray-500">
                        {toFixed1((rates[action.index] ?? 0) * 100)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
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
              <div className="flex flex-grow flex-col items-center justify-evenly font-semibold">
                {(spot.equityOop === 0 || spot.equityOop === 1) && (
                  <div className="px-3">
                    {["IP", "OOP"][spot.equityOop]} Wins
                  </div>
                )}
                <div className="px-3">Pot {spot.pot}</div>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function ResultViewer() {
  const isSolverFinished = useAppSelector(
    (state) => state.app.isSolverFinished
  );
  const [loaded, setLoaded] = useState<LoadedResults | null>(null);
  const [displayPlayer, setDisplayPlayer] = useState<DisplayPlayer>("oop");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSolverFinished) {
      setLoaded(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        await invokes.gameApplyHistory([]);
        const [cards, results, totalBetAmount] = await Promise.all([
          invokes.gamePrivateCards(),
          invokes.gameGetResults(),
          invokes.gameTotalBetAmount([]),
        ]);
        if (!cancelled) {
          setLoaded({
            cards,
            chanceReports: null,
            currentBoard: [],
            results,
            selectedChance: null,
            selectedSpot: null,
            totalBetAmount,
          });
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isSolverFinished]);

  if (!isSolverFinished) {
    return (
      <div className="flex h-full items-center justify-center font-semibold text-gray-500">
        Results will be available after the solver finishes.
      </div>
    );
  }

  if (error) {
    return <div className="p-6 font-semibold text-red-500">Error: {error}</div>;
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="spinner mr-3 inline-block" />
        Loading results...
      </div>
    );
  }

  const oopEv = average(loaded.results.ev[0], loaded.results.normalizer[0]);
  const ipEv = average(loaded.results.ev[1], loaded.results.normalizer[1]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <ResultNavigator
        cards={loaded.cards}
        onUpdate={(result) => setLoaded({ ...result, cards: loaded.cards })}
      />
      <div className="flex items-center justify-between border-b border-gray-300 pb-3">
        <div>
          <div className="text-lg font-semibold">Results</div>
          <div className="text-sm text-gray-600">
            Pot contribution: OOP {loaded.totalBetAmount[0]}, IP{" "}
            {loaded.totalBetAmount[1]} | EV: OOP {toFixedAdaptive(oopEv)}, IP{" "}
            {toFixedAdaptive(ipEv)}
          </div>
        </div>
        <div className="flex rounded border border-gray-300 bg-white p-0.5 text-sm font-semibold">
          {(["oop", "ip"] as const).map((player) => (
            <button
              className={[
                "rounded px-3 py-1",
                displayPlayer === player
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100",
              ].join(" ")}
              key={player}
              onClick={() => setDisplayPlayer(player)}
              type="button"
            >
              {player.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-grow">
        <ResultTable
          cards={loaded.cards}
          displayPlayer={displayPlayer}
          results={loaded.results}
          selectedSpot={loaded.selectedSpot}
        />
      </div>
    </div>
  );
}

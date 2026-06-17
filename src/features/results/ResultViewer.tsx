import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import { useAppSelector } from "../../app/hooks";
import type {
  ChanceReports,
  DisplayMode,
  DisplayOptions,
  HoverContent,
  Results,
  Spot,
  SpotChance,
  SpotPlayer,
} from "../../result-types";
import {
  barHeightList,
  chartChanceList,
  contentBasicsList,
  contentGraphsList,
  playerBasicsList,
  playerChanceList,
  strategyList,
  suitList,
} from "../../result-types";
import { BoardCard } from "../../shared/components/BoardCard";
import * as invokes from "../../invokes";
import { ResultNavigator } from "./ResultNavigator";
import {
  average,
  cardId,
  cardPairCellIndex,
  cardPairOrder,
  cardText,
  colorString,
  ranks,
  toFixed1,
  toFixed2,
  toFixedAdaptive,
} from "../../utils";

ChartJS.register(
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
);

type DisplayPlayer = "oop" | "ip";

type LoadedResults = {
  cards: number[][];
  chanceReports: ChanceReports | null;
  currentBoard: number[];
  currentHistory: number[];
  results: Results;
  selectedChance: SpotChance | null;
  selectedSpot: Spot | null;
  totalBetAmount: number[];
};

const defaultDisplayOptions: DisplayOptions = {
  playerBasics: "auto",
  playerChance: "auto",
  barHeight: "normalized",
  suit: "grouped",
  strategy: "show",
  contentBasics: "default",
  contentGraphs: "eq",
  chartChance: "strategy-combos",
};

const yellow500 = "#eab308";
const sky500 = "#0ea5e9";
const lime500 = "#84cc16";
const chanceSuitColors = ["#16a34a", "#2563eb", "#db2777", "#000000"];
const chanceSuitStacks = ["clubs", "diamonds", "hearts", "spades"];
const resultColorGradient = [
  { red: 0xef, green: 0x44, blue: 0x44 },
  { red: 0xf9, green: 0x73, blue: 0x16 },
  { red: 0xf5, green: 0x9e, blue: 0x0b },
  { red: 0xea, green: 0xb3, blue: 0x08 },
  { red: 0x84, green: 0xcc, blue: 0x16 },
  { red: 0x22, green: 0xc5, blue: 0x5e },
  { red: 0x10, green: 0xb9, blue: 0x81 },
];

function loadDisplayOptions(): DisplayOptions {
  const raw = localStorage.getItem("display-options");
  if (!raw) return defaultDisplayOptions;

  try {
    const saved = JSON.parse(raw) as Partial<DisplayOptions>;
    return {
      playerBasics: playerBasicsList.includes(saved.playerBasics as never)
        ? saved.playerBasics!
        : defaultDisplayOptions.playerBasics,
      playerChance: playerChanceList.includes(saved.playerChance as never)
        ? saved.playerChance!
        : defaultDisplayOptions.playerChance,
      barHeight: barHeightList.includes(saved.barHeight as never)
        ? saved.barHeight!
        : defaultDisplayOptions.barHeight,
      suit: suitList.includes(saved.suit as never)
        ? saved.suit!
        : defaultDisplayOptions.suit,
      strategy: strategyList.includes(saved.strategy as never)
        ? saved.strategy!
        : defaultDisplayOptions.strategy,
      contentBasics: contentBasicsList.includes(saved.contentBasics as never)
        ? saved.contentBasics!
        : defaultDisplayOptions.contentBasics,
      contentGraphs: contentGraphsList.includes(saved.contentGraphs as never)
        ? saved.contentGraphs!
        : defaultDisplayOptions.contentGraphs,
      chartChance: chartChanceList.includes(saved.chartChance as never)
        ? saved.chartChance!
        : defaultDisplayOptions.chartChance,
    };
  } catch {
    return defaultDisplayOptions;
  }
}

function resultColor(
  value: number,
  lowest: number,
  middle: number,
  highest: number
) {
  if (!isFinite(value)) return yellow500;
  if (value <= lowest) return colorString(resultColorGradient[0]);
  if (value > middle && value >= highest) {
    return colorString(resultColorGradient[resultColorGradient.length - 1]);
  }

  const colorRate =
    value <= middle
      ? (value - lowest) / (middle - lowest || 1)
      : (value - middle) / (highest - middle || 1);
  const gradientRate = colorRate * 3 + (value <= middle ? 0 : 3);
  const gradientIndex = Math.max(
    0,
    Math.min(resultColorGradient.length - 2, Math.floor(gradientRate))
  );
  const r = gradientRate - gradientIndex;
  const color1 = resultColorGradient[gradientIndex];
  const color2 = resultColorGradient[gradientIndex + 1];
  return colorString({
    red: Math.floor(color1.red * (1 - r) + color2.red * r),
    green: Math.floor(color1.green * (1 - r) + color2.green * r),
    blue: Math.floor(color1.blue * (1 - r) + color2.blue * r),
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

function pairCards(pair: number) {
  const card1 = pair & 0xff;
  const card2 = pair >>> 8;
  return card2 !== 0xff ? [card2, card1] : [card1];
}

function actionShortLabel(action: SpotPlayer["actions"][number]) {
  return action.amount === "0"
    ? action.name
    : `${action.name[0]} ${action.amount}`;
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

function formatPercent(value: number) {
  return Number.isNaN(value) ? "-" : `${toFixed1(value * 100)}%`;
}

function formatEv(value: number) {
  return Number.isNaN(value) ? "-" : toFixedAdaptive(value);
}

function MiniBar({ values }: { values: number[] }) {
  if (
    values.length < 2 ||
    values.some((value) => Number.isNaN(value)) ||
    (values[0] === 0 && values[1] === 0)
  ) {
    return <div className="h-3 rounded bg-neutral-300" />;
  }
  const total = values[0] + values[1];
  const sep = `${(values[0] * 100) / total}%`;
  return (
    <div
      className="h-3 rounded"
      style={{
        background: `linear-gradient(to right, ${sky500} ${sep}, ${lime500} ${sep})`,
      }}
    />
  );
}

function ResultMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 truncate text-right text-sm font-semibold text-gray-900">
        {value}
      </div>
    </div>
  );
}

function ResultTable({
  cards,
  displayPlayer,
  hoverContent,
  results,
  selectedSpot,
}: {
  cards: number[][];
  displayPlayer: DisplayPlayer;
  hoverContent?: HoverContent | null;
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
      if (hoverContent && !hoverContent.indices.includes(i)) continue;
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
  }, [cards, hoverContent, numActions, playerIndex, results]);

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
          `${actionShortLabel(action)} %`,
          `${actionShortLabel(action)} EV`,
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
          {displayPlayer.toUpperCase()} hands
          {hoverContent ? `: ${hoverContent.name}` : ""} ({rows.length})
        </span>
        <button
          className="button-base button-blue !px-2 !py-1"
          onClick={exportCsv}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-3">
        {summary && (
          <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-semibold text-gray-900">Summary</div>
              <div className="text-xs font-semibold uppercase text-gray-500">
                {rows.length} hands
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ResultMetricCard
                label="Weight"
                value={formatPercent(summary[1])}
              />
              <ResultMetricCard label="EQ" value={formatPercent(summary[3])} />
              <ResultMetricCard label="EV" value={formatEv(summary[4])} />
              <ResultMetricCard label="EQR" value={formatPercent(summary[5])} />
            </div>
            {numActions > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {actions.slice(0, numActions).map((action, index) => (
                  <div
                    className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm"
                    key={`${action.name}-${action.amount}-${index}`}
                    style={{
                      borderLeftColor: action.color,
                      borderLeftWidth: 4,
                    }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {actionShortLabel(action)}
                    </div>
                    <div className="mt-0.5 text-right font-semibold">
                      {formatPercent(summary[6 + index * 2])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-500">
            No matching hands
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {rows.map((row) => {
              const handCards = pairCards(row[0]);
              const handLabel = pairText(row[0])
                .map((card) => `${card.rank}${card.suitLetter}`)
                .join("");
              return (
                <div
                  className="rounded border border-gray-200 bg-white p-3 shadow-sm"
                  key={row[0]}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex shrink-0 gap-1.5">
                        {handCards.map((card) => (
                          <BoardCard
                            aria-label={
                              cardText(card).rank + cardText(card).suitLetter
                            }
                            cardId={card}
                            className="rounded-md"
                            disabled
                            fontSize="0.72rem"
                            key={card}
                            width="34px"
                          />
                        ))}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-gray-900">
                          {handLabel}
                        </div>
                        <div className="text-xs font-semibold uppercase text-gray-500">
                          {displayPlayer.toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <div className="flex w-24 shrink-0 items-center gap-2 pt-1">
                      <div className="h-2 flex-1 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-yellow-500"
                          style={{
                            width:
                              maxWeight > 0
                                ? `${(row[1] / maxWeight) * 100}%`
                                : 0,
                          }}
                        />
                      </div>
                      <div className="w-10 text-right text-xs font-semibold">
                        {formatPercent(row[1])}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <ResultMetricCard
                      label="EQ"
                      value={formatPercent(row[3])}
                    />
                    <ResultMetricCard label="EV" value={formatEv(row[4])} />
                    <ResultMetricCard
                      label="EQR"
                      value={formatPercent(row[5])}
                    />
                  </div>
                  {numActions > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {actions.slice(0, numActions).map((action, index) => (
                        <div
                          className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5"
                          key={`${action.name}-${action.amount}-${index}`}
                          style={{
                            borderLeftColor: action.color,
                            borderLeftWidth: 4,
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              {actionShortLabel(action)}
                            </span>
                            <span className="text-sm font-semibold">
                              {formatPercent(row[6 + index * 2])}
                            </span>
                          </div>
                          <div className="mt-0.5 text-right text-xs text-gray-500">
                            EV {toFixed2(row[6 + index * 2 + 1])}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultMiddle({
  autoPlayerBasics,
  autoPlayerChance,
  chanceMode,
  displayMode,
  displayOptions,
  onDisplayMode,
  onDisplayOptions,
}: {
  autoPlayerBasics: DisplayPlayer;
  autoPlayerChance: DisplayPlayer;
  chanceMode: "" | "turn" | "river";
  displayMode: DisplayMode;
  displayOptions: DisplayOptions;
  onDisplayMode: (mode: DisplayMode) => void;
  onDisplayOptions: (options: DisplayOptions) => void;
}) {
  const updateOptions = (patch: Partial<DisplayOptions>) => {
    const next = { ...displayOptions, ...patch };
    onDisplayOptions(next);
    localStorage.setItem("display-options", JSON.stringify(next));
  };

  const strategyContent = `${displayOptions.strategy},${displayOptions.contentBasics}`;
  const setStrategyContent = (value: string) => {
    const [strategy, contentBasics] = value.split(",") as [
      DisplayOptions["strategy"],
      DisplayOptions["contentBasics"],
    ];
    updateOptions({ strategy, contentBasics });
  };

  return (
    <div className="snug flex h-12 shrink-0 border-y border-gray-500 bg-white">
      {(["basics", "graphs", "compare"] as const).map((mode) => (
        <button
          className={[
            "flex h-full w-[9%] items-center justify-center text-lg font-semibold transition",
            displayMode === mode
              ? chanceMode
                ? "bg-red-100 underline"
                : "bg-blue-100 underline"
              : chanceMode
              ? "hover:bg-red-100"
              : "hover:bg-blue-100",
          ].join(" ")}
          key={mode}
          onClick={() => onDisplayMode(mode)}
          type="button"
        >
          {mode[0].toUpperCase() + mode.slice(1)}
        </button>
      ))}
      <button
        className={[
          "flex h-full w-[9%] items-center justify-center text-lg font-semibold transition enabled:hover:bg-blue-100",
          displayMode === "chance" ? "bg-blue-100 underline" : "",
        ].join(" ")}
        disabled={!chanceMode}
        onClick={() => onDisplayMode("chance")}
        type="button"
      >
        {chanceMode ? chanceMode[0].toUpperCase() + chanceMode.slice(1) : ""}
      </button>

      <div className="ml-auto flex h-full shrink-0 items-center gap-2 px-4">
        {(["basics", "graphs"] as DisplayMode[]).includes(displayMode) && (
          <label className="flex h-full flex-col justify-center text-sm">
            <span>Player:</span>
            <select
              className="w-28 rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
              onChange={(event) =>
                updateOptions({
                  playerBasics: event.target
                    .value as DisplayOptions["playerBasics"],
                })
              }
              value={displayOptions.playerBasics}
            >
              <option value="auto">
                Auto ({autoPlayerBasics.toUpperCase()})
              </option>
              <option value="oop">OOP</option>
              <option value="ip">IP</option>
            </select>
          </label>
        )}

        {displayMode === "chance" && (
          <label className="flex h-full flex-col justify-center text-sm">
            <span>Player:</span>
            <select
              className="w-28 rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
              onChange={(event) =>
                updateOptions({
                  playerChance: event.target
                    .value as DisplayOptions["playerChance"],
                })
              }
              value={displayOptions.playerChance}
            >
              <option value="auto">
                Auto ({autoPlayerChance.toUpperCase()})
              </option>
              <option value="oop">OOP</option>
              <option value="ip">IP</option>
            </select>
          </label>
        )}

        {(["basics", "compare"] as DisplayMode[]).includes(displayMode) && (
          <>
            <label className="flex h-full flex-col justify-center text-sm">
              <span>Bar Height:</span>
              <select
                className="w-28 rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
                onChange={(event) =>
                  updateOptions({
                    barHeight: event.target
                      .value as DisplayOptions["barHeight"],
                  })
                }
                value={displayOptions.barHeight}
              >
                <option value="normalized">Normalized</option>
                <option value="absolute">Absolute</option>
                <option value="full">Full</option>
              </select>
            </label>
            <label className="flex h-full flex-col justify-center text-sm">
              <span>Suit:</span>
              <select
                className="w-[6.25rem] rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
                onChange={(event) =>
                  updateOptions({
                    suit: event.target.value as DisplayOptions["suit"],
                  })
                }
                value={displayOptions.suit}
              >
                <option value="grouped">Grouped</option>
                <option value="individual">Individual</option>
              </select>
            </label>
            <label className="flex h-full flex-col justify-center text-sm">
              <span>Display:</span>
              <select
                className="w-[8.75rem] rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
                onChange={(event) => setStrategyContent(event.target.value)}
                value={strategyContent}
              >
                <option value="show,default">Strategy</option>
                <option value="show,eq">Strategy + EQ</option>
                <option value="show,ev">Strategy + EV</option>
                <option value="show,eqr">Strategy + EQR</option>
                <option value="none,default">Weight</option>
                <option value="none,eq">EQ</option>
                <option value="none,ev">EV</option>
                <option value="none,eqr">EQR</option>
              </select>
            </label>
          </>
        )}

        {displayMode === "graphs" && (
          <label className="flex h-full flex-col justify-center text-sm">
            <span>Display:</span>
            <select
              className="w-20 rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
              onChange={(event) =>
                updateOptions({
                  contentGraphs: event.target
                    .value as DisplayOptions["contentGraphs"],
                })
              }
              value={displayOptions.contentGraphs}
            >
              <option value="eq">EQ</option>
              <option value="ev">EV</option>
              <option value="eqr">EQR</option>
            </select>
          </label>
        )}

        {displayMode === "chance" && (
          <label className="flex h-full flex-col justify-center text-sm">
            <span>Chart:</span>
            <select
              className="w-[10.25rem] rounded-lg border-gray-600 bg-gray-200 px-1 py-0.5 shadow"
              onChange={(event) =>
                updateOptions({
                  chartChance: event.target
                    .value as DisplayOptions["chartChance"],
                })
              }
              value={displayOptions.chartChance}
            >
              <option value="strategy-combos">Strategy (Combos)</option>
              <option value="strategy">Strategy (%)</option>
              <option value="eq">Equity</option>
              <option value="ev">EV</option>
              <option value="eqr">EQR</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function ResultSummary({
  results,
  selectedChance,
  selectedSpot,
}: {
  results: Results;
  selectedChance: SpotChance | null;
  selectedSpot: Spot | null;
}) {
  const player =
    selectedChance || !selectedSpot || selectedSpot.type === "root"
      ? "chance"
      : selectedSpot.type === "terminal"
      ? selectedSpot.prevPlayer
      : selectedSpot.player;
  const combos = [0, 1].map((i) =>
    results.weights[i].reduce(
      (sum, weight, index) => sum + (results.normalizer[i][index] && weight),
      0
    )
  );
  const equity = results.isEmpty
    ? [Number.NaN, Number.NaN]
    : [
        average(results.equity[0], results.normalizer[0]),
        average(results.equity[1], results.normalizer[1]),
      ];
  const ev = results.isEmpty
    ? [Number.NaN, Number.NaN]
    : [
        average(results.ev[0], results.normalizer[0]),
        average(results.ev[1], results.normalizer[1]),
      ];
  const eqr = results.isEmpty
    ? [Number.NaN, Number.NaN]
    : [
        ev[0] / (results.eqrBase[0] * equity[0]),
        ev[1] / (results.eqrBase[1] * equity[1]),
      ].map((value) => (isFinite(value) ? value : Number.NaN));
  const rows = [
    { label: "Combos", values: combos, format: toFixedAdaptive },
    { label: "Equity", values: equity, format: formatPercent },
    { label: "EV", values: ev, format: formatEv },
    { label: "EQR", values: eqr, format: formatPercent },
  ];

  return (
    <div className="flex h-full flex-col gap-2.5 px-2 py-1">
      <div className="flex text-lg font-semibold">
        <div className="flex items-center">
          <span>OOP</span>
          {player === "oop" && <span className="ml-1 text-yellow-500">★</span>}
        </div>
        <div className="flex-grow" />
        <div className="flex items-center">
          {player === "ip" && <span className="mr-1 text-yellow-500">★</span>}
          <span>IP</span>
        </div>
      </div>
      {rows.map((row) => (
        <div className="flex flex-col gap-0.5" key={row.label}>
          <div className="flex">
            <div className="w-16">{row.format(row.values[0])}</div>
            <div className="flex-grow text-center underline">{row.label}</div>
            <div className="w-16 text-right">{row.format(row.values[1])}</div>
          </div>
          <MiniBar values={row.values} />
        </div>
      ))}
    </div>
  );
}

function ResultMatrix({
  cards,
  currentBoard,
  displayOptions,
  displayPlayer,
  isCompareMode,
  onHoverContent,
  results,
  selectedChance,
  selectedSpot,
  totalBetAmount,
}: {
  cards: number[][];
  currentBoard: number[];
  displayOptions: DisplayOptions;
  displayPlayer: DisplayPlayer;
  isCompareMode?: boolean;
  onHoverContent?: (content: HoverContent | null) => void;
  results: Results;
  selectedChance: SpotChance | null;
  selectedSpot: Spot | null;
  totalBetAmount: number[];
}) {
  const playerIndex = displayPlayer === "oop" ? 0 : 1;
  const showStrategy =
    displayOptions.strategy === "show" &&
    selectedSpot?.type === "player" &&
    selectedSpot.player === displayPlayer &&
    !selectedChance &&
    results.numActions > 0;

  const denominator = useMemo(() => {
    const ret = Array.from({ length: 169 }, () => 0);
    for (let card1 = 0; card1 < 52; ++card1) {
      if (currentBoard.includes(card1)) continue;
      for (let card2 = card1 + 1; card2 < 52; ++card2) {
        if (currentBoard.includes(card2)) continue;
        const { row, col } = cardPairCellIndex(card1, card2);
        ret[row * 13 + col] += 1;
      }
    }
    return ret;
  }, [currentBoard]);

  const cellData = useMemo(() => {
    const data = Array.from({ length: 169 }, () => ({
      equity: 0,
      ev: 0,
      indices: [] as number[],
      normalizer: 0,
      strategy: Array.from({ length: results.numActions }, () => 0),
      weight: 0,
    }));
    const playerCards = cards[playerIndex] ?? [];

    for (let i = 0; i < playerCards.length; ++i) {
      const weight = results.weights[playerIndex][i];
      const normalizer = results.normalizer[playerIndex][i];
      if (weight === 0 || normalizer === 0) continue;
      const pair = playerCards[i];
      const card1 = pair & 0xff;
      const card2 = pair >>> 8;
      const { row, col } = cardPairCellIndex(card1, card2);
      const target = data[row * 13 + col];
      target.indices.push(i);
      target.weight += weight;
      target.normalizer += normalizer;
      if (!results.isEmpty) {
        target.equity += results.equity[playerIndex][i] * normalizer;
        target.ev += results.ev[playerIndex][i] * normalizer;
      }
      if (showStrategy) {
        for (let action = 0; action < results.numActions; ++action) {
          target.strategy[action] +=
            results.strategy[action * playerCards.length + i] * normalizer;
        }
      }
    }
    return data;
  }, [cards, playerIndex, results, showStrategy]);

  const maxWeight = Math.max(
    0,
    ...cellData.map((cell, index) =>
      denominator[index] ? cell.weight / denominator[index] : 0
    )
  );

  const cellLabel = (index: number) => {
    const row = Math.floor(index / 13);
    const col = index % 13;
    const r1 = 12 - Math.min(row, col);
    const r2 = 12 - Math.max(row, col);
    return ranks[r1] + ranks[r2] + ["s", "", "o"][Math.sign(row - col) + 1];
  };

  const cellValue = (index: number) => {
    const cell = cellData[index];
    if (cell.weight === 0) return "";
    if (showStrategy && displayOptions.contentBasics === "default") return "";
    if (displayOptions.contentBasics === "eq") {
      if (results.isEmpty) return "-";
      return toFixed1((cell.equity / cell.normalizer) * 100);
    }
    if (displayOptions.contentBasics === "ev") {
      if (results.isEmpty) return "-";
      return toFixedAdaptive(cell.ev / cell.normalizer);
    }
    if (displayOptions.contentBasics === "eqr") {
      if (results.isEmpty) return "-";
      const eqr = cell.ev / (results.eqrBase[playerIndex] * cell.equity);
      return isFinite(eqr) ? toFixed1(eqr * 100) : "-";
    }
    return toFixed1((cell.weight / denominator[index]) * 100);
  };

  const cellBackground = (index: number) => {
    const cell = cellData[index];
    if (cell.weight === 0) return {};
    const denom = denominator[index] || 1;
    const ratio = cell.weight / denom;
    const height =
      displayOptions.barHeight === "full"
        ? 1
        : displayOptions.barHeight === "absolute"
        ? ratio
        : maxWeight > 0
        ? ratio / maxWeight
        : 0;

    if (showStrategy && selectedSpot?.type === "player") {
      let pos = 0;
      const stops = selectedSpot.actions.map((action, actionIndex) => {
        const next = pos + cell.strategy[actionIndex] / cell.normalizer;
        const stop = `${action.color} ${pos * 100}% ${next * 100}%`;
        pos = next;
        return stop;
      });
      return {
        backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
        backgroundSize: `100% ${height * 100}%`,
      };
    }

    let color = yellow500;
    if (!results.isEmpty && displayOptions.contentBasics !== "default") {
      if (displayOptions.contentBasics === "eq") {
        color = resultColor(cell.equity / cell.normalizer, 0, 0.5, 1);
      } else if (displayOptions.contentBasics === "ev") {
        const amountSum =
          Math.min(...totalBetAmount) + totalBetAmount[playerIndex];
        const pot =
          amountSum + Math.max(1, totalBetAmount[0] + totalBetAmount[1]);
        color = resultColor(cell.ev / cell.normalizer, 0, pot / 2, pot);
      } else {
        const eqr = cell.ev / (results.eqrBase[playerIndex] * cell.equity);
        color = resultColor(eqr, 0, 1, 2);
      }
    }
    return {
      backgroundImage: `linear-gradient(${color} 0% 100%)`,
      backgroundSize: `100% ${height * 100}%`,
    };
  };

  return (
    <div className="h-full w-full">
      <table
        className="snug h-full w-full table-fixed select-none"
        onMouseLeave={() => !isCompareMode && onHoverContent?.(null)}
      >
        <tbody>
          {Array.from({ length: 13 }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: 13 }, (_, col) => {
                const index = row * 13 + col;
                const cell = cellData[index];
                const hasWeight = cell.weight > 0;
                const bg = cellBackground(index);
                return (
                  <td
                    className="relative border border-black"
                    key={index}
                    onMouseEnter={() =>
                      !isCompareMode &&
                      onHoverContent?.(
                        hasWeight
                          ? { name: cellLabel(index), indices: cell.indices }
                          : null
                      )
                    }
                  >
                    <div
                      className={[
                        "absolute left-0 top-0 flex h-full w-full bg-left-bottom bg-no-repeat",
                        row === col ? "bg-neutral-700" : "bg-neutral-800",
                      ].join(" ")}
                      style={bg}
                    />
                    <div
                      className={[
                        "absolute -top-px left-[0.1875rem] z-10 text-shadow",
                        hasWeight ? "text-white" : "text-neutral-500",
                      ].join(" ")}
                      style={{ fontSize: "max(0.95rem, min(1.3vw, 2.1vh))" }}
                    >
                      {cellLabel(index)}
                    </div>
                    <div
                      className="absolute bottom-px right-1 z-10 max-w-[calc(100%-0.25rem)] overflow-hidden text-shadow text-white"
                      style={{ fontSize: "max(0.8rem, min(1.05vw, 1.8vh))" }}
                    >
                      {cellValue(index)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultGraphs({
  cards,
  displayOptions,
  displayPlayer,
  results,
}: {
  cards: number[][];
  displayOptions: DisplayOptions;
  displayPlayer: DisplayPlayer;
  results: Results;
}) {
  const chartData = useMemo(() => {
    if (results.isEmpty) return { datasets: [] };
    const content = displayOptions.contentGraphs;
    const datasets = [0, 1].map((playerIndex) => {
      const playerCards = cards[playerIndex] ?? [];
      const values =
        content === "eq"
          ? results.equity[playerIndex]
          : content === "ev"
          ? results.ev[playerIndex]
          : results.eqr[playerIndex].map((value) =>
              isFinite(value) ? value : Number.NaN
            );
      const tuples = playerCards
        .map((pair, index) => ({
          pair,
          value: values[index],
          weight: results.normalizer[playerIndex][index],
        }))
        .filter(
          (_, index) =>
            results.weights[playerIndex][index] > 0 &&
            results.normalizer[playerIndex][index] > 0
        )
        .sort((a, b) =>
          !Number.isNaN(a.value) && !Number.isNaN(b.value)
            ? a.value - b.value || cardPairOrder(a.pair) - cardPairOrder(b.pair)
            : Number.isNaN(a.value)
            ? 1
            : -1
        );
      const total = tuples.reduce((sum, tuple) => sum + tuple.weight, 0) || 1;
      let x = 0;
      const data = tuples.map((tuple) => {
        x += tuple.weight / total;
        return { x, y: tuple.value };
      });
      return {
        backgroundColor: playerIndex === 0 ? sky500 : lime500,
        borderColor: playerIndex === 0 ? sky500 : lime500,
        borderWidth:
          displayPlayer === (playerIndex === 0 ? "oop" : "ip") ? 4 : 2,
        data,
        label: `${playerIndex === 0 ? "OOP" : "IP"} ${
          content === "eq" ? "Equity" : content.toUpperCase()
        }`,
        pointRadius: 0,
        stepped: "middle" as const,
      };
    });
    return { datasets };
  }, [cards, displayOptions.contentGraphs, displayPlayer, results]);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="min-w-0 flex-[4] p-4">
        {results.isEmpty ? (
          <div className="flex h-full items-center justify-center">
            Graphs not available
          </div>
        ) : (
          <Line
            data={chartData}
            options={{
              animation: false,
              maintainAspectRatio: false,
              parsing: false,
              responsive: true,
              scales: {
                x: {
                  max: 1,
                  min: 0,
                  ticks: { format: { style: "percent" } },
                  type: "linear",
                },
                y: {
                  max: displayOptions.contentGraphs === "eq" ? 1 : undefined,
                  min: displayOptions.contentGraphs === "eq" ? 0 : undefined,
                  ticks: {
                    format: {
                      style:
                        displayOptions.contentGraphs === "ev"
                          ? "decimal"
                          : "percent",
                    },
                  },
                },
              },
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-[3]">
        <ResultTable
          cards={cards}
          displayPlayer={displayPlayer}
          results={results}
          selectedSpot={null}
        />
      </div>
    </div>
  );
}

function ResultChance({
  chanceReports,
  displayOptions,
  displayPlayer,
  onDealCard,
  selectedChance,
  selectedSpot,
}: {
  chanceReports: ChanceReports | null;
  displayOptions: DisplayOptions;
  displayPlayer: DisplayPlayer;
  onDealCard: (card: number) => void;
  selectedChance: SpotChance;
  selectedSpot: Spot | null;
}) {
  const chartData = useMemo(() => {
    if (!chanceReports) return null;
    const option = displayOptions.chartChance;
    const playerIndex = displayPlayer === "oop" ? 0 : 1;
    const labels = [...ranks].reverse();
    let datasets;

    if (option === "strategy-combos" || option === "strategy") {
      const isCombos = option === "strategy-combos";
      if (
        chanceReports.currentPlayer === displayPlayer &&
        selectedSpot?.type === "player"
      ) {
        datasets = Array.from(
          { length: chanceReports.numActions * 4 },
          (_, i) => {
            const actionIndex = i >> 2;
            const suit = i & 3;
            const action = selectedSpot.actions[actionIndex];
            return {
              backgroundColor: action.color,
              data: Array.from({ length: 13 }, (_, rank) => {
                const card = cardId(rank, suit);
                if (chanceReports.status[card] === 0) return 0;
                const coef = isCombos
                  ? chanceReports.combos[playerIndex][card]
                  : 1;
                return coef * chanceReports.strategy[actionIndex * 52 + card];
              }).reverse(),
              label:
                action.amount === "0"
                  ? action.name
                  : `${action.name} ${action.amount}`,
              stack: chanceSuitStacks[suit],
            };
          }
        ).reverse();
      } else {
        datasets = Array.from({ length: 4 }, (_, suit) => ({
          backgroundColor: chanceSuitColors[suit],
          data: Array.from({ length: 13 }, (_, rank) => {
            const card = cardId(rank, suit);
            if (chanceReports.status[card] === 0) return 0;
            return isCombos ? chanceReports.combos[playerIndex][card] : 1;
          }).reverse(),
          label: ["Clubs", "Diamonds", "Hearts", "Spades"][suit],
          stack: chanceSuitStacks[suit],
        })).reverse();
      }
    } else {
      const data =
        option === "eq"
          ? chanceReports.equity[playerIndex]
          : option === "ev"
          ? chanceReports.ev[playerIndex]
          : chanceReports.eqr[playerIndex];
      datasets = Array.from({ length: 4 }, (_, suit) => ({
        backgroundColor: chanceSuitColors[suit],
        data: Array.from(
          { length: 13 },
          (_, rank) => data[4 * rank + suit]
        ).reverse(),
        label: ["Clubs", "Diamonds", "Hearts", "Spades"][suit],
        stack: chanceSuitStacks[suit],
      })).reverse();
    }

    return { labels, datasets };
  }, [chanceReports, displayOptions.chartChance, displayPlayer, selectedSpot]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-[4] flex-col items-center gap-[1%] pt-[1%]">
        {Array.from({ length: 4 }, (_, suit) => (
          <div
            className="flex w-full shrink-0 justify-center gap-[1%]"
            key={suit}
          >
            {Array.from({ length: 13 }, (_, rank) => {
              const card = 56 - 4 * (rank + 1) - (suit + 1);
              return (
                <BoardCard
                  cardId={card}
                  className={[
                    "w-[5.5%]",
                    selectedChance.cards[card]?.isDead
                      ? "cursor-default opacity-40 brightness-75"
                      : "",
                  ].join(" ")}
                  isSelected={selectedChance.selectedIndex === card}
                  key={card}
                  onClick={() =>
                    !selectedChance.cards[card]?.isDead && onDealCard(card)
                  }
                />
              );
            })}
          </div>
        ))}
        <div className="min-h-0 w-[84.5%] flex-grow py-3">
          {chartData ? (
            <Bar
              data={chartData}
              options={{
                animation: false,
                maintainAspectRatio: false,
                responsive: true,
                scales: {
                  x: { stacked: true },
                  y: {
                    max:
                      displayOptions.chartChance === "strategy" ? 1 : undefined,
                    min: ["ev", "eqr"].includes(displayOptions.chartChance)
                      ? undefined
                      : 0,
                    stacked: true,
                    ticks: {
                      format: {
                        style: ["strategy", "eq", "eqr"].includes(
                          displayOptions.chartChance
                        )
                          ? "percent"
                          : "decimal",
                      },
                    },
                  },
                },
                plugins: { legend: { display: false } },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-500">
              Chance reports unavailable
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-[3] border-l border-gray-500 p-3">
        <div className="text-lg font-semibold">Chance Summary</div>
        <div className="mt-2 text-sm text-gray-600">
          {selectedChance.player.toUpperCase()} card, display{" "}
          {displayPlayer.toUpperCase()}
        </div>
        {chanceReports && (
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>Available cards</div>
            <div className="text-right">
              {chanceReports.status.filter(Boolean).length}
            </div>
            <div>Current player</div>
            <div className="text-right">{chanceReports.currentPlayer}</div>
            <div>Actions</div>
            <div className="text-right">{chanceReports.numActions}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultViewer() {
  const isSolverFinished = useAppSelector(
    (state) => state.app.isSolverFinished
  );
  const isTrainingResult = useAppSelector(
    (state) => state.app.isTrainingResult
  );
  const [loaded, setLoaded] = useState<LoadedResults | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("basics");
  const [displayOptions, setDisplayOptions] =
    useState<DisplayOptions>(loadDisplayOptions);
  const [hoverContent, setHoverContent] = useState<HoverContent | null>(null);
  const [dealRequest, setDealRequest] = useState<number | null>(null);
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
            currentHistory: [],
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

  const selectedSpot = loaded.selectedSpot;
  const selectedChance = loaded.selectedChance;
  const chanceMode = selectedChance?.player ?? "";
  const autoPlayerBasics: DisplayPlayer = selectedChance
    ? selectedChance.prevPlayer
    : selectedSpot?.type === "terminal"
    ? selectedSpot.prevPlayer
    : selectedSpot?.type === "player"
    ? selectedSpot.player
    : "oop";
  const autoPlayerChance: DisplayPlayer =
    selectedSpot?.type === "terminal"
      ? selectedSpot.prevPlayer
      : selectedSpot?.type === "player"
      ? selectedSpot.player
      : "oop";
  const displayPlayerBasics =
    displayOptions.playerBasics === "auto"
      ? autoPlayerBasics
      : displayOptions.playerBasics;
  const displayPlayerChance =
    displayOptions.playerChance === "auto"
      ? autoPlayerChance
      : displayOptions.playerChance;

  const updateDisplayMode = (mode: DisplayMode) => {
    if (mode === "chance" && !selectedChance) return;
    setDisplayMode(mode);
  };

  const onNavigatorUpdate = (result: Omit<LoadedResults, "cards">) => {
    setLoaded({ ...result, cards: loaded.cards });
    setHoverContent(null);
    if (result.selectedChance && displayMode !== "chance") {
      setDisplayMode("chance");
    } else if (!result.selectedChance && displayMode === "chance") {
      setDisplayMode("basics");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ResultNavigator
        cards={loaded.cards}
        dealRequest={dealRequest}
        onDealHandled={() => setDealRequest(null)}
        onUpdate={onNavigatorUpdate}
        showPotWithoutBets={isTrainingResult}
      />
      <ResultMiddle
        autoPlayerBasics={autoPlayerBasics}
        autoPlayerChance={autoPlayerChance}
        chanceMode={chanceMode}
        displayMode={displayMode}
        displayOptions={displayOptions}
        onDisplayMode={updateDisplayMode}
        onDisplayOptions={setDisplayOptions}
      />

      <div className="min-h-0 flex-grow">
        {displayMode === "basics" && (
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-[4]">
              <ResultMatrix
                cards={loaded.cards}
                currentBoard={loaded.currentBoard}
                displayOptions={displayOptions}
                displayPlayer={displayPlayerBasics}
                onHoverContent={setHoverContent}
                results={loaded.results}
                selectedChance={selectedChance}
                selectedSpot={selectedSpot}
                totalBetAmount={loaded.totalBetAmount}
              />
            </div>
            <div className="min-w-0 flex-[3] border-l border-gray-500">
              <ResultTable
                cards={loaded.cards}
                displayPlayer={displayPlayerBasics}
                hoverContent={hoverContent}
                results={loaded.results}
                selectedSpot={selectedSpot}
              />
            </div>
          </div>
        )}

        {displayMode === "graphs" && (
          <ResultGraphs
            cards={loaded.cards}
            displayOptions={displayOptions}
            displayPlayer={displayPlayerBasics}
            results={loaded.results}
          />
        )}

        {displayMode === "compare" && (
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-[5]">
              <ResultMatrix
                cards={loaded.cards}
                currentBoard={loaded.currentBoard}
                displayOptions={displayOptions}
                displayPlayer="oop"
                isCompareMode
                results={loaded.results}
                selectedChance={selectedChance}
                selectedSpot={selectedSpot}
                totalBetAmount={loaded.totalBetAmount}
              />
            </div>
            <div className="min-w-[13rem] flex-[2] border-x border-gray-500">
              <ResultSummary
                results={loaded.results}
                selectedChance={selectedChance}
                selectedSpot={selectedSpot}
              />
            </div>
            <div className="min-w-0 flex-[5]">
              <ResultMatrix
                cards={loaded.cards}
                currentBoard={loaded.currentBoard}
                displayOptions={displayOptions}
                displayPlayer="ip"
                isCompareMode
                results={loaded.results}
                selectedChance={selectedChance}
                selectedSpot={selectedSpot}
                totalBetAmount={loaded.totalBetAmount}
              />
            </div>
          </div>
        )}

        {displayMode === "chance" && selectedChance && (
          <ResultChance
            chanceReports={loaded.chanceReports}
            displayOptions={displayOptions}
            displayPlayer={displayPlayerChance}
            onDealCard={setDealRequest}
            selectedChance={selectedChance}
            selectedSpot={selectedSpot}
          />
        )}
      </div>
    </div>
  );
}

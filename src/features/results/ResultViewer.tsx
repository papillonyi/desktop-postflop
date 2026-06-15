import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "../../app/hooks";
import type { Results } from "../../result-types";
import * as invokes from "../../invokes";
import {
  average,
  cardPairOrder,
  cardText,
  toFixed1,
  toFixed2,
  toFixedAdaptive,
} from "../../utils";

type DisplayPlayer = "oop" | "ip";

type LoadedResults = {
  actions: string[];
  cards: number[][];
  results: Results;
  totalBetAmount: number[];
};

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

function ResultTable({
  actions,
  cards,
  displayPlayer,
  results,
}: {
  actions: string[];
  cards: number[][];
  displayPlayer: DisplayPlayer;
  results: Results;
}) {
  const playerIndex = displayPlayer === "oop" ? 0 : 1;
  const numActions = results.numActions || 0;

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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-gray-300 bg-white">
      <div className="border-b border-gray-300 px-3 py-2 text-sm font-semibold">
        {displayPlayer.toUpperCase()} hands ({rows.length})
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
                  key={`${action}-${index}`}
                >
                  {actionLabel(action)}
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
        const [cards, actions, results, totalBetAmount] = await Promise.all([
          invokes.gamePrivateCards(),
          invokes.gameActionsAfter([]),
          invokes.gameGetResults(),
          invokes.gameTotalBetAmount([]),
        ]);
        if (!cancelled) {
          setLoaded({ actions, cards, results, totalBetAmount });
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
          actions={loaded.actions}
          cards={loaded.cards}
          displayPlayer={displayPlayer}
          results={loaded.results}
        />
      </div>
    </div>
  );
}

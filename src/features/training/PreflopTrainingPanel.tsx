import { ArrowPathIcon, PlayIcon } from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import * as invokes from "../../invokes";
import type {
  PreflopActionFrequency,
  PreflopDecision,
  PreflopPosition,
  PreflopSummary,
} from "../../invokes";
import { BoardCard } from "../../shared/components/BoardCard";
import { cardText, ranks, toFixed1 } from "../../utils";

const positions: PreflopPosition[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
const displayRanks = [...ranks].reverse();
const rankValues = new Map(ranks.map((rank, index) => [rank, index]));

function formatAction(action: string) {
  if (action === "AllIn") return "All-in";
  return action;
}

function formatPercent(value: number) {
  return `${toFixed1((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function formatCards(cards: number[]) {
  return cards
    .map((card) => {
      const text = cardText(card);
      return `${text.rank}${text.suit}`;
    })
    .join(" ");
}

function cardList(cards: number[]) {
  return (
    <div className="flex gap-1">
      {cards.map((card) => (
        <BoardCard cardId={card} className="h-14 w-10" disabled key={card} />
      ))}
    </div>
  );
}

function actionWeightClass(action: PreflopActionFrequency) {
  if (action.frequency >= 0.67) return "bg-green-500";
  if (action.frequency >= 0.34) return "bg-blue-500";
  if (action.frequency > 0) return "bg-amber-500";
  return "bg-gray-300";
}

function formatRangeSource(source: string) {
  if (source === "direct") return "direct range";
  if (source === "derived") return "derived range";
  return "range unavailable";
}

function normalizeHandClass(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const [firstRaw, secondRaw, suffixRaw] = value.split("");
  const first = firstRaw?.toUpperCase();
  const second = secondRaw?.toUpperCase();
  const suffix = suffixRaw?.toLowerCase();
  const firstValue = rankValues.get(first);
  const secondValue = rankValues.get(second);

  if (firstValue === undefined || secondValue === undefined) return null;
  if (first === second) return `${first}${second}`;
  if (suffix !== "s" && suffix !== "o") return null;

  const high = firstValue > secondValue ? first : second;
  const low = firstValue > secondValue ? second : first;
  return `${high}${low}${suffix}`;
}

function parseRangeWeights(range: string) {
  const weights = new Map<string, number>();
  for (const part of range.split(/[,\s]+/).map((value) => value.trim())) {
    if (!part) continue;
    const [rawHand, rawWeight = "1"] = part.split(":");
    const handClass = normalizeHandClass(rawHand);
    const weight = Number.parseFloat(rawWeight);
    if (!handClass || !Number.isFinite(weight)) continue;
    weights.set(handClass, Math.max(0, Math.min(1, weight)));
  }
  return weights;
}

function cellHandClass(rowIndex: number, colIndex: number) {
  const rowRank = displayRanks[rowIndex];
  const colRank = displayRanks[colIndex];
  if (rowRank === colRank) return `${rowRank}${colRank}`;
  return colIndex > rowIndex
    ? `${rowRank}${colRank}s`
    : `${colRank}${rowRank}o`;
}

function rangeCellClass(weight: number) {
  if (weight >= 0.67) return "bg-green-500 text-white";
  if (weight >= 0.34) return "bg-blue-500 text-white";
  if (weight > 0) return "bg-amber-400 text-gray-950";
  return "bg-gray-100 text-gray-400";
}

function RangeMatrix({ range }: { range: string }) {
  const weights = parseRangeWeights(range);

  return (
    <table className="mt-2 w-full table-fixed border-collapse text-[0.56rem] font-semibold leading-none">
      <tbody>
        {displayRanks.map((rank, rowIndex) => (
          <tr key={rank}>
            {displayRanks.map((_, colIndex) => {
              const handClass = cellHandClass(rowIndex, colIndex);
              const weight = weights.get(handClass) ?? 0;
              return (
                <td
                  className={[
                    "h-5 border border-white text-center align-middle",
                    rangeCellClass(weight),
                  ].join(" ")}
                  key={handClass}
                  title={`${handClass} ${formatPercent(weight)}`}
                >
                  {handClass}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PreflopTrainingPanel() {
  const [summary, setSummary] = useState<PreflopSummary | null>(null);
  const [heroPosition, setHeroPosition] = useState<PreflopPosition>("BTN");
  const [decision, setDecision] = useState<PreflopDecision | null>(null);
  const [selectedAction, setSelectedAction] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [startingDecision, setStartingDecision] = useState(false);
  const [error, setError] = useState("");

  const reloadSummary = async () => {
    setLoadingSummary(true);
    try {
      setSummary(await invokes.preflopSummary());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSummary(false);
    }
  };

  const startDecision = async () => {
    setStartingDecision(true);
    try {
      const nextDecision = await invokes.preflopDecisionStart({
        heroPosition,
      });
      setDecision(nextDecision);
      setSelectedAction("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingDecision(false);
    }
  };

  useEffect(() => {
    void reloadSummary();
    // Initial summary load intentionally uses the default local range root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revealed = Boolean(decision && selectedAction);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="border-b border-gray-300 bg-white px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm font-semibold">
            <span>Hero</span>
            <select
              className="mt-1 rounded border-gray-300 text-sm"
              onChange={(event) =>
                setHeroPosition(event.target.value as PreflopPosition)
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
          <button
            className="button-base button-blue flex items-center gap-2"
            disabled={startingDecision}
            onClick={startDecision}
            type="button"
          >
            <PlayIcon className="h-5 w-5" />
            New Decision
          </button>
          <button
            className="button-base button-blue flex items-center gap-2"
            disabled={loadingSummary}
            onClick={reloadSummary}
            type="button"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Reload
          </button>
        </div>
        {summary && (
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
            <span>{summary.decisionNodeCount} decision nodes</span>
            <span>{summary.rangeFileCount} range files</span>
            <span>
              {heroPosition}: {summary.heroDecisionCounts[heroPosition] ?? 0}
            </span>
            <span>{summary.root}</span>
          </div>
        )}
        {error && (
          <div className="mt-3 text-sm font-semibold text-red-600">{error}</div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] gap-4 p-4">
        <main className="min-h-0 overflow-auto rounded border border-gray-300 bg-white p-4">
          {decision ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-500">
                    {decision.nodePath}
                  </div>
                  <div className="mt-1 text-2xl font-semibold">
                    {decision.heroPosition} {decision.handClass}
                  </div>
                </div>
                <div className="text-right text-sm text-gray-600">
                  <div>{formatCards(decision.handCards)}</div>
                  <div>{cardList(decision.handCards)}</div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  Action History
                </div>
                {decision.history.length === 0 ? (
                  <div className="text-sm font-semibold text-gray-500">
                    First action
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {decision.history.map((item, index) => (
                      <div
                        className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                        key={`${item.actor}-${item.action}-${index}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                          <span>
                            {item.actor} {formatAction(item.action)}
                          </span>
                          <span className="text-xs uppercase text-gray-500">
                            {formatRangeSource(item.rangeSource)}
                          </span>
                        </div>
                        {item.range ? (
                          <RangeMatrix range={item.range} />
                        ) : (
                          <div className="mt-2 text-xs font-semibold text-gray-500">
                            No range file found for this branch.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  Actions
                </div>
                <div className="flex flex-wrap gap-2">
                  {decision.actions.map((action) => (
                    <button
                      className={[
                        "button-base flex min-w-[7rem] items-center justify-center",
                        selectedAction === action.action
                          ? "button-green"
                          : "button-blue",
                      ].join(" ")}
                      key={action.action}
                      onClick={() => setSelectedAction(action.action)}
                      type="button"
                    >
                      {formatAction(action.action)}
                    </button>
                  ))}
                </div>
              </div>

              {revealed && (
                <div className="rounded border border-gray-300">
                  <div className="border-b border-gray-200 px-4 py-3">
                    <div className="text-sm font-semibold text-gray-500">
                      Selected
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatAction(selectedAction)}
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {decision.actions.map((action) => (
                      <div
                        className={[
                          "grid grid-cols-[7rem_minmax(0,1fr)_5rem] items-center gap-3 px-4 py-2 text-sm",
                          selectedAction === action.action
                            ? "bg-blue-50 font-semibold"
                            : "",
                        ].join(" ")}
                        key={action.action}
                      >
                        <span>
                          {formatAction(action.action)}
                          {action.inferred && (
                            <span className="ml-1 text-xs font-semibold text-amber-700">
                              inferred
                            </span>
                          )}
                        </span>
                        <div className="h-2 rounded bg-gray-100">
                          <div
                            className={[
                              "h-2 rounded",
                              actionWeightClass(action),
                            ].join(" ")}
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(100, action.frequency * 100)
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-right">
                          {formatPercent(action.frequency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[20rem] items-center justify-center text-gray-500">
              No decision loaded.
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-auto rounded border border-gray-300 bg-white p-4">
          <div className="text-sm font-semibold uppercase text-gray-500">
            Range Notes
          </div>
          {decision ? (
            <div className="mt-4 flex flex-col gap-3 text-sm text-gray-600">
              {decision.notes.map((note) => (
                <div
                  className="rounded border border-gray-200 bg-gray-50 p-3"
                  key={note}
                >
                  {note}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 text-sm text-gray-500">
              Range derivation appears after a decision.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

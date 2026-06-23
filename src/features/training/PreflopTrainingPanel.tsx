import { ArrowPathIcon, PlayIcon } from "@heroicons/react/24/solid";
import { useEffect, useMemo, useState } from "react";
import * as invokes from "../../invokes";
import type {
  PreflopActionHistoryItem,
  PreflopDrillAction,
  PreflopDrillNode,
  PreflopSummary,
} from "../../invokes";
import { ranks, toFixed1 } from "../../utils";
import {
  buildRangePaneEntries,
  buildPreflopTimelineEntries,
  frequencyFillPercent,
} from "./preflopTrainingUi";

const displayRanks = [...ranks].reverse();
const rankValues = new Map(ranks.map((rank, index) => [rank, index]));

type PreflopDrillState = {
  root: string;
  history: PreflopActionHistoryItem[];
  node: PreflopDrillNode | null;
  terminal: boolean;
  notes: string[];
};

function formatAction(action: string) {
  if (action === "AllIn") return "All-in";
  return action;
}

function formatPercent(value: number) {
  return `${toFixed1((Number.isFinite(value) ? value : 0) * 100)}%`;
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

function RangeMatrix({
  range,
  reachRange,
}: {
  range: string;
  reachRange?: string | null;
}) {
  const weights = parseRangeWeights(range);
  const reachWeights = reachRange ? parseRangeWeights(reachRange) : null;

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed border-collapse text-[0.6rem] font-semibold leading-none sm:text-[0.56rem]">
        <tbody>
          {displayRanks.map((rank, rowIndex) => (
            <tr key={rank}>
              {displayRanks.map((_, colIndex) => {
                const handClass = cellHandClass(rowIndex, colIndex);
                const weight = weights.get(handClass) ?? 0;
                const reachWeight = reachWeights?.get(handClass) ?? null;
                const canReach = reachWeights
                  ? (reachWeight ?? 0) > 0
                  : true;
                const displayWeight = canReach ? weight : 0;
                const title = canReach
                  ? `${handClass} ${formatPercent(displayWeight)}`
                  : `${handClass} cannot reach this node`;

                return (
                  <td
                    className={[
                      "relative h-[1.55rem] w-[1.9rem] min-w-[1.9rem] overflow-hidden border border-gray-900 bg-white p-0 text-center align-middle text-gray-950 sm:h-[1.35rem] sm:w-[1.65rem] sm:min-w-[1.65rem]",
                      canReach ? "" : "bg-gray-100 text-gray-400",
                    ].join(" ")}
                    key={handClass}
                    title={title}
                  >
                    {canReach && displayWeight > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 bg-yellow-300"
                        style={{ height: frequencyFillPercent(displayWeight) }}
                      />
                    )}
                    <span className="relative z-10">{handClass}</span>
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

function RangePanel({
  emptyText,
  range,
  rangeSource,
  reachRange,
  subtitle,
  title,
}: {
  emptyText?: string;
  range: string | null;
  rangeSource: string;
  reachRange?: string | null;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="rounded border border-gray-300 bg-white p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-950">{title}</div>
          {subtitle && (
            <div className="text-xs font-semibold text-gray-500">{subtitle}</div>
          )}
        </div>
        <span className="text-xs font-semibold uppercase text-gray-500">
          {formatRangeSource(rangeSource)}
        </span>
      </div>
      {range ? (
        <RangeMatrix range={range} reachRange={reachRange} />
      ) : (
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-sm font-semibold text-gray-500">
          {emptyText ?? "No range file found for this branch."}
        </div>
      )}
    </section>
  );
}

function ActionChoices({
  actions,
  activeAction,
  busy,
  onChoose,
  onPreview,
  onPreviewEnd,
}: {
  actions: PreflopDrillAction[];
  activeAction: string | null;
  busy: boolean;
  onChoose: (action: PreflopDrillAction) => void;
  onPreview: (action: string) => void;
  onPreviewEnd: (action: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {actions.map((action) => {
        const active = action.action === activeAction;
        return (
          <button
            aria-checked={active}
            className={[
              "rounded border px-2.5 py-1 text-xs font-semibold transition-colors",
              active
                ? "border-blue-600 bg-blue-50 text-blue-800"
                : "border-gray-300 bg-white text-gray-800 hover:border-blue-400",
            ].join(" ")}
            disabled={busy}
            key={action.action}
            onBlur={() => onPreviewEnd(action.action)}
            onClick={() => onChoose(action)}
            onFocus={() => onPreview(action.action)}
            onMouseEnter={() => onPreview(action.action)}
            onMouseLeave={() => onPreviewEnd(action.action)}
            role="radio"
            type="button"
          >
            <span>{formatAction(action.action)}</span>
            <span className="ml-1 text-gray-500">
              {formatPercent(action.frequency)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DrillTimeline({
  activeAction,
  busy,
  currentNode,
  history,
  onChoose,
  onPreview,
  onPreviewEnd,
  terminal,
}: {
  activeAction: string | null;
  busy: boolean;
  currentNode: PreflopDrillNode | null;
  history: PreflopActionHistoryItem[];
  onChoose: (action: PreflopDrillAction) => void;
  onPreview: (action: string) => void;
  onPreviewEnd: (action: string) => void;
  terminal: boolean;
}) {
  const entries = buildPreflopTimelineEntries(
    history,
    currentNode?.actor ?? null,
    terminal
  );

  if (entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm font-semibold text-gray-500">
        Start a hand to begin at UTG.
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-300 bg-white">
      <div className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600">
        Preflop line
      </div>
      <div className="divide-y divide-gray-100">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const historyItem =
            entry.kind === "history" ? history[entry.historyIndex] : null;

          return (
            <div
              className="grid grid-cols-[5.8rem_1.25rem_minmax(0,1fr)] items-start gap-2 px-3 py-2 sm:grid-cols-[7rem_1.5rem_minmax(0,1fr)]"
              key={entry.key}
            >
              <div className="text-right">
                <div className="text-xs font-semibold text-gray-500">
                  {entry.actor}
                </div>
                {entry.action && (
                  <div className="mt-1 inline-flex rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-950">
                    {formatAction(entry.action)}
                  </div>
                )}
              </div>
              <div className="flex h-full flex-col items-center">
                <span
                  className={[
                    "mt-1 h-2.5 w-2.5 rounded-full border",
                    entry.active
                      ? "border-blue-600 bg-blue-600"
                      : "border-gray-400 bg-white",
                  ].join(" ")}
                />
                {!isLast && <span className="mt-1 w-px flex-1 bg-gray-300" />}
              </div>
              <div className="min-w-0">
                {entry.kind === "current" && currentNode ? (
                  <ActionChoices
                    actions={currentNode.actions}
                    activeAction={activeAction}
                    busy={busy}
                    onChoose={onChoose}
                    onPreview={onPreview}
                    onPreviewEnd={onPreviewEnd}
                  />
                ) : entry.kind === "terminal" ? (
                  <div className="text-sm font-semibold text-green-700">
                    Preflop action complete
                  </div>
                ) : (
                  <div className="text-xs font-semibold uppercase text-gray-500">
                    {historyItem
                      ? formatRangeSource(historyItem.rangeSource)
                      : "action"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PreflopTrainingPanel() {
  const [summary, setSummary] = useState<PreflopSummary | null>(null);
  const [drill, setDrill] = useState<PreflopDrillState | null>(null);
  const [previewActionName, setPreviewActionName] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [startingDrill, setStartingDrill] = useState(false);
  const [acting, setActing] = useState(false);
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

  const startDrill = async () => {
    setStartingDrill(true);
    try {
      const nextDrill = await invokes.preflopDrillStart();
      setDrill(nextDrill);
      setPreviewActionName(nextDrill.node.actions[0]?.action ?? "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingDrill(false);
    }
  };

  const chooseAction = async (action: PreflopDrillAction) => {
    const currentNode = drill?.node;
    if (!drill || !currentNode || acting) return;

    const currentDrill = drill;
    setActing(true);
    try {
      const advance = await invokes.preflopDrillAct({
        nodePath: currentNode.nodePath,
        action: action.action,
      });
      setDrill({
        root: currentDrill.root,
        history: [...currentDrill.history, advance.selectedAction],
        node: advance.node,
        terminal: advance.terminal,
        notes: currentDrill.notes,
      });
      setPreviewActionName(advance.node?.actions[0]?.action ?? "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  };

  useEffect(() => {
    void reloadSummary();
    // Initial summary load intentionally uses the default local range root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentNode = drill?.node ?? null;
  const previewAction =
    currentNode?.actions.find((action) => action.action === previewActionName) ??
    currentNode?.actions[0] ??
    null;
  const busy = startingDrill || acting;
  const rangePaneEntries = useMemo(
    () =>
      buildRangePaneEntries(
        currentNode && previewAction
          ? {
              actor: currentNode.actor,
              action: formatAction(previewAction.action),
              frequency: previewAction.frequency,
              range: previewAction.range,
              rangeSource: previewAction.rangeSource,
              reachRange: currentNode.reachRange,
            }
          : null,
        (drill?.history ?? []).map((item) => ({
          ...item,
          action: formatAction(item.action),
        }))
      ),
    [currentNode, drill?.history, previewAction]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-100">
      <div className="border-b border-gray-300 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="button-base button-blue inline-flex min-h-[2.5rem] items-center gap-2"
            disabled={startingDrill}
            onClick={startDrill}
            type="button"
          >
            <PlayIcon className="h-5 w-5" />
            New Hand
          </button>
          <button
            className="button-base button-blue inline-flex min-h-[2.5rem] items-center gap-2"
            disabled={loadingSummary}
            onClick={reloadSummary}
            type="button"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Reload
          </button>
          {summary && (
            <div className="flex flex-wrap gap-3 text-xs font-semibold text-gray-500">
              <span>{summary.decisionNodeCount} nodes</span>
              <span>{summary.rangeFileCount} ranges</span>
              <span>UTG starts {summary.heroDecisionCounts.UTG ?? 0}</span>
              <span className="break-all">{summary.root}</span>
            </div>
          )}
        </div>
        {error && (
          <div className="mt-2 text-sm font-semibold text-red-600">{error}</div>
        )}
      </div>

      <main className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto grid max-w-[1400px] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0">
            <section className="rounded border border-gray-300 bg-white p-3">
              <DrillTimeline
                activeAction={previewAction?.action ?? null}
                busy={busy}
                currentNode={currentNode}
                history={drill?.history ?? []}
                onChoose={(action) => void chooseAction(action)}
                onPreview={setPreviewActionName}
                onPreviewEnd={(actionName) =>
                  setPreviewActionName((current) =>
                    current === actionName
                      ? currentNode?.actions[0]?.action ?? ""
                      : current
                  )
                }
                terminal={drill?.terminal ?? false}
              />
            </section>

            {!drill && (
              <section className="mt-3 rounded border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm font-semibold text-gray-500">
                Start a new hand to drill preflop ranges from UTG.
              </section>
            )}

            {drill && drill.notes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-gray-500">
                {drill.notes.map((note) => (
                  <span
                    className="rounded border border-gray-200 bg-white px-2 py-1"
                    key={note}
                  >
                    {note}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 lg:max-h-[calc(100vh-8rem)] lg:overflow-auto">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-700">
                Derived ranges
              </div>
              {rangePaneEntries.length > 0 && (
                <div className="text-xs font-semibold text-gray-500">
                  {rangePaneEntries.length} matrices
                </div>
              )}
            </div>
            {rangePaneEntries.length > 0 ? (
              <div className="flex flex-col gap-3">
                {rangePaneEntries.map((entry, index) => (
                  <RangePanel
                    emptyText={
                      entry.kind === "current"
                        ? "No range file found for this action."
                        : undefined
                    }
                    key={`${entry.kind}-${entry.title}-${index}`}
                    range={entry.range}
                    rangeSource={entry.rangeSource}
                    reachRange={entry.reachRange}
                    subtitle={entry.subtitle}
                    title={entry.title}
                  />
                ))}
              </div>
            ) : (
              <section className="rounded border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm font-semibold text-gray-500">
                Action ranges appear here as you drill the preflop line.
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

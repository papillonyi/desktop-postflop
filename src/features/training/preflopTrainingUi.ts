export type PreflopTimelineHistoryItem = {
  actor: string;
  action: string;
};

export type PreflopRangeHistoryItem = PreflopTimelineHistoryItem & {
  range: string | null;
  rangeSource: string;
  reachRange?: string | null;
};

export type PreflopCurrentRangeItem = PreflopRangeHistoryItem & {
  frequency: number;
};

export type PreflopRangePaneEntry = {
  kind: "current" | "history";
  range: string | null;
  rangeSource: string;
  reachRange?: string | null;
  subtitle: string;
  title: string;
};

export type PreflopTimelineEntry =
  | {
      actor: string;
      action: string;
      active: false;
      historyIndex: number;
      key: string;
      kind: "history";
    }
  | {
      actor: string;
      action: null;
      active: true;
      historyIndex: null;
      key: string;
      kind: "current";
    }
  | {
      actor: "Terminal";
      action: "Complete";
      active: false;
      historyIndex: null;
      key: string;
      kind: "terminal";
    };

export function frequencyFillPercent(frequency: number) {
  const clamped = Math.max(
    0,
    Math.min(1, Number.isFinite(frequency) ? frequency : 0)
  );
  const percent = Math.round(clamped * 1000) / 10;
  return `${percent}%`;
}

export function buildPreflopTimelineEntries(
  history: PreflopTimelineHistoryItem[],
  currentActor?: string | null,
  terminal = false
): PreflopTimelineEntry[] {
  const entries: PreflopTimelineEntry[] = history.map((item, index) => ({
    actor: item.actor,
    action: item.action,
    active: false,
    historyIndex: index,
    key: `${index}-${item.actor}-${item.action}`,
    kind: "history",
  }));

  if (currentActor) {
    entries.push({
      actor: currentActor,
      action: null,
      active: true,
      historyIndex: null,
      key: `current-${currentActor}`,
      kind: "current",
    });
  } else if (terminal && history.length > 0) {
    entries.push({
      actor: "Terminal",
      action: "Complete",
      active: false,
      historyIndex: null,
      key: "terminal-complete",
      kind: "terminal",
    });
  }

  return entries;
}

export function buildRangePaneEntries(
  current: PreflopCurrentRangeItem | null,
  history: PreflopRangeHistoryItem[]
): PreflopRangePaneEntry[] {
  const entries: PreflopRangePaneEntry[] = [];

  if (current) {
    entries.push({
      kind: "current",
      range: current.range,
      rangeSource: current.rangeSource,
      reachRange: current.reachRange,
      subtitle: `${frequencyFillPercent(current.frequency)} of reachable hands`,
      title: `${current.actor} ${current.action}`,
    });
  }

  entries.push(
    ...history.map((item, index) => ({
      kind: "history" as const,
      range: item.range,
      rangeSource: item.rangeSource,
      reachRange: item.reachRange,
      subtitle: `Step ${index + 1}`,
      title: `${item.actor} ${item.action}`,
    }))
  );

  return entries;
}

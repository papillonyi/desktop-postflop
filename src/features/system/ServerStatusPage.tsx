import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import * as invokes from "../../invokes";

type LoadState =
  | { status: "loading"; data: invokes.ServerStatus | null; error: null }
  | { status: "ready"; data: invokes.ServerStatus; error: null }
  | { status: "error"; data: invokes.ServerStatus | null; error: string };

type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
};

function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-semibold uppercase text-gray-500">
        {label}
      </div>
      <div className="mt-1 break-words text-2xl font-semibold text-gray-900">
        {value}
      </div>
      {detail && <div className="mt-1 text-sm text-gray-500">{detail}</div>}
    </div>
  );
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let scaled = value;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${
    units[unitIndex]
  }`;
}

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatUnixSeconds(value: number) {
  return new Date(value * 1000).toLocaleString();
}

export function ServerStatusPage() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });

  const loadStatus = useCallback(async () => {
    try {
      const data = await invokes.serverStatus();
      setState({ status: "ready", data, error: null });
    } catch (err) {
      setState((current) => ({
        status: "error",
        data: current.data,
        error: err instanceof Error ? err.message : "Unable to reach server",
      }));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const data = state.data;
  const memoryUsed =
    data === null ? 0 : Math.max(0, data.memory.total - data.memory.available);
  const memoryPercent =
    data === null || data.memory.total === 0
      ? 0
      : Math.round((memoryUsed / data.memory.total) * 100);
  const failureRate =
    data === null || data.requests.completed === 0
      ? 0
      : (data.requests.failed / data.requests.completed) * 100;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={[
              "h-3 w-3 rounded-full",
              state.status === "error" ? "bg-red-500" : "bg-green-500",
            ].join(" ")}
          />
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {state.status === "error" ? "Offline" : "Online"}
            </div>
            <div className="text-sm text-gray-500">
              {data
                ? `Last sample: ${formatUnixSeconds(data.nowUnixSeconds)}`
                : ""}
            </div>
          </div>
        </div>
        <button
          className="button-base button-blue inline-flex items-center gap-2"
          onClick={() => void loadStatus()}
          type="button"
        >
          <ArrowPathIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {state.status === "error" && (
        <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {state.error}
        </div>
      )}

      {data === null ? (
        <div className="flex items-center text-sm text-gray-600">
          <span className="spinner mr-3 inline-block" />
          Loading server status...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Status" value={data.status.toUpperCase()} />
            <MetricCard
              label="Uptime"
              value={formatDuration(data.uptimeSeconds)}
              detail={`Version ${data.version}`}
            />
            <MetricCard
              label="Threads"
              value={data.threadPool.threads.toString()}
              detail="Solver pool"
            />
            <MetricCard
              label="Requests"
              value={data.requests.total.toLocaleString()}
              detail={`${data.requests.inFlight} in flight`}
            />
            <MetricCard
              label="Failures"
              value={data.requests.failed.toLocaleString()}
              detail={`${failureRate.toFixed(2)}% of completed requests`}
            />
            <MetricCard
              label="Avg Latency"
              value={`${data.requests.averageLatencyMs.toFixed(2)} ms`}
              detail={`${data.requests.totalLatencyMs.toLocaleString()} ms total`}
            />
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white px-4 py-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold text-gray-700">Memory</span>
              <span className="text-gray-600">{memoryPercent}% used</span>
            </div>
            <div className="h-3 overflow-hidden rounded bg-gray-100">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${memoryPercent}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {formatBytes(memoryUsed)} used / {formatBytes(data.memory.total)}{" "}
              total
            </div>
          </div>
        </>
      )}
    </div>
  );
}

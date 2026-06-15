import { ChanceReports, Results } from "./result-types";

const API_BASE = "/api";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function apiGetBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

type ValueResp<T> = { value: T };

const downloadFilename = (path: string) =>
  path.split(/[\\/]/).pop() || "desktop-postflop-game.bin";

async function pickAndUploadGameFile() {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bin,application/octet-stream";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/game/file`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`POST /game/file failed: ${res.status} ${res.statusText}`);
  }
}

export const osName = async (): Promise<"windows" | "macos" | "linux"> => {
  const { os_name } = await apiGet<{ os_name: "windows" | "macos" | "linux" }>(
    "/system/os-name"
  );
  return os_name;
};

export const memory = async (): Promise<number[]> => {
  const resp = await apiGet<{ available: number; total: number }>(
    "/system/memory"
  );
  return [resp.available, resp.total];
};

export const setNumThreads = async (numThreads: number) => {
  await apiPost("/system/threads", { num_threads: numThreads });
};

/* Ranges */

export const rangeNumCombos = async (player: number): Promise<number> => {
  const resp = await apiGet<ValueResp<number>>(`/range/${player}/num-combos`);
  return resp.value;
};

export const rangeClear = async (player: number) => {
  await apiPost(`/range/${player}/clear`);
};

export const rangeInvert = async (player: number) => {
  await apiPost(`/range/${player}/invert`);
};

export const rangeUpdate = async (
  player: number,
  row: number,
  col: number,
  weight: number
) => {
  await apiPost(`/range/${player}/update`, { row, col, weight });
};

export const rangeFromString = async (
  player: number,
  str: string
): Promise<string | null> => {
  const resp = await apiPost<{ error: string | null }>(
    `/range/${player}/from-string`,
    {
      str,
    }
  );
  return resp.error;
};

export const rangeToString = async (player: number): Promise<string> => {
  const resp = await apiGet<ValueResp<string>>(`/range/${player}/to-string`);
  return resp.value;
};

export const rangeGetWeights = async (player: number): Promise<number[]> => {
  const resp = await apiGet<ValueResp<number[]>>(`/range/${player}/weights`);
  return resp.value;
};

export const rangeRawData = async (player: number): Promise<number[]> => {
  const resp = await apiGet<ValueResp<number[]>>(`/range/${player}/raw-data`);
  return resp.value;
};

/* Action Tree */

export const treeNew = async (
  boardLen: number,
  startingPot: number,
  effectiveStack: number,
  donkOption: boolean,
  oopFlopBet: string,
  oopFlopRaise: string,
  oopTurnBet: string,
  oopTurnRaise: string,
  oopTurnDonk: string,
  oopRiverBet: string,
  oopRiverRaise: string,
  oopRiverDonk: string,
  ipFlopBet: string,
  ipFlopRaise: string,
  ipTurnBet: string,
  ipTurnRaise: string,
  ipRiverBet: string,
  ipRiverRaise: string,
  addAllinThreshold: number,
  forceAllinThreshold: number,
  mergingThreshold: number,
  addedLines: string,
  removedLines: string
): Promise<boolean> => {
  const resp = await apiPost<ValueResp<boolean>>("/tree/new", {
    board_len: boardLen,
    starting_pot: startingPot,
    effective_stack: effectiveStack,
    donk_option: donkOption,
    oop_flop_bet: oopFlopBet,
    oop_flop_raise: oopFlopRaise,
    oop_turn_bet: oopTurnBet,
    oop_turn_raise: oopTurnRaise,
    oop_turn_donk: oopTurnDonk,
    oop_river_bet: oopRiverBet,
    oop_river_raise: oopRiverRaise,
    oop_river_donk: oopRiverDonk,
    ip_flop_bet: ipFlopBet,
    ip_flop_raise: ipFlopRaise,
    ip_turn_bet: ipTurnBet,
    ip_turn_raise: ipTurnRaise,
    ip_river_bet: ipRiverBet,
    ip_river_raise: ipRiverRaise,
    add_allin_threshold: addAllinThreshold,
    force_allin_threshold: forceAllinThreshold,
    merging_threshold: mergingThreshold,
    added_lines: addedLines,
    removed_lines: removedLines,
  });
  return resp.value;
};

export const treeAddedLines = async (): Promise<string> => {
  const resp = await apiGet<ValueResp<string>>("/tree/added-lines");
  return resp.value;
};

export const treeRemovedLines = async (): Promise<string> => {
  const resp = await apiGet<ValueResp<string>>("/tree/removed-lines");
  return resp.value;
};

export const treeInvalidTerminals = async (): Promise<string> => {
  const resp = await apiGet<ValueResp<string>>("/tree/invalid-terminals");
  return resp.value;
};

export const treeActions = async (): Promise<string[]> => {
  const resp = await apiGet<ValueResp<string[]>>("/tree/actions");
  return resp.value;
};

export const treeIsTerminalNode = async (): Promise<boolean> => {
  const resp = await apiGet<ValueResp<boolean>>("/tree/terminal-node");
  return resp.value;
};

export const treeIsChanceNode = async (): Promise<boolean> => {
  const resp = await apiGet<ValueResp<boolean>>("/tree/chance-node");
  return resp.value;
};

export const treeBackToRoot = async () => {
  await apiPost("/tree/back-to-root");
};

export const treeApplyHistory = async (line: string[]) => {
  await apiPost("/tree/apply-history", { line });
};

export const treePlay = async (action: string): Promise<number> => {
  const resp = await apiPost<ValueResp<number>>("/tree/play", { action });
  return resp.value;
};

export const treeTotalBetAmount = async (): Promise<number[]> => {
  const resp = await apiGet<ValueResp<[number, number]>>(
    "/tree/total-bet-amount"
  );
  return resp.value as unknown as number[];
};

export const treeAddBetAction = async (amount: number, isRaise: boolean) => {
  await apiPost("/tree/add-bet-action", { amount, is_raise: isRaise });
};

export const treeRemoveCurrentNode = async () => {
  await apiPost("/tree/remove-current-node");
};

export const treeDeleteAddedLine = async (line: string) => {
  await apiPost("/tree/delete-added-line", { line });
};

export const treeDeleteRemovedLine = async (line: string) => {
  await apiPost("/tree/delete-removed-line", { line });
};

/* Bunching effect */

export const bunchingInit = async (board: number[]): Promise<string | null> => {
  const resp = await apiPost<string | null>("/bunching/init", { board });
  return resp;
};

export const bunchingClear = async () => {
  await apiPost("/bunching/clear");
};

export const bunchingProgress = async (): Promise<number[]> => {
  const resp = await apiGet<ValueResp<[number, number]>>("/bunching/progress");
  return resp.value as unknown as number[];
};

/* Game */

export const gameInit = async (
  board: number[],
  startingPot: number,
  effectiveStack: number,
  rakeRate: number,
  rakeCap: number,
  donkOption: boolean,
  oopFlopBet: string,
  oopFlopRaise: string,
  oopTurnBet: string,
  oopTurnRaise: string,
  oopTurnDonk: string,
  oopRiverBet: string,
  oopRiverRaise: string,
  oopRiverDonk: string,
  ipFlopBet: string,
  ipFlopRaise: string,
  ipTurnBet: string,
  ipTurnRaise: string,
  ipRiverBet: string,
  ipRiverRaise: string,
  addAllinThreshold: number,
  forceAllinThreshold: number,
  mergingThreshold: number,
  addedLines: string,
  removedLines: string
): Promise<string | null> => {
  return await apiPost<string | null>("/game/init", {
    board,
    starting_pot: startingPot,
    effective_stack: effectiveStack,
    rake_rate: rakeRate,
    rake_cap: rakeCap,
    donk_option: donkOption,
    oop_flop_bet: oopFlopBet,
    oop_flop_raise: oopFlopRaise,
    oop_turn_bet: oopTurnBet,
    oop_turn_raise: oopTurnRaise,
    oop_turn_donk: oopTurnDonk,
    oop_river_bet: oopRiverBet,
    oop_river_raise: oopRiverRaise,
    oop_river_donk: oopRiverDonk,
    ip_flop_bet: ipFlopBet,
    ip_flop_raise: ipFlopRaise,
    ip_turn_bet: ipTurnBet,
    ip_turn_raise: ipTurnRaise,
    ip_river_bet: ipRiverBet,
    ip_river_raise: ipRiverRaise,
    add_allin_threshold: addAllinThreshold,
    force_allin_threshold: forceAllinThreshold,
    merging_threshold: mergingThreshold,
    added_lines: addedLines,
    removed_lines: removedLines,
  });
};

export const gamePrivateCards = async (): Promise<number[][]> => {
  const resp = await apiGet<ValueResp<number[][]>>("/game/private-cards");
  return resp.value;
};

export const gameMemoryUsage = async (): Promise<number[]> => {
  const resp = await apiGet<ValueResp<[number, number]>>("/game/memory-usage");
  return resp.value as unknown as number[];
};

export const gameMemoryUsageBunching = async (): Promise<number> => {
  const resp = await apiGet<ValueResp<number>>("/game/memory-usage-bunching");
  return resp.value;
};

export const gameAllocateMemory = async (enableCompression: boolean) => {
  await apiPost("/game/allocate-memory", {
    enable_compression: enableCompression,
  });
};

export const gameSetBunching = async (): Promise<string | null> => {
  return await apiPost<string | null>("/game/set-bunching");
};

export const gameSolveStep = async (currentIteration: number) => {
  await apiPost("/game/solve-step", currentIteration);
};

export const gameExploitability = async (): Promise<number> => {
  const resp = await apiGet<ValueResp<number>>("/game/exploitability");
  return resp.value;
};

export const gameFinalize = async () => {
  await apiPost("/game/finalize");
};

export const gameApplyHistory = async (history: number[]) => {
  await apiPost("/game/apply-history", { history });
};

export const gameTotalBetAmount = async (
  append: number[]
): Promise<number[]> => {
  const resp = await apiPost<ValueResp<[number, number]>>(
    "/game/total-bet-amount",
    {
      append,
    }
  );
  return resp.value as unknown as number[];
};

export const gameActionsAfter = async (append: number[]): Promise<string[]> => {
  const resp = await apiPost<ValueResp<string[]>>("/game/actions-after", {
    append,
  });
  return resp.value;
};

export const gamePossibleCards = async (): Promise<bigint> => {
  const resp = await apiGet<ValueResp<number>>("/game/possible-cards");
  return BigInt(resp.value);
};

type ResultsResponse = {
  current_player: "oop" | "ip" | "chance" | "terminal";
  num_actions: number;
  is_empty: number;
  eqr_base: number[];
  weights: number[][];
  normalizer: number[][];
  equity: number[][];
  ev: number[][];
  eqr: number[][];
  strategy: number[];
  action_ev: number[];
};

export const gameGetResults = async (): Promise<Results> => {
  const results: ResultsResponse = await apiGet("/game/results");
  return {
    currentPlayer: results.current_player,
    numActions: results.num_actions,
    isEmpty: results.is_empty,
    eqrBase: results.eqr_base,
    weights: results.weights,
    normalizer: results.normalizer,
    equity: results.equity,
    ev: results.ev,
    eqr: results.eqr,
    strategy: results.strategy,
    actionEv: results.action_ev,
  };
};

type ChanceReportsResponse = {
  status: number[];
  combos: number[][];
  equity: number[][];
  ev: number[][];
  eqr: number[][];
  strategy: number[];
};

export const gameGetChanceReports = async (
  append: number[],
  currentPlayer: "oop" | "ip" | "terminal",
  numActions: number
): Promise<ChanceReports> => {
  const reports: ChanceReportsResponse = await apiPost("/game/chance-reports", {
    append,
    num_actions: numActions,
  });
  return {
    currentPlayer,
    numActions,
    status: reports.status,
    combos: reports.combos,
    equity: reports.equity,
    ev: reports.ev,
    eqr: reports.eqr,
    strategy: reports.strategy,
  };
};

export const saveGameToBin = async (path: string) => {
  const blob = await apiGetBlob("/game/file");
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = downloadFilename(path);
  a.click();
  URL.revokeObjectURL(downloadUrl);
};

export const loadGameFromBin = async (path: string) => {
  void path;
  await pickAndUploadGameFile();
};

export const loadBoardFromGame = async (): Promise<number[]> => {
  const resp = await apiGet<ValueResp<number[]>>("/game/load-board");
  return resp.value;
};

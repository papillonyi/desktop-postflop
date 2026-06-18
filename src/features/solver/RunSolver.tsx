import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import {
  setFinalizing,
  setSolverError,
  setSolverFinished,
  setSolverPaused,
  setSolverRunning,
  setTrainingResult,
} from "../../app/slices/appSlice";
import { setBoard, type TreeConfigState } from "../../app/slices/configSlice";
import {
  convertBetString,
  INVALID_LINE_STRING,
  MAX_AMOUNT,
  readableLineString,
  ROOT_LINE_STRING,
  sanitizeBetString,
} from "../../utils";
import * as invokes from "../../invokes";

function hasSolverRun(app: {
  isSolverRunning: boolean;
  isSolverPaused: boolean;
  isSolverFinished: boolean;
  isSolverError: boolean;
  isFinalizing: boolean;
}) {
  return (
    app.isSolverRunning ||
    app.isSolverPaused ||
    app.isSolverFinished ||
    app.isSolverError ||
    app.isFinalizing
  );
}

function formatBytes(value: number) {
  if (value >= 1023.5 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }
  return `${(value / (1024 * 1024)).toFixed(0)}MB`;
}

function checkConfig(config: TreeConfigState): string | null {
  if (config.board.length < 3)
    return "Board must consist of at least three cards";
  if (config.startingPot <= 0) return "Starting pot must be positive";
  if (config.startingPot > MAX_AMOUNT) return "Starting pot is too large";
  if (config.startingPot % 1 !== 0) return "Starting pot must be an integer";
  if (config.effectiveStack <= 0) return "Effective stack must be positive";
  if (config.effectiveStack > MAX_AMOUNT) return "Effective stack is too large";
  if (config.effectiveStack % 1 !== 0) {
    return "Effective stack is be an integer";
  }

  const betConfig = [
    { s: sanitizeBetString(config.oopFlopBet, false), kind: "OOP flop bet" },
    { s: sanitizeBetString(config.oopFlopRaise, true), kind: "OOP flop raise" },
    { s: sanitizeBetString(config.oopTurnBet, false), kind: "OOP turn bet" },
    { s: sanitizeBetString(config.oopTurnRaise, true), kind: "OOP turn raise" },
    { s: sanitizeBetString(config.oopRiverBet, false), kind: "OOP river bet" },
    {
      s: sanitizeBetString(config.oopRiverRaise, true),
      kind: "OOP river raise",
    },
    { s: sanitizeBetString(config.ipFlopBet, false), kind: "IP flop bet" },
    { s: sanitizeBetString(config.ipFlopRaise, true), kind: "IP flop raise" },
    { s: sanitizeBetString(config.ipTurnBet, false), kind: "IP turn bet" },
    { s: sanitizeBetString(config.ipTurnRaise, true), kind: "IP turn raise" },
    { s: sanitizeBetString(config.ipRiverBet, false), kind: "IP river bet" },
    { s: sanitizeBetString(config.ipRiverRaise, true), kind: "IP river raise" },
  ];

  for (const { s, kind } of betConfig) {
    if (!s.valid) return `${kind}: ${s.s}`;
  }

  if (config.donkOption) {
    const turnDonk = sanitizeBetString(config.oopTurnDonk, false);
    const riverDonk = sanitizeBetString(config.oopRiverDonk, false);
    if (!turnDonk.valid) return `OOP turn donk: ${turnDonk.s}`;
    if (!riverDonk.valid) return `OOP river donk: ${riverDonk.s}`;
  }

  if (config.addAllInThreshold < 0) return "Invalid add all-in threshold";
  if (config.forceAllInThreshold < 0) return "Invalid force all-in threshold";
  if (config.mergingThreshold < 0) return "Invalid merging threshold";
  if (
    config.expectedBoardLength > 0 &&
    config.board.length !== config.expectedBoardLength
  ) {
    return `Invalid board (expected ${config.expectedBoardLength} cards)`;
  }

  const addedLinesArray =
    config.addedLines === ""
      ? []
      : config.addedLines.split(",").map(readableLineString);
  const removedLinesArray =
    config.removedLines === ""
      ? []
      : config.removedLines.split(",").map(readableLineString);

  if (
    addedLinesArray.includes(ROOT_LINE_STRING) ||
    addedLinesArray.includes(INVALID_LINE_STRING) ||
    removedLinesArray.includes(ROOT_LINE_STRING) ||
    removedLinesArray.includes(INVALID_LINE_STRING)
  ) {
    return "Invalid line found (loaded broken configurations?)";
  }

  if (
    ![0, 3, 4, 5].includes(config.expectedBoardLength) ||
    (config.expectedBoardLength === 0 &&
      (addedLinesArray.length > 0 || removedLinesArray.length > 0)) ||
    (config.expectedBoardLength > 0 &&
      addedLinesArray.length === 0 &&
      removedLinesArray.length === 0)
  ) {
    return "Invalid configurations (loaded broken configurations?)";
  }

  return null;
}

export function RunSolver() {
  const dispatch = useAppDispatch();
  const app = useAppSelector((state) => state.app);
  const config = useAppSelector((state) => state.config);
  const runState = hasSolverRun(app);
  const terminateFlag = useRef(false);
  const pauseFlag = useRef(false);
  const startTime = useRef(0);
  const exploitabilityUpdated = useRef(false);

  const [savedConfig, setSavedConfig] = useState<TreeConfigState>(config);
  const [numThreads, setNumThreads] = useState(
    Math.min(navigator.hardwareConcurrency || 1, 4)
  );
  const [targetExploitability, setTargetExploitability] = useState(0.3);
  const [maxIterations, setMaxIterations] = useState(1000);
  const [isTreeBuilding, setIsTreeBuilding] = useState(false);
  const [isTreeBuilt, setIsTreeBuilt] = useState(false);
  const [treeStatus, setTreeStatus] = useState("Module not loaded");
  const [memoryUsageRaw, setMemoryUsageRaw] = useState(0);
  const [memoryUsageRawCompressed, setMemoryUsageRawCompressed] = useState(0);
  const [memoryUsageBunching, setMemoryUsageBunching] = useState(0);
  const [isCompressionEnabled, setIsCompressionEnabled] = useState(true);
  const [solverErrorText, setSolverErrorText] = useState("");
  const [currentIteration, setCurrentIteration] = useState(-1);
  const [exploitability, setExploitability] = useState(
    Number.POSITIVE_INFINITY
  );
  const [elapsedTimeMs, setElapsedTimeMs] = useState(-1);

  const memoryUsage =
    app.isBunchingEnabled && app.bunchingFlop.length > 0
      ? memoryUsageRaw + memoryUsageBunching
      : memoryUsageRaw;
  const memoryUsageCompressed =
    app.isBunchingEnabled && app.bunchingFlop.length > 0
      ? memoryUsageRawCompressed + memoryUsageBunching
      : memoryUsageRawCompressed;
  const flop = savedConfig.board.slice(0, 3);
  const areFlopMatching =
    !app.isBunchingEnabled ||
    app.bunchingFlop.length === 0 ||
    (flop[0] === app.bunchingFlop[0] &&
      flop[1] === app.bunchingFlop[1] &&
      flop[2] === app.bunchingFlop[2]);
  const iterationText =
    currentIteration === -1
      ? "Allocating memory..."
      : currentIteration === -2
      ? "Collecting bunching data..."
      : `Iteration: ${currentIteration}`;
  const exploitabilityText = Number.isFinite(exploitability)
    ? `Exploitability: ${exploitability.toFixed(2)} (${(
        (exploitability * 100) /
        savedConfig.startingPot
      ).toFixed(2)}%)`
    : "";
  const timeText =
    elapsedTimeMs === -1 || !app.isSolverFinished
      ? ""
      : `Time: ${(elapsedTimeMs / 1000).toFixed(2)}s`;

  const buildTree = async () => {
    setIsTreeBuilt(false);
    const configError = checkConfig(config);
    if (configError !== null) {
      setTreeStatus(`Error: ${configError}`);
      return;
    }

    const nextConfig = { ...config, board: [...config.board] };
    setSavedConfig(nextConfig);
    setIsTreeBuilding(true);
    setTreeStatus("Building tree...");

    const errorString = await invokes.gameInit(
      nextConfig.board,
      nextConfig.startingPot,
      nextConfig.effectiveStack,
      nextConfig.rakePercent / 100,
      nextConfig.rakeCap,
      nextConfig.donkOption,
      convertBetString(nextConfig.oopFlopBet),
      convertBetString(nextConfig.oopFlopRaise),
      convertBetString(nextConfig.oopTurnBet),
      convertBetString(nextConfig.oopTurnRaise),
      nextConfig.donkOption ? convertBetString(nextConfig.oopTurnDonk) : "",
      convertBetString(nextConfig.oopRiverBet),
      convertBetString(nextConfig.oopRiverRaise),
      nextConfig.donkOption ? convertBetString(nextConfig.oopRiverDonk) : "",
      convertBetString(nextConfig.ipFlopBet),
      convertBetString(nextConfig.ipFlopRaise),
      convertBetString(nextConfig.ipTurnBet),
      convertBetString(nextConfig.ipTurnRaise),
      convertBetString(nextConfig.ipRiverBet),
      convertBetString(nextConfig.ipRiverRaise),
      nextConfig.addAllInThreshold / 100,
      nextConfig.forceAllInThreshold / 100,
      nextConfig.mergingThreshold / 100,
      nextConfig.addedLines,
      nextConfig.removedLines
    );

    if (errorString) {
      setIsTreeBuilding(false);
      setTreeStatus(`Error: ${errorString}`);
      return;
    }

    const [raw, rawCompressed] = await invokes.gameMemoryUsage();
    setMemoryUsageRaw(raw);
    setMemoryUsageRawCompressed(rawCompressed);
    const bunching = await invokes.gameMemoryUsageBunching();
    setMemoryUsageBunching(bunching);
    setIsCompressionEnabled(true);

    setIsTreeBuilding(false);
    setIsTreeBuilt(true);
    setTreeStatus("Successfully built tree");
    dispatch(setSolverRunning(false));
    dispatch(setSolverPaused(false));
    dispatch(setSolverFinished(false));
    dispatch(setSolverError(false));
    dispatch(setTrainingResult(false));
  };

  const resumeSolver = async (
    startingIteration = currentIteration,
    startingExploitability = exploitability
  ) => {
    dispatch(setSolverRunning(true));
    dispatch(setSolverPaused(false));

    if (startTime.current === 0) {
      startTime.current = performance.now();
      await invokes.setNumThreads(numThreads);
    }

    const target = (savedConfig.startingPot * targetExploitability) / 100;
    let iteration = startingIteration;
    let exploit = startingExploitability;

    while (
      !terminateFlag.current &&
      iteration < maxIterations &&
      exploit > target
    ) {
      if (pauseFlag.current) {
        const end = performance.now();
        setElapsedTimeMs(
          (value) => (value < 0 ? 0 : value) + end - startTime.current
        );
        startTime.current = 0;
        pauseFlag.current = false;
        dispatch(setSolverRunning(false));
        dispatch(setSolverPaused(true));
        return;
      }

      await invokes.gameSolveStep(iteration);
      iteration += 1;
      setCurrentIteration(iteration);
      exploitabilityUpdated.current = false;

      if (iteration % 10 === 0) {
        exploit = Math.max(await invokes.gameExploitability(), 0);
        setExploitability(exploit);
        exploitabilityUpdated.current = true;
      }
    }

    if (!exploitabilityUpdated.current) {
      exploit = Math.max(await invokes.gameExploitability(), 0);
      setExploitability(exploit);
    }

    dispatch(setSolverRunning(false));
    dispatch(setFinalizing(true));
    await invokes.gameFinalize();
    dispatch(setFinalizing(false));
    dispatch(setSolverFinished(true));
    setElapsedTimeMs((value) => {
      const base = value < 0 ? 0 : value;
      return base + performance.now() - startTime.current;
    });
    startTime.current = 0;
  };

  const runSolver = async () => {
    terminateFlag.current = false;
    pauseFlag.current = false;
    setCurrentIteration(-1);
    setExploitability(Number.POSITIVE_INFINITY);
    setElapsedTimeMs(-1);
    dispatch(setSolverRunning(true));
    startTime.current = performance.now();

    await invokes.setNumThreads(numThreads);
    const allocationError = await invokes.gameAllocateMemory(
      isCompressionEnabled,
      {
        includeBunching: app.isBunchingEnabled && app.bunchingFlop.length > 0,
      }
    );
    if (allocationError) {
      setSolverErrorText(`Error: ${allocationError}`);
      dispatch(setSolverRunning(false));
      dispatch(setSolverError(true));
      return;
    }

    if (app.isBunchingEnabled && app.bunchingFlop.length > 0) {
      setCurrentIteration(-2);
      const errorString = await invokes.gameSetBunching();
      if (errorString) {
        setSolverErrorText(`Error: ${errorString}`);
        dispatch(setSolverRunning(false));
        dispatch(setSolverError(true));
        return;
      }
    }

    setCurrentIteration(0);
    const initialExploitability = Math.max(
      await invokes.gameExploitability(),
      0
    );
    setExploitability(initialExploitability);
    exploitabilityUpdated.current = true;
    await resumeSolver(0, initialExploitability);
  };

  const saveGame = async () => {
    await invokes.saveGameToBin("desktop-postflop-game.bin");
  };

  const loadGame = async () => {
    await invokes.loadGameFromBin("desktop-postflop-game.bin");
    dispatch(setTrainingResult(false));
    dispatch(setBoard(await invokes.loadBoardFromGame()));
  };

  return (
    <div className="flex">
      <div>
        <div className="my-1 flex items-center">
          Number of threads:
          <input
            className={[
              "ml-2 w-20 rounded-lg px-2 py-1 text-center text-sm",
              numThreads < 1 || numThreads > 64 || numThreads % 1 !== 0
                ? "input-error"
                : "",
            ].join(" ")}
            max="64"
            min="1"
            onChange={(event) => setNumThreads(Number(event.target.value))}
            type="number"
            value={numThreads}
          />
          <button
            className="button-base button-blue ml-3"
            disabled={isTreeBuilding || app.isSolverRunning || app.isFinalizing}
            onClick={buildTree}
            type="button"
          >
            Build New Tree
          </button>
        </div>

        <div className="my-1">Status: {treeStatus}</div>

        {isTreeBuilt && (
          <div className="mt-3">
            <div>Precision mode:</div>
            <div className="ml-2 mt-1">
              <label className={!runState ? "cursor-pointer" : ""}>
                <input
                  checked={!isCompressionEnabled}
                  className="mr-2 cursor-pointer disabled:cursor-default"
                  disabled={runState}
                  name="compression"
                  onChange={() => setIsCompressionEnabled(false)}
                  type="radio"
                />
                <span className="ml-1 inline-block w-[6.75rem]">
                  32-bit FP:
                </span>
                needs {formatBytes(memoryUsage)} RAM
              </label>
            </div>
            <div className="ml-2">
              <label className={!runState ? "cursor-pointer" : ""}>
                <input
                  checked={isCompressionEnabled}
                  className="mr-2 cursor-pointer disabled:cursor-default"
                  disabled={runState}
                  name="compression"
                  onChange={() => setIsCompressionEnabled(true)}
                  type="radio"
                />
                <span className="ml-1 inline-block w-[6.75rem]">
                  16-bit integer:
                </span>
                needs {formatBytes(memoryUsageCompressed)} RAM
              </label>
            </div>

            <div className="mt-4">
              Target exploitability:
              <input
                className={[
                  "ml-3 w-20 rounded-lg px-2 py-1 text-center text-sm",
                  targetExploitability <= 0 ? "input-error" : "",
                ].join(" ")}
                disabled={runState && !app.isSolverPaused}
                min="0"
                onChange={(event) =>
                  setTargetExploitability(Number(event.target.value))
                }
                step="0.05"
                type="number"
                value={targetExploitability}
              />{" "}
              %
            </div>

            <div className="mt-1">
              Maximum number of iterations:
              <input
                className={[
                  "ml-2 w-[5.5rem] rounded-lg px-2 py-1 text-center text-sm",
                  maxIterations < 0 ||
                  maxIterations % 1 !== 0 ||
                  maxIterations > 100000
                    ? "input-error"
                    : "",
                ].join(" ")}
                disabled={runState && !app.isSolverPaused}
                max="100000"
                min="0"
                onChange={(event) =>
                  setMaxIterations(Number(event.target.value))
                }
                type="number"
                value={maxIterations}
              />
            </div>

            {!areFlopMatching && !runState && (
              <div className="mt-2 font-semibold text-red-500">
                Error: The input flop and the bunching data do not match.
              </div>
            )}
            {app.isBunchingEnabled &&
              app.bunchingFlop.length === 0 &&
              !runState && (
                <div className="mt-2 font-semibold text-orange-500">
                  Warning: Bunching effect is disabled because the data is not
                  ready.
                </div>
              )}

            <div className="mt-6 flex gap-3">
              <button
                className="button-base button-blue"
                disabled={
                  runState ||
                  app.isBunchingRunning ||
                  !areFlopMatching ||
                  numThreads < 1 ||
                  numThreads > 64 ||
                  numThreads % 1 !== 0 ||
                  targetExploitability <= 0 ||
                  maxIterations < 0 ||
                  maxIterations % 1 !== 0 ||
                  maxIterations > 100000
                }
                onClick={runSolver}
                type="button"
              >
                Run Solver
              </button>
              <button
                className="button-base button-red"
                disabled={!app.isSolverRunning}
                onClick={() => {
                  terminateFlag.current = true;
                }}
                type="button"
              >
                Stop
              </button>
              {!app.isSolverPaused ? (
                <button
                  className="button-base button-green"
                  disabled={!app.isSolverRunning}
                  onClick={() => {
                    pauseFlag.current = true;
                  }}
                  type="button"
                >
                  Pause
                </button>
              ) : (
                <button
                  className="button-base button-green"
                  disabled={
                    app.isBunchingRunning ||
                    numThreads < 1 ||
                    numThreads > 64 ||
                    numThreads % 1 !== 0 ||
                    targetExploitability <= 0 ||
                    maxIterations < 0 ||
                    maxIterations % 1 !== 0 ||
                    maxIterations > 100000
                  }
                  onClick={() => resumeSolver()}
                  type="button"
                >
                  Resume
                </button>
              )}
              <button
                className="button-base button-blue"
                disabled={!runState}
                onClick={saveGame}
                type="button"
              >
                Save
              </button>
              <button
                className="button-base button-blue"
                disabled={!runState}
                onClick={loadGame}
                type="button"
              >
                Load
              </button>
            </div>
            {runState && (
              <div className="mt-6">
                <div className="flex items-center">
                  {(app.isSolverRunning || app.isFinalizing) && (
                    <span className="spinner mr-3 inline-block" />
                  )}
                  {app.isSolverRunning
                    ? "Solver running..."
                    : app.isFinalizing
                    ? "Finalizing..."
                    : app.isSolverPaused
                    ? "Solver paused."
                    : app.isSolverError
                    ? solverErrorText
                    : "Solver finished."}
                </div>
                {iterationText}
                <br />
                {exploitabilityText}
                <br />
                {timeText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

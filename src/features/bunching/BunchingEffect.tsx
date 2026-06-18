import { InformationCircleIcon } from "@heroicons/react/20/solid";
import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import {
  setBunchingEnabled,
  setBunchingFlop,
  setBunchingRunning,
} from "../../app/slices/appSlice";
import { setRangeWeights } from "../../app/slices/rangesSlice";
import { RangeEditor } from "../ranges/RangeEditor";
import { RangeMiniViewer } from "../ranges/RangeMiniViewer";
import * as invokes from "../../invokes";
import { cardText, rangeRegex, trimRegex } from "../../utils";

const comboDenominator = (52 * 51) / 2;

export function BunchingEffect() {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const app = useAppSelector((state) => state.app);
  const isSolverRunning = app.isSolverRunning;
  const terminateFlag = useRef(false);
  const pauseFlag = useRef(false);
  const startTime = useRef(0);

  const [numThreads, setNumThreads] = useState(
    Math.min(navigator.hardwareConcurrency || 1, 4)
  );
  const [editingPlayer, setEditingPlayer] = useState(-1);
  const [rangeTexts, setRangeTexts] = useState(["", "", "", ""]);
  const [isRangeTextError, setIsRangeTextError] = useState([
    false,
    false,
    false,
    false,
  ]);
  const [numCombos, setNumCombos] = useState([0, 0, 0, 0]);
  const [rangeTextCopy, setRangeTextCopy] = useState("");
  const [statusText, setStatusText] = useState("No bunching data");
  const [flopCopy, setFlopCopy] = useState<number[]>([]);
  const [hasBunchingRun, setHasBunchingRun] = useState(false);
  const [isBunchingPaused, setIsBunchingPaused] = useState(false);
  const [elapsedTimeMs, setElapsedTimeMs] = useState(-1);

  const patchRangeText = (player: number, value: string) => {
    setRangeTexts((items) =>
      items.map((item, index) => (index === player ? value : item))
    );
  };

  const patchRangeError = (player: number, value: boolean) => {
    setIsRangeTextError((items) =>
      items.map((item, index) => (index === player ? value : item))
    );
  };

  const patchNumCombos = (player: number, value: number) => {
    setNumCombos((items) =>
      items.map((item, index) => (index === player ? value : item))
    );
  };

  const updateRangeWeights = async (player: number) => {
    const weights = await invokes.rangeGetWeights(player + 2);
    dispatch(
      setRangeWeights({
        player: player + 2,
        weights: weights.map((value) => value * 100),
      })
    );
    patchRangeError(player, false);
  };

  const updateRangeLocal = async (player: number) => {
    patchRangeText(player, await invokes.rangeToString(player + 2));
    patchNumCombos(player, await invokes.rangeNumCombos(player + 2));
  };

  const editRange = async (player: number) => {
    setRangeTextCopy(await invokes.rangeToString(player + 2));
    setEditingPlayer(player);
  };

  const onRangeTextChange = async (player: number) => {
    const trimmed = rangeTexts[player].replace(trimRegex, "$1").trim();
    const ranges = trimmed.split(",");

    if (ranges[ranges.length - 1] === "") ranges.pop();

    for (const range of ranges) {
      if (!rangeRegex.test(range)) {
        patchRangeError(player, true);
        return;
      }
    }

    const errorString = await invokes.rangeFromString(player + 2, trimmed);
    if (errorString) {
      patchRangeError(player, true);
      return;
    }

    await updateRangeWeights(player);
    await updateRangeLocal(player);
  };

  const invertRange = async (player: number) => {
    await invokes.rangeInvert(player + 2);
    await updateRangeWeights(player);
    await updateRangeLocal(player);
  };

  const clearRange = async (player: number) => {
    await invokes.rangeClear(player + 2);
    await updateRangeWeights(player);
    await updateRangeLocal(player);
  };

  const resumePrecomputation = async (currentFlop = flopCopy) => {
    dispatch(setBunchingRunning(true));
    setIsBunchingPaused(false);
    startTime.current = performance.now();
    await invokes.setNumThreads(numThreads);

    for (;;) {
      if (terminateFlag.current) {
        await invokes.bunchingClear();
        dispatch(setBunchingFlop([]));
        setStatusText("No bunching data");
        setHasBunchingRun(false);
        break;
      }

      if (pauseFlag.current) {
        setIsBunchingPaused(true);
        break;
      }

      const [phase, percent] = await invokes.bunchingProgress();

      if (phase === 3 && percent === 100) {
        dispatch(setBunchingFlop(currentFlop));
        setStatusText("Bunching data ready!");
        break;
      }

      setStatusText(`Phase ${phase}/3 - ${percent}% completed...`);
    }

    setElapsedTimeMs((value) => {
      const base = value < 0 ? 0 : value;
      return base + performance.now() - startTime.current;
    });

    if (!terminateFlag.current && !pauseFlag.current) {
      const nextElapsed =
        (elapsedTimeMs < 0 ? 0 : elapsedTimeMs) +
        performance.now() -
        startTime.current;
      setStatusText(
        (text) => `${text} (Time: ${(nextElapsed / 1000).toFixed(2)}s)`
      );
    }

    dispatch(setBunchingRunning(false));
    terminateFlag.current = false;
    pauseFlag.current = false;
  };

  const runPrecomputation = async () => {
    dispatch(setBunchingFlop([]));
    const errorString = await invokes.bunchingInit(config.board);
    if (errorString) {
      setStatusText(`Error: ${errorString}`);
      return;
    }

    setStatusText("Phase 1/3 - Preparing...");
    const currentFlop = config.board.slice(0, 3);
    setFlopCopy(currentFlop);
    setHasBunchingRun(true);
    setElapsedTimeMs(0);
    await resumePrecomputation(currentFlop);
  };

  const clearPrecomputation = async () => {
    if (app.isBunchingRunning) {
      terminateFlag.current = true;
      return;
    }

    await invokes.bunchingClear();
    dispatch(setBunchingFlop([]));
    setStatusText("No bunching data");
    setHasBunchingRun(false);
    setIsBunchingPaused(false);
  };

  const saveEdit = async () => {
    patchRangeError(editingPlayer, false);
    await updateRangeLocal(editingPlayer);
    setEditingPlayer(-1);
  };

  const cancelEdit = async () => {
    patchRangeText(editingPlayer, rangeTextCopy);
    await invokes.rangeFromString(editingPlayer + 2, rangeTextCopy);
    await updateRangeWeights(editingPlayer);
    setEditingPlayer(-1);
  };

  if (editingPlayer !== -1) {
    return (
      <RangeEditor
        defaultText={rangeTextCopy}
        onCancel={cancelEdit}
        onSave={saveEdit}
        player={editingPlayer + 2}
      />
    );
  }

  return (
    <div>
      <div className="flex">
        <div className="flex rounded-md border-2 border-cyan-600 bg-cyan-50 py-1 pl-2.5 pr-3 font-semibold text-cyan-600">
          <InformationCircleIcon className="mr-1.5 mt-[0.1875rem] inline h-5 w-5" />
          <div>
            Enabling the bunching effect will significantly slow down the
            solver.
            <br />
            If you are not sure, we recommend leaving it disabled.
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-8">
        <label className="cursor-pointer">
          <input
            checked={app.isBunchingEnabled}
            className="mr-1 rounded align-middle"
            onChange={(event) =>
              dispatch(setBunchingEnabled(event.target.checked))
            }
            type="checkbox"
          />
          Enable bunching effect
        </label>
      </div>

      {app.isBunchingEnabled && (
        <div className="mt-6">
          <div className="flex gap-8">
            {Array.from({ length: 4 }, (_, player) => (
              <div key={player}>
                <div className="text-[1.0625rem]">Fold Range {player + 1}</div>
                <RangeMiniViewer
                  className="mt-2 h-44 w-44 cursor-pointer"
                  onClick={() => editRange(player)}
                  player={player + 2}
                />
                <input
                  className={[
                    "mt-3 w-44 rounded-lg px-2 py-1 text-sm",
                    isRangeTextError[player] ? "input-error" : "",
                  ].join(" ")}
                  onBlur={() => onRangeTextChange(player)}
                  onChange={(event) =>
                    patchRangeText(player, event.target.value)
                  }
                  onFocus={(event) => event.currentTarget.select()}
                  type="text"
                  value={rangeTexts[player]}
                />
                <div className="mt-2 text-center">
                  {numCombos[player].toFixed(1)} combos (
                  {numCombos[player] >= 0.9995 * comboDenominator
                    ? "100"
                    : ((numCombos[player] * 100) / comboDenominator).toFixed(1)}
                  %)
                </div>
                <div className="mt-3 flex w-full justify-center gap-3">
                  <button
                    className="button-base button-blue"
                    onClick={() => invertRange(player)}
                    type="button"
                  >
                    Invert
                  </button>
                  <button
                    className="button-base button-blue"
                    onClick={() => clearRange(player)}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              className="button-base button-blue"
              disabled={
                numCombos.every((x) => x === 0) ||
                app.isBunchingRunning ||
                isSolverRunning ||
                numThreads < 1 ||
                numThreads > 64 ||
                numThreads % 1 !== 0
              }
              onClick={runPrecomputation}
              type="button"
            >
              Run Precomputation
            </button>
            <button
              className="button-base button-red"
              disabled={!hasBunchingRun}
              onClick={clearPrecomputation}
              type="button"
            >
              Clear
            </button>
            {!isBunchingPaused ? (
              <button
                className="button-base button-green"
                disabled={!app.isBunchingRunning}
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
                  isSolverRunning ||
                  numThreads < 1 ||
                  numThreads > 64 ||
                  numThreads % 1 !== 0
                }
                onClick={() => resumePrecomputation()}
                type="button"
              >
                Resume
              </button>
            )}

            <span className="pl-3">
              Number of threads:
              <input
                className={[
                  "ml-1.5 w-20 rounded-lg px-2 py-1 text-center text-sm",
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
            </span>
            <span className="pl-3">
              RAM usage:{" "}
              {
                ["-", "60MB", "60MB", "190MB", "3.5GB"][
                  numCombos.filter((x) => x > 0).length
                ]
              }
            </span>
          </div>

          <div className="mt-3">
            <span className="flex items-center">
              Status:
              {app.isBunchingRunning && (
                <span className="spinner ml-2 mr-2.5 inline-block" />
              )}
              {statusText}
            </span>
            {app.bunchingFlop.length > 0 && (
              <span>
                [Flop:{" "}
                {app.bunchingFlop.map(cardText).map((item) => (
                  <span
                    className={`mx-px inline-block ${item.colorClass}`}
                    key={item.rank + item.suit}
                  >
                    {item.rank + item.suit}
                  </span>
                ))}
                ]
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

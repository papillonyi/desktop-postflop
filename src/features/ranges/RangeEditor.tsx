import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setRangeCell, setRangeWeights } from "../../app/slices/rangesSlice";
import { DbItemPicker } from "../database/DbItemPicker";
import * as invokes from "../../invokes";
import { rangeRegex, ranks, trimRegex } from "../../utils";

const yellow500 = "#eab308";
type DraggingMode = "none" | "enabling" | "disabling";

type RangeEditorProps = {
  player: number;
  defaultText?: string;
  onSave?: () => void;
  onCancel?: () => void;
};

function cellText(row: number, col: number) {
  const r1 = 13 - Math.min(row, col);
  const r2 = 13 - Math.max(row, col);
  return ranks[r1] + ranks[r2] + ["s", "", "o"][Math.sign(row - col) + 1];
}

function cellIndex(row: number, col: number) {
  return 13 * (row - 1) + col - 1;
}

export function RangeEditor({
  player,
  defaultText = "",
  onSave,
  onCancel,
}: RangeEditorProps) {
  const dispatch = useAppDispatch();
  const range = useAppSelector((state) => state.ranges.values[player]);
  const draggingMode = useRef<DraggingMode>("none");
  const [rangeText, setRangeText] = useState(defaultText);
  const [rangeTextError, setRangeTextError] = useState("");
  const [weight, setWeight] = useState(100);
  const [numCombos, setNumCombos] = useState(0);

  const cellValue = (row: number, col: number) =>
    range[cellIndex(row, col)] ?? 0;

  const refreshRangeText = async () => {
    setRangeText(await invokes.rangeToString(player));
    setNumCombos(await invokes.rangeNumCombos(player));
    setRangeTextError("");
  };

  const updateCell = async (row: number, col: number, nextWeight: number) => {
    const index = cellIndex(row, col);
    await invokes.rangeUpdate(player, row, col, nextWeight / 100);
    dispatch(setRangeCell({ player, index, weight: nextWeight }));
    await refreshRangeText();
  };

  const onRangeTextChange = async (text = rangeText) => {
    const trimmed = text.replace(trimRegex, "$1").trim();
    const ranges = trimmed.split(",");

    if (ranges[ranges.length - 1] === "") {
      ranges.pop();
    }

    for (const rangePart of ranges) {
      if (!rangeRegex.test(rangePart)) {
        setRangeTextError(
          `Failed to parse range: ${rangePart || "(empty string)"}`
        );
        return;
      }
    }

    const errorString = await invokes.rangeFromString(player, trimmed);

    if (errorString) {
      setRangeTextError(errorString);
      return;
    }

    const weights = await invokes.rangeGetWeights(player);
    dispatch(
      setRangeWeights({
        player,
        weights: weights.map((value) => value * 100),
      })
    );
    await refreshRangeText();
  };

  const dragStart = (row: number, col: number) => {
    const value = cellValue(row, col);
    if (value !== weight) {
      draggingMode.current = "enabling";
      updateCell(row, col, weight);
    } else {
      draggingMode.current = "disabling";
      updateCell(row, col, 0);
    }
  };

  const dragEnd = () => {
    draggingMode.current = "none";
  };

  const mouseEnter = (row: number, col: number) => {
    if (draggingMode.current === "enabling") {
      updateCell(row, col, weight);
    } else if (draggingMode.current === "disabling") {
      updateCell(row, col, 0);
    }
  };

  const onWeightChange = (value: number) => {
    setWeight(Math.round(Math.max(0, Math.min(100, value))));
  };

  const clearRange = async () => {
    await invokes.rangeClear(player);
    dispatch(
      setRangeWeights({
        player,
        weights: Array.from({ length: 13 * 13 }, () => 0),
      })
    );
    setRangeText("");
    setRangeTextError("");
    setWeight(100);
    setNumCombos(0);
  };

  const invertRange = async () => {
    await invokes.rangeInvert(player);
    dispatch(
      setRangeWeights({
        player,
        weights: range.map((value) => 100 - value),
      })
    );
    await refreshRangeText();
  };

  const loadRange = (rangeStr: unknown) => {
    const nextText = String(rangeStr);
    setRangeText(nextText);
    onRangeTextChange(nextText);
  };

  return (
    <div className="mt-1 flex">
      <div className="ml-1 shrink-0">
        <table className="snug select-none shadow-md" onMouseLeave={dragEnd}>
          <tbody>
            {Array.from({ length: 13 }, (_, rowIndex) => {
              const row = rowIndex + 1;
              return (
                <tr className="h-9" key={row}>
                  {Array.from({ length: 13 }, (_, colIndex) => {
                    const col = colIndex + 1;
                    const value = cellValue(row, col);
                    return (
                      <td
                        className="relative w-[2.625rem] border border-black"
                        key={col}
                        onMouseDown={() => dragStart(row, col)}
                        onMouseEnter={() => mouseEnter(row, col)}
                        onMouseUp={dragEnd}
                      >
                        <div
                          className={[
                            "absolute left-0 top-0 h-full w-full",
                            row === col ? "bg-neutral-700" : "bg-neutral-800",
                          ].join(" ")}
                        >
                          <div
                            className="absolute left-0 top-0 h-full w-full bg-bottom bg-no-repeat"
                            style={{
                              backgroundImage: `linear-gradient(${yellow500} 0% 100%)`,
                              backgroundSize: `100% ${value}%`,
                            }}
                          />
                        </div>
                        <div
                          className={[
                            "text-shadow absolute -top-px left-[0.1875rem] z-10",
                            value > 0 ? "text-white" : "text-neutral-500",
                          ].join(" ")}
                        >
                          {cellText(row, col)}
                        </div>
                        <div className="text-shadow absolute bottom-px right-1 z-10 text-sm text-white">
                          {value > 0 && value < 100 ? value.toFixed(1) : ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-5">
          <div className="flex">
            <input
              className={[
                "mr-6 flex-grow rounded-lg px-2 py-1 text-sm",
                rangeTextError ? "input-error" : "",
              ].join(" ")}
              onChange={(event) => setRangeText(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => onRangeTextChange()}
              type="text"
              value={rangeText}
            />

            {player >= 2 && (
              <button
                className="button-base button-blue mr-4"
                onClick={invertRange}
                type="button"
              >
                Invert
              </button>
            )}

            <button
              className="button-base button-blue"
              onClick={clearRange}
              type="button"
            >
              Clear
            </button>
          </div>

          {rangeTextError && (
            <div className="mt-1 text-red-500">Error: {rangeTextError}</div>
          )}
        </div>

        <div className="mt-3.5 flex items-center">
          <div>
            Weight:
            <input
              className="ml-3 w-40 align-middle"
              max="100"
              min="0"
              onChange={(event) => onWeightChange(Number(event.target.value))}
              step="5"
              type="range"
              value={weight}
            />
            <input
              className={[
                "ml-4 w-20 rounded-lg px-2 py-1 text-center text-sm",
                weight < 0 || weight > 100 ? "input-error" : "",
              ].join(" ")}
              max="100"
              min="0"
              onChange={(event) => onWeightChange(Number(event.target.value))}
              step="5"
              type="number"
              value={weight}
            />
            %
          </div>

          <span className="ml-auto inline-block">
            {numCombos.toFixed(1)} combos (
            {((numCombos * 100) / ((52 * 51) / 2)).toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="ml-6 max-w-[18rem] flex-grow">
        <DbItemPicker
          allowSave={rangeText !== "" && rangeTextError === ""}
          hideImportExport={player >= 2}
          index={player}
          onLoadItem={loadRange}
          storeName="ranges"
          value={rangeText}
        />

        {player >= 2 && (
          <div className="mt-12 flex justify-center gap-4">
            <button
              className="button-base button-blue !px-5"
              onClick={onSave}
              type="button"
            >
              Save Edit
            </button>
            <button
              className="button-base button-red !px-5"
              onClick={onCancel}
              type="button"
            >
              Cancel Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

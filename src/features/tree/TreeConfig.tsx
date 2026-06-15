import { useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setConfig, type TreeConfigState } from "../../app/slices/configSlice";
import { DbItemPicker } from "../database/DbItemPicker";
import { TreeEditor } from "./TreeEditor";
import {
  INVALID_LINE_STRING,
  MAX_AMOUNT,
  readableLineString,
  ROOT_LINE_STRING,
  sanitizeBetString,
} from "../../utils";

type ConfigValue = Omit<TreeConfigState, "board" | "donkOption"> & {
  donkOption: number;
};

const betFields = [
  ["oopFlopBet", "OOP flop bet", false],
  ["oopFlopRaise", "OOP flop raise", true],
  ["oopTurnBet", "OOP turn bet", false],
  ["oopTurnRaise", "OOP turn raise", true],
  ["oopTurnDonk", "OOP turn donk", false, true],
  ["oopRiverBet", "OOP river bet", false],
  ["oopRiverRaise", "OOP river raise", true],
  ["oopRiverDonk", "OOP river donk", false, true],
  ["ipFlopBet", "IP flop bet", false],
  ["ipFlopRaise", "IP flop raise", true],
  ["ipTurnBet", "IP turn bet", false],
  ["ipTurnRaise", "IP turn raise", true],
  ["ipRiverBet", "IP river bet", false],
  ["ipRiverRaise", "IP river raise", true],
] as const;

function toNumber(value: string) {
  return Number(value);
}

function lineArray(lines: string) {
  return lines === "" ? [] : lines.split(",").map(readableLineString);
}

function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mt-1 flex font-semibold text-red-500">
      <div className="underline">Error:</div>
      <div className="ml-2">
        {errors.map((error) => (
          <div key={error}>{error}</div>
        ))}
      </div>
    </div>
  );
}

function TextInput({
  disabled,
  label,
  onChange,
  value,
  isRaise,
  invalid,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
  isRaise: boolean;
  invalid: boolean;
}) {
  return (
    <div className="my-1">
      <span className="inline-block w-14">{label}:</span>
      <input
        className={[
          "w-24 rounded-lg px-2 py-1 text-sm disabled:cursor-not-allowed",
          invalid ? "input-error" : "",
        ].join(" ")}
        disabled={disabled}
        onBlur={() => {
          const sanitized = sanitizeBetString(value, isRaise);
          if (sanitized.valid) onChange(sanitized.s);
        }}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />{" "}
      %
    </div>
  );
}

function NumberInput({
  disabled,
  invalid,
  label,
  max,
  min = 0,
  onChange,
  step,
  suffix = "",
  value,
  widthClass = "w-24",
}: {
  disabled?: boolean;
  invalid: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
  widthClass?: string;
}) {
  return (
    <div className="my-1">
      <span className="inline-block w-[7.5rem]">{label}:</span>
      <input
        className={[
          `${widthClass} rounded-lg px-2 py-1 text-center text-sm disabled:cursor-not-allowed`,
          invalid ? "input-error" : "",
        ].join(" ")}
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(toNumber(event.target.value))}
        step={step}
        type="number"
        value={value}
      />{" "}
      {suffix}
    </div>
  );
}

export function TreeConfig() {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const [isEditMode, setIsEditMode] = useState(false);

  const hasEdit =
    config.addedLines.length > 0 || config.removedLines.length > 0;
  const addedLinesArray = useMemo(
    () => lineArray(config.addedLines),
    [config.addedLines]
  );
  const removedLinesArray = useMemo(
    () => lineArray(config.removedLines),
    [config.removedLines]
  );

  const sanitized = useMemo(() => {
    const result = new Map<string, { s: string; valid: boolean }>();
    for (const [field, _label, isRaise] of betFields) {
      result.set(field, sanitizeBetString(String(config[field]), isRaise));
    }
    return result;
  }, [config]);

  const errorBasics = useMemo(() => {
    const errors: string[] = [];
    if (config.startingPot <= 0) errors.push("Starting pot must be positive");
    if (config.startingPot > MAX_AMOUNT) {
      errors.push(`Starting pot must not exceed ${MAX_AMOUNT}`);
    }
    if (config.startingPot % 1 !== 0) {
      errors.push("Starting pot must be an integer");
    }
    if (config.effectiveStack <= 0) {
      errors.push("Effective stack must be positive");
    }
    if (config.effectiveStack > MAX_AMOUNT) {
      errors.push(`Effective stack must not exceed ${MAX_AMOUNT}`);
    }
    if (config.effectiveStack % 1 !== 0) {
      errors.push("Effective stack must be an integer");
    }
    if (config.rakePercent < 0) errors.push("Rake must be non-negative");
    if (config.rakePercent > 100) errors.push("Rake must not exceed 100%");
    if (config.rakeCap < 0) errors.push("Rake cap must be non-negative");
    if (config.rakeCap > 3 * MAX_AMOUNT) {
      errors.push(`Rake cap must not exceed ${3 * MAX_AMOUNT}`);
    }
    return errors;
  }, [config]);

  const errorOop = useMemo(() => {
    const errors: string[] = [];
    for (const [field, label, _isRaise, isDonk] of betFields.slice(0, 8)) {
      const res = sanitized.get(field)!;
      if (!res.valid && (!isDonk || config.donkOption)) {
        errors.push(`${label}: ${res.s}`);
      }
    }
    return errors;
  }, [config.donkOption, sanitized]);

  const errorIp = useMemo(() => {
    const errors: string[] = [];
    for (const [field, label] of betFields.slice(8)) {
      const res = sanitized.get(field)!;
      if (!res.valid) errors.push(`${label}: ${res.s}`);
    }
    return errors;
  }, [sanitized]);

  const errorMisc = useMemo(() => {
    const errors: string[] = [];
    if (config.addAllInThreshold < 0) {
      errors.push("Add all-in threshold must be non-negative");
    }
    if (config.forceAllInThreshold < 0) {
      errors.push("Force all-in threshold must be non-negative");
    }
    if (config.mergingThreshold < 0) {
      errors.push("Merging threshold must be non-negative");
    }
    return errors;
  }, [config]);

  const warningMisc = useMemo(() => {
    if (config.forceAllInThreshold <= 30) return [];
    return [
      "Force all-in threshold higher than 30% is not recommended.\nPlease see help to confirm the meaning.",
    ];
  }, [config.forceAllInThreshold]);

  const errorLines = useMemo(() => {
    const errors: string[] = [];
    if (
      addedLinesArray.includes(ROOT_LINE_STRING) ||
      addedLinesArray.includes(INVALID_LINE_STRING) ||
      removedLinesArray.includes(ROOT_LINE_STRING) ||
      removedLinesArray.includes(INVALID_LINE_STRING)
    ) {
      errors.push("Invalid line found (loaded broken configurations?)");
    }
    if (
      ![0, 3, 4, 5].includes(config.expectedBoardLength) ||
      (config.expectedBoardLength === 0 &&
        (addedLinesArray.length > 0 || removedLinesArray.length > 0)) ||
      (config.expectedBoardLength > 0 &&
        addedLinesArray.length === 0 &&
        removedLinesArray.length === 0)
    ) {
      errors.push("Invalid configurations (loaded broken configurations?)");
    }
    return errors;
  }, [addedLinesArray, config.expectedBoardLength, removedLinesArray]);

  const isInputValid =
    errorBasics.length === 0 &&
    errorOop.length === 0 &&
    errorIp.length === 0 &&
    errorMisc.length === 0 &&
    errorLines.length === 0;

  const patchConfig = (patch: Partial<TreeConfigState>) => {
    dispatch(setConfig(patch));
  };

  const clearConfig = () => {
    patchConfig({
      startingPot: 0,
      effectiveStack: 0,
      rakePercent: 0,
      rakeCap: 0,
      donkOption: false,
      oopFlopBet: "",
      oopFlopRaise: "",
      oopTurnBet: "",
      oopTurnRaise: "",
      oopTurnDonk: "",
      oopRiverBet: "",
      oopRiverRaise: "",
      oopRiverDonk: "",
      ipFlopBet: "",
      ipFlopRaise: "",
      ipTurnBet: "",
      ipTurnRaise: "",
      ipRiverBet: "",
      ipRiverRaise: "",
      addAllInThreshold: 0,
      forceAllInThreshold: 0,
      mergingThreshold: 0,
      expectedBoardLength: 0,
      addedLines: "",
      removedLines: "",
    });
  };

  const oopToIp = () => {
    patchConfig({
      ipFlopBet: config.oopFlopBet,
      ipFlopRaise: config.oopFlopRaise,
      ipTurnBet: config.oopTurnBet,
      ipTurnRaise: config.oopTurnRaise,
      ipRiverBet: config.oopRiverBet,
      ipRiverRaise: config.oopRiverRaise,
    });
  };

  const ipToOop = () => {
    patchConfig({
      oopFlopBet: config.ipFlopBet,
      oopFlopRaise: config.ipFlopRaise,
      oopTurnBet: config.ipTurnBet,
      oopTurnRaise: config.ipTurnRaise,
      oopRiverBet: config.ipRiverBet,
      oopRiverRaise: config.ipRiverRaise,
    });
  };

  const dbValue: ConfigValue = {
    startingPot: config.startingPot,
    effectiveStack: config.effectiveStack,
    rakePercent: config.rakePercent,
    rakeCap: config.rakeCap,
    donkOption: Number(config.donkOption),
    oopFlopBet: config.oopFlopBet,
    oopFlopRaise: config.oopFlopRaise,
    oopTurnBet: config.oopTurnBet,
    oopTurnRaise: config.oopTurnRaise,
    oopTurnDonk: config.donkOption ? config.oopTurnDonk : "",
    oopRiverBet: config.oopRiverBet,
    oopRiverRaise: config.oopRiverRaise,
    oopRiverDonk: config.donkOption ? config.oopRiverDonk : "",
    ipFlopBet: config.ipFlopBet,
    ipFlopRaise: config.ipFlopRaise,
    ipTurnBet: config.ipTurnBet,
    ipTurnRaise: config.ipTurnRaise,
    ipRiverBet: config.ipRiverBet,
    ipRiverRaise: config.ipRiverRaise,
    addAllInThreshold: config.addAllInThreshold,
    forceAllInThreshold: config.forceAllInThreshold,
    mergingThreshold: config.mergingThreshold,
    expectedBoardLength: config.expectedBoardLength,
    addedLines: config.addedLines,
    removedLines: config.removedLines,
  };

  const loadConfig = (value: unknown) => {
    const configValue = value as ConfigValue;
    const patch: Partial<TreeConfigState> = {
      startingPot: Number(configValue.startingPot),
      effectiveStack: Number(configValue.effectiveStack),
      rakePercent: Number(configValue.rakePercent),
      rakeCap: Number(configValue.rakeCap),
      donkOption: Boolean(configValue.donkOption),
      addAllInThreshold: Number(configValue.addAllInThreshold),
      forceAllInThreshold: Number(configValue.forceAllInThreshold),
      mergingThreshold: Number(configValue.mergingThreshold),
      expectedBoardLength: Number(configValue.expectedBoardLength),
      addedLines: String(configValue.addedLines),
      removedLines: String(configValue.removedLines),
    };

    for (const [field, _label, isRaise] of betFields) {
      const str = String(configValue[field as keyof ConfigValue] ?? "");
      const res = sanitizeBetString(str, isRaise);
      patch[field] = res.valid ? res.s : str;
    }

    patchConfig(patch);
  };

  const startEdit = () => {
    setIsEditMode(true);
    if (config.expectedBoardLength === 0) {
      patchConfig({ expectedBoardLength: Math.max(config.board.length, 3) });
    }
  };

  const clearEdit = () => {
    patchConfig({ expectedBoardLength: 0, addedLines: "", removedLines: "" });
  };

  const saveEdit = (addedLines: string, removedLines: string) => {
    setIsEditMode(false);
    patchConfig({
      addedLines,
      removedLines,
      expectedBoardLength:
        addedLines === "" && removedLines === ""
          ? 0
          : config.expectedBoardLength,
    });
  };

  const cancelEdit = () => {
    setIsEditMode(false);
    if (config.addedLines === "" && config.removedLines === "") {
      patchConfig({ expectedBoardLength: 0 });
    }
  };

  if (isEditMode) {
    return <TreeEditor onCancel={cancelEdit} onSave={saveEdit} />;
  }

  const renderBetColumn = (
    player: "oop" | "ip",
    street: "Flop" | "Turn" | "River"
  ) => {
    const prefix = `${player}${street}` as const;
    const betField = `${prefix}Bet` as keyof TreeConfigState;
    const raiseField = `${prefix}Raise` as keyof TreeConfigState;
    const donkField = `${prefix}Donk` as keyof TreeConfigState;
    const betInvalid = !(sanitized.get(betField as string)?.valid ?? true);
    const raiseInvalid = !(sanitized.get(raiseField as string)?.valid ?? true);
    const donkInvalid = !(sanitized.get(donkField as string)?.valid ?? true);

    return (
      <div>
        <div className="my-1 underline">{street}</div>
        <TextInput
          disabled={hasEdit}
          invalid={betInvalid}
          isRaise={false}
          label="Bet"
          onChange={(value) => patchConfig({ [betField]: value })}
          value={String(config[betField])}
        />
        <TextInput
          disabled={hasEdit}
          invalid={raiseInvalid}
          isRaise
          label="Raise"
          onChange={(value) => patchConfig({ [raiseField]: value })}
          value={String(config[raiseField])}
        />
        {player === "oop" && street !== "Flop" && config.donkOption && (
          <TextInput
            disabled={hasEdit}
            invalid={donkInvalid}
            isRaise={false}
            label="Donk"
            onChange={(value) => patchConfig({ [donkField]: value })}
            value={String(config[donkField])}
          />
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex">
        <div className="shrink-0">
          <div className="my-1 flex gap-8">
            <div>
              <NumberInput
                disabled={hasEdit}
                invalid={
                  config.startingPot <= 0 ||
                  config.startingPot > MAX_AMOUNT ||
                  config.startingPot % 1 !== 0
                }
                label="Starting pot"
                max={MAX_AMOUNT}
                onChange={(startingPot) => patchConfig({ startingPot })}
                value={config.startingPot}
              />
              <NumberInput
                disabled={hasEdit}
                invalid={
                  config.effectiveStack <= 0 ||
                  config.effectiveStack > MAX_AMOUNT ||
                  config.effectiveStack % 1 !== 0
                }
                label="Effective stack"
                max={MAX_AMOUNT}
                onChange={(effectiveStack) => patchConfig({ effectiveStack })}
                value={config.effectiveStack}
              />
            </div>

            <div>
              <NumberInput
                disabled={hasEdit}
                invalid={config.rakePercent < 0 || config.rakePercent > 100}
                label="Rake"
                max={100}
                onChange={(rakePercent) => patchConfig({ rakePercent })}
                step={0.5}
                suffix="%"
                value={config.rakePercent}
                widthClass="w-24"
              />
              <NumberInput
                disabled={hasEdit}
                invalid={config.rakeCap < 0 || config.rakeCap > 3 * MAX_AMOUNT}
                label="Rake cap"
                max={3 * MAX_AMOUNT}
                onChange={(rakeCap) => patchConfig({ rakeCap })}
                value={config.rakeCap}
                widthClass="w-24"
              />
            </div>

            <div className="ml-auto p-1">
              <button
                className="button-base button-blue"
                onClick={clearConfig}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>

          <ErrorList errors={errorBasics} />

          <div className="mt-6">
            <div className="flex">
              <span className="font-semibold">OOP bet sizes</span>
              <label className="ml-6 inline-block">
                <input
                  checked={config.donkOption}
                  className="peer mr-1 cursor-pointer rounded align-middle"
                  disabled={hasEdit}
                  onChange={(event) =>
                    patchConfig({ donkOption: event.target.checked })
                  }
                  type="checkbox"
                />
                <span className="cursor-pointer peer-disabled:cursor-not-allowed">
                  Use different sizes for donk bets
                </span>
              </label>
            </div>
            <div className="flex gap-5">
              {renderBetColumn("oop", "Flop")}
              {renderBetColumn("oop", "Turn")}
              {renderBetColumn("oop", "River")}
            </div>
          </div>

          <div>
            <div className="flex">
              <div className="mt-6 font-semibold">IP bet sizes</div>
              <div className="flex flex-grow items-center justify-center gap-6">
                <button
                  className="button-base button-blue mt-3 px-2 py-1 text-lg"
                  disabled={errorIp.length > 0 || hasEdit}
                  onClick={ipToOop}
                  type="button"
                >
                  Up
                </button>
                <button
                  className="button-base button-blue mt-3 px-2 py-1 text-lg"
                  disabled={errorOop.length > 0 || hasEdit}
                  onClick={oopToIp}
                  type="button"
                >
                  Down
                </button>
              </div>
            </div>
            <div className="flex gap-5">
              {renderBetColumn("ip", "Flop")}
              {renderBetColumn("ip", "Turn")}
              {renderBetColumn("ip", "River")}
            </div>
          </div>

          <ErrorList errors={[...errorOop, ...errorIp]} />

          <div className="mt-6 flex gap-4">
            <div>
              <NumberInput
                disabled={hasEdit}
                invalid={config.addAllInThreshold < 0}
                label="Add all-in threshold"
                max={MAX_AMOUNT * 100}
                onChange={(addAllInThreshold) =>
                  patchConfig({ addAllInThreshold })
                }
                suffix="%"
                value={config.addAllInThreshold}
                widthClass="w-24"
              />
              <NumberInput
                disabled={hasEdit}
                invalid={config.forceAllInThreshold < 0}
                label="Force all-in threshold"
                max={MAX_AMOUNT * 100}
                onChange={(forceAllInThreshold) =>
                  patchConfig({ forceAllInThreshold })
                }
                suffix="%"
                value={config.forceAllInThreshold}
                widthClass="w-24"
              />
              <NumberInput
                disabled={hasEdit}
                invalid={config.mergingThreshold < 0}
                label="Merging threshold"
                max={MAX_AMOUNT * 100}
                onChange={(mergingThreshold) =>
                  patchConfig({ mergingThreshold })
                }
                suffix="%"
                value={config.mergingThreshold}
                widthClass="w-24"
              />
            </div>

            <div className="flex flex-grow justify-center">
              <div className="flex flex-col justify-center gap-3">
                <button
                  className="button-base button-blue"
                  disabled={!isInputValid}
                  onClick={startEdit}
                  type="button"
                >
                  Preview & Edit Tree
                </button>

                {hasEdit && (
                  <button
                    className="button-base button-red"
                    onClick={clearEdit}
                    type="button"
                  >
                    Clear Edit & Unlock
                  </button>
                )}
              </div>
            </div>
          </div>

          <ErrorList errors={errorMisc} />
          {warningMisc.length > 0 && (
            <div className="mt-1 flex font-semibold text-orange-500">
              <div className="underline">Warning:</div>
              <div className="ml-2">
                {warningMisc.map((warning) => (
                  <div className="whitespace-pre-line" key={warning}>
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="ml-6 mt-1 max-w-[18rem] flex-grow">
          <DbItemPicker
            allowSave={isInputValid}
            onLoadItem={loadConfig}
            storeName="configurations"
            value={dbValue}
            index={0}
          />
        </div>
      </div>

      {(addedLinesArray.length > 0 || removedLinesArray.length > 0) && (
        <div className="mt-5">
          {addedLinesArray.length > 0 && (
            <div className="flex">
              <div className="w-[7.75rem] font-semibold underline">
                Added line{addedLinesArray.length > 1 ? "s" : ""}:
              </div>
              <div className="flex flex-col">
                {addedLinesArray.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {removedLinesArray.length > 0 && (
            <div className="mt-2 flex">
              <div className="w-[7.75rem] font-semibold underline">
                Removed line{removedLinesArray.length > 1 ? "s" : ""}:
              </div>
              <div className="flex flex-col">
                {removedLinesArray.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {config.board.length >= 3 &&
            config.expectedBoardLength > 0 &&
            config.board.length !== config.expectedBoardLength && (
              <div className="mt-2 flex font-semibold text-orange-500">
                <div className="underline">Warning:</div>
                <div className="ml-2">
                  The edited tree assumes a {config.expectedBoardLength}-card
                  board, but the current board consists of {config.board.length}{" "}
                  cards.
                  <br />
                  To reset the edited tree, click the "Clear Edit & Unlock"
                  button.
                </div>
              </div>
            )}
        </div>
      )}

      <ErrorList errors={errorLines} />
    </div>
  );
}

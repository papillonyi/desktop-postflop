import { CheckIcon } from "@heroicons/react/20/solid";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "../../app/hooks";
import type {
  Spot,
  SpotChance,
  SpotPlayer,
  SpotRoot,
} from "../../result-types";
import { convertBetString, readableLineString } from "../../utils";
import * as invokes from "../../invokes";

type TreeEditorProps = {
  onSave: (addedLines: string, removedLines: string) => void;
  onCancel: () => void;
};

function splitLines(lines: string) {
  return lines === "" ? [] : lines.split(",").map(readableLineString);
}

export function TreeEditor({ onCancel, onSave }: TreeEditorProps) {
  const config = useAppSelector((state) => state.config);
  const navRef = useRef<HTMLDivElement | null>(null);
  const spotsRef = useRef<Spot[]>([]);
  const selectedSpotIndexRef = useRef(-1);
  const totalBetAmountRef = useRef([0, 0]);
  const isLockedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isTreeError, setIsTreeError] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [selectedSpotIndex, setSelectedSpotIndex] = useState(-1);
  const [betAmount, setBetAmount] = useState(0);
  const [totalBetAmount, setTotalBetAmount] = useState([0, 0]);
  const [prevBetAmount, setPrevBetAmount] = useState(0);
  const [addedLines, setAddedLines] = useState("");
  const [removedLines, setRemovedLines] = useState("");
  const [invalidLines, setInvalidLines] = useState("");

  const boardLength = config.expectedBoardLength;
  const rootSpot: SpotRoot = useMemo(
    () => ({
      type: "root",
      index: 0,
      player: boardLength === 3 ? "flop" : boardLength === 4 ? "turn" : "river",
      selectedIndex: -1,
      board: config.board,
      pot: config.startingPot,
      stack: config.effectiveStack,
    }),
    [boardLength, config.board, config.effectiveStack, config.startingPot]
  );

  const setSpotsValue = (nextSpots: Spot[]) => {
    spotsRef.current = nextSpots;
    setSpots([...nextSpots]);
  };

  const setSelectedValue = (index: number) => {
    selectedSpotIndexRef.current = index;
    setSelectedSpotIndex(index);
  };

  const setTotalValue = (value: number[]) => {
    totalBetAmountRef.current = value;
    setTotalBetAmount(value);
  };

  const refreshLines = async () => {
    setAddedLines(await invokes.treeAddedLines());
    setRemovedLines(await invokes.treeRemovedLines());
    setInvalidLines(await invokes.treeInvalidTerminals());
  };

  const isSelectedTerminal = useMemo(() => {
    if (isLockedRef.current || selectedSpotIndex === -1) return false;
    return spots[selectedSpotIndex]?.type === "terminal";
  }, [selectedSpotIndex, spots]);

  const isAfterAllin = useMemo(
    () => Math.max(...totalBetAmount) === config.effectiveStack,
    [config.effectiveStack, totalBetAmount]
  );

  const maxAmount = useMemo(() => {
    if (isSelectedTerminal) return 0;
    const maxTotalBetAmount = Math.max(...totalBetAmount);
    return config.effectiveStack - (maxTotalBetAmount - prevBetAmount);
  }, [
    config.effectiveStack,
    isSelectedTerminal,
    prevBetAmount,
    totalBetAmount,
  ]);

  const minAmount = useMemo(() => {
    const betMinus = config.effectiveStack - maxAmount;
    const min = Math.min(...totalBetAmount) - betMinus;
    const max = Math.max(...totalBetAmount) - betMinus;
    return Math.min(Math.max(2 * max - min, 1), maxAmount);
  }, [config.effectiveStack, maxAmount, totalBetAmount]);

  const amountRate = useMemo(() => {
    const pot = config.startingPot + 2 * Math.max(...totalBetAmount);
    const amount = betAmount - prevBetAmount;
    return amount / pot;
  }, [betAmount, config.startingPot, prevBetAmount, totalBetAmount]);

  const existingAmounts = useMemo(() => {
    if (isLockedRef.current || selectedSpotIndex === -1) return [];
    const spot = spots[selectedSpotIndex];
    if (!spot || spot.type !== "player") return [];
    return spot.actions
      .filter((action) => action.amount !== "0")
      .map((action) => Number(action.amount));
  }, [selectedSpotIndex, spots]);

  const addedLinesArray = useMemo(() => splitLines(addedLines), [addedLines]);
  const removedLinesArray = useMemo(
    () => splitLines(removedLines),
    [removedLines]
  );
  const invalidLinesArray = useMemo(
    () => splitLines(invalidLines),
    [invalidLines]
  );

  const encodeLine = (spotIndex: number) => {
    const ret: string[] = [];
    const currentSpots = spotsRef.current;
    for (let i = 1; i < spotIndex; ++i) {
      const spot = currentSpots[i];
      if (spot.type !== "player") continue;
      const action = spot.actions[spot.selectedIndex];
      if (!action) continue;
      if (action.name === "Fold") ret.push("F");
      else if (action.name === "Check") ret.push("X");
      else if (action.name === "Call") ret.push("C");
      else if (action.name === "Bet") ret.push("B" + action.amount);
      else if (action.name === "Raise") ret.push("R" + action.amount);
      else if (action.name === "Allin") ret.push("A" + action.amount);
    }
    return ret;
  };

  const autoScrollNav = () => {
    window.requestAnimationFrame(() => {
      const selectedChild =
        navRef.current?.children[selectedSpotIndexRef.current];
      selectedChild?.scrollIntoView({ behavior: "smooth", inline: "center" });
    });
  };

  const pushResultsTerminal = () => {
    const currentSpots = spotsRef.current;
    const prevSpot = currentSpots[
      selectedSpotIndexRef.current - 1
    ] as SpotPlayer;
    const prevAction = prevSpot.actions[prevSpot.selectedIndex];

    let equityOop = -1;
    if (prevAction.name === "Fold") {
      equityOop = prevSpot.player === "oop" ? 0 : 1;
    }

    setSpotsValue([
      ...currentSpots,
      {
        type: "terminal",
        index: selectedSpotIndexRef.current,
        player: "end",
        selectedIndex: -1,
        prevPlayer: prevSpot.player,
        equityOop,
        pot:
          config.startingPot +
          totalBetAmountRef.current[0] +
          totalBetAmountRef.current[1],
      },
    ]);
  };

  const pushResultsChance = async () => {
    type SpotTurn = SpotRoot | SpotChance;
    const currentSpots = spotsRef.current;
    const prevSpot = currentSpots[
      selectedSpotIndexRef.current - 1
    ] as SpotPlayer;
    const turnSpot = currentSpots.find((spot) => spot.player === "turn") as
      | SpotTurn
      | undefined;
    const nextActions = await invokes.treeActions();

    setSpotsValue([
      ...currentSpots,
      {
        type: "chance",
        index: selectedSpotIndexRef.current,
        player: turnSpot ? "river" : "turn",
        selectedIndex: -1,
        prevPlayer: prevSpot.player,
        cards: Array.from({ length: 52 }, (_, i) => ({
          card: i,
          isSelected: false,
          isDead: true,
        })),
        pot: config.startingPot + 2 * totalBetAmountRef.current[0],
        stack: config.effectiveStack - totalBetAmountRef.current[0],
      },
      {
        type: "player",
        index: selectedSpotIndexRef.current + 1,
        player: "oop",
        selectedIndex: -1,
        actions: nextActions.map((action, i) => {
          const [name, amount] = action.split(":");
          return { index: i, name, amount, isSelected: false, color: "#000" };
        }),
      },
    ]);
  };

  const pushResultsPlayer = async () => {
    const currentSpots = spotsRef.current;
    const prevSpot = currentSpots[selectedSpotIndexRef.current - 1];
    const player = prevSpot.player === "oop" ? "ip" : "oop";
    const actions = await invokes.treeActions();

    setSpotsValue([
      ...currentSpots,
      {
        type: "player",
        index: selectedSpotIndexRef.current,
        player,
        selectedIndex: -1,
        actions: actions.map((action, i) => {
          const [name, amount] = action.split(":");
          return { index: i, name, amount, isSelected: false, color: "#000" };
        }),
      },
    ]);
  };

  const selectSpot = async (
    spotIndex: number,
    needSplice: boolean,
    needRebuild: boolean,
    needAmountUpdate: boolean
  ) => {
    if (
      !needSplice &&
      !needRebuild &&
      spotIndex === selectedSpotIndexRef.current
    ) {
      return;
    }

    if (spotIndex === 0) {
      await selectSpot(1, true, false, selectedSpotIndexRef.current !== 1);
      return;
    }

    if (!needSplice && spotsRef.current[spotIndex]?.type === "chance") {
      await selectSpot(spotIndex + 1, false, false, true);
      return;
    }

    isLockedRef.current = true;

    if (needRebuild) {
      const selectedSpotIndexTmp = selectedSpotIndexRef.current;
      const line = encodeLine(spotsRef.current.length - 1);
      setSpotsValue([rootSpot]);
      setSelectedValue(1);
      setTotalValue([0, 0]);

      await invokes.treeBackToRoot();
      await pushResultsPlayer();

      for (let i = 0; i < line.length; ++i) {
        const index = await invokes.treePlay(line[i]);
        if (index === -1) {
          needAmountUpdate = true;
          break;
        }

        const nextSpots = [...spotsRef.current];
        const spot = {
          ...(nextSpots[selectedSpotIndexRef.current] as SpotPlayer),
        };
        const actions = spot.actions.map((action) => ({ ...action }));
        actions[index].isSelected = true;
        spot.selectedIndex = index;
        spot.actions = actions;
        nextSpots[selectedSpotIndexRef.current] = spot;
        setSpotsValue(nextSpots);

        setSelectedValue(selectedSpotIndexRef.current + 1);
        setTotalValue(await invokes.treeTotalBetAmount());

        if (await invokes.treeIsTerminalNode()) {
          pushResultsTerminal();
        } else if (await invokes.treeIsChanceNode()) {
          await pushResultsChance();
          setSelectedValue(selectedSpotIndexRef.current + 1);
        } else {
          await pushResultsPlayer();
        }
      }

      if (selectedSpotIndexTmp < selectedSpotIndexRef.current) {
        setSelectedValue(selectedSpotIndexTmp);
      }
    } else {
      setSelectedValue(spotIndex);
    }

    const line = encodeLine(selectedSpotIndexRef.current);
    await invokes.treeApplyHistory(line);
    setTotalValue(await invokes.treeTotalBetAmount());

    if (needSplice) {
      setSpotsValue(spotsRef.current.slice(0, selectedSpotIndexRef.current));
      if (await invokes.treeIsTerminalNode()) {
        pushResultsTerminal();
      } else if (await invokes.treeIsChanceNode()) {
        await pushResultsChance();
        setSelectedValue(selectedSpotIndexRef.current + 1);
      } else {
        await pushResultsPlayer();
      }
    }

    const prev = spotsRef.current[selectedSpotIndexRef.current - 1];
    if (prev?.type === "player") {
      setPrevBetAmount(Number(prev.actions[prev.selectedIndex].amount));
    } else {
      setPrevBetAmount(0);
    }

    if (needAmountUpdate) {
      setBetAmount(minAmount);
    }

    isLockedRef.current = false;
    autoScrollNav();
  };

  const play = async (spotIndex: number, actionIndex: number) => {
    const nextSpots = [...spotsRef.current];
    const spot = { ...(nextSpots[spotIndex] as SpotPlayer) };
    spot.actions = spot.actions.map((action, index) => ({
      ...action,
      isSelected: index === actionIndex,
    }));
    spot.selectedIndex = actionIndex;
    nextSpots[spotIndex] = spot;
    setSpotsValue(nextSpots);
    await selectSpot(spotIndex + 1, true, false, true);
  };

  const addBetAction = async () => {
    const isRaise =
      totalBetAmountRef.current[0] !== totalBetAmountRef.current[1];
    await invokes.treeAddBetAction(betAmount, isRaise);
    await selectSpot(selectedSpotIndexRef.current, false, true, false);
    await refreshLines();
  };

  const removeSelectedNode = async () => {
    await invokes.treeRemoveCurrentNode();
    let prevIndex = selectedSpotIndexRef.current - 1;
    if (spotsRef.current[prevIndex].type === "chance") prevIndex -= 1;
    await selectSpot(prevIndex, false, true, true);
    await refreshLines();
  };

  const deleteAddedLine = async (index: number) => {
    const line = addedLines.split(",")[index];
    await invokes.treeDeleteAddedLine(line);
    await selectSpot(selectedSpotIndexRef.current, false, true, false);
    await refreshLines();
  };

  const deleteRemovedLine = async (index: number) => {
    const line = removedLines.split(",")[index];
    await invokes.treeDeleteRemovedLine(line);
    await selectSpot(selectedSpotIndexRef.current, false, true, false);
    await refreshLines();
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setIsLoading(true);
      const ok = await invokes.treeNew(
        boardLength,
        config.startingPot,
        config.effectiveStack,
        config.donkOption,
        convertBetString(config.oopFlopBet),
        convertBetString(config.oopFlopRaise),
        convertBetString(config.oopTurnBet),
        convertBetString(config.oopTurnRaise),
        config.donkOption ? convertBetString(config.oopTurnDonk) : "",
        convertBetString(config.oopRiverBet),
        convertBetString(config.oopRiverRaise),
        config.donkOption ? convertBetString(config.oopRiverDonk) : "",
        convertBetString(config.ipFlopBet),
        convertBetString(config.ipFlopRaise),
        convertBetString(config.ipTurnBet),
        convertBetString(config.ipTurnRaise),
        convertBetString(config.ipRiverBet),
        convertBetString(config.ipRiverRaise),
        config.addAllInThreshold / 100,
        config.forceAllInThreshold / 100,
        config.mergingThreshold / 100,
        config.addedLines,
        config.removedLines
      );

      if (cancelled) return;
      if (!ok) {
        setIsTreeError(true);
        setIsLoading(false);
        return;
      }

      setIsTreeError(false);
      setSpotsValue([rootSpot]);
      setSelectedValue(-1);
      setTotalValue([0, 0]);
      await refreshLines();
      await selectSpot(0, true, false, true);
      if (!cancelled) setIsLoading(false);
    };

    init();
    return () => {
      cancelled = true;
    };
    // Tree editing works from the config snapshot captured when editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (isTreeError)
    return <div>Error: Failed to build tree (loaded broken tree?)</div>;

  const disableAddBet =
    isSelectedTerminal ||
    isAfterAllin ||
    betAmount < minAmount ||
    betAmount > maxAmount ||
    betAmount % 1 !== 0 ||
    existingAmounts.includes(betAmount);

  return (
    <div>
      <div
        className="snug flex h-[10.5rem] gap-1 overflow-x-auto whitespace-nowrap p-1"
        ref={navRef}
      >
        {spots.map((spot) => (
          <div
            className={[
              "group flex h-full flex-col justify-start rounded-lg border-[3px] px-1 py-0.5 shadow-md transition",
              spot.type === "chance"
                ? "hover:border-red-600"
                : "hover:border-blue-600",
              spot.index === selectedSpotIndex
                ? "cursor-default border-blue-600"
                : "cursor-pointer border-gray-400",
            ].join(" ")}
            key={spot.index}
            onClick={() => selectSpot(spot.index, false, false, true)}
          >
            {(spot.type === "root" || spot.type === "chance") && (
              <>
                <div className="px-1.5 pb-0.5 pt-1 font-semibold opacity-70 group-hover:opacity-100">
                  {spot.player.toUpperCase()}
                </div>
                <div className="flex flex-grow flex-col items-center justify-evenly px-3 font-semibold">
                  <div className="opacity-70 group-hover:opacity-100">
                    <div>Pot {spot.pot}</div>
                    <div>Stack {spot.stack}</div>
                  </div>
                </div>
              </>
            )}

            {spot.type === "player" && (
              <>
                <div
                  className={[
                    "px-1.5 py-1 font-semibold group-hover:opacity-100",
                    spot.index === selectedSpotIndex ? "" : "opacity-70",
                  ].join(" ")}
                >
                  {spot.player.toUpperCase()}
                </div>
                <div className="flex-grow overflow-y-auto">
                  {spot.actions.map((action) => (
                    <button
                      className={[
                        "flex w-full rounded-md px-1.5 transition-colors hover:bg-blue-100",
                        action.isSelected ? "bg-blue-100" : "",
                      ].join(" ")}
                      key={action.index}
                      onClick={(event) => {
                        event.stopPropagation();
                        play(spot.index, action.index);
                      }}
                      type="button"
                    >
                      <span className="relative mr-0.5 inline-block w-4">
                        {action.isSelected && (
                          <CheckIcon className="absolute -left-0.5 top-[0.1875rem] h-4 w-4" />
                        )}
                      </span>
                      <span
                        className={[
                          "pr-0.5 font-semibold group-hover:opacity-100",
                          action.isSelected || spot.index === selectedSpotIndex
                            ? ""
                            : "opacity-70",
                        ].join(" ")}
                      >
                        {action.name}{" "}
                        {action.amount === "0" ? "" : action.amount}
                      </span>
                    </button>
                  ))}
                  {spot.actions.length === 0 && (
                    <div
                      className={[
                        "flex w-full px-1.5 font-semibold group-hover:opacity-100",
                        spot.index === selectedSpotIndex ? "" : "opacity-70",
                      ].join(" ")}
                    >
                      (No actions)
                    </div>
                  )}
                </div>
              </>
            )}

            {spot.type === "terminal" && (
              <>
                <div
                  className={[
                    "px-1.5 pb-0.5 pt-1 font-semibold group-hover:opacity-100",
                    spot.index === selectedSpotIndex ? "" : "opacity-70",
                  ].join(" ")}
                >
                  {spot.player.toUpperCase()}
                </div>
                <div
                  className={[
                    "flex flex-grow flex-col items-center justify-evenly font-semibold group-hover:opacity-100",
                    spot.index === selectedSpotIndex ? "" : "opacity-70",
                  ].join(" ")}
                >
                  {(spot.equityOop === 0 || spot.equityOop === 1) && (
                    <div className="px-3">
                      {["IP", "OOP"][spot.equityOop]} Wins
                    </div>
                  )}
                  <div className="px-3">Pot {spot.pot}</div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {invalidLinesArray.length > 0 && (
        <div className="mt-4 flex font-semibold text-red-500">
          <div className="underline">
            Invalid Terminal{invalidLinesArray.length > 1 ? "s" : ""}:
          </div>
          <div className="ml-2">
            {invalidLinesArray.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-6 my-6 flex justify-center">
        <hr className="w-full border-gray-400" />
      </div>

      <div className="flex gap-3">
        <button
          className="button-base button-blue"
          disabled={disableAddBet}
          onClick={addBetAction}
          type="button"
        >
          Add Bet Action
        </button>
        <button
          className="button-base button-red"
          disabled={selectedSpotIndex === 1}
          onClick={removeSelectedNode}
          type="button"
        >
          Remove Selected Node
        </button>
        <div className="pl-3">
          Bet amount:
          <input
            className={[
              "ml-2 w-24 rounded-lg px-2 py-1 text-center text-sm",
              betAmount < minAmount ||
              betAmount > maxAmount ||
              betAmount % 1 !== 0
                ? "input-error"
                : "",
            ].join(" ")}
            max={maxAmount}
            min={minAmount}
            onChange={(event) => setBetAmount(Number(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disableAddBet) addBetAction();
            }}
            type="number"
            value={betAmount}
          />
          {!isSelectedTerminal && !isAfterAllin && (
            <span className="ml-2">
              ({(amountRate * 100).toFixed(1)}% of the pot)
            </span>
          )}
        </div>
      </div>

      <div className="mx-6 my-6 flex justify-center">
        <hr className="w-full border-gray-400" />
      </div>

      <div className="my-6 flex gap-3">
        <button
          className="button-base button-blue"
          disabled={invalidLinesArray.length > 0}
          onClick={() => onSave(addedLines, removedLines)}
          type="button"
        >
          Save Edit
        </button>
        <button
          className="button-base button-red"
          onClick={onCancel}
          type="button"
        >
          Cancel Edit
        </button>
      </div>

      {(addedLinesArray.length > 0 || removedLinesArray.length > 0) && (
        <div>
          {addedLinesArray.length > 0 && (
            <div className="flex">
              <div className="w-[7.75rem] font-semibold underline">
                Added line{addedLinesArray.length > 1 ? "s" : ""}:
              </div>
              <div className="flex flex-col">
                {addedLinesArray.map((line, index) => (
                  <div className="flex items-center" key={line}>
                    <button
                      className="mr-2"
                      onClick={() => deleteAddedLine(index)}
                      type="button"
                    >
                      <TrashIcon className="h-5 w-5 text-gray-600" />
                    </button>
                    <span>{line}</span>
                  </div>
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
                {removedLinesArray.map((line, index) => (
                  <div className="flex items-center" key={line}>
                    <button
                      className="mr-2"
                      onClick={() => deleteRemovedLine(index)}
                      type="button"
                    >
                      <TrashIcon className="h-5 w-5 text-gray-600" />
                    </button>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

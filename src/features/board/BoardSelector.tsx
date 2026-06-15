import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setBoard } from "../../app/slices/configSlice";
import { BoardCard } from "../../shared/components/BoardCard";
import { cardText, parseCardString } from "../../utils";

function boardToText(board: number[]) {
  return board
    .map(cardText)
    .map(({ rank, suitLetter }) => rank + suitLetter)
    .join(", ");
}

export function BoardSelector() {
  const dispatch = useAppDispatch();
  const board = useAppSelector((state) => state.config.board);
  const expectedBoardLength = useAppSelector(
    (state) => state.config.expectedBoardLength
  );
  const [boardText, setBoardText] = useState(() => boardToText(board));

  useEffect(() => {
    setBoardText(boardToText(board));
  }, [board]);

  const updateBoard = (nextBoard: number[]) => {
    dispatch(setBoard(nextBoard));
  };

  const toggleCard = (cardId: number) => {
    if (board.includes(cardId)) {
      updateBoard(board.filter((card) => card !== cardId));
      return;
    }

    if (board.length >= 5) return;

    const nextBoard = [...board, cardId];
    if (nextBoard.length <= 3) {
      nextBoard.sort((a, b) => b - a);
    }
    updateBoard(nextBoard);
  };

  const onBoardTextChange = (text: string) => {
    const cardIds = text
      .trim()
      .replace(/[^A-Za-z0-9\s,]/g, "")
      .replace(/\s+/g, ",")
      .split(",")
      .map(parseCardString)
      .filter((cardId): cardId is number => cardId !== null);

    const uniqueCards = Array.from(new Set(cardIds)).slice(0, 5);
    const nextBoard: number[] = [];
    uniqueCards.forEach((cardId) => {
      if (!nextBoard.includes(cardId)) {
        nextBoard.push(cardId);
      }
    });
    if (nextBoard.length <= 3) {
      nextBoard.sort((a, b) => b - a);
    }
    updateBoard(nextBoard);
  };

  const generateRandomBoard = () => {
    const nextBoard: number[] = [];

    while (nextBoard.length < 3) {
      const randomCard = Math.floor(Math.random() * 52);
      if (!nextBoard.includes(randomCard)) {
        nextBoard.push(randomCard);
      }
    }

    nextBoard.sort((a, b) => b - a);
    updateBoard(nextBoard);
  };

  return (
    <div>
      {Array.from({ length: 4 }, (_, suitIndex) => (
        <div className="flex" key={suitIndex}>
          {Array.from({ length: 13 }, (_, rankIndex) => {
            const cardId = 56 - 4 * (rankIndex + 1) - (suitIndex + 1);
            return (
              <BoardCard
                cardId={cardId}
                className="m-1"
                isSelected={board.includes(cardId)}
                key={cardId}
                onClick={() => toggleCard(cardId)}
              />
            );
          })}
        </div>
      ))}

      <div className="mx-1 mt-4 flex gap-3">
        <input
          className="w-40 rounded-lg px-2 py-1 text-sm"
          onChange={(event) => {
            setBoardText(event.target.value);
            onBoardTextChange(event.target.value);
          }}
          onFocus={(event) => event.currentTarget.select()}
          type="text"
          value={boardText}
        />
        <button
          className="button-base button-blue"
          onClick={() => updateBoard([])}
          type="button"
        >
          Clear
        </button>
        <button
          className="button-base button-blue"
          onClick={generateRandomBoard}
          type="button"
        >
          Random Flop
        </button>
      </div>

      {board.length >= 3 &&
        expectedBoardLength > 0 &&
        board.length !== expectedBoardLength && (
          <div className="mt-5 font-semibold text-orange-500">
            <span className="underline">Warning:</span> The edited tree assumes
            a {expectedBoardLength}-card board.
          </div>
        )}
    </div>
  );
}

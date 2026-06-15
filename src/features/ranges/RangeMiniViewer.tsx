import { useAppSelector } from "../../app/hooks";

const yellow500 = "#eab308";

type RangeMiniViewerProps = {
  className?: string;
  onClick?: () => void;
  player: number;
};

export function RangeMiniViewer({
  className = "",
  onClick,
  player,
}: RangeMiniViewerProps) {
  const range = useAppSelector((state) => state.ranges.values[player]);

  const cellValue = (row: number, col: number) => {
    const cellIndex = (row - 1) * 13 + (col - 1);
    return range[cellIndex] ?? 0;
  };

  return (
    <table className={`shadow-md ${className}`} onClick={onClick}>
      <tbody>
        {Array.from({ length: 13 }, (_, rowIndex) => {
          const row = rowIndex + 1;
          return (
            <tr className="h-2.5" key={row}>
              {Array.from({ length: 13 }, (_, colIndex) => {
                const col = colIndex + 1;
                return (
                  <td
                    className="relative w-2.5 border-[0.5px] border-black"
                    key={col}
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
                          backgroundSize: `100% ${cellValue(row, col)}%`,
                        }}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

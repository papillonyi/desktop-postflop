import type { ButtonHTMLAttributes } from "react";
import { cardText } from "../../utils";

type BoardCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  cardId: number;
  isSelected?: boolean;
  width?: string;
  fontSize?: string;
};

export function BoardCard({
  cardId,
  isSelected = false,
  width = "40px",
  fontSize = "1rem",
  className = "",
  style,
  ...props
}: BoardCardProps) {
  const { rank, suit, colorClass } = cardText(cardId);

  return (
    <button
      className={[
        "relative select-none rounded-lg border enabled:shadow",
        isSelected
          ? "border-red-600 bg-yellow-300 ring-1 ring-red-600"
          : "border-black bg-white",
        className,
      ].join(" ")}
      style={{
        width,
        paddingTop: `calc(${width} * 1.4 - 2px)`,
        ...style,
      }}
      type="button"
      {...props}
    >
      <span
        className={`absolute top-0 font-semibold ${colorClass}`}
        style={{ left: "15%", fontSize: `calc(${fontSize} * 1.25)` }}
      >
        {rank}
      </span>
      <span
        className={`absolute ${colorClass}`}
        style={{ bottom: "5%", right: "10%", fontSize }}
      >
        {suit}
      </span>
    </button>
  );
}

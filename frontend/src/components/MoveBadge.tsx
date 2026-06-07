import type { Classification } from "../types";

/** chess.com-style move-quality badge: a colored circle with a glyph/icon. */
export function MoveBadge({ c, size = 22 }: { c: Classification; size?: number }) {
  const s = size;
  return (
    <span
      title={c.label}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: s, height: s, background: c.color, fontSize: s * 0.5 }}
    >
      <Glyph kind={c.kind} symbol={c.symbol} size={s} />
    </span>
  );
}

function Glyph({ kind, symbol, size }: { kind: string; symbol: string; size: number }) {
  const ic = size * 0.62;
  if (kind === "best")
    return (
      <svg width={ic} height={ic} viewBox="0 0 24 24" fill="white">
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01L12 2z" />
      </svg>
    );
  if (kind === "excellent")
    return (
      <svg width={ic} height={ic} viewBox="0 0 24 24" fill="white">
        <path d="M2 10h3v11H2zM7 21h10.5a1.5 1.5 0 0 0 1.48-1.26l1.4-8.5A1.5 1.5 0 0 0 18.9 9.5H14l.7-3.6a1.6 1.6 0 0 0-3-1L7.6 9.4V21z" />
      </svg>
    );
  if (kind === "good")
    return (
      <svg width={ic} height={ic} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    );
  // brilliant !!, great !, inaccuracy ?!, mistake ?, blunder ??
  return <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>{symbol}</span>;
}

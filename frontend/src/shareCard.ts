// Render a shareable Game Review card (PNG) for TikTok / IG / Twitter.
import type { ReviewRow } from "./types";

const KINDS = [
  { kind: "brilliant", label: "Brilliant", symbol: "!!", color: "#1bada6" },
  { kind: "great", label: "Great", symbol: "!", color: "#5b8baf" },
  { kind: "best", label: "Best", symbol: "★", color: "#7cae3e" },
  { kind: "excellent", label: "Excellent", symbol: "✦", color: "#7cae3e" },
  { kind: "good", label: "Good", symbol: "✓", color: "#95b776" },
  { kind: "inaccuracy", label: "Inaccuracy", symbol: "?!", color: "#e6b32a" },
  { kind: "mistake", label: "Mistake", symbol: "?", color: "#e0892a" },
  { kind: "blunder", label: "Blunder", symbol: "??", color: "#e0392a" },
];

export async function makeShareCard(
  rows: ReviewRow[],
  accuracy: number
): Promise<Blob> {
  const W = 1080;
  const H = 1080;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const SF = "-apple-system, 'SF Pro Text', Inter, Helvetica, Arial, sans-serif";

  ctx.fillStyle = "#15181c";
  ctx.fillRect(0, 0, W, H);

  // title
  ctx.fillStyle = "#fff";
  ctx.font = `800 46px ${SF}`;
  ctx.fillText("Social Stockfish", 80, 120);
  ctx.fillStyle = "#7f8a98";
  ctx.font = `600 30px ${SF}`;
  ctx.fillText("GAME REVIEW", 80, 165);

  // accuracy
  ctx.fillStyle = "#7f8a98";
  ctx.font = `700 30px ${SF}`;
  ctx.fillText("YOUR ACCURACY", 80, 270);
  ctx.fillStyle = "#fff";
  ctx.font = `800 170px ${SF}`;
  ctx.fillText(accuracy.toFixed(1), 76, 430);

  // eval graph
  drawGraph(ctx, 80, 470, W - 160, 170, rows.map((r) => r.eval));

  // move breakdown
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.classification) counts[r.classification.kind] = (counts[r.classification.kind] || 0) + 1;
  let y = 740;
  for (const k of KINDS) {
    const n = counts[k.kind];
    if (!n) continue;
    badge(ctx, 100, y, k.color, k.symbol);
    ctx.fillStyle = "#cfd5dd";
    ctx.font = `600 34px ${SF}`;
    ctx.textAlign = "left";
    ctx.fillText(k.label, 156, y + 12);
    ctx.fillStyle = k.color;
    ctx.font = `800 36px ${SF}`;
    ctx.textAlign = "right";
    ctx.fillText(String(n), W - 90, y + 12);
    y += 66;
  }

  // footer
  ctx.textAlign = "left";
  ctx.fillStyle = "#7f8a98";
  ctx.font = `600 30px ${SF}`;
  ctx.fillText("chat.lulzx.space", 80, H - 60);

  return new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, symbol: string) {
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 24px -apple-system, Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol, x, y + 1);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function drawGraph(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, evals: number[]) {
  ctx.fillStyle = "#23272e";
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  if (evals.length < 2) return;
  const pts = evals.map((e, i) => [x + (i / (evals.length - 1)) * w, y + h - e * h] as const);
  // area
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (const [px, py] of pts) ctx.lineTo(px, py);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  // midline
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function shareOrDownloadCard(blob: Blob) {
  const file = new File([blob], "social-stockfish-review.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My Social Stockfish Game Review" });
      return;
    } catch {
      /* fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "social-stockfish-review.png";
  a.click();
  URL.revokeObjectURL(url);
}

// 启动横幅 logo 模型：单元格类型、字母跨度、笔画序映射、笔画节奏与 LayoutBuilder。
// 自 extensions/startup-banner.ts 拆分（机械平移，语义零改动）。

import { TEXT_LOGO } from "./banner-config.ts";
type CellType =
  | "banner"
  | "logo-tip"
  | "logo-fresh"
  | "logo-ink"
  | "rose"
  | "label"
  | "value"
  | "dim"
  | "accent"
  | "none";
type LayoutCell = { char: string; type: CellType };
type LogoCellType = Extract<
  CellType,
  "banner" | "logo-tip" | "logo-fresh" | "logo-ink"
>;

const LOGO_CELL_TYPES: ReadonlySet<CellType> = new Set<CellType>([
  "banner",
  "logo-tip",
  "logo-fresh",
  "logo-ink",
]);

export function isLogoCellType(type: CellType): type is LogoCellType {
  return LOGO_CELL_TYPES.has(type);
}

type Span = { start: number; end: number };

function computeLogoBounds(lines: string[]): Span {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== " ") {
        if (i < start) start = i;
        if (i > end) end = i;
      }
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: 0 };
  }
  return { start, end };
}

function buildLetterSpans(bounds: Span, weights: number[]): Span[] {
  const spanWidth = Math.max(1, bounds.end - bounds.start + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = bounds.start;
  return weights.map((w, i) => {
    const remaining = bounds.end - cursor + 1;
    const raw = Math.max(1, Math.round((w / total) * spanWidth));
    const width =
      i === weights.length - 1
        ? remaining
        : Math.min(raw, remaining - (weights.length - i - 1));
    const s = cursor;
    const e = s + width - 1;
    cursor = e + 1;
    return { start: s, end: e };
  });
}

export const LOGO_BOUNDS = computeLogoBounds(TEXT_LOGO);
const LETTER_WEIGHTS = [14, 10, 11, 10, 9, 11, 6, 13, 12]; // G E N T L E - P I
const LETTER_SPANS = buildLetterSpans(LOGO_BOUNDS, LETTER_WEIGHTS);

function letterIndexAtX(x: number): number {
  for (let i = 0; i < LETTER_SPANS.length; i++) {
    const s = LETTER_SPANS[i];
    if (x >= s.start && x <= s.end) return i;
  }
  if (x < LETTER_SPANS[0].start) return 0;
  return LETTER_SPANS.length - 1;
}

type Point = { x: number; y: number };

function pointKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function buildLetterStrokeMap(letterIdx: number): { orderMap: Map<string, number>; maxOrder: number } {
  const span = LETTER_SPANS[letterIdx];
  const points: Point[] = [];
  const pointSet = new Set<string>();

  for (let y = 0; y < TEXT_LOGO.length; y++) {
    const line = TEXT_LOGO[y] ?? "";
    for (let x = span.start; x <= Math.min(span.end, line.length - 1); x++) {
      if (line[x] !== " ") {
        points.push({ x, y });
        pointSet.add(pointKey(x, y));
      }
    }
  }

  const neighbors8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ] as const;

  const visited = new Set<string>();
  const components: Point[][] = [];

  for (const p of points) {
    const k = pointKey(p.x, p.y);
    if (visited.has(k)) continue;

    const stack = [p];
    const comp: Point[] = [];
    visited.add(k);

    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const [dx, dy] of neighbors8) {
        const nk = pointKey(cur.x + dx, cur.y + dy);
        if (!visited.has(nk) && pointSet.has(nk)) {
          visited.add(nk);
          stack.push({ x: cur.x + dx, y: cur.y + dy });
        }
      }
    }

    components.push(comp);
  }

  components.sort((a, b) => {
    const ax = Math.min(...a.map((p) => p.x));
    const bx = Math.min(...b.map((p) => p.x));
    if (ax !== bx) return ax - bx;
    const ay = Math.min(...a.map((p) => p.y));
    const by = Math.min(...b.map((p) => p.y));
    return ay - by;
  });

  const orderMap = new Map<string, number>();
  let order = 0;

  for (const comp of components) {
    const compSet = new Set(comp.map((p) => pointKey(p.x, p.y)));
    const compMap = new Map(comp.map((p) => [pointKey(p.x, p.y), p]));

    let current = comp.reduce((best, p) =>
      p.x < best.x || (p.x === best.x && p.y < best.y) ? p : best,
    );

    let dirX = 1;
    let dirY = 0;

    while (compSet.size > 0) {
      const ck = pointKey(current.x, current.y);
      if (compSet.has(ck)) {
        compSet.delete(ck);
        orderMap.set(ck, order++);
      }
      if (compSet.size === 0) break;

      const candidates: Point[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nk = pointKey(current.x + dx, current.y + dy);
          if (compSet.has(nk)) {
            const point = compMap.get(nk);
            if (point) candidates.push(point);
          }
        }
      }

      let next: Point | null = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const adx = a.x - current.x;
          const ady = a.y - current.y;
          const bdx = b.x - current.x;
          const bdy = b.y - current.y;

          const aDist = Math.hypot(adx, ady);
          const bDist = Math.hypot(bdx, bdy);
          const aTurn = Math.abs(adx * dirY - ady * dirX);
          const bTurn = Math.abs(bdx * dirY - bdy * dirX);

          const aScore = aDist * 3.8 + aTurn * 1.3 + Math.abs(ady) * 0.12;
          const bScore = bDist * 3.8 + bTurn * 1.3 + Math.abs(bdy) * 0.12;
          return aScore - bScore;
        });
        next = candidates[0];
      } else {
        let best: Point | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const k of compSet) {
          const p = compMap.get(k);
          if (!p) continue;
          const dx = p.x - current.x;
          const dy = p.y - current.y;
          const score = Math.hypot(dx, dy) + Math.abs(dy) * 0.16;
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }
        next = best;
      }

      if (!next) break;
      dirX = next.x - current.x;
      dirY = next.y - current.y;
      current = next;
    }
  }

  return { orderMap, maxOrder: Math.max(1, order - 1) };
}

type LetterStroke = { orderMap: Map<string, number>; maxOrder: number };

const WRITING_START_TICK = 6;
const FALLBACK_LETTER_TICKS = 8;

const LETTER_STROKES: Array<LetterStroke | null> = LETTER_SPANS.map(() => null);
const LETTER_TICKS: number[] = LETTER_SPANS.map(() => FALLBACK_LETTER_TICKS);
const LETTER_START_TICKS: number[] = LETTER_SPANS.map(
  (_, i) => WRITING_START_TICK + i * FALLBACK_LETTER_TICKS,
);
export let WRITING_END_TICK =
  WRITING_START_TICK + LETTER_TICKS.reduce((a, b) => a + b, 0);

function recomputeLetterTicks(): void {
  for (let i = 0; i < LETTER_STROKES.length; i++) {
    const stroke = LETTER_STROKES[i];
    LETTER_TICKS[i] = stroke
      ? Math.max(5, Math.ceil(((stroke.maxOrder + 8) / 11) * 0.48))
      : FALLBACK_LETTER_TICKS;
  }
  let acc = WRITING_START_TICK;
  for (let i = 0; i < LETTER_TICKS.length; i++) {
    LETTER_START_TICKS[i] = acc;
    acc += LETTER_TICKS[i];
  }
  WRITING_END_TICK = acc;
}

export function allStrokesReady(): boolean {
  for (const stroke of LETTER_STROKES) if (stroke === null) return false;
  return true;
}

let warmupStarted = false;
export async function warmupLetterStrokes(): Promise<void> {
  if (warmupStarted) return;
  warmupStarted = true;
  for (let i = 0; i < LETTER_SPANS.length; i++) {
    if (LETTER_STROKES[i] !== null) continue;
    LETTER_STROKES[i] = buildLetterStrokeMap(i);
    recomputeLetterTicks();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function buildPenLogoLine(
  line: string,
  rowIdx: number,
  _totalRows: number,
  tick: number,
): LayoutCell[] {
  const out: LayoutCell[] = [];

  for (let x = 0; x < line.length; x++) {
    const ch = line[x] ?? " ";
    if (ch === " ") {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const letterIdx = letterIndexAtX(x);
    const stroke = LETTER_STROKES[letterIdx];
    if (stroke === null) {
      out.push({ char: ch, type: "logo-ink" });
      continue;
    }
    const startTick = LETTER_START_TICKS[letterIdx];
    const duration = LETTER_TICKS[letterIdx];
    const progress = (tick - startTick) / Math.max(1, duration);

    if (progress < 0) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const head = progress * (stroke.maxOrder + 7);
    const rawOrder = stroke.orderMap.get(pointKey(x, rowIdx));
    if (rawOrder === undefined) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    let order = rawOrder;
    // v1：只针对首字母（G）做调整，加强书法感的弧度。
    if (letterIdx === 0) {
      const s = LETTER_SPANS[0];
      const w = Math.max(1, s.end - s.start + 1);
      const localX = x - s.start;
      const curveBias =
        Math.sin((localX / w) * Math.PI * 1.35 + rowIdx * 0.26) * 2.2 +
        Math.cos((localX / w) * Math.PI * 0.72 - rowIdx * 0.20) * 1.3;
      order = rawOrder + curveBias;
    }

    if (head < order) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const age = head - order;
    if (age < 1.2) out.push({ char: ch, type: "logo-tip" });
    else if (age < 4.9) out.push({ char: ch, type: "logo-fresh" });
    else out.push({ char: ch, type: "logo-ink" });
  }
  return out;
}

export class LayoutBuilder {
  lines: LayoutCell[][] = [];

  addRow() {
    this.lines.push([]);
  }

  add(type: CellType, text: string) {
    const row = this.lines[this.lines.length - 1];
    for (const char of text) row.push({ char, type });
  }

  center(width: number) {
    const row = this.lines[this.lines.length - 1];
    const pad = Math.max(0, Math.floor((width - row.length) / 2));
    const prefix: LayoutCell[] = Array.from({ length: pad }, () => ({
      char: " ",
      type: "none" as const,
    }));
    this.lines[this.lines.length - 1] = prefix.concat(row);
  }
}

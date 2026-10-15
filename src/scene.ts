// What is exported (ТЗ 39 §4): a scene of boxes with lines of text, frames and arrows — made from a canvas or a
// mindmap — written as Excalidraw's JSON (a file, or its clipboard) or as SVG (and PNG from it). Pure: the text is
// measured by the function given.

export interface Line {
  text: string;
  size: number;
  weight?: 400 | 600 | 700;
  /** A colour of the line itself (grey for a card's file). */
  color?: string;
  mono?: boolean;
}
export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Line[];
  stroke: string;
  fill: string;
  /** The text's own colour (white on the mindmap's root). */
  ink?: string;
  radius: number;
  strokeWidth?: number;
  /** A group: a frame with its label. */
  frame?: boolean;
  /** The boxes inside a frame. */
  in?: string;
  link?: string;
}
export interface Arrow {
  id: string;
  from: string;
  to: string;
  /** The points of its way (at least two), from the first box's side to the second's. */
  points: [number, number][];
  color: string;
  width?: number;
  head: boolean;
  label?: string;
  /** A smooth curve through the points (the mindmap's), else straight segments. */
  curve?: boolean;
}
export interface Scene {
  boxes: Box[];
  arrows: Arrow[];
  background: string;
  ink: string;
  /** The font for SVG / PNG. */
  font: string;
}
export type Measure = (text: string, size: number, weight: number) => number;

/** The box around everything, `pad` around. */
export function boundsOf(s: Scene, pad = 0) {
  const xs = [...s.boxes.flatMap((b) => [b.x, b.x + b.w]), ...s.arrows.flatMap((a) => a.points.map((p) => p[0]))];
  const ys = [...s.boxes.flatMap((b) => [b.y, b.y + b.h]), ...s.arrows.flatMap((a) => a.points.map((p) => p[1]))];
  if (!xs.length) return { x: 0, y: 0, w: 2 * pad, h: 2 * pad };
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}
/** Only what lies in a rectangle (the visible part): the boxes that meet it and the arrows between them. */
export function cropped(s: Scene, r: { x: number; y: number; w: number; h: number }): Scene {
  const boxes = s.boxes.filter((b) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h);
  const ids = new Set(boxes.map((b) => b.id));
  return { ...s, boxes, arrows: s.arrows.filter((a) => ids.has(a.from) && ids.has(a.to)) };
}

/** Lines broken to a width, by words (a long word alone on its line). */
export function wrap(text: string, width: number, size: number, weight: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measure(next, size, weight) > width) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

// ---- Excalidraw ----

let seed = 1;
const rnd = () => (seed = (seed * 48271) % 2147483647);
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map((x) => x + x).join('').toLowerCase() : c);
function base(id: string, type: string, x: number, y: number, w: number, h: number, o: Record<string, unknown> = {}) {
  return {
    id, type, x, y, width: w, height: h, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [] as string[], frameId: null as string | null, roundness: null as unknown, seed: rnd(), version: 1, versionNonce: rnd(), isDeleted: false,
    boundElements: [] as { type: string; id: string }[], updated: 1, link: null as string | null, locked: false,
    ...o,
  };
}
/** Excalidraw's «Normal» font (Nunito). */
const NORMAL = 6;

/** The elements of a scene in Excalidraw: rectangles with their text bound in them, frames, arrows bound to the
 *  rectangles (their labels bound in them). */
export function excalidrawElements(s: Scene): unknown[] {
  seed = 7;
  const els: ReturnType<typeof base>[] = [];
  const byId = new Map<string, ReturnType<typeof base>>();
  // frames first: Excalidraw draws them under their children
  for (const b of s.boxes.filter((x) => x.frame)) {
    const f = base(`f-${b.id}`, 'frame', b.x, b.y, b.w, b.h, { name: b.lines[0]?.text ?? '', strokeColor: hex(b.stroke) });
    els.push(f);
    byId.set(b.id, f);
  }
  for (const b of s.boxes.filter((x) => !x.frame)) {
    const frameId = b.in && byId.get(b.in) ? byId.get(b.in)!.id : null;
    const r = base(`r-${b.id}`, 'rectangle', b.x, b.y, b.w, b.h, {
      strokeColor: hex(b.stroke), backgroundColor: hex(b.fill), strokeWidth: b.strokeWidth ?? 1, roundness: { type: 3, value: b.radius }, frameId, link: b.link ?? null,
    });
    els.push(r);
    byId.set(b.id, r);
    const text = b.lines.map((l) => l.text).join('\n');
    if (!text) continue;
    const size = b.lines[0]?.size ?? 16;
    const t = base(`t-${b.id}`, 'text', b.x + 10, b.y + 10, b.w - 20, Math.min(b.h - 20, b.lines.length * size * 1.25), {
      strokeColor: hex(b.ink ?? s.ink), text, originalText: text, fontSize: size, fontFamily: NORMAL, textAlign: 'left', verticalAlign: 'top', containerId: r.id, lineHeight: 1.25, autoResize: true, frameId,
    });
    r.boundElements.push({ type: 'text', id: t.id });
    els.push(t);
  }
  for (const a of s.arrows) {
    const from = byId.get(a.from);
    const to = byId.get(a.to);
    // a canvas's curve (its two control points): its ends and its middle, made smooth by Excalidraw
    const way: [number, number][] =
      a.curve && a.points.length === 4
        ? [a.points[0], [0, 1].map((k) => (a.points[0][k] + 3 * a.points[1][k] + 3 * a.points[2][k] + a.points[3][k]) / 8) as [number, number], a.points[3]]
        : a.points;
    const [x0, y0] = way[0];
    const pts = way.map(([x, y]) => [x - x0, y - y0]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const el = base(`a-${a.id}`, 'arrow', x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      strokeColor: hex(a.color), strokeWidth: a.width ?? 1, roundness: a.curve ? { type: 2 } : null, points: pts, lastCommittedPoint: null,
      startBinding: from ? { elementId: from.id, focus: 0, gap: 1 } : null, endBinding: to ? { elementId: to.id, focus: 0, gap: 1 } : null,
      startArrowhead: null, endArrowhead: a.head ? 'arrow' : null, elbowed: false,
    });
    from?.boundElements.push({ type: 'arrow', id: el.id });
    to?.boundElements.push({ type: 'arrow', id: el.id });
    els.push(el);
    if (a.label) {
      const mid = way[Math.floor(way.length / 2)];
      const t = base(`l-${a.id}`, 'text', mid[0] - 40, mid[1] - 10, 80, 20, { strokeColor: hex(a.color), text: a.label, originalText: a.label, fontSize: 14, fontFamily: NORMAL, textAlign: 'center', verticalAlign: 'middle', containerId: el.id, lineHeight: 1.25, autoResize: true });
      el.boundElements.push({ type: 'text', id: t.id });
      els.push(t);
    }
  }
  return els;
}
/** A `.excalidraw` file: open it on excalidraw.com. */
export function excalidrawFile(s: Scene): string {
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'panopticon', elements: excalidrawElements(s), appState: { viewBackgroundColor: hex(s.background), gridSize: null }, files: {} }, null, 2);
}
/** What Excalidraw takes from the clipboard (⌘V on an open board). */
export function excalidrawClipboard(s: Scene): string {
  return JSON.stringify({ type: 'excalidraw/clipboard', elements: excalidrawElements(s), files: {} });
}

// ---- SVG ----

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function smooth(p: [number, number][]): string {
  if (p.length < 2) return '';
  if (p.length === 2) {
    const [a, b] = p;
    const mx = (a[0] + b[0]) / 2;
    return `M${a[0]} ${a[1]} C${mx} ${a[1]} ${mx} ${b[1]} ${b[0]} ${b[1]}`;
  }
  return `M${p[0][0]} ${p[0][1]} C${p.slice(1).map((q) => `${q[0]} ${q[1]}`).join(' ')}`;
}
/** The scene as an SVG picture (the theme's background), `pad` around it. */
export function svgOf(s: Scene, measure: Measure, pad = 24): string {
  const b = boundsOf(s, pad);
  const parts: string[] = [];
  parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${esc(s.background)}"/>`);
  const text = (x: Box) => {
    let y = x.y + (x.frame ? 18 : 12);
    const out: string[] = [];
    for (const l of x.lines) {
      const w = l.weight ?? 400;
      for (const row of x.frame ? [l.text] : wrap(l.text, x.w - 24, l.size, w, measure)) {
        y += l.size * 1.05;
        if (!x.frame && y > x.y + x.h - 4) return out.join('');
        out.push(`<text x="${x.x + (x.frame ? 14 : 12)}" y="${y}" font-size="${l.size}" font-weight="${w}"${l.mono ? ' font-family="ui-monospace, Menlo, monospace"' : ''} fill="${esc(l.color ?? x.ink ?? s.ink)}">${esc(row)}</text>`);
        y += l.size * 0.3;
      }
    }
    return out.join('');
  };
  for (const x of s.boxes.filter((q) => q.frame)) parts.push(`<rect x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="${x.radius}" fill="${esc(x.fill)}" stroke="${esc(x.stroke)}" stroke-width="${x.strokeWidth ?? 1.5}"/>${text(x)}`);
  const marks = [...new Set(s.arrows.filter((a) => a.head).map((a) => a.color))];
  for (const a of s.arrows) {
    const d = a.curve ? smooth(a.points) : 'M' + a.points.map((p) => `${p[0]} ${p[1]}`).join(' L');
    parts.push(`<path d="${d}" fill="none" stroke="${esc(a.color)}" stroke-width="${a.width ?? 1.6}" stroke-linecap="round"${a.head ? ` marker-end="url(#h${marks.indexOf(a.color)})"` : ''}/>`);
  }
  for (const x of s.boxes.filter((q) => !q.frame)) parts.push(`<rect x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="${x.radius}" fill="${esc(x.fill)}" stroke="${esc(x.stroke)}" stroke-width="${x.strokeWidth ?? 1}"/>${text(x)}`);
  for (const a of s.arrows.filter((q) => q.label)) {
    const m = a.points[Math.floor(a.points.length / 2)];
    const w = measure(a.label!, 11.5, 400) + 14;
    parts.push(`<rect x="${m[0] - w / 2}" y="${m[1] - 9}" width="${w}" height="18" rx="9" fill="${esc(s.background)}" stroke="${esc(a.color)}" stroke-width="0.8"/><text x="${m[0]}" y="${m[1] + 4}" font-size="11.5" text-anchor="middle" fill="${esc(a.color)}">${esc(a.label!)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" font-family="${esc(s.font)}"><defs>${marks.map((c, i) => `<marker id="h${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${esc(c)}"/></marker>`).join('')}</defs>${parts.join('')}</svg>`;
}

// JSON Canvas 1.0 (jsoncanvas.org), the format of Obsidian's canvas: what a `.canvas` file holds — nodes (text, file,
// link, group) and edges between them. Read leniently, written with two spaces of indent so a diff in git reads well;
// the fields this plugin does not know (from Obsidian and other programs) are kept as they were.

export type Side = 'top' | 'right' | 'bottom' | 'left';
interface Base {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "1"–"6" or #rrggbb. */
  color?: string;
  /** Anything else the file had on the node. */
  [k: string]: unknown;
}
export interface TextNode extends Base {
  type: 'text';
  text: string;
}
export interface FileNode extends Base {
  type: 'file';
  file: string;
  /** «#Heading» of a markdown file; here — the title of an Org heading. */
  subpath?: string;
  /** The heading's :ID: (an extra field of this plugin). */
  orgId?: string;
}
export interface LinkNode extends Base {
  type: 'link';
  url: string;
}
export interface GroupNode extends Base {
  type: 'group';
  label?: string;
}
export type CNode = TextNode | FileNode | LinkNode | GroupNode;
export interface CEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
  [k: string]: unknown;
}
export interface Canvas {
  nodes: CNode[];
  edges: CEdge[];
  /** Other top-level fields. */
  [k: string]: unknown;
}

export const EMPTY = '{\n  "nodes": [],\n  "edges": []\n}\n';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The canvas of a file's text; an empty or broken text — null (the view says so, nothing is written over it). */
export function parseCanvas(text: string): Canvas | null {
  if (!text.trim()) return { nodes: [], edges: [] };
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const nodes: CNode[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(o.nodes) ? o.nodes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const id = str(n.id);
    if (!id || seen.has(id)) continue;
    const type = n.type;
    if (type !== 'text' && type !== 'file' && type !== 'link' && type !== 'group') continue;
    seen.add(id);
    const base = { ...n, id, x: num(n.x, 0), y: num(n.y, 0), width: Math.max(1, num(n.width, 250)), height: Math.max(1, num(n.height, 60)) };
    if (type === 'text') nodes.push({ ...base, type, text: str(n.text) ?? '' });
    else if (type === 'file') nodes.push({ ...base, type, file: str(n.file) ?? '' });
    else if (type === 'link') nodes.push({ ...base, type, url: str(n.url) ?? '' });
    else nodes.push({ ...base, type });
  }
  const edges: CEdge[] = [];
  for (const raw of Array.isArray(o.edges) ? o.edges : []) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = str(e.id);
    const from = str(e.fromNode);
    const to = str(e.toNode);
    if (!id || !from || !to || !seen.has(from) || !seen.has(to)) continue;
    const edge: CEdge = { ...e, id, fromNode: from, toNode: to };
    if (e.fromSide !== undefined && !SIDES.includes(e.fromSide as Side)) delete edge.fromSide;
    if (e.toSide !== undefined && !SIDES.includes(e.toSide as Side)) delete edge.toSide;
    edges.push(edge);
  }
  return { ...o, nodes, edges };
}

/** The text of a canvas: two spaces of indent, a new line at the end. */
export function writeCanvas(c: Canvas): string {
  return JSON.stringify(c, null, 2) + '\n';
}

/** A new id, as Obsidian makes them: 16 hex digits. */
export function newId(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** The groups a node lies in (its box inside theirs), the smallest first. */
export function groupsOf(c: Canvas, n: CNode): GroupNode[] {
  return c.nodes
    .filter((g): g is GroupNode => g.type === 'group' && g.id !== n.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height)
    .sort((a, b) => a.width * a.height - b.width * b.height);
}
/** The nodes inside a group's box (at any depth): they move with it. */
export function insideOf(c: Canvas, g: CNode): CNode[] {
  if (g.type !== 'group') return [];
  return c.nodes.filter((n) => n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height);
}
/** The box around nodes, `pad` around. */
export function boxOf(nodes: { x: number; y: number; width: number; height: number }[], pad = 0) {
  const x0 = Math.min(...nodes.map((n) => n.x)) - pad;
  const y0 = Math.min(...nodes.map((n) => n.y)) - pad;
  const x1 = Math.max(...nodes.map((n) => n.x + n.width)) + pad;
  const y1 = Math.max(...nodes.map((n) => n.y + n.height)) + pad;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
/** A point of a node's side, where an edge starts or ends. */
export function sidePoint(n: { x: number; y: number; width: number; height: number }, s: Side): [number, number] {
  if (s === 'top') return [n.x + n.width / 2, n.y];
  if (s === 'bottom') return [n.x + n.width / 2, n.y + n.height];
  if (s === 'left') return [n.x, n.y + n.height / 2];
  return [n.x + n.width, n.y + n.height / 2];
}
/** The sides two nodes face each other with (an edge without sides in the file). */
export function facing(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) * (a.height + b.height) >= Math.abs(dy) * (a.width + b.width)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}
/** An edge's curve from side to side (an SVG path), and its middle (for the label). */
export function edgePath(a: CNode, b: CNode, e: CEdge): { d: string; mid: [number, number]; end: [number, number]; dir: [number, number]; points: [number, number][] } {
  const [fs, ts] = e.fromSide && e.toSide ? [e.fromSide, e.toSide] : facing(a, b);
  const p = sidePoint(a, fs);
  const q = sidePoint(b, ts);
  const out = (s: Side): [number, number] => (s === 'top' ? [0, -1] : s === 'bottom' ? [0, 1] : s === 'left' ? [-1, 0] : [1, 0]);
  const k = Math.max(40, Math.min(160, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
  const o1 = out(fs);
  const o2 = out(ts);
  const c1: [number, number] = [p[0] + o1[0] * k, p[1] + o1[1] * k];
  const c2: [number, number] = [q[0] + o2[0] * k, q[1] + o2[1] * k];
  const mid: [number, number] = [(p[0] + 3 * c1[0] + 3 * c2[0] + q[0]) / 8, (p[1] + 3 * c1[1] + 3 * c2[1] + q[1]) / 8];
  return { d: `M${p[0]} ${p[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${q[0]} ${q[1]}`, mid, end: q, dir: [-o2[0], -o2[1]], points: [p, c1, c2, q] };
}

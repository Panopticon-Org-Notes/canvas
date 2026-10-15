// The edits of a free canvas (ТЗ 39 §2): each makes a new canvas from the one before — the view writes it as one step
// of ⌘Z. Nodes inside a group's box move with it, as in Obsidian; deleting a node deletes its edges.

import { boxOf, insideOf, newId, type Canvas, type CEdge, type CNode, type GroupNode, type Side } from './jsoncanvas';

export const GRID = 22;
export const snap = (v: number, on = true) => (on ? Math.round(v / GRID) * GRID : Math.round(v));

/** The nodes that move when these do: each one, and what lies in a group among them. */
export function carried(c: Canvas, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const add = (n: CNode) => {
    if (out.has(n.id)) return;
    out.add(n.id);
    if (n.type === 'group') insideOf(c, n).forEach(add);
  };
  for (const id of ids) {
    const n = c.nodes.find((x) => x.id === id);
    if (n) add(n);
  }
  return out;
}
export function moveNodes(c: Canvas, ids: Iterable<string>, dx: number, dy: number): Canvas {
  const set = carried(c, ids);
  return { ...c, nodes: c.nodes.map((n) => (set.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
}
export function resizeNode(c: Canvas, id: string, width: number, height: number): Canvas {
  return { ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, width: Math.max(60, Math.round(width)), height: Math.max(40, Math.round(height)) } : n)) };
}
export function patchNode(c: Canvas, id: string, patch: Partial<CNode>): Canvas {
  return { ...c, nodes: c.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as CNode) : n)) };
}
export function patchEdge(c: Canvas, id: string, patch: Partial<CEdge>): Canvas {
  return { ...c, edges: c.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}
/** Nodes (with their edges) and edges away. */
export function remove(c: Canvas, nodes: Iterable<string>, edges: Iterable<string> = []): Canvas {
  const n = new Set(nodes);
  const e = new Set(edges);
  return { ...c, nodes: c.nodes.filter((x) => !n.has(x.id)), edges: c.edges.filter((x) => !e.has(x.id) && !n.has(x.fromNode) && !n.has(x.toNode)) };
}
/** Copies of the nodes 30 to the right and down, with the edges between them; the copies' ids. */
export function duplicate(c: Canvas, ids: Iterable<string>, d = GRID): { canvas: Canvas; ids: string[] } {
  const set = new Set(ids);
  const map = new Map<string, string>();
  const copies: CNode[] = [];
  for (const n of c.nodes)
    if (set.has(n.id)) {
      const id = newId();
      map.set(n.id, id);
      copies.push({ ...n, id, x: n.x + d, y: n.y + d });
    }
  const edges: CEdge[] = c.edges.filter((e) => map.has(e.fromNode) && map.has(e.toNode)).map((e) => ({ ...e, id: newId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }));
  return { canvas: { ...c, nodes: [...c.nodes, ...copies], edges: [...c.edges, ...edges] }, ids: copies.map((n) => n.id) };
}
/** A group around the nodes, 24 around their box; put first (under everything). */
export function group(c: Canvas, ids: Iterable<string>, label = ''): { canvas: Canvas; id: string } | null {
  const set = new Set(ids);
  const nodes = c.nodes.filter((n) => set.has(n.id));
  if (!nodes.length) return null;
  const b = boxOf(nodes, 24);
  const g: GroupNode = { id: newId(), type: 'group', x: b.x, y: b.y - 20, width: b.width, height: b.height + 20, ...(label ? { label } : {}) };
  return { canvas: { ...c, nodes: [g, ...c.nodes] }, id: g.id };
}
/** A node added: a group goes under the others, the rest on top. */
export function addNode(c: Canvas, n: CNode): Canvas {
  return { ...c, nodes: n.type === 'group' ? [n, ...c.nodes] : [...c.nodes, n] };
}
export function addEdge(c: Canvas, from: string, fromSide: Side, to: string, toSide: Side): { canvas: Canvas; id: string } | null {
  if (from === to || c.edges.some((e) => e.fromNode === from && e.toNode === to)) return null;
  const e: CEdge = { id: newId(), fromNode: from, fromSide, toNode: to, toSide, toEnd: 'arrow' };
  return { canvas: { ...c, edges: [...c.edges, e] }, id: e.id };
}
/** A colour on nodes and edges (null: none). */
export function setColor(c: Canvas, nodes: Iterable<string>, edges: Iterable<string>, color: string | null): Canvas {
  const n = new Set(nodes);
  const e = new Set(edges);
  const paint = <T extends { color?: string }>(x: T): T => {
    const { color: _, ...rest } = x;
    return (color ? { ...rest, color } : rest) as T;
  };
  return { ...c, nodes: c.nodes.map((x) => (n.has(x.id) ? paint(x) : x)), edges: c.edges.map((x) => (e.has(x.id) ? paint(x) : x)) };
}
/** The side of a node nearest a point: where an edge dropped on it comes in. */
export function nearestSide(n: { x: number; y: number; width: number; height: number }, px: number, py: number): Side {
  const d = { top: Math.abs(py - n.y), bottom: Math.abs(py - (n.y + n.height)), left: Math.abs(px - n.x), right: Math.abs(px - (n.x + n.width)) };
  return (Object.keys(d) as Side[]).sort((a, b) => d[a] - d[b])[0];
}
/** The nodes whose box meets a rectangle (a frame drawn on the empty place). */
export function within(c: Canvas, r: { x: number; y: number; width: number; height: number }): string[] {
  return c.nodes.filter((n) => n.x < r.x + r.width && r.x < n.x + n.width && n.y < r.y + r.height && r.y < n.y + n.height).map((n) => n.id);
}

/** A heading to lay out (ТЗ 39 §3): its place, its :ID:, its colour. */
export interface Spread {
  path: string;
  title: string;
  level: number;
  id: string | null;
  color: string | null;
}
export const CARD = { w: 280, h: 120, dx: 80, dy: 28 };
/**
 * A heading and the ones under it (`levels` below it) as live cards, a tree from left to right: each level a column,
 * a parent in the middle of its children; arrows from a parent to its children. `heads[0]` is the heading; the rest
 * follow it in the file's order. `at` — the top-left corner.
 */
export function spread(heads: Spread[], levels: number, at: { x: number; y: number }): { nodes: CNode[]; edges: CEdge[] } {
  if (!heads.length) return { nodes: [], edges: [] };
  const top = heads[0].level;
  type T = { h: Spread; kids: T[]; id: string; y: number };
  const root: T = { h: heads[0], kids: [], id: newId(), y: 0 };
  const stack: T[] = [root];
  for (const h of heads.slice(1)) {
    if (h.level <= top) break;
    if (h.level - top > levels) continue;
    while (stack.length > 1 && stack[stack.length - 1].h.level >= h.level) stack.pop();
    const t: T = { h, kids: [], id: newId(), y: 0 };
    stack[stack.length - 1].kids.push(t);
    stack.push(t);
  }
  let row = 0;
  const place = (t: T) => {
    if (!t.kids.length) t.y = row++ * (CARD.h + CARD.dy);
    else {
      t.kids.forEach(place);
      t.y = (t.kids[0].y + t.kids[t.kids.length - 1].y) / 2;
    }
  };
  place(root);
  const nodes: CNode[] = [];
  const edges: CEdge[] = [];
  const walk = (t: T, depth: number) => {
    const c = t.h.color ? (({ red: '1', orange: '2', yellow: '3', green: '4', cyan: '5', purple: '6' }) as Record<string, string>)[t.h.color] ?? t.h.color : null;
    nodes.push({
      id: t.id, type: 'file', file: t.h.path, subpath: '#' + t.h.title, ...(t.h.id ? { orgId: t.h.id } : {}),
      x: snap(at.x + depth * (CARD.w + CARD.dx)), y: snap(at.y + t.y), width: CARD.w, height: CARD.h, ...(c ? { color: c } : {}),
    });
    for (const k of t.kids) {
      edges.push({ id: newId(), fromNode: t.id, fromSide: 'right', toNode: k.id, toSide: 'left', toEnd: 'arrow' });
      walk(k, depth + 1);
    }
  };
  walk(root, 0);
  return { nodes, edges };
}

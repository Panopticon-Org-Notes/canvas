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

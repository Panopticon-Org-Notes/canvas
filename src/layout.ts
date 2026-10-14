// Where the mindmap's nodes go (ТЗ 39 §1): the root in the middle (0, 0 is its centre), the branches in a column on
// each side, each heading's children in a column beside it, centred on it; nothing overlaps. Nothing of it is kept:
// it is made again from the tree and the nodes' sizes. And the moves of the arrows from node to node.

import type { MNode, Side } from './tree';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Placed {
  node: MNode;
  box: Box;
}
export interface Edge {
  from: Placed;
  to: Placed;
  side: Side;
}
export interface Layout {
  placed: Map<string, Placed>;
  /** The root first, in the tree's order. */
  order: Placed[];
  edges: Edge[];
  bounds: Box;
}

/** From the root to a branch, from a node to its children, between two children, between two branches. */
export const GAP = { root: 90, level: 60, kid: 16, branch: 32 };

/**
 * The layout of the nodes shown: `kidsOf` — the children shown (none for a folded node), `size` — a node's box as
 * drawn.
 */
export function layout(root: MNode, kidsOf: (n: MNode) => MNode[], size: (n: MNode) => { w: number; h: number }): Layout {
  const placed = new Map<string, Placed>();
  const order: Placed[] = [];
  const edges: Edge[] = [];
  const heights = new Map<MNode, number>();
  const height = (n: MNode): number => {
    const known = heights.get(n);
    if (known !== undefined) return known;
    const kids = kidsOf(n);
    const own = size(n).h;
    const block = kids.reduce((s, k) => s + height(k), 0) + GAP.kid * Math.max(0, kids.length - 1);
    const h = Math.max(own, block);
    heights.set(n, h);
    return h;
  };
  const put = (n: MNode, box: Box) => {
    const p = { node: n, box };
    placed.set(n.key, p);
    order.push(p);
    return p;
  };
  // a node in a band from `top` of its subtree's height; `edge` — x of its side towards the root
  const place = (n: MNode, edge: number, top: number, side: Side, from: Placed) => {
    const s = size(n);
    const band = height(n);
    const x = side === 'right' ? edge : edge - s.w;
    const p = put(n, { x, y: top + (band - s.h) / 2, w: s.w, h: s.h });
    edges.push({ from, to: p, side });
    const kids = kidsOf(n);
    const block = kids.reduce((sum, k) => sum + height(k), 0) + GAP.kid * Math.max(0, kids.length - 1);
    let y = top + (band - block) / 2;
    const next = side === 'right' ? x + s.w + GAP.level : x - GAP.level;
    for (const k of kids) {
      place(k, next, y, side, p);
      y += height(k) + GAP.kid;
    }
  };
  const rs = size(root);
  const r = put(root, { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h });
  const branches = kidsOf(root);
  for (const side of ['right', 'left'] as const) {
    const col = branches.filter((b) => (b.side ?? 'right') === side);
    const total = col.reduce((s, b) => s + height(b), 0) + GAP.branch * Math.max(0, col.length - 1);
    let y = -total / 2;
    const edge = side === 'right' ? rs.w / 2 + GAP.root : -rs.w / 2 - GAP.root;
    for (const b of col) {
      place(b, edge, y, side, r);
      y += height(b) + GAP.branch;
    }
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of order) {
    x0 = Math.min(x0, p.box.x);
    y0 = Math.min(y0, p.box.y);
    x1 = Math.max(x1, p.box.x + p.box.w);
    y1 = Math.max(y1, p.box.y + p.box.h);
  }
  return { placed, order, edges, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** A smooth curve from the parent's side to the child's facing side (an SVG path). */
export function curve(e: Edge): string {
  const f = e.from.box;
  const t = e.to.box;
  const x1 = e.side === 'right' ? f.x + f.w : f.x;
  const x2 = e.side === 'right' ? t.x : t.x + t.w;
  const y1 = f.y + f.h / 2;
  const y2 = t.y + t.h / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

export type Dir = 'left' | 'right' | 'up' | 'down';
/**
 * The node an arrow key goes to from `key`: ← → to the parent or to the child nearest in height, by the side the
 * node is on (from the root: the branch of that side nearest its middle); ↑ ↓ to the sibling shown on that side.
 */
export function step(lay: Layout, kidsOf: (n: MNode) => MNode[], key: string, dir: Dir): string | null {
  const p = lay.placed.get(key);
  if (!p) return null;
  const n = p.node;
  const cy = (q: Placed) => q.box.y + q.box.h / 2;
  const nearest = (list: MNode[]) => {
    let best: Placed | null = null;
    for (const k of list) {
      const q = lay.placed.get(k.key);
      if (q && (!best || Math.abs(cy(q) - cy(p)) < Math.abs(cy(best) - cy(p)))) best = q;
    }
    return best?.node.key ?? null;
  };
  if (dir === 'left' || dir === 'right') {
    if (!n.parent) return nearest(kidsOf(n).filter((k) => (k.side ?? 'right') === dir));
    const out = (n.side ?? 'right') === dir;
    return out ? nearest(kidsOf(n)) : n.parent.key;
  }
  if (!n.parent) return null;
  const sibs = kidsOf(n.parent).filter((k) => k.side === n.side);
  const i = sibs.indexOf(n);
  const j = dir === 'up' ? i - 1 : i + 1;
  return sibs[j]?.key ?? null;
}

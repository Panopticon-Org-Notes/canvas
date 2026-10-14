// The mindmap's tree (ТЗ 39 §1): the headings of a file — or of one heading's branch — as nodes. The root is the
// file's #+TITLE (else its name) or the branch's heading; its children are the branches, shared between the right
// and the left side by how many headings each holds. A branch's colour (:COLOR:) goes down to the headings under it
// until one has its own. Pure: the outline and the text are given.

import { colorOf } from './colors';

/** A heading as the outline gives it (`index.outline`). */
export interface Head {
  line: number;
  level: number;
  title: string;
  keyword: string | null;
  done: boolean;
  properties: Record<string, string>;
}
export type Side = 'right' | 'left';
export interface MNode {
  /** Stable while lines move: the titles from the root, a number for the same title twice under one parent. */
  key: string;
  /** The heading's line (0-based); -1 — the file's root. */
  line: number;
  title: string;
  keyword: string | null;
  done: boolean;
  /** Set on the heading itself (not inherited). */
  tags: string[];
  /** Its own :COLOR: as written; `color` — what it is drawn with (its own or a parent's). */
  own: string | null;
  color: string | null;
  depth: number;
  side: Side | null;
  kids: MNode[];
  parent: MNode | null;
  /** How many headings are under it, at every depth. */
  size: number;
}

const TAGS = /\s+:((?:[^\s:]+:)+)\s*$/;
/** The tags at the end of a heading's line. */
export function lineTags(line: string): string[] {
  const m = TAGS.exec(line);
  return m ? m[1].split(':').filter(Boolean) : [];
}
/** «#+TITLE: …» of the file's header, if it has one. */
export function fileTitle(text: string): string | null {
  for (const l of text.split('\n')) {
    if (/^\*+\s/.test(l)) break;
    const m = /^#\+TITLE:\s*(.*?)\s*$/i.exec(l);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * The heading a branch's view shows, by its title near the line it was at, else the heading at that line; -1 none.
 */
export function findScope(heads: Head[], at: { line: number; title: string }): number {
  let best = -1;
  heads.forEach((h, i) => {
    if (h.title === at.title && (best < 0 || Math.abs(h.line - at.line) < Math.abs(heads[best].line - at.line))) best = i;
  });
  return best >= 0 ? best : heads.findIndex((h) => h.line === at.line);
}

/**
 * The tree of a file (`scope` null: its root is `rootTitle`) or of one branch (`scope`: the heading's index in
 * `heads`, its root). `lines` — the file's text split in lines, for the tags set on each heading.
 */
export function buildTree(heads: Head[], lines: string[], rootTitle: string, scope: number | null = null): MNode {
  const mk = (h: Head | null, parent: MNode | null, depth: number): MNode => {
    const own = h?.properties.COLOR ?? null;
    return {
      key: '',
      line: h ? h.line : -1,
      title: h ? h.title : rootTitle,
      keyword: h?.keyword ?? null,
      done: h?.done ?? false,
      tags: h ? lineTags(lines[h.line] ?? '') : [],
      own,
      color: colorOf(own) ?? parent?.color ?? null,
      depth,
      side: null,
      kids: [],
      parent,
      size: 0,
    };
  };
  const root = mk(scope === null ? null : heads[scope], null, 0);
  root.key = 'root';
  const from = scope === null ? 0 : scope + 1;
  const base = scope === null ? 0 : heads[scope].level;
  // the parents open now, by their level
  const stack: { level: number; node: MNode }[] = [{ level: base, node: root }];
  for (let i = from; i < heads.length; i++) {
    const h = heads[i];
    if (scope !== null && h.level <= base) break;
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack[stack.length - 1].node;
    const n = mk(h, parent, parent.depth + 1);
    const same = parent.kids.filter((k) => k.title === h.title).length;
    n.key = `${parent.key}/${h.title}${same ? '#' + same : ''}`;
    parent.kids.push(n);
    stack.push({ level: h.level, node: n });
  }
  const count = (n: MNode): number => (n.size = n.kids.reduce((s, k) => s + 1 + count(k), 0));
  count(root);
  assignSides(root);
  return root;
}

/** The branches to the right first, in the file's order, until they hold half of the headings; the rest to the left. */
function assignSides(root: MNode) {
  const total = root.kids.reduce((s, k) => s + 1 + k.size, 0);
  let right = 0;
  for (const k of root.kids) {
    const side: Side = right === 0 || right < total / 2 ? 'right' : 'left';
    if (side === 'right') right += 1 + k.size;
    const mark = (n: MNode) => {
      n.side = side;
      n.kids.forEach(mark);
    };
    mark(k);
  }
}

/** Every node of the tree, the root first, in the file's order. */
export function nodesOf(root: MNode): MNode[] {
  const out: MNode[] = [];
  const walk = (n: MNode) => {
    out.push(n);
    n.kids.forEach(walk);
  };
  walk(root);
  return out;
}

/** Is `n` the node `of` or under it. */
export function within(n: MNode | null, of: MNode): boolean {
  for (let x = n; x; x = x.parent) if (x === of) return true;
  return false;
}

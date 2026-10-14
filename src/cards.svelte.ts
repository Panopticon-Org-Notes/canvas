// What a card on the canvas shows of a heading or a file (ТЗ 39 §2): read through the API and read again when the file
// changes — the card is live. A heading is found by its :ID: (`orgId`), else by its title (`subpath`) in the file.

import { SvelteMap } from 'svelte/reactivity';
import type { HeadingInfo, HeadingRef, OrgDate } from '@panopticon/api';
import { canvas } from './state.svelte';
import type { FileNode } from './jsoncanvas';

export interface HeadCard {
  found: true;
  ref: HeadingRef;
  keyword: string | null;
  title: string;
  /** «platform.org › Переезд в новый ДЦ»: the file and the parents. */
  where: string;
  /** The first lines of its text, without the checklist and the drawers. */
  lines: string[];
  /** «☑ 2/5»: its checklist. */
  check: string | null;
  /** «запланировано 12 окт», «до 30 окт». */
  date: string | null;
  tags: string[];
  color: string | null;
}
export interface FileCard {
  found: true;
  file: true;
  title: string;
  lines: string[];
}
export type Card = HeadCard | FileCard | { found: false };

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const day = (d: OrgDate) => `${d.d} ${MONTHS[d.m - 1]}${d.time ? ', ' + d.time : ''}`;
const isOrg = (p: string) => /\.org$/i.test(p);

/** The title a subpath names: «#Переезд в новый ДЦ» → «Переезд в новый ДЦ». */
export const subTitle = (sub: string | undefined) => (sub ?? '').replace(/^#/, '').trim();
/** A title compared without its timestamps, cookies and extra spaces (a meeting's «<2026-10-15 Чт 11:00>»). */
export const plainTitle = (t: string) => t.replace(/<[^>]*>|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

class Cards {
  /** The card of each node (by its key: file, subpath, orgId). */
  cards = new SvelteMap<string, Card>();
  private files = new Map<string, Set<string>>();
  keyOf(n: FileNode) {
    return `${n.file}\u0000${n.subpath ?? ''}\u0000${n.orgId ?? ''}`;
  }
  /** The card of a node, read the first time it is asked. */
  get(n: FileNode): Card | undefined {
    const k = this.keyOf(n);
    if (!this.cards.has(k) && !this.asked.has(k)) {
      // asked while drawing: the state changes after it
      this.asked.add(k);
      queueMicrotask(() => void this.read(n));
    }
    return this.cards.get(k);
  }
  private asked = new Set<string>();
  /** A file changed: its cards (and the cards found by ID, which may have moved to it) read again. */
  changed(path: string) {
    for (const [k, nodes] of this.files) if (k === path || k === '\u0000id') for (const key of nodes) this.reread(key);
  }
  private reread(key: string) {
    const [file, subpath, orgId] = key.split('\u0000');
    void this.read({ file, subpath: subpath || undefined, orgId: orgId || undefined } as FileNode);
  }
  private note(path: string, key: string) {
    const set = this.files.get(path) ?? new Set();
    set.add(key);
    this.files.set(path, set);
  }
  async read(n: FileNode) {
    const key = this.keyOf(n);
    this.note(n.file, key);
    if (n.orgId) this.note('\u0000id', key);
    const ctx = canvas.ctx;
    try {
      if (!n.subpath && !n.orgId) {
        // a file: its title and first lines
        const text = await ctx.files!.read(n.file);
        const lines = text.split('\n').filter((l) => l.trim() && !/^#\+/.test(l)).slice(0, 3).map((l) => l.replace(/^\*+\s+/, ''));
        const title = /^#\+TITLE:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
        this.cards.set(key, { found: true, file: true, title: title || n.file.split('/').pop()!.replace(/\.(org|md)$/i, ''), lines });
        return;
      }
      let ref: HeadingRef | null = n.orgId ? await ctx.index!.byId(n.orgId) : null;
      if (!ref && isOrg(n.file)) {
        const want = subTitle(n.subpath);
        const outline = await ctx.index!.outline(n.file);
        const h = outline.find((x) => x.title === want) ?? outline.find((x) => plainTitle(x.title) === plainTitle(want));
        ref = h?.ref ?? null;
      }
      if (!ref) return void this.cards.set(key, { found: false });
      if (ref.path !== n.file) this.note(ref.path, key);
      const [outline, body] = await Promise.all([ctx.index!.outline(ref.path), ctx.index!.body(ref)]);
      const i = outline.findIndex((x) => x.ref.line === ref!.line);
      const h = outline[i];
      if (!h) return void this.cards.set(key, { found: false });
      this.cards.set(key, this.headCard(h, outline.slice(0, i), body ?? ''));
    } catch {
      this.cards.set(key, { found: false });
    }
  }
  private headCard(h: HeadingInfo, before: HeadingInfo[], body: string): HeadCard {
    // the parents: the nearest heading above of each lower level
    const parents: string[] = [];
    let lvl = h.level;
    for (let j = before.length - 1; j >= 0 && lvl > 1; j--)
      if (before[j].level < lvl) {
        parents.unshift(before[j].title);
        lvl = before[j].level;
      }
    const all = body.split('\n');
    const boxes = all.filter((l) => /^\s*[-+]\s+\[[ Xx-]\]/.test(l));
    const done = boxes.filter((l) => /\[[Xx]\]/.test(l)).length;
    const lines = all.filter((l) => l.trim() && !/^\s*[-+]\s+\[[ Xx-]\]/.test(l) && !/^\s*:[A-Z_]+:/.test(l) && !/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(l)).slice(0, 2).map((l) => l.trim());
    const date = h.scheduled ? `запланировано ${day(h.scheduled)}` : h.deadline ? `до ${day(h.deadline)}` : h.event ? day(h.event) : null;
    return {
      found: true,
      ref: h.ref,
      keyword: h.keyword,
      title: h.title,
      where: [h.ref.path, ...parents].join(' › '),
      lines,
      check: boxes.length ? `☑ ${done}/${boxes.length}` : null,
      date,
      tags: h.tags,
      color: h.properties.COLOR ?? null,
    };
  }
}
export const cards = new Cards();

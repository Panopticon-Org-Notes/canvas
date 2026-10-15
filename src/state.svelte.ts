// What «Холст» keeps while it runs: the ctx, its settings, the branches folded by hand (this Mac), the tab shown, and
// the files the maps show read again when they change. Through the public API only.

import { SvelteMap } from 'svelte/reactivity';
import type { Ctx, HeadingRef, Named, Tx } from '@panopticon/api';
import type { Head } from './tree';

export const VIEW = 'canvas.mindmap';
export const BOARD = 'canvas.board';

/** The folded branches by hand: per map (a file, or a file's branch), node key → folded. */
type Folds = Record<string, Record<string, boolean>>;

class Canvas {
  ctx!: Ctx;
  /** «Mindmap: раскрыто уровней»: 0 — all. */
  levels = $state(3);
  /** The canvas: «Новая заметка — цвет» ('' none), «Привязка к сетке». */
  noteColor = $state('3');
  snapGrid = $state(true);
  /** «Разложить на холсте: уровней». */
  spreadLevels = $state(2);
  /** The canvas shown now: what its commands (⌘G, ⌘D) act on. */
  board: { path: string; group(): void; duplicate(): void } | null = null;
  /** What «Экспорт» of the palette exports: the map or the canvas shown last. */
  exporter: (() => import('./exporting').Exportable) | null = null;
  folds = $state<Folds>({});
  /** The tab shown: its file and its view. */
  active = $state<{ path: string | null; view: string | null }>({ path: null, view: null });
  private watchers = new Map<string, Set<() => void>>();

  init(ctx: Ctx) {
    this.ctx = ctx;
    this.readSettings();
    ctx.settings.onChange(() => this.readSettings());
    ctx.storage.local.onChange(() => (this.folds = ctx.storage.local.get<Folds>() ?? {}));
    this.folds = ctx.storage.local.get<Folds>() ?? {};
    ctx.events.on('file.changed', (p) => this.watchers.get((p as { path: string }).path)?.forEach((fn) => fn()));
    ctx.events.on('tab.active', (p) => {
      const a = p as { path: string | null; view: string | null };
      this.active = { path: a.path, view: a.view };
    });
  }
  readSettings() {
    const all = this.ctx.settings.values();
    const v = Number(all.mmLevels);
    this.levels = [0, 2, 3, 4].includes(v) ? v : 3;
    this.noteColor = typeof all.noteColor === 'string' && /^([1-6]|)$/.test(all.noteColor) ? all.noteColor : '3';
    this.snapGrid = all.snapGrid !== false;
    this.spreadLevels = [1, 2, 3].includes(Number(all.spreadLevels)) ? Number(all.spreadLevels) : 2;
  }

  /** `fn` on each change of the file (an edit here, in the text, on disk). */
  watch(path: string, fn: () => void) {
    const set = this.watchers.get(path) ?? new Set();
    set.add(fn);
    this.watchers.set(path, set);
    return () => void set.delete(fn);
  }
  async read(path: string): Promise<{ heads: Head[]; text: string } | null> {
    try {
      const [outline, text] = await Promise.all([this.ctx.index!.outline(path), this.ctx.files!.read(path)]);
      return {
        text,
        heads: outline.map((h) => ({ line: h.ref.line, level: h.level, title: h.title, keyword: h.keyword, done: h.done, properties: h.properties ?? {} })),
      };
    } catch {
      return null;
    }
  }

  // ---- folding ----
  folded(map: string, key: string): boolean | undefined {
    return this.folds[map]?.[key];
  }
  setFolded(map: string, key: string, on: boolean) {
    this.folds = { ...this.folds, [map]: { ...(this.folds[map] ?? {}), [key]: on } };
    void this.ctx.storage.local.set(this.folds);
  }

  // ---- the colour of a status, as the core's chips draw it ----
  private tones = new SvelteMap<string, Named | null>();
  private asked = new Set<string>();
  tone(kw: string, path: string): string {
    const k = path + '\u0000' + kw;
    if (!this.tones.has(k) && !this.asked.has(k)) {
      // asked while drawing: the state changes after it
      this.asked.add(k);
      void this.ctx.index!.statusTone(kw, path).then((t) => this.tones.set(k, t));
    }
    const t = this.tones.get(k);
    return t ? `var(--p-${t})` : 'var(--fg2)';
  }

  /** One step of ⌘Z; a conflict (the file changed meanwhile) is said. */
  async tx(label: string, build: (tx: Tx) => void, o?: { onUndo?(): void }): Promise<boolean> {
    const r = await this.ctx.edit!.transaction(label, build, o);
    if (r !== 'ok') this.ctx.ui.notify(r === 'conflict' ? 'Заголовок не найден: файл изменился. Попробуйте ещё раз' : 'Не удалось изменить файл');
    return r === 'ok';
  }
  ref(path: string, n: { line: number; title: string }): HeadingRef {
    return { path, line: n.line, title: n.title };
  }
}

export const canvas = new Canvas();

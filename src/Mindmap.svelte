<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { HeadingRef, MenuItem } from '@panopticon/api';
  import { canvas, VIEW } from './state.svelte';
  import { buildTree, fileTitle, findScope, nodesOf, within, type Head, type MNode } from './tree';
  import { curve, layout, step, type Dir, type Edge, type Placed } from './layout';
  import { colorValue, PALETTE } from './colors';
  import { titleHtml } from './title';

  // The mindmap of an Org file, or of one heading's branch (ТЗ 39 §1): the tree of headings drawn from the middle,
  // edited in place — each change one transaction of the core (⌘Z). Nothing is kept but the branches folded by hand.
  let { path, heading, view }: { path: string; heading?: HeadingRef; view: { showText(): void; setHeading(h: HeadingRef): void } } = $props();

  const ctx = canvas.ctx;
  const name = $derived((path.split('/').pop() ?? path).replace(/\.org$/, ''));

  // ---- the file ----
  let heads = $state<Head[]>([]);
  let text = $state('');
  let loaded = $state(false);
  /** The branch shown (a view on one heading): where its heading is now. */
  let scope = $state<{ line: number; title: string } | null>(untrack(() => (heading ? { line: heading.line, title: heading.title } : null)));
  /** After an edit: the node to choose once the file is read again (its line, else its title near it). */
  let pending: { line: number; title?: string } | null = null;

  async function load() {
    const r = await canvas.read(path);
    if (!r) return;
    heads = r.heads;
    text = r.text;
    loaded = true;
    if (scope) {
      const i = findScope(heads, scope);
      const h = heads[i];
      if (h && (h.line !== scope.line || h.title !== scope.title)) {
        scope = { line: h.line, title: h.title };
        view.setHeading({ path, line: h.line, title: h.title });
      }
    }
    await tick();
    if (pending && tree) {
      const p = pending;
      pending = null;
      const all = nodesOf(tree);
      const hit = all.find((n) => n.line === p.line && (!p.title || n.title === p.title)) ?? (p.title ? all.filter((n) => n.title === p.title).sort((a, b) => Math.abs(a.line - p.line) - Math.abs(b.line - p.line))[0] : undefined);
      if (hit) choose(hit.key);
    } else if (sel && !node(sel)) sel = null;
  }
  onMount(() => {
    void load();
    return canvas.watch(path, () => void load());
  });

  const lines = $derived(text.split('\n'));
  const scopeAt = $derived(scope ? findScope(heads, scope) : null);
  const tree = $derived(loaded && scopeAt !== -1 ? buildTree(heads, lines, fileTitle(text) ?? name, scopeAt) : null);
  const all = $derived(tree ? nodesOf(tree) : []);
  const node = (key: string | null) => (key ? (all.find((n) => n.key === key) ?? (draftNode?.key === key ? draftNode : undefined)) : undefined);

  // ---- folding: three levels open by default (a setting), the rest by hand, kept on this Mac ----
  const mapKey = $derived(scope ? `${path}\u0000${scope.title}` : path);
  function isFolded(n: MNode) {
    if (!n.parent || !n.kids.length) return false;
    return canvas.folded(mapKey, n.key) ?? (canvas.levels > 0 && n.depth >= canvas.levels);
  }
  function toggle(n: MNode) {
    if (!n.parent || !n.kids.length) return;
    canvas.setFolded(mapKey, n.key, !isFolded(n));
  }

  // ---- a new heading being typed: a node of its own until ↩ makes it ----
  type Edit = { kind: 'rename'; key: string; text: string } | { kind: 'new'; parent: string; after: string | null; text: string };
  let edit = $state<Edit | null>(null);
  const draftNode = $derived.by((): MNode | null => {
    if (edit?.kind !== 'new' || !tree) return null;
    const e = edit;
    const p = all.find((n) => n.key === e.parent);
    if (!p) return null;
    const side = p.side ?? (p.kids.some((k) => k.side === 'left') ? 'left' : 'right');
    return { key: '\u0000draft', line: -2, title: e.text, keyword: null, done: false, tags: [], own: null, color: p.color, depth: p.depth + 1, side, kids: [], parent: p, size: 0 };
  });
  function kidsOf(n: MNode): MNode[] {
    const d = draftNode;
    const kids = isFolded(n) && d?.parent !== n ? [] : n.kids;
    if (!d || d.parent !== n || edit?.kind !== 'new') return kids;
    const i = edit.after ? kids.findIndex((k) => k.key === (edit as { after: string }).after) + 1 : kids.length;
    return [...kids.slice(0, i), d, ...kids.slice(i)];
  }

  // ---- the layout: from the nodes' sizes as drawn ----
  const sizes = new SvelteMap<string, { w: number; h: number }>();
  const guess = (n: MNode) => ({ w: n.depth === 0 ? 230 : n.depth === 1 ? 210 : 200, h: n.depth === 0 ? 52 : 40 });
  const lay = $derived(tree ? layout(tree, kidsOf, (n) => sizes.get(n.key) ?? guess(n)) : null);
  function measure(el: HTMLElement, key: string) {
    let k = key;
    const set = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const was = sizes.get(k);
      if (!was || was.w !== w || was.h !== h) sizes.set(k, { w, h });
    };
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return {
      update(next: string) {
        k = next;
        set();
      },
      destroy: () => ro.disconnect(),
    };
  }

  // ---- zoom and the place on the stage ----
  let stage: HTMLDivElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let vw = $state(0);
  let vh = $state(0);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let placed = $state(false);
  const clampZ = (z: number) => Math.min(2.5, Math.max(0.25, z));
  function zoomAt(factor: number, cx = vw / 2, cy = vh / 2) {
    const z = clampZ(zoom * factor);
    pan = { x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom };
    zoom = z;
  }
  function fit() {
    if (!lay || !vw) return;
    const b = lay.bounds;
    const z = clampZ(Math.min(1, (vw - 80) / b.w, (vh - 140) / b.h));
    zoom = z;
    pan = { x: vw / 2 - (b.x + b.w / 2) * z, y: (vh - 50) / 2 - (b.y + b.h / 2) * z };
  }
  // the first look: all of it when it is bigger than the stage, else the root in the middle at 100%
  $effect(() => {
    if (placed || !lay || !vw || !vh) return;
    if (!lay.order.every((p) => sizes.has(p.node.key))) return;
    const b = lay.bounds;
    if (b.w > vw - 80 || b.h > vh - 140) {
      // all of it, but not smaller than one can read: then its middle
      fit();
      if (zoom < 0.7) {
        zoom = 0.7;
        pan = { x: vw / 2 - (b.x + b.w / 2) * zoom, y: (vh - 50) / 2 - (b.y + b.h / 2) * zoom };
      }
    } else pan = { x: vw / 2, y: (vh - 50) / 2 };
    placed = true;
  });
  /** The chosen node kept on the screen. */
  function reveal(key: string) {
    const p = lay?.placed.get(key);
    if (!p) return;
    const m = 40;
    const x0 = pan.x + p.box.x * zoom;
    const y0 = pan.y + p.box.y * zoom;
    const x1 = x0 + p.box.w * zoom;
    const y1 = y0 + p.box.h * zoom;
    let dx = 0;
    let dy = 0;
    if (x0 < m) dx = m - x0;
    else if (x1 > vw - m) dx = vw - m - x1;
    if (y0 < m) dy = m - y0;
    else if (y1 > vh - 70) dy = vh - 70 - y1;
    if (dx || dy) pan = { x: pan.x + dx, y: pan.y + dy };
  }
  function wheel(el: HTMLElement) {
    const on = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // a pinch: the point under the fingers stays
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
    };
    el.addEventListener('wheel', on, { passive: false });
    return { destroy: () => el.removeEventListener('wheel', on) };
  }

  // ---- the choice ----
  let sel = $state<string | null>(null);
  function choose(key: string | null) {
    if (key !== sel) colorBar = false;
    sel = key;
    if (key) void tick().then(() => reveal(key));
  }
  const focusMap = () => root?.focus({ preventScroll: true });

  // ---- the edits: each one a transaction ----
  const refOf = (n: MNode) => canvas.ref(path, n);
  const isHeading = (n: MNode | undefined): n is MNode => !!n && n.line >= 0;
  function startNew(parent: MNode, after: MNode | null) {
    if (isFolded(parent)) canvas.setFolded(mapKey, parent.key, false);
    edit = { kind: 'new', parent: parent.key, after: after?.key ?? null, text: '' };
    sel = '\u0000draft';
  }
  function startRename(n: MNode, first?: string) {
    edit = { kind: 'rename', key: n.key, text: first ?? n.title };
  }
  async function commit(then?: 'child') {
    const e = edit;
    if (!e) return;
    edit = null;
    const t = e.text.replace(/\s+/g, ' ').trim();
    if (e.kind === 'rename') {
      const n = node(e.key);
      sel = e.key;
      if (!n || !t || t === n.title) return focusMap();
      if (n.line < 0) {
        // the file's root: its #+TITLE
        const ok = await canvas.tx('Переименовать', (tx) => tx.update(path, (s) => withTitle(s, t)));
        if (ok) pending = { line: -1 };
      } else {
        const ok = await canvas.tx('Переименовать', (tx) => tx.setTitle(refOf(n), t));
        if (ok) {
          pending = { line: n.line, title: t };
          if (!n.parent && scope) {
            scope = { line: n.line, title: t };
            view.setHeading({ path, line: n.line, title: t });
          }
        }
      }
    } else {
      const parent = node(e.parent);
      const after = e.after ? node(e.after) : null;
      if (!parent || !t) {
        sel = e.after ?? e.parent;
        return focusMap();
      }
      let made: HeadingRef | null = null;
      const ok = await canvas.tx('Новый заголовок', (tx) => {
        const org = `* ${t}`;
        if (isHeading(after ?? undefined)) made = tx.insertHeading({ after: refOf(after!) }, org);
        else if (isHeading(parent)) made = tx.insertHeading({ under: refOf(parent), position: 'last' }, org);
        else made = tx.insertHeading({ file: path, position: 'end' }, org);
      });
      sel = e.after ?? e.parent;
      if (ok && made) pending = { line: (made as HeadingRef).line, title: t };
    }
    focusMap();
    await load();
    if (then === 'child' && sel) {
      const n = node(sel);
      if (n) startNew(n, null);
    }
  }
  function cancel() {
    const e = edit;
    edit = null;
    if (e?.kind === 'new') sel = e.after ?? e.parent;
    focusMap();
  }
  function withTitle(s: string, t: string) {
    const ls = s.split('\n');
    const end = ls.findIndex((l) => /^\*+\s/.test(l));
    const head = end < 0 ? ls.length : end;
    const i = ls.slice(0, head).findIndex((l) => /^#\+TITLE:/i.test(l));
    if (i >= 0) ls[i] = `#+TITLE: ${t}`;
    else ls.unshift(`#+TITLE: ${t}`);
    return ls.join('\n');
  }
  async function remove(n: MNode) {
    if (!isHeading(n) || !n.parent) return;
    const sibs = n.parent.kids;
    const i = sibs.indexOf(n);
    const next = sibs[i + 1] ?? sibs[i - 1] ?? n.parent;
    const ok = await canvas.tx('Удалить заголовок', (tx) => tx.remove(refOf(n)));
    if (!ok) return;
    ctx.ui.notify(`Удалено: ${n.title}`, [{ label: 'Отменить', run: () => void ctx.edit!.undo() }]);
    pending = { line: next.line, title: next.title };
    await load();
    focusMap();
  }
  /** ⌘↑ ⌘↓: before the sibling above, after the one below (with their subtrees). */
  async function shift(n: MNode, d: -1 | 1) {
    if (!isHeading(n) || !n.parent) return;
    const sibs = n.parent.kids;
    const other = sibs[sibs.indexOf(n) + d];
    if (!other) return;
    const ok = await canvas.tx('Переставить', (tx) => tx.move(refOf(n), d < 0 ? { before: refOf(other) } : { after: refOf(other) }));
    if (ok) pending = { line: d < 0 ? other.line : other.line + other.size + 1 - (n.size + 1), title: n.title };
    await load();
    focusMap();
  }
  type Drop = { key: string; how: 'under' | 'before' | 'after' };
  async function drop(n: MNode, d: Drop) {
    const to = node(d.key);
    if (!to || !isHeading(n) || within(to, n)) return;
    const ok = await canvas.tx('Переставить', (tx) => {
      if (d.how === 'under') tx.move(refOf(n), isHeading(to) ? { under: refOf(to) } : { file: path });
      else tx.move(refOf(n), d.how === 'before' ? { before: refOf(to) } : { after: refOf(to) });
    });
    if (ok) pending = { line: to.line, title: n.title };
    await load();
    focusMap();
  }
  async function setColor(n: MNode, value: string | null) {
    if (!isHeading(n)) return;
    const ok = await canvas.tx('Цвет ветки', (tx) => tx.setProperty(refOf(n), 'COLOR', value));
    if (ok) pending = { line: n.line, title: n.title };
    await load();
  }

  // ---- the keys of the map ----
  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, .mm-peek')) return;
    const n = node(sel);
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    menuShown = false;
    if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+')) return done(), zoomAt(1.2);
    if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === '-') return done(), zoomAt(1 / 1.2);
    if (e.shiftKey && e.code === 'Digit1' && !e.metaKey && !e.ctrlKey && !e.altKey) return done(), fit();
    if (!n) {
      if (plain && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && tree) return done(), choose(tree.key);
      return;
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return done(), void shift(n, e.key === 'ArrowUp' ? -1 : 1);
    if (e.metaKey && e.key === 'Enter') return done(), openPeek(n);
    if (!plain) return;
    if (e.key === 'Tab' && !e.shiftKey) return done(), startNew(n, null);
    if (e.key === 'Backspace' || e.key === 'Delete') return done(), void remove(n);
    if (e.key === ' ') return done(), toggle(n);
    if (e.key === 'F2') return done(), startRename(n);
    const dir: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (dir[e.key] && !e.shiftKey && lay) {
      done();
      const to = step(lay, kidsOf, n.key, dir[e.key]);
      if (to) choose(to);
      return;
    }
    // typing on a chosen node renames it (as in XMind)
    if (e.key.length === 1 && e.key !== ' ') return done(), startRename(n, e.key);
  }
  /** ↩ of the list of tasks (the core's key) — a sibling; the root takes a child. Its menu's «Открыть» — the side. */
  let menuShown = false;
  function enter() {
    const n = node(sel);
    if (!n) return;
    if (menuShown) {
      menuShown = false;
      return openPeek(n);
    }
    if (!n.parent) startNew(n, null);
    else startNew(n.parent, n);
  }
  function inputKeys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      void commit('child');
    }
  }
  const focusInput = (el: HTMLInputElement) => {
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };

  // ---- the pointer: choose, drag a node to another place, move the stage ----
  type Press = { key: string; sx: number; sy: number; moved: boolean };
  let press: Press | null = null;
  let drag = $state<{ key: string; x: number; y: number; over: Drop | null; label: string } | null>(null);
  function nodeDown(e: PointerEvent, n: MNode) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, .mm-fold')) return;
    e.stopPropagation();
    if (edit && !(edit.kind === 'rename' && edit.key === n.key)) void commit();
    choose(n.key);
    focusMap();
    if (!isHeading(n) || !n.parent) return;
    press = { key: n.key, sx: e.clientX, sy: e.clientY, moved: false };
    window.addEventListener('pointermove', nodeMove);
    window.addEventListener('pointerup', nodeUp, { once: true });
  }
  function dropAt(x: number, y: number, key: string): Drop | null {
    const el = (document.elementsFromPoint(x, y) as HTMLElement[]).find((t) => t.dataset?.key && t.dataset.key !== key);
    const to = el ? node(el.dataset.key!) : undefined;
    const from = node(key);
    if (!el || !to || !from || to.key === '\u0000draft' || within(to, from)) return null;
    if (!to.parent) return { key: to.key, how: 'under' };
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    return { key: to.key, how: f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'under' };
  }
  function nodeMove(e: PointerEvent) {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < 5) return;
    press.moved = true;
    const n = node(press.key);
    drag = { key: press.key, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY, press.key), label: n?.title ?? '' };
  }
  function nodeUp() {
    window.removeEventListener('pointermove', nodeMove);
    const d = drag;
    const n = press ? node(press.key) : undefined;
    press = null;
    drag = null;
    if (d?.over && n) void drop(n, d.over);
  }
  let panning: { sx: number; sy: number; px: number; py: number; moved: boolean } | null = null;
  function stageDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (edit) void commit();
    focusMap();
    panning = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false };
    window.addEventListener('pointermove', stageMove);
    window.addEventListener('pointerup', stageUp, { once: true });
  }
  function stageMove(e: PointerEvent) {
    if (!panning) return;
    const dx = e.clientX - panning.sx;
    const dy = e.clientY - panning.sy;
    if (!panning.moved && Math.hypot(dx, dy) < 4) return;
    panning.moved = true;
    pan = { x: panning.px + dx, y: panning.py + dy };
  }
  function stageUp() {
    window.removeEventListener('pointermove', stageMove);
    if (panning && !panning.moved) choose(null);
    panning = null;
  }
  onDestroy(() => {
    window.removeEventListener('pointermove', nodeMove);
    window.removeEventListener('pointermove', stageMove);
  });

  // ---- the core's menu of a heading (status, dates, tags…) and ours ----
  let tasks: { menu(at: { x: number; y: number }): void; dispose(): void } | null = null;
  onMount(() => {
    if (!root) return;
    tasks = ctx.ui.taskList(root, {
      selected: () => {
        const n = node(sel);
        return isHeading(n) ? { ref: refOf(n) } : null;
      },
      open: (other) => {
        const n = node(sel);
        if (other) return n && inFile(n);
        enter();
      },
      otherLabel: 'Открыть в тексте файла',
      clear: () => {
        if (colorBar) colorBar = false;
        else choose(null);
      },
      refresh: () => void load(),
      more: () => {
        const n = node(sel);
        if (!isHeading(n)) return [];
        const items: (MenuItem | 'sep')[] = [{ label: 'Цвет ветки…', run: () => (colorBar = true) }];
        if (n.parent) items.push({ label: 'Показать ветку как mindmap', run: () => void ctx.ui.openFileView(VIEW, { path, heading: refOf(n) }) });
        if (n.parent) items.push('sep', { label: 'Удалить', danger: true, run: () => void remove(n) });
        return items;
      },
    });
  });
  onDestroy(() => tasks?.dispose());
  function context(e: MouseEvent, n: MNode) {
    e.preventDefault();
    e.stopPropagation();
    choose(n.key);
    focusMap();
    if (isHeading(n)) {
      menuShown = true;
      tasks?.menu({ x: e.clientX, y: e.clientY });
    } else
      ctx.ui.menu(
        [
          { label: 'Новый заголовок', run: () => startNew(n, null) },
          { label: 'Переименовать', run: () => startRename(n) },
          'sep',
          { label: 'Вписать', run: fit },
        ],
        { x: e.clientX, y: e.clientY },
      );
  }

  // ---- the colour of a branch: a bar over the chosen node ----
  let colorBar = $state(false);
  let custom: HTMLInputElement | undefined = $state();
  const barAt = $derived.by(() => {
    const p = sel ? lay?.placed.get(sel) : undefined;
    if (!p) return null;
    return { x: Math.max(8, Math.min(vw - 330, pan.x + p.box.x * zoom)), y: Math.max(8, pan.y + p.box.y * zoom - 46) };
  });

  // ---- the heading at the side: its subtree in the core's editor, edited right there ----
  let opened = $state<{ line: number; title: string; n: number } | null>(null);
  let peek = $state<{ line: number; title: string } | null>(null);
  let peekEl: HTMLDivElement | undefined = $state();
  let peekN = 0;
  function openPeek(n: MNode) {
    if (!isHeading(n)) return;
    opened = { line: n.line, title: n.title, n: ++peekN };
    peek = { line: n.line, title: n.title };
  }
  function closePeek() {
    opened = null;
    peek = null;
    focusMap();
  }
  $effect(() => {
    const el = peekEl;
    const at = opened;
    if (!el || !at) return;
    const ed = untrack(() => ctx.ui.editor(el, { path, line: at.line, title: at.title }, { onRef: (r) => (peek = { line: r.line, title: r.title }) }));
    queueMicrotask(() => ed.focus());
    return () => ed.dispose();
  });
  const peekHead = $derived(peek ? (heads.find((h) => h.line === peek!.line && h.title === peek!.title) ?? heads.find((h) => h.title === peek!.title)) : undefined);
  async function peekStatus(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const h = peekHead;
    if (!h) return;
    const wf = await ctx.index!.workflow(path);
    const states = wf.sets.find((s) => s.states.some((x) => x.name === h.keyword))?.states.map((x) => x.name) ?? [...wf.open, ...wf.done];
    ctx.ui.menu(
      states.map((s) => ({ label: s, checked: s === h.keyword, run: () => void canvas.tx('Статус', (tx) => tx.setStatus({ path, line: h.line, title: h.title }, s)) })),
      { x: r.left, y: r.bottom + 4 },
    );
  }
  function inFile(n: { line: number }) {
    view.showText();
    void ctx.commands.run('file.open', { path, line: n.line });
  }
  function peekKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePeek();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (peekHead) inFile(peekHead);
    }
  }

  // ---- drawing ----
  const wire = (e: Edge) => (e.to.node.depth === 1 ? (e.to.node.color ?? 'var(--acc)') : (e.to.node.color ?? 'var(--mm-wire)'));
  const hidden = (n: MNode) => (isFolded(n) ? n.size : 0);
  function look(p: Placed) {
    const n = p.node;
    if (!n.parent) return '';
    const own = n.own && n.color;
    const c = n.color ?? (n.depth === 1 ? 'var(--acc)' : 'var(--line)');
    return `--bd:${c};${own ? `--fill:color-mix(in srgb, ${n.color} 14%, var(--bg));` : ''}`;
  }
  const hints = [
    ['⇥', 'дочерний'],
    ['↩', 'соседний'],
    ['⌫', 'удалить'],
    ['Space', 'свернуть ветку'],
    ['двойной клик', 'текст заголовка'],
  ];
  const current = $derived(node(sel));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="mm" bind:this={root} tabindex="0" role="application" aria-label="Mindmap" onkeydown={keys}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="mm-stage" bind:this={stage} bind:clientWidth={vw} bind:clientHeight={vh} use:wheel onpointerdown={stageDown}>
    {#if loaded && !tree}
      <div class="mm-gone" role="status">Заголовок «{scope?.title}» не найден в файле</div>
    {/if}
    {#if lay}
      <div class="mm-world" style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})" style:visibility={placed ? 'visible' : 'hidden'}>
        <svg class="mm-wires" width="1" height="1" aria-hidden="true">
          {#each lay.edges as e (e.to.node.key)}
            <path d={curve(e)} fill="none" stroke={wire(e)} stroke-width={e.to.node.depth === 1 ? 2 : 1.4} stroke-linecap="round" />
          {/each}
        </svg>
        {#each lay.order as p (p.node.key)}
          {@const n = p.node}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="mm-node d{Math.min(n.depth, 2)}"
            class:sel={sel === n.key}
            class:own={!!n.own && !!n.color}
            class:draft={n.key === '\u0000draft'}
            class:into={drag?.over?.key === n.key && drag.over.how === 'under'}
            class:before={drag?.over?.key === n.key && drag.over.how === 'before'}
            class:after={drag?.over?.key === n.key && drag.over.how === 'after'}
            class:dragged={drag?.key === n.key}
            data-key={n.key}
            role="treeitem"
            aria-selected={sel === n.key}
            aria-level={n.depth + 1}
            aria-expanded={n.kids.length ? !isFolded(n) : undefined}
            style="left:{p.box.x}px;top:{p.box.y}px;{look(p)}"
            use:measure={n.key}
            onpointerdown={(e) => nodeDown(e, n)}
            ondblclick={(e) => (e.stopPropagation(), n.parent ? openPeek(n) : startRename(n))}
            oncontextmenu={(e) => context(e, n)}
          >
            <div class="mm-row">
              {#if n.keyword}<span class="mm-kw" style:--c={canvas.tone(n.keyword, path)}>{n.keyword}</span>{/if}
              {#if (edit?.kind === 'rename' && edit.key === n.key) || n.key === '\u0000draft'}
                <input class="mm-input" aria-label="Название заголовка" placeholder="Новый заголовок" spellcheck="false" bind:value={edit!.text} use:focusInput onkeydown={inputKeys} onblur={() => edit && void commit()} />
              {:else}
                <span class="mm-t">{@html titleHtml(n.title)}</span>
              {/if}
              {#if hidden(n)}<button class="mm-fold" title="Развернуть ветку" onpointerdown={(e) => e.stopPropagation()} onclick={() => toggle(n)}>+{hidden(n)}</button>{/if}
            </div>
            {#if n.tags.length}<div class="mm-tags">:{n.tags.join(':')}:</div>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="mm-tools" role="toolbar" aria-label="Масштаб">
    <button aria-label="Уменьшить" title="Уменьшить ⌘−" onclick={() => zoomAt(1 / 1.2)}>−</button>
    <button class="mm-z" title="100%" onclick={() => zoomAt(1 / zoom)}>{Math.round(zoom * 100)}%</button>
    <button aria-label="Увеличить" title="Увеличить ⌘+" onclick={() => zoomAt(1.2)}>+</button>
    <button class="mm-fit" title="Вписать ⇧1" onclick={fit}>Вписать</button>
  </div>

  {#if colorBar && current && isHeading(current) && barAt}
    <div class="mm-colors" role="toolbar" aria-label="Цвет ветки" style:left="{barAt.x}px" style:top="{barAt.y}px">
      <span class="mm-cl">Цвет ветки</span>
      <button class="mm-sw none" class:on={!current.own} title="Без цвета" aria-label="Без цвета" onclick={() => void setColor(current, null)}>⊘</button>
      {#each PALETTE as c (c.name)}
        <button class="mm-sw" class:on={current.own === c.name} style:background={c.hex} title={c.label} aria-label={c.label} onclick={() => void setColor(current, c.name)}></button>
      {/each}
      <span class="mm-sep"></span>
      <button class="mm-own" onclick={() => custom?.click()}>Свой…</button>
      <input class="mm-pick" type="color" bind:this={custom} value={current.color ?? '#0a64d6'} onchange={(e) => void setColor(current, colorValue((e.currentTarget as HTMLInputElement).value))} tabindex="-1" aria-hidden="true" />
    </div>
    <div class="mm-hint mm-note">Цвет ветки хранится в заголовке: <code>:PROPERTIES: :COLOR: {current.own ?? 'green'}</code> — потомки берут его, пока не задан свой</div>
  {:else if !opened}
    <div class="mm-hint" aria-label="Подсказка">
      {#each hints as [k, t] (k)}<span><b>{k}</b> {t}</span>{/each}
    </div>
  {/if}

  {#if opened && peek}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="mm-peek" role="dialog" aria-label="Текст заголовка" tabindex="-1" onkeydown={peekKeys}>
      <div class="mm-ph">
        {#if peekHead?.keyword}<button class="mm-kw mm-pk" style:--c={canvas.tone(peekHead.keyword, path)} title="Сменить статус" onclick={peekStatus}>{peekHead.keyword} ▾</button>{/if}
        <span class="mm-pt">{peekHead?.title ?? peek.title}</span>
        <button class="mm-pl" onclick={() => peekHead && inFile(peekHead)}>В файле ›</button>
        <button class="mm-px" aria-label="Закрыть" title="Закрыть" onclick={closePeek}>×</button>
      </div>
      <div class="mm-pb" bind:this={peekEl}></div>
      <div class="mm-pf">Редактируется прямо здесь · ⎋ закрыть · ⌘↩ открыть в файле</div>
    </div>
  {/if}
</div>
{#if drag}
  <div class="mm-ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 10}px" aria-hidden="true">{drag.label}</div>
{/if}

<style>
  .mm { --mm-wire: color-mix(in srgb, var(--fg) 28%, var(--stage)); position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--stage); color: var(--fg); font: 13px var(--ui); outline: none; }
  .mm-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background-image: radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px); background-size: 22px 22px; cursor: default; }
  .mm-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .mm-wires { position: absolute; left: 0; top: 0; overflow: visible; }
  .mm-gone { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--fg2); }

  .mm-node { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; padding: 8px 12px; border-radius: 10px; background: var(--fill, var(--bg)); border: 1px solid var(--bd, var(--line)); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); user-select: none; -webkit-user-select: none; }
  .mm-node.d0 { width: max-content; min-width: 180px; max-width: 320px; padding: 14px 16px; border: 0; border-radius: 14px; background: var(--acc); color: var(--onacc); font-size: 16px; font-weight: 700; justify-content: center; }
  .mm-node.d1 { width: 210px; border-width: 1.5px; font-weight: 700; }
  .mm-node.d2 { width: 200px; }
  .mm-node.sel { outline: 2px solid var(--acc); outline-offset: -1px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--acc) 16%, transparent); }
  .mm-node.d0.sel { outline-color: color-mix(in srgb, var(--acc) 55%, var(--fg)); outline-offset: 2px; }
  .mm-node.draft { border-style: dashed; }
  .mm-node.into { outline: 2px dashed var(--acc); outline-offset: 3px; }
  .mm-node.before::before, .mm-node.after::after { content: ''; position: absolute; left: 6px; right: 6px; height: 3px; border-radius: 2px; background: var(--acc); }
  .mm-node.before::before { top: -10px; }
  .mm-node.after::after { bottom: -10px; }
  .mm-node.dragged { opacity: 0.45; }
  .mm-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .mm-t { flex: 1; min-width: 0; line-height: 1.3; overflow-wrap: anywhere; }
  .mm-node:not(.d0) .mm-t { font-weight: inherit; }
  .mm-node.d2 .mm-t { font-weight: 500; }
  .mm-t :global(code) { font: 0.92em var(--mono); }
  .mm-t :global(.mm-link) { color: var(--link, var(--acc)); }
  .mm-node.d0 .mm-t :global(.mm-link) { color: inherit; text-decoration: underline; }
  .mm-kw { flex: 0 0 auto; padding: 1px 5px; border-radius: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
  .mm-fold { flex: 0 0 auto; margin-left: auto; padding: 0 6px; border: 0; border-radius: 8px; background: var(--field); color: var(--fg2); font: 11px var(--ui); line-height: 16px; cursor: default; }
  .mm-node.d0 .mm-fold { background: rgba(255, 255, 255, 0.2); color: inherit; }
  .mm-tags { font: 11px var(--mono); color: var(--tagfg); font-weight: 400; }
  .mm-input { flex: 1; min-width: 0; padding: 0; border: 0; outline: none; background: none; color: inherit; font: inherit; caret-color: var(--acc); }
  .mm-node.d0 .mm-input { caret-color: currentColor; }
  .mm-input::placeholder { color: var(--fg3); font-weight: 400; }

  .mm-tools { position: absolute; top: 12px; right: 14px; z-index: 3; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg2); }
  .mm-tools button { height: 24px; min-width: 26px; padding: 0 8px; border: 0; border-radius: 5px; background: var(--field); color: var(--fg2); font: 12px var(--ui); }
  .mm-tools button:hover { color: var(--fg); }
  .mm-tools .mm-z { min-width: 48px; background: none; }

  .mm-hint { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; display: flex; align-items: center; gap: 14px; height: 34px; padding: 0 14px; box-sizing: border-box; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08); font-size: 12px; color: var(--fg2); white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; }
  .mm-hint b { font: 400 12px var(--mono); color: var(--fg); }
  .mm-note { display: block; line-height: 32px; text-overflow: ellipsis; }
  .mm-note code { font: 11.5px var(--mono); }

  .mm-colors { position: absolute; z-index: 6; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); white-space: nowrap; }
  .mm-cl { margin-right: 2px; font-size: 12px; color: var(--fg2); }
  .mm-sw { width: 20px; height: 20px; padding: 0; box-sizing: border-box; border: 0; border-radius: 10px; font-size: 11px; color: var(--fg3); }
  .mm-sw.none { background: transparent; border: 1px solid var(--line); }
  .mm-sw.on { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--acc); }
  .mm-sep { width: 1px; height: 18px; margin: 0 2px; background: var(--line); }
  .mm-own { padding: 0; border: 0; background: none; font: 12px var(--ui); color: var(--acc); }
  .mm-pick { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }

  .mm-peek { position: absolute; z-index: 7; right: 0; top: 0; bottom: 0; width: 430px; max-width: 100%; box-sizing: border-box; display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--line); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.14); outline: none; }
  .mm-ph { flex: 0 0 44px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); }
  .mm-pk { border: 0; cursor: default; }
  .mm-pt { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mm-pl { border: 0; background: none; padding: 0; font: 12px var(--ui); color: var(--acc); }
  .mm-pl:hover { text-decoration: underline; }
  .mm-px { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--fg2); font-size: 16px; }
  .mm-px:hover { background: var(--field); }
  .mm-pb { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .mm-pb > :global(*) { flex: 1; min-height: 0; }
  .mm-pf { flex: 0 0 auto; padding: 8px 16px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--fg3); }

  .mm-ghost { position: fixed; z-index: 95; max-width: 220px; padding: 6px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--acc); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); font: 600 12.5px var(--ui); color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
</style>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { draggingOurs, droppedOf, type HeadingRef } from '@panopticon/api';
  import { canvas } from './state.svelte';
  import { cards, subTitle, type Card } from './cards.svelte';
  import { boxOf, edgePath, newId, parseCanvas, writeCanvas, type Canvas, type CEdge, type CNode, type FileNode, type Side, type TextNode } from './jsoncanvas';
  import { addEdge, addNode, duplicate, group, moveNodes, nearestSide, patchEdge, patchNode, remove, resizeNode, setColor, snap, within } from './board';
  import { colorOf, PALETTE } from './colors';
  import { titleHtml } from './title';
  import { exportMenu, type Exportable } from './exporting';
  import { canvasScene } from './scenes';

  // A free canvas (ТЗ 39 §2): a `.canvas` file in JSON Canvas — notes, live cards of headings, files, links, groups and
  // edges. Each change is written at once as one step of ⌘Z; the file opens in Obsidian too.
  let { path, view }: { path: string; view: { showText(): void } } = $props();
  const ctx = canvas.ctx;

  // ---- the file ----
  let cv = $state<Canvas | null>(null);
  let loaded = $state(false);
  let broken = $state(false);
  async function load() {
    let text: string;
    try {
      text = await ctx.files!.read(path);
    } catch {
      return;
    }
    const c = parseCanvas(text);
    broken = !c;
    if (c) cv = c;
    loaded = true;
    if (cv) {
      const ids = new Set(cv.nodes.map((n) => n.id));
      sel = new Set([...sel].filter((id) => ids.has(id)));
      if (selEdge && !cv.edges.some((e) => e.id === selEdge)) selEdge = null;
    }
  }
  onMount(() => {
    void load();
    const off = canvas.watch(path, () => void load());
    // a heading's file changed: its cards read again
    const offCards = ctx.events.on('file.changed', (p) => cards.changed((p as { path: string }).path));
    return () => (off(), offCards());
  });
  /** A change written as one step of ⌘Z (shown at once). */
  async function write(label: string, next: Canvas) {
    cv = next;
    const text = writeCanvas(next);
    await canvas.tx(label, (tx) => tx.update(path, () => text));
  }

  // ---- the choice ----
  let sel = $state(new Set<string>());
  let selEdge = $state<string | null>(null);
  const choose = (ids: Iterable<string>) => {
    sel = new Set(ids);
    selEdge = null;
    if (!sel.size) colorBar = false;
  };
  const node = (id: string) => cv?.nodes.find((n) => n.id === id);

  // ---- zoom and the place on the stage ----
  let root: HTMLDivElement | undefined = $state();
  let stageEl: HTMLDivElement | undefined = $state();
  let vw = $state(0);
  let vh = $state(0);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let placed = $state(false);
  const clampZ = (z: number) => Math.min(2.5, Math.max(0.2, z));
  function zoomAt(f: number, cx = vw / 2, cy = vh / 2) {
    const z = clampZ(zoom * f);
    pan = { x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom };
    zoom = z;
  }
  function fit() {
    if (!cv?.nodes.length || !vw) return;
    const b = boxOf(cv.nodes);
    const z = clampZ(Math.min(1, (vw - 80) / b.width, (vh - 140) / b.height));
    zoom = z;
    pan = { x: vw / 2 - (b.x + b.width / 2) * z, y: (vh - 50) / 2 - (b.y + b.height / 2) * z };
  }
  $effect(() => {
    if (placed || !loaded || !vw || !vh) return;
    untrack(() => {
      if (cv?.nodes.length) fit();
      else pan = { x: vw / 2, y: vh / 2 };
    });
    placed = true;
  });
  /** A point of the window in the canvas's coordinates. */
  const toWorld = (cx: number, cy: number) => {
    const r = stageEl!.getBoundingClientRect();
    return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom };
  };
  const centre = () => ({ x: (vw / 2 - pan.x) / zoom, y: (vh / 2 - pan.y) / zoom });
  function wheel(el: HTMLElement) {
    const on = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea')) return;
      e.preventDefault();
      if (e.ctrlKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
    };
    el.addEventListener('wheel', on, { passive: false });
    return { destroy: () => el.removeEventListener('wheel', on) };
  }

  // ---- what is drawn: the canvas, or its preview while dragging ----
  let preview = $state<Canvas | null>(null);
  const shown = $derived(preview ?? cv);
  const groups = $derived(shown?.nodes.filter((n) => n.type === 'group') ?? []);
  const others = $derived(shown?.nodes.filter((n) => n.type !== 'group') ?? []);
  const byId = $derived(new Map((shown?.nodes ?? []).map((n) => [n.id, n])));
  const edges = $derived(
    (shown?.edges ?? []).flatMap((e) => {
      const a = byId.get(e.fromNode);
      const b = byId.get(e.toNode);
      return a && b ? [{ e, ...edgePath(a, b, e) }] : [];
    }),
  );

  // ---- the pointer ----
  const snapOn = $derived(canvas.snapGrid);
  type Gesture =
    | { kind: 'move'; sx: number; sy: number; from: Canvas; moved: boolean }
    | { kind: 'frame'; sx: number; sy: number; x: number; y: number; add: boolean; base: Set<string> }
    | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number; from: Canvas }
    | { kind: 'link'; from: string; side: Side; x: number; y: number }
    | { kind: 'pan'; sx: number; sy: number; px: number; py: number };
  let g = $state<Gesture | null>(null);
  let space = false;
  function nodeDown(e: PointerEvent, n: CNode) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('textarea, input, button, .cv-dot, .cv-size')) return;
    e.stopPropagation();
    root?.focus({ preventScroll: true });
    if (editing && editing !== n.id) void commitText();
    if (e.shiftKey) {
      const s = new Set(sel);
      if (s.has(n.id)) s.delete(n.id);
      else s.add(n.id);
      choose(s);
      return;
    }
    if (!sel.has(n.id)) choose([n.id]);
    if (cv) start({ kind: 'move', sx: e.clientX, sy: e.clientY, from: cv, moved: false });
  }
  function stageDown(e: PointerEvent) {
    if (e.button !== 0) return;
    root?.focus({ preventScroll: true });
    if (editing) void commitText();
    if (labelEdit) void commitLabel();
    if (space) return start({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
    const p = toWorld(e.clientX, e.clientY);
    start({ kind: 'frame', sx: p.x, sy: p.y, x: p.x, y: p.y, add: e.shiftKey, base: e.shiftKey ? new Set(sel) : new Set() });
    if (!e.shiftKey) choose([]);
  }
  function start(x: Gesture) {
    g = x;
    window.addEventListener('pointermove', moveG);
    window.addEventListener('pointerup', upG, { once: true });
  }
  function moveG(e: PointerEvent) {
    const x = g;
    if (!x) return;
    if (x.kind === 'move') {
      const dx = (e.clientX - x.sx) / zoom;
      const dy = (e.clientY - x.sy) / zoom;
      if (!x.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return;
      x.moved = true;
      const on = snapOn && !e.metaKey;
      preview = moveNodes(x.from, sel, snap(dx, on), snap(dy, on));
    } else if (x.kind === 'frame') {
      const p = toWorld(e.clientX, e.clientY);
      g = { ...x, x: p.x, y: p.y };
      if (cv) {
        const r = frameRect(g as Extract<Gesture, { kind: 'frame' }>);
        sel = new Set([...x.base, ...within(cv, r)]);
      }
    } else if (x.kind === 'resize') {
      const on = snapOn && !e.metaKey;
      preview = resizeNode(x.from, x.id, snap(x.w + (e.clientX - x.sx) / zoom, on), snap(x.h + (e.clientY - x.sy) / zoom, on));
    } else if (x.kind === 'link') {
      const p = toWorld(e.clientX, e.clientY);
      g = { ...x, x: p.x, y: p.y };
    } else if (x.kind === 'pan') pan = { x: x.px + e.clientX - x.sx, y: x.py + e.clientY - x.sy };
  }
  function upG(e: PointerEvent) {
    window.removeEventListener('pointermove', moveG);
    const x = g;
    g = null;
    const p = preview;
    preview = null;
    if (!x) return;
    if ((x.kind === 'move' && x.moved) || x.kind === 'resize') {
      if (p) void write(x.kind === 'move' ? 'Переместить' : 'Размер', p);
    } else if (x.kind === 'link' && cv) {
      const el = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find((t) => t.dataset?.id && t.dataset.id !== x.from);
      const to = el ? node(el.dataset.id!) : undefined;
      if (!to) return;
      const w = toWorld(e.clientX, e.clientY);
      const r = addEdge(cv, x.from, x.side, to.id, nearestSide(to, w.x, w.y));
      if (r) {
        void write('Стрелка', r.canvas);
        choose([]);
        selEdge = r.id;
      }
    }
  }
  const frameRect = (f: { sx: number; sy: number; x: number; y: number }) => ({ x: Math.min(f.sx, f.x), y: Math.min(f.sy, f.y), width: Math.abs(f.x - f.sx), height: Math.abs(f.y - f.sy) });
  function sizeDown(e: PointerEvent, n: CNode) {
    e.stopPropagation();
    if (cv) start({ kind: 'resize', id: n.id, sx: e.clientX, sy: e.clientY, w: n.width, h: n.height, from: cv });
  }
  function dotDown(e: PointerEvent, n: CNode, side: Side) {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    start({ kind: 'link', from: n.id, side, x: p.x, y: p.y });
  }
  onDestroy(() => window.removeEventListener('pointermove', moveG));

  // ---- adding ----
  /** A new node at a point (its top-left on the grid), chosen. */
  async function add(n: Omit<CNode, 'id' | 'x' | 'y'> & { width: number; height: number }, at = centre(), label = 'Добавить на холст') {
    if (!cv) return null;
    const x = snap(at.x - n.width / 2, snapOn);
    const y = snap(at.y - n.height / 2, snapOn);
    const made = { ...n, id: newId(), x, y } as CNode;
    await write(label, addNode(cv, made));
    choose([made.id]);
    return made;
  }
  async function addNote(at?: { x: number; y: number }) {
    const color = canvas.noteColor;
    const n = await add({ type: 'text', text: '', width: 250, height: 66, ...(color ? { color } : {}) } as never, at, 'Заметка');
    if (n) startText(n.id);
  }
  /** A heading as a live card: its :ID: written when it has none (one step with the card). */
  async function addHeading(ref: HeadingRef, at?: { x: number; y: number }, id?: string) {
    if (!cv) return;
    let orgId = id ?? null;
    if (!orgId) {
      await ctx.edit!.transaction('ID заголовка', (tx) => {
        orgId = tx.ensureId(ref);
      });
    }
    const h = await ctx.index!.heading(ref);
    await add({ type: 'file', file: ref.path, subpath: '#' + (h?.title ?? ref.title), ...(orgId ? { orgId } : {}), width: 300, height: 150, ...(h?.properties.COLOR ? { color: canvasColor(h.properties.COLOR) } : {}) } as never, at, 'Карточка заголовка');
  }
  const canvasColor = (v: string) => PALETTE.find((c) => c.name === v)?.canvas ?? v;
  async function addFile(file: string, at?: { x: number; y: number }) {
    await add({ type: 'file', file, width: 260, height: 110 } as never, at, 'Карточка файла');
  }
  async function addLink(url: string, at?: { x: number; y: number }) {
    await add({ type: 'link', url, width: 280, height: 80 } as never, at, 'Ссылка');
  }
  async function pickHeading(at?: { x: number; y: number }) {
    const p = await ctx.ui.pickPlace({ kind: 'heading', title: 'Заголовок на холст' });
    if (p && 'line' in p) await addHeading(p, at);
  }
  async function pickFile(at?: { x: number; y: number }) {
    const p = await ctx.ui.pickPlace({ kind: 'file', title: 'Файл на холст' });
    if (p) await addFile(p.path, at);
  }
  async function askLink() {
    const v = await ctx.ui.form({ title: 'Ссылка на холст', submit: 'Добавить', groups: [{ fields: [{ type: 'text', key: 'url', label: 'Адрес', placeholder: 'https://…' }] }], validate: (x) => (/^\w[\w+.-]*:\/\/\S+$/.test(String(x.url ?? '').trim()) ? null : 'Нужен адрес вида https://…') });
    if (v) await addLink(String(v.url).trim());
  }
  async function addGroup() {
    const n = await add({ type: 'group', label: 'Группа', width: 440, height: 286 } as never, undefined, 'Группа');
    if (n) startLabel(n.id);
  }

  // ---- what the app's lists give when dropped here; ⌘V ----
  let dropping = $state(false);
  function dragOver(e: DragEvent) {
    if (!draggingOurs(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropping = true;
  }
  function dropIn(e: DragEvent) {
    dropping = false;
    const d = droppedOf(e.dataTransfer);
    if (!d) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    if (d.kind === 'heading') void addHeading(d.ref, at, d.id);
    else if (d.path !== path) void addFile(d.path, at);
  }
  async function paste(e: ClipboardEvent) {
    if ((e.target as HTMLElement).closest('textarea, input')) return;
    const t = e.clipboardData?.getData('text/plain')?.trim();
    if (!t) return;
    e.preventDefault();
    const id = /^\[\[id:([^\]]+)\](?:\[[^\]]*\])?\]$/.exec(t)?.[1];
    if (id) {
      const ref = await ctx.index!.byId(id);
      if (ref) return void addHeading(ref, undefined, id);
    }
    const fl = /^\[\[file:([^\]:]+)(?:::\*([^\]]+))?\](?:\[[^\]]*\])?\]$/.exec(t);
    if (fl) {
      const h = fl[2] ? (await ctx.index!.outline(fl[1])).find((x) => x.title === fl[2]) : undefined;
      return void (h ? addHeading(h.ref) : addFile(fl[1]));
    }
    if (/^https?:\/\/\S+$/.test(t)) return void addLink(t);
    const n = await add({ type: 'text', text: t, width: 250, height: Math.min(300, 44 + 20 * t.split('\n').length), ...(canvas.noteColor ? { color: canvas.noteColor } : {}) } as never, undefined, 'Заметка');
    void n;
  }

  // ---- editing a note's text, a group's or an edge's label ----
  let editing = $state<string | null>(null);
  let draft = $state('');
  function startText(id: string) {
    const n = node(id);
    if (n?.type !== 'text') return;
    editing = id;
    draft = n.text;
  }
  async function commitText() {
    const id = editing;
    editing = null;
    const n = id ? node(id) : undefined;
    if (!cv || n?.type !== 'text' || n.text === draft) return root?.focus({ preventScroll: true });
    await write('Текст заметки', patchNode(cv, n.id, { text: draft } as Partial<TextNode>));
    root?.focus({ preventScroll: true });
  }
  function textKeys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && e.metaKey)) {
      e.preventDefault();
      void commitText();
    }
  }
  let labelEdit = $state<{ kind: 'group' | 'edge'; id: string } | null>(null);
  let labelDraft = $state('');
  function startLabel(id: string) {
    const n = node(id);
    if (n?.type !== 'group') return;
    labelEdit = { kind: 'group', id };
    labelDraft = n.label ?? '';
  }
  function startEdgeLabel(id: string) {
    const e = cv?.edges.find((x) => x.id === id);
    if (!e) return;
    labelEdit = { kind: 'edge', id };
    labelDraft = e.label ?? '';
  }
  async function commitLabel() {
    const l = labelEdit;
    labelEdit = null;
    if (!l || !cv) return;
    const t = labelDraft.trim();
    if (l.kind === 'group') {
      const n = node(l.id);
      if (n?.type === 'group' && (n.label ?? '') !== t) await write('Подпись группы', patchNode(cv, l.id, { label: t || undefined } as never));
    } else {
      const e = cv.edges.find((x) => x.id === l.id);
      if (e && (e.label ?? '') !== t) {
        const { label: _, ...rest } = e;
        await write('Подпись стрелки', { ...cv, edges: cv.edges.map((x) => (x.id === l.id ? (t ? { ...rest, label: t } : rest) : x)) as CEdge[] });
      }
    }
    root?.focus({ preventScroll: true });
  }
  function labelKeys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitLabel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      labelEdit = null;
      root?.focus({ preventScroll: true });
    }
  }
  const focusEl = (el: HTMLElement) => {
    el.focus();
    // a label: all of it, to type anew; a note's text: the caret at its end
    if (el instanceof HTMLInputElement) el.select();
    else if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
  };

  // ---- the commands of the canvas (the keys of the view: ⌘D, ⌘G) and its own keys ----
  async function removeSel() {
    if (!cv || (!sel.size && !selEdge)) return;
    const n = sel.size;
    await write(n ? 'Удалить с холста' : 'Удалить стрелку', remove(cv, sel, selEdge ? [selEdge] : []));
    choose([]);
  }
  async function dup() {
    if (!cv || !sel.size) return;
    const d = duplicate(cv, sel);
    await write('Дубликат', d.canvas);
    choose(d.ids);
  }
  async function groupSel() {
    if (!cv || !sel.size) return;
    const r = group(cv, sel, 'Группа');
    if (!r) return;
    await write('Сгруппировать', r.canvas);
    choose([r.id]);
    startLabel(r.id);
  }
  async function nudge(dx: number, dy: number) {
    if (!cv || !sel.size) return;
    await write('Переместить', moveNodes(cv, sel, dx, dy));
  }
  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('textarea, input, .cv-peek')) return;
    const done = () => (e.preventDefault(), e.stopPropagation());
    const cmd = e.metaKey && !e.ctrlKey && !e.altKey;
    if (cmd && (e.key === '=' || e.key === '+')) return done(), zoomAt(1.2);
    if (cmd && e.key === '-') return done(), zoomAt(1 / 1.2);
    if (cmd && e.code === 'KeyA') return done(), choose(cv?.nodes.map((n) => n.id) ?? []);
    if (cmd && e.code === 'KeyD') return done(), void dup();
    if (cmd && e.code === 'KeyG') return done(), void groupSel();
    if (e.shiftKey && e.code === 'Digit1' && !e.metaKey && !e.ctrlKey && !e.altKey) return done(), fit();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (mode && e.key === 'Escape') {
      mode = null;
      return done();
    }
    if (!e.shiftKey && e.code === 'KeyS') return done(), startMode('shape');
    if (!e.shiftKey && e.code === 'KeyA') return done(), startMode('arrow');
    if (e.key === ' ') {
      space = true;
      return done();
    }
    if (e.key === 'Backspace' || e.key === 'Delete') return done(), void removeSel();
    if (e.key === 'Escape') {
      if (colorBar) colorBar = false;
      else choose([]);
      return done();
    }
    if (e.key === 'Enter' && sel.size === 1) {
      const n = node([...sel][0])!;
      done();
      if (n.type === 'text') startText(n.id);
      else if (n.type === 'group') startLabel(n.id);
      else if (n.type === 'file') openPeek(n);
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && sel.size) {
      const k = e.shiftKey ? 10 : 1;
      return done(), void nudge(arrows[e.key][0] * k, arrows[e.key][1] * k);
    }
  }
  const keyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') space = false;
  };
  // «Экспорт ▾» (ТЗ 39 §4)
  const exportable = (): Exportable => ({
    name: (path.split('/').pop() ?? path).replace(/\.canvas$/i, ''),
    file: path,
    scene: () => canvasScene(cv ?? { nodes: [], edges: [] }, cardOf, root!),
    visible: () => ({ x: -pan.x / zoom, y: -pan.y / zoom, w: vw / zoom, h: vh / zoom }),
  });
  function exportAt(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    exportMenu(exportable(), { x: r.right - 300, y: r.bottom + 4 }, root!);
  }
  onMount(() => {
    canvas.exporter = exportable;
    canvas.board = { group: () => void groupSel(), duplicate: () => void dup(), path };
    return () => {
      if (canvas.board?.path === path) canvas.board = null;
      if (canvas.exporter === exportable) canvas.exporter = null;
    };
  });

  // ---- colour: a bar over the chosen ----
  let colorBar = $state(false);
  let custom: HTMLInputElement | undefined = $state();
  const chosenColor = $derived.by(() => {
    const cs = [...[...sel].map((id) => node(id)?.color), ...(selEdge ? [cv?.edges.find((e) => e.id === selEdge)?.color] : [])];
    return cs.length && cs.every((c) => c === cs[0]) ? (cs[0] ?? '') : null;
  });
  async function paint(color: string | null) {
    if (!cv) return;
    await write('Цвет', setColor(cv, sel, selEdge ? [selEdge] : [], color));
  }
  const barAt = $derived.by(() => {
    const ns = [...sel].map((id) => byId.get(id)).filter((n): n is CNode => !!n);
    const e = selEdge ? edges.find((x) => x.e.id === selEdge) : undefined;
    const b = ns.length ? boxOf(ns) : e ? { x: e.mid[0], y: e.mid[1], width: 0, height: 0 } : null;
    if (!b) return null;
    return { x: Math.max(8, Math.min(vw - 300, pan.x + b.x * zoom)), y: Math.max(8, pan.y + b.y * zoom - 46) };
  });
  function menu(e: MouseEvent, n?: CNode) {
    e.preventDefault();
    e.stopPropagation();
    if (n && !sel.has(n.id)) choose([n.id]);
    const one = n && sel.size <= 1 ? n : undefined;
    const items = [
      ...(one?.type === 'text' ? [{ label: 'Изменить текст', run: () => startText(one.id) }] : []),
      ...(one?.type === 'file' && one.subpath ? [{ label: 'Открыть сбоку', run: () => openPeek(one) }, { label: 'Открыть в файле', run: () => openIn(one) }] : []),
      ...(one?.type === 'group' ? [{ label: 'Переименовать группу', run: () => startLabel(one.id) }] : []),
      ...(sel.size || selEdge ? [{ label: 'Цвет…', run: () => (colorBar = true) }] : []),
      ...(sel.size ? [{ label: 'Дубликат', run: () => void dup() }, { label: 'Сгруппировать', run: () => void groupSel() }] : []),
      ...(sel.size || selEdge ? ['sep' as const, { label: one?.type === 'file' && one.subpath ? 'Убрать карточку' : 'Удалить', danger: true, run: () => void removeSel() }] : []),
      ...(!n ? [{ label: 'Заметка', run: () => void addNote(toWorld(e.clientX, e.clientY)) }, { label: 'Заголовок…', run: () => void pickHeading(toWorld(e.clientX, e.clientY)) }, { label: 'Вписать', run: fit }] : []),
    ];
    if (items.length) ctx.ui.menu(items, { x: e.clientX, y: e.clientY });
  }

  // ---- a heading's card at the side: its subtree in the core's editor ----
  let peek = $state<{ node: string; ref: HeadingRef; n: number } | null>(null);
  let peekEl: HTMLDivElement | undefined = $state();
  let peekN = 0;
  let peekRef = $state<HeadingRef | null>(null);
  function openPeek(n: CNode) {
    if (n.type !== 'file') return;
    const c = cards.get(n);
    if (!c?.found || 'file' in c) return;
    peek = { node: n.id, ref: c.ref, n: ++peekN };
    peekRef = c.ref;
  }
  function closePeek() {
    peek = null;
    root?.focus({ preventScroll: true });
  }
  $effect(() => {
    const el = peekEl;
    const p = peek;
    if (!el || !p) return;
    const ed = untrack(() => ctx.ui.editor(el, p.ref, { onRef: (r) => (peekRef = r) }));
    queueMicrotask(() => ed.focus());
    return () => ed.dispose();
  });
  const peekCard = $derived.by(() => {
    const n = peek ? node(peek.node) : undefined;
    return n?.type === 'file' ? cards.get(n) : undefined;
  });
  function openIn(n: CNode) {
    if (n.type !== 'file') return;
    const c = cards.get(n);
    const at = c?.found && !('file' in c) ? c.ref : null;
    void ctx.commands.run('file.open', { path: at?.path ?? n.file, line: at?.line ?? 0, beside: true });
  }
  async function peekStatus(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ref = peekRef;
    const c = peekCard;
    if (!ref || !c?.found || 'file' in c) return;
    const wf = await ctx.index!.workflow(ref.path);
    const states = wf.sets.find((s) => s.states.some((x) => x.name === c.keyword))?.states.map((x) => x.name) ?? [...wf.open, ...wf.done];
    ctx.ui.menu(states.map((s) => ({ label: s, checked: s === c.keyword, run: () => void canvas.tx('Статус', (tx) => tx.setStatus(ref, s)) })), { x: r.left, y: r.bottom + 4 });
  }
  function peekKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePeek();
    }
  }
  async function rebind(n: FileNode) {
    const p = await ctx.ui.pickPlace({ kind: 'heading', title: 'Найти заголовок' });
    if (!p || !('line' in p) || !cv) return;
    let orgId: string | null = null;
    await ctx.edit!.transaction('ID заголовка', (tx) => {
      orgId = tx.ensureId(p);
    });
    await write('Карточка заголовка', patchNode(cv, n.id, { file: p.path, subpath: '#' + p.title, ...(orgId ? { orgId } : {}) } as never));
  }

  // ---- drawing ----
  function look(n: CNode) {
    const c = colorOf(n.color);
    if (!c) return '';
    if (n.type === 'group') return `--bd:${c};--fill:color-mix(in srgb, ${c} 6%, transparent);--gl:${c};`;
    // a yellow note: the note's own paper
    if (n.type === 'text' && n.color === '3') return '--bd:var(--cv-note-bd);--fill:var(--cv-note);';
    return `--bd:${c};--fill:color-mix(in srgb, ${c} 16%, var(--bg));`;
  }
  const host = (url: string) => {
    try {
      const u = new URL(url);
      return { host: u.host, path: (u.pathname + u.search).replace(/\/$/, '') || '/' };
    } catch {
      return { host: url, path: '' };
    }
  };
  const cardOf = (n: CNode): Card | undefined => (n.type === 'file' && (n.subpath || n.orgId || /\.(org|md)$/i.test(n.file)) ? cards.get(n) : undefined);
  const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
  const edgeColor = (e: CEdge) => colorOf(e.color) ?? 'var(--cv-wire)';
  const hints = [
    { t: 'Заметка', key: 'S', icon: 'M4 3h9l3 3v11H4zM7 8h6M7 11h6', run: () => void addNote() },
    { t: 'Заголовок…', icon: 'M4 5h12M4 10h8M4 15h10', run: () => void pickHeading() },
    { t: 'Файл…', icon: 'M5 2.5h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z', run: () => void pickFile() },
    { t: 'Ссылка', icon: 'M8 12l4-4M7 9l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2M13 11l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2', run: () => void askLink() },
    { t: 'Группа', icon: 'M3 4h14v12H3z', run: () => void addGroup() },
  ];
  let hover = $state<string | null>(null);

  // ---- S: a shape that follows the pointer, put down with a click; A: an arrow by two clicks ----
  type Mode =
    | { kind: 'shape'; x: number; y: number }
    | { kind: 'arrow'; x: number; y: number; from: { id: string; side: Side } | null; over: { id: string; side: Side } | null };
  let mode = $state<Mode | null>(null);
  /** Where the pointer was last over the stage (the canvas's coordinates): a shape appears there. */
  let pointer: { x: number; y: number } | null = null;
  const SHAPE = { w: 250, h: 66 };
  function startMode(kind: 'shape' | 'arrow') {
    if (editing) void commitText();
    colorBar = false;
    const p = pointer ?? centre();
    mode = kind === 'shape' ? { kind, x: p.x, y: p.y } : { kind, x: p.x, y: p.y, from: null, over: null };
  }
  /** The node under a point of the window and its side nearest it. */
  function overAt(cx: number, cy: number, not?: string): { id: string; side: Side } | null {
    const el = (document.elementsFromPoint(cx, cy) as HTMLElement[]).find((t) => t.dataset?.id && t.dataset.id !== not);
    const n = el ? node(el.dataset.id!) : undefined;
    if (!n) return null;
    const w = toWorld(cx, cy);
    return { id: n.id, side: nearestSide(n, w.x, w.y) };
  }
  function modeMove(e: PointerEvent) {
    const m = mode;
    if (!m) return;
    const w = toWorld(e.clientX, e.clientY);
    pointer = w;
    if (m.kind === 'shape') mode = { ...m, x: w.x, y: w.y };
    else mode = { ...m, x: w.x, y: w.y, over: overAt(e.clientX, e.clientY, m.from?.id) };
  }
  async function modeDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const m = mode;
    if (!m || !cv) return;
    if (e.button !== 0) return void (mode = null);
    if (m.kind === 'shape') {
      mode = null;
      const color = canvas.noteColor;
      const n = await add({ type: 'text', text: '', width: SHAPE.w, height: SHAPE.h, ...(color ? { color } : {}) } as never, { x: m.x, y: m.y }, 'Заметка');
      if (n) startText(n.id);
      return;
    }
    const o = overAt(e.clientX, e.clientY, m.from?.id);
    if (!o) return; // a click on the empty place: still choosing
    if (!m.from) return void (mode = { ...m, from: o, over: null });
    mode = null;
    const r = addEdge(cv, m.from.id, m.from.side, o.id, o.side);
    if (!r) return;
    await write('Стрелка', r.canvas);
    choose([]);
    selEdge = r.id;
  }
  /** Where a shape put now would go: its top-left on the grid. */
  const ghost = $derived(mode?.kind === 'shape' ? { x: snap(mode.x - SHAPE.w / 2, snapOn), y: snap(mode.y - SHAPE.h / 2, snapOn) } : null);
  const sidePt = (n: CNode, s: Side) => [n.x + (s === 'right' ? n.width : s === 'left' ? 0 : n.width / 2), n.y + (s === 'bottom' ? n.height : s === 'top' ? 0 : n.height / 2)];
  void tick;
  void view;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="cv" bind:this={root} tabindex="0" role="application" aria-label="Холст" onfocusin={() => (canvas.exporter = exportable)} onkeydown={keys} onkeyup={keyUp} onpaste={paste}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cv-stage" class:dropping bind:this={stageEl} bind:clientWidth={vw} bind:clientHeight={vh} use:wheel
    onpointerdown={stageDown} onpointermove={(e) => !mode && stageEl && (pointer = toWorld(e.clientX, e.clientY))} ondblclick={(e) => e.target === e.currentTarget && void addNote(toWorld(e.clientX, e.clientY))}
    oncontextmenu={(e) => menu(e)} ondragover={dragOver} ondragleave={() => (dropping = false)} ondrop={dropIn}>
    {#if broken}
      <div class="cv-broken" role="alert">Файл не читается как JSON Canvas — он не изменится, пока его не исправят</div>
    {/if}
    {#if shown}
      <div class="cv-world" style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})" style:visibility={placed ? 'visible' : 'hidden'}>
        {#each groups as n (n.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cv-group" class:sel={sel.has(n.id)} data-id={n.id} style="left:{n.x}px;top:{n.y}px;width:{n.width}px;height:{n.height}px;{look(n)}"
            onpointerdown={(e) => nodeDown(e, n)} oncontextmenu={(e) => menu(e, n)} ondblclick={(e) => (e.stopPropagation(), startLabel(n.id))}
            onpointerenter={() => (hover = n.id)} onpointerleave={() => hover === n.id && (hover = null)}>
            {#if labelEdit?.kind === 'group' && labelEdit.id === n.id}
              <input class="cv-glabel cv-in" aria-label="Подпись группы" bind:value={labelDraft} use:focusEl onkeydown={labelKeys} onblur={() => void commitLabel()} />
            {:else if n.label}
              <div class="cv-glabel">{n.label}</div>
            {/if}
            {#if sel.size === 1 && sel.has(n.id)}<div class="cv-size" role="presentation" onpointerdown={(e) => sizeDown(e, n)}></div>{/if}
          </div>
        {/each}
        <svg class="cv-wires" width="1" height="1">
          {#each edges as x (x.e.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <g class="cv-edge" class:sel={selEdge === x.e.id} role="button" tabindex="-1" aria-label={x.e.label ? `Стрелка «${x.e.label}»` : 'Стрелка'} style:--c={edgeColor(x.e)}
              onpointerdown={(e) => (e.stopPropagation(), root?.focus({ preventScroll: true }), (sel = new Set()), (selEdge = x.e.id))} ondblclick={(e) => (e.stopPropagation(), startEdgeLabel(x.e.id))} oncontextmenu={(e) => ((selEdge = x.e.id), (sel = new Set()), menu(e))}>
              <path class="hit" d={x.d} />
              <path class="line" d={x.d} />
              {#if x.e.toEnd !== 'none'}<polygon class="head" points={`${x.end[0]},${x.end[1]} ${x.end[0] - x.dir[0] * 10 - x.dir[1] * 5},${x.end[1] - x.dir[1] * 10 + x.dir[0] * 5} ${x.end[0] - x.dir[0] * 10 + x.dir[1] * 5},${x.end[1] - x.dir[1] * 10 - x.dir[0] * 5}`} />{/if}
            </g>
          {/each}
          {#if mode?.kind === 'arrow' && mode.from}
            {@const a = byId.get(mode.from.id)}
            {@const b = mode.over ? byId.get(mode.over.id) : undefined}
            {#if a}
              {@const p = sidePt(a, mode.from.side)}
              {@const q = b && mode.over ? sidePt(b, mode.over.side) : [mode.x, mode.y]}
              <path class="cv-linking" d={`M${p[0]} ${p[1]} L${q[0]} ${q[1]}`} />
            {/if}
          {/if}
          {#if g?.kind === 'link'}
            {@const a = byId.get(g.from)}
            {#if a}<path class="cv-linking" d={`M${a.x + (g.side === 'right' ? a.width : g.side === 'left' ? 0 : a.width / 2)} ${a.y + (g.side === 'bottom' ? a.height : g.side === 'top' ? 0 : a.height / 2)} L${g.x} ${g.y}`} />{/if}
          {/if}
        </svg>
        {#each edges as x (x.e.id)}
          {#if labelEdit?.kind === 'edge' && labelEdit.id === x.e.id}
            <input class="cv-elabel cv-in" aria-label="Подпись стрелки" style:left="{x.mid[0]}px" style:top="{x.mid[1]}px" bind:value={labelDraft} use:focusEl onkeydown={labelKeys} onblur={() => void commitLabel()} />
          {:else if x.e.label}
            <div class="cv-elabel" style:left="{x.mid[0]}px" style:top="{x.mid[1]}px">{x.e.label}</div>
          {/if}
        {/each}
        {#each others as n (n.id)}
          {@const c = cardOf(n)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cv-node {n.type}" class:sel={sel.has(n.id)} class:gone={c && !c.found} data-id={n.id} style="left:{n.x}px;top:{n.y}px;width:{n.width}px;height:{n.height}px;{look(n)}"
            onpointerdown={(e) => nodeDown(e, n)} oncontextmenu={(e) => menu(e, n)}
            ondblclick={(e) => (e.stopPropagation(), n.type === 'text' ? startText(n.id) : n.type === 'file' && n.subpath ? openPeek(n) : n.type === 'link' ? window.open(n.url) : openIn(n))}
            onpointerenter={() => (hover = n.id)} onpointerleave={() => hover === n.id && (hover = null)}>
            {#if n.type === 'text'}
              {#if editing === n.id}
                <textarea class="cv-text cv-in" aria-label="Текст заметки" bind:value={draft} use:focusEl onkeydown={textKeys} onblur={() => void commitText()}></textarea>
              {:else}
                <div class="cv-text">{n.text}</div>
              {/if}
            {:else if n.type === 'link'}
              {@const u = host(n.url)}
              <div class="cv-src"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 12l4-4M7 9l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2M13 11l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2" /></svg><span>{u.host}</span></div>
              <div class="cv-t">{u.path === '/' ? u.host : u.path}</div>
              <div class="cv-body">ссылка</div>
            {:else if n.type === 'file' && c?.found && 'file' in c}
              <div class="cv-src"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM11 2.5v4h4" /></svg><span>{n.file}</span></div>
              <div class="cv-t">{c.title}</div>
              <div class="cv-body">{c.lines.join('\n') || 'файл целиком'}</div>
            {:else if n.type === 'file' && c?.found}
              <div class="cv-src"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM11 2.5v4h4" /></svg><span>{c.where}</span></div>
              <div class="cv-row">
                {#if c.keyword}<span class="cv-kw" style:--c={canvas.tone(c.keyword, c.ref.path)}>{c.keyword}</span>{/if}
                <span class="cv-t">{@html titleHtml(c.title.replace(/\s*<[^>]*>/g, ""))}</span>
              </div>
              {#if c.lines.length || c.check || c.date}<div class="cv-body">{[...c.lines, [c.check, c.date].filter(Boolean).join(' · ')].filter(Boolean).join('\n')}</div>{/if}
              {#if c.tags.length}<div class="cv-tags">:{c.tags.join(':')}:</div>{/if}
            {:else if n.type === 'file' && c}
              <div class="cv-src"><span>{n.file}{n.subpath ? ' › ' + subTitle(n.subpath) : ''}</span></div>
              <div class="cv-t">{n.subpath ? 'Заголовок не найден' : 'Файл не найден'}</div>
              <div class="cv-acts">
                {#if n.subpath}<button onclick={() => void rebind(n)}>Найти…</button>{/if}
                <button onclick={() => cv && void write('Убрать карточку', remove(cv, [n.id]))}>Убрать</button>
              </div>
            {:else if n.type === 'file'}
              <div class="cv-src"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM11 2.5v4h4" /></svg><span>{n.file.split('/').slice(0, -1).join('/') || 'файл'}</span></div>
              <div class="cv-t">{n.file.split('/').pop()}</div>
            {/if}
            {#if mode?.kind === 'arrow'}
              {#each SIDES as s (s)}<div class="cv-dot {s}" class:on={(mode.from?.id === n.id && mode.from.side === s) || (mode.over?.id === n.id && mode.over.side === s)} role="presentation"></div>{/each}
            {:else if (hover === n.id || sel.has(n.id)) && !g && editing !== n.id && !mode}
              {#each SIDES as s (s)}<div class="cv-dot {s}" role="presentation" title="Потяните к другой карточке — стрелка" onpointerdown={(e) => dotDown(e, n, s)}></div>{/each}
            {/if}
            {#if sel.size === 1 && sel.has(n.id)}<div class="cv-size" role="presentation" onpointerdown={(e) => sizeDown(e, n)}></div>{/if}
          </div>
        {/each}
        {#if ghost}
          <div class="cv-node text cv-ghost" style="left:{ghost.x}px;top:{ghost.y}px;width:{SHAPE.w}px;height:{SHAPE.h}px;{canvas.noteColor ? look({ type: 'text', color: canvas.noteColor } as CNode) : ''}" aria-hidden="true"></div>
        {/if}
        {#if g?.kind === 'frame'}
          {@const r = frameRect(g)}
          <div class="cv-frame" style="left:{r.x}px;top:{r.y}px;width:{r.width}px;height:{r.height}px"></div>
        {/if}
      </div>
    {/if}
    {#if mode}
      <!-- the place's clicks while a shape or an arrow is being put -->
      <div class="cv-modelayer" class:arrow={mode.kind === 'arrow'} role="presentation" onpointermove={modeMove} onpointerdown={(e) => void modeDown(e)} oncontextmenu={(e) => (e.preventDefault(), (mode = null))}></div>
    {/if}
  </div>

  <div class="cv-tools" role="toolbar" aria-label="Масштаб">
    <button aria-label="Уменьшить" title="Уменьшить ⌘−" onclick={() => zoomAt(1 / 1.2)}>−</button>
    <button class="cv-z" title="100%" onclick={() => zoomAt(1 / zoom)}>{Math.round(zoom * 100)}%</button>
    <button aria-label="Увеличить" title="Увеличить ⌘+" onclick={() => zoomAt(1.2)}>+</button>
    <button title="Вписать ⇧1" onclick={fit}>Вписать</button>
    <button class="cv-exp" aria-haspopup="menu" onclick={exportAt}>Экспорт ▾</button>
  </div>

  {#if colorBar && barAt}
    <div class="cv-colors" role="toolbar" aria-label="Цвет" style:left="{barAt.x}px" style:top="{barAt.y}px">
      <span class="cv-cl">Цвет</span>
      <button class="cv-sw none" class:on={chosenColor === ''} title="Без цвета" aria-label="Без цвета" onclick={() => void paint(null)}>⊘</button>
      {#each PALETTE as c (c.canvas)}
        <button class="cv-sw" class:on={chosenColor === c.canvas} style:background={c.hex} title={c.label} aria-label={c.label} onclick={() => void paint(c.canvas)}></button>
      {/each}
      <span class="cv-sep"></span>
      <button class="cv-own" onclick={() => custom?.click()}>Свой…</button>
      <input class="cv-pick" type="color" bind:this={custom} value={colorOf(chosenColor) ?? '#0a64d6'} onchange={(e) => void paint((e.currentTarget as HTMLInputElement).value.toLowerCase())} tabindex="-1" aria-hidden="true" />
    </div>
    <div class="cv-hint cv-note">Цвет карточки, группы или стрелки — «color» в JSON Canvas: 6 цветов как в Obsidian или свой</div>
  {:else if mode}
    <div class="cv-hint cv-note" role="status">
      {mode.kind === 'shape' ? 'Кликните, чтобы положить фигуру' : mode.from ? 'Кликните вторую фигуру — стрелка к ней' : 'Кликните фигуру у точки, откуда пойдёт стрелка'} · ⎋ отмена
    </div>
  {:else if !peek}
    <div class="cv-hint cv-add" role="toolbar" aria-label="Добавить на холст">
      {#each hints as h (h.t)}
        <button onclick={h.run} title={h.key ? `${h.t.replace('…', '')} — ${h.key}` : undefined}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={h.icon} /></svg>{h.t}</button>
      {/each}
    </div>
  {/if}

  {#if peek}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="cv-peek" role="dialog" aria-label="Карточка заголовка" tabindex="-1" onkeydown={peekKeys}>
      <div class="cv-ph">
        {#if peekCard?.found && !('file' in peekCard) && peekCard.keyword}<button class="cv-kw cv-pk" style:--c={canvas.tone(peekCard.keyword, peekCard.ref.path)} title="Сменить статус" onclick={peekStatus}>{peekCard.keyword} ▾</button>{/if}
        <span class="cv-pt">{peekRef?.title ?? ''}</span>
        <button class="cv-pl" onclick={() => { const n = node(peek!.node); if (n) openIn(n); }}>В файле ›</button>
        <button class="cv-px" aria-label="Закрыть" title="Закрыть" onclick={closePeek}>×</button>
      </div>
      <div class="cv-plate">Карточка из <code>{peekRef?.path}</code> — правки сразу идут в файл</div>
      <div class="cv-pb" bind:this={peekEl}></div>
    </div>
  {/if}
</div>

<style>
  .cv { --cv-wire: color-mix(in srgb, var(--fg) 45%, var(--stage)); --cv-note: color-mix(in srgb, #f0c000 17%, var(--bg)); --cv-note-bd: color-mix(in srgb, #d9b000 50%, var(--bg)); position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--stage); color: var(--fg); font: 13px var(--ui); outline: none; }
  .cv-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background-image: radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px); background-size: 22px 22px; }
  .cv-stage.dropping { box-shadow: inset 0 0 0 2px var(--acc); }
  .cv-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .cv-broken { position: absolute; left: 50%; top: 40%; transform: translateX(-50%); z-index: 2; padding: 10px 14px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); color: var(--fg2); }

  .cv-group { position: absolute; box-sizing: border-box; border-radius: 14px; border: 1.5px solid var(--bd, var(--line)); background: var(--fill, color-mix(in srgb, var(--fg) 3%, transparent)); }
  .cv-group.sel { outline: 2px solid var(--acc); outline-offset: 2px; }
  .cv-glabel { position: absolute; left: 14px; top: 10px; font-size: 12.5px; font-weight: 700; color: var(--gl, var(--fg2)); white-space: nowrap; }
  input.cv-glabel { width: 220px; padding: 1px 4px; border: 1px solid var(--acc); border-radius: 4px; background: var(--bg); color: var(--fg); font: 700 12.5px var(--ui); outline: none; }

  .cv-wires { position: absolute; left: 0; top: 0; overflow: visible; }
  .cv-edge .hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }
  .cv-edge .line { fill: none; stroke: var(--c); stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
  .cv-edge .head { fill: var(--c); pointer-events: none; }
  .cv-edge.sel .line { stroke-width: 2.6; }
  .cv-linking { fill: none; stroke: var(--acc); stroke-width: 1.6; stroke-dasharray: 5 4; }
  .cv-elabel { position: absolute; transform: translate(-50%, -50%); padding: 1px 7px; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); font-size: 11.5px; color: var(--fg2); white-space: nowrap; }
  input.cv-elabel { width: 160px; color: var(--fg); font: 11.5px var(--ui); outline: 1px solid var(--acc); }

  .cv-node { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; padding: 10px 12px; border-radius: 10px; background: var(--fill, var(--bg)); border: 1px solid var(--bd, var(--line)); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); overflow: visible; user-select: none; -webkit-user-select: none; }
  .cv-node.text { border-radius: 6px; }
  .cv-node.sel { outline: 2px solid var(--acc); outline-offset: -1px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--acc) 16%, transparent); }
  .cv-node.gone { opacity: 0.7; background: var(--side, var(--bg)); border-style: dashed; }
  .cv-text { flex: 1; min-height: 0; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; font-weight: 500; }
  textarea.cv-text { margin: 0; padding: 0; border: 0; outline: none; resize: none; background: none; color: inherit; font: 500 13px/1.4 var(--ui); }
  .cv-src { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; color: var(--fg3); }
  .cv-src span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-src svg, .cv-add svg { flex: 0 0 auto; width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .cv-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cv-t { font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .cv-t :global(code) { font: 0.92em var(--mono); }
  .cv-body { min-height: 0; overflow: hidden; font-size: 12px; line-height: 1.45; color: var(--fg2); white-space: pre-line; }
  .cv-tags { font: 11px var(--mono); color: var(--tagfg); }
  .cv-kw { flex: 0 0 auto; padding: 1px 5px; border-radius: 4px; border: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
  .cv-acts { display: flex; gap: 6px; }
  .cv-acts button { padding: 2px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--fg); font: 12px var(--ui); }
  .cv-dot { position: absolute; z-index: 2; width: 10px; height: 10px; box-sizing: border-box; border-radius: 50%; background: var(--bg); border: 2px solid var(--acc); cursor: crosshair; }
  .cv-dot.top { left: calc(50% - 5px); top: -6px; }
  .cv-dot.bottom { left: calc(50% - 5px); bottom: -6px; }
  .cv-dot.left { left: -6px; top: calc(50% - 5px); }
  .cv-dot.right { right: -6px; top: calc(50% - 5px); }
  .cv-size { position: absolute; z-index: 2; right: -5px; bottom: -5px; width: 10px; height: 10px; border-radius: 2px; background: var(--acc); cursor: nwse-resize; }
  .cv-ghost { opacity: 0.6; pointer-events: none; border-style: dashed; }
  .cv-modelayer { position: absolute; inset: 0; z-index: 2; cursor: copy; }
  .cv-modelayer.arrow { cursor: crosshair; }
  .cv-dot.on { background: var(--acc); transform: scale(1.3); }
  .cv-frame { position: absolute; border: 1px solid var(--acc); background: color-mix(in srgb, var(--acc) 8%, transparent); pointer-events: none; }

  .cv-tools { position: absolute; top: 12px; right: 14px; z-index: 3; display: flex; align-items: center; gap: 6px; }
  .cv-tools button { height: 24px; min-width: 26px; padding: 0 8px; border: 0; border-radius: 5px; background: var(--field); color: var(--fg2); font: 12px var(--ui); }
  .cv-tools .cv-z { min-width: 48px; background: none; }
  .cv-tools .cv-exp { margin-left: 6px; font-weight: 600; color: var(--fg); }
  .cv-hint { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; max-width: calc(100% - 32px); box-sizing: border-box; white-space: nowrap; overflow: hidden; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1); }
  .cv-add { display: flex; align-items: center; gap: 4px; padding: 4px; }
  .cv-add button { height: 30px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: var(--fg); font: 12.5px var(--ui); }
  .cv-add button:hover { background: var(--field); }
  .cv-add svg { width: 14px; height: 14px; stroke-width: 1.6; }
  .cv-note { padding: 7px 12px; font-size: 12px; color: var(--fg2); }
  .cv-colors { position: absolute; z-index: 6; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); white-space: nowrap; }
  .cv-cl { margin-right: 2px; font-size: 12px; color: var(--fg2); }
  .cv-sw { width: 20px; height: 20px; padding: 0; box-sizing: border-box; border: 0; border-radius: 10px; font-size: 11px; color: var(--fg3); }
  .cv-sw.none { background: transparent; border: 1px solid var(--line); }
  .cv-sw.on { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--acc); }
  .cv-sep { width: 1px; height: 18px; margin: 0 2px; background: var(--line); }
  .cv-own { padding: 0; border: 0; background: none; font: 12px var(--ui); color: var(--acc); }
  .cv-pick { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }

  .cv-peek { position: absolute; z-index: 7; right: 0; top: 0; bottom: 0; width: 430px; max-width: 100%; box-sizing: border-box; display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--line); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.14); outline: none; }
  .cv-ph { flex: 0 0 44px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); }
  .cv-pk { cursor: default; }
  .cv-pt { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-pl { border: 0; background: none; padding: 0; font: 12px var(--ui); color: var(--acc); }
  .cv-px { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--fg2); font-size: 16px; }
  .cv-plate { padding: 8px 16px; background: var(--side, var(--field)); border-bottom: 1px solid var(--line); font-size: 12px; color: var(--fg2); }
  .cv-plate code { font: 11.5px var(--mono); }
  .cv-pb { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .cv-pb > :global(*) { flex: 1; min-height: 0; }
</style>

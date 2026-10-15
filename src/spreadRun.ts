// «Разложить на холсте…» (ТЗ 39 §3): a heading and its children as live cards on a new canvas (named as the heading)
// or on one there is, to the right of what it holds; their :ID: written in one step. Then the canvas opens.

import type { HeadingRef } from '@panopticon/api';
import { canvas } from './state.svelte';
import { spread, type Spread } from './board';
import { boxOf, EMPTY, parseCanvas, writeCanvas } from './jsoncanvas';

export async function spreadOnCanvas(ref: HeadingRef) {
  const ctx = canvas.ctx;
  const outline = await ctx.index!.outline(ref.path);
  const i = outline.findIndex((h) => h.ref.line === ref.line) >= 0 ? outline.findIndex((h) => h.ref.line === ref.line) : outline.findIndex((h) => h.title === ref.title);
  if (i < 0) return ctx.ui.notify('Заголовок не найден');
  const top = outline[i];
  const sub = [top, ...outline.slice(i + 1).filter((_, j, all) => all.slice(0, j + 1).every((h) => h.level > top.level))];
  const heads = sub.filter((h) => h.level - top.level <= canvas.spreadLevels);
  // where: a new canvas, or one there is
  const files = (await ctx.index!.files()).filter((f) => /\.canvas$/i.test(f.path));
  const choice = await ctx.ui.choose({
    title: 'Разложить на холсте',
    placeholder: 'Новый холст или один из этих',
    items: [{ id: '', label: `Новый холст «${top.title}»`, hint: `${heads.length} карточек, ${canvas.spreadLevels} ур.` }, ...files.map((f) => ({ id: f.path, label: f.title, hint: f.path }))],
  });
  if (choice === null) return;
  // the :ID: of each heading, in one step
  const ids: (string | null)[] = [];
  const ok = await ctx.edit!.transaction('ID заголовков', (tx) => {
    for (const h of heads) ids.push(tx.ensureId(h.ref));
  });
  if (ok !== 'ok') return ctx.ui.notify('Не удалось записать ID заголовков');
  const items: Spread[] = heads.map((h, k) => ({ path: h.ref.path, title: h.title, level: h.level, id: ids[k], color: h.properties.COLOR ?? null }));
  let path = choice;
  if (!path) {
    const dir = ref.path.includes('/') ? ref.path.slice(0, ref.path.lastIndexOf('/') + 1) : '';
    const name = top.title.replace(/[/\\:]/g, '-').replace(/\s*<[^>]*>/g, '').trim() || 'Холст';
    const taken = new Set(files.map((f) => f.path));
    path = `${dir}${name}.canvas`;
    for (let n = 2; taken.has(path); n++) path = `${dir}${name} ${n}.canvas`;
    if (!(await ctx.edit!.ensureFile(path))) return;
  }
  const text = await ctx.files!.read(path);
  const cv = parseCanvas(text || EMPTY);
  if (!cv) return ctx.ui.notify('Холст не читается как JSON Canvas — карточки не добавлены');
  const at = cv.nodes.length ? (({ x, y, width }) => ({ x: x + width + 120, y }))(boxOf(cv.nodes)) : { x: 0, y: 0 };
  const r = spread(items, canvas.spreadLevels, at);
  const next = writeCanvas({ ...cv, nodes: [...cv.nodes, ...r.nodes], edges: [...cv.edges, ...r.edges] });
  await canvas.tx('Разложить на холсте', (tx) => tx.update(path, () => next));
  await ctx.commands.run('file.open', { path });
}

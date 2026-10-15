// «Экспорт ▾» of a canvas and of a mindmap (ТЗ 39 §4): a file for Excalidraw, Excalidraw's clipboard, PNG and SVG —
// what is shown, made into a scene with the theme's colours as they are now.

import { canvas } from './state.svelte';
import { boundsOf, cropped, excalidrawClipboard, excalidrawFile, svgOf, type Measure, type Scene } from './scene';

export interface Exportable {
  /** The name offered: the canvas's or the file's. */
  name: string;
  /** The scene: everything, or only the visible part. */
  scene(): Scene;
  visible(): { x: number; y: number; w: number; h: number };
  /** A canvas: its file (for «Показать в Finder»). */
  file?: string;
}

// ---- the theme's colours as plain values (Excalidraw and a picture know no CSS variables) ----
let probe: HTMLElement | null = null;
let pen: CanvasRenderingContext2D | null = null;
/** A CSS colour (var(), color-mix()) as #rrggbb (or rgba() when it is see-through), as the element `at` sees it. */
export function solid(css: string, at: Element): string {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.display = 'none';
  }
  at.appendChild(probe);
  probe.style.color = '';
  probe.style.color = css;
  const c = getComputedStyle(probe).color;
  probe.remove();
  pen ??= document.createElement('canvas').getContext('2d');
  if (!pen) return c;
  pen.fillStyle = '#000';
  pen.fillStyle = c;
  return String(pen.fillStyle);
}
let ruler: CanvasRenderingContext2D | null = null;
export const measure =
  (font: string): Measure =>
  (text, size, weight) => {
    ruler ??= document.createElement('canvas').getContext('2d');
    if (!ruler) return text.length * size * 0.55;
    ruler.font = `${weight} ${size}px ${font}`;
    return ruler.measureText(text).width;
  };
export const uiFont = (at: Element) => getComputedStyle(at).getPropertyValue('--ui').trim() || '-apple-system, system-ui, sans-serif';

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** An SVG drawn at twice its size into a PNG (base64). */
async function pngOf(svg: string, w: number, h: number): Promise<string> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('the picture is not drawn'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * 2);
    c.height = Math.ceil(h * 2);
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('no PNG');
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** All of it or the visible part: asked when they differ. */
async function part(x: Exportable, what: string): Promise<Scene | null> {
  const all = x.scene();
  const seen = cropped(all, x.visible());
  if (seen.boxes.length === all.boxes.length) return all;
  const v = await canvas.ctx.ui.form({
    title: what,
    submit: 'Сохранить…',
    initial: { part: 'all' },
    groups: [{ fields: [{ type: 'choice', key: 'part', label: 'Что сохранить', look: 'segments', options: [{ value: 'all', label: 'Всё' }, { value: 'seen', label: 'Видимую часть' }] }], help: 'Фон — как в теме сейчас, масштаб PNG — 2×' }],
  });
  if (!v) return null;
  return v.part === 'seen' ? seen : all;
}

export async function exportExcalidraw(x: Exportable) {
  const path = await canvas.ctx.ui.saveFile({ name: `${x.name}.excalidraw`, title: 'Экспорт в Excalidraw', filter: { name: 'Excalidraw', extensions: ['excalidraw'] }, text: excalidrawFile(x.scene()) });
  if (path) canvas.ctx.ui.notify(`Сохранено: ${path.split('/').pop()} — откройте его на excalidraw.com`);
}
export async function copyExcalidraw(x: Exportable) {
  if (!canvas.ctx.clipboard) return;
  await canvas.ctx.clipboard.write(excalidrawClipboard(x.scene()));
  canvas.ctx.ui.notify('Скопировано для Excalidraw — вставьте в открытую доску ⌘V');
}
export async function exportPicture(x: Exportable, kind: 'png' | 'svg', at: Element) {
  const s = await part(x, kind === 'png' ? 'Экспорт в PNG' : 'Экспорт в SVG');
  if (!s) return;
  const svg = svgOf(s, measure(s.font));
  const b = boundsOf(s, 24);
  void at;
  const path =
    kind === 'svg'
      ? await canvas.ctx.ui.saveFile({ name: `${x.name}.svg`, title: 'Экспорт в SVG', filter: { name: 'SVG', extensions: ['svg'] }, text: svg })
      : await canvas.ctx.ui.saveFile({ name: `${x.name}.png`, title: 'Экспорт в PNG', filter: { name: 'PNG', extensions: ['png'] }, base64: await pngOf(svg, b.w, b.h) });
  if (path) canvas.ctx.ui.notify(`Сохранено: ${path.split('/').pop()}`);
}

/** «Экспорт ▾»: the menu under the button. */
export function exportMenu(x: Exportable, at: { x: number; y: number }, el: Element) {
  const ctx = canvas.ctx;
  ctx.ui.menu(
    [
      { label: 'Excalidraw — файл .excalidraw…', hint: 'карточки, цвета, стрелки и группы; открыть на excalidraw.com', run: () => void exportExcalidraw(x) },
      { label: 'Копировать для Excalidraw', hint: 'вставить в открытую доску ⌘V', run: () => void copyExcalidraw(x) },
      'sep',
      { label: 'PNG…', run: () => void exportPicture(x, 'png', el) },
      { label: 'SVG…', run: () => void exportPicture(x, 'svg', el) },
      ...(x.file ? ['sep' as const, { label: 'Показать файл .canvas в Finder', hint: 'это и есть JSON Canvas — открывается в Obsidian', run: () => void ctx.commands.run('file.reveal', { path: x.file }) }] : []),
    ],
    at,
  );
}

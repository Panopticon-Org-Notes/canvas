// «Холст» (ТЗ 39): the mindmap of an Org file or of one heading's branch — another view of the same file, its format
// untouched. An outside plugin: it sees the app only through `ctx` (API 1.9).
import { definePlugin } from '@panopticon/api';
import { mount, unmount } from 'svelte';
import { BOARD, canvas, VIEW } from './state.svelte';
import Mindmap from './Mindmap.svelte';
import CanvasView from './CanvasView.svelte';
import { EMPTY } from './jsoncanvas';
import { copyExcalidraw, exportExcalidraw } from './exporting';
import { spreadOnCanvas } from './spreadRun';

export default definePlugin({
  activate(ctx) {
    canvas.init(ctx);

    // «Показать как › Mindmap» of a file tab; a tab of one branch gets its heading
    ctx.ui.fileView(VIEW, {
      render: (el, file, view) => {
        const app = mount(Mindmap, { target: el, props: { path: file.path, heading: file.heading, view } });
        return () => void unmount(app);
      },
    });
    // a `.canvas` file (its type in the manifest): the free canvas
    ctx.ui.fileView(BOARD, {
      render: (el, file, view) => {
        const app = mount(CanvasView, { target: el, props: { path: file.path, view } });
        return () => void unmount(app);
      },
    });
    ctx.commands.on('canvas.new', async () => {
      const v = await ctx.ui.form({
        title: 'Новый холст',
        submit: 'Создать',
        groups: [{ fields: [{ type: 'text', key: 'name', label: 'Название', placeholder: 'Холст' }] }],
        validate: (x) => (String(x.name ?? '').trim() && !/[/\\:]/.test(String(x.name)) ? null : 'Нужно название без «/» и «:»'),
      });
      if (!v) return;
      const dir = canvas.active.path?.includes('/') ? canvas.active.path.slice(0, canvas.active.path.lastIndexOf('/') + 1) : '';
      const path = `${dir}${String(v.name).trim().replace(/\.canvas$/i, '')}.canvas`;
      if (!(await ctx.edit!.ensureFile(path))) return;
      await ctx.edit!.transaction('Новый холст', (tx) => tx.update(path, (t) => (t.trim() ? null : EMPTY)));
      await ctx.commands.run('file.open', { path });
    });
    // the export of the map or the canvas shown (ТЗ 39 §4)
    ctx.commands.on('canvas.exportExcalidraw', () => {
      const x = canvas.exporter?.();
      if (x) void exportExcalidraw(x);
      else ctx.ui.notify('Откройте mindmap или холст, чтобы экспортировать его');
    });
    ctx.commands.on('canvas.copyExcalidraw', () => {
      const x = canvas.exporter?.();
      if (x) void copyExcalidraw(x);
      else ctx.ui.notify('Откройте mindmap или холст, чтобы скопировать его');
    });
    ctx.commands.on('canvas.group', () => canvas.board?.group());
    ctx.commands.on('canvas.duplicate', () => canvas.board?.duplicate());

    const branch = (h: { path: string; line: number; title: string }) => void ctx.ui.openFileView(VIEW, { path: h.path, heading: h });
    // the menu of a heading in the editor and the navigator
    ctx.ui.headingAction({ label: 'Показать ветку как mindmap', run: branch });
    ctx.ui.headingAction({ label: 'Разложить на холсте…', run: (h) => void spreadOnCanvas(h) });
    ctx.commands.on('canvas.spread', () => {
      const h = ctx.ui.currentHeading();
      if (h) void spreadOnCanvas(h);
      else ctx.ui.notify('Поставьте курсор на заголовок, чтобы разложить его на холсте');
    });

    ctx.commands.on('canvas.mindmap', async () => {
      if (!(await ctx.ui.showAs(VIEW))) ctx.ui.notify('Откройте org-файл, чтобы показать его как mindmap');
    });
    ctx.commands.on('canvas.mindmapBranch', () => {
      const h = ctx.ui.currentHeading();
      if (h) branch(h);
      else ctx.ui.notify('Поставьте курсор на заголовок, чтобы показать его ветку как mindmap');
    });
  },
});

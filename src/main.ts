// «Холст» (ТЗ 39): the mindmap of an Org file or of one heading's branch — another view of the same file, its format
// untouched. An outside plugin: it sees the app only through `ctx` (API 1.9).
import { definePlugin } from '@panopticon/api';
import { mount, unmount } from 'svelte';
import { canvas, VIEW } from './state.svelte';
import Mindmap from './Mindmap.svelte';

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
    const branch = (h: { path: string; line: number; title: string }) => void ctx.ui.openFileView(VIEW, { path: h.path, heading: h });
    // the menu of a heading in the editor and the navigator
    ctx.ui.headingAction({ label: 'Показать ветку как mindmap', run: branch });

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

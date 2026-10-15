// The scenes to export (ТЗ 39 §4): of a canvas — its groups as frames, its cards as rectangles with their text as it
// is now (a snapshot), its arrows; of a mindmap — its nodes and the lines between them, without heads.

import { colorOf } from './colors';
import { edgePath, groupsOf, type Canvas, type CNode } from './jsoncanvas';
import type { Layout } from './layout';
import { solid, uiFont } from './exporting';
import type { Card } from './cards.svelte';
import type { Arrow, Box, Line, Scene } from './scene';

const plain = (t: string) => t.replace(/\s*<[^>]*>/g, '').replace(/\[\[(?:[^\]]+)\]\[([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1');

/** The theme's colours now, plain. */
function theme(el: Element) {
  const c = (v: string) => solid(v, el);
  return { bg: c('var(--bg)'), stage: c('var(--stage)'), fg: c('var(--fg)'), fg2: c('var(--fg2)'), fg3: c('var(--fg3)'), line: c('var(--line)'), acc: c('var(--acc)'), onacc: c('var(--onacc)'), tag: c('var(--tagfg)'), c, font: uiFont(el) };
}

export function canvasScene(cv: Canvas, cardOf: (n: CNode) => Card | undefined, el: Element): Scene {
  const t = theme(el);
  const boxes: Box[] = [];
  for (const n of cv.nodes) {
    const col = colorOf(n.color);
    const inside = groupsOf(cv, n)[0]?.id;
    const box = (lines: Line[], o: Partial<Box> = {}): Box => ({
      id: n.id, x: n.x, y: n.y, w: n.width, h: n.height, lines, radius: 10, ...(inside ? { in: inside } : {}),
      stroke: col ?? t.line, fill: col ? t.c(`color-mix(in srgb, ${col} 16%, var(--bg))`) : t.bg, ...o,
    });
    if (n.type === 'group') {
      boxes.push(box([{ text: n.label ?? '', size: 12.5, weight: 700, color: col ?? t.fg2 }], { frame: true, radius: 14, strokeWidth: 1.5, fill: col ? t.c(`color-mix(in srgb, ${col} 6%, var(--stage))`) : t.stage }));
    } else if (n.type === 'text') {
      const note = n.color === '3';
      boxes.push(box([{ text: n.text, size: 13, weight: 600 }], { radius: 6, ...(note ? { fill: t.c('color-mix(in srgb, #f0c000 17%, var(--bg))'), stroke: t.c('color-mix(in srgb, #d9b000 50%, var(--bg))') } : {}) }));
    } else if (n.type === 'link') {
      let host = n.url;
      let path = '';
      try {
        const u = new URL(n.url);
        host = u.host;
        path = u.pathname.replace(/\/$/, '');
      } catch {
        // as written
      }
      boxes.push(box([{ text: host, size: 11, color: t.fg3 }, { text: path || host, size: 13, weight: 700 }, { text: 'ссылка', size: 12, color: t.fg2 }], { link: n.url }));
    } else {
      const c = cardOf(n);
      if (c?.found && 'file' in c) boxes.push(box([{ text: n.file, size: 11, color: t.fg3 }, { text: c.title, size: 13, weight: 700 }, ...c.lines.map((l) => ({ text: l, size: 12, color: t.fg2 }))]));
      else if (c?.found) {
        const meta = [c.check, c.date].filter(Boolean).join(' · ');
        boxes.push(
          box(
            [
              { text: c.where, size: 11, color: t.fg3 },
              { text: (c.keyword ? c.keyword + ' ' : '') + plain(c.title), size: 13, weight: 700 },
              ...c.lines.map((l) => ({ text: l, size: 12, color: t.fg2 })),
              ...(meta ? [{ text: meta, size: 12, color: t.fg2 }] : []),
              ...(c.tags.length ? [{ text: `:${c.tags.join(':')}:`, size: 11, color: t.tag, mono: true }] : []),
            ],
            { link: n.orgId ? `id:${n.orgId}` : `${n.file}${n.subpath ?? ''}` },
          ),
        );
      } else boxes.push(box([{ text: n.file, size: 11, color: t.fg3 }, { text: (n.subpath ?? '').replace(/^#/, '') || n.file, size: 13, weight: 700 }]));
    }
  }
  const byId = new Map(cv.nodes.map((n) => [n.id, n]));
  const arrows: Arrow[] = cv.edges.flatMap((e) => {
    const a = byId.get(e.fromNode);
    const b = byId.get(e.toNode);
    if (!a || !b) return [];
    const p = edgePath(a, b, e);
    return [{ id: e.id, from: a.id, to: b.id, points: p.points, color: colorOf(e.color) ?? t.c('color-mix(in srgb, var(--fg) 45%, var(--stage))'), head: e.toEnd !== 'none', curve: true, width: 1.6, ...(e.label ? { label: e.label } : {}) }];
  });
  return { boxes, arrows, background: t.stage, ink: t.fg, font: t.font };
}

export function mindmapScene(lay: Layout, el: Element): Scene {
  const t = theme(el);
  const wire = t.c('color-mix(in srgb, var(--fg) 28%, var(--stage))');
  const boxes: Box[] = lay.order.map((p) => {
    const n = p.node;
    const b = p.box;
    if (!n.parent) return { id: n.key, x: b.x, y: b.y, w: b.w, h: b.h, lines: [{ text: plain(n.title), size: 16, weight: 700 }], radius: 14, stroke: t.acc, fill: t.acc, ink: t.onacc };
    const col = n.color;
    const lines: Line[] = [{ text: (n.keyword ? n.keyword + ' ' : '') + plain(n.title), size: 13, weight: n.depth === 1 ? 700 : 600 }];
    if (n.tags.length) lines.push({ text: `:${n.tags.join(':')}:`, size: 11, color: t.tag, mono: true });
    return {
      id: n.key, x: b.x, y: b.y, w: b.w, h: b.h, lines, radius: 10, strokeWidth: n.depth === 1 ? 1.5 : 1,
      stroke: col ?? (n.depth === 1 ? t.acc : t.line), fill: n.own && col ? t.c(`color-mix(in srgb, ${col} 14%, var(--bg))`) : t.bg,
    };
  });
  const arrows: Arrow[] = lay.edges.map((e) => {
    const f = e.from.box;
    const to = e.to.box;
    const x1 = e.side === 'right' ? f.x + f.w : f.x;
    const x2 = e.side === 'right' ? to.x : to.x + to.w;
    return {
      id: `${e.from.node.key}>${e.to.node.key}`, from: e.from.node.key, to: e.to.node.key, points: [[x1, f.y + f.h / 2], [x2, to.y + to.h / 2]],
      color: e.to.node.color ?? (e.to.node.depth === 1 ? t.acc : wire), width: e.to.node.depth === 1 ? 2 : 1.4, head: false, curve: true,
    };
  });
  return { boxes, arrows, background: t.stage, ink: t.fg, font: t.font };
}

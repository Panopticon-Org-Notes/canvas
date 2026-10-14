import { describe, expect, it } from 'vitest';
import { buildTree, fileTitle, findScope, lineTags, nodesOf, within, type Head } from '../src/tree';
import { layout, step, type Box } from '../src/layout';
import { colorOf, colorValue } from '../src/colors';
import { titleHtml } from '../src/title';

const TEXT = [
  '#+TITLE: План 2027', // 0
  '', // 1
  '* Найм :hiring:', // 2
  '** TODO SRE × 2', // 3
  '** Тимлид данных', // 4
  '* Платформа', // 5
  ':PROPERTIES:', // 6
  ':COLOR: green', // 7
  ':END:', // 8
  '** DOING Новый ДЦ :infra:', // 9
  '*** Учения', // 10
  '** Алерты v2', // 11
  '** Алерты v2', // 12
  '* Риски', // 13
  '* Процессы', // 14
  '** Ревью', // 15
];
const H = (line: number, level: number, title: string, keyword: string | null = null, properties: Record<string, string> = {}): Head => ({ line, level, title, keyword, done: false, properties });
const HEADS = [
  H(2, 1, 'Найм'),
  H(3, 2, 'SRE × 2', 'TODO'),
  H(4, 2, 'Тимлид данных'),
  H(5, 1, 'Платформа', null, { COLOR: 'green' }),
  H(9, 2, 'Новый ДЦ', 'DOING'),
  H(10, 3, 'Учения'),
  H(11, 2, 'Алерты v2'),
  H(12, 2, 'Алерты v2'),
  H(13, 1, 'Риски'),
  H(14, 1, 'Процессы'),
  H(15, 2, 'Ревью'),
];

describe('the tree', () => {
  const root = buildTree(HEADS, TEXT, fileTitle(TEXT.join('\n')) ?? 'plan');
  const by = (t: string) => nodesOf(root).find((n) => n.title === t)!;
  it('the root is the file\'s #+TITLE; the headings under their parents; how many under each', () => {
    expect(root.title).toBe('План 2027');
    expect(root.kids.map((k) => k.title)).toEqual(['Найм', 'Платформа', 'Риски', 'Процессы']);
    expect(by('Платформа').kids.map((k) => k.title)).toEqual(['Новый ДЦ', 'Алерты v2', 'Алерты v2']);
    expect(by('Платформа').size).toBe(4);
    expect(root.size).toBe(11);
  });
  it('keys by the titles from the root, the same title twice numbered', () => {
    expect(by('Учения').key).toBe('root/Платформа/Новый ДЦ/Учения');
    expect(by('Платформа').kids.map((k) => k.key)).toEqual(['root/Платформа/Новый ДЦ', 'root/Платформа/Алерты v2', 'root/Платформа/Алерты v2#1']);
  });
  it('the tags set on a heading itself; the status', () => {
    expect(by('Найм').tags).toEqual(['hiring']);
    expect(by('SRE × 2').tags).toEqual([]);
    expect(by('Новый ДЦ').tags).toEqual(['infra']);
    expect(by('Новый ДЦ').keyword).toBe('DOING');
  });
  it(':COLOR: goes down to the headings under it', () => {
    expect(by('Платформа').color).toBe('#30a46c');
    expect(by('Учения').color).toBe('#30a46c');
    expect(by('Учения').own).toBeNull();
    expect(by('Найм').color).toBeNull();
  });
  it('the branches: to the right in order until they hold half of the headings, the rest to the left', () => {
    // weights 3, 5, 1, 2 of 11: right — Найм, Платформа
    expect(root.kids.map((k) => k.side)).toEqual(['right', 'right', 'left', 'left']);
    expect(by('Учения').side).toBe('right');
    expect(by('Ревью').side).toBe('left');
  });
  it('a branch\'s tree: the heading is the root; found by its title near its line, else by the line', () => {
    const i = findScope(HEADS, { line: 6, title: 'Платформа' });
    expect(i).toBe(3);
    const t = buildTree(HEADS, TEXT, 'x', i);
    expect(t.title).toBe('Платформа');
    expect(t.line).toBe(5);
    expect(t.kids.map((k) => k.title)).toEqual(['Новый ДЦ', 'Алерты v2', 'Алерты v2']);
    expect(t.color).toBe('#30a46c');
    expect(findScope(HEADS, { line: 13, title: 'Риски (старое)' })).toBe(8);
    expect(findScope(HEADS, { line: 99, title: 'нет' })).toBe(-1);
  });
  it('within: a node under another', () => {
    expect(within(by('Учения'), by('Платформа'))).toBe(true);
    expect(within(by('Найм'), by('Платформа'))).toBe(false);
  });
  it('lineTags, fileTitle', () => {
    expect(lineTags('* A    :x:y:')).toEqual(['x', 'y']);
    expect(lineTags('* A :b')).toEqual([]);
    expect(fileTitle('* A\n#+TITLE: no')).toBeNull();
  });
});

describe('the layout', () => {
  const root = buildTree(HEADS, TEXT, 'План');
  const size = (n: { depth: number }) => (n.depth === 0 ? { w: 230, h: 52 } : { w: n.depth === 1 ? 210 : 200, h: 40 });
  const all = (n: { kids: never[] }) => n.kids;
  const lay = layout(root, all as never, size as never);
  const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  it('the root in the middle; the branches 90 to the side of it; the children 60 further', () => {
    expect(lay.placed.get('root')!.box).toEqual({ x: -115, y: -26, w: 230, h: 52 });
    expect(lay.placed.get('root/Найм')!.box.x).toBe(115 + 90);
    expect(lay.placed.get('root/Найм/SRE × 2')!.box.x).toBe(205 + 210 + 60);
    expect(lay.placed.get('root/Риски')!.box.x).toBe(-115 - 90 - 210);
  });
  it('nothing overlaps', () => {
    for (const a of lay.order) for (const b of lay.order) if (a !== b) expect(overlap(a.box, b.box), `${a.node.key} × ${b.node.key}`).toBe(false);
  });
  it('a parent is centred on its children; an edge to each node', () => {
    const p = lay.placed.get('root/Найм')!.box;
    const k1 = lay.placed.get('root/Найм/SRE × 2')!.box;
    const k2 = lay.placed.get('root/Найм/Тимлид данных')!.box;
    expect(p.y + p.h / 2).toBe((k1.y + k2.y + k2.h) / 2);
    expect(lay.edges.length).toBe(11);
  });
  it('a folded node shows no children', () => {
    const l2 = layout(root, ((n: { key: string; kids: never[] }) => (n.key === 'root/Платформа' ? [] : n.kids)) as never, size as never);
    expect(l2.placed.has('root/Платформа/Новый ДЦ')).toBe(false);
    expect(l2.order.length).toBe(8);
  });
  it('the arrow keys go by the tree and the sides', () => {
    const go = (k: string, d: 'left' | 'right' | 'up' | 'down') => step(lay, all as never, k, d);
    expect(go('root', 'right')).toMatch(/^root\/(Найм|Платформа)$/);
    expect(go('root', 'left')).toMatch(/^root\/(Риски|Процессы)$/);
    expect(go('root/Найм', 'left')).toBe('root');
    expect(go('root/Найм', 'right')).toMatch(/^root\/Найм\//);
    expect(go('root/Процессы', 'left')).toBe('root/Процессы/Ревью');
    expect(go('root/Процессы', 'right')).toBe('root');
    expect(go('root/Найм', 'down')).toBe('root/Платформа');
    expect(go('root/Платформа', 'down')).toBeNull(); // the next branch is on the other side
    expect(go('root/Риски', 'down')).toBe('root/Процессы');
  });
});

describe('colours', () => {
  it('names, Obsidian\'s numbers and hex', () => {
    expect(colorOf('green')).toBe('#30a46c');
    expect(colorOf(' Purple ')).toBe('#8e4ec6');
    expect(colorOf('3')).toBe('#e2a336');
    expect(colorOf('#AbC')).toBe('#abc');
    expect(colorOf('blue')).toBeNull();
    expect(colorOf('')).toBeNull();
    expect(colorValue('#30A46C')).toBe('green');
    expect(colorValue('#123456')).toBe('#123456');
  });
});

describe('titles', () => {
  it('inline markup, links, escaping', () => {
    expect(titleHtml('План *важно* и /курсив/')).toBe('План <b>важно</b> и <i>курсив</i>');
    expect(titleHtml('См. [[https://x.ru][вики]] <a>')).toBe('См. <span class="mm-link">вики</span> &lt;a&gt;');
    expect(titleHtml('=a*b*= и ~код~')).toBe('<code>a*b*</code> и <code>код</code>');
    expect(titleHtml('2*3*4')).toBe('2*3*4');
  });
});

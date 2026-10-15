import { describe, expect, it } from 'vitest';
import { EMPTY, edgePath, facing, groupsOf, parseCanvas, writeCanvas, type Canvas } from '../src/jsoncanvas';
import { addEdge, carried, duplicate, group, moveNodes, nearestSide, remove, setColor, snap, spread, within } from '../src/board';

const OBSIDIAN = `{
	"nodes":[
		{"id":"g1","type":"group","x":-20,"y":-40,"width":600,"height":300,"label":"Переключение","color":"5"},
		{"id":"a","type":"text","text":"Окно — после QBR","x":0,"y":0,"width":250,"height":60,"color":"3","styleAttributes":{}},
		{"id":"b","type":"file","file":"platform.org","subpath":"#Переезд в новый ДЦ","x":300,"y":0,"width":260,"height":140},
		{"id":"c","type":"link","url":"https://wiki.company.local/dc","x":700,"y":0,"width":260,"height":80},
		{"id":"d","type":"file","file":"Заметки/план.md","x":700,"y":200,"width":260,"height":80},
		{"id":"x","type":"weird"}
	],
	"edges":[
		{"id":"e1","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","toEnd":"arrow","label":"зачем"},
		{"id":"e2","fromNode":"b","toNode":"zzz"}
	],
	"metadata":{"version":"1.0"}
}`;

describe('JSON Canvas', () => {
  const c = parseCanvas(OBSIDIAN)!;
  it('reads Obsidian\'s file: the known nodes, the edges between them; unknown fields kept', () => {
    expect(c.nodes.map((n) => n.id)).toEqual(['g1', 'a', 'b', 'c', 'd']);
    expect(c.edges.map((e) => e.id)).toEqual(['e1']);
    expect(c.nodes[1]).toMatchObject({ type: 'text', text: 'Окно — после QBR', color: '3', styleAttributes: {} });
    expect(c.metadata).toEqual({ version: '1.0' });
    const again = parseCanvas(writeCanvas(c))!;
    expect(again).toEqual(c);
  });
  it('writes with two spaces of indent and a new line at the end', () => {
    expect(writeCanvas({ nodes: [], edges: [] })).toBe(EMPTY);
  });
  it('an empty text is an empty canvas; a broken one is null', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas('{"nodes": [')).toBeNull();
    expect(parseCanvas('[1]')).toBeNull();
  });
  it('the groups a node lies in; the sides two nodes face each other with; an edge\'s curve', () => {
    expect(groupsOf(c, c.nodes[1]).map((g) => g.id)).toEqual(['g1']);
    expect(facing(c.nodes[1], c.nodes[2])).toEqual(['right', 'left']);
    expect(facing({ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 300, width: 100, height: 50 })).toEqual(['bottom', 'top']);
    const p = edgePath(c.nodes[1], c.nodes[2], c.edges[0]);
    expect(p.d.startsWith('M250 30 C')).toBe(true);
    expect(p.end).toEqual([300, 70]);
  });
});

describe('the edits', () => {
  const c = parseCanvas(OBSIDIAN)!;
  it('a group carries the nodes inside its box', () => {
    expect([...carried(c, ['g1'])].sort()).toEqual(['a', 'b', 'g1']);
    const m = moveNodes(c, ['g1'], 22, 44);
    expect(m.nodes.find((n) => n.id === 'b')).toMatchObject({ x: 322, y: 44 });
    expect(m.nodes.find((n) => n.id === 'c')).toMatchObject({ x: 700, y: 0 });
  });
  it('removing a node removes its edges', () => {
    const r = remove(c, ['b']);
    expect(r.nodes.map((n) => n.id)).toEqual(['g1', 'a', 'c', 'd']);
    expect(r.edges).toEqual([]);
  });
  it('a copy: new ids, moved, the edges between the copies', () => {
    const d = duplicate(c, ['a', 'b']);
    expect(d.ids).toHaveLength(2);
    expect(d.canvas.nodes.length).toBe(7);
    const copy = d.canvas.nodes.find((n) => n.id === d.ids[0])!;
    expect(copy).toMatchObject({ type: 'text', x: 22, y: 22 });
    expect(d.canvas.edges.length).toBe(2);
    expect(d.canvas.edges[1]).toMatchObject({ fromNode: d.ids[0], toNode: d.ids[1], label: 'зачем' });
  });
  it('a group around nodes goes under them', () => {
    const g = group(c, ['c', 'd'], 'Ссылки')!;
    expect(g.canvas.nodes[0]).toMatchObject({ type: 'group', label: 'Ссылки', x: 676, y: -44, width: 308, height: 348 });
  });
  it('an edge: once, not to itself', () => {
    expect(addEdge(c, 'a', 'right', 'b', 'left')).toBeNull();
    expect(addEdge(c, 'a', 'right', 'a', 'left')).toBeNull();
    const e = addEdge(c, 'b', 'right', 'c', 'left')!;
    expect(e.canvas.edges[1]).toMatchObject({ fromNode: 'b', toNode: 'c', toEnd: 'arrow' });
  });
  it('a colour on nodes and edges; none takes it away', () => {
    const p = setColor(c, ['a', 'c'], ['e1'], '#123456');
    expect(p.nodes.find((n) => n.id === 'c')!.color).toBe('#123456');
    expect(p.edges[0].color).toBe('#123456');
    const q = setColor(p, ['a'], [], null);
    expect('color' in q.nodes.find((n) => n.id === 'a')!).toBe(false);
  });
  it('the grid, the side nearest a point, the nodes in a frame', () => {
    expect(snap(30)).toBe(22);
    expect(snap(34)).toBe(44);
    expect(snap(34.4, false)).toBe(34);
    expect(nearestSide({ x: 0, y: 0, width: 100, height: 100 }, 95, 50)).toBe('right');
    expect(nearestSide({ x: 0, y: 0, width: 100, height: 100 }, 50, 2)).toBe('top');
    expect(within(c as Canvas, { x: 650, y: -10, width: 400, height: 400 })).toEqual(['c', 'd']);
  });
});

describe('«Разложить на холсте»', () => {
  const S = (title: string, level: number, color: string | null = null) => ({ path: 'plan.org', title, level, id: 'id-' + title, color });
  it('a tree from left to right, a parent in the middle of its children, two levels', () => {
    const r = spread([S('Платформа', 1, 'green'), S('ДЦ', 2), S('Учения', 3), S('Сценарий', 4), S('Алерты', 2), S('Найм', 1)], 2, { x: 0, y: 0 });
    expect(r.nodes.map((n) => (n as { subpath: string }).subpath)).toEqual(['#Платформа', '#ДЦ', '#Учения', '#Алерты']);
    const [p, dc, u, al] = r.nodes;
    expect(p).toMatchObject({ type: 'file', file: 'plan.org', orgId: 'id-Платформа', color: '4', x: 0 });
    expect(dc.x).toBe(snap(360));
    expect(u.x).toBe(snap(720));
    expect(dc.y).toBe(u.y); // its one child level with it
    expect(p.y).toBe(snap((0 + 148) / 2));
    expect(r.edges.map((e) => [e.fromNode, e.toNode])).toEqual([[p.id, dc.id], [dc.id, u.id], [p.id, al.id]]);
  });
});

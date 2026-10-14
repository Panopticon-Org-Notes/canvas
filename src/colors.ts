// The six colours of «Холст», as Obsidian's canvas has them ("1"–"6"), and a colour of one's own (#rrggbb). A branch
// of the mindmap keeps its colour in the heading's :COLOR: property by name; the canvas keeps the JSON Canvas value.

export const PALETTE = [
  { name: 'red', canvas: '1', label: 'Красный', hex: '#e5484d' },
  { name: 'orange', canvas: '2', label: 'Оранжевый', hex: '#f76b15' },
  { name: 'yellow', canvas: '3', label: 'Жёлтый', hex: '#e2a336' },
  { name: 'green', canvas: '4', label: 'Зелёный', hex: '#30a46c' },
  { name: 'cyan', canvas: '5', label: 'Бирюзовый', hex: '#12a594' },
  { name: 'purple', canvas: '6', label: 'Фиолетовый', hex: '#8e4ec6' },
] as const;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The colour to draw with for a stored value: a name, "1"–"6" or #rgb / #rrggbb; null — none or not a colour. */
export function colorOf(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  const p = PALETTE.find((c) => c.name === s || c.canvas === s);
  if (p) return p.hex;
  return HEX.test(s) ? s : null;
}

/** What goes into :COLOR: for a colour picked: the palette's name, else the hex in lower case. */
export function colorValue(hex: string): string {
  const s = hex.trim().toLowerCase();
  return PALETTE.find((c) => c.hex === s)?.name ?? s;
}

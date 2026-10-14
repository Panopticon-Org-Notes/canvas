// A heading's title as HTML with its inline markup shown (ТЗ 19): *bold*, /italic/, _underline_, +strike+, =code=,
// ~code~, links by their description. Everything else is escaped.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARKS: [string, string][] = [
  ['*', 'b'],
  ['/', 'i'],
  ['_', 'u'],
  ['+', 's'],
];

export function titleHtml(title: string): string {
  // links first: [[target][description]] → the description, [[target]] → the target
  const parts: string[] = [];
  const re = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;
  let last = 0;
  for (let m = re.exec(title); m; m = re.exec(title)) {
    parts.push(inline(title.slice(last, m.index)));
    parts.push(`<span class="mm-link">${esc(m[2] ?? m[1])}</span>`);
    last = m.index + m[0].length;
  }
  parts.push(inline(title.slice(last)));
  return parts.join('');
}

function inline(s: string): string {
  // verbatim and code: their content as is
  const out: string[] = [];
  const re = /(^|[\s(])([=~])(\S(?:.*?\S)?)\2(?=$|[\s).,;:!?])/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out.push(emph(s.slice(last, m.index) + m[1]));
    out.push(`<code>${esc(m[3])}</code>`);
    last = m.index + m[0].length;
  }
  out.push(emph(s.slice(last)));
  return out.join('');
}

function emph(s: string): string {
  let h = esc(s);
  for (const [c, tag] of MARKS) {
    const q = c.replace(/[*+/]/g, '\\$&');
    h = h.replace(new RegExp(`(^|[\\s(])${q}(\\S(?:.*?\\S)?)${q}(?=$|[\\s).,;:!?])`, 'g'), `$1<${tag}>$2</${tag}>`);
  }
  return h;
}

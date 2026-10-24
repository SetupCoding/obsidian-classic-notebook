// Replace only our own formatting wrappers. Preserve existing emphasis and link targets.
function notebookColorEdit(text, from, to, color, preset = {}) {
  if (from >= to) throw new Error('Bitte zuerst Text in einer Karte oder Textseite markieren.');
  if (color && !/^#[0-9A-F]{6}$/.test(color)) throw new Error('Ungültige Textfarbe.');
  if (preset.size && preset.size !== '1.2em') throw new Error('Ungültige Schriftgröße.');
  for (const match of text.matchAll(/!?\[\[[^\n]*?\]\]|!?\[(?:[^\]\\]|\\.)*\]\([^\n]*?\)/g)) {
    const start = match.index, end = start + match[0].length;
    if (start < to && end > from) { from = Math.min(from, start); to = Math.max(to, end); }
  }
  const formats = notebookImportedFormats(text);
  // Code, properties and arbitrary HTML must not be changed by a colour command.
  const masked = text.split('');
  for (const span of formats) for (const [start, end] of [[span.from, span.openEnd], [span.closeStart, span.to]])
    for (let i = start; i < end; i++) masked[i] = ' ';
  const protectedText = masked.join('');
  for (const match of protectedText.matchAll(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)|^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$|`+[^\n]*?`+|<[^>\n]*>/gm)) {
    if (match.index < to && match.index + match[0].length > from) throw new Error('Bitte normalen Text außerhalb von Code, Eigenschaften oder HTML markieren.');
  }
  let start = from, end = to;
  const affected = formats.filter(span => span.from < to && span.to > from);
  for (const span of affected) { start = Math.min(start, span.from); end = Math.max(end, span.to); }
  const boundaries = new Set([start, end, from, to]);
  for (const span of affected) for (const point of [span.from, span.openEnd, span.closeStart, span.to]) boundaries.add(point);
  const points = [...boundaries].sort((a, b) => a - b), pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (a < start || b > end || a === b) continue;
    if (affected.some(span => a >= span.from && b <= span.openEnd || a >= span.closeStart && b <= span.to)) continue;
    const old = affected.find(span => a >= span.openEnd && b <= span.closeStart);
    const selected = a >= from && b <= to;
    const style = {
      color: selected ? color : old?.color || null,
      bold: selected && Object.hasOwn(preset, 'bold') ? !!preset.bold : !!old?.style.includes('font-weight:700'),
      size: selected && Object.hasOwn(preset, 'size') ? preset.size : old?.style.includes('font-size:1.2em') ? '1.2em' : null
    };
    const previous = pieces.at(-1);
    if (previous && previous.color === style.color && previous.bold === style.bold && previous.size === style.size) previous.text += text.slice(a, b);
    else pieces.push({ ...style, text: text.slice(a, b) });
  }
  const wrap = (value, style) => {
    if (!value || !style.color && !style.bold) return value;
    const attributes = style.color ? ` data-tn-color="${style.color}"` : '';
    const css = [style.color ? `color:${style.color}` : '', style.bold ? 'font-weight:700' : '', style.size ? 'font-size:' + style.size : ''].filter(Boolean).join(';');
    return `<span class="tn-import-format"${attributes} style="${css}">${value}</span>`;
  };
  let atLineStart = start === 0 || text[start - 1] === '\n';
  const replacement = pieces.map(piece => piece.text.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) { atLineStart = true; return line; }
    let prefix = '';
    if (atLineStart) { const match = line.match(/^(\s*(?:> ?)*(?:(?:#{1,6}|[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)/); prefix = match?.[0] || ''; }
    atLineStart = false;
    return prefix + wrap(line.slice(prefix.length), piece);
  }).join('')).join('');
  return { from: start, to: end, insert: replacement };
}

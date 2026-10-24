// Portable inline formatting. Live Preview hides only these strictly validated wrappers.
function notebookImportedFormats(text) {
  const protectedRanges = [], add = (from, to) => protectedRanges.push({ from, to });
  const front = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (front) add(0, front[0].length);
  for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)|(`+)[^\n]*?\1/g)) add(match.index, match.index + match[0].length);
  let offset = 0, fence = null, fenceStart = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) { add(fenceStart, offset + line.length); fence = null; }
    else if (!fence && marker) { fence = marker[1]; fenceStart = offset; }
    if (/^(?: {4}|\t)/.test(line)) add(offset, offset + line.length);
    offset += line.length;
  }
  if (fence) add(fenceStart, text.length);
  const formats = [];
  const expression = /<span class="tn-import-format"(?: data-tn-color="(#[0-9A-F]{6})")? style="((?:color:#[0-9A-F]{6}(?:;font-weight:700)?|font-weight:700)(?:;font-size:1\.2em)?)">([^\n]*?)<\/span>/g;
  for (const match of text.matchAll(expression)) {
    const from = match.index, to = from + match[0].length;
    if (protectedRanges.some(range => range.from < to && range.to > from)) continue;
    if (match[1] && !match[2].startsWith('color:' + match[1])) continue;
    const openEnd = from + match[0].indexOf('>') + 1, closeStart = to - '</span>'.length;
    if (openEnd === closeStart) continue;
    formats.push({ from, to, openEnd, closeStart, color: match[1], style: match[2] });
  }
  return formats;
}
function notebookImportedFormatExtension() {
  const cacheKey = Symbol.for('obsidian.notebook.inline-formats.v2');
  if (globalThis[cacheKey]) return globalThis[cacheKey];
  const { StateField } = require('@codemirror/state');
  const { Decoration, EditorView } = require('@codemirror/view');
  const { editorLivePreviewField } = require('obsidian');
  const build = state => {
    const mode = state.field(editorLivePreviewField, false) !== false, marks = [];
    if (mode) for (const format of notebookImportedFormats(state.doc.toString())) {
      const attributes = { style: format.style };
      if (format.color) attributes['data-tn-color'] = format.color;
      marks.push(Decoration.replace({}).range(format.from, format.openEnd));
      marks.push(Decoration.mark({ class: 'tn-import-format', attributes }).range(format.openEnd, format.closeStart));
      marks.push(Decoration.replace({}).range(format.closeStart, format.to));
    }
    return { mode, decorations: Decoration.set(marks, true) };
  };
  return globalThis[cacheKey] = StateField.define({ create: build,
    update: (value, transaction) => transaction.docChanged || value.mode !== (transaction.state.field(editorLivePreviewField, false) !== false) ? build(transaction.state) : value,
    provide: field => EditorView.decorations.from(field, value => value.decorations) });
}

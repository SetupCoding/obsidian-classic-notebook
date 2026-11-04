// Editing a card must not move its text. Obsidian 1.14 edits a card inside an
// iframe, where the card element is no ancestor of the editor, so the iframe
// root receives the card's classes and typography that the preview uses.
// Spacing that the editor cannot express with the shared rules (heading and
// list margins, imported OneNote paragraph spacing) is measured in the preview
// when editing starts and added in front of the matching editor lines.
const NOTEBOOK_CANVAS_CARD_CLASSES = ['tn-canvas-consistent-card', 'tn-canvas-imported-card'];
const NOTEBOOK_CANVAS_ALIGN_PASSES = 8;
const NOTEBOOK_CANVAS_BLOCK_ANCHOR = 'hr, img, .internal-embed, .media-embed, table';

// Where each source line starts in the rendered preview: the top of its first
// visible character in unscaled card pixels from the top of the text box.
function notebookCanvasPreviewLines(node, scale = 1) {
  const text = node?.text, preview = node?.child?.previewMode?.renderer?.previewEl;
  if (typeof text !== 'string' || !preview?.isConnected) return null;
  const visible = notebookCanvasVisibleSource(text, preview.ownerDocument), probes = [];
  let from = 0, at = 0;
  for (const [line, value] of text.split('\n').entries()) {
    const to = from + value.length;
    while (at < visible.starts.length && visible.starts[at] < from) at++;
    let first = at;
    while (first < visible.starts.length && visible.starts[first] < to && visible.text[first] === ' ') first++;
    if (first < visible.starts.length && visible.starts[first] < to) probes.push({ line, offset: visible.starts[first], end: visible.ends[first] });
    from = to + 1;
  }
  const ranges = notebookCanvasExactRanges(node, { matches: probes.map(probe => [probe.offset, probe.end]) }, true), base = preview.getBoundingClientRect(), measured = [];
  const lines = text.split('\n'), view = preview.ownerDocument.defaultView;
  probes.forEach((probe, index) => {
    const range = ranges[index], rect = range?.getClientRects?.()[0];
    if (!rect) return;
    // Imported paragraphs carry their own OneNote size and line height. Headings
    // keep their theme sizes, which are the same in both modes.
    const element = range.startContainer.parentElement, style = element && view.getComputedStyle(element);
    const font = style && !/^ {0,3}#{1,6}\s/.test(lines[probe.line]) ? 'font-family:' + style.fontFamily + ';font-size:' + style.fontSize + ';line-height:' + style.lineHeight : '';
    const list = /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[probe.line]);
    measured.push({ ...probe, font, list, left: (rect.left - base.left) / scale, top: (rect.top - base.top) / scale + preview.scrollTop });
  });
  // Lines without text (rules, images, embeds) are anchored by their rendered block.
  const known = new Set(measured.map(probe => probe.line)), starts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  const lineOf = position => Number.isFinite(position?.line) ? position.line : Number.isFinite(position?.offset) ? starts.filter(start => start <= position.offset).length - 1 : null;
  for (const section of node.child?.previewMode?.renderer?.sections || []) {
    const line = lineOf(section.start);
    if (line == null || known.has(line) || !lines[line]?.trim() || !section.el?.isConnected) continue;
    const element = section.el.querySelector(NOTEBOOK_CANVAS_BLOCK_ANCHOR) || section.el.firstElementChild || section.el, rect = element.getBoundingClientRect();
    if (!rect.height) continue;
    known.add(line); measured.push({ line, offset: starts[line], block: true, font: '', list: false, top: (rect.top - base.top) / scale + preview.scrollTop });
  }
  measured.sort((a, b) => a.line - b.line);
  return measured.length ? { text, probes: measured } : null;
}

function notebookCanvasEditorLineTops(view, probes) {
  const scroller = view.scrollDOM, box = scroller.getBoundingClientRect(), scale = view.scaleY || 1, tops = new Map(), lefts = new Map(), indents = new Map(), heights = new Map(), doc = view.state.doc;
  // Lines without text (rules, widgets) resolve to the content element plus a child index.
  const lineElement = number => {
    if (number + 1 > doc.lines) return null;
    const { node, offset } = view.domAtPos(doc.line(number + 1).from), target = node === view.contentDOM ? node.childNodes[offset] : node;
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    return element?.closest?.('.cm-line') || null;
  };
  for (const probe of probes) {
    if (probe.block) {
      const line = lineElement(probe.line), anchor = line && (line.querySelector(NOTEBOOK_CANVAS_BLOCK_ANCHOR) || line), rect = anchor?.getBoundingClientRect();
      if (rect?.height) tops.set(probe.line, (rect.top - box.top) / scale + scroller.scrollTop);
      continue;
    }
    const caret = probe.offset <= doc.length ? view.coordsAtPos(probe.offset, 1) : null;
    if (!caret) continue;
    tops.set(probe.line, (caret.top - box.top) / scale + scroller.scrollTop);
    lefts.set(probe.line, (caret.left - box.left) / scale);
    const line = probe.list && lineElement(probe.line);
    if (line) indents.set(probe.line, parseFloat(view.dom.ownerDocument.defaultView.getComputedStyle(line).paddingInlineStart) || 0);
  }
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (!line.text.trim()) heights.set(number - 1, view.lineBlockAt(line.from).height);
  }
  return { tops, lefts, indents, heights };
}

// List text starts where the preview starts it, on its first and wrapped lines.
// `base` keeps the editor's own hanging indent before any shift was added.
function notebookCanvasListShift(probes, lefts, indents, current = { shift: new Map(), base: new Map() }) {
  const shift = new Map(current.shift), base = new Map(current.base);
  let changed = false;
  for (const probe of probes) {
    if (!probe.list || !lefts.has(probe.line) || !indents.has(probe.line)) continue;
    const before = shift.get(probe.line) || 0;
    if (!base.has(probe.line)) base.set(probe.line, indents.get(probe.line) - before);
    const delta = probe.left - lefts.get(probe.line);
    if (Math.abs(delta) >= 0.5) { shift.set(probe.line, Math.round((before + delta) * 100) / 100); changed = true; }
  }
  return { shift, base, changed };
}

// The space in front of each measured line, so consecutive lines keep the
// preview's distances. It is made of the blank lines before it (which may
// shrink to nothing) or, without blank lines, of extra padding on the line.
function notebookCanvasAlignmentSpace(probes, tops, heights, current = { pad: new Map(), blank: new Map() }) {
  const pad = new Map(current.pad), blank = new Map(current.blank), round = value => Math.round(Math.max(0, value) * 100) / 100;
  let previous = null, changed = false;
  for (const probe of probes) {
    const have = tops.get(probe.line);
    if (have == null) continue;
    const delta = previous ? (probe.top - previous.want) - (have - previous.have) : probe.top - have;
    if (Math.abs(delta) >= 0.5) {
      const from = previous ? previous.line + 1 : 0, blanks = [...heights.keys()].filter(line => line >= from && line < probe.line);
      const space = blanks.reduce((sum, line) => sum + heights.get(line), 0) + (pad.get(probe.line) || 0), wanted = round(space + delta);
      if (blanks.length) {
        const each = round(wanted / blanks.length);
        for (const line of blanks) if (Math.abs((blank.has(line) ? blank.get(line) : heights.get(line)) - each) >= 0.25) { blank.set(line, each); changed = true; }
        if (pad.delete(probe.line)) changed = true;
      } else if (Math.abs((pad.get(probe.line) || 0) - wanted) >= 0.25) { pad.set(probe.line, wanted); changed = true; }
    }
    previous = { want: probe.top, have, line: probe.line };
  }
  return { pad, blank, changed };
}

function notebookCanvasEditorParityExtension(plugin) {
  const { StateField, StateEffect } = require('@codemirror/state'), { Decoration, EditorView, ViewPlugin } = require('@codemirror/view');
  const setSpace = StateEffect.define();
  const indent = (shift, base) => shift == null ? '' : ';--cn-list-shift:' + shift + 'px;padding-inline-start:' + (base + shift) + 'px !important;text-indent:-' + (base + shift) + 'px !important';
  const decoration = ({ from, pad, font, blank, shift, base }) => Decoration.line(blank == null
    ? { attributes: { class: 'cn-canvas-aligned-line', style: (font || '') + (pad ? ';padding-top:' + pad + 'px !important' : '') + indent(shift, base) } }
    : { blank: true, attributes: { class: 'cn-canvas-aligned-line', style: 'height:' + blank + 'px !important;min-height:0 !important;line-height:' + blank + 'px !important;padding-block:0 !important' } }).range(from);
  const field = StateField.define({
    create: () => Decoration.none,
    update(value, transaction) {
      value = value.map(transaction.changes);
      // Typing into a squeezed blank line gives it its normal height back.
      if (transaction.docChanged) value = value.update({ filter: (from, to, spec) => !spec.spec.blank || !transaction.newDoc.lineAt(from).text.trim() });
      for (const effect of transaction.effects) if (effect.is(setSpace)) value = Decoration.set(effect.value.map(decoration), true);
      return value;
    },
    provide: state => EditorView.decorations.from(state)
  });
  // The editor can be created before its iframe is attached to the card.
  const aligner = ViewPlugin.fromClass(class {
    constructor(view) {
      this.passes = 0; this.space = { pad: new Map(), blank: new Map() }; this.lists = { shift: new Map(), base: new Map() }; this.sync(view);
      if (!this.synced) view.requestMeasure({ read: () => null, write: () => this.sync(view) });
    }
    sync(view) {
      if (this.synced) return;
      const found = plugin.syncCanvasEditorCard(view);
      if (!found) return;
      this.synced = true;
      const lines = plugin.canvasPreviewLinesFor(found);
      if (!lines || lines.text !== view.state.doc.toString()) return;
      // Fonts first: they decide wrapping, which the spacing passes then measure.
      this.lines = lines; this.dispatch(view, lines);
    }
    dispatch(view, lines) {
      Promise.resolve().then(() => {
        if (this.lines !== lines || view.state.doc.toString() !== lines.text) return;
        const doc = view.state.doc, from = line => doc.line(line + 1).from, { pad, blank } = this.space, { shift, base } = this.lists;
        const content = new Map(lines.probes.filter(probe => probe.font).map(probe => [probe.line, { font: probe.font }]));
        for (const [line, value] of pad) if (value > 0) content.set(line, { ...content.get(line), pad: value });
        for (const [line, value] of shift) content.set(line, { ...content.get(line), shift: value, base: base.get(line) });
        const specs = [...[...content].map(([line, value]) => ({ from: from(line), ...value })), ...[...blank].map(([line, value]) => ({ from: from(line), blank: value }))].sort((a, b) => a.from - b.from);
        view.dispatch({ effects: setSpace.of(specs) });
        this.schedule(view);
      });
    }
    update(update) {
      if (!this.synced) { this.sync(update.view); return; }
      if (update.docChanged) this.lines = null;
    }
    schedule(view) {
      if (this.waiting || !this.lines || this.passes >= NOTEBOOK_CANVAS_ALIGN_PASSES) return;
      this.waiting = true;
      view.requestMeasure({ read: current => notebookCanvasEditorLineTops(current, this.lines.probes), write: (measured, current) => { this.waiting = false; this.apply(current, measured); } });
    }
    apply(view, { tops, lefts, indents, heights }) {
      const lines = this.lines;
      if (!lines) return;
      // Indents first: they change wrapping and with it the vertical layout.
      const lists = notebookCanvasListShift(lines.probes, lefts, indents, this.lists);
      const space = lists.changed ? { ...this.space, changed: false } : notebookCanvasAlignmentSpace(lines.probes, tops, heights, this.space);
      this.passes++;
      if (!lists.changed && !space.changed) { this.lines = null; return; }
      this.lists = { shift: lists.shift, base: lists.base };
      this.space = { pad: space.pad, blank: space.blank };
      this.dispatch(view, lines);
    }
  });
  return [field, aligner];
}

const notebookCanvasEditParityMethods = {
  setupCanvasEditParity() {
    this.canvasEditorDocuments = new Set();
    this.registerEditorExtension(notebookCanvasEditorParityExtension(this));
    this.register(() => {
      for (const doc of this.canvasEditorDocuments) {
        doc.getElementById?.('cn-canvas-editor-root')?.remove();
        doc.documentElement?.classList.remove(...NOTEBOOK_CANVAS_CARD_CLASSES);
      }
      this.canvasEditorDocuments.clear();
    });
  },
  syncCanvasEditorCard(view) {
    const frame = notebookEditorFrame(view.dom), host = frame?.closest?.('.canvas-node');
    if (!host) return null;
    const root = view.dom.ownerDocument.documentElement;
    for (const doc of this.canvasEditorDocuments || []) if (!doc.defaultView) this.canvasEditorDocuments.delete(doc);
    this.canvasEditorDocuments?.add(view.dom.ownerDocument);
    for (const name of NOTEBOOK_CANVAS_CARD_CLASSES) root.classList.toggle(name, host.classList.contains(name));
    // Spacing variables use rem. Obsidian resets the iframe root to 15px while
    // the app root is 16px, so the size lives in a style element of the iframe.
    const main = host.ownerDocument, size = main.defaultView.getComputedStyle(main.documentElement).fontSize, doc = view.dom.ownerDocument;
    let rule = doc.getElementById('cn-canvas-editor-root');
    if (!rule) { rule = doc.createElement('style'); rule.id = 'cn-canvas-editor-root'; doc.head.appendChild(rule); }
    const css = 'html:is(.tn-canvas-consistent-card,.tn-canvas-imported-card){font-size:' + size + ' !important}';
    if (rule.textContent !== css) rule.textContent = css;
    const found = this.canvasNodeForEditor(view.dom);
    const card = found && this.canvasNotebookMetadata?.get(this.canvasViewFor(found.canvas)?.file?.path)?.cards?.[found.node.id];
    // Imported cards set their base font on the preview sizer; mirror it on the editor content.
    for (const property of ['fontFamily', 'fontSize', 'lineHeight']) view.contentDOM.style[property] = '';
    if (card && card.appearance !== 'native') spatialTextMetrics(view.contentDOM, card.typography);
    return found && this.canvasNotebookManaged(this.canvasViewFor(found.canvas)) ? found : null;
  },
  // Canvas hides the preview before it creates the editor. Showing it again for
  // one synchronous measurement does not paint and keeps its rendered sections.
  canvasPreviewLinesFor({ canvas, node }) {
    const elements = [node.child?.previewEl, node.child?.previewMode?.renderer?.previewEl].filter(element => element?.style);
    if (elements.length < 2) return null;
    const displays = elements.map(element => element.style.display);
    for (const element of elements) element.style.display = '';
    try { return notebookCanvasPreviewLines(node, canvas.scale || 1); } catch (error) { console.warn('Classic Notebook: Canvas preview measurement', error); return null; } finally { elements.forEach((element, index) => { element.style.display = displays[index]; }); }
  }
};

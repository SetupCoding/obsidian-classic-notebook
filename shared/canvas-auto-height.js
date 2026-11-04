// Text cards fit what is written in them. Canvas keeps owning size, save and
// history, exactly like its own fit-to-content double click on a card edge.
// A card that cannot grow (read-only Canvas, unstable measurement) shows its
// whole text past its edge instead of clipping it or hiding it in a scrollbar.
const NOTEBOOK_CANVAS_GROW_WINDOW = 3000;
const NOTEBOOK_CANVAS_OVERFLOW_CLASS = 'cn-canvas-text-overflow';

// Obsidian 1.14 edits a card inside an iframe, so the editor is reached
// through CodeMirror itself rather than through the card's own DOM.
function notebookCanvasTextElement(node) {
  const root = node?.nodeEl;
  if (typeof root?.querySelector !== 'function') return null;
  if (node.isEditing) return node.child?.editMode?.editor?.cm?.scrollDOM || root.querySelector('.canvas-node-content .cm-scroller');
  return node.child?.previewMode?.renderer?.previewEl || root.querySelector('.canvas-node-content .markdown-preview-view');
}

function notebookEditorFrame(dom) {
  const frame = dom?.ownerDocument?.defaultView?.frameElement;
  return frame && frame.ownerDocument !== dom.ownerDocument ? frame : null;
}

// The space a card gives its text is the native container inside its border.
// Its size is contained, so it stays stable while text overflows visibly.
function notebookCanvasTextSpace(node, element) {
  return node?.nodeEl?.querySelector?.('.canvas-node-container')?.clientHeight || element?.clientHeight || 0;
}

function notebookCanvasClipped(node) {
  const element = notebookCanvasTextElement(node), space = notebookCanvasTextSpace(node, element);
  return !!element?.isConnected && space > 0 && element.scrollHeight - space >= 1;
}

// Content is measured at a 1px box so percentage minimum heights (CodeMirror
// content, preview spacers) cannot make a card grow with itself forever.
// A negative result is unused space below the text.
function notebookCanvasOverflow(node) {
  const element = notebookCanvasTextElement(node), space = notebookCanvasTextSpace(node, element);
  if (!element?.isConnected || !space) return 0;
  const previous = element.style.height;
  element.style.height = '1px';
  const needed = element.scrollHeight;
  element.style.height = previous;
  return needed - space;
}

// Grows to the text, or shrinks back towards it, never below `floor`.
function notebookFitCanvasCard(node, canvas, floor = 0) {
  const settled = value => value < 1 && (value > -4 || node.height <= floor);
  let overflow = notebookCanvasOverflow(node), changed = false;
  if (settled(overflow)) return 'fit';
  if (canvas?.readonly || typeof node.resize !== 'function') return overflow < 1 ? 'fit' : 'blocked';
  for (let step = 0; step < 10 && !settled(overflow); step++) {
    const height = node.height, next = Math.max(floor, Math.ceil(height + overflow));
    if (next === height) break;
    node.resize({ width: node.width, height: next });
    node.render?.();
    if (node.height === height) break;
    changed = true;
    const after = notebookCanvasOverflow(node);
    if (after >= 1 && after >= overflow) { overflow = after; break; }
    overflow = after;
  }
  if (changed) canvas.requestSave?.();
  return overflow >= 1 ? 'blocked' : changed ? 'resized' : 'fit';
}

// Cards below a resized card keep their distance to it, like text below a
// growing paragraph: every card entirely below its previous bottom edge that
// overlaps it horizontally moves, and so does every card those push in turn.
// Deliberately overlapping cards and groups stay where they are.
function notebookShiftCanvasCardsBelow(canvas, node, bottom, delta) {
  if (!delta || !canvas?.nodes) return 0;
  const cards = [...canvas.nodes.values()].filter(other => other !== node && typeof other.moveAndResize === 'function' && other.getData?.().type !== 'group');
  const moved = new Set(), queue = [{ left: node.x, right: node.x + node.width, bottom }];
  while (queue.length) {
    const area = queue.shift();
    for (const other of cards) if (!moved.has(other) && other.y >= area.bottom - 1 && other.x < area.right && other.x + other.width > area.left) {
      moved.add(other); queue.push({ left: other.x, right: other.x + other.width, bottom: other.y + other.height });
    }
  }
  for (const other of moved) other.moveAndResize({ x: other.x, y: other.y + delta, width: other.width, height: other.height });
  return moved.size;
}

// Canvas is moved by transforms, not scrolling, so CodeMirror cannot follow a
// caret that a growing card pushes below the visible area. Coordinates inside
// the editor iframe are unscaled Canvas units relative to the frame.
function notebookRevealCanvasCaret(canvas, node, editor) {
  if (typeof canvas?.panIntoView !== 'function' || typeof node.nodeEl?.getBoundingClientRect !== 'function') return;
  const caret = editor?.coordsAtPos?.(editor.state.selection.main.head), box = node.nodeEl.getBoundingClientRect(), scale = canvas.scale || 1;
  if (!caret || !box) return;
  const frame = notebookEditorFrame(editor.dom), origin = frame?.getBoundingClientRect();
  const left = frame ? (origin.left - box.left) / scale + caret.left : (caret.left - box.left) / scale;
  const top = frame ? (origin.top - box.top) / scale + caret.top : (caret.top - box.top) / scale;
  const bottom = top + (caret.bottom - caret.top) / (frame ? 1 : scale);
  canvas.panIntoView({ minX: node.x + left, minY: node.y + top, maxX: node.x + left + 1, maxY: node.y + bottom });
}

function notebookCanvasEditorHost(dom) {
  return dom?.closest?.('.canvas-node') || notebookEditorFrame(dom)?.closest?.('.canvas-node') || null;
}

function notebookCanvasAutoHeightExtension(plugin) {
  const { EditorView } = require('@codemirror/view');
  return EditorView.updateListener.of(update => {
    if (!update.docChanged && !update.geometryChanged && !update.heightChanged) return;
    if (!notebookCanvasEditorHost(update.view.dom)) return;
    plugin.onCanvasCardEditorUpdate(update.view, update.docChanged);
  });
}

const notebookCanvasAutoHeightMethods = {
  setupCanvasAutoHeight() {
    this.canvasCardChanges = new WeakMap(); this.canvasCardsUnstable = new WeakSet(); this.canvasCardFits = new Map();
    this.registerEditorExtension(notebookCanvasAutoHeightExtension(this));
    this.canvasCardObserved = new Map(); this.canvasCardObservers = new Map();
    this.register(() => {
      window.cancelAnimationFrame(this.canvasCardFitFrame); this.canvasCardFitFrame = 0; this.canvasCardFits.clear();
      for (const observer of this.canvasCardObservers.values()) observer.disconnect();
      this.canvasCardObservers.clear(); this.canvasCardObserved.clear();
      for (const leaf of this.app.workspace.getLeavesOfType('canvas')) for (const element of leaf.view.contentEl?.querySelectorAll('.' + NOTEBOOK_CANVAS_OVERFLOW_CLASS) || []) element.classList.remove(NOTEBOOK_CANVAS_OVERFLOW_CLASS);
    });
  },
  canvasNotebookManaged(view) {
    const path = view?.file?.path;
    return view?.file?.extension === 'canvas' && (!!this.canvasNotebookMetadata?.has(path) || !!this.data.pageMeta?.[path]);
  },
  canvasViewFor(canvas) {
    return canvas?.view?.canvas === canvas ? canvas.view : this.app.workspace.getLeavesOfType('canvas').map(leaf => leaf.view).find(view => view.canvas === canvas);
  },
  // `base` is the card height when writing started: the card never fits below it.
  // A size change made outside this module (manual resize, undo) starts a new base.
  onCanvasCardEditorUpdate(editor, changed) {
    const found = this.canvasNodeForEditor(editor.dom);
    if (!found || !this.canvasNotebookManaged(this.canvasViewFor(found.canvas))) return;
    const marks = this.canvasCardChanges ||= new WeakMap(), node = found.node, mark = marks.get(node);
    if (changed) {
      if (!mark || mark.height !== node.height) marks.set(node, { time: Date.now(), base: node.height, height: node.height });
      else mark.time = Date.now();
    } else if (!this.canvasCardRecentlyChanged(node)) return;
    (this.canvasCardFits ||= new Map()).set(node, { canvas: found.canvas, editor });
    if (this.canvasCardFitFrame) return;
    this.canvasCardFitFrame = window.requestAnimationFrame(() => {
      this.canvasCardFitFrame = 0;
      const pending = [...this.canvasCardFits]; this.canvasCardFits.clear();
      for (const [card, { canvas, editor: view }] of pending) if (canvas.nodes?.get(card.id) === card) this.fitCanvasNotebookCard(canvas, card, { fit: true, editor: view });
    });
  },
  canvasCardRecentlyChanged(node) {
    const mark = this.canvasCardChanges?.get(node);
    return !!mark && Date.now() - mark.time <= NOTEBOOK_CANVAS_GROW_WINDOW && mark.height === node.height;
  },
  fitCanvasNotebookCards(view) {
    const canvas = view?.canvas;
    if (!canvas?.nodes || !this.canvasNotebookManaged(view)) return;
    for (const [node, entry] of this.canvasCardObserved || []) if (!entry.preview.isConnected) this.unobserveCanvasCard(node, entry);
    for (const node of canvas.nodes.values()) {
      if (typeof node.text !== 'string' || !node.nodeEl?.classList) continue;
      this.observeCanvasCard(node);
      if (!node.isEditing) this.fitCanvasNotebookCard(canvas, node, { fit: this.canvasCardRecentlyChanged(node) });
    }
  },
  // The preview renders lazily and loads images and fonts later. Those change
  // sizes, not DOM structure, so the page observer would not notice them.
  observeCanvasCard(node) {
    const preview = node.child?.previewMode?.renderer?.previewEl, sizer = preview?.querySelector?.('.markdown-preview-sizer'), host = preview?.ownerDocument?.defaultView;
    if (!sizer || !preview.isConnected || !host?.ResizeObserver || !this.canvasCardObserved) return;
    const current = this.canvasCardObserved.get(node);
    if (current?.preview === preview && current.sizer === sizer) return;
    if (current) this.unobserveCanvasCard(node, current);
    let observer = this.canvasCardObservers.get(host);
    if (!observer) { observer = new host.ResizeObserver(() => this.scheduleNotebookHeaders()); this.canvasCardObservers.set(host, observer); }
    observer.observe(preview); observer.observe(sizer);
    this.canvasCardObserved.set(node, { preview, sizer, observer });
  },
  unobserveCanvasCard(node, entry) {
    entry.observer.unobserve(entry.preview); entry.observer.unobserve(entry.sizer);
    this.canvasCardObserved.delete(node);
  },
  fitCanvasNotebookCard(canvas, node, { fit = false, editor = null } = {}) {
    const mark = this.canvasCardChanges?.get(node);
    let result;
    if (fit && mark && !this.canvasCardsUnstable?.has(node)) {
      const height = node.height;
      result = notebookFitCanvasCard(node, canvas, mark.base);
      if (result === 'resized' || (result === 'blocked' && node.height !== height)) {
        if (notebookShiftCanvasCardsBelow(canvas, node, node.y + height, node.height - height)) canvas.requestSave?.();
      }
      if (result === 'resized') { mark.height = node.height; if (editor) notebookRevealCanvasCaret(canvas, node, editor); }
      else if (result === 'blocked' && !canvas.readonly) (this.canvasCardsUnstable ||= new WeakSet()).add(node);
    } else result = notebookCanvasClipped(node) ? 'blocked' : 'fit';
    const classes = node.nodeEl?.classList, blocked = result === 'blocked';
    if (classes) {
      const before = classes.contains?.(NOTEBOOK_CANVAS_OVERFLOW_CLASS);
      classes.toggle(NOTEBOOK_CANVAS_OVERFLOW_CLASS, blocked);
      // The preview renders only what fits its own height; let it render the overflow too.
      if (before !== undefined && before !== blocked && !node.isEditing) node.child?.previewMode?.renderer?.onResize?.();
    }
    return result;
  }
};

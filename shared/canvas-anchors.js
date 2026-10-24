// Anchor identities live in notebook metadata; card text remains ordinary Markdown.
function notebookTextChanges(before, after, offset = 0, budget = { left: 200000 }) {
  if (before === after) return [];
  let start = 0, end = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  const a = before.slice(start, before.length - end), b = after.slice(start, after.length - end), base = offset + start;
  const fallback = () => [{ from: base, to: base + a.length, insert: b }];
  if (!a.length || !b.length || budget.left <= 0) return fallback();
  // Myers bisect keeps ordinary multi-location edits separate without a quadratic table.
  const max = Math.ceil((a.length + b.length) / 2), middle = max + 1, size = 2 * max + 3;
  const forward = new Int32Array(size).fill(-1), reverse = new Int32Array(size).fill(-1);
  forward[middle + 1] = reverse[middle + 1] = 0;
  const delta = a.length - b.length, odd = delta % 2 !== 0;
  const split = (x, y) => {
    if ((x === 0 && y === 0) || (x === a.length && y === b.length)) return fallback();
    return [...notebookTextChanges(a.slice(0, x), b.slice(0, y), base, budget), ...notebookTextChanges(a.slice(x), b.slice(y), base + x, budget)];
  };
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      if (--budget.left < 0) return fallback();
      const index = middle + k;
      let x = k === -d || (k !== d && forward[index - 1] < forward[index + 1]) ? forward[index + 1] : forward[index - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      forward[index] = x;
      const back = middle + delta - k;
      if (odd && back >= 0 && back < size && reverse[back] !== -1 && x >= a.length - reverse[back]) return split(x, y);
    }
    for (let k = -d; k <= d; k += 2) {
      if (--budget.left < 0) return fallback();
      const index = middle + k;
      let x = k === -d || (k !== d && reverse[index - 1] < reverse[index + 1]) ? reverse[index + 1] : reverse[index - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[a.length - x - 1] === b[b.length - y - 1]) { x++; y++; }
      reverse[index] = x;
      const front = middle + delta - k;
      if (!odd && front >= 0 && front < size && forward[front] !== -1 && forward[front] >= a.length - x) return split(forward[front], forward[front] - (delta - k));
    }
  }
  return fallback();
}

function notebookMapAnchor(anchor, changes, textLength) {
  const map = (position, end) => {
    let delta = 0;
    for (const change of changes) {
      if (position < change.from) break;
      if (change.from === change.to && position === change.from) return position + delta + (end ? 0 : change.insert.length);
      if (position === change.from) return change.from + delta;
      if (position < change.to) return change.from + delta + (end ? change.insert.length : 0);
      delta += change.insert.length - (change.to - change.from);
    }
    return position + delta;
  };
  const start = Math.max(0, Math.min(textLength, map(Number(anchor.offset) || 0, false)));
  const finish = Math.max(start, Math.min(textLength, map((Number(anchor.offset) || 0) + (Number(anchor.length) || 0), true)));
  return { ...anchor, offset: start, length: finish - start };
}

function notebookRebaseCanvasAnchors(previous, current) {
  if (!current.notebook?.anchors) return current;
  const oldNodes = new Map((previous.nodes || []).map(node => [node.id, node]));
  const changes = new Map();
  for (const node of current.nodes || []) {
    const old = oldNodes.get(node.id);
    if (typeof node.text === 'string' && typeof old?.text === 'string' && old.text !== node.text) changes.set(node.id, { edits: notebookTextChanges(old.text, node.text), length: node.text.length });
  }
  if (!changes.size) return current;
  const anchors = { ...current.notebook.anchors };
  for (const [key, anchor] of Object.entries(anchors)) {
    const change = changes.get(anchor?.nodeId);
    if (change) anchors[key] = notebookMapAnchor(anchor, change.edits, change.length);
  }
  return { ...current, notebook: { ...current.notebook, anchors } };
}

function notebookRemoveCanvasSourceMarkers(original) {
  if (!original.notebook?.anchors) return { data: original, count: 0 };
  let count = 0;
  const anchors = { ...original.notebook.anchors };
  const nodes = original.nodes.map(node => {
    if (typeof node.text !== 'string') return node;
    const edits = []; let previousEnd = 0, fence = null, offset = 0;
    for (const line of node.text.split(/(?<=\n)/)) {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) { if (!fence) fence = fenceMatch[1]; else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null; }
      const match = !fence && line.match(/^(\^src-[a-zA-Z0-9_-]+)[ \t]*(?:\r?\n)?$/);
      if (match && anchors[match[1]]?.nodeId === node.id) {
        let start = previousEnd, end = offset;
        while (start < end && /\s/.test(node.text[start])) start++;
        while (end > start && /\s/.test(node.text[end - 1])) end--;
        anchors[match[1]] = { ...anchors[match[1]], offset: start, length: end - start };
        let removeTo = offset + line.length;
        const blanks = node.text.slice(removeTo).match(/^(?:[ \t]*\r?\n)+/);
        if (blanks) removeTo += blanks[0].length;
        edits.push({ from: offset, to: removeTo, insert: '' });
        previousEnd = offset + line.length; count++;
      }
      offset += line.length;
    }
    if (!edits.length) return node;
    let text = node.text;
    for (const edit of [...edits].reverse()) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    for (const [key, anchor] of Object.entries(anchors)) if (anchor?.nodeId === node.id) anchors[key] = notebookMapAnchor(anchor, edits, text.length);
    return { ...node, text };
  });
  return { data: count ? { ...original, nodes, notebook: { ...original.notebook, anchors } } : original, count };
}

const notebookCanvasAnchorMethods = {
  trackCanvasNotebookAnchors(view) {
    const canvas = view.canvas;
    if (!canvas || this.canvasAnchorHooks?.has(canvas) || typeof canvas.getData !== 'function') return;
    this.canvasAnchorHooks ||= new WeakMap();
    const plugin = this, originalGet = canvas.getData, originalSet = canvas.setData;
    let previous = { nodes: (canvas.data?.nodes || []).map(node => ({ ...node })) };
    function getData(...args) {
      const raw = originalGet.apply(this, args), data = notebookRebaseCanvasAnchors(previous, raw);
      previous = { nodes: data.nodes.map(node => ({ ...node })) };
      if (data.notebook) {
        this.data.notebook = data.notebook;
        if (view.file) plugin.canvasNotebookMetadata.set(view.file.path, data.notebook);
      }
      return data;
    }
    function setData(data, ...args) {
      const result = originalSet.call(this, data, ...args);
      previous = { nodes: (data?.nodes || []).map(node => ({ ...node })) };
      return result;
    }
    canvas.getData = getData;
    if (typeof originalSet === 'function') canvas.setData = setData;
    this.canvasAnchorHooks.set(canvas, true);
    this.register(() => {
      if (canvas.getData === getData) canvas.getData = originalGet;
      if (canvas.setData === setData) canvas.setData = originalSet;
    });
  },
  async removeCanvasNotebookSourceMarkers() {
    if (this.removingCanvasSourceMarkers) return;
    this.removingCanvasSourceMarkers = true;
    try {
      const vault = this.app.vault, planned = [];
      for (const file of vault.getFiles().filter(file => file.extension === 'canvas')) {
        const views = this.app.workspace.getLeavesOfType('canvas').filter(leaf => leaf.view.file === file && leaf.view.canvas).map(leaf => leaf.view);
        const snapshots = views.map(view => view.canvas.getData());
        if (snapshots.length > 1 && new Set(snapshots.map(data => JSON.stringify([data.nodes, data.edges]))).size > 1) throw new Error('Eine Canvas-Seite hat unterschiedliche Entwürfe in mehreren Tabs. Bitte zuerst zusammenführen.');
        const disk = await vault.read(file), source = snapshots[0] || JSON.parse(disk), result = notebookRemoveCanvasSourceMarkers(source);
        if (result.count) {
          if (views.some(view => view.canvas.readonly)) throw new Error('Eine betroffene Canvas-Seite ist schreibgeschützt.');
          planned.push({ file, views, source, result, disk });
        }
      }
      if (!planned.length) { new Notice('Keine Import-Marker im Canvas-Text vorhanden.'); return; }
      const directory = this.manifest.dir + '/backups';
      if (!await vault.adapter.exists(directory)) await vault.adapter.mkdir(directory);
      const backup = directory + '/source-markers-' + Date.now() + '.json';
      await vault.adapter.write(backup, JSON.stringify({ version: 1, pages: planned.map(item => ({ path: item.file.path, data: item.source })) }, null, 2));
      let count = 0;
      for (const item of planned) {
        if (item.views.length) {
          for (const view of item.views) {
            view.canvas.requestPushHistory?.run?.();
            const current = notebookRemoveCanvasSourceMarkers(view.canvas.getData());
            if (JSON.stringify(current.data.nodes) !== JSON.stringify(item.result.data.nodes)) throw new Error('Eine Seite wurde während der Bereinigung bearbeitet. Bitte den Befehl erneut ausführen.');
            view.canvas.setData(current.data);
            for (let i = 0; i < (view.canvas.history?.data?.length || 0); i++) view.canvas.history.data[i] = notebookRemoveCanvasSourceMarkers(view.canvas.history.data[i]).data;
          }
          await item.views[0].save();
        } else {
          await vault.process(item.file, text => {
            if (text !== item.disk) throw new Error('Eine Seite wurde während der Bereinigung geändert. Bitte den Befehl erneut ausführen.');
            return JSON.stringify(item.result.data, null, 2);
          });
        }
        this.canvasNotebookMetadata.set(item.file.path, item.result.data.notebook);
        count += item.result.count;
      }
      this.scheduleNotebookHeaders();
      new Notice(count + ' Import-Marker aus ' + planned.length + ' Canvas-Seiten entfernt. Sprungziele und Sicherung bleiben erhalten.', 10000);
    } finally { this.removingCanvasSourceMarkers = false; }
  }
};

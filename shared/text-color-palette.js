const NOTEBOOK_TEXT_COLORS = [
  ['Weiß', '#FFFFFF'], ['Schwarz', '#202020'], ['Hellgrau', '#E7E6E6'], ['Schiefer', '#44546A'], ['Blau', '#5B9BD5'],
  ['Orange hell', '#ED7D31'], ['Grau', '#A5A5A5'], ['Gold', '#FFC000'], ['Königsblau', '#4472C4'], ['Grün', '#70AD47'],
  ['Dunkelrot', '#C00000'], ['Rot', '#FF0000'], ['Orange', '#E84C22'], ['Gelb', '#FFFF00'], ['Limette', '#92D050'],
  ['Smaragd', '#00B050'], ['Türkis', '#00B0F0'], ['Kräftiges Blau', '#0070C0'], ['Dunkelblau', '#2E75B5'], ['Violett', '#800080']
];
function notebookHexColor(value) {
  const color = String(value || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(color)) return color;
  if (/^#[0-9A-F]{3}$/.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('');
  return null;
}
function notebookSavedTextColors(value) {
  const colors = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const color = notebookHexColor(entry?.color);
    if (color) colors.set(color, { color, name: String(entry.name || color).trim().slice(0, 32) || color });
  }
  return [...colors.values()];
}

// Map rendered text nodes in both directions. Repeated words are safe only when
// their surrounding rendered nodes identify the same source occurrence both ways.
// Markup attributes and link destinations must never become a text selection.
function notebookRenderedTextRange(text, parts, start, end) {
  const masked = text.split('');
  const hide = (from, to) => { for (let i = from; i < to; i++) masked[i] = '\u0000'; };
  for (const m of text.matchAll(/<!--[\s\S]*?(?:-->|$)|<[^>\n]*>/g)) hide(m.index, m.index + m[0].length);
  for (const m of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const pipe = m[0].indexOf('|');
    hide(m.index, m.index + (pipe < 0 ? m[0].indexOf('[[') + 2 : pipe + 1));
    hide(m.index + m[0].length - 2, m.index + m[0].length);
  }
  for (const m of text.matchAll(/!?\[([^\]\n]*)\]\([^\n]*?\)/g)) {
    const open = m[0].indexOf('['); hide(m.index, m.index + open + 1);
    hide(m.index + open + 1 + m[1].length, m.index + m[0].length);
  }
  const source = masked.join(''), forward = [], backward = [];
  let cursor = 0;
  for (const part of parts) {
    const at = source.indexOf(part, cursor);
    if (at < 0) return null;
    forward.push(at); cursor = at + part.length;
  }
  cursor = source.length;
  for (let i = parts.length - 1; i >= 0; i--) {
    const at = source.lastIndexOf(parts[i], cursor - parts[i].length);
    if (at < 0 || at + parts[i].length > cursor) return null;
    backward[i] = at; cursor = at;
  }
  if (!parts[start.index] || !parts[end.index] || forward[start.index] !== backward[start.index] || forward[end.index] !== backward[end.index]) return null;
  const from = forward[start.index] + start.offset, to = forward[end.index] + end.offset;
  return from < to ? { from, to } : null;
}

function notebookSelectionExtension(plugin) {
  const { ViewPlugin } = require('@codemirror/view');
  plugin.notebookSelectionEditors = new Set();
  return ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; plugin.notebookSelectionEditors.add(view); this.capture(view); }
    update(update) { if (update.selectionSet || update.focusChanged || update.docChanged) this.capture(update.view); }
    capture(view) {
      if (!view.hasFocus) return;
      const range = view.state.selection.main;
      plugin.notebookSelection = range.empty ? null : { view, from: range.from, to: range.to, text: view.state.doc.toString(), canvasNode: plugin.canvasNodeForEditor(view.dom) };
    }
    destroy() {
      plugin.notebookSelectionEditors.delete(this.view);
      // Native Canvas destroys its editor when a toolbar or dialog takes focus.
      if (plugin.notebookSelection?.view === this.view && !plugin.notebookSelection.canvasNode) plugin.notebookSelection = null;
    }
  });
}

class NotebookTextColorModal extends Modal {
  constructor(plugin, selection) { super(plugin.app); this.plugin = plugin; this.textSelectionSnapshot = selection; }
  onOpen() {
    const root = this.contentEl; root.addClass('tn-text-color-modal'); this.modalEl.addClass('tn-color-dialog');
    root.createEl('h2', { text: 'Textfarbe' });
    root.createEl('p', { cls: 'tn-color-subtitle', text: this.textSelectionSnapshot ? 'Eine Farbkachel färbt deinen markierten Text ein.' : 'Text in einer Seite oder Canvas-Karte markieren, um ihn einzufärben.' });
    const preview = root.createDiv('tn-text-color-preview');
    preview.createSpan({ text: 'VORSCHAU', cls: 'tn-color-eyebrow' });
    const selected = this.textSelectionSnapshot;
    this.previewText = preview.createDiv({ cls: 'tn-color-preview-text', text: selected ? selected.text.slice(selected.from, selected.to).replace(/<[^>]*>/g, '').slice(0, 140) : 'Deine eigene Textfarbe' });
    const formats = selected ? notebookImportedFormats(selected.text).filter(run => run.from < selected.to && run.to > selected.from) : [];
    const initial = formats[0]?.color || '#5B9BD5';
    if (formats[0]?.style.includes('font-weight:700')) this.previewText.style.fontWeight = '700';
    if (formats[0]?.style.includes('font-size:1.2em')) this.previewText.style.fontSize = '1.2em';
    root.createEl('h3', { text: 'Standardfarben' });
    const grid = root.createDiv('tn-color-standard-grid');
    for (const [name, color] of NOTEBOOK_TEXT_COLORS) this.colorTile(grid, name, color);
    const heading = root.createDiv('tn-color-saved-heading');
    heading.createEl('h3', { text: 'Meine Farben' });
    heading.createSpan({ text: 'Im Vault gespeichert', cls: 'tn-color-caption' });
    this.savedGrid = root.createDiv('tn-color-saved-grid'); this.renderSavedColors();
    const form = root.createEl('form', { cls: 'tn-color-create' });
    form.createEl('h3', { text: 'Eigene Farbe' });
    const fields = form.createDiv('tn-color-fields');
    this.picker = fields.createEl('input', { type: 'color', attr: { 'aria-label': 'Eigene Farbe auswählen' } });
    const hexLabel = fields.createEl('label', { text: 'Hex-Farbwert' });
    this.hex = hexLabel.createEl('input', { type: 'text', attr: { 'aria-label': 'Hex-Farbwert', placeholder: '#5B9BD5', maxlength: '7', spellcheck: 'false' } });
    const nameLabel = fields.createEl('label', { text: 'Name (optional)' });
    this.colorName = nameLabel.createEl('input', { type: 'text', attr: { 'aria-label': 'Name der Farbe', placeholder: 'z. B. Geheimnis', maxlength: '32' } });
    this.hex.value = initial; this.picker.value = initial.toLowerCase(); this.updatePreview(initial);
    this.picker.oninput = () => { this.hex.value = this.picker.value.toUpperCase(); this.updatePreview(this.hex.value); };
    this.hex.oninput = () => { const color = notebookHexColor(this.hex.value); this.hex.setAttribute('aria-invalid', String(!color)); if (color) { this.picker.value = color.toLowerCase(); this.updatePreview(color); } };
    const actions = form.createDiv('tn-color-create-actions');
    actions.createEl('button', { type: 'button', text: 'Als Kachel speichern' }).onclick = () => this.saveCustom(false);
    this.saveApply = actions.createEl('button', { type: 'submit', text: 'Speichern & anwenden', cls: 'mod-cta' }); this.saveApply.disabled = !selected;
    form.onsubmit = event => { event.preventDefault(); this.saveCustom(true); };
    this.status = root.createDiv({ cls: 'tn-color-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const footer = root.createDiv('tn-color-footer');
    const remove = footer.createEl('button', { text: 'Textfarbe entfernen' }); remove.disabled = !selected; remove.onclick = () => this.apply(null);
    footer.createEl('button', { text: 'Schließen' }).onclick = () => this.close();
  }
  colorTile(parent, name, color, saved = false) {
    const wrapper = saved ? parent.createDiv('tn-color-saved-tile') : parent;
    const button = wrapper.createEl('button', { type: 'button', cls: 'tn-color-tile' + (saved ? ' tn-color-named' : ''), attr: { title: name + ' · ' + color, 'aria-label': name + ', ' + color } });
    button.style.setProperty('--tn-swatch', color); button.style.setProperty('--tn-swatch-ink', readableColor(color));
    button.createSpan({ cls: 'tn-color-chip', text: 'A' });
    if (saved) button.createSpan({ cls: 'tn-color-tile-name', text: name });
    button.disabled = !this.textSelectionSnapshot;
    button.onmouseenter = () => this.updatePreview(color);
    // Obsidian auto-focuses the first tile on open. Only keyboard navigation
    // should change the preview, otherwise the initial white tile hides it.
    button.onkeyup = event => { if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) this.updatePreview(color); };
    button.onmouseleave = () => this.updatePreview(notebookHexColor(this.hex?.value) || '#5B9BD5');
    button.onclick = () => this.apply(color);
    if (saved) {
      const remove = wrapper.createEl('button', { type: 'button', cls: 'tn-color-delete', attr: { title: name + ' aus der Palette entfernen', 'aria-label': name + ' aus der Palette entfernen' } });
      setIcon(remove, 'x');
      remove.onclick = () => {
        this.plugin.removeNotebookTextSwatch(color); this.renderSavedColors(); this.status.textContent = 'Farbkachel entfernt. Bereits eingefärbter Text behält seine Farbe.';
        this.savedGrid.querySelector('button')?.focus();
      };
    }
  }
  renderSavedColors() {
    this.savedGrid.empty();
    const colors = this.plugin.data.textColorSwatches || [];
    for (const { name, color } of colors) this.colorTile(this.savedGrid, name, color, true);
    if (!colors.length) this.savedGrid.createEl('p', { cls: 'tn-color-empty', text: 'Deine eigenen Farben erscheinen hier als Kacheln.' });
  }
  updatePreview(color) { this.previewText.style.color = color; }
  saveCustom(apply) {
    const color = notebookHexColor(this.hex.value);
    if (!color) { this.status.textContent = 'Bitte einen Hex-Farbwert eingeben, zum Beispiel #5B9BD5.'; this.hex.setAttribute('aria-invalid', 'true'); this.hex.focus(); return; }
    // Validate and apply first, so a stale selection leaves the dialog and inputs intact.
    if (apply && !this.apply(color, false)) return;
    this.plugin.saveNotebookTextSwatch(color, this.colorName.value); this.renderSavedColors();
    this.status.textContent = 'Farbkachel gespeichert.';
    if (apply) this.close();
  }
  apply(color, close = true) {
    try { this.plugin.applyNotebookColor(this.textSelectionSnapshot, color); if (close) this.close(); return true; }
    catch (error) { this.status.textContent = error.message; return false; }
  }
  onClose() { this.contentEl.empty(); }
}

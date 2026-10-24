'use strict';
const { Plugin, ItemView, Modal, Notice, Menu, TFile, TFolder, normalizePath, setIcon, FileView, WorkspaceLeaf, MarkdownRenderer, Component, Scope, EditorSuggest, FuzzySuggestModal, PluginSettingTab } = require('obsidian');
const VIEW = 'classic-notebook-pages';
const MAX_PAGE_DEPTH = 5;
const LIGHT = ['#dce8c8', '#f6d2ae', '#ddc9b7', '#efc5df', '#f1bfc2', '#d9cae9', '#c4ddf1', '#d8dce4', '#d2e7b7', '#d5e3ee', '#f2e1ae'];
const DARK = ['#3b513e', '#654e3c', '#554638', '#62475b', '#644448', '#51435f', '#3e5367', '#494d59', '#465a38', '#405566', '#62583b'];
const COLOR_NAMES = ['Grün', 'Orange', 'Braun', 'Rosa', 'Rot', 'Violett', 'Blau', 'Grau', 'Hellgrün', 'Türkis', 'Gelb'];
const DEFAULTS = { section: '', group: '', groups: [], order: [''], lastPages: {}, groupSections: {}, sectionColors: {}, pageLayouts: {}, collapsedPages: {}, pageMeta: {}, pagePositions: {}, pageSort: 'original', hiddenFolders: [], ribbonHidden: false, classicColors: true, newPageFormat: 'canvas', collapseExplorerOnStart: false };
const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const basename = path => path.split('/').at(-1);
const readableColor = hex => {
  const luminance = value => {
    const rgb = value.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const bg = luminance(hex), dark = '#29282d', light = '#f0e7f3';
  const contrast = color => { const fg = luminance(color); return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05); };
  return contrast(dark) > contrast(light) ? dark : light;
};

// Display-only links: Markdown and explicit links remain untouched.
const autoLinkKey = value => String(value).normalize('NFC').replace(/[’‘]/g, "'").replace(/[\t ]+/g, ' ').trim().toLocaleLowerCase('de');
const autoLinkEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const autoLinkWord = value => !!value && /[\p{L}\p{N}_’']/u.test(value);

class NotebookLinkIndex {
  constructor(entries = []) {
    const groups = new Map();
    for (const entry of entries) {
      if (!entry?.alias?.trim()) continue;
      const key = autoLinkKey(entry.alias), old = groups.get(key), priority = entry.priority || 0;
      if (!old || old.priority < priority) groups.set(key, { priority, entries: [entry] });
      else if (old.priority === priority) old.entries.push(entry);
    }
    this.rules = [];
    for (const [key, group] of groups) {
      const targets = new Set(group.entries.map(e => e.path || ''));
      if (targets.size !== 1 || !group.entries[0].path) continue;
      const entry = group.entries[0];
      this.rules.push({ ...entry, key, sensitive: group.entries.every(e => !!e.sensitive) });
    }
    this.rules.sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias, 'de'));
    this.lookup = new Map(this.rules.map(e => [e.key, e]));
    const patterns = this.rules.map(e => autoLinkEscape(e.alias.trim()).replace(/[’‘']/g, "['’‘]").replace(/[\t ]+/g, '[\\t ]+'));
    this.matcher = patterns.length ? new RegExp(patterns.join('|'), 'giu') : null;
  }
  find(text, sourcePath = '') {
    if (!this.matcher) return [];
    const source = sourcePath.replace(/\.md$/i, ''), found = [];
    this.matcher.lastIndex = 0;
    for (const match of text.matchAll(this.matcher)) {
      const from = match.index, to = from + match[0].length, rule = this.lookup.get(autoLinkKey(match[0]));
      if (!rule || source === rule.path || autoLinkWord(text[from - 1]) || autoLinkWord(text[to])) continue;
      if (rule.sensitive && match[0].normalize('NFC').replace(/[’‘]/g, "'").replace(/[\t ]+/g, ' ') !== rule.alias.normalize('NFC').replace(/[’‘]/g, "'").replace(/[\t ]+/g, ' ')) continue;
      found.push({ from, to, text: match[0], path: rule.path });
    }
    return found;
  }
}

function notebookProtectedMarkdown(text) {
  const ranges = [];
  const add = (from, to) => ranges.push({ from, to });
  // Explicit links, incomplete links, inline code, URLs, HTML, math and comments.
  const tokens = /!?\[\[[^\n]*?(?:\]\]|(?=\n|$))|!?\[(?:[^\]\\]|\\.)*\]\([^\n]*?\)|!?\[(?:[^\]\\]|\\.)*\]\[[^\]\n]*\]|`+[^\n]*?`+|`[^\n]*|<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)|(?:https?:\/\/|mailto:|obsidian:\/\/)[^\s<>]+|<[^>\n]*>|\$\$[\s\S]*?(?:\$\$|$)|\$[^$\n]+\$/g;
  for (const match of text.matchAll(tokens)) add(match.index, match.index + match[0].length);
  let offset = 0, fence = null, yaml = text.startsWith('---\n') || text.startsWith('---\r\n');
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (yaml) { add(offset, offset + line.length); if (offset && /^---\s*$/.test(line)) yaml = false; }
    else if (fence) {
      add(offset, offset + line.length);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = null;
    } else if (marker) { fence = marker[1]; add(offset, offset + line.length); }
    else if (/^(?: {4}|\t)|^\s{0,3}(?:#{1,6}\s|\[[^\]]+\]:)/.test(line)) add(offset, offset + line.length);
    offset += line.length;
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function notebookOverlaps(ranges, from, to) {
  let low = 0, high = ranges.length;
  while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid].to <= from) low = mid + 1; else high = mid; }
  return low < ranges.length && ranges[low].from < to;
}

function notebookEditorLinks(plugin) {
  const { ViewPlugin, Decoration } = require('@codemirror/view');
  const { StateEffect } = require('@codemirror/state');
  const { syntaxTree } = require('@codemirror/language');
  const { editorInfoField, editorLivePreviewField } = require('obsidian');
  plugin.autoLinkEffect = StateEffect.define();
  plugin.autoLinkEditors = new Set();
  return ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; plugin.autoLinkEditors.add(view); this.build(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.some(t => t.effects.some(e => e.is(plugin.autoLinkEffect))) || syntaxTree(update.startState) !== syntaxTree(update.state)) this.build(update.view);
    }
    build(view) {
      this.decorations = Decoration.none;
      if (!plugin.data.autoLinksEnabled || !plugin.autoLinkIndex || view.state.field(editorLivePreviewField, false) === false) return;
      const text = view.state.doc.toString(), sourcePath = view.state.field(editorInfoField, false)?.file?.path || '';
      const blocked = notebookProtectedMarkdown(text), syntax = [];
      syntaxTree(view.state).iterate({ enter(node) {
        if (/(?:link|url|code|comment|math|frontmatter|hashtag|html)/i.test(node.name)) { syntax.push({ from: node.from, to: node.to }); return false; }
      } });
      syntax.sort((a, b) => a.from - b.from);
      const marks = [], seen = new Set();
      for (const visible of view.visibleRanges) {
        const start = view.state.doc.lineAt(visible.from).from, end = view.state.doc.lineAt(visible.to).to;
        for (const hit of plugin.autoLinkIndex.find(text.slice(start, end), sourcePath)) {
          const from = start + hit.from, to = start + hit.to;
          if (seen.has(from) || notebookOverlaps(blocked, from, to) || notebookOverlaps(syntax, from, to)) continue;
          seen.add(from);
          marks.push(Decoration.mark({ class: 'tn-auto-link cm-tn-auto-link', attributes: { 'data-tn-target': hit.path, role: 'link', title: hit.path + ' (Strg+Klick öffnen)' } }).range(from, to));
        }
      }
      this.decorations = Decoration.set(marks, true);
    }
    destroy() { plugin.autoLinkEditors.delete(this.view); }
  }, {
    decorations: value => value.decorations,
    eventHandlers: { mousedown(event, view) {
      if ((!event.ctrlKey && !event.metaKey) || event.button !== 0) return false;
      const target = event.target?.closest?.('.cm-tn-auto-link');
      if (!target?.dataset.tnTarget) return false;
      event.preventDefault(); event.stopPropagation();
      const source = view.state.field(editorInfoField, false)?.file?.path || '';
      void plugin.app.workspace.openLinkText(target.dataset.tnTarget, source, !!event.shiftKey);
      return true;
    } }
  });
}

class NotebookLinksModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onOpen() {
    const p = this.plugin;
    this.contentEl.addClass('tn-links-modal');
    this.contentEl.createEl('h2', { text: 'Automatische Verknüpfungen' });
    this.contentEl.createEl('p', { text: 'Bekannte Namen und Begriffe werden in der Leseansicht klickbar. Beim Bearbeiten: Strg+Klick. Die Zuordnungen gelten nur für diesen Vault und verändern den Notiztext nicht. Vorhandene Links behalten ihr Ziel.' });
    const enabled = this.contentEl.createEl('label', { cls: 'tn-links-enabled' });
    const toggle = enabled.createEl('input', { type: 'checkbox' }); toggle.checked = p.data.autoLinksEnabled;
    enabled.createSpan({ text: ' Automatische Verknüpfungen aktivieren' });
    toggle.onchange = () => { p.data.autoLinksEnabled = toggle.checked; p.persist(); p.rebuildAutoLinks(); };
    const form = this.contentEl.createDiv('tn-links-form');
    const wordLabel = form.createEl('label', { text: 'Name oder Begriff' });
    this.word = wordLabel.createEl('input', { type: 'text', attr: { placeholder: 'z. B. Beispielname', 'aria-label': 'Name oder Begriff' } });
    const pathLabel = form.createEl('label', { text: 'Zielseite' });
    const listId = 'tn-link-targets-' + Date.now();
    this.path = pathLabel.createEl('input', { type: 'text', attr: { placeholder: 'z. B. Wissen/Übersicht', 'aria-label': 'Zielseite', list: listId } });
    const targets = form.createEl('datalist', { attr: { id: listId } });
    for (const file of (p.app.vault.getFiles?.()||p.app.vault.getMarkdownFiles()).filter(notebookIsPage).sort((a, b) => a.path.localeCompare(b.path, 'de'))) targets.createEl('option', { attr: { value: file.path.replace(/\.md$/, '') } });
    const actions = this.contentEl.createDiv('tn-modal-actions');
    actions.createEl('button', { text: 'Zuordnung speichern', cls: 'mod-cta' }).onclick = () => {
      const alias = this.word.value.trim();
      if (alias.length < 2 || /[\r\n[\]<>]/.test(alias)) { new Notice('Bitte einen Namen oder Begriff mit mindestens zwei Zeichen eingeben.'); return; }
      const file = p.resolveAutoLinkTarget(this.path.value.trim());
      if (!file) { new Notice('Bitte eine vorhandene Seite als Ziel auswählen.'); return; }
      p.data.autoLinkRules[autoLinkKey(alias)] = { alias, path: file.path.replace(/\.md$/, ''), sensitive: false };
      p.persist(); p.rebuildAutoLinks(); this.renderList(); new Notice('Zuordnung gespeichert: ' + alias + ' → ' + file.basename);
    };
    this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Weitere Begriffe stammen aus dem importierten Wissensregister und aus den Alias-Eigenschaften deiner Seiten. Eigene Zuordnungen haben Vorrang. Diese Anzeige-Links erscheinen nicht als dauerhafte Verweise im Graphen oder in den Rückverweisen.' });
    this.search = this.contentEl.createEl('input', { type: 'search', cls: 'tn-links-search', attr: { placeholder: 'Zuordnungen filtern …', 'aria-label': 'Zuordnungen filtern' } });
    this.search.oninput = () => this.renderList();
    this.status = this.contentEl.createEl('p', { cls: 'setting-item-description' });
    this.list = this.contentEl.createDiv('tn-links-list');
    this.renderList();
    this.contentEl.createDiv('tn-modal-actions').createEl('button', { text: 'Schließen' }).onclick = () => this.close();
  }
  renderList() {
    const p = this.plugin, query = autoLinkKey(this.search.value || ''), rows = new Map();
    for (const rule of p.autoLinkIndex?.rules || []) rows.set(rule.key, rule);
    for (const [key, rule] of Object.entries(p.data.autoLinkRules)) if (!rule.path) rows.set(key, { ...rule, key });
    const matches = [...rows.values()].filter(r => autoLinkKey(r.alias + ' ' + (r.path || '')).includes(query)).sort((a, b) => a.alias.localeCompare(b.alias, 'de'));
    this.status.textContent = `${p.autoLinkIndex?.rules.length || 0} aktive Zuordnungen${query ? ', ' + matches.length + ' Treffer' : ''}. Zum Ändern einen Begriff anklicken.`;
    this.list.empty();
    for (const rule of matches.slice(0, 100)) {
      const row = this.list.createDiv('tn-link-rule');
      const edit = row.createEl('button', { text: rule.alias, cls: 'tn-link-word' });
      edit.onclick = () => { this.word.value = rule.alias; this.path.value = rule.path || ''; this.path.focus(); };
      row.createSpan({ text: rule.path || 'Deaktiviert', cls: 'tn-link-destination' });
      const key = autoLinkKey(rule.alias), custom = Object.hasOwn(p.data.autoLinkRules, key);
      const remove = row.createEl('button', { text: custom ? 'Zurücksetzen' : 'Deaktivieren' });
      remove.onclick = () => {
        if (custom) delete p.data.autoLinkRules[key];
        else p.data.autoLinkRules[key] = { alias: rule.alias, path: '' };
        p.persist(); p.rebuildAutoLinks(); this.renderList();
      };
    }
    if (matches.length > 100) this.list.createEl('p', { text: 'Bitte die Suche verwenden, um weitere Zuordnungen zu finden.' });
  }
  onClose() { this.contentEl.empty(); }
}

const notebookAutoLinkMethods = {
  async setupAutoLinks() {
    const file = this.manifest.dir + '/reference-links.json';
    this.autoLinkSeed = await this.app.vault.adapter.exists(file) ? JSON.parse(await this.app.vault.adapter.read(file)) : [];
    this.autoLinkRoots = new Map();
    this.rebuildAutoLinks();
    this.registerMarkdownPostProcessor((element, context) => {
      this.autoLinkRoots.set(element, context.sourcePath);
      this.renderAutoLinks(element, context.sourcePath);
    }, 100);
    this.registerEditorExtension(notebookEditorLinks(this));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleAutoLinks()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleAutoLinks()));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const before = oldPath.replace(/\.md$/, ''), after = file.path.replace(/\.md$/, '');
      for (const rule of Object.values(this.data.autoLinkRules)) {
        if (rule.path === before || rule.path?.startsWith(before + '/')) rule.path = after + rule.path.slice(before.length);
      }
      // Store only path changes; shipped mappings otherwise remain the defaults.
      this.data.autoLinkMoves ||= [];
      this.data.autoLinkMoves.push([before, after]);
      this.persist(); this.scheduleAutoLinks();
    }));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleAutoLinks()));
    this.registerEvent(this.app.vault.on('create', () => this.scheduleAutoLinks()));
  },
  resolveAutoLinkTarget(value) {
    const path = String(value || '').replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '');
    const file = this.app.vault.getAbstractFileByPath(path) || this.app.vault.getAbstractFileByPath(path + '.md') || this.app.vault.getAbstractFileByPath(path + '.canvas') || this.app.metadataCache.getFirstLinkpathDest(path, '');
    return notebookIsPage(file) ? file : null;
  },
  scheduleAutoLinks() { window.clearTimeout(this.autoLinkTimer); this.autoLinkTimer = window.setTimeout(() => this.rebuildAutoLinks(), 250); },
  rebuildAutoLinks() {
    const entries = [], remap = path => {
      // Replay moves in insertion order, including moves of enclosing sections.
      for (const [before, after] of this.data.autoLinkMoves || []) if (path === before || path.startsWith(before + '/')) path = after + path.slice(before.length);
      return path;
    };
    for (const rule of this.autoLinkSeed || []) {
      const path = remap(rule.path);
      if (this.resolveAutoLinkTarget(path)) entries.push({ ...rule, path, priority: 20 });
    }
    for (const file of (this.app.vault.getFiles?.() || this.app.vault.getMarkdownFiles()).filter(notebookIsPage)) {
      if (this.data.hiddenFolders.some(folder => file.path.startsWith(folder + '/'))) continue;
      const aliases = this.frontmatter(file).aliases;
      for (const alias of typeof aliases === 'string' ? [aliases] : Array.isArray(aliases) ? aliases : []) {
        if (typeof alias === 'string' && alias.trim().length >= 2) entries.push({ alias: alias.trim(), path: file.path.replace(/\.md$/, ''), sensitive: alias.trim().length < 4, priority: 10 });
      }
    }
    for (const rule of Object.values(this.data.autoLinkRules || {})) entries.push({ ...rule, path: rule.path && this.resolveAutoLinkTarget(rule.path) ? rule.path : '', priority: 100 });
    this.autoLinkIndex = new NotebookLinkIndex(entries);
    for (const [element, path] of this.autoLinkRoots || []) {
      if (element.isConnected) this.renderAutoLinks(element, path);
      else this.autoLinkRoots.delete(element);
    }
    for (const view of this.autoLinkEditors || []) view.dispatch({ effects: this.autoLinkEffect.of(null) });
  },
  renderAutoLinks(element, sourcePath) {
    for (const anchor of element.querySelectorAll('a.tn-auto-link')) anchor.replaceWith(anchor.ownerDocument.createTextNode(anchor.textContent));
    element.normalize();
    if (!this.data.autoLinksEnabled || !this.autoLinkIndex) return;
    const doc = element.ownerDocument, blocked = 'a,code,pre,script,style,textarea,h1,h2,h3,h4,h5,h6,svg,math,.frontmatter,.metadata-container,.internal-embed,.math,.mermaid,[data-tn-no-auto-links]';
    const walker = doc.createTreeWalker(element, 4), nodes = [];
    for (let node; (node = walker.nextNode());) if (node.parentElement && !node.parentElement.closest(blocked)) nodes.push(node);
    for (const node of nodes) {
      const matches = this.autoLinkIndex.find(node.nodeValue, sourcePath);
      if (!matches.length) continue;
      const fragment = doc.createDocumentFragment(); let offset = 0;
      for (const hit of matches) {
        fragment.append(doc.createTextNode(node.nodeValue.slice(offset, hit.from)));
        const anchor = doc.createElement('a'); anchor.className = 'internal-link tn-auto-link';
        anchor.textContent = hit.text; anchor.dataset.href = hit.path; anchor.setAttribute('href', hit.path);
        anchor.setAttribute('title', hit.path); anchor.setAttribute('aria-label', hit.text + ': ' + hit.path);
        anchor.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          void this.app.workspace.openLinkText(hit.path, sourcePath, !!(event.ctrlKey || event.metaKey));
        };
        fragment.append(anchor); offset = hit.to;
      }
      fragment.append(doc.createTextNode(node.nodeValue.slice(offset))); node.replaceWith(fragment);
    }
  },
  unloadAutoLinks() {
    window.clearTimeout(this.autoLinkTimer);
    for (const [element] of this.autoLinkRoots || []) for (const anchor of element.querySelectorAll('a.tn-auto-link')) anchor.replaceWith(anchor.ownerDocument.createTextNode(anchor.textContent));
    this.autoLinkRoots?.clear();
  }
};


// @include inline-text-formats

// Native Canvas remains the file format and owns all card editing and positioning.
const notebookIsPage = file => file instanceof TFile && ['md', 'canvas'].includes(file.extension);
function notebookCreatedDate(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const options = timeZone ? { timeZone } : {};
  return {
    iso: date.toISOString(),
    date: new Intl.DateTimeFormat('de-DE', { ...options, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('de-DE', { ...options, hour: '2-digit', minute: '2-digit' }).format(date)
  };
}

// @include color-edit

// @include text-color-palette

const nativeNotebookMethods = {
  canvasNodeForEditor(dom) {
    // Canvas closes its temporary Markdown editor when a colour dialog takes focus.
    // Keep the native node object so its own setter, history and save path can apply the edit.
    for (const leaf of this.app.workspace.getLeavesOfType('canvas')) {
      const canvas = leaf.view.canvas;
      if (!canvas?.nodes?.values) continue;
      for (const node of canvas.nodes.values()) if (node.nodeEl?.contains(dom) && typeof node.setText === 'function') return { canvas, node };
    }
    return null;
  },
  setupNativeNotebookPages() {
    this.register(()=>{for(const host of this.app.workspace.containerEl.querySelectorAll('.cn-notebook-page-sidebar'))host.classList.remove('cn-notebook-page-sidebar');});
    this.registerEditorExtension(notebookSelectionExtension(this));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.notebookSelection = null; this.colorButtonSelection = null; }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      if (!editor.getSelection()) return;
      const selection = { editor, text: editor.getValue(), from: editor.posToOffset(editor.getCursor('from')), to: editor.posToOffset(editor.getCursor('to')), canvasNode: this.notebookSelection?.canvasNode };
      menu.addItem(item => item.setTitle('Textfarbe …').setIcon('palette').onClick(() => new NotebookTextColorModal(this, selection).open()));
    }));
    this.addCommand({ id: 'notebook-text-color', name: 'Markierten Text einfärben', callback: () => this.showNotebookTextColors() });
    this.addCommand({ id: 'new-notebook-markdown-page', name: 'Neue Textseite (Markdown)', checkCallback: checking => {if(this.data.nativeCanvasOnly)return false;if(!checking)this.newPage(null,'md');return true;} });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleNotebookHeaders()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleNotebookHeaders()));
    this.app.workspace.onLayoutReady(() => {
      if (!this._loaded) return;
      this.notebookHeaderObserver = new MutationObserver(() => this.scheduleNotebookHeaders());
      this.notebookHeaderObserver.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
      this.scheduleNotebookHeaders();
      const file = this.app.workspace.getActiveFile(); if (notebookIsPage(file)) this.followFile(file);
    });
  },
  scheduleNotebookHeaders() {
    if (!this._loaded) return;
    if (this.notebookHeaderFrame) return;
    this.notebookHeaderFrame = window.requestAnimationFrame(() => { this.notebookHeaderFrame = 0; this.renderNotebookHeaders(); });
  },
  pageCreated(file) {
    const original = this.frontmatter(file).created;
    if (original && notebookCreatedDate(original)) return original;
    this.data.pageMeta ||= {};
    if (!this.data.pageMeta[file.path]?.created && file.stat?.ctime) {
      this.data.pageMeta[file.path] = { created: new Date(file.stat.ctime).toISOString() }; this.persist();
    }
    return this.data.pageMeta[file.path]?.created;
  },
  renderNotebookHeaders() {
    if (!this._loaded) return;
    this.syncNotebookSidebarHeaders();
    this.renderCanvasNotebookCards?.();
    for (const kind of ['markdown', 'canvas', SPATIAL_VIEW]) for (const leaf of this.app.workspace.getLeavesOfType(kind)) {
      const view = leaf.view, file = view.file; if (!notebookIsPage(file)) continue;
      const date = notebookCreatedDate(this.pageCreated(file), this.data.dateTimeZone); if (!date) continue;
      const content = view.contentEl; if (!content) continue;
      let header;
      if (kind === 'markdown') {
        const title = view.inlineTitleEl; if (!title?.parentElement) continue;
        header = title.parentElement.querySelector(':scope > .tn-created-stamp');
        if (!header) { header = document.createElement('div'); header.className = 'tn-created-stamp'; title.after(header); }
      } else {
        content.classList.add('tn-dated-page');
        header = content.querySelector(':scope > .tn-native-page-header');
        if (!header) {
          header = document.createElement('div'); header.className = 'tn-native-page-header';
          const title = header.createDiv('tn-native-page-title');
          title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '1');
          header.createDiv('tn-created-stamp'); content.prepend(header);
        }
        const title = header.querySelector('.tn-native-page-title'), label = this.frontmatter(file).title || file.basename;
        this.bindNotebookPageTitle(title, file, label);
        header = header.querySelector('.tn-created-stamp');
      }
      const key = file.path + date.iso;
      if (header.dataset.key !== key) {
        header.empty(); header.dataset.key = key;
        header.createEl('time', { text: date.date, attr: { datetime: date.iso } });
        header.createEl('time', { text: date.time, attr: { datetime: date.iso } });
        header.setAttribute('aria-label', 'Angelegt: ' + date.date + ', ' + date.time);
      }
    }
    if (this.tabBar && !this.colorButton) {
      this.colorButton = document.createElement('button'); this.colorButton.className = 'tn-icon-button tn-text-color';
      this.colorButton.title = 'Markierten Text einfärben'; this.colorButton.setAttribute('aria-label', this.colorButton.title);
      setIcon(this.colorButton, 'palette'); this.themeButton.before(this.colorButton);
      const capture = event => {
        this.colorButtonSelection = this.captureNotebookTextSelection();
        event.preventDefault(); event.stopPropagation();
      };
      this.colorButton.addEventListener('pointerdown', capture, true);
      this.colorButton.addEventListener('mousedown', event => event.preventDefault());
      this.colorButton.onclick = () => {
        const selection = this.colorButtonSelection || this.captureNotebookTextSelection(); this.colorButtonSelection = null;
        this.showNotebookTextColors(selection);
      };
    }
  },
  initializeNotebookTextSwatches() {
    const migrate = !Array.isArray(this.data.textColorSwatches);
    const standards = new Set(NOTEBOOK_TEXT_COLORS.map(([, color]) => color));
    const oldColors = (this.data.customTextColors || []).map(notebookHexColor).filter(color => color && !standards.has(color));
    this.data.textColorSwatches = notebookSavedTextColors(migrate ? oldColors.map(color => ({ color, name: color })) : this.data.textColorSwatches);
    if (migrate) this.persist();
  },
  saveNotebookTextSwatch(color, name) {
    const normalized = notebookHexColor(color);
    if (!normalized) throw new Error('Ungültiger Farbwert.');
    this.data.textColorSwatches = notebookSavedTextColors([...(this.data.textColorSwatches || []), { color: normalized, name }]);
    this.persist();
  },
  removeNotebookTextSwatch(color) {
    this.data.textColorSwatches = (this.data.textColorSwatches || []).filter(entry => entry.color !== color);
    this.persist();
  },
  renderedCanvasTextSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0), element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!element || element.closest('.cm-editor')) return null;
    const rendered = element.closest('.markdown-rendered');
    if (!rendered || !rendered.contains(range.startContainer) || !rendered.contains(range.endContainer)) return null;
    const canvasNode = this.canvasNodeForEditor(rendered);
    if (!canvasNode || canvasNode.canvas.readonly || typeof canvasNode.node.text !== 'string') return null;
    const walker = document.createTreeWalker(rendered, 4), nodes = [];
    for (let node; (node = walker.nextNode());) {
      if (node.nodeValue && !node.parentElement.closest('svg,style,script,.copy-code-button,.collapse-indicator')) nodes.push(node);
    }
    const boundary = (container, offset, end) => {
      const index = nodes.indexOf(container);
      if (index >= 0) return { index, offset };
      // Browser selections can end at an element boundary rather than a text node.
      const probe = document.createRange(); probe.setStart(container, offset); probe.collapse(true);
      for (let i = 0; i < nodes.length; i++) if (probe.comparePoint(nodes[i], nodes[i].length) >= 0) {
        if (end && i > 0 && probe.comparePoint(nodes[i], 0) > 0) return { index: i - 1, offset: nodes[i - 1].length };
        return { index: i, offset: 0 };
      }
      return nodes.length ? { index: nodes.length - 1, offset: nodes.at(-1).length } : null;
    };
    const start = boundary(range.startContainer, range.startOffset, false), end = boundary(range.endContainer, range.endOffset, true);
    if (!start || !end) return null;
    const text = canvasNode.node.text, mapped = notebookRenderedTextRange(text, nodes.map(node => node.nodeValue), start, end);
    return mapped ? { ...mapped, text, canvasNode } : null;
  },
  captureNotebookTextSelection() {
    for (const view of this.notebookSelectionEditors || []) if (view.hasFocus) {
      const range = view.state.selection.main;
      this.notebookSelection = range.empty ? null : { view, from: range.from, to: range.to, text: view.state.doc.toString(), canvasNode: this.canvasNodeForEditor(view.dom) };
      return this.validNotebookTextSelection(this.notebookSelection);
    }
    const rendered = this.renderedCanvasTextSelection();
    if (rendered) this.notebookSelection = rendered;
    return this.validNotebookTextSelection(this.notebookSelection);
  },
  validNotebookTextSelection(snapshot) {
    if (!snapshot || snapshot.from >= snapshot.to) return null;
    if (snapshot.canvasNode?.canvas.readonly) return null;
    if (snapshot.editor) return snapshot.editor.getValue() === snapshot.text ? snapshot : null;
    if (snapshot.view?.dom.isConnected) return snapshot.view.state.doc.toString() === snapshot.text && !snapshot.view.state.readOnly ? snapshot : null;
    const { canvas, node } = snapshot.canvasNode || {};
    return node && canvas.nodes.get(node.id) === node && node.text === snapshot.text && !canvas.readonly ? snapshot : null;
  },
  showNotebookTextColors(selection = this.captureNotebookTextSelection()) {
    new NotebookTextColorModal(this, this.validNotebookTextSelection(selection)).open();
  },
  applyNotebookColor(selection, color) {
    if (!this.validNotebookTextSelection(selection)) throw new Error('Die Textauswahl ist nicht mehr aktuell. Bitte den Text erneut markieren.');
    const { editor, view, text, canvasNode } = selection;
    const change = notebookColorEdit(text, selection.from, selection.to, color);
    const liveEditor = editor ? editor.getValue() === text : view?.dom.isConnected && view.state.doc.toString() === text;
    const nativeNode = canvasNode?.node, canvas = canvasNode?.canvas;
    if (!liveEditor && nativeNode && canvas.nodes.get(nativeNode.id) === nativeNode && nativeNode.text === text && !canvas.readonly) {
      nativeNode.setText(text.slice(0, change.from) + change.insert + text.slice(change.to));
      canvas.requestSave();
    } else if (!liveEditor) throw new Error('Der Text wurde inzwischen geändert. Bitte erneut markieren.');
    else if (editor) {
      editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to)); editor.focus();
    } else { view.dispatch({ changes: change, selection: { anchor: change.from + change.insert.length }, scrollIntoView: true }); view.focus(); }
    this.notebookSelection = null;
    if (color) {
      this.data.customTextColors = [...new Set([...(this.data.customTextColors || []), color])];
      this.persist(); this.refreshCustomTextColors();
    }
  },
  refreshCustomTextColors() {
    const doc = this.app.workspace.containerEl.ownerDocument;
    if (!this.notebookTextColorSheet) {
      this.notebookTextColorSheet = new doc.defaultView.CSSStyleSheet();
      this.notebookTextColorDocument = doc;
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, this.notebookTextColorSheet];
    }
    this.notebookTextColorSheet.replaceSync( (this.data.customTextColors || []).filter(color => /^#[0-9A-F]{6}$/.test(color)).map(color => {
      // Lift dark custom colours for the dark page background while retaining their hue.
      const rgb = color.slice(1).match(/../g).map(v => parseInt(v, 16));
      const light = value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
      const lum = values => .2126 * light(values[0]) + .7152 * light(values[1]) + .0722 * light(values[2]);
      let values = rgb;
      for (let mix = 0; mix <= 1 && (lum(values) + .05) / (.015 + .05) < 4.5; mix += .025) values = rgb.map(v => Math.round(v + (255 - v) * mix));
      return `.theme-dark.classic-notebook .tn-import-format[data-tn-color="${color}"]{color:rgb(${values.join(',')})!important}`;
    }).join('\n'));
  },
  unloadNativeNotebookPages() {
    this.notebookHeaderObserver?.disconnect(); window.cancelAnimationFrame(this.notebookHeaderFrame);
    if (this.notebookTextColorSheet) {
      const doc = this.notebookTextColorDocument;
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(sheet => sheet !== this.notebookTextColorSheet);
      this.notebookTextColorSheet = null; this.notebookTextColorDocument = null;
    }
    this.notebookSelection = null;
    for (const node of document.querySelectorAll('.tn-native-page-header,.tn-created-stamp')) node.remove();
    for (const node of document.querySelectorAll('.tn-dated-page')) node.classList.remove('tn-dated-page');
  }
};


const SPATIAL_VIEW = 'classic-notebook-free-page';
const spatialMarker = (id, kind) => `<!-- tn-box:${id}:${kind} -->`;
function spatialMarkerExtension() {
  const { StateField } = require('@codemirror/state');
  const { Decoration, EditorView } = require('@codemirror/view');
  const { editorLivePreviewField } = require('obsidian');
  const build = state => {
    const mode = state.field(editorLivePreviewField, false) !== false, marks = [];
    if (mode) {
      const text = state.doc.toString();
      for (const match of text.matchAll(/^<!-- tn-box:[a-z0-9]+:(?:start|end) -->\r?$/gm)) {
        const end = match.index + match[0].length;
        marks.push(Decoration.replace({ block: true }).range(match.index, end + (text[end] === '\n' ? 1 : 0)));
      }
    }
    return { mode, decorations: Decoration.set(marks, true) };
  };
  return StateField.define({ create: build, update: (value, transaction) => transaction.docChanged || value.mode !== (transaction.state.field(editorLivePreviewField, false) !== false) ? build(transaction.state) : value,
    provide: field => EditorView.decorations.from(field, value => value.decorations) });
}
function spatialBlocks(text) {
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (frontmatter?.[0].includes('<!-- tn-box:')) throw new Error('Ein Textkasten steht in den Dateieigenschaften. Bitte die Textansicht prüfen.');
  const blocks = new Map(), expression = /^<!-- tn-box:([a-z0-9]+):start -->\r?\n([\s\S]*?)^<!-- tn-box:\1:end -->(?:\r?\n|$)/gm;
  for (const match of text.matchAll(expression)) {
    if (blocks.has(match[1])) throw new Error('Ein Textkasten ist doppelt markiert. Bitte die Textansicht prüfen.');
    blocks.set(match[1], { id: match[1], text: match[2].replace(/\r?\n$/, ''), from: match.index, to: match.index + match[0].length });
  }
  return blocks;
}
function spatialReplace(text, id, expected, replacement) {
  const block = spatialBlocks(text).get(id);
  if (!block) throw new Error('Der Textkasten fehlt inzwischen. Deine Eingabe bleibt zum Kopieren geöffnet.');
  if (block.text !== expected) throw new Error('Dieser Textkasten wurde inzwischen anderswo geändert. Deine Eingabe bleibt zum Kopieren geöffnet.');
  if (/<!--\s*tn-box:/.test(replacement)) throw new Error('Die Textkasten-Markierungen bitte nur in der Textansicht bearbeiten.');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const value = replacement.replace(/\r?\n/g, newline).replace(/[\r\n]+$/, '');
  return text.slice(0, block.from) + spatialMarker(id, 'start') + newline + value + newline + spatialMarker(id, 'end') + newline + text.slice(block.to);
}
function spatialPlain(text) { return text.replace(/!?\[\[([^\]]+)\]\]/g, (_, inner) => inner.split('|').at(-1)).replace(/[*_~`#]/g, '').replace(/\s+/g, ' ').trim(); }
function spatialAppendBlock(text, id, value) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const block = newline + spatialMarker(id, 'start') + newline + value + newline + spatialMarker(id, 'end') + newline;
  const frontmatterEnd = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0].length || 0;
  const footer = text.lastIndexOf(newline + '---' + newline);
  const footerInsideBox = [...spatialBlocks(text).values()].some(box => footer >= box.from && footer < box.to);
  return footer >= frontmatterEnd && !footerInsideBox ? text.slice(0, footer) + block + text.slice(footer) : text + block;
}
function spatialParagraphKey(text) {
  return spatialPlain(text.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, value => ({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[value.toLowerCase()]).replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')).normalize('NFC').replace(/[‘’]/g, "'");
}
function spatialTextMetrics(element, metrics) {
  if (!metrics) return;
  if (typeof metrics.fontFamily === 'string') element.style.fontFamily = metrics.fontFamily;
  for (const [property, key] of [['fontSize','fontSizePt'],['lineHeight','lineHeightPt']]) {
    const value = Number(metrics[key]); if (Number.isFinite(value) && value >= 5 && value <= 200) element.style[property] = value + 'pt';
  }
}
function spatialBoxWidth(box) { return box.width + (box.typography ? 26 : 0); }
function spatialParagraphSpacing(element, markdown, typography) {
  spatialTextMetrics(element, typography);
  const chunks = [], expression = /([^\n](?:[^\n]|\n(?!\n))*)(\n{2,}|$)/g;
  for (const match of markdown.replace(/\r\n/g, '\n').matchAll(expression)) chunks.push({ text: spatialParagraphKey(match[1]), gap: match[2].length >= 3 ? 22.79 : 0 });
  const source = (typography?.paragraphs || []).map(row => ({...row, key: spatialParagraphKey(row.text)}));
  let cursor = 0, sourceCursor = 0;
  for (const p of element.querySelectorAll(':scope > p, :scope > .el-p > p')) {
    const text = spatialParagraphKey(p.innerText ?? p.textContent);
    const at = chunks.findIndex((chunk, index) => index >= cursor && chunk.text === text);
    if (at >= 0) {
      p.style.marginTop = typography ? (chunks[at - 1]?.gap || 0) + 'px' : '0';
      p.style.marginBottom = typography ? '0' : chunks[at].gap + 'px'; cursor = at + 1;
    }
    const original = source.findIndex((row, index) => index >= sourceCursor && row.key === text);
    if (original >= 0) {
      const row = source[original]; sourceCursor = original + 1;
      spatialTextMetrics(p, row);
      p.style.marginTop = Math.max(0, Number(row.emptyBeforePt || 0) + Number(row.spaceBeforePt || 0)) + 'pt';
      p.style.marginBottom = Math.max(0, Number(row.spaceAfterPt || 0)) + 'pt';
    }
  }
}

function spatialNavigationTarget(text, state = {}) {
  let offset, needle;
  const match = state.match, first = match?.matches?.[0];
  if (match?.content === text && first) {
    offset = first[0]; needle = text.slice(first[0], first[1]);
  } else {
    const position = state.startLoc || (Number.isFinite(state.line) ? { line: state.line } : state.cursor?.from);
    if (!Number.isFinite(position?.line) || position.line < 0) return null;
    const lines = text.split('\n'), line = Math.min(position.line, lines.length - 1);
    offset = lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0) + Math.min(position.col ?? position.ch ?? 0, lines[line].length);
    needle = lines[line].trim();
  }
  const blocks = [...spatialBlocks(text).values()];
  const block = blocks.find(block => offset >= block.from && offset < block.to) || (offset < blocks[0]?.from ? blocks[0] : null);
  return { id: block?.id || null, needle: spatialPlain(needle.replace(/<[^>]*>/g, '')) };
}

class SpatialPageView extends FileView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.editors = new Map(); this.renderVersion = 0; }
  getViewType() { return SPATIAL_VIEW; }
  getDisplayText() { return this.file ? (this.plugin.frontmatter(this.file).title || this.file.basename) : 'Freie Notizbuchseite'; }
  getIcon() { return 'panels-top-left'; }
  // File routing chooses this view only when the destination has a saved layout.
  canAcceptExtension() { return false; }
  async onOpen() {
    await super.onOpen();
    this.contentEl.addClass('tn-free-page');
    this.toolbar = this.contentEl.createDiv('tn-free-toolbar');
    this.toolbar.createSpan({ cls: 'tn-free-title', text: 'Gesamtansicht' });
    this.toolbar.createEl('button', { text: '＋ Textkasten', attr: { title: 'Neuen frei positionierbaren Textkasten hinzufügen' } }).onclick = () => this.addBox();
    this.toolbar.createEl('button', { text: 'Textansicht', attr: { title: 'Dieselbe Datei als normalen Markdown-Text öffnen' } }).onclick = () => this.openText();
    const zoom = this.toolbar.createEl('select', { attr: { 'aria-label': 'Vergrößerung der freien Seite' } });
    for (const [value, label] of [[0.6,'60 %'],[0.8,'80 %'],[1,'100 %'],[1.2,'120 %'],[1.5,'150 %']]) zoom.createEl('option', { text: label, attr: { value: String(value) } });
    zoom.value = '1'; this.zoomSelect = zoom;
    zoom.onchange = () => { if (this.layout) { this.layout.zoom = Number(zoom.value); this.applyZoom(); this.plugin.persist(); } };
    this.status = this.toolbar.createSpan('tn-free-status');
    this.viewport = this.contentEl.createDiv('tn-free-viewport');
    this.viewport.onscroll = () => {
      if (this.layout) { this.layout.scrollTop = this.viewport.scrollTop; this.layout.scrollLeft = this.viewport.scrollLeft; this.plugin.persist(); }
    };
    this.registerDomEvent(this.viewport, 'click', event => this.openInternalLink(event));
    this.scaled = this.viewport.createDiv('tn-free-scaled');
    this.board = this.scaled.createDiv('tn-free-board');
    this.viewport.ondblclick = event => {
      if (event.target !== this.board && event.target !== this.viewport && event.target !== this.scaled) return;
      const rect = this.board.getBoundingClientRect();
      void this.addBox({ x: Math.max(24, (event.clientX - rect.left) / this.zoom), y: Math.max(48, (event.clientY - rect.top) / this.zoom) });
    };
    const host = this.contentEl.ownerDocument.defaultView || window;
    this.registerDomEvent(host, 'pointermove', event => this.movePointer(event), { capture: true });
    this.registerDomEvent(host, 'pointerup', () => this.endPointer(), { capture: true });
    this.registerDomEvent(host, 'pointercancel', () => this.endPointer(), { capture: true });
    this.registerEvent(this.app.vault.on('modify', file => { if (file === this.file) void this.loadText(); }));
    this.registerEvent(this.app.workspace.on('css-change', () => { if (this.file) void this.loadText(); }));
    this.registerEvent(this.app.vault.on('rename', file => { if (file === this.file) this.layout = this.plugin.data.spatialLayouts[file.path]; }));
  }
  openInternalLink(event) {
    if (event.defaultPrevented || event.button !== 0 || !this.file) return;
    const link = event.target.closest?.('a.internal-link');
    if (!link || !this.viewport.contains(link)) return;
    const destination = link.getAttribute('data-href') || link.getAttribute('href');
    if (!destination) return;
    event.preventDefault(); event.stopPropagation();
    void this.app.workspace.openLinkText(destination, this.file.path, !!(event.ctrlKey || event.metaKey));
  }
  async onLoadFile(file) {
    this.layout = this.plugin.data.spatialLayouts[file.path];
    if (!this.layout) { new Notice('Für diese Seite gibt es noch kein freies Layout.'); window.setTimeout(() => { void this.openText(); }, 0); return; }
    await this.loadText(); this.plugin.refresh();
  }
  async onUnloadFile() {
    // Drafts are already copied into plugin data on each input.
    this.renderVersion++; this.pendingSpatialLocation = null; this.renderingText = false;
    this.endPointer(); this.renderComponent?.unload(); this.renderComponent = null;
    for (const editor of this.editors.values()) editor.releaseScope?.();
    this.editors.clear(); this.board?.empty(); this.layout = null;
  }
  async onClose() { await super.onClose(); }
  async openText() { if (this.file) await this.plugin.openSpatialText(this.leaf, this.file); }
  setEphemeralState(state) {
    super.setEphemeralState?.(state);
    this.pendingSpatialLocation = state;
    this.revealSpatialLocation();
  }
  revealSpatialLocation() {
    if (!this.pendingSpatialLocation || this.loadedPath !== this.file?.path || !this.cards || this.renderingText) return;
    const target = spatialNavigationTarget(this.sourceText, this.pendingSpatialLocation);
    this.pendingSpatialLocation = null;
    if (!target) return;
    const card = target.id ? this.cards.get(target.id) : this.remainder;
    if (!card?.isConnected) return;
    for (const previous of this.board.querySelectorAll('.tn-free-search-target')) previous.removeClass('tn-free-search-target');
    card.addClass('tn-free-search-target');
    const content = card.querySelector('.tn-free-card-content') || card;
    let rect = card.getBoundingClientRect();
    if (target.needle) {
      const walker = content.ownerDocument.createTreeWalker(content, 4), nodes = []; let node, visible = '';
      while ((node = walker.nextNode())) { nodes.push({ node, start: visible.length }); visible += node.textContent; }
      const at = visible.indexOf(target.needle);
      if (at >= 0) {
        const first = nodes.find(part => part.start + part.node.length > at), last = nodes.find(part => part.start + part.node.length >= at + target.needle.length);
        if (first && last) {
          const range = content.ownerDocument.createRange();
          range.setStart(first.node, at - first.start); range.setEnd(last.node, at + target.needle.length - last.start);
          rect = range.getBoundingClientRect();
        }
      }
    }
    const viewport = this.viewport.getBoundingClientRect();
    if (rect.top < viewport.top + 35 || rect.bottom > viewport.bottom - 35) this.viewport.scrollTop += rect.top - viewport.top - 50;
    const cardRect = card.getBoundingClientRect();
    if (cardRect.left < viewport.left || cardRect.left > viewport.right - 80) this.viewport.scrollLeft += cardRect.left - viewport.left - 24;
  }
  async loadText() {
    if (!this.file || !this.layout || !this.board) return;
    const file = this.file, version = ++this.renderVersion;
    const text = await this.app.vault.read(file);
    if (version !== this.renderVersion || this.file !== file) return;
    this.sourceText = text;
    let blocks;
    try { blocks = spatialBlocks(text); } catch (error) { new Notice(error.message); return; }
    // Never replace an active editor after a file-system update.
    if (this.editors.size) { this.status.textContent = 'Änderung erkannt. Offene Eingaben werden beim Speichern geprüft.'; return; }
    this.renderComponent?.unload(); this.renderComponent = new Component(); this.renderComponent.load();
    const scroll = this.loadedPath === file.path ? { top: this.viewport.scrollTop, left: this.viewport.scrollLeft } : { top: this.layout.scrollTop || 0, left: this.layout.scrollLeft || 0 };
    this.loadedPath = file.path; this.cards = new Map(); this.remainder = null; this.board.empty(); this.renderingText = true;
    const used = new Set(), renders = [];
    for (const box of this.layout.boxes) {
      const block = blocks.get(box.id);
      if (!block) continue;
      used.add(box.id); renders.push(this.renderBox(box, block.text));
    }
    const unplaced = [...blocks.values()].filter(block => !used.has(block.id));
    const missing = this.layout.boxes.filter(box => !blocks.has(box.id)).length;
    if (unplaced.length || missing) this.status.textContent = 'Textkasten-Markierungen wurden geändert: bitte die Textansicht prüfen.';
    else this.status.textContent = 'Kopf ziehen · Ecke zum Vergrößern · Doppelklick zum Bearbeiten';
    // Source links and text outside the marked boxes remain accessible here.
    let remainder = text;
    for (const block of [...blocks.values()].reverse()) remainder = remainder.slice(0, block.from) + remainder.slice(block.to);
    remainder = remainder.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    if (remainder) {
      const extra = this.board.createDiv({ cls: 'tn-free-remainder markdown-rendered' });
      this.remainder = extra;
      extra.style.left = '24px'; extra.style.top = (this.extent().height - 100) + 'px';
      renders.push(MarkdownRenderer.render(this.app, remainder, extra, file.path, this.renderComponent));
    }
    await Promise.all(renders);
    if (version !== this.renderVersion || this.file !== file) return;
    this.renderingText = false;
    this.zoomSelect.value = String(this.layout.zoom || 1); this.applyZoom(); this.viewport.scrollTop = scroll.top; this.viewport.scrollLeft = scroll.left;
    this.revealSpatialLocation();
  }
  extent() {
    return { width: Math.max(1000, ...this.layout.boxes.map(b => b.x + spatialBoxWidth(b) + 60)), height: Math.max(600, ...this.layout.boxes.map(b => b.y + Math.max(b.height, this.cards?.get(b.id)?.offsetHeight || 0) + 160)) };
  }
  applyZoom() {
    if (!this.layout) return;
    this.zoom = Math.max(0.4, Math.min(2, Number(this.layout.zoom) || 1));
    const extent = this.extent();
    this.board.style.width = extent.width + 'px'; this.board.style.height = extent.height + 'px';
    this.board.style.transform = `scale(${this.zoom})`; this.scaled.style.width = extent.width * this.zoom + 'px'; this.scaled.style.height = extent.height * this.zoom + 'px';
    if (this.remainder) this.remainder.style.top = extent.height - 100 + 'px';
  }
  renderBox(box, text) {
    const card = this.board.createDiv('tn-free-card'); card.dataset.box = box.id;
    this.cards.set(box.id, card);
    card.toggleClass('tn-free-margin-note', box.label !== 'Verlauf');
    Object.assign(card.style, { left: box.x + 'px', top: box.y + 'px', width: spatialBoxWidth(box) + 'px', minHeight: box.height + 'px', zIndex: String(10 + (box.z || 0)) });
    const header = card.createDiv('tn-free-card-header');
    header.createSpan({ text: box.label, cls: 'tn-free-card-label' });
    const edit = header.createEl('button', { cls: 'tn-icon-button', attr: { title: box.label + ' bearbeiten', 'aria-label': box.label + ' bearbeiten' } }); setIcon(edit, 'pencil');
    edit.onclick = () => this.editBox(box, card, text);
    header.onpointerdown = event => { if (event.button !== 0 || event.target.closest('button') || this.editors.has(box.id)) return; this.startPointer(event, box, card, 'move'); };
    const content = card.createDiv({ cls: 'tn-free-card-content markdown-rendered' });
    const rendered = MarkdownRenderer.render(this.app, text, content, this.file.path, this.renderComponent).then(() => {
      spatialParagraphSpacing(content, text, box.typography);
      if (card.isConnected) this.applyZoom();
      const draft = this.plugin.data.spatialDrafts?.[this.file?.path]?.[box.id];
      if (draft && card.isConnected) this.editBox(box, card, draft.expected, draft.value);
    });
    content.ondblclick = event => { if (event.target.closest('a,button,input,textarea')) return; this.editBox(box, card, text); };
    const resize = card.createEl('button', { cls: 'tn-free-resize', attr: { title: box.label + ': Größe ändern', 'aria-label': box.label + ': Größe ändern' } });
    resize.onpointerdown = event => { if (event.button === 0 && !this.editors.has(box.id)) this.startPointer(event, box, card, 'resize'); };
    return rendered;
  }
  startPointer(event, box, card, mode) {
    event.preventDefault(); event.stopPropagation();
    this.drag = { box, card, mode, x: event.clientX, y: event.clientY, left: box.x, top: box.y, width: box.width, height: box.height, handle: event.currentTarget, pointerId: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    card.addClass('is-moving');
  }
  movePointer(event) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - drag.x) / this.zoom, dy = (event.clientY - drag.y) / this.zoom;
    if (drag.mode === 'move') {
      drag.box.x = Math.round(Math.max(8, drag.left + dx)); drag.box.y = Math.round(Math.max(38, drag.top + dy));
      drag.card.style.left = drag.box.x + 'px'; drag.card.style.top = drag.box.y + 'px';
    } else {
      drag.box.width = Math.round(Math.max(150, drag.width + dx)); drag.box.height = Math.round(Math.max(70, drag.height + dy));
      drag.card.style.width = spatialBoxWidth(drag.box) + 'px'; drag.card.style.minHeight = drag.box.height + 'px';
    }
    this.applyZoom();
  }
  endPointer() {
    if (!this.drag) return;
    const drag = this.drag; this.drag = null; drag.card.removeClass('is-moving');
    try { drag.handle.releasePointerCapture(drag.pointerId); } catch {}
    this.plugin.persist();
  }
  editBox(box, card, expected, value = expected) {
    if (this.editors.has(box.id)) return;
    if (this.editors.size) { new Notice('Bitte den offenen Textkasten zuerst speichern oder abbrechen.'); return; }
    const content = card.querySelector('.tn-free-card-content'); content.empty();
    const input = content.createEl('textarea', { cls: 'tn-free-editor', attr: { 'aria-label': box.label + ': Text bearbeiten', spellcheck: 'true' } });
    input.value = value; input.style.minHeight = Math.max(100, Math.min(680, card.clientHeight - 20)) + 'px';
    const controls = content.createDiv('tn-free-edit-actions');
    const file = this.file;
    this.editors.set(box.id, { input, expected });
    const remember = () => {
      this.plugin.data.spatialDrafts ||= {}; this.plugin.data.spatialDrafts[file.path] ||= {};
      this.plugin.data.spatialDrafts[file.path][box.id] = { expected, value: input.value }; this.plugin.persist();
    };
    input.oninput = remember;
    const forget = () => { this.editors.get(box.id)?.releaseScope?.(); delete this.plugin.data.spatialDrafts?.[file.path]?.[box.id]; this.editors.delete(box.id); this.plugin.persist(); };
    const save = controls.createEl('button', { text: 'Speichern', cls: 'mod-cta' });
    const commit = async () => {
      if (save.disabled) return; save.disabled = true;
      try {
        await this.app.vault.process(file, current => spatialReplace(current, box.id, expected, input.value));
        forget(); await this.loadText();
      } catch (error) { remember(); new Notice(error.message || 'Der Text konnte nicht gespeichert werden.'); save.disabled = false; }
    };
    save.onclick = commit;
    const cancel = async () => { forget(); await this.loadText(); };
    controls.createEl('button', { text: 'Abbrechen' }).onclick = cancel;
    controls.createSpan({ text: 'Strg+Enter speichert · Esc verwirft die Eingabe', cls: 'setting-item-description' });
    input.onkeydown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void commit(); }
      if (event.key === 'Escape') { event.preventDefault(); forget(); void this.loadText(); }
    };
    // An input-local Obsidian scope takes priority over the global Ctrl+Enter command.
    const scope = new Scope(this.app.scope); let pushed = false;
    const releaseScope = () => { if (pushed) { this.app.keymap.popScope(scope); pushed = false; } };
    this.editors.get(box.id).releaseScope = releaseScope;
    for (const key of ['Enter', 's']) scope.register(['Mod'], key, () => { void commit(); return false; });
    scope.register([], 'Escape', () => { void cancel(); return false; });
    input.onfocus = () => { if (!pushed) { this.app.keymap.pushScope(scope); pushed = true; } };
    input.onblur = releaseScope;
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  async addBox(position) {
    if (!this.file || !this.layout) return;
    if (this.editors.size) { new Notice('Bitte den offenen Textkasten zuerst speichern oder abbrechen.'); return; }
    const file = this.file, id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const box = { id, label: 'Randnotiz ' + this.layout.boxes.length, x: position?.x ?? Math.round(this.viewport.scrollLeft / this.zoom + 700), y: position?.y ?? Math.round(this.viewport.scrollTop / this.zoom + 80), width: 280, height: 130, z: this.layout.boxes.length };
    if (!position) for (let attempt = 0; attempt < this.layout.boxes.length + 1; attempt++) {
      const collision = this.layout.boxes.find(other => box.x < other.x + other.width + 10 && box.x + box.width + 10 > other.x && box.y < other.y + Math.max(other.height, this.cards?.get(other.id)?.offsetHeight || 0) + 40 && box.y + box.height + 40 > other.y);
      if (!collision) break;
      box.y = collision.y + Math.max(collision.height, this.cards?.get(collision.id)?.offsetHeight || 0) + 55;
    }
    try {
      await this.app.vault.process(file, text => spatialAppendBlock(text, id, 'Neue Randnotiz'));
      this.layout.boxes.push(box); this.plugin.persist(); await this.loadText();
      const card = [...this.board.querySelectorAll('.tn-free-card')].find(card => card.dataset.box === id);
      if (card) { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); this.editBox(box, card, 'Neue Randnotiz'); }
    } catch (error) { new Notice(error.message || 'Der Textkasten konnte nicht angelegt werden.'); }
  }
}

const spatialNotebookMethods = {
  async setupSpatialPages() {
    this.data.spatialLayouts = Object.assign({}, this.data.spatialLayouts); this.data.spatialDrafts = Object.assign({}, this.data.spatialDrafts);
    this.spatialTextRequests = new WeakSet();
    const source = this.manifest.dir + '/spatial-import.json';
    if (!this.data.spatialImportApplied && await this.app.vault.adapter.exists(source)) {
      const restored = JSON.parse(await this.app.vault.adapter.read(source));
      for (const [path, layout] of Object.entries(restored)) if (!this.data.spatialLayouts[path]) this.data.spatialLayouts[path] = layout;
      this.data.spatialImportApplied = true;
    }
    const typographyPath = this.manifest.dir + '/spatial-typography.json';
    if (await this.app.vault.adapter.exists(typographyPath)) this.applySpatialTypographyProfile(JSON.parse(await this.app.vault.adapter.read(typographyPath)));
    // Text view is a deliberate, temporary action, never a saved default.
    let migrated = false;
    for (const layout of Object.values(this.data.spatialLayouts)) if (Object.hasOwn(layout, 'preferText')) { delete layout.preferText; migrated = true; }
    if (migrated) this.persist();
    this.registerView(SPATIAL_VIEW, leaf => new SpatialPageView(leaf, this));
    this.setupSpatialNavigation();
    this.registerEditorExtension(spatialMarkerExtension());
    this.addCommand({ id: 'toggle-free-notebook-page', name: 'Gesamtansicht / Textansicht umschalten', checkCallback: checking => {
      if (this.data.nativeCanvasOnly) return false;
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) void this.toggleSpatialPage(file); return true;
    } });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshSpatialButton()));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const changed = path => path === oldPath || path.startsWith(oldPath + '/') ? file.path + path.slice(oldPath.length) : path;
      for (const key of ['spatialLayouts', 'spatialDrafts']) this.data[key] = Object.fromEntries(Object.entries(this.data[key]).map(([path, value]) => [changed(path), value]));
      this.persist();
    }));
  },
  applySpatialTypographyProfile(profile) {
    if (!profile?.version || this.data.spatialTypographyImportVersion === profile.version) return;
    for (const [path, page] of Object.entries(profile.pages || {})) {
      for (const box of this.data.spatialLayouts[path]?.boxes || []) {
        const metrics = page.boxes?.[box.id];
        if (metrics && Number.isFinite(metrics.fontSizePt) && Number.isFinite(metrics.lineHeightPt)) box.typography = metrics;
      }
    }
    this.data.spatialTypographyImportVersion = profile.version; this.persist();
  },
  hasSpatialLayout(path) { return !!this.data.spatialLayouts?.[path]?.boxes?.length && path.endsWith('.md'); },
  setupSpatialNavigation() {
    // Intercept the public leaf state boundary, before Markdown is opened. This
    // also preserves search locations, split/tab options and back/forward state.
    const plugin = this, prototype = WorkspaceLeaf.prototype, original = prototype.setViewState;
    let enabled = true;
    function routedState(state, location) {
      let savedPosition,revision;
      if(enabled&&this.app===plugin.app){
        plugin.notebookNavigationPending||=new WeakMap();
        // Remembering a viewport is optional; it must never prevent opening a page.
        if(!plugin.notebookNavigationPending.has(this))try{plugin.rememberNotebookPagePosition(this.view);}catch(error){console.warn('Classic Notebook: Seitenposition konnte nicht gespeichert werden.',error);}
        try{plugin.clearCanvasNotebookSearch?.(this.view);}catch(error){console.warn('Classic Notebook: Suchmarkierung konnte nicht entfernt werden.',error);}
        plugin.notebookNavigationRevisions||=new WeakMap();revision=(plugin.notebookNavigationRevisions.get(this)||0)+1;plugin.notebookNavigationRevisions.set(this,revision);
        plugin.notebookNavigationPending.set(this,revision);
      }
      if (enabled && this.app === plugin.app && state?.state?.file) {
        const before=state.state.file,replacement=plugin.data.canvasReplacements?.[before];
        if(replacement){
          const pageView=['markdown','canvas',SPATIAL_VIEW].includes(state.type);
          state={...state,...(pageView?{type:'canvas'}:{}),state:{...state.state,file:replacement}};
          const nodeId=pageView&&plugin.canvasNotebookMetadata?.get(replacement)?.fileNodes?.[before];if(nodeId&&location?.match)location={...location,match:{...location.match,nodeId}};
        }
      }
      if (enabled && this.app === plugin.app && state?.type === 'markdown' && plugin.hasSpatialLayout(state.state?.file) && !plugin.spatialTextRequests.has(state)) {
        state = { ...state, type: SPATIAL_VIEW };
      }
      if(enabled&&this.app===plugin.app&&state?.type==='canvas'&&!state.state?.viewState&&!notebookHasNavigationTarget(location)){
        savedPosition=plugin.notebookPagePosition(state.state?.file);
        if(savedPosition)state={...state,state:{...state.state,viewState:savedPosition.viewport}};
      }
      let result;
      try{result=original.call(this,state,location);}catch(error){if(plugin.notebookNavigationPending?.get(this)===revision)plugin.notebookNavigationPending.delete(this);throw error;}
      if(enabled&&this.app===plugin.app)Promise.resolve(result).then(()=>{
        if(!enabled||plugin.notebookNavigationRevisions.get(this)!==revision)return;
        plugin.notebookNavigationPending.delete(this);
        if(state?.type!=='canvas')return;
        const view=this.view;if(view.file?.path!==state.state?.file)return;
        view.__notebookPositionToken=null;
        if(!plugin.canvasNotebookMetadata?.has(view.file.path)&&!plugin.data.pageMeta?.[view.file.path]){if(savedPosition)plugin.restoreNotebookCanvasCardPositions(view,savedPosition);return;}
        view.__notebookInitialViewport=!state.state.viewState;
        const anchor=plugin.canvasNotebookAnchorState?.(view,location);
        delete view.__notebookSearch;
        if(location?.match||anchor)view.__notebookSearch=anchor||location;
        else if(savedPosition)plugin.restoreNotebookCanvasCardPositions(view,savedPosition);
        plugin.hookNotebookEphemeralState(view, () => enabled);
        plugin.scheduleNotebookHeaders?.();
      },()=>{if(plugin.notebookNavigationPending.get(this)===revision)plugin.notebookNavigationPending.delete(this);});
      return result;
    }
    prototype.setViewState = routedState;
    this.register(() => { enabled = false; if (prototype.setViewState === routedState) prototype.setViewState = original; });
    this.app.workspace.onLayoutReady(() => {
      if (!enabled) return;
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        if (!this.hasSpatialLayout(leaf.view.file?.path)) continue;
        const view = leaf.view;
        void (async () => {
          await view.save?.();
          if (enabled && leaf.view === view && this.hasSpatialLayout(view.file?.path)) await leaf.setViewState(leaf.getViewState(), leaf.getEphemeralState());
        })().catch(error => { console.error('Classic Notebook: Gesamtansicht konnte nicht geöffnet werden.', error); new Notice('Die Gesamtansicht konnte nicht geöffnet werden. Bitte erneut versuchen.'); });
      }
    });
  },
  async openSpatialText(leaf, file) {
    const state = { type: 'markdown', state: { file: file.path }, active: true };
    this.spatialTextRequests.add(state);
    try { await leaf.setViewState(state); }
    finally { this.spatialTextRequests.delete(state); }
    this.refreshSpatialButton(); this.scheduleNotebookHeaders?.();
  },
  refreshSpatialButton() {
    if (!this.spatialButton) return;
    const file = this.app.workspace.getActiveFile(), free = this.app.workspace.activeLeaf?.view?.getViewType() === SPATIAL_VIEW;
    this.spatialButton.hidden = !!this.data.nativeCanvasOnly || !file || file.extension !== 'md';
    const title = (free ? 'Zur Textansicht wechseln' : 'Gesamtansicht mit Textkästen öffnen') + ' (Strg+Umschalt+M)';
    this.spatialButton.setAttribute('aria-label', title); this.spatialButton.title = title; setIcon(this.spatialButton, free ? 'file-text' : 'panels-top-left');
  },
  async toggleSpatialPage(file = this.app.workspace.getActiveFile()) {
    if (!file || file.extension !== 'md') return;
    const leaf = this.app.workspace.getMostRecentLeaf?.() || this.app.workspace.getLeaf(false);
    if (leaf.view?.getViewType() === SPATIAL_VIEW && leaf.view.file === file) {
      await this.openSpatialText(leaf, file);
    } else {
      try { await this.ensureSpatialSource(file, leaf); }
      catch (error) { new Notice(error.message || 'Die freie Seite konnte nicht vorbereitet werden.'); return; }
      this.persist();
      await leaf.setViewState({ type: SPATIAL_VIEW, state: { file: file.path }, active: true });
    }
    this.refreshSpatialButton();
    this.scheduleNotebookHeaders?.();
  },
  async ensureSpatialSource(file, leaf) {
    const layout = this.data.spatialLayouts[file.path];
    if (layout && (layout.restored || layout.boxes.length !== 1)) return;
    const view = leaf.view, editor = view?.getViewType?.() === 'markdown' && view.file === file ? view.editor : null;
    const text = editor ? editor.getValue() : await this.app.vault.read(file);
    if (layout && spatialBlocks(text).size) return;
    const newline = text.includes('\r\n') ? '\r\n' : '\n', id = layout?.boxes[0].id || crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const meta = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/), start = meta?.[0].length || 0;
    const wrapped = text.slice(0, start) + spatialMarker(id, 'start') + newline + text.slice(start).replace(/[\r\n]+$/, '') + newline + spatialMarker(id, 'end') + newline;
    if (editor) {
      // Use the live editor so its close-time save cannot restore a stale copy.
      if (editor.getValue() !== text) throw new Error('Die Seite wurde inzwischen geändert. Bitte erneut öffnen.');
      editor.setValue(wrapped); await view.save();
    } else await this.app.vault.process(file, current => {
      if (current !== text) throw new Error('Die Seite wurde inzwischen geändert. Bitte erneut öffnen.');
      return wrapped;
    });
    if (!layout) this.data.spatialLayouts[file.path] = { boxes: [{ id, label: 'Verlauf', x: 24, y: 48, width: 650, height: 500, z: 0 }], zoom: 1 };
  }
};


class NameModal extends Modal {
  constructor(app, title, initial, submit) { super(app); Object.assign(this, { label: title, initial, submit }); }
  onOpen() {
    this.contentEl.createEl('h2', { text: this.label });
    const input = this.contentEl.createEl('input', { type: 'text', value: this.initial, cls: 'tn-name-input', attr: { 'aria-label': this.label } });
    const controls = this.contentEl.createDiv('tn-modal-actions');
    controls.createEl('button', { text: 'Abbrechen' }).onclick = () => this.close();
    const save = controls.createEl('button', { text: 'Speichern', cls: 'mod-cta' });
    const run = async () => {
      if (save.disabled) return;
      const value = input.value.trim();
      if (!value || /[\\/:*?"<>|\u0000-\u001f]/.test(value) || value === '.' || value === '..' || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) { new Notice('Bitte einen gültigen Namen ohne Sonderzeichen wie / oder : eingeben.'); return; } // eslint-disable-line no-control-regex -- Reject ASCII control characters in filenames.
      save.disabled = true;
      try { await this.submit(value); this.close(); }
      catch (error) { new Notice(error.message || 'Der Name konnte nicht gespeichert werden.'); save.disabled = false; }
    };
    save.onclick = run;
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void run(); } };
    input.focus(); input.select();
  }
  onClose() { this.contentEl.empty(); }
}

class SectionColorModal extends Modal {
  constructor(plugin, section) {
    super(plugin.app); this.plugin = plugin; this.section = section;
    this.folder = section ? this.app.vault.getAbstractFileByPath(section) : null;
    this.draft = plugin.hasSectionColor(section) ? { ...plugin.data.sectionColors[section] } : null;
  }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Abschnittsfarbe: ' + this.plugin.sectionName(this.section) });
    this.contentEl.createEl('p', { text: 'Wähle eine Vorgabe oder eigene Farben für das helle und dunkle Design.' });
    const grid = this.contentEl.createDiv('tn-color-grid');
    this.swatches = COLOR_NAMES.map((name, index) => {
      const pair = { light: LIGHT[index], dark: DARK[index] };
      const button = grid.createEl('button', { cls: 'tn-color-swatch', attr: { 'aria-label': name, title: name } });
      button.style.setProperty('--tn-swatch-light', pair.light); button.style.setProperty('--tn-swatch-dark', pair.dark);
      button.createSpan({ cls: 'tn-color-sample' }); button.createSpan({ text: name });
      button.onclick = () => { this.draft = pair; this.updatePreview(); };
      return { button, pair };
    });
    const inputs = this.contentEl.createDiv('tn-color-inputs');
    this.inputs = {};
    for (const [mode, label] of [['light', 'Hell'], ['dark', 'Dunkel']]) {
      const row = inputs.createEl('label', { cls: 'tn-color-input-label' }); row.createSpan({ text: label });
      const input = row.createEl('input', { type: 'color', attr: { 'aria-label': label + ': eigene Abschnittsfarbe' } });
      input.oninput = () => { this.draft = { light: this.inputs.light.value, dark: this.inputs.dark.value }; this.updatePreview(); };
      this.inputs[mode] = input;
    }
    this.preview = this.contentEl.createDiv('tn-color-preview');
    this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Diese Auswahl wird nur in diesem Vault gespeichert.' });
    const controls = this.contentEl.createDiv('tn-modal-actions');
    this.reset = controls.createEl('button', { text: 'Standardfarbe' }); this.reset.onclick = () => { this.draft = null; this.updatePreview(); };
    controls.createEl('button', { text: 'Abbrechen' }).onclick = () => this.close();
    const save = controls.createEl('button', { text: 'Übernehmen', cls: 'mod-cta' });
    save.onclick = () => {
      try {
        if (this.section && this.app.vault.getAbstractFileByPath(this.section) !== this.folder) throw new Error('Der Abschnitt wurde inzwischen geändert. Bitte öffne die Farbauswahl erneut.');
        this.plugin.setSectionColors(this.section, this.draft); this.close();
      } catch (error) { new Notice(error.message || 'Die Farbe konnte nicht gespeichert werden.'); }
    };
    this.updatePreview();
  }
  updatePreview() {
    const pair = this.draft || this.plugin.defaultSectionColors(this.section);
    for (const mode of ['light', 'dark']) this.inputs[mode].value = pair[mode];
    for (const { button, pair: preset } of this.swatches) button.setAttribute('aria-pressed', String(!!this.draft && pair.light === preset.light && pair.dark === preset.dark));
    this.preview.empty();
    for (const [mode, label] of [['light', 'Hell'], ['dark', 'Dunkel']]) {
      const sample = this.preview.createDiv({ cls: 'tn-color-preview-' + mode, text: label + ': ' + this.plugin.sectionName(this.section) });
      sample.style.backgroundColor = pair[mode]; sample.style.color = readableColor(pair[mode]);
    }
    this.reset.disabled = !this.draft;
  }
  onClose() { this.contentEl.empty(); }
}

class DeletePageModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; this.path = file.path; }
  onOpen() {
    const outline = this.plugin.pageOutline(this.plugin.sectionOf(this.file)), item = outline.find(row => row.path === this.path);
    const count = item ? item.end - item.index - 1 : 0;
    this.contentEl.createEl('h2', { text: 'Seite löschen?' });
    this.contentEl.createEl('p', { text: '„' + (this.plugin.frontmatter(this.file).title || this.file.basename) + '“ wird in den Vault-Papierkorb verschoben.' });
    this.contentEl.createEl('p', { text: count ? count + ' ' + (count === 1 ? 'Unterseite bleibt' : 'Unterseiten bleiben') + ' erhalten. Direkte Unterseiten rücken eine Ebene höher; ihre Unterseiten bleiben zugeordnet.' : 'Die Datei lässt sich anschließend aus dem Ordner .trash im Vault wiederherstellen.' });
    const controls = this.contentEl.createDiv('tn-modal-actions');
    this.cancel = controls.createEl('button', { text: 'Abbrechen' }); this.cancel.onclick = () => this.close();
    this.confirmButton = controls.createEl('button', { text: 'In Papierkorb verschieben', cls: 'mod-warning' });
    this.confirmButton.onclick = () => this.confirm(); this.cancel.focus();
  }
  async confirm() {
    if (this.busy) return;
    this.busy = true; this.confirmButton.disabled = true;
    try { await this.plugin.trashPage(this.path, this.file); this.close(); }
    catch (error) { new Notice(error.message || 'Die Seite konnte nicht in den Papierkorb verschoben werden.'); }
    finally { this.busy = false; this.confirmButton.disabled = false; }
  }
  onClose() { this.contentEl.empty(); }
}

class DeleteSectionModal extends Modal {
  constructor(plugin, folder) { super(plugin.app); this.plugin = plugin; this.folder = folder; this.section = folder.path; }
  onOpen() {
    const group = this.plugin.isGroup(this.section), count = this.plugin.sectionContents(this.folder);
    this.contentEl.createEl('h2', { text: (group ? 'Abschnittsgruppe' : 'Abschnitt') + ' löschen?' });
    this.contentEl.createEl('p', { text: '„' + this.folder.name + '“ enthält ' + count.notes + ' ' + (count.notes === 1 ? 'Seite' : 'Seiten') + (count.other ? ' und ' + count.other + ' weitere Dateien' : '') + '.' });
    this.contentEl.createEl('p', { text: 'Der gesamte Ordner mit allen Seiten und Unterordnern wird in den Vault-Papierkorb verschoben. Du kannst ihn dort wiederherstellen.' });
    const controls = this.contentEl.createDiv('tn-modal-actions');
    this.cancel = controls.createEl('button', { text: 'Abbrechen' }); this.cancel.onclick = () => this.close();
    this.confirmButton = controls.createEl('button', { text: 'In Papierkorb verschieben', cls: 'mod-warning' });
    this.confirmButton.onclick = () => this.confirm(); this.cancel.focus();
  }
  async confirm() {
    if (this.busy) return;
    this.busy = true;
    if (this.confirmButton) this.confirmButton.disabled = true;
    try { await this.plugin.trashSection(this.section, this.folder); this.close(); }
    catch (error) { new Notice(error.message || 'Der Abschnitt konnte nicht in den Papierkorb verschoben werden.'); }
    finally { this.busy = false; if (this.confirmButton) this.confirmButton.disabled = false; }
  }
  onClose() { this.contentEl.empty(); }
}

class PagesView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filter = ''; this.renderedSection = null; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Notizbuch-Seiten'; }
  getIcon() { return 'book-open'; }
  async onOpen() {
    this.plugin.bindNotebookPageHistory(this);
    this.contentEl.addClass('tn-pages');
    const heading = this.contentEl.createDiv('tn-pages-heading');
    this.heading = heading.createEl('span');
    const menuButton = heading.createEl('button', { cls: 'tn-icon-button', attr: { 'aria-label': 'Abschnittsmenü', title: 'Abschnittsmenü' } });
    setIcon(menuButton, 'ellipsis');
    menuButton.onclick = event => this.plugin.sectionMenu(event, this.plugin.data.section);
    this.add = this.contentEl.createEl('button', { cls: 'tn-add-page', text: '＋  Seite hinzufügen' });
    this.add.onclick = () => this.plugin.isGroupOverview() ? this.plugin.newSection() : this.plugin.newPage();
    this.search = this.contentEl.createEl('input', { type: 'search', cls: 'tn-page-search', attr: { placeholder: 'Seiten durchsuchen …', 'aria-label': 'Seiten in diesem Abschnitt filtern' } });
    this.search.oninput = () => { this.pendingRevealPath = null; this.filter = this.search.value; this.list.scrollTop = 0; this.renderList(); };
    this.list = this.contentEl.createDiv('tn-page-list');
    this.list.setAttribute('role', 'tree'); this.list.setAttribute('aria-label', 'Seiten im aktuellen Abschnitt');
    this.footer = this.contentEl.createDiv('tn-pages-footer'); this.render();
    const host = this.contentEl.ownerDocument.defaultView || window;
    if (host.ResizeObserver) {
      this.pageListResizeObserver = new host.ResizeObserver(() => this.onResize());
      this.pageListResizeObserver.observe(this.list);
    }
    this.registerDomEvent(host, 'pointermove', event => this.onPagePointerMove(event), { capture: true });
    this.registerDomEvent(host, 'pointerup', event => this.onPagePointerUp(event), { capture: true });
    this.registerDomEvent(host, 'pointercancel', () => this.clearDrag(), { capture: true });
    this.registerDomEvent(host, 'keydown', event => { if (event.key === 'Escape' && this.pointerCandidate) { event.preventDefault(); this.clearDrag(); } }, { capture: true });
  }
  render() {
    if (!this.heading) return;
    const section = this.plugin.data.section;
    if (section !== this.renderedSection) { this.filter = ''; this.search.value = ''; this.renderedSection = section; }
    this.heading.textContent = this.plugin.sectionName(section);
    this.contentEl.style.setProperty('--tn-section', this.plugin.sectionColor(section));
    this.contentEl.style.setProperty('--tn-tab-text', readableColor(this.plugin.sectionColor(section)));
    const isGroup = this.plugin.isGroupOverview(section);
    this.add.textContent = isGroup ? '＋  Abschnitt hinzufügen' : '＋  Seite hinzufügen';
    this.search.disabled = isGroup;
    this.renderList();
  }
  requestReveal(path) { this.pendingRevealPath = path; }
  onResize() {
    if (!this.list) return;
    const size = this.list.clientWidth + 'x' + this.list.clientHeight;
    if (size !== this.revealSize) {
      this.revealSize = size;
      if (!this.pendingRevealPath && Array.from(this.list.children).some(row => row.dataset?.path === this.renderedActivePath)) this.requestReveal(this.renderedActivePath);
    }
    this.queuePageReveal();
  }
  async onClose() {
    const host = this.contentEl.ownerDocument.defaultView || window;
    if (this.revealFrame != null) host.cancelAnimationFrame(this.revealFrame);
    this.pageListResizeObserver?.disconnect();
    this.revealFrame = null; this.pendingRevealPath = null;
  }
  queuePageReveal() {
    const host = this.contentEl.ownerDocument.defaultView || window;
    if (!this.pendingRevealPath || this.revealFrame != null || !host.requestAnimationFrame) return;
    // Read the current rows after layout, including any intervening metadata refresh.
    this.revealFrame = host.requestAnimationFrame(() => {
      this.revealFrame = null;
      const row = Array.from(this.list?.children || []).find(row => row.dataset?.path === this.pendingRevealPath);
      if (!row?.isConnected || !this.list.clientHeight) return;
      const bounds = this.list.getBoundingClientRect(), target = row.getBoundingClientRect();
      if (!target.height) return;
      const top = target.top - bounds.top - this.list.clientTop, bottom = top + target.height;
      const margin = 8, height = this.list.clientHeight;
      // Scroll only this list; the editor and the rest of the workspace keep their positions.
      if (top < margin || target.height > height - 2 * margin) this.list.scrollTop += top - margin;
      else if (bottom > height - margin) this.list.scrollTop += bottom - height + margin;
      this.pendingRevealPath = null;
    });
  }
  renderList() {
    if (!this.list) return;
    const scroll = this.list.scrollTop;
    this.list.empty();
    const outline = this.plugin.pageOutline(), active = this.plugin.notebookActivePage();
    const activePath = outline.some(item => item.path === this.pendingRevealPath) ? this.pendingRevealPath : active?.path;
    if (activePath !== this.renderedActivePath && outline.some(item => item.path === activePath)) this.requestReveal(activePath);
    let query = this.filter.trim().toLocaleLowerCase('de');
    const destination = outline.find(item => item.path === this.pendingRevealPath);
    if (query && destination) {
      const title = this.plugin.frontmatter(destination.file).title || destination.file.basename;
      if (!(title + ' ' + destination.file.basename).toLocaleLowerCase('de').includes(query)) {
        this.filter = ''; this.search.value = ''; query = '';
      }
    }
    const included = new Set();
    if (query) for (const item of outline) {
      const title = this.plugin.frontmatter(item.file).title || item.file.basename;
      if (!(title + ' ' + item.file.basename).toLocaleLowerCase('de').includes(query)) continue;
      included.add(item.path);
      let parent = item.parent;
      while (parent) { included.add(parent); parent = outline.find(row => row.path === parent)?.parent; }
    }
    const visible = outline.filter(item => {
      if (query) return included.has(item.path);
      let parent = item.parent;
      while (parent) {
        if (this.plugin.data.collapsedPages?.[parent]) return false;
        parent = outline.find(row => row.path === parent)?.parent;
      }
      return true;
    });
    for (const item of visible) {
      const file = item.file;
      const meta = this.plugin.frontmatter(file);
      const row = this.list.createDiv('tn-page-row'); row.dataset.path = file.path;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(item.level));
      row.setAttribute('aria-selected', String(activePath === file.path));
      row.style.paddingLeft = `${(item.level - 1) * 20}px`;
      const collapsed = !!this.plugin.data.collapsedPages?.[file.path];
      if (item.hasChildren) {
        row.setAttribute('aria-expanded', String(query ? true : !collapsed));
        const toggle = row.createEl('button', { cls: 'tn-page-toggle', attr: { 'aria-label': 'Unterseiten von ' + (meta.title || file.basename) + (collapsed && !query ? ' ausklappen' : ' einklappen'), title: query ? 'Unterseiten werden während der Suche angezeigt.' : collapsed ? 'Unterseiten ausklappen' : 'Unterseiten einklappen' } });
        toggle.disabled = !!query;
        setIcon(toggle, collapsed && !query ? 'chevron-right' : 'chevron-down');
        toggle.onclick = event => { event.preventDefault(); event.stopPropagation(); this.plugin.togglePageCollapse(file.path); };
        toggle.onmousedown = event => event.stopPropagation();
      } else row.createSpan('tn-page-toggle-spacer');
      const button = row.createEl('button', { cls: 'tn-page', text: meta.title || file.basename });
      button.title = file.path; button.dataset.path = file.path;
      row.toggleClass('is-active', activePath === file.path);
      if (activePath === file.path) button.setAttribute('aria-current', 'page');
      button.onclick = event => { if (Date.now() >= (this.suppressPageClickUntil || 0)) this.plugin.openPage(file, event.ctrlKey || event.metaKey); };
      row.oncontextmenu = event => { event.preventDefault(); this.plugin.pageMenu(event, file); };
      row.onkeydown = event => {
        if (event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); this.plugin.requestDeletePage(file); return;
        }
        if (event.altKey && ['ArrowRight', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); this.plugin.changePageIndent(file, event.key === 'ArrowRight' ? 1 : -1); return;
        }
        if (event.key === 'ArrowRight' && item.hasChildren && collapsed) {
          event.preventDefault(); event.stopPropagation(); this.plugin.togglePageCollapse(file.path);
        } else if (event.key === 'ArrowLeft' && item.hasChildren && !collapsed) {
          event.preventDefault(); event.stopPropagation(); this.plugin.togglePageCollapse(file.path);
        } else if (event.key === 'ArrowLeft' && item.parent) {
          event.preventDefault(); event.stopPropagation(); this.focusPage(item.parent);
        } else if (event.key === 'ArrowRight' && item.hasChildren) {
          event.preventDefault(); event.stopPropagation(); this.focusPage(visible[visible.indexOf(item) + 1]?.path);
        } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const at = visible.indexOf(item), next = visible[at + (event.key === 'ArrowUp' ? -1 : 1)];
          if (next) this.focusPage(next.path);
        }
      };
      row.ondragstart = event => event.preventDefault();
      row.onpointerdown = event => {
        if (event.button !== 0 || event.target.closest?.('.tn-page-toggle')) return;
        this.pointerCandidate = { path: file.path, section: this.plugin.sectionOf(file), row, x: event.clientX, y: event.clientY, id: event.pointerId };
      };
    }
    this.endDrop = this.list.createDiv({ cls: 'tn-page-end-drop', text: 'Als Hauptseite ans Ende' }); this.endDrop.hidden = !this.pageDrag;
    if (!visible.length) {
      const group = this.plugin.isGroupOverview();
      const empty = this.list.createDiv('tn-empty');
      empty.createEl('p', { text: outline.length ? 'Keine passenden Seiten.' : group ? 'Diese Abschnittsgruppe ist noch leer.' : 'Hier ist Platz für deine erste Seite.' });
      if (!outline.length) empty.createEl('button', { text: group ? 'Abschnitt anlegen' : 'Seite anlegen', cls: 'tn-empty-action' }).onclick = () => group ? this.plugin.newSection() : this.plugin.newPage();
    }
    this.footer.textContent = `${outline.length} ${outline.length === 1 ? 'Seite' : 'Seiten'}`;
    this.list.scrollTop = scroll;
    this.renderedActivePath = activePath;
    this.queuePageReveal();
  }
  focusPage(path) {
    for (const row of this.list.children) if (row.dataset?.path === path) row.querySelector('.tn-page')?.focus();
  }
  clearDropMarks() {
    for (const row of this.list.children) row.removeClass('tn-drop-before', 'tn-drop-after', 'tn-drop-inside', 'tn-drop-invalid');
  }
  onPagePointerMove(event) {
    const candidate = this.pointerCandidate;
    if (!candidate || (event.pointerId != null && event.pointerId !== candidate.id)) return;
    if (!this.pageDrag && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 6) return;
    if (candidate.section !== this.plugin.data.section) { this.clearDrag(); return; }
    event.preventDefault(); event.stopPropagation();
    if (!this.pageDrag) {
      this.pageDrag = { path: candidate.path, section: candidate.section, outline: this.plugin.pageOutline() };
      candidate.row.setPointerCapture?.(candidate.id); candidate.row.addClass('is-dragging');
      this.endDrop.hidden = false;
      this.footer.textContent = 'Mitte: Unterseite · oberer/unterer Rand: davor/dahinter';
    }
    this.clearDropMarks(); this.pageDrag.position = null; this.pageDrag.target = null;
    const under = this.list.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    const row = under?.closest('.tn-page-row'), end = under?.closest('.tn-page-end-drop');
    if (end && this.list.contains(end)) { end.addClass('tn-drop-inside'); this.pageDrag.position = 'end'; return; }
    if (!row || !this.list.contains(row)) return;
    const rect = row.getBoundingClientRect(), y = (event.clientY - rect.top) / rect.height;
    const position = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    const plan = this.plugin.planPageMove(this.pageDrag.path, row.dataset.path, position, this.pageDrag.outline);
    row.addClass(plan.error ? 'tn-drop-invalid' : 'tn-drop-' + position);
    if (!plan.error) { this.pageDrag.target = row.dataset.path; this.pageDrag.position = position; }
    const listRect = this.list.getBoundingClientRect();
    if (event.clientY < listRect.top + 28) this.list.scrollTop -= 12;
    else if (event.clientY > listRect.bottom - 28) this.list.scrollTop += 12;
  }
  onPagePointerUp(event) {
    if (!this.pointerCandidate || (event.pointerId != null && event.pointerId !== this.pointerCandidate.id)) return;
    this.onPagePointerMove(event);
    const drag = this.pageDrag;
    if (drag) { event.preventDefault(); event.stopPropagation(); this.suppressPageClickUntil = Date.now() + 400; }
    this.clearDrag();
    if (drag?.position) this.plugin.movePageBranch(drag.path, drag.target, drag.position);
  }
  clearDrag() {
    const candidate = this.pointerCandidate;
    if (candidate?.row.hasPointerCapture?.(candidate.id)) candidate.row.releasePointerCapture(candidate.id);
    this.pointerCandidate = null;
    this.pageDrag = null; this.clearDropMarks();
    for (const row of this.list.children) row.removeClass('is-dragging');
    if (this.endDrop) this.endDrop.hidden = true;
    const count = this.plugin.pages().length; this.footer.textContent = `${count} ${count === 1 ? 'Seite' : 'Seiten'}`;
  }
}

module.exports = class ClassicNotebook extends Plugin {
  async onload() {
    this.data = Object.assign({}, DEFAULTS, await this.loadData());
    const importPath = this.manifest.dir + '/import-settings.json';
    if (await this.app.vault.adapter.exists(importPath)) {
      const imported = JSON.parse(await this.app.vault.adapter.read(importPath));
      if (this.data.importVersion !== imported.version) {
        for (const key of ['groups', 'order', 'pageSort', 'hiddenFolders']) this.data[key] = imported[key];
        this.data.groupSections = Object.assign({}, this.data.groupSections, imported.groupSections);
        this.data.importVersion = imported.version;
        this.persist();
      }
    }
    for (const key of ['lastPages', 'groupSections', 'sectionColors', 'pageLayouts', 'collapsedPages', 'pageMeta', 'pagePositions']) this.data[key] = Object.assign({}, this.data[key]);
    for (const key of ['groups', 'order', 'hiddenFolders']) this.data[key] = [...this.data[key]];
    this.data.autoLinksEnabled ??= true;
    this.data.autoLinkRules = Object.assign({}, this.data.autoLinkRules);
    this.data.autoLinkMoves = [...(this.data.autoLinkMoves || [])];
    this.setupNotebookSettings();
    await this.setupCanvasNotebook();
    await this.setupAutoLinks();
    await this.setupSpatialPages();
    this.setupNativeNotebookPages();
    this.setupNotebookTextLinks();
    this.initializeNotebookTextSwatches();
    this.refreshCustomTextColors();
    this.registerEditorExtension(notebookImportedFormatExtension());
    this.registerEditorExtension(notebookCanvasLayoutExtension());
    this.registerView(VIEW, leaf => new PagesView(leaf, this));
    for (const [type, role] of Object.entries(this.data.legacyViewTypes || {})) {
      if (type !== VIEW && type !== SPATIAL_VIEW && ['pages', 'spatial'].includes(role)) this.registerView(type, leaf => role === 'pages' ? new PagesView(leaf, this) : new SpatialPageView(leaf, this));
    }
    for (const [id, name, callback] of [
      ['notebook-auto-links', 'Automatische Verknüpfungen verwalten', () => new NotebookLinksModal(this).open()],
      ['show-notebook', 'Notizbuch anzeigen', () => this.showPages()],
      ['new-notebook-page', 'Neue Seite im Abschnitt', () => this.newPage()],
      ['new-notebook-section', 'Neuer Abschnitt', () => this.newSection()],
      ['new-notebook-group', 'Neue Abschnittsgruppe', () => this.newGroup()],
      ['parent-notebook-group', 'Zur übergeordneten Abschnittsgruppe', () => this.goBack()],
      ['toggle-notebook-ribbon', 'Symbolleiste links ein-/ausblenden', () => this.toggleRibbon()],
      ['toggle-notebook-theme', 'Hell-/Dunkel-Design umschalten', () => this.toggleTheme()],
      ['notebook-section-color', 'Abschnittsfarbe ändern', () => new SectionColorModal(this, this.data.section).open()]
    ]) this.addCommand({ id, name, callback });
    this.addCommand({ id: 'delete-notebook-section', name: 'Abschnitt löschen', checkCallback: checking => {
      const path = this.data.section, enabled = !!path && !(this.isGroup(path) && path === this.data.group);
      if (enabled && !checking) this.requestDeleteSection(path);
      return enabled;
    } });
    this.addCommand({ id: 'delete-notebook-page', name: 'Seite löschen', checkCallback: checking => {
      const file = this.notebookActivePage();
      if (file && !checking) this.requestDeletePage(file);
      return !!file;
    } });
    this.addCommand({id:'close-sidebar-canvases',name:'Zusätzliche Canvas-Tabs rechts schließen',callback:()=>void this.closeNotebookSidebarCanvases().catch(error=>{console.error('Classic Notebook: Seitenleiste',error);new Notice(error.message||'Die zusätzlichen Tabs konnten nicht geschlossen werden.');})});
    this.addRibbonIcon('book-open', 'Notizbuch-Seiten anzeigen', () => this.showPages());
    this.registerEvent(this.app.workspace.on('file-open', file => this.followFile(file)));
    this.registerEvent(this.app.workspace.on('css-change', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', file => { if (this.sectionOf(file) === this.data.section) this.scheduleRefresh(); }));
    for (const event of ['create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
      if (event === 'rename') this.trackRename(file, oldPath);
      if (event === 'delete') {
        const affected = this.trackDelete(file);
        if (affected && !this.trashingSection) void this.selectSection(this.data.section).catch(() => this.refresh());
      }
      this.scheduleRefresh();
    }));
    this.app.workspace.onLayoutReady(async () => {
      if (!this._loaded) return;
      this.mountTabs();
      for (const section of this.allSections()) if (!Array.isArray(this.data.pageLayouts[section])) this.data.pageLayouts[section] = this.initialPageLayout(section);
      this.persist();
      if (this.data.group && !this.app.vault.getAbstractFileByPath(this.data.group)) this.data.group = '';
      if (this.data.section && !this.app.vault.getAbstractFileByPath(this.data.section)) this.data.section = '';
      if (!this.data.setupComplete) { this.data.setupComplete = true; this.persist(); }
      if (this.data.collapseExplorerOnStart) this.app.workspace.leftSplit?.collapse();
      await this.showPages(); this.refresh();
    });
  }
  onunload() {
    try { this.rememberNotebookPagePositions(); } catch (error) { console.warn('Classic Notebook: Could not remember page positions on unload.', error); }
    this.unloadNativeNotebookPages();
    this.unloadAutoLinks();
    window.clearTimeout(this.refreshTimer);
    if (this.saveTimer) { window.clearTimeout(this.saveTimer); void this.saveData(this.data); }
    this.tabBar?.remove(); document.body.removeClass('classic-notebook', 'cn-classic-colors', 'cn-ribbon-hidden'); document.body.style.removeProperty('--tn-section');
  }
  persist() { window.clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => this.saveData(this.data), 200); }
  scheduleRefresh() { window.clearTimeout(this.refreshTimer); this.refreshTimer = window.setTimeout(() => this.refresh(), 100); }
  isGroup(path) { return this.data.groups.includes(path); }
  isGroupOverview(path = this.data.section) { return this.isGroup(path) && !this.sections(path).includes(path); }
  groupFor(path) { return this.data.groups.filter(g => path === g || path.startsWith(g + '/')).sort((a, b) => b.length - a.length)[0] || ''; }
  parentGroup(group) { return this.data.groups.filter(g => group.startsWith(g + '/') && g !== group).sort((a, b) => b.length - a.length)[0] || ''; }
  sections(group = this.data.group || '') {
    const folder = group ? this.app.vault.getAbstractFileByPath(group) : this.app.vault.getRoot();
    const folders = (folder?.children || []).filter(f => f instanceof TFolder && !f.name.startsWith('.') && !this.data.hiddenFolders.includes(f.path)).map(f => f.path);
    const directPages = group && (folder?.children || []).some(f => notebookIsPage(f));
    const available = new Set(group ? [...(directPages ? [group] : []), ...folders] : ['', ...folders]);
    return [...new Set([...this.data.order.filter(p => available.has(p)), ...[...available].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))])];
  }
  allSections() { return [...new Set(['', ...this.data.groups].flatMap(group => this.sections(group).filter(p => !this.isGroup(p) || p === group)))]; }
  sectionName(path) { return !path || (path === this.data.group && this.isGroup(path) && !this.isGroupOverview(path)) ? 'Allgemein' : basename(path); }
  isDark() { return document.body.classList.contains('theme-dark'); }
  defaultSectionColors(path) {
    const parent = this.groupFor(path);
    const group = path === this.data.group && this.isGroup(path) && !this.isGroupOverview(path) ? path : this.isGroup(path) ? this.parentGroup(path) : parent;
    const index = Math.max(0, this.sections(group).indexOf(path)) % LIGHT.length;
    return { light: LIGHT[index], dark: DARK[index] };
  }
  hasSectionColor(path) {
    const pair = this.data.sectionColors?.[path];
    return !!pair && /^#[0-9a-f]{6}$/i.test(pair.light) && /^#[0-9a-f]{6}$/i.test(pair.dark);
  }
  sectionColor(path) {
    const pair = this.hasSectionColor(path) ? this.data.sectionColors[path] : this.defaultSectionColors(path);
    return pair[this.isDark() ? 'dark' : 'light'];
  }
  setSectionColors(path, pair) {
    if (path && !(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw new Error('Diesen Abschnitt gibt es nicht mehr.');
    if (pair && (!/^#[0-9a-f]{6}$/i.test(pair.light) || !/^#[0-9a-f]{6}$/i.test(pair.dark))) throw new Error('Bitte gültige Farben wählen.');
    this.data.sectionColors ||= {};
    if (pair) this.data.sectionColors[path] = { light: pair.light.toLowerCase(), dark: pair.dark.toLowerCase() };
    else delete this.data.sectionColors[path];
    this.persist(); this.refresh();
  }
  sectionOf(file) {
    const path = file.path; const group = this.groupFor(path);
    const relative = group ? path.slice(group.length + 1) : path;
    if (!relative.includes('/')) return group;
    return (group ? group + '/' : '') + relative.split('/')[0];
  }
  frontmatter(file) { return file.extension === 'canvas' ? {...this.data.pageMeta?.[file.path],...this.canvasNotebookMetadata?.get(file.path)?.frontmatter} : this.app.metadataCache.getFileCache(file)?.frontmatter || {}; }
  sourcePages(section = this.data.section) {
    return (this.app.vault.getFiles?.() || this.app.vault.getMarkdownFiles()).filter(file => notebookIsPage(file) && this.sectionOf(file) === section && !this.data.hiddenPages?.includes(file.path) && !this.data.hiddenFolders.some(p => file.path.startsWith(p + '/')))
      .sort((a, b) => {
        const ao = Number(this.frontmatter(a).onenote_order), bo = Number(this.frontmatter(b).onenote_order);
        const delta = (Number.isFinite(ao) ? ao : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bo) ? bo : Number.MAX_SAFE_INTEGER);
        if (delta) return delta;
        return a.basename.localeCompare(b.basename, 'de', { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path, 'de');
      });
  }
  initialPageLayout(section) {
    const stack = [], result = [];
    for (const file of this.sourcePages(section)) {
      const level = Math.min(MAX_PAGE_DEPTH, stack.length + 1, Math.max(1, Math.trunc(Number(this.frontmatter(file).onenote_level)) || 1));
      result.push({ path: file.path, parent: level > 1 ? stack[level - 2] : null });
      stack[level - 1] = file.path; stack.length = level;
    }
    return result;
  }
  pageOutline(section = this.data.section, alphabetical = this.data.pageSort === 'alphabetical') {
    const files = this.sourcePages(section), byPath = new Map(files.map(file => [file.path, file]));
    const stored = this.data.pageLayouts?.[section], records = new Map();
    for (const entry of Array.isArray(stored) ? stored : this.initialPageLayout(section)) {
      if (entry && typeof entry.path === 'string' && !records.has(entry.path)) records.set(entry.path, { path: entry.path, parent: typeof entry.parent === 'string' ? entry.parent : null });
    }
    for (const file of files) if (!records.has(file.path)) records.set(file.path, { path: file.path, parent: null });
    const nodes = new Map();
    for (const record of records.values()) if (byPath.has(record.path)) {
      let parent = record.parent, nearest = null; const visited = new Set([record.path]);
      while (parent) {
        if (visited.has(parent)) { nearest = null; break; }
        visited.add(parent);
        if (!nearest && byPath.has(parent)) nearest = parent;
        parent = records.get(parent)?.parent || null;
      }
      nodes.set(record.path, { path: record.path, file: byPath.get(record.path), parent: nearest, children: [] });
    }
    const roots = [];
    for (const node of nodes.values()) (nodes.get(node.parent)?.children || roots).push(node);
    const result = [];
    const walk = (siblings, ancestors = []) => {
      if (alphabetical) siblings.sort((a, b) => a.file.basename.localeCompare(b.file.basename, 'de', { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path, 'de'));
      for (const node of siblings) {
        const level = Math.min(MAX_PAGE_DEPTH, ancestors.length + 1), parent = ancestors[Math.min(MAX_PAGE_DEPTH - 1, ancestors.length) - 1]?.path || null;
        result.push({ file: node.file, path: node.path, parent, level });
        walk(node.children, [...ancestors, node]);
      }
    };
    walk(roots);
    for (let index = 0; index < result.length; index++) {
      const item = result[index]; item.index = index; item.end = index + 1;
      while (item.end < result.length && result[item.end].level > item.level) item.end++;
      item.hasChildren = item.end > index + 1;
    }
    return result;
  }
  pages(section = this.data.section) { return this.pageOutline(section).map(item => item.file); }
  refreshPages() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.render?.(); }
  togglePageCollapse(path) {
    const item = this.pageOutline().find(row => row.path === path);
    if (!item?.hasChildren) return;
    this.data.collapsedPages ||= {};
    if (this.data.collapsedPages[path]) delete this.data.collapsedPages[path];
    else this.data.collapsedPages[path] = true;
    this.persist(); this.refreshPages();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.focusPage?.(path);
  }
  revealPage(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const outline = this.pageOutline(this.sectionOf(file)); let parent = outline.find(row => row.path === path)?.parent;
    while (parent) { if (this.data.collapsedPages) delete this.data.collapsedPages[parent]; parent = outline.find(row => row.path === parent)?.parent; }
  }
  planPageMove(source, target, position, outline = this.pageOutline()) {
    const item = outline.find(row => row.path === source), dest = outline.find(row => row.path === target);
    if (!item || (!dest && position !== 'end')) return { error: 'Die Seite ist nicht mehr in diesem Abschnitt.' };
    if (!['before', 'after', 'inside', 'end'].includes(position)) return { error: 'Ungültige Position.' };
    const branch = outline.slice(item.index, item.end);
    if (branch.some(row => row.path === target)) return { error: 'Eine Seite kann nicht unter sich selbst verschoben werden.' };
    const level = position === 'end' ? 1 : dest.level + (position === 'inside' ? 1 : 0);
    const delta = level - item.level;
    if (Math.max(...branch.map(row => row.level + delta)) > MAX_PAGE_DEPTH) return { error: 'Maximal fünf Seitenebenen sind möglich. Die Unterseiten bleiben zusammen.' };
    const rest = outline.filter(row => !branch.some(member => member.path === row.path));
    let at = rest.length;
    if (position !== 'end') {
      at = rest.findIndex(row => row.path === target);
      if (position !== 'before') {
        at++;
        while (at < rest.length && rest[at].level > dest.level) at++;
      }
    }
    const parent = position === 'end' ? null : position === 'inside' ? dest.path : dest.parent;
    const moved = branch.map((row, index) => ({ ...row, level: row.level + delta, parent: index ? row.parent : parent }));
    rest.splice(at, 0, ...moved);
    return { entries: rest, source, target, position };
  }
  commitPagePlan(section, plan) {
    if (plan.error) { new Notice(plan.error); return false; }
    const files = this.sourcePages(section), expected = new Set(files.map(file => file.path)), seen = new Map();
    if (plan.entries.length !== files.length) { new Notice('Die Seitenliste hat sich geändert. Bitte versuche es erneut.'); return false; }
    for (const item of plan.entries) {
      const level = item.parent ? (seen.get(item.parent) || 0) + 1 : 1;
      if (!expected.has(item.path) || seen.has(item.path) || (item.parent && !seen.has(item.parent)) || level > MAX_PAGE_DEPTH || level !== item.level) {
        new Notice('Diese Anordnung ist nicht möglich. Die vorhandene Struktur bleibt erhalten.'); return false;
      }
      seen.set(item.path, level);
    }
    this.data.pageLayouts ||= {}; this.data.collapsedPages ||= {};
    this.data.pageLayouts[section] = plan.entries.map(item => ({ path: item.path, parent: item.parent || null }));
    this.data.pageSort = 'original';
    if (plan.position === 'inside') delete this.data.collapsedPages[plan.target];
    const active = this.app.workspace.getActiveFile?.(); if (active) this.revealPage(active.path);
    this.persist(); this.refreshPages(); return true;
  }
  movePageBranch(source, target, position) {
    return this.commitPagePlan(this.data.section, this.planPageMove(source, target, position));
  }
  pageIndentPlan(file, direction) {
    const section = this.sectionOf(file), outline = this.pageOutline(section), item = outline.find(row => row.path === file.path);
    if (!item) return { error: 'Die Seite ist nicht mehr in diesem Abschnitt.' };
    if (direction < 0) return item.parent ? this.planPageMove(item.path, item.parent, 'after', outline) : { error: 'Die Seite ist bereits auf der ersten Ebene.' };
    for (let index = item.index - 1; index >= 0; index--) {
      const previous = outline[index];
      if (previous.level < item.level) break;
      if (previous.level === item.level && previous.parent === item.parent) return this.planPageMove(item.path, previous.path, 'inside', outline);
    }
    return { error: 'Zum Einrücken wird eine vorherige Seite auf derselben Ebene benötigt.' };
  }
  changePageIndent(file, direction) { return this.commitPagePlan(this.sectionOf(file), this.pageIndentPlan(file, direction)); }
  mountTabs() {
    document.body.addClass('classic-notebook');
    this.applyNotebookAppearance();
    const workspace = this.app.workspace.containerEl;
    const host = workspace.closest('.horizontal-main-container') || workspace;
    this.tabBar = document.createElement('div'); this.tabBar.className = 'tn-tab-bar'; host.parentElement.insertBefore(this.tabBar, host);
    this.ribbonButton = document.body.createEl('button', { cls: 'tn-icon-button tn-ribbon-toggle' });
    this.register(() => this.ribbonButton?.remove());
    this.ribbonButton.onclick = () => this.toggleRibbon();
    this.updateRibbon();
    const brand = this.tabBar.createEl('button', { cls: 'tn-brand', attr: { title: 'Dateiexplorer ein-/ausblenden' } });
    setIcon(brand.createSpan('tn-book-icon'), 'book-open');
    const labels = brand.createDiv('tn-brand-labels'); labels.createSpan({ text: this.app.vault.getName() }); this.groupLabel = labels.createEl('small');
    brand.onclick = () => this.app.workspace.leftSplit.collapsed ? this.app.workspace.leftSplit.expand() : this.app.workspace.leftSplit.collapse();
    this.backButton = this.tabBar.createEl('button', { cls: 'tn-back tn-icon-button', attr: { 'aria-label': 'Zurück zur Hauptebene', title: 'Zurück zur Hauptebene' } });
    setIcon(this.backButton, 'corner-up-left'); this.backButton.onclick = () => this.goBack();
    this.tabs = this.tabBar.createDiv('tn-tabs'); this.tabs.setAttribute('role', 'tablist'); this.tabs.setAttribute('aria-label', 'Notizbuch-Abschnitte');
    this.bindNotebookSectionDrag();
    const add = this.tabBar.createEl('button', { text: '+', cls: 'tn-add-section', attr: { 'aria-label': 'Neuen Abschnitt anlegen', title: 'Neuen Abschnitt anlegen' } }); add.onclick = () => this.newSection();
    this.spatialButton = this.tabBar.createEl('button', { cls: 'tn-icon-button tn-spatial-toggle', attr: { title: 'Freie Seitenfläche öffnen', 'aria-label': 'Freie Seitenfläche öffnen' } });
    this.spatialButton.onclick = () => this.toggleSpatialPage();
    this.themeButton = this.tabBar.createEl('button', { cls: 'tn-icon-button tn-theme' }); this.themeButton.onclick = () => this.toggleTheme();
    const tools = this.tabBar.createEl('button', { cls: 'tn-icon-button tn-tools', attr: { 'aria-label': 'Notizbuch-Menü', title: 'Notizbuch-Menü' } }); setIcon(tools, 'ellipsis');
    tools.onclick = event => {
      const menu = new Menu();
      menu.addItem(i => i.setTitle('Notizbuch-Seiten anzeigen').setIcon('book-open').onClick(() => this.showPages()));
      menu.addItem(i => i.setTitle('Neuer Abschnitt').setIcon('folder-plus').onClick(() => this.newSection()));
      menu.addItem(i => i.setTitle('Neue Abschnittsgruppe').setIcon('folders').onClick(() => this.newGroup()));
      menu.addItem(i => i.setTitle('Automatische Verknüpfungen …').setIcon('links-coming-in').onClick(() => new NotebookLinksModal(this).open()));
      menu.addItem(i => i.setTitle('Dateiexplorer ein-/ausblenden').setIcon('folder').onClick(() => brand.click()));
      menu.showAtMouseEvent(event);
    };
    this.register(() => this.tabBar?.remove());
  }
  toggleRibbon() { this.data.ribbonHidden = !this.data.ribbonHidden; this.updateRibbon(); this.persist(); }
  updateRibbon() {
    const hidden = !!this.data.ribbonHidden; document.body.classList.toggle('cn-ribbon-hidden', hidden);
    if (!this.ribbonButton) return;
    const label = hidden ? 'Symbolleiste links einblenden' : 'Symbolleiste links ausblenden';
    this.ribbonButton.title = label; this.ribbonButton.setAttribute('aria-label', label); this.ribbonButton.setAttribute('aria-pressed', String(!hidden));
    setIcon(this.ribbonButton, hidden ? 'panel-left-open' : 'panel-left-close');
  }
  toggleTheme() { this.app.changeTheme(this.isDark() ? 'moonstone' : 'obsidian'); this.refresh(); }
  refresh() {
    this.refreshSpatialButton();
    this.scheduleNotebookHeaders?.();
    if (this.tabs) {
      this.groupLabel.textContent = this.data.group ? this.data.group.replaceAll('/', ' / ') : '';
      this.groupLabel.hidden = !this.data.group;
      this.backButton.hidden = !this.data.group;
      const backLabel = this.parentGroup(this.data.group) ? 'Zurück zu ' + this.parentGroup(this.data.group) : 'Zurück zur Hauptebene';
      this.backButton.setAttribute('aria-label', backLabel); this.backButton.title = backLabel;
      const themeLabel = this.isDark() ? 'Helles Design einschalten' : 'Dunkles Design einschalten';
      this.themeButton.setAttribute('aria-label', themeLabel); this.themeButton.title = themeLabel; setIcon(this.themeButton, this.isDark() ? 'sun' : 'moon');
      this.tabs.empty();
      for (const section of this.sections()) {
        const group = this.isGroup(section) && section !== this.data.group;
        const tab = this.tabs.createEl('button', { cls: group ? 'tn-tab tn-group-tab' : 'tn-tab' });
        tab.dataset.section=section;tab.title='Zum Sortieren ziehen. Strg+Umschalt+Pfeil links/rechts verschiebt den Abschnitt.';
        if (group) setIcon(tab.createSpan('tn-group-icon'), 'folder-open');
        tab.createSpan({ text: this.sectionName(section) });
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(!group && section === this.data.section));
        tab.style.setProperty('--tn-tab-color', this.sectionColor(section)); tab.toggleClass('is-active', !group && section === this.data.section);
        tab.style.setProperty('--tn-tab-text', readableColor(this.sectionColor(section)));
        tab.toggleClass('tn-has-custom-color', this.hasSectionColor(section));
        tab.onclick = () => {if(Date.now()<(this.suppressSectionClickUntil||0))return;return group ? this.enterGroup(section) : this.selectSection(section);};
        tab.oncontextmenu = event => { event.preventDefault(); this.sectionMenu(event, section); };
        tab.onkeydown = event => {
          if(event.ctrlKey&&event.shiftKey&&['ArrowLeft','ArrowRight'].includes(event.key)){
            event.preventDefault();const sections=this.sections(),index=sections.indexOf(section),direction=event.key==='ArrowRight'?1:-1,target=sections[index+direction];
            if(target!==undefined&&this.moveNotebookSection(section,target,direction>0))this.tabs.querySelectorAll('.tn-tab').forEach(item=>{if(item.dataset.section===section)item.focus();});return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); const tabs = [...this.tabs.children], at = tabs.indexOf(tab);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next]?.focus();
        };
      }
    }
    document.body.style.setProperty('--tn-section', this.sectionColor(this.data.section));
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.render?.();
  }
  async showPages() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  async enterGroup(group) {
    this.data.group = group;
    const sections = this.sections().filter(p => !this.isGroup(p) || p === group);
    const remembered = this.data.groupSections[group];
    if (sections.length) return this.selectSection(sections.includes(remembered) ? remembered : sections[0]);
    this.data.section = group; this.refresh(); this.persist(); await this.showPages();
    await this.app.workspace.getLeaf(false).setViewState({ type: 'empty', active: true });
  }
  async goBack() { if (this.data.group) await this.enterGroup(this.parentGroup(this.data.group)); }
  async selectSection(section) {
    if (this.isGroup(section) && section !== this.data.group) return this.enterGroup(section);
    this.data.group = this.groupFor(section); this.data.section = section; this.data.groupSections[this.data.group] = section;
    const pages = this.pages(section), remembered = pages.find(file => file.path === this.data.lastPages[section]);
    this.refresh(); this.persist(); await this.showPages();
    if (remembered || pages[0]) await this.openPage(remembered || pages[0]);
    else await this.app.workspace.getLeaf(false).setViewState({ type: 'empty', active: true });
    this.tabs?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async openPage(file, newTab = false) {
    const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false), layout = this.data.spatialLayouts?.[file.path];
    if (file.extension === 'md' && layout) await leaf.setViewState({ type: SPATIAL_VIEW, state: { file: file.path }, active: true });
    else await leaf.openFile(file, { active: true });
  }
  followFile(file) {
    const actual=this.notebookActivePage();if(actual?.extension==='canvas')file=actual;
    if (!notebookIsPage(file) || this.data.hiddenFolders.some(p => file.path.startsWith(p + '/'))) return;
    this.data.section = this.sectionOf(file); this.data.group = this.groupFor(this.data.section);
    this.data.groupSections[this.data.group] = this.data.section; this.data.lastPages[this.data.section] = file.path;
    this.revealPage(file.path);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.requestReveal?.(file.path);
    this.persist(); this.refresh();
  }
  trackRename(file, oldPath) {
    const changed = value => value === oldPath || value.startsWith(oldPath + '/') ? file.path + value.slice(oldPath.length) : value;
    if (file instanceof TFolder) {
      this.data.order = this.data.order.map(changed); this.data.groups = this.data.groups.map(changed);
      this.data.section = changed(this.data.section); this.data.group = changed(this.data.group);
      this.data.lastPages = Object.fromEntries(Object.entries(this.data.lastPages).map(([key, page]) => [changed(key), changed(page)]));
      this.data.groupSections = Object.fromEntries(Object.entries(this.data.groupSections).map(([key, value]) => [changed(key), changed(value)]));
      this.data.sectionColors = Object.fromEntries(Object.entries(this.data.sectionColors || {}).map(([key, pair]) => [changed(key), pair]));
    } else for (const key of Object.keys(this.data.lastPages)) this.data.lastPages[key] = changed(this.data.lastPages[key]);
    this.data.pageLayouts = Object.fromEntries(Object.entries(this.data.pageLayouts || {}).map(([section, entries]) => [file instanceof TFolder ? changed(section) : section, entries.map(entry => ({ path: changed(entry.path), parent: entry.parent ? changed(entry.parent) : null }))]));
    this.data.collapsedPages = Object.fromEntries(Object.entries(this.data.collapsedPages || {}).map(([path, value]) => [changed(path), value]));
    this.data.pageMeta = Object.fromEntries(Object.entries(this.data.pageMeta || {}).map(([path, value]) => [changed(path), value]));
    if(this.data.pagePositions)this.data.pagePositions=Object.fromEntries(Object.entries(this.data.pagePositions).map(([path,value])=>[changed(path),value]));
    if(this.data.canvasReplacements)this.data.canvasReplacements=Object.fromEntries(Object.entries(this.data.canvasReplacements).map(([before,after])=>[before,changed(after)]));
    this.persist();
  }
  trackDelete(file) {
    const within = value => value === file.path || value.startsWith(file.path + '/');
    this.data.collapsedPages = Object.fromEntries(Object.entries(this.data.collapsedPages || {}).filter(([path]) => !within(path)));
    this.data.pageMeta = Object.fromEntries(Object.entries(this.data.pageMeta || {}).filter(([path]) => !within(path)));
    if(this.data.pagePositions)this.data.pagePositions=Object.fromEntries(Object.entries(this.data.pagePositions).filter(([path])=>!within(path)));
    this.data.pageLayouts = Object.fromEntries(Object.entries(this.data.pageLayouts || {}).filter(([section]) => !within(section)).map(([section, entries]) => {
      const previous = new Map(entries.map(entry => [entry.path, entry.parent]));
      return [section, entries.filter(entry => !within(entry.path)).map(entry => {
        let parent = entry.parent; const visited = new Set();
        while (parent && within(parent) && !visited.has(parent)) { visited.add(parent); parent = previous.get(parent) || null; }
        return { path: entry.path, parent: parent && !within(parent) ? parent : null };
      })];
    }));
    this.data.lastPages = Object.fromEntries(Object.entries(this.data.lastPages).filter(([key, page]) => !within(key) && !within(page)));
    let affected = false;
    if (file instanceof TFolder) {
      affected = within(this.data.section) || within(this.data.group);
      const fallback = within(this.data.group) ? this.parentGroup(file.path) : this.data.group;
      this.data.order = this.data.order.filter(path => !within(path));
      this.data.groups = this.data.groups.filter(path => !within(path));
      this.data.sectionColors = Object.fromEntries(Object.entries(this.data.sectionColors || {}).filter(([path]) => !within(path)));
      this.data.groupSections = Object.fromEntries(Object.entries(this.data.groupSections).filter(([key, value]) => !within(key) && !within(value)));
      if (affected) {
        this.data.group = fallback;
        const available = this.sections(fallback).filter(path => !within(path) && (!this.isGroup(path) || path === fallback));
        const remembered = this.data.groupSections[fallback];
        this.data.section = available.includes(remembered) ? remembered : available[0] ?? fallback;
        this.data.groupSections[fallback] = this.data.section;
      }
    }
    this.persist(); return affected;
  }
  sectionContents(folder) {
    const count = { notes: 0, other: 0 };
    const visit = item => {
      if (item instanceof TFolder) for (const child of item.children) visit(child);
      else if (item instanceof TFile) count[notebookIsPage(item) ? 'notes' : 'other']++;
    };
    visit(folder); return count;
  }
  notebookActivePage() {
    // A selected file card can make getActiveFile() report an embedded note.
    // Prefer the actual page shown by the main leaf, including native Canvas.
    const leaf = this.app.workspace.getMostRecentLeaf?.() || this.app.workspace.activeLeaf;
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    return notebookIsPage(file) && this.app.vault.getAbstractFileByPath(file.path) === file ? file : null;
  }
  requestDeletePage(file) {
    if (!notebookIsPage(file) || this.app.vault.getAbstractFileByPath(file.path) !== file) { new Notice('Die Seite wurde inzwischen verschoben oder gelöscht. Bitte öffne das Menü erneut.'); return; }
    new DeletePageModal(this, file).open();
  }
  async trashPage(path, expectedFile) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!notebookIsPage(file) || file !== expectedFile || file.path !== path) throw new Error('Die Seite wurde inzwischen verschoben oder gelöscht. Bitte öffne das Menü erneut.');
    if (this.trashingPage || this.trashingSection) throw new Error('Eine Seite oder ein Abschnitt wird bereits in den Papierkorb verschoben.');
    const section = this.sectionOf(file), outline = this.pageOutline(section), index = outline.findIndex(row => row.path === path);
    const initialLayout = Array.isArray(this.data.pageLayouts?.[section]) ? null : this.pageOutline(section, false).map(row => ({path: row.path, parent: row.parent}));
    const workspace = this.app.workspace, leaf = workspace.getMostRecentLeaf?.() || workspace.activeLeaf;
    const wasOpen = leaf?.view?.file === file;
    this.trashingPage = true;
    try {
      await this.app.vault.trash(file, false);
      this.data.pageLayouts ||= {};
      if (initialLayout && !Array.isArray(this.data.pageLayouts[section])) this.data.pageLayouts[section] = initialLayout;
      this.trackDelete(file); this.refresh();
      const active = workspace.getMostRecentLeaf?.() || workspace.activeLeaf;
      if (wasOpen && active === leaf && (leaf.view.file === file || leaf.view.getViewType?.() === 'empty')) {
        const remaining = this.pages(section), next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
        try {
          if (!next) await leaf.setViewState({type: 'empty', active: true});
          else if (next.extension === 'md' && this.data.spatialLayouts?.[next.path]) await leaf.setViewState({type: SPATIAL_VIEW, state: {file: next.path}, active: true});
          else await leaf.openFile(next, {active: true});
        } catch { new Notice('Die Seite liegt im Papierkorb. Bitte öffne die nächste Seite über die Seitenliste.'); }
      }
      new Notice('„' + file.basename + '“ wurde in den Vault-Papierkorb verschoben.');
    } finally { this.trashingPage = false; }
  }
  requestDeleteSection(section) {
    const folder = section ? this.app.vault.getAbstractFileByPath(section) : null;
    if (!(folder instanceof TFolder) || folder === this.app.vault.getRoot()) { new Notice('„Allgemein“ kann nicht als Abschnitt gelöscht werden.'); return; }
    new DeleteSectionModal(this, folder).open();
  }
  async trashSection(section, expectedFolder) {
    const folder = section ? this.app.vault.getAbstractFileByPath(section) : null;
    if (!(folder instanceof TFolder) || folder === this.app.vault.getRoot() || folder !== expectedFolder) throw new Error('Der Abschnitt wurde inzwischen geändert. Bitte öffne das Menü erneut.');
    if (this.trashingSection) throw new Error('Ein Abschnitt wird bereits in den Papierkorb verschoben.');
    const affected = this.data.section === section || this.data.section.startsWith(section + '/') || this.data.group === section || this.data.group.startsWith(section + '/');
    this.trashingSection = true;
    try {
      // Always use the recoverable vault trash, even if Obsidian is configured to delete permanently.
      await this.app.vault.trash(folder, false);
      this.trackDelete(folder);
      if (affected) {
        try { await this.selectSection(this.data.section); }
        catch { this.refresh(); }
      }
      this.refresh(); new Notice('„' + basename(section) + '“ wurde in den Vault-Papierkorb verschoben.');
    } finally { this.trashingSection = false; }
  }
  newPage(parentFile = null, kind = this.notebookNewPageFormat()) {
    const section = parentFile ? this.sectionOf(parentFile) : this.data.section;
    if (this.isGroupOverview(section)) return this.newSection();
    const parent = parentFile && this.pageOutline(section).find(item => item.path === parentFile.path);
    if (parentFile && (!parent || parent.level >= MAX_PAGE_DEPTH)) { new Notice('Maximal fünf Seitenebenen sind möglich.'); return; }
    new NameModal(this.app, parentFile ? 'Neue Unterseite' : 'Neue Seite', parentFile ? 'Neue Unterseite' : 'Neue Seite', async name => {
      if (parentFile && (this.app.vault.getAbstractFileByPath(parentFile.path) !== parentFile || this.sectionOf(parentFile) !== section)) throw new Error('Die Elternseite wurde inzwischen verschoben oder gelöscht. Bitte öffne das Menü erneut.');
      if (parentFile && this.pageOutline(section).find(item => item.path === parentFile.path)?.level >= MAX_PAGE_DEPTH) throw new Error('Maximal fünf Seitenebenen sind möglich.');
      const stem = name.replace(/\.(?:md|canvas)$/i, ''), filename = stem + '.' + kind, path = normalizePath((section ? section + '/' : '') + filename);
      if (['md', 'canvas'].some(ext => this.app.vault.getAbstractFileByPath(normalizePath((section ? section + '/' : '') + stem + '.' + ext)))) throw new Error('Eine Seite mit diesem Namen gibt es hier bereits.');
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('Eine Seite mit diesem Namen gibt es hier bereits.');
      const created = new Date().toISOString();
      const canvasPage=kind==='canvas'?notebookNewCanvasPage({title:stem,created}):null;
      const file = await this.app.vault.create(path, canvasPage ? JSON.stringify(canvasPage, null, 2) : '---\ncreated: "' + created + '"\n---\n\n');
      if(canvasPage)this.canvasNotebookMetadata?.set(file.path,canvasPage.notebook);
      this.data.pageMeta ||= {}; this.data.pageMeta[path] = { created }; this.persist();
      if (parentFile) this.commitPagePlan(section, this.planPageMove(file.path, parentFile.path, 'inside', this.pageOutline(section)));
      await this.openPage(file);
    }).open();
  }
  newSection() {
    const group = this.data.group;
    new NameModal(this.app, 'Neuer Abschnitt', '', async name => {
      const path = normalizePath((group ? group + '/' : '') + name);
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('Diesen Abschnitt gibt es bereits.');
      await this.app.vault.createFolder(path); this.data.order.push(path); await this.selectSection(path);
    }).open();
  }
  newGroup() {
    const group = this.data.group;
    new NameModal(this.app, 'Neue Abschnittsgruppe', '', async name => {
      const path = normalizePath((group ? group + '/' : '') + name);
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('Diesen Ordner gibt es bereits.');
      await this.app.vault.createFolder(path); this.data.groups.push(path); this.data.order.push(path); await this.enterGroup(path);
    }).open();
  }
  sectionMenu(event, section) {
    const menu = new Menu(), group = this.isGroup(section) && section !== this.data.group;
    if (group) menu.addItem(i => i.setTitle('Abschnittsgruppe öffnen').setIcon('folder-open').onClick(() => this.enterGroup(section)));
    else menu.addItem(i => i.setTitle('Neue Seite').setIcon('file-plus').onClick(async () => { await this.selectSection(section); this.newPage(); }));
    if (section && !(this.isGroup(section) && section === this.data.group)) menu.addItem(i => i.setTitle(group ? 'Gruppe umbenennen' : 'Abschnitt umbenennen').setIcon('pencil').onClick(() => {
      new NameModal(this.app, group ? 'Gruppe umbenennen' : 'Abschnitt umbenennen', basename(section), name => this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(section), normalizePath((parentPath(section) ? parentPath(section) + '/' : '') + name))).open();
    }));
    menu.addItem(i => i.setTitle('Abschnittsfarbe ändern …').setIcon('palette').onClick(() => new SectionColorModal(this, section).open()));
    if (!group) {
      menu.addSeparator();
      for (const [sort, title] of [['original', 'Notizbuch-Reihenfolge'], ['alphabetical', 'Alphabetisch sortieren']]) menu.addItem(i => i.setTitle(title).setChecked(this.data.pageSort === sort).onClick(() => { this.data.pageSort = sort; this.persist(); this.refresh(); }));
      menu.addItem(i => i.setTitle('Alle Unterseiten einklappen').setIcon('chevrons-down-up').onClick(() => {
        this.data.collapsedPages ||= {};
        for (const item of this.pageOutline(section)) if (item.hasChildren) this.data.collapsedPages[item.path] = true;
        this.persist(); this.refreshPages();
      }));
      menu.addItem(i => i.setTitle('Alle Unterseiten ausklappen').setIcon('chevrons-up-down').onClick(() => {
        for (const item of this.pageOutline(section)) if (this.data.collapsedPages) delete this.data.collapsedPages[item.path];
        this.persist(); this.refreshPages();
      }));
    }
    for (const [offset, label, icon] of [[-1, 'Reiter nach links', 'arrow-left'], [1, 'Reiter nach rechts', 'arrow-right']]) menu.addItem(i => i.setTitle(label).setIcon(icon).onClick(() => {
      const visible = this.sections(), from = visible.indexOf(section), to = from + offset;
      if (to >= 0 && to < visible.length) {
        [visible[from], visible[to]] = [visible[to], visible[from]];
        this.data.order = [...this.data.order.filter(p => !visible.includes(p)), ...visible]; this.persist(); this.refresh();
      }
    }));
    if (section && !(this.isGroup(section) && section === this.data.group)) {
      menu.addSeparator();
      menu.addItem(i => i.setTitle(group ? 'Abschnittsgruppe löschen …' : 'Abschnitt löschen …').setIcon('trash-2').onClick(() => this.requestDeleteSection(section)));
    }
    menu.showAtMouseEvent(event);
  }
  pageMenu(event, file) {
    const menu = new Menu();
    const item = this.pageOutline(this.sectionOf(file)).find(row => row.path === file.path);
    menu.addItem(i => i.setTitle('Neue Unterseite').setIcon('file-plus').setDisabled(!item || item.level >= MAX_PAGE_DEPTH).onClick(() => this.newPage(file)));
    menu.addItem(i => i.setTitle('Einrücken').setIcon('indent-increase').setDisabled(!!this.pageIndentPlan(file, 1).error).onClick(() => this.changePageIndent(file, 1)));
    menu.addItem(i => i.setTitle('Ausrücken').setIcon('indent-decrease').setDisabled(!!this.pageIndentPlan(file, -1).error).onClick(() => this.changePageIndent(file, -1)));
    if (item?.hasChildren) menu.addItem(i => i.setTitle(this.data.collapsedPages?.[file.path] ? 'Unterseiten ausklappen' : 'Unterseiten einklappen').setIcon('chevrons-down-up').onClick(() => this.togglePageCollapse(file.path)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('In neuem Tab öffnen').setIcon('file-plus').onClick(() => this.openPage(file, true)));
    menu.addItem(i => i.setTitle('Seite umbenennen').setIcon('pencil').onClick(() => this.requestRenamePage(file)));
    menu.addItem(i => i.setTitle('Seite löschen …').setIcon('trash-2').onClick(() => this.requestDeletePage(file)));
    menu.addSeparator();
    for (const section of this.allSections()) {
      if (section === this.sectionOf(file)) continue;
      menu.addItem(i => i.setTitle('Verschieben nach: ' + (section || 'Allgemein')).setIcon('folder-input').onClick(async () => {
        const path = normalizePath((section ? section + '/' : '') + file.name);
        if (this.app.vault.getAbstractFileByPath(path)) { new Notice('Dort gibt es bereits eine Seite mit diesem Namen.'); return; }
        await this.app.fileManager.renameFile(file, path); await this.selectSection(section); await this.openPage(file);
      }));
    }
    menu.showAtMouseEvent(event);
  }
};

Object.assign(module.exports.prototype, notebookAutoLinkMethods);

Object.assign(module.exports.prototype, spatialNotebookMethods);

Object.assign(module.exports.prototype, nativeNotebookMethods);

// @include notebook-page-api
Object.assign(module.exports.prototype, notebookPageApi);

// @include native-canvas-pages
// @include canvas-anchors
// @include canvas-search
// @include canvas-text-layout
Object.assign(module.exports.prototype,nativeCanvasPageMethods);
Object.assign(module.exports.prototype,notebookCanvasAnchorMethods);
Object.assign(module.exports.prototype,notebookCanvasSearchMethods);

// @include text-links
Object.assign(module.exports.prototype,notebookTextLinkMethods);

// @include page-positions
Object.assign(module.exports.prototype,notebookPagePositionMethods);

// @include notebook-history
Object.assign(module.exports.prototype,notebookHistoryMethods);

// @include section-tabs
Object.assign(module.exports.prototype,notebookSectionTabMethods);

// @include page-renaming
Object.assign(module.exports.prototype,notebookPageRenameMethods);

// @include notebook-lifecycle
Object.assign(module.exports.prototype, notebookLifecycleMethods);

// @include notebook-settings
Object.assign(module.exports.prototype, notebookSettingsMethods);

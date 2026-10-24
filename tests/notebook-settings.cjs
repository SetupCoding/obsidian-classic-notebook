const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const classes = new Set(), saved = [], created = [];
let tab, modal, rebuilds = 0;
class Modal { constructor(app) { this.app = app; } open() { modal = this; } }
const api = { Plugin: class {}, PluginSettingTab: class {}, ItemView: class {}, FileView: class {}, Modal, normalizePath: value => value };
const ctx = { module: { exports: {} }, require: () => api };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), ctx);
const plugin = new ctx.module.exports();
plugin.data = { section: 'Notes', pageMeta: {}, classicColors: true };
plugin.app = { workspace: { containerEl: { ownerDocument: { body: { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } } } } }, vault: { getAbstractFileByPath: () => null, async create(path, text) { created.push({ path, text }); return { path }; } } };
Object.assign(plugin, { addSettingTab(value) { tab = value; }, async saveData(data) { saved.push(JSON.parse(JSON.stringify(data))); }, rebuildAutoLinks() { rebuilds++; }, persist() {}, isGroupOverview: () => false, async openPage() {} });
(async () => {
  plugin.setupNotebookSettings(); assert(tab);
  const controls = tab.getSettingDefinitions()[0].items.map(item => item.control);
  assert.equal(controls.length, 4); assert.equal(tab.getControlValue('classicColors'), true);
  await tab.setControlValue('classicColors', false); assert(!classes.has('cn-classic-colors'));
  await tab.setControlValue('classicColors', true); assert(classes.has('cn-classic-colors'));
  await tab.setControlValue('autoLinksEnabled', false); assert.equal(rebuilds, 1); assert.equal(saved.at(-1).autoLinksEnabled, false);
  await tab.setControlValue('newPageFormat', 'md'); assert.equal(plugin.notebookNewPageFormat(), 'md');
  plugin.newPage(); await modal.submit('A note'); assert.equal(created.at(-1).path, 'Notes/A note.md', 'normal Add Page uses the selected format');
  plugin.data.nativeCanvasOnly = true; assert.equal(plugin.notebookNewPageFormat(), 'canvas');
  plugin.newPage(); await modal.submit('A board'); assert.equal(created.at(-1).path, 'Notes/A board.canvas', 'canvas-only notebooks keep native Canvas');
  const board = JSON.parse(created.at(-1).text); assert.equal(board.nodes[0].type, 'text'); assert(board.notebook.frontmatter.created);
  const count = saved.length; await tab.setControlValue('newPageFormat', 'js'); await tab.setControlValue('groups', []); assert.equal(saved.length, count, 'invalid settings never overwrite notebook data');
  assert.equal(created.length, 2, 'preferences never rewrite existing notes');
  console.log('PASS: searchable settings, theme opt-out, persisted preferences and actual Canvas/Markdown page creation without existing note changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });

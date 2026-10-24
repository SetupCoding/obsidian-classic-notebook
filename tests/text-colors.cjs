const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
class Element {
  constructor(tag = 'div', options = {}) { this.tagName = tag; this.children = []; this.value = options.value || ''; this.textContent = options.text || ''; this.className = options.cls || ''; this.attributes = options.attr || {}; this.style = { setProperty() {} }; }
  createEl(tag, options = {}) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? {cls:options} : options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  addClass(value) { this.className += ' ' + value; }
  setAttribute(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  querySelector() { return null; }
  focus() { this.focused = true; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}
class Modal {
  constructor() { this.contentEl = new Element(); this.modalEl = new Element(); }
  open() { this.selection = { nativeBrowserSelection: true }; this.onOpen(); }
  close() { this.closed = true; this.onClose(); }
}
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const obsidian = { Plugin:class{}, ItemView:class{}, FileView:class{}, Modal, setIcon(){}, Notice:class{} };
const context = { module:{exports:{}}, document:{getSelection:()=>null}, require:name => name === 'obsidian' ? obsidian : {ViewPlugin:{fromClass:spec=>spec}} };
vm.runInNewContext(source + '\nmodule.exports.colors={notebookHexColor,notebookRenderedTextRange,notebookSelectionExtension,NotebookTextColorModal};', context);
const Plugin = context.module.exports, {notebookHexColor:hex, notebookRenderedTextRange:rendered, notebookSelectionExtension:track, NotebookTextColorModal:ColorModal} = Plugin.colors;
const plugin = new Plugin(); let saves = 0;
plugin.app = {}; plugin.persist = () => saves++; plugin.refreshCustomTextColors = () => {};
plugin.data = { customTextColors:['#5B9BD5','#FF0000','#123456'] };
plugin.initializeNotebookTextSwatches();
assert.equal(plugin.data.textColorSwatches.length,1,'migrate nonstandard used colors without duplicating presets');
assert.equal(plugin.data.textColorSwatches[0].color,'#123456');
plugin.saveNotebookTextSwatch('#aBc','Geheimnis'); plugin.saveNotebookTextSwatch('#AABBCC','Umbenannt');
assert.equal(plugin.data.textColorSwatches.length,2); assert.equal(plugin.data.textColorSwatches.at(-1).name,'Umbenannt');
plugin.removeNotebookTextSwatch('#123456'); assert(plugin.data.customTextColors.includes('#123456'),'removing a tile must retain color rendering for existing notes');
plugin.initializeNotebookTextSwatches(); assert.equal(plugin.data.textColorSwatches.length,1,'deleted migrated colors must not reappear');
assert.equal(hex('#abc'),'#AABBCC'); assert.equal(hex('red'),null);

const text = '<span class="tn-import-format" data-tn-color="#5B9BD5" style="color:#5B9BD5;font-weight:700">Das ist eine GM-Notiz.</span>';
const at = text.indexOf('Notiz.');
const range = rendered(text,['Das ist eine GM-Notiz.'],{index:0,offset:16},{index:0,offset:21});
assert.equal(range.from,at); assert.equal(range.to,at+5);
const repeated = 'Ein **Name** und Name.';
assert.equal(rendered(repeated,['Ein ','Name',' und Name.'],{index:1,offset:0},{index:1,offset:4}).from,6);
assert.equal(rendered('Name Name',['Name'],{index:0,offset:0},{index:0,offset:4}),null,'ambiguous source occurrences cannot be guessed');
const link = '[[Wissen/Ziel|Name]] und [Name](Wissen/Ziel)';
assert.equal(rendered(link,['Name',' und ','Name'],{index:2,offset:0},{index:2,offset:4}).from,link.lastIndexOf('Name'));
assert.equal(rendered('<span title="Name">Name</span>',['Name'],{index:0,offset:0},{index:0,offset:4}).from,19,'attributes cannot be selected instead of visible text');

let saved = 0; const node = {id:'card',text,setText(value){this.text=value;}};
const canvas = {nodes:new Map([['card',node]]),requestSave(){saved++;},readonly:false};
plugin.canvasNodeForEditor=()=>({canvas,node});
const view={hasFocus:true,dom:{isConnected:true},state:{doc:{toString:()=>text},selection:{main:{from:at,to:at+5,empty:false}}}};
const Tracker=track(plugin), tracker=new Tracker(view), snapshot=plugin.notebookSelection;
view.hasFocus=false;view.dom.isConnected=false;tracker.destroy();
assert.equal(plugin.notebookSelection,snapshot,'Canvas editor destruction cannot erase the selected text before opening a dialog');
assert.equal(plugin.validNotebookTextSelection(snapshot),snapshot);
const modal=new ColorModal(plugin,snapshot);modal.open();
assert.equal(modal.textSelectionSnapshot,snapshot,'Obsidian Modal.selection must not overwrite the editor selection');
assert.equal(modal.contentEl.all().filter(el=>el.className==='tn-color-tile').length,20);
modal.hex.value='#2468ac';modal.colorName.value='Hinweis';modal.saveCustom(true);
assert(modal.closed);assert.equal(saved,1);assert(node.text.includes('color:#2468AC;font-weight:700">Notiz</span>'));
assert(plugin.data.textColorSwatches.some(entry=>entry.color==='#2468AC'&&entry.name==='Hinweis'));
assert.throws(()=>plugin.applyNotebookColor(snapshot,'#FF0000'),/nicht mehr aktuell/,'stale snapshots must not overwrite edited cards');
node.text=text;view.dom.isConnected=true;view.state.doc.toString=()=>text+' neu';
assert.equal(plugin.validNotebookTextSelection(snapshot),null,'a changed live editor cannot fall back to an older Canvas node');
view.dom.isConnected=false;canvas.readonly=true;assert.equal(plugin.validNotebookTextSelection(snapshot),null);canvas.readonly=false;

const manage=new ColorModal(plugin,null);manage.open();manage.hex.value='#123abc';manage.colorName.value='Testfarbe';manage.saveCustom(false);
assert(!manage.closed);assert(plugin.data.textColorSwatches.some(entry=>entry.color==='#123ABC'));
const tile=manage.savedGrid.children.find(el=>el.children.some(child=>child.attributes['aria-label']==='Testfarbe, #123ABC'));
tile.children.find(el=>el.className==='tn-color-delete').onclick();
assert(!plugin.data.textColorSwatches.some(entry=>entry.color==='#123ABC'));assert.equal(saved,1,'palette management cannot modify a note');
manage.hex.value='#oops';manage.saveCustom(false);assert(manage.status.textContent.includes('Hex-Farbwert'));
const stale=new ColorModal(plugin,snapshot);stale.open();node.text=text+' geändert';assert.equal(stale.apply('#FF0000'),false);assert(!stale.closed);assert(stale.status.textContent.includes('nicht mehr aktuell'));
assert(saves>0);
console.log('PASS: Canvas selection lifecycle, rendered and repeated text mapping, stale/readonly guards, palette migration, save/update/delete, persistence and independent modal selection.');

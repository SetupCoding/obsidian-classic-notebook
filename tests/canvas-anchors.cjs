const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const obsidian = { Plugin: class {}, ItemView: class {}, FileView: class {}, Modal: class {}, TFile: class {}, Notice: class {} };
const context = { module: { exports: {} }, require: () => obsidian, Notice: class {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') + '\nmodule.exports.api={notebookTextChanges,notebookRemoveCanvasSourceMarkers,notebookRebaseCanvasAnchors,notebookCanvasAnchorState};', context);
const Plugin = context.module.exports, { notebookTextChanges: diff, notebookRemoveCanvasSourceMarkers: clean, notebookRebaseCanvasAnchors: rebase, notebookCanvasAnchorState: state } = Plugin.api;
const clone = value => JSON.parse(JSON.stringify(value));
const text = '😀 Intro.\n\n^src-0001\n\n## Kapitel\n\n**Gold** [[Other.canvas#^src-0009|Link]].\n\n^src-0002\n\n```text\n^src-example\n```\n\n- [ ] TODO ^todo-123';
const source = { nodes: [{ id: 'card', type: 'text', text, x: 24, y: 48, width: 650, height: 1800 }], edges: [{ id: 'edge' }], notebook: { version: 1, frontmatter: { title: 'Test', created: '2000-01-01' }, cards: { card: { label: 'Text' } }, anchors: { '^src-0001': { nodeId: 'card', offset: 0, length: 3 }, '^src-0002': { nodeId: 'card', offset: 0, length: 1 }, 'Kapitel': { nodeId: 'card', offset: text.indexOf('## Kapitel'), length: 10 }, '^src-example': { nodeId: 'card', offset: text.indexOf('^src-example'), length: 12 } } } };
const snapshot = clone(source), result = clean(source), data = result.data;
assert.equal(result.count, 2); assert.deepEqual(source, snapshot, 'migration does not mutate its backup');
assert.equal(data.nodes[0].text, '😀 Intro.\n\n## Kapitel\n\n**Gold** [[Other.canvas#^src-0009|Link]].\n\n```text\n^src-example\n```\n\n- [ ] TODO ^todo-123');
assert.equal(data.notebook.anchors['^src-0001'].length, '😀 Intro.'.length, 'offsets are UTF-16, including supplementary characters');
assert.equal(data.nodes[0].text.slice(data.notebook.anchors['^src-0002'].offset, data.notebook.anchors['^src-0002'].offset + data.notebook.anchors['^src-0002'].length), '## Kapitel\n\n**Gold** [[Other.canvas#^src-0009|Link]].');
assert.equal(data.notebook.anchors.Kapitel.offset, data.nodes[0].text.indexOf('## Kapitel'));
assert.deepEqual(data.edges, source.edges); assert.deepEqual(data.notebook.frontmatter, source.notebook.frontmatter); assert.deepEqual(data.notebook.cards, source.notebook.cards);
assert.deepEqual(Object.keys(data.notebook.anchors), Object.keys(source.notebook.anchors));
assert.equal(clean(data).count, 0, 'migration is idempotent');
assert.equal(state(data.notebook, '#^src-0002', new Map(data.nodes.map(node => [node.id, node]))).match.matches[0][0], data.nodes[0].text.indexOf('## Kapitel'));

const withText = value => ({ ...data, nodes: [{ ...data.nodes[0], text: value }] });
const prepend = 'Vorwort\n\n' + data.nodes[0].text, added = rebase(data, withText(prepend));
assert.equal(added.notebook.anchors.Kapitel.offset, prepend.indexOf('## Kapitel'));
const changed = prepend.replace('Intro.', 'Ein längerer Einstieg.').replace('**Gold**', '**Noch mehr Gold**').replace('TODO', 'Neue Aufgabe');
const edited = rebase(added, { ...added, nodes: [{ ...added.nodes[0], text: changed }] });
assert.equal(edited.notebook.anchors.Kapitel.offset, changed.indexOf('## Kapitel'), 'separate edits preserve a target between them');
const block = edited.notebook.anchors['^src-0002'];
assert.equal(changed.slice(block.offset, block.offset + block.length), '## Kapitel\n\n**Noch mehr Gold** [[Other.canvas#^src-0009|Link]].');
const undone = rebase(edited, { ...edited, nodes: data.nodes });
assert.equal(undone.notebook.anchors.Kapitel.offset, data.notebook.anchors.Kapitel.offset, 'undo remaps targets back');
assert.equal(rebase(data, { ...data, nodes: [] }).nodes.length, 0, 'deleted cards are not recreated');
assert.equal(state(data.notebook, '#^src-0002', new Map()), null);
const raw = clean({ nodes: [{ id: 'a', text: 'A\r\n\r\n^src-1\r\n\r\nB\r\n' }], notebook: { anchors: { '^src-1': { nodeId: 'a', offset: 0, length: 1 } } } });
assert.equal(raw.data.nodes[0].text, 'A\r\n\r\nB\r\n');
assert.equal(clean({ nodes: [{ id: 'a', text: 'Keep\n^src-unregistered' }], notebook: { anchors: {} } }).count, 0);

// Reconstruct randomized edits to catch faulty bisect boundaries and overlapping hunks.
let seed = 41;
const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
for (let trial = 0; trial < 600; trial++) {
  const before = Array.from({ length: random(180) }, () => 'ab cd\n😀'[random(8)]).join('');
  let after = before;
  for (let i = 0; i < 5; i++) { const at = random(after.length + 1); after = after.slice(0, at) + 'XYZ\n'.slice(0, random(5)) + after.slice(at + random(8)); }
  const changes = diff(before, after);
  let rebuilt = before;
  for (const change of [...changes].reverse()) rebuilt = rebuilt.slice(0, change.from) + change.insert + rebuilt.slice(change.to);
  assert.equal(rebuilt, after, 'diff reconstructs trial ' + trial);
  assert(changes.every((change, i) => !i || changes[i - 1].to <= change.from), 'hunks are ordered and disjoint');
}

const plugin = new Plugin(), callbacks = [];
plugin.canvasNotebookMetadata = new Map(); plugin.register = callback => callbacks.push(callback);
let currentNodes = clone(data.nodes);
const canvas = { data: clone(data), getData() { return { ...this.data, nodes: clone(currentNodes) }; }, setData(next) { this.data = next; currentNodes = clone(next.nodes); } };
const view = { canvas, file: { path: 'Test.canvas' } }, originalGet = canvas.getData;
plugin.trackCanvasNotebookAnchors(view); plugin.trackCanvasNotebookAnchors(view);
assert.equal(callbacks.length, 1, 'one hook per Canvas instance');
currentNodes[0].text = 'Neu.\n\n' + currentNodes[0].text;
const saved = canvas.getData();
assert.equal(saved.notebook.anchors.Kapitel.offset, saved.nodes[0].text.indexOf('## Kapitel'));
assert.equal(canvas.getData().notebook.anchors.Kapitel.offset, saved.notebook.anchors.Kapitel.offset, 'repeated saves do not move targets twice');
canvas.setData(clone(data));
assert.equal(canvas.getData().notebook.anchors.Kapitel.offset, data.notebook.anchors.Kapitel.offset, 'external document load resets the baseline');
callbacks.forEach(callback => callback()); assert.equal(canvas.getData, originalGet, 'unload restores native methods');
console.log('PASS: source markers removed without visible replacement, links/IDs/layout/dates preserved, UTF-16 ranges, headings, fenced examples, TODO IDs, idempotence, multi-location edits/undo, native saves/reloads, and 600 randomized diff reconstructions.');

(async () => {
  const files = [{path:'Open.canvas',extension:'canvas'}, {path:'Closed.canvas',extension:'canvas'}];
  const disk = new Map(files.map(file=>[file.path,JSON.stringify(source)])), backups = new Map();
  const live = clone(source); live.nodes[0].text = live.nodes[0].text.replace('Intro.', 'Unsaved intro.');
  const native = { data:live, history:{data:[clone(source)]}, getData(){return clone(this.data);}, setData(next){this.data=next;}, requestPushHistory:{run(){}} };
  const open = {file:files[0],canvas:native,async save(){disk.set(this.file.path,JSON.stringify(this.canvas.getData()));}};
  const app = {workspace:{getLeavesOfType:()=>[{view:open}]},vault:{getFiles:()=>files,read:async file=>disk.get(file.path),process:async(file,callback)=>disk.set(file.path,callback(disk.get(file.path))),adapter:{exists:async()=>false,mkdir:async()=>{},write:async(name,value)=>backups.set(name,value)}}};
  const migrate = new Plugin();migrate.app=app;migrate.manifest={dir:'.obsidian/plugins/classic-notebook'};migrate.canvasNotebookMetadata=new Map();migrate.scheduleNotebookHeaders=()=>{};
  await migrate.removeCanvasNotebookSourceMarkers();
  assert.equal(backups.size,1,'backup is stored before migration');
  assert(JSON.parse([...backups.values()][0]).pages[0].data.nodes[0].text.includes('Unsaved intro.'),'backup includes live drafts');
  assert(JSON.parse(disk.get(files[0].path)).nodes[0].text.includes('Unsaved intro.'),'native save preserves the live draft');
  for(const file of files)assert.equal(clean(JSON.parse(disk.get(file.path))).count,0);
  assert.equal(clean(native.history.data[0]).count,0,'undo history cannot resurrect source markers');
  await migrate.removeCanvasNotebookSourceMarkers();assert.equal(backups.size,1,'repeat is a no-op');

  disk.set(files[1].path,JSON.stringify(source));
  app.vault.process=async(file,callback)=>{disk.set(file.path,JSON.stringify({...source,externalEdit:true}));callback(disk.get(file.path));};
  await assert.rejects(()=>migrate.removeCanvasNotebookSourceMarkers(),/inzwischen|während/,'concurrent closed-file changes are never overwritten');
  assert(JSON.parse(disk.get(files[1].path)).externalEdit);
  app.vault.adapter.write=async()=>{throw new Error('Backup unavailable');};
  await assert.rejects(()=>migrate.removeCanvasNotebookSourceMarkers(),/Backup unavailable/);
  assert.equal(clean(JSON.parse(disk.get(files[1].path))).count,2,'backup failure prevents changes');
  console.log('PASS: migration command backs up live drafts, saves closed and open pages, sanitizes undo history, is idempotent, and stops on concurrent writes or failed backups.');
})().catch(error=>{console.error(error);process.exitCode=1;});

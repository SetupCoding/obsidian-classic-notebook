const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const frames = [], ready = [], originalCalls = [], warnings = [];
const doc = { defaultView: { requestAnimationFrame: fn => frames.push(fn) } };
class CanvasView {
  constructor(file) { this.file = { path: file }; this.containerEl = { ownerDocument: doc }; }
  setEphemeralState(state) { originalCalls.push(state); return 'native result'; }
}
class WorkspaceLeaf {
  constructor(app) { this.app = app; this.view = new CanvasView('Pages/Welcome.canvas'); }
  async setViewState() {}
}
const coreNavigation = WorkspaceLeaf.prototype.setViewState;
const api = { Plugin: class { register(fn) { this.cleanups.push(fn); } }, ItemView: class {}, FileView: class {}, Modal: class {}, WorkspaceLeaf };
const context = { window: doc.defaultView, module: { exports: {} }, console: { warn: (...args) => warnings.push(args) }, require: () => api };
vm.runInNewContext(fs.readFileSync(process.env.NOTEBOOK_PLUGIN || path.join(__dirname, '../main.js'), 'utf8'), context);
const Notebook = context.module.exports;
function fixture(app) {
  const plugin = new Notebook(); Object.assign(plugin, { app, cleanups: [], data: { pageMeta: { 'Pages/Welcome.canvas': {} } }, spatialTextRequests: new WeakSet(), canvasNotebookMetadata: new Map(), rememberNotebookPagePosition() {}, notebookPagePosition() {} });
  plugin.setupSpatialNavigation(); return plugin;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const app = { workspace: { onLayoutReady: fn => ready.push(fn) } }, leaf = new WorkspaceLeaf(app);
  const request = { type: 'canvas', state: { file: leaf.view.file.path } };
  let revealed = 0;
  const first = fixture(app); first.revealCanvasNotebookMatch = () => revealed++;
  await leaf.setViewState(request); await settle();
  const wrapper = leaf.view.setEphemeralState;
  assert.notEqual(wrapper, CanvasView.prototype.setEphemeralState, 'routing installs the real Canvas hook');
  await leaf.setViewState(request); await settle();
  assert.equal(leaf.view.setEphemeralState, wrapper, 'reopening does not stack hooks');
  assert.equal(leaf.view.setEphemeralState({ match: { word: 'old' } }), 'native result');
  leaf.view.setEphemeralState({ match: { word: 'new' } });
  frames.splice(0).forEach(fn => fn()); assert.equal(revealed, 1, 'only the latest search survives');
  leaf.view.setEphemeralState({ match: {} });
  first.cleanups.forEach(fn => fn()); frames.splice(0).forEach(fn => fn());
  assert.equal(revealed, 1, 'queued callbacks cannot run after disable');
  assert.equal(leaf.view.setEphemeralState, CanvasView.prototype.setEphemeralState, 'disable restores the original view method');
  assert(!Object.hasOwn(leaf.view, 'setEphemeralState'), 'inherited methods stay inherited');
  assert.equal(WorkspaceLeaf.prototype.setViewState, coreNavigation);
  // A reference retained by a third party also becomes a transparent native call.
  first.canvasNotebookAnchorState = () => { throw Error('stale plugin must not run'); };
  assert.equal(wrapper.call(leaf.view, { subpath: '#Later' }), 'native result');
  const second = fixture(app); second.revealCanvasNotebookMatch = () => revealed++;
  await leaf.setViewState(request); await settle();
  assert.notEqual(leaf.view.setEphemeralState, wrapper, 're-enable installs a fresh working hook');
  second.canvasNotebookAnchorState = () => { throw Error('optional target failed'); };
  assert.equal(leaf.view.setEphemeralState({ match: {} }), 'native result', 'target failures never block native state');
  frames.splice(0).forEach(fn => fn()); assert.equal(revealed, 2); assert.equal(warnings.length, 1);
  const own = new CanvasView('Pages/Other.canvas'), originalOwn = own.setEphemeralState.bind(own);
  own.setEphemeralState = originalOwn;
  second.hookNotebookEphemeralState(own, () => true);
  const other = new WorkspaceLeaf({}); await other.setViewState(request); await settle();
  assert.equal(other.view.setEphemeralState, CanvasView.prototype.setEphemeralState, 'other app instances are untouched');
  second.cleanups.forEach(fn => fn()); assert.equal(own.setEphemeralState, originalOwn);
  assert.equal(originalCalls.length, 5, 'each request invokes core state exactly once');
  console.log('PASS: real navigation hook disable/re-enable, per-view cleanup, stale searches, optional errors, original call/return value and app isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });

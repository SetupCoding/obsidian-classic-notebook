const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.NOTEBOOK_PLUGIN || path.join(__dirname, '../main.js'), 'utf8');
class TFile { constructor(path) { this.path = path; this.extension = path.split('.').at(-1); } }
const files = ['Pages/Session.md', 'Pages/Other.md', 'Pages/Plain.md', 'Pages/Board.canvas'].map(name => new TFile(name));
const spatialType = 'classic-notebook-free-page';
function view(type, file) { return { file, getViewType: () => type, getEphemeralState: () => ({cursor:{from:{line:5,ch:0}}}), async save() {} }; }
class WorkspaceLeaf {
  constructor(app, type = 'empty', file = null) { this.app = app; this.view = view(type, file); this.calls = []; }
  async setViewState(state, location) {
    this.calls.push({state, location});
    const file = files.find(file => file.path === state.state?.file);
    if (this.view.getViewType() !== state.type) this.view = view(state.type, file);
    else this.view.file = file;
  }
  getViewState() { return {type:this.view.getViewType(), state:{file:this.view.file?.path}, pinned:true}; }
  getEphemeralState() { return this.view.getEphemeralState(); }
}
const original = WorkspaceLeaf.prototype.setViewState;
const obsidian = { Plugin:class { register(fn) { this.cleanups.push(fn); } }, ItemView:class{}, FileView:class{}, Modal:class{}, Notice:class{}, TFile, WorkspaceLeaf };
const context = {module:{exports:{}}, console, require:name => name === 'obsidian' ? obsidian : name === '@codemirror/state' ? {StateField:{define:value=>value}} : {Decoration:{},EditorView:{}}};
vm.runInNewContext(source + '\nmodule.exports.navigationTarget=typeof spatialNavigationTarget === "function" ? spatialNavigationTarget : null;', context);
const Notebook = context.module.exports;
const plugin = new Notebook(); plugin.cleanups = []; plugin.data = {spatialImportApplied:true,spatialLayouts:{[files[0].path]:{boxes:[{id:'main'},{id:'gm'}],restored:true,preferText:true},[files[1].path]:{boxes:[{id:'main'}]}}};
const ready = [], leaves = [], commands = []; let writes = 0, persisted = 0;
const app = plugin.app = {vault:{adapter:{exists:async()=>false},on:()=>({}),process:()=>{writes++;}},workspace:{on:()=>({}),onLayoutReady:fn=>ready.push(fn),getLeavesOfType:type=>leaves.filter(leaf=>leaf.view.getViewType()===type),getMostRecentLeaf:()=>leaves[0],getLeaf:()=>leaves[0],getActiveFile:()=>leaves[0]?.view.file}};
plugin.manifest = {dir:'plugins/classic-notebook'}; plugin.registerView = () => {}; plugin.registerEditorExtension = () => {}; plugin.registerEvent = () => {}; plugin.persist = () => persisted++; plugin.addCommand = command => commands.push(command);
const settle = () => new Promise(resolve=>setImmediate(resolve));
(async () => {
  await plugin.setupSpatialPages();
  assert(!Object.hasOwn(plugin.data.spatialLayouts[files[0].path],'preferText'),'an old source-view choice must not keep hiding margin notes');
  assert(persisted>0);
  const toggle = commands.find(command=>command.id==='toggle-free-notebook-page');
  assert.deepEqual(JSON.parse(JSON.stringify(toggle.hotkeys)),[{modifiers:['Mod','Shift'],key:'M'}]);
  const leaf = new WorkspaceLeaf(app); leaves.push(leaf);
  const search = {match:{content:'Whole page including margin notes',matches:[[11,20]]},focus:true};
  const request = {type:'markdown',state:{file:files[0].path,mode:'preview'},active:true,pinned:true,group:'split',popstate:true};
  await leaf.setViewState(request,search);
  assert.equal(leaf.view.getViewType(),spatialType,'a search result opens the full page');
  assert.equal(leaf.calls.at(-1).location,search,'exact search locations survive routing');
  assert.equal(request.type,'markdown','caller-owned navigation state is not mutated');
  for (const key of ['state','active','pinned','group','popstate']) assert.equal(leaf.calls.at(-1).state[key],request[key]);
  await plugin.openSpatialText(leaf,files[0]); assert.equal(leaf.view.getViewType(),'markdown','deliberate source editing remains available');
  await leaf.setViewState(request,search); assert.equal(leaf.view.getViewType(),spatialType,'searching the same file exits temporary source view');
  const background = new WorkspaceLeaf(app); leaves.push(background);
  await background.setViewState({type:'markdown',state:{file:files[1].path},active:false},{subpath:'#Heading'});
  assert.equal(background.view.getViewType(),spatialType); assert.equal(background.calls[0].state.active,false,'background tabs do not steal focus');
  await leaf.setViewState({type:'markdown',state:{file:files[2].path}}); assert.equal(leaf.view.getViewType(),'markdown','ordinary Markdown stays native');
  await leaf.setViewState({type:'canvas',state:{file:files[3].path}}); assert.equal(leaf.view.getViewType(),'canvas','native Canvas stays native');
  plugin.data.canvasReplacements={[files[0].path]:files[3].path};
  for(const type of ['backlink','outgoing-link','outline']){
    const sidebar=new WorkspaceLeaf(app);
    await sidebar.setViewState({type,state:{file:files[0].path,showSearch:true}});
    assert.equal(sidebar.view.getViewType(),type,'restoring a native sidebar must never replace it with a Canvas page');
    assert.equal(sidebar.calls.at(-1).state.state.file,files[3].path);assert.equal(sidebar.calls.at(-1).state.state.showSearch,true);
  }
  await leaf.setViewState(request,search);assert.equal(leaf.view.getViewType(),'canvas','converted Markdown pages still route to Canvas');
  delete plugin.data.canvasReplacements;
  const otherVault = new WorkspaceLeaf({}); await otherVault.setViewState(request,search); assert.equal(otherVault.view.getViewType(),'markdown','another vault is never rerouted');

  const startup = new WorkspaceLeaf(app,'markdown',files[0]); leaves.push(startup);
  let saved = false; startup.view.save = async () => {saved=true;};
  ready[0](); await settle(); assert(saved,'a live Markdown editor is saved before changing its view'); assert.equal(startup.view.getViewType(),spatialType,'already open pages switch when the plugin loads');
  const racing = new WorkspaceLeaf(app,'markdown',files[0]); leaves.push(racing);
  let release; racing.view.save=()=>new Promise(resolve=>release=resolve);
  ready[0](); await settle(); racing.view=view('canvas',files[3]); release(); await settle(); assert.equal(racing.view.getViewType(),'canvas','late startup work cannot overwrite a newer navigation');
  assert.equal(writes,0,'automatic navigation does not insert markers or rewrite notes');
  plugin.cleanups.forEach(fn=>fn()); assert.equal(WorkspaceLeaf.prototype.setViewState,original,'unloading restores native routing');
  await leaf.setViewState(request,search); assert.equal(leaf.view.getViewType(),'markdown');

  const text='---\ntitle: Session\n---\n<!-- tn-box:main:start -->\nMain event\n<!-- tn-box:main:end -->\n\n<!-- tn-box:gm:start -->\nImportant GM reminder\n<!-- tn-box:gm:end -->\n';
  const target=Notebook.navigationTarget;
  const at=text.indexOf('GM reminder');
  assert.equal(target(text,{match:{content:text,matches:[[at,at+11]]}}).id,'gm','a search hit in a margin note identifies that note');
  assert.equal(target(text,{startLoc:{line:8,col:0}}).id,'gm');
  assert.equal(target(text,{line:4}).id,'main');
  assert.equal(target(text,{cursor:{from:{line:4,ch:0}}}).id,'main');
  assert.equal(target(text,{}),null,'opening without a location retains the saved viewport');
  console.log('PASS: full-page search/link/history routing, temporary text mode, shortcut, tabs and split state, vault isolation, startup-save and navigation races, zero note writes, cleanup, and search locations in margin notes.');
})().catch(error=>{console.error(error);process.exitCode=1;});

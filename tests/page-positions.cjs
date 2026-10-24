const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class TFile{constructor(path){this.path=path;this.extension=path.split('.').at(-1);this.basename=path.split('/').at(-1).replace(/\.[^.]+$/,'');}}
class TFolder{constructor(path){this.path=path;}}
const a=new TFile('Scenes/Evening.canvas'),b=new TFile('People/Person.canvas'),plain=new TFile('Scenes/New.canvas'),md=new TFile('Scenes/Text.md'),files=new Map([a,b,plain,md].map(file=>[file.path,file]));
const frames=[];
function makeView(file){
 const view={file,getViewType:()=>view.file?.extension==='canvas'?'canvas':'markdown',setEphemeralState(){}};
 const state={x:0,y:0,zoom:0};
 const node={id:file===a?'main-a':'main-b',text:'Some text',line:0};node.child={previewMode:{renderer:{getScroll:()=>node.line,applyScroll:value=>{node.line=value;return true;}}}};
 view.canvas={nodes:new Map([[node.id,node]]),canvasRect:{width:900,height:700},getState:()=>({...state}),setState:value=>Object.assign(state,value),setViewport:(x,y,zoom)=>Object.assign(state,{x,y,zoom})};return view;
}
class WorkspaceLeaf{
 constructor(app,file=a){this.app=app;this.view=makeView(file);this.calls=[];}
 async setViewState(state,location){this.calls.push({state,location});const file=files.get(state.state?.file);this.view=makeView(file||md);if(state.state?.viewState)this.view.canvas.setState(state.state.viewState);}
 async openFile(file,options){await this.setViewState({type:file.extension==='canvas'?'canvas':'markdown',state:{file:file.path,...options.state},active:options.active});}
}
const original=WorkspaceLeaf.prototype.setViewState,obsidian={Plugin:class{},ItemView:class{},FileView:class{},Modal:class{},TFile,TFolder,WorkspaceLeaf};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const context={module:{exports:{}},require:()=>obsidian,console,window:{requestAnimationFrame:callback=>frames.push(callback)}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.positionTest={notebookCanvasViewport,notebookHasNavigationTarget};',context);
const Notebook=context.module.exports,clone=value=>JSON.parse(JSON.stringify(value)),plugin=new Notebook(),cleanups=[];let persisted=0,noteWrites=0,starts=0,reveals=0;
plugin.data={pagePositions:{},spatialLayouts:{},canvasReplacements:{},lastPages:{Scenes:a.path,People:b.path},groupSections:{},hiddenFolders:[],groups:[],order:[],pageLayouts:{},collapsedPages:{},pageMeta:{},section:'Scenes',group:''};
plugin.canvasNotebookMetadata=new Map([[a.path,{version:1,cards:{},anchors:{'^test':{nodeId:'main-a',offset:0,length:4}}}],[b.path,{version:1,cards:{}}]]);plugin.canvasNotebookViews=new WeakMap();
plugin.register=callback=>cleanups.push(callback);plugin.persist=()=>persisted++;plugin.refresh=()=>{};plugin.showPages=async()=>{};plugin.isGroup=()=>false;plugin.groupFor=()=>'';plugin.sections=()=>['People'];plugin.pages=section=>[...files.values()].filter(file=>file.path.startsWith(section+'/'));plugin.scheduleNotebookHeaders=()=>plugin.renderCanvasNotebookCards();
plugin.positionCanvasNotebookStart=view=>{starts++;view.canvas.setViewport(0,0,0);};plugin.revealCanvasNotebookMatch=view=>{reveals++;view.canvas.setViewport(77,999,0);};
const ready=[],app=plugin.app={vault:{getAbstractFileByPath:path=>files.get(path),process:()=>noteWrites++},workspace:{onLayoutReady:callback=>ready.push(callback),getLeavesOfType:type=>type==='canvas'?[leaf]:[],getLeaf:()=>leaf}};
const leaf=new WorkspaceLeaf(app);app.workspace.activeLeaf=leaf;
plugin.setupSpatialNavigation();
(async()=>{
 leaf.view.canvas.setViewport(320,4820,-0.25);leaf.view.canvas.nodes.get('main-a').line=87.5;
 await plugin.selectSection('People');leaf.view.canvas.setViewport(-900,1250,0.4);leaf.view.canvas.nodes.get('main-b').line=18.2;
 await plugin.selectSection('Scenes');
 assert.deepEqual(leaf.view.canvas.getState(),{x:320,y:4820,zoom:-0.25},'section tabs restore the last Canvas pan and zoom');
 assert.equal(leaf.view.canvas.nodes.get('main-a').line,87.5,'scrolling within a long card is restored as well');
 assert.equal(starts,1,'the start position runs only for a page without a recorded position');
 await plugin.selectSection('People');assert.deepEqual(leaf.view.canvas.getState(),{x:-900,y:1250,zoom:0.4});assert.equal(leaf.view.canvas.nodes.get('main-b').line,18.2);
 const nonTextNodes=[{id:'picture',nodeEl:{querySelector:()=>null}},{id:'link',nodeEl:{querySelector:()=>null}},{id:'group',nodeEl:{querySelector:()=>null}},{id:'editing',isEditing:true,child:{editMode:{}},nodeEl:{querySelector:()=>null}}];
 for(const node of nonTextNodes)leaf.view.canvas.nodes.set(node.id,node);
 assert.doesNotThrow(()=>plugin.rememberNotebookPagePosition(leaf.view),'image, link, group and editor cards without a rendered Markdown scroller must not break position capture');
 await plugin.selectSection('Scenes');assert.equal(leaf.view.file,a,'page clicks still navigate away from a mixed Canvas');
 await plugin.selectSection('People');
 const remember=plugin.rememberNotebookPagePosition,clearSearch=plugin.clearCanvasNotebookSearch;plugin.rememberNotebookPagePosition=()=>{throw Error('A stale embedded view');};plugin.clearCanvasNotebookSearch=()=>{throw Error('A detached highlight');};
 const warn=context.console.warn;let optionalFailures=0;context.console.warn=()=>optionalFailures++;
 await plugin.selectSection('Scenes');assert.equal(leaf.view.file,a,'optional snapshot or highlight failures must never block section navigation');assert.equal(optionalFailures,2);
 plugin.rememberNotebookPagePosition=remember;plugin.clearCanvasNotebookSearch=clearSearch;context.console.warn=warn;
 await plugin.selectSection('People');
 for(let i=0;i<4;i++){await plugin.selectSection('Scenes');await plugin.selectSection('People');}assert.equal(starts,1,'repeat visits never jump to the beginning');
 const request={type:'canvas',state:{file:a.path},active:true},before=clone(request);await leaf.setViewState(request);
 assert.deepEqual(request,before,'saved positions are added without mutating caller-owned state');
 assert.deepEqual(clone(leaf.calls.at(-1).state.state.viewState),{x:320,y:4820,zoom:-0.25});
 const link={subpath:'#^test'};await leaf.setViewState({type:'canvas',state:{file:a.path}},link);await settle();assert.equal(leaf.calls.at(-1).state.state.viewState,undefined,'an explicit anchor is never replaced by the remembered position');assert.equal(reveals,1);assert.equal(leaf.view.canvas.getState().y,999);
 await leaf.setViewState({type:'canvas',state:{file:a.path,viewState:{x:42,y:88,zoom:1}}},{focus:true});assert.deepEqual(leaf.view.canvas.getState(),{x:42,y:88,zoom:1},'native back/forward history keeps its own viewport');
 for(const location of [{match:{nodeId:'main-a'}},{line:4},{startLoc:{line:4}},{cursor:{from:{line:4}}},{scroll:12}]){await leaf.setViewState({type:'canvas',state:{file:a.path}},location);assert.equal(leaf.calls.at(-1).state.state.viewState,undefined);}
 await leaf.setViewState({type:'canvas',state:{file:a.path,viewState:{x:200,y:4200,zoom:-0.5}}});await settle();leaf.view.canvas.nodes.get('main-a').line=25;
 await plugin.selectSection('People');
 const fast1=leaf.setViewState({type:'canvas',state:{file:a.path}}),fast2=leaf.setViewState({type:'canvas',state:{file:b.path}});await Promise.all([fast1,fast2]);await settle();await plugin.selectSection('Scenes');
 assert.equal(leaf.view.canvas.nodes.get('main-a').line,25,'a page left before restoration finishes cannot overwrite its last completed snapshot');
 assert.equal(leaf.view.canvas.getState().y,4200);
 const foreign=new WorkspaceLeaf({});await foreign.setViewState({type:'canvas',state:{file:a.path}});assert.equal(foreign.calls[0].state.state.viewState,undefined,'another vault remains isolated');
 plugin.data.pagePositions[plain.path]={type:'canvas',viewport:{x:11,y:850,zoom:0.75},cards:{'main-b':{line:7}}};
 await plugin.openPage(plain);assert.equal(leaf.view.canvas.getState().y,850);assert.equal(leaf.view.canvas.nodes.get('main-b').line,7,'ordinary Canvas pages also restore without notebook metadata');
 plugin.data.pagePositions[plain.path].viewport={x:null,y:2,zoom:0};assert.equal(plugin.notebookPagePosition(plain.path),null);
 await plugin.openPage(md);assert.equal(leaf.calls.at(-1).state.state.viewState,undefined,'native Markdown state is unchanged');
 await plugin.openPage(a);leaf.view.canvas.setViewport(300,7200,0.1);plugin.rememberNotebookPagePositions();
 const persistedData=clone(plugin.data);assert.equal(persistedData.pagePositions[a.path].viewport.y,7200,'positions are portable JSON in plugin settings');
 const old=a.path;a.path='Scenes/Renamed.canvas';files.delete(old);files.set(a.path,a);plugin.trackRename(a,old);assert.equal(plugin.data.pagePositions[a.path].viewport.y,7200);assert(!plugin.data.pagePositions[old]);
 plugin.trackRename(new TFolder('ScenesNew'),'Scenes');assert(plugin.data.pagePositions['ScenesNew/Renamed.canvas'],'folder renames migrate stored page positions');
 plugin.trackDelete(new TFolder('ScenesNew'));assert(!plugin.data.pagePositions['ScenesNew/Renamed.canvas'],'deleted pages cannot leave orphaned positions');
 const view=makeView(b),callbacks=[],renderer=view.canvas.nodes.get('main-b').child.previewMode.renderer;renderer.applyScroll=()=>false;renderer.onRendered=callback=>callbacks.push(callback);
 plugin.restoreNotebookCanvasCardPositions(view,{cards:{'main-b':{line:42},missing:{line:1}}});assert.equal(callbacks.length,1);let lateScrolls=0;renderer.applyScroll=()=>lateScrolls++;view.__notebookPositionToken=null;callbacks[0]();assert.equal(lateScrolls,0,'a later text link cancels deferred scroll restoration');
 assert.equal(noteWrites,0,'remembering positions never rewrites Canvas note files');assert(persisted>0);
 cleanups.forEach(callback=>callback());assert.equal(WorkspaceLeaf.prototype.setViewState,original);
 console.log('PASS: real section/page routing preserves per-page Canvas pan/zoom and card scroll, repeat/rapid switches, explicit links/search, native history, plain Canvas, malformed state, vault isolation, rename/delete, deferred render cancellation, unload snapshots, and zero note writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});

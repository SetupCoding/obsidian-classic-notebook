const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class TFile{constructor(path){this.path=path;this.extension=path.split('.').at(-1);this.basename=path.split('/').at(-1).replace(/\.[^.]+$/,'');}}
class TFolder{constructor(path){this.path=path;}}
const context={module:{exports:{}},require:()=>({Plugin:class{},ItemView:class{},FileView:class{},Modal:class{},TFile,TFolder,normalizePath:value=>value}),console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.alignmentTest={newCanvas:typeof notebookNewCanvasPage==="function"?notebookNewCanvasPage:null,NameModal};',context);
const Notebook=context.module.exports,plugin=new Notebook(),cleanups=[],files=new Map(),leaves=[],writes=[];
plugin.data={pageMeta:{},pagePositions:{},section:'Scenes',groups:[],hiddenFolders:[],hiddenPages:[],pageLayouts:{},collapsedPages:{}};
plugin.canvasNotebookMetadata=new Map();plugin.canvasNotebookViews=new WeakMap();plugin.register=callback=>cleanups.push(callback);plugin.persist=()=>{};plugin.refresh=()=>{};plugin.rebuildAutoLinks=()=>{};
plugin.app={vault:{getRoot:()=>new TFolder(''),getAbstractFileByPath:value=>files.get(value),getFiles:()=>[...files.values()].filter(file=>file instanceof TFile),async create(name,text){const file=new TFile(name);file.content=text;files.set(name,file);writes.push(file);return file;}},workspace:{getLeavesOfType:()=>leaves}};files.set('Scenes',new TFolder('Scenes'));
function makeView(name,{empty=false,metadata=true}={}){
 const file=new TFile(name);files.set(name,file);
 const view={file},state={x:0,y:0,zoom:-2};let fits=0;
 const canvas=view.canvas={nodes:new Map(),canvasRect:{width:1000,height:800},zoomToFitQueued:true,zoom:-2,zoomBreakpoint:0,
   getState(){return {...state};},setViewport(x,y,zoom){Object.assign(state,{x,y,zoom});this.zoom=zoom;},
   setState(value){this.setViewport(value.x,value.y,value.zoom);this.zoomToFitQueued=false;},
   zoomToBbox(box){fits++;this.setViewport((box.minX+box.maxX)/2,(box.minY+box.maxY)/2,-3);},
   zoomToFit(){this.zoomToBbox({minX:24,minY:48,maxX:1000,maxY:18000});},
   onResize(){if(this.canvasRect.width>0&&this.zoomToFitQueued){this.zoomToFitQueued=false;this.zoomToFit();}},
   addNode(node){this.nodes.set(node.id,node);return node;}
 };
 const node=(id='main')=>({id,type:'text',text:'Long note',x:24,y:48,width:650,height:18000,startEditing(){if(canvas.zoom<canvas.zoomBreakpoint+.1)canvas.zoomToBbox({minX:this.x,minY:this.y,maxX:this.x+this.width,maxY:this.y+this.height});this.edited=true;}});
 if(!empty)canvas.addNode(node());
 if(metadata)plugin.canvasNotebookMetadata.set(name,{version:1,cards:{}});else plugin.data.pageMeta[name]={created:'2020-01-01'};
 const leaf={view};leaves.splice(0,leaves.length,leaf);return{view,canvas,node,leaf,fits:()=>fits};
}
(async()=>{
 const initial=makeView('Scenes/Initial.canvas');initial.view.__notebookInitialViewport=true;
 plugin.renderCanvasNotebookCards();
 assert.deepEqual(initial.canvas.getState(),{x:500,y:408,zoom:0},'the top-left note corner appears at 24px / 40px in the viewport');
 assert.equal(initial.canvas.zoomToFitQueued,false,'the native delayed fit must be consumed, not left queued after alignment');
 initial.canvas.onResize();assert.equal(initial.fits(),0,'a deferred resize cannot center the page again');
 const manual={x:850,y:8600,zoom:-.75};initial.canvas.setState(manual);
 for(let i=0;i<4;i++){initial.canvas.zoomToFitQueued=true;initial.canvas.onResize();plugin.renderCanvasNotebookCards();}
 assert.deepEqual(initial.canvas.getState(),manual,'edits, resize and repeated header renders retain manual pan and zoom');
 initial.view.__notebookInitialViewport=true;plugin.renderCanvasNotebookCards();assert.deepEqual(initial.canvas.getState(),manual,'a repeated open notification cannot reset an initialized page');
 const main=initial.canvas.nodes.get('main');main.startEditing();assert.equal(main.edited,true);assert.deepEqual(initial.canvas.getState(),manual,'editing a tall card must not fit the whole card');
 const added=initial.node('added');initial.canvas.addNode(added);added.startEditing();assert.deepEqual(initial.canvas.getState(),manual,'new cards are protected before their first edit');
 initial.canvas.zoomToFit();assert.equal(initial.fits(),1,'the explicit native fit control remains available');
 const historical=makeView('Scenes/History.canvas');historical.canvas.setState({x:800,y:9000,zoom:.2});historical.view.__notebookInitialViewport=false;plugin.renderCanvasNotebookCards();assert.equal(historical.canvas.getState().y,9000,'saved history takes priority over the initial alignment');
 const pending=makeView('Scenes/Pending.canvas');plugin.notebookNavigationPending=new WeakMap([[pending.leaf,1]]);plugin.renderCanvasNotebookCards();assert.equal(pending.canvas.getState().y,0,'rendering waits until navigation has applied its saved viewport');plugin.notebookNavigationPending.delete(pending.leaf);pending.canvas.setState(manual);pending.view.__notebookInitialViewport=false;plugin.renderCanvasNotebookCards();assert.deepEqual(pending.canvas.getState(),manual);
 const legacy=makeView('Scenes/Older new page.canvas',{empty:true,metadata:false});plugin.renderCanvasNotebookCards();assert.deepEqual(legacy.canvas.getState(),{x:476,y:360,zoom:0},'older empty notebook pages also open with their origin at the top left');legacy.canvas.setState(manual);legacy.canvas.addNode(legacy.node());plugin.renderCanvasNotebookCards();assert.deepEqual(legacy.canvas.getState(),manual,'adding the first card to an empty page does not reposition the page');
 const normal=makeView('Scenes/Ordinary.canvas');plugin.canvasNotebookMetadata.delete(normal.view.file.path);plugin.renderCanvasNotebookCards();normal.canvas.nodes.get('main').startEditing();assert.equal(normal.fits(),1,'unmanaged native Canvas pages keep native behavior');
 const startup=new Notebook();startup.data={pageMeta:{}};startup.register=()=>{};startup.registerEvent=()=>{};startup.registerEditorSuggest=()=>{};startup.addCommand=()=>{};startup.app={vault:{getFiles:()=>[],on:()=>({})},workspace:{getLeavesOfType:()=>[{view:historical.view}]}};
 await startup.setupCanvasNotebook();startup.canvasNotebookMetadata.set(historical.view.file.path,{version:1,cards:{}});historical.canvas.setState(manual);startup.renderCanvasNotebookCards();assert.deepEqual(historical.canvas.getState(),manual,'reloading the plugin keeps an already visible page in place');
 cleanups.forEach(callback=>callback());initial.canvas.setState(manual);main.startEditing();assert.equal(initial.fits(),2,'unloading restores native edit zoom');
 assert.equal(writes.length,0,'viewport alignment never rewrites existing page contents');
 const make=Notebook.alignmentTest.newCanvas,created='2026-10-24T09:00:00Z',fresh=make({title:'New',created});assert.equal(fresh.nodes.length,1);assert.equal(fresh.nodes[0].text,'');assert.equal(fresh.nodes[0].x,24);assert.equal(fresh.nodes[0].y,48);assert.equal(fresh.notebook.cards[fresh.nodes[0].id].appearance,'native');assert.equal(fresh.notebook.frontmatter.created,created);
 // Exercise both page creation entry points, including their immediate cache update.
 const opened=[];plugin.openPage=async file=>opened.push(file);plugin.isGroupOverview=()=>false;
 let save;Notebook.alignmentTest.NameModal.prototype.open=function(){save=this.submit;};
 plugin.newPage();assert.equal(typeof save,'function');await save('Blank page');
 const blank=JSON.parse(opened[0].content);assert.equal(blank.nodes.length,1);assert.equal(blank.nodes[0].text,'');assert(plugin.canvasNotebookMetadata.has(opened[0].path));
 const api=await plugin.createNotebookPage({section:'Scenes',title:'API page',text:'**Preserved** [[Another]]',aliases:['Alias']});const doc=JSON.parse(api.content);assert.equal(doc.nodes[0].text,'**Preserved** [[Another]]');assert.equal(doc.notebook.frontmatter.aliases[0],'Alias');assert(plugin.canvasNotebookMetadata.has(api.path));
 const overview=await plugin.createNotebookPage({section:'Scenes',title:'Generated overview'});assert.equal(JSON.parse(overview.content).nodes.length,0,'empty integration pages keep space for their own embedded task/file cards');
 console.log('PASS: left-aligned new/imported/empty notebook pages, delayed native fits, repeated renders and navigation, tall/new card edit zoom, manual controls, native history, unmanaged pages, unload cleanup, both creation paths and no existing note writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});

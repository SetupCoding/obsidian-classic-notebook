const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class TFile{constructor(path){this.path=path;this.extension=path.split('.').at(-1);this.basename=path.split('/').at(-1).replace(/\.[^.]+$/,'');}}
const frames=[],view={EditorView:{updateListener:{of:listener=>({listener})}}};
const context={module:{exports:{}},console,window:{requestAnimationFrame:callback=>frames.push(callback),cancelAnimationFrame:()=>{}},
  require:name=>name==='@codemirror/view'?view:{Plugin:class{},ItemView:class{},FileView:class{},Modal:class{},TFile}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.autoHeightTest={notebookFitCanvasCard,notebookCanvasOverflow};',context);
const Notebook=context.module.exports,{notebookFitCanvasCard:fit,notebookCanvasOverflow:overflow}=Notebook.autoHeightTest;
const flush=()=>{while(frames.length)frames.shift()();};

// The text element is 2px smaller than the node (border). A 1px measurement box
// reveals the real content height, as in Obsidian's own fit-to-content action.
function makeCard(id,{content,height=200,editing=false}={}){
  const classes=new Set(),dom={id};
  const node={id,type:'text',text:'Text',x:24,y:48,width:650,height,isEditing:editing,renders:0,previewResizes:0,
    resize(size){this.width=size.width;this.height=Math.round(size.height);},render(){this.renders++;},setText(value){this.text=value;}};
  const element={isConnected:true,style:{height:''},
    get clientHeight(){return this.style.height==='1px'?1:node.height-2;},
    get scrollHeight(){return Math.max(typeof content==='function'?content(node):content,this.clientHeight);}};
  node.child={previewMode:{renderer:{onResize:()=>node.previewResizes++}}};
  node.nodeEl={classes,classList:{toggle:(key,value)=>value?classes.add(key):classes.delete(key),contains:key=>classes.has(key)},contains:target=>target===dom,
    querySelector:selector=>selector.includes(node.isEditing?'.cm-scroller':'.markdown-preview-view')?element:null,
    getBoundingClientRect:()=>({left:node.x,top:node.y,width:node.width,height:node.height})};
  return {node,element,dom};
}
function makeCanvas(name,cards,{readonly=false}={}){
  const saves=[],pans=[],canvas={nodes:new Map(cards.map(card=>[card.node.id,card.node])),readonly,scale:1,requestSave(){saves.push(1);},panIntoView(box){pans.push(box);}};
  const overflowing=()=>cards.filter(card=>card.node.nodeEl.classes.has('cn-canvas-text-overflow')).map(card=>({classList:{remove:key=>card.node.nodeEl.classes.delete(key)}}));
  const leaf={view:{file:new TFile(name),canvas,contentEl:{querySelectorAll:selector=>selector==='.cn-canvas-text-overflow'?overflowing():[]}}};
  canvas.view=leaf.view;return {canvas,leaf,saves,pans};
}

// Pure measurement and fitting through the native node API.
const fits=makeCard('fits',{content:150});assert.equal(overflow(fits.node),-48,'unused space is measured below the text');
const fitsCanvas=makeCanvas('Notes/Fit.canvas',[fits]);assert.equal(fit(fits.node,fitsCanvas.canvas,200),'fit');assert.equal(fits.node.height,200);assert.equal(fitsCanvas.saves.length,0,'a card at its floor is never resized or saved');
const long=makeCard('long',{content:500}),longCanvas=makeCanvas('Notes/Long.canvas',[long]);
assert.equal(overflow(long.node),302);assert.equal(long.element.style.height,'','the measurement box is restored');
assert.equal(fit(long.node,longCanvas.canvas,200),'resized');assert.equal(long.node.height,502,'the card grows exactly to its content');assert.equal(long.node.width,650,'only the height changes');
assert.equal(long.node.renders,1);assert.equal(longCanvas.saves.length,1,'resizing goes through the native Canvas save and history path');
const roomy=makeCard('roomy',{content:300,height:600}),roomyCanvas=makeCanvas('Notes/Roomy.canvas',[roomy]);
assert.equal(fit(roomy.node,roomyCanvas.canvas,250),'resized');assert.equal(roomy.node.height,302,'a grown card shrinks back to its text');
roomy.node.height=600;fit(roomy.node,roomyCanvas.canvas,400);assert.equal(roomy.node.height,400,'never below the height it had before writing');
const locked=makeCard('locked',{content:500}),lockedCanvas=makeCanvas('Notes/Locked.canvas',[locked],{readonly:true});
assert.equal(fit(locked.node,lockedCanvas.canvas,200),'blocked');assert.equal(locked.node.height,200,'a read-only Canvas is never resized');assert.equal(lockedCanvas.saves.length,0);
const runaway=makeCard('runaway',{content:node=>node.height+14}),runawayCanvas=makeCanvas('Notes/Runaway.canvas',[runaway]);
assert.equal(fit(runaway.node,runawayCanvas.canvas,200),'blocked');assert.equal(runaway.node.height,216,'content that grows with its card stops after one step');

// Plugin flow: typing fits the edited card, other cards show clipped text.
const plugin=new Notebook(),extensions=[],cleanups=[];
plugin.data={pageMeta:{}};plugin.register=callback=>cleanups.push(callback);plugin.registerEditorExtension=extension=>extensions.push(extension);
plugin.canvasNotebookMetadata=new Map([['Notes/Page.canvas',{version:1,cards:{}}],['Notes/Readonly.canvas',{version:1,cards:{}}]]);
plugin.canvasNotebookViews=new WeakMap();plugin.trackCanvasNotebookViewport=()=>{};plugin.trackCanvasNotebookAnchors=()=>{};
let content=150;const typed=makeCard('typed',{content:()=>content,editing:true}),old=makeCard('old',{content:900}),short=makeCard('short',{content:100}),later=makeCard('later',{content:120});
const page=makeCanvas('Notes/Page.canvas',[typed,old,short,later]),plain=makeCard('plain',{content:400,editing:true}),ordinary=makeCanvas('Notes/Ordinary.canvas',[plain]);
const locked2=makeCard('locked2',{content:700}),readonly=makeCanvas('Notes/Readonly.canvas',[locked2],{readonly:true});
let leaves=[page.leaf,ordinary.leaf,readonly.leaf];plugin.app={workspace:{getLeavesOfType:type=>type==='canvas'?leaves:[]}};
plugin.setupCanvasAutoHeight();assert.equal(extensions.length,1);const listener=extensions[0].listener;
const editor=dom=>{dom.closest=()=>true;return {dom,hasFocus:true,state:{selection:{main:{head:3}}},coordsAtPos:()=>({left:120,top:420,bottom:440})};};
const typedEditor=editor(typed.dom),type=view=>listener({docChanged:true,geometryChanged:false,heightChanged:false,view});
listener({docChanged:false,geometryChanged:true,heightChanged:false,view:typedEditor});assert.equal(frames.length,0,'opening an editor without changing text does not resize');
type(typedEditor);flush();assert.equal(typed.node.height,200,'text that still fits keeps the card size');
content=640;type(typedEditor);type(typedEditor);
assert.equal(frames.length,1,'several edits in one frame share one measurement');flush();
assert.equal(typed.node.height,642,'the edited card grows while typing');assert.equal(page.saves.length,1);
assert.deepEqual({...page.pans.at(-1)},{minX:120,minY:420,maxX:121,maxY:440},'the caret is kept in view after the card grows');
assert(!typed.node.nodeEl.classes.has('cn-canvas-text-overflow'));

// Ending editing: the rendered preview is usually shorter or longer than the editor.
typed.node.isEditing=false;content=560;plugin.renderCanvasNotebookCards();
assert.equal(typed.node.height,562,'the card fits its rendered preview after editing');
content=700;plugin.renderCanvasNotebookCards();assert.equal(typed.node.height,702,'late preview content grows the card again');
content=100;plugin.renderCanvasNotebookCards();assert.equal(typed.node.height,200,'deleted text shrinks the card only down to its earlier size');
assert.equal(old.node.height,200,'merely opening a page never rewrites untouched cards');assert(old.node.nodeEl.classes.has('cn-canvas-text-overflow'),'clipped text of an untouched card overflows visibly');
assert.equal(old.node.previewResizes,1,'the preview re-renders once to show all overflowing text');plugin.renderCanvasNotebookCards();assert.equal(old.node.previewResizes,1);
assert(!short.node.nodeEl.classes.has('cn-canvas-text-overflow'),'cards that fit keep native clipping and containment');
assert.equal(page.saves.length,4);

// A manual resize is respected and shown as overflow; writing again starts from that size.
content=800;typed.node.height=300;plugin.renderCanvasNotebookCards();assert.equal(typed.node.height,300,'a manual resize ends automatic fitting');assert(typed.node.nodeEl.classes.has('cn-canvas-text-overflow'));
typed.node.isEditing=true;content=250;type(typedEditor);flush();assert.equal(typed.node.height,300,'the manual size becomes the new minimum');
typed.node.isEditing=false;plugin.renderCanvasNotebookCards();assert(!typed.node.nodeEl.classes.has('cn-canvas-text-overflow'));

// Editing cards stay native while rendering, unmanaged pages keep native Canvas behavior.
later.node.isEditing=true;later.node.nodeEl.classes.add('marker');plugin.renderCanvasNotebookCards();assert(later.node.nodeEl.classes.has('marker'));
type(editor(plain.dom));flush();
assert.equal(plain.node.height,200,'ordinary Canvas files are not resized');assert(!plain.node.nodeEl.classes.has('cn-canvas-text-overflow'));
type({dom:{closest:()=>null}});assert.equal(frames.length,0,'Markdown editors outside Canvas are ignored');

// Read-only Canvas: never resized, text overflows visibly instead.
plugin.canvasCardChanges.set(locked2.node,{time:Date.now(),base:200,height:200});plugin.renderCanvasNotebookCards();
assert.equal(locked2.node.height,200);assert.equal(readonly.saves.length,0);assert(locked2.node.nodeEl.classes.has('cn-canvas-text-overflow'));

// A card whose content grows with it falls back to visible overflow without repeated growth.
const unstable=makeCard('unstable',{content:node=>node.height+20}),unstablePage=makeCanvas('Notes/Page.canvas',[unstable]);leaves=[unstablePage.leaf];
plugin.canvasCardChanges.set(unstable.node,{time:Date.now(),base:200,height:200});plugin.renderCanvasNotebookCards();plugin.renderCanvasNotebookCards();
assert.equal(unstable.node.height,222,'an unstable card grows at most once');assert(unstable.node.nodeEl.classes.has('cn-canvas-text-overflow'));

// Obsidian 1.14 edits cards in an iframe: the card is found through its frame
// and measured through CodeMirror's own scroller.
let frameContent=150;const framed=makeCard('framed',{content:()=>frameContent,editing:true}),framedPage=makeCanvas('Notes/Page.canvas',[framed]);leaves=[framedPage.leaf];
const frameEl={ownerDocument:{},closest:selector=>selector==='.canvas-node'?framed.node.nodeEl:null,getBoundingClientRect:()=>({left:framed.node.x+1,top:framed.node.y+1})};
const frameEditor={dom:{ownerDocument:{defaultView:{frameElement:frameEl}},closest:()=>null},hasFocus:true,state:{selection:{main:{head:1}}},coordsAtPos:()=>({left:10,top:300,bottom:320}),scrollDOM:framed.element};
framed.node.child.editMode={editor:{cm:frameEditor}};framed.node.nodeEl.querySelector=()=>null;framed.node.nodeEl.contains=target=>target===frameEl;
assert.equal(plugin.canvasNodeForEditor(frameEditor.dom)?.node,framed.node,'an iframe editor resolves to its Canvas card');
frameContent=500;type(frameEditor);flush();
assert.equal(framed.node.height,502,'an iframe editor grows its card');
assert.deepEqual({...framedPage.pans.at(-1)},{minX:framed.node.x+11,minY:framed.node.y+301,maxX:framed.node.x+12,maxY:framed.node.y+321},'iframe caret coordinates are offset by the frame position');

// Transparent card backgrounds are a vault setting that defaults to on.
const body=new Set();plugin.app.workspace.containerEl={ownerDocument:{body:{classList:{toggle:(key,value)=>value?body.add(key):body.delete(key)}}}};
plugin.applyNotebookAppearance();assert(body.has('cn-transparent-cards'),'cards are transparent by default');
plugin.data.transparentCanvasCards=false;plugin.applyNotebookAppearance();assert(!body.has('cn-transparent-cards'));assert(body.has('cn-classic-colors'));

// Lazy preview rendering, images and fonts change sizes only, so they are observed.
const observed=[],unobserved=[];let disconnected=0,notify,headers=0;
class FakeObserver{constructor(callback){notify=callback;}observe(element){observed.push(element);}unobserve(element){unobserved.push(element);}disconnect(){disconnected++;}}
const host={ResizeObserver:FakeObserver},makePreview=()=>{const sizer={};return {isConnected:true,ownerDocument:{defaultView:host},querySelector:selector=>selector==='.markdown-preview-sizer'?sizer:null};};
const lazy=makeCard('lazy',{content:100}),lazyPage=makeCanvas('Notes/Page.canvas',[lazy]);leaves=[lazyPage.leaf];plugin.scheduleNotebookHeaders=()=>headers++;
let preview=makePreview();lazy.node.child.previewMode.renderer.previewEl=preview;
plugin.renderCanvasNotebookCards();assert.equal(observed.length,2,'preview and its content are observed');notify();assert.equal(headers,1,'a size change schedules a render pass');
plugin.renderCanvasNotebookCards();assert.equal(observed.length,2,'each element is observed once');
preview=makePreview();lazy.node.child.previewMode.renderer.previewEl=preview;plugin.renderCanvasNotebookCards();assert.equal(unobserved.length,2);assert.equal(observed.length,4,'a re-mounted preview replaces the old observation');
preview.isConnected=false;plugin.renderCanvasNotebookCards();assert.equal(unobserved.length,4,'detached previews are released');assert.equal(plugin.canvasCardObserved.size,0);

// Disabling the plugin removes every overflow marker and observer.
leaves=[page.leaf,readonly.leaf,unstablePage.leaf];cleanups.forEach(callback=>callback());assert.equal(disconnected,1);
for(const card of [old,typed,locked2,unstable])assert(!card.node.nodeEl.classes.has('cn-canvas-text-overflow'),'unload restores native clipping');
console.log('PASS: Canvas cards fit typed text and their rendered preview without shrinking below their earlier size, keep the caret visible including iframe editors, never rewrite untouched or read-only cards, respect manual resizing, stop on unstable content, render and show clipped text as visible overflow, transparent-card setting and unload cleanup.');

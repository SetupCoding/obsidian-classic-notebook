const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={module:{exports:{}},console,window:{requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{}},require:()=>({Plugin:class{},ItemView:class{},FileView:class{},Modal:class{}})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.parityTest={notebookCanvasAlignmentSpace,notebookCanvasListShift,notebookShiftCanvasCardsBelow,notebookCanvasLayoutLines};',context);
const Notebook=context.module.exports,{notebookCanvasAlignmentSpace:align,notebookCanvasListShift:indent,notebookShiftCanvasCardsBelow:push,notebookCanvasLayoutLines:layout}=Notebook.parityTest;
const plain=map=>Object.fromEntries(map);

// Spacing: blank lines before a line carry its missing or surplus space; without
// blank lines the space becomes padding, which never turns negative.
const probes=[{line:0,top:10},{line:2,top:60},{line:3,top:90}];
let result=align(probes,new Map([[0,10],[2,50],[3,85]]),new Map([[1,20]]));
assert.deepEqual(plain(result.blank),{1:30},'a blank line grows to the preview distance');assert.equal(result.pad.size,0,'a line cannot move up through padding');assert.equal(result.changed,true);
result=align([{line:0,top:0},{line:2,top:20}],new Map([[0,0],[2,40]]),new Map([[1,22.79]]));assert.deepEqual(plain(result.blank),{1:2.79},'imported paragraphs pull blank lines together');
result=align([{line:0,top:0},{line:2,top:5}],new Map([[0,0],[2,40]]),new Map([[1,22.79]]));assert.deepEqual(plain(result.blank),{1:0},'blank lines shrink to nothing at most');
result=align([{line:0,top:16},{line:1,top:56}],new Map([[0,0],[1,24]]),new Map());assert.deepEqual(plain(result.pad),{0:16,1:16},'padding adds space where no blank line exists');
result=align([{line:0,top:16},{line:1,top:56}],new Map([[0,16],[1,56]]),new Map(),result);assert.equal(result.changed,false,'an aligned editor needs no further pass');

// Lists: text starts where the preview starts it; the editor's own hanging indent is kept as the base.
let lists=indent([{line:0,list:true,left:34.3},{line:1,list:false,left:12}],new Map([[0,30.83],[1,12]]),new Map([[0,18]]));
assert.deepEqual(plain(lists.shift),{0:3.47});assert.deepEqual(plain(lists.base),{0:18});assert.equal(lists.changed,true);
lists=indent([{line:0,list:true,left:34.3}],new Map([[0,34.3]]),new Map([[0,21.47]]),lists);assert.equal(lists.changed,false);assert.deepEqual(plain(lists.base),{0:18},'the base indent is measured once');

// Cards below a resized card keep their distance; side, overlapping and group cards stay.
const card=(id,x,y,width,height,type='text')=>({id,x,y,width,height,getData:()=>({type}),moveAndResize(box){Object.assign(this,{x:box.x,y:box.y,width:box.width,height:box.height});}});
const grown=card('grown',0,0,100,140),below=card('below',20,150,100,50),cascade=card('cascade',110,250,100,50),side=card('side',300,150,100,50),overlap=card('overlap',50,80,50,50),group=card('group',0,400,300,100,'group');
const canvas={nodes:new Map([grown,below,cascade,side,overlap,group].map(node=>[node.id,node]))};
assert.equal(push(canvas,grown,100,40),2);
assert.deepEqual([below.y,cascade.y,side.y,overlap.y,group.y],[190,290,150,80,400],'only cards in the pushed column move, by the growth');
assert.equal(push(canvas,grown,140,-40),2);assert.deepEqual([below.y,cascade.y],[150,250],'shrinking pulls them back up');
assert.equal(push(canvas,grown,100,0),0);

// Imported blank lines: one joins paragraphs, two or more leave one OneNote line.
const lines=layout('A\n\nB\n\n\nC');assert(lines[0].style.includes('--cn-imported-empty-space:calc(0px / 1)'));assert(lines[1].style.includes('--cn-imported-empty-space:calc(22.79px / 2)'));

// The editor iframe receives the card classes, the app's rem size and imported typography.
const appended=[],removed=[],rootClasses=new Set();
const mainDoc={documentElement:{},defaultView:{getComputedStyle:()=>({fontSize:'16px'})}};
const host={classList:{contains:name=>name==='tn-canvas-imported-card'},ownerDocument:mainDoc};
const frame={ownerDocument:mainDoc,closest:selector=>selector==='.canvas-node'?host:null};
let style=null;
const frameDoc={defaultView:{frameElement:frame},documentElement:{classList:{toggle:(name,on)=>on?rootClasses.add(name):rootClasses.delete(name),remove:(...names)=>names.forEach(name=>rootClasses.delete(name))}},
  head:{appendChild:element=>{style=element;appended.push(element);}},getElementById:id=>style&&style.id===id?style:null,createElement:()=>({id:'',textContent:'',remove(){removed.push(this);style=null;}})};
const editor={dom:{ownerDocument:frameDoc},contentDOM:{style:{fontSize:'99px'}}};
const node={id:'card'},view={file:{path:'Notes/Page.canvas',extension:'canvas'}},cardCanvas={view};view.canvas=cardCanvas;
const plugin=new Notebook(),cleanups=[],extensions=[];
plugin.data={pageMeta:{}};plugin.register=callback=>cleanups.push(callback);plugin.registerEditorExtension=extension=>extensions.push(extension);plugin.app={workspace:{getLeavesOfType:()=>[]}};
plugin.canvasNodeForEditor=dom=>dom===editor.dom?{canvas:cardCanvas,node}:null;
plugin.canvasNotebookMetadata=new Map([['Notes/Page.canvas',{cards:{card:{label:'Import',typography:{fontFamily:'Calibri',fontSizePt:14,lineHeightPt:17.09}}}}]]);
plugin.canvasEditorDocuments=new Set();plugin.register(()=>{});
assert.equal(plugin.syncCanvasEditorCard({dom:{ownerDocument:{defaultView:{frameElement:null}}}}),null,'editors outside a Canvas iframe are ignored');
assert.equal(plugin.syncCanvasEditorCard(editor)?.node,node);
assert(rootClasses.has('tn-canvas-imported-card'));assert(!rootClasses.has('tn-canvas-consistent-card'));
assert.equal(appended.length,1);assert(style.textContent.includes('font-size:16px !important'),'rem matches the app root inside the iframe');
assert.equal(editor.contentDOM.style.fontSize,'14pt');assert.equal(editor.contentDOM.style.lineHeight,'17.09pt');assert.equal(editor.contentDOM.style.fontFamily,'Calibri');
plugin.syncCanvasEditorCard(editor);assert.equal(appended.length,1,'the root size style is created once per iframe');
plugin.canvasNotebookMetadata.delete('Notes/Page.canvas');assert.equal(plugin.syncCanvasEditorCard(editor),null,'unmanaged Canvas files are not aligned');assert.equal(editor.contentDOM.style.fontSize,'','stale imported typography is cleared');
// Unload: the iframe loses the style element and the card classes.
const real=new Notebook();real.register=callback=>cleanups.push(callback);real.registerEditorExtension=extension=>extensions.push(extension);
const view2={EditorView:{decorations:{from:()=>null}},ViewPlugin:{fromClass:value=>value},Decoration:{none:null,line:()=>null,set:()=>null}};
context.require=name=>name==='@codemirror/state'?{StateField:{define:spec=>spec},StateEffect:{define:()=>({of:value=>value})}}:name==='@codemirror/view'?view2:{};
real.setupCanvasEditParity();real.canvasEditorDocuments.add(frameDoc);rootClasses.add('tn-canvas-consistent-card');style={id:'cn-canvas-editor-root',remove(){removed.push(this);style=null;}};
cleanups.at(-1)();assert.equal(rootClasses.size,0);assert.equal(removed.length,1);assert.equal(real.canvasEditorDocuments.size,0);
console.log('PASS: read/edit alignment space from blank lines and padding, measured list indents, pushing cards below with cascade and exceptions, imported blank-line model, iframe card classes, rem size, imported typography, unmanaged files and unload cleanup.');

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={module:{exports:{}},require:()=>({Plugin:class{},ItemView:class{},FileView:class{},Modal:class{}})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.searchTest={notebookCanvasVisibleSource,notebookCanvasExactRanges};',context);
const {notebookCanvasVisibleSource:visible,notebookCanvasExactRanges:exact}=context.module.exports.searchTest;
function fixture(text,values,section=null){
 const root={parts:[],contains:part=>root.parts.includes(part)},document={
  createElement(){return{set innerHTML(value){this.value=value.replace(/&amp;/g,'&').replace(/&nbsp;/g,'\u00a0').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));}};},
  createTreeWalker(element){let at=0;return{nextNode:()=>element.parts[at++]||null};},
  createRange(){return{setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;},toString(){const first=root.parts.indexOf(this.startContainer),last=root.parts.indexOf(this.endContainer);return root.parts.slice(first,last+1).map((part,i,all)=>part.data.slice(i?0:this.startOffset,i===all.length-1?this.endOffset:part.data.length)).join('');}};}
 };
 // Native Canvas text cards have their OWN .markdown-embed ancestor. It is
 // outside the rendered section and must not exclude every visible word.
 const canvasEmbed={className:'markdown-embed'};
 root.parts=values.map(data=>({data,parentElement:{closest:()=>canvasEmbed}}));
 const node={text,nodeEl:{ownerDocument:document,querySelector:()=>root}};
 if(section)node.child={previewMode:{renderer:{sections:[{...section,el:root}]}}};
 return{node,document,find(from,to,content=text){return exact(node,{content,matches:[[from,to]]});}};
}
const table='## Dinner\n\n| Person | Speise |\n| --- | --- |\n| Lena | Wildpastete |\n| Tom | Wildpastete |\n| Lena | Wildpastete |\n\nA footer.';
const start=table.indexOf('|'),end=table.lastIndexOf('|')+1;
const sample=fixture(table,['Person','Speise','Lena','Wildpastete','Tom','Wildpastete','Lena','Wildpastete'],{start:{line:2,col:0},end:{offset:end}});
for(const [index,from] of [...table.matchAll(/Wildpastete/g)].map((match,index)=>[index,match.index])){
 const ranges=sample.find(from,from+11);assert.equal(ranges.length,1);assert.equal(ranges[0].toString(),'Wildpastete');assert.equal(ranges[0].startContainer,sample.node.nodeEl.querySelector().parts[index*2+3],'the exact selected occurrence is retained across identical table cells');
}
const rich='Lena bietet **Wild**<span style="color:#ff0000">pastete</span> an. Lena &amp; Tom sehen [[Personen/Lena.canvas|Lena]].';
const formatted=fixture(rich,['Lena bietet ','Wild','pastete',' an. Lena & Tom sehen ','Lena','.']);
let ranges=formatted.find(rich.indexOf('Wild'),rich.indexOf('</span>'));assert.equal(ranges[0].toString(),'Wildpastete','a DOM Range crosses formatting without highlighting neighbouring words');
const entity=rich.indexOf('&amp;');ranges=formatted.find(entity,entity+5);assert.equal(ranges[0].toString(),'&');
const alias=rich.lastIndexOf('Lena]]');assert.equal(formatted.find(alias,alias+4)[0].toString(),'Lena');assert.equal(formatted.find(rich.indexOf('Personen'),rich.indexOf('Personen')+8).length,0,'hidden link destinations are not mistaken for visible text');
assert.equal(formatted.find(0,4,rich+' changed').length,0,'stale source offsets cannot mark another word');
assert.equal(formatted.find(-1,4).length,0);assert.equal(formatted.find(0,rich.length+1).length,0);
const literal='Lena | Tom, ein Fabel_Wesen und `A | B`.';const literals=fixture(literal,['Lena | Tom, ein Fabel_Wesen und ','A | B','.']);assert.equal(literals.find(literal.indexOf('Tom'),literal.indexOf('Tom')+3)[0].toString(),'Tom');assert.equal(literals.find(literal.indexOf('A | B'),literal.indexOf('A | B')+5)[0].toString(),'A | B');
const unicode='Ein &#x1F409; bewacht Wildpastete.';const decoded=fixture(unicode,['Ein 🐉 bewacht Wildpastete.']);assert.equal(decoded.find(unicode.indexOf('Wildpastete'),unicode.length-1)[0].toString(),'Wildpastete');assert.equal(decoded.find(unicode.indexOf('&#'),unicode.indexOf(';')+1)[0].toString(),'🐉');
const projection=visible('[[Personen/Lena.canvas\\|Lenas]] **Wildpastete** &amp; Tee',formatted.document);assert.equal(projection.text,'Lenas Wildpastete & Tee');
const Notebook=context.module.exports,plugin=new Notebook(),view={file:{path:'A.canvas'}},deleted=[],win={CSS:{highlights:new Map()},Highlight:class{constructor(...ranges){this.ranges=ranges;}}};
const record={file:view.file,node:{text:rich,nodeEl:{classList:{remove:()=>deleted.push(true)},ownerDocument:{defaultView:win}}},text:rich,ranges:[{range:true}]};plugin.canvasSearchHighlights=new Map([[view,record]]);plugin.publishCanvasNotebookSearch(win);assert(win.CSS.highlights.has('cn-canvas-search'));plugin.clearCanvasNotebookSearch(view);assert(!win.CSS.highlights.has('cn-canvas-search'));assert.equal(deleted.length,1);
console.log('PASS: exact table-word ranges, repeated cells and source sections, bold/colour boundaries, aliases and hidden destinations, entities/UTF-16, literal pipes/code, stale offsets, and highlight cleanup without editing note contents.');

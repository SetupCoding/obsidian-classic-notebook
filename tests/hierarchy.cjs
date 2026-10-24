const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class TFile{constructor(name,order,level){this.path='Pages/'+name+'.md';this.basename=name;this.extension='md';this.meta={onenote_order:order,onenote_level:level};}}
class TFolder{}
const obsidian={Plugin:class{},ItemView:class{},FileView:class{},Modal:class{},TFile,TFolder,Notice:class{}};
const ctx={module:{exports:{}},require:()=>obsidian};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),ctx);
const Notebook=ctx.module.exports;
function fixture(rows){
  const files=rows.map(([name,level],index)=>new TFile(name,index,level));const plugin=new Notebook();
  plugin.data={groups:[],hiddenFolders:[],section:'Pages',pageLayouts:{},collapsedPages:{},pageSort:'original'};
  plugin.app={vault:{getFiles:()=>files,getAbstractFileByPath:p=>files.find(f=>f.path===p)},metadataCache:{getFileCache:f=>({frontmatter:f.meta})},workspace:{getActiveFile:()=>null}};
  plugin.persist=()=>{};plugin.refreshPages=()=>{};return {plugin,files};
}
const p=name=>'Pages/'+name+'.md';
const shape=plugin=>JSON.parse(JSON.stringify(plugin.pageOutline().map(item=>[item.file.basename,item.level,item.parent])));
// The reported case: a character with its letter moves under a party that is
// already nested under a heading. All descendants move together to levels 3/4.
const f=fixture([['Heading',1],['Party',2],['Existing Character',3],['Character',2],['Letter',3],['Other',1]]);
assert(f.plugin.movePageBranch(p('Character'),p('Party'),'inside'));
let outline=f.plugin.pageOutline();assert.equal(outline.find(row=>row.path===p('Character')).level,3);assert.equal(outline.find(row=>row.path===p('Letter')).level,4);assert.equal(outline.find(row=>row.path===p('Letter')).parent,p('Character'));
const saved=JSON.parse(JSON.stringify(f.plugin.data.pageLayouts));f.plugin.data.pageLayouts=saved;assert.equal(f.plugin.pageOutline().find(row=>row.path===p('Letter')).level,4,'new depth survives a layout reload');
assert(!f.plugin.planPageMove(p('Party'),p('Letter'),'inside').entries,'cycles stay invalid');
assert(f.plugin.changePageIndent(f.files.find(file=>file.basename==='Character'),-1));assert.equal(f.plugin.pageOutline().find(row=>row.path===p('Letter')).level,3,'outdent keeps the whole branch');
const deep=fixture([['A',1],['B',2],['C',3],['D',4],['E',5],['Branch',1],['Child',2],['End',1]]);
assert.deepEqual(shape(deep.plugin).slice(0,5).map(row=>row[1]),[1,2,3,4,5],'imported depth includes all five levels');
assert(deep.plugin.movePageBranch(p('Branch'),p('C'),'inside'));
outline=deep.plugin.pageOutline();assert.equal(outline.find(row=>row.path===p('Branch')).level,4);assert.equal(outline.find(row=>row.path===p('Child')).level,5);
const before=shape(deep.plugin),overflow=deep.plugin.planPageMove(p('Branch'),p('D'),'inside');assert(overflow.error.includes('fünf'),'the sixth level is rejected for the entire branch');assert.deepEqual(shape(deep.plugin),before,'a rejected move changes no parent or sibling');
deep.plugin.data.collapsedPages={[p('A')]:true,[p('B')]:true,[p('C')]:true,[p('Branch')]:true};deep.plugin.revealPage(p('Child'));assert.deepEqual(Object.keys(deep.plugin.data.collapsedPages),[],'opening a fifth-level child expands every ancestor');
const entries=deep.plugin.pageOutline().map(row=>({...row}));const child=entries.find(row=>row.path===p('Child'));child.parent=p('E');child.level=6;assert(!deep.plugin.commitPagePlan('Pages',{entries}),'commit also rejects a forged sixth-level move');
console.log('PASS: moving characters with descendants to levels four/five, import and persistence, subtree outdent, cycle protection, ancestor reveal, and sixth-level validation without data changes.');

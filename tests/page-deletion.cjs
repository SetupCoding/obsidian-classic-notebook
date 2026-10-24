const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class TFile{constructor(name,level=1,order=0,extension='md'){this.path='Pages/'+name+'.'+extension;this.basename=name;this.extension=extension;this.meta={onenote_level:level,onenote_order:order};this.content='Original '+name;}}
class TFolder{}
let modal,menu,notices=[];
class Modal{constructor(app){this.app=app;}open(){modal=this;}close(){this.closed=true;}}
class Menu{constructor(){this.items=[];menu=this;}addSeparator(){}addItem(callback){const item={setTitle(value){this.title=value;return this;},setIcon(){return this;},setDisabled(){return this;},onClick(value){this.run=value;return this;}};callback(item);this.items.push(item);}showAtMouseEvent(){}}
const obsidian={Plugin:class{},ItemView:class{},FileView:class{},Modal,Menu,TFile,TFolder,Notice:class{constructor(message){notices.push(message);}}};
const context={module:{exports:{}},require:()=>obsidian};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),context);
const Notebook=context.module.exports;
function fixture(){
 const files=[new TFile('Heading',1,0),new TFile('Parent',2,1,'canvas'),new TFile('Child',3,2),new TFile('Grandchild',4,3),new TFile('Sibling',2,4),new TFile('Other',1,5)],byPath=new Map(files.map(file=>[file.path,file])),trash=[];
 const plugin=new Notebook();plugin.data={groups:[],order:[],hiddenFolders:[],section:'Pages',group:'',pageLayouts:{},collapsedPages:{[files[1].path]:true},pageMeta:{[files[1].path]:{...files[1].meta,created:'Original creation date'}},lastPages:{Pages:files[1].path},groupSections:{},pageSort:'original',spatialLayouts:{},spatialDrafts:{}};
 let fail=false,duringTrash=()=>{},refreshes=0;
 const leaf={view:{file:files[1],getViewType:()=> 'canvas'},openFile:async file=>{leaf.view.file=file;},setViewState:async state=>{leaf.state=state;leaf.view.file=null;}};
 const app=plugin.app={vault:{getRoot:()=>({children:[]}),getFiles:()=>[...byPath.values()],getAbstractFileByPath:value=>byPath.get(value),trash:async(file,permanent)=>{assert.equal(permanent,false,'always use recoverable vault trash');if(fail)throw Error('write failed');trash.push({path:file.path,content:file.content});byPath.delete(file.path);plugin.trackDelete(file);duringTrash();}},metadataCache:{getFileCache:file=>({frontmatter:file.meta})},workspace:{activeLeaf:leaf,getMostRecentLeaf:()=>app.workspace.activeLeaf,getActiveFile:()=>files[2]}};
 plugin.persist=()=>{};plugin.refresh=()=>{refreshes++;};plugin.refreshPages=()=>{};
 return{plugin,files,byPath,trash,leaf,setFail:value=>{fail=value;},duringTrash:fn=>{duringTrash=fn;},refreshes:()=>refreshes};
}
(async()=>{
 const f=fixture(),target=f.files[1],originals=new Map(f.files.map(file=>[file.path,file.content]));
 assert.equal(f.plugin.notebookActivePage(),target,'a selected Canvas file card must not replace the actual page deletion target');
 f.plugin.pageMenu({},target);const action=menu.items.find(item=>item.title==='Seite löschen …');assert(action,'the right page menu exposes deletion');action.run();assert.equal(modal.file,target);assert.equal(f.trash.length,0,'opening the confirmation never deletes a page');modal.close();assert.equal(f.trash.length,0,'cancelling changes no files');
 f.plugin.requestDeletePage(target);modal.confirmButton={disabled:false};await modal.confirm();assert(modal.closed);assert.equal(f.trash.length,1);assert.equal(f.trash[0].path,target.path);assert.equal(f.trash[0].content,originals.get(target.path),'the trash retains the original file contents');
 const outline=f.plugin.pageOutline();assert.equal(outline.find(row=>row.file===f.files[2]).parent,f.files[0].path,'the direct child inherits the deleted page parent');assert.equal(outline.find(row=>row.file===f.files[3]).parent,f.files[2].path,'grandchildren remain attached to their parent');assert.equal(f.leaf.view.file,f.files[2],'the active deleted page advances to the next surviving page');
 assert(!f.plugin.data.pageMeta[target.path]);assert(!f.plugin.data.collapsedPages[target.path]);assert(!f.plugin.data.lastPages.Pages);assert(f.refreshes()>0);
 for(const file of f.byPath.values())assert.equal(file.content,originals.get(file.path),'no surviving note is rewritten');
 const saved=JSON.stringify(f.plugin.data.pageLayouts);f.plugin.trackDelete(target);assert.equal(JSON.stringify(f.plugin.data.pageLayouts),saved,'duplicate native delete notifications preserve the promoted hierarchy');
 const stale=fixture(),staleTarget=stale.files[1];stale.byPath.set(staleTarget.path,new TFile('Parent',2,1,'canvas'));await assert.rejects(()=>stale.plugin.trashPage(staleTarget.path,staleTarget),/verschoben oder gelöscht/);assert.equal(stale.trash.length,0,'a stale confirmation cannot delete a replacement file');
 const renamed=fixture(),renamedTarget=renamed.files[1],oldPath=renamedTarget.path;renamed.byPath.delete(oldPath);renamedTarget.path='Pages/Renamed.canvas';renamed.byPath.set(renamedTarget.path,renamedTarget);await assert.rejects(()=>renamed.plugin.trashPage(oldPath,renamedTarget),/verschoben oder gelöscht/);assert.equal(renamed.trash.length,0);
 const failed=fixture(),dataBefore=JSON.stringify(failed.plugin.data);failed.setFail(true);await assert.rejects(()=>failed.plugin.trashPage(failed.files[1].path,failed.files[1]),/write failed/);assert.equal(JSON.stringify(failed.plugin.data),dataBefore,'a failed trash operation changes no notebook metadata');assert.equal(failed.byPath.size,6);assert.equal(failed.plugin.trashingPage,false);
 failed.setFail(false);await failed.plugin.trashPage(failed.files[1].path,failed.files[1]);assert.equal(failed.trash.length,1,'failure releases the busy guard for a retry');
 const background=fixture();background.duringTrash(()=>{background.leaf.view.file=background.files[5];});await background.plugin.trashPage(background.files[1].path,background.files[1]);assert.equal(background.leaf.view.file,background.files[5],'user navigation while deletion runs is never replaced');
 const markdown=fixture(),md=markdown.files[2];markdown.leaf.view.file=md;await markdown.plugin.trashPage(md.path,md);assert.equal(markdown.trash[0].path,md.path,'Markdown pages use the same recoverable operation');assert.equal(markdown.plugin.pageOutline().find(row=>row.file===markdown.files[3]).parent,markdown.files[1].path);
 const empty=fixture();for(const file of empty.files.slice(1))empty.byPath.delete(file.path);empty.leaf.view.file=empty.files[0];await empty.plugin.trashPage(empty.files[0].path,empty.files[0]);assert.equal(empty.leaf.state.type,'empty','deleting the last page leaves a usable empty tab');
 console.log('PASS: page menu and confirmation, Markdown/native Canvas identity, recoverable single-file trash, child promotion, surviving content, stale/renamed targets, write failures and retry, background navigation and last-page fallback.');
})().catch(error=>{console.error(error);process.exitCode=1;});

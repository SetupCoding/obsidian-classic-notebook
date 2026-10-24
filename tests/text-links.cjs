const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
class TFile{constructor(path){this.path=path;this.extension=path.split('.').at(-1);this.basename=path.split('/').at(-1).replace(/\.[^.]+$/,'');}}
const api={Plugin:class{},ItemView:class{},FileView:class{},Modal:class{},TFile,Notice:class{}},context={module:{exports:{}},require:()=>api,crypto:webcrypto};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8')+'\nmodule.exports.test={notebookLinkPlain,notebookLinkTextBlocks,notebookLinkSearch,notebookTextLinkEdit,notebookCanvasAnchorElement,NotebookTextLinkModal};',context);
const Notebook=context.module.exports,{notebookLinkPlain:plain,notebookLinkTextBlocks:blocks,notebookLinkSearch:search,notebookTextLinkEdit:edit,notebookCanvasAnchorElement:element}=Notebook.test,clone=value=>JSON.parse(JSON.stringify(value));
const link=label=>'[[People/Mira.canvas#^link-test|'+label+']]';
function changed(text,from=0,to=text.length){const change=edit(text,from,to,link);return text.slice(0,change.from)+change.insert+text.slice(change.to);}
assert.equal(changed('Hinweis der Reisenden'),link('Hinweis der Reisenden'));
assert.equal(changed('**Wichtig**'),'**'+link('Wichtig')+'**');
assert.equal(changed('Ein **fetter** Text'),link('Ein')+' **'+link('fetter')+'** '+link('Text'));
assert.equal(changed('Example_User'),link('Example_User'),'literal underscores do not become emphasis');
assert.equal(changed('- **Fett**'),'- **'+link('Fett')+'**','list prefix stays outside the link');
assert.equal(changed('[[Old.canvas|Mira]]',15,18),link('Mira'),'selecting a link label retargets the whole token');
const color='<span class="tn-import-format" data-tn-color="#FFC000" style="color:#FFC000;font-weight:700">Gold</span>';
assert.equal(changed(color),color.replace('Gold',link('Gold')),'portable colour/bold wrapper survives');
assert.equal(changed(color,color.indexOf('Gold'),color.indexOf('Gold')+4),color.replace('Gold',link('Gold')));
assert.throws(()=>changed(color,1,12),/Format|normalen/);
assert.throws(()=>changed('```js\nSecret\n',6,12),/normalen/,'unterminated fenced code is protected');
assert.throws(()=>changed('`code`',1,5),/normalen/);
assert.throws(()=>changed('---\ntitle: Secret\n---\n\nText',11,17),/normalen/);
assert.throws(()=>changed('![[Picture.png]]'),/eingebetteten/);
assert.throws(()=>changed('First\nSecond'),/Absatz/);
const text='---\ntitle: Hidden\n---\n\n## Hintergrund\n\n- Erste Sache.\n- Hat den Hinweis der Reisenden über die Wegzeichen aufmerksam geprüft.\n- Letzte Sache.\n\n```\nGeheimes Codebeispiel\n```\n\n^src-test';
const parts=blocks(text);assert.equal(parts.length,4);assert.equal(parts[2].label,'Hat den Hinweis der Reisenden über die Wegzeichen aufmerksam geprüft.');assert.equal(text.slice(parts[2].from,parts[2].to),'- '+parts[2].label);

context.document={};
const setup=new Notebook(),handlers=new Map(),commands=[];
setup.addCommand=command=>commands.push(command);setup.registerDomEvent=(dom,event,callback)=>handlers.set(event,callback);setup.registerEvent=()=>{};setup.app={workspace:{on:()=>{}}};setup.setupNotebookTextLinks();
assert(commands.some(command=>command.id==='link-notebook-text'&&command.name==='Textstelle verknüpfen'));
const preserved={text:'Selected text'};setup.notebookLinkSnapshot=()=>preserved;
handlers.get('keydown')({ctrlKey:true,key:'p'});assert.equal(setup.notebookLinkSelection,preserved,'selection is captured before Ctrl+P moves focus');
context.document.activeElement={closest:()=>({})};handlers.get('selectionchange')();assert.equal(setup.notebookLinkSelection,preserved,'palette selection events cannot replace the source snapshot');
setup.notebookSelection=preserved;handlers.get('pointerdown')({target:{closest:selector=>selector==='.view-content'?{}:null}});assert.equal(setup.notebookLinkSelection,null);assert.equal(setup.notebookSelection,null,'a new workspace click clears an old, no-longer-visible selection');
delete context.document;

function fixture(openTarget=false){
 const source=new TFile('Scenes/Source.canvas'),target=new TFile('People/Mira.canvas'),background=new TFile('GM/Background.canvas'),md=new TFile('Notes/Text.md'),hidden=new TFile('Private/Hidden.canvas');
 const sourceText='Hat den Hinweis der Reisenden aufmerksam geprüft.',sourceData={nodes:[{id:'source',type:'text',text:sourceText,x:20,y:30,width:500,height:400}],edges:[],notebook:{version:1,cards:{source:{label:'Source'}},frontmatter:{created:'2000-01-01'}}};
 const targetData={nodes:[{id:'main',type:'text',text,x:24,y:48,width:880,height:558},{id:'side',type:'text',text:'A newer unrelated draft',x:980,y:48,width:300,height:400}],edges:[],custom:{keep:true},notebook:{version:1,cards:{main:{label:'Aussehen und Hintergrund',appearance:'native'}},frontmatter:{title:'Mira - Fährfrau',created:'2000-01-01',aliases:['Ferrywoman']},anchors:{'^old':{nodeId:'main',offset:0,length:1}}}};
 const data=new Map([[source,clone(sourceData)],[target,clone(targetData)],[background,{nodes:[{id:'context',type:'text',text:'## Was Reisende bereits wissen\n\nMira bestätigte den Hinweis zu den Wegzeichen.',x:0,y:0,width:600,height:500}],edges:[],notebook:{version:1,frontmatter:{title:'Geschichte und Vorgeschichte'}}}],[md,'# Eine Überschrift\n\nEin Absatz\n\n# Eine Überschrift\n\nAnderer Absatz'],[hidden,clone(targetData)]]),files=new Map([...data.keys()].map(file=>[file.path,file])),leaves=[],callbacks=[];
 const plugin=new Notebook();plugin.data={hiddenPages:[],hiddenFolders:['Private']};plugin.canvasNotebookMetadata=new Map();plugin.register=callback=>callbacks.push(callback);plugin.frontmatter=file=>data.get(file)?.notebook?.frontmatter||{};
 const sourceCanvas={data:clone(sourceData),nodes:new Map(),getData(){return {...this.data,nodes:[{...this.data.nodes[0],text:node.text}]};},requestSave(){this.data=this.getData();data.set(source,clone(this.data));}},node={...sourceData.nodes[0],setText(value){this.text=value;}};sourceCanvas.nodes.set(node.id,node);
 const sourceView={file:source,canvas:sourceCanvas,async save(){data.set(source,clone(this.canvas.getData()));}};leaves.push({view:sourceView});
 const targetCanvas={data:clone(targetData),history:{data:[clone(targetData)]},readonly:false,getData(){return clone(this.data);},setData(next){this.data=next;}};
 const targetView={file:target,canvas:targetCanvas,async save(){data.set(target,clone(this.canvas.getData()));}};if(openTarget)leaves.push({view:targetView});
 const app=plugin.app={vault:{getFiles:()=>[...files.values()],getAbstractFileByPath:path=>files.get(path),read:async file=>typeof data.get(file)==='string'?data.get(file):JSON.stringify(data.get(file)),process:async(file,callback)=>{data.set(file,JSON.parse(callback(JSON.stringify(data.get(file)))));}},workspace:{getActiveFile:()=>source,getLeavesOfType:type=>type==='canvas'?leaves:[]},fileManager:{generateMarkdownLink(file,sourcePath,subpath,label){return '[['+file.path+subpath+'|'+label+']]';}}};
 const snapshot={sourceFile:source,sourcePath:source.path,text:node.text,from:8,to:34,canvasNode:{canvas:sourceCanvas,node}};
 return {plugin,source,target,background,md,hidden,data,files,leaves,node,snapshot,targetView,sourceData,targetData,sourceCanvas,callbacks};
}
(async()=>{
 const f=fixture(),entries=await f.plugin.notebookTextLinkEntries();
 assert(!entries.some(entry=>entry.file===f.hidden));assert.equal(entries.filter(entry=>entry.file===f.md&&entry.kind==='heading').length,1,'duplicate Markdown headings are not falsely offered as separate destinations');
 const hits=search(entries,'Mira Wegzeichen');assert.equal(hits[0].file,f.target);assert.equal(hits[0].kind,'text');assert(hits[0].label.startsWith('Hat den Hinweis'));
 assert(search(entries,'Ferrywoman').some(entry=>entry.file===f.target),'page aliases are searchable');
 assert.equal(search(entries,'was reisende bereits wissen')[0].kind,'heading');assert(search(entries,'fahrfrau').some(entry=>entry.file===f.target),'search ignores accents');
 assert(search(entries,'').every(entry=>entry.kind==='page'));
 const entry=hits[0],before=clone(f.data.get(f.target)),from=f.snapshot.from,to=f.snapshot.to;
 await f.plugin.linkNotebookTextSelection(f.snapshot,entry);
 const saved=f.data.get(f.target),key=Object.keys(saved.notebook.anchors).find(key=>key.startsWith('^link-'));assert(key);
 assert.deepEqual(saved.nodes,before.nodes);assert.deepEqual(saved.edges,before.edges);assert.deepEqual(saved.custom,before.custom);assert.deepEqual(saved.notebook.frontmatter,before.notebook.frontmatter);assert.deepEqual(saved.notebook.cards,before.notebook.cards);assert.deepEqual(saved.notebook.anchors['^old'],before.notebook.anchors['^old']);
 assert.equal(saved.notebook.anchors[key].offset,entry.from);assert.equal(saved.notebook.anchors[key].length,entry.to-entry.from);
 assert.equal(f.node.text,f.snapshot.text.slice(0,from)+'[[People/Mira.canvas#'+key+'|'+f.snapshot.text.slice(from,to)+']]'+f.snapshot.text.slice(to));
 assert(!/^\^link-/m.test(saved.nodes[0].text),'target text contains no new marker');
 await f.plugin.ensureNotebookTextLinkTarget(entry);assert.equal(Object.keys(f.data.get(f.target).notebook.anchors).length,2,'same range reuses the existing anchor');

 const stale=fixture(),staleEntries=await stale.plugin.notebookTextLinkEntries(),staleTarget=search(staleEntries,'Mira Wegzeichen')[0];stale.node.text+=' changed';
 await assert.rejects(()=>stale.plugin.linkNotebookTextSelection(stale.snapshot,staleTarget),/inzwischen/);assert.equal(Object.keys(stale.data.get(stale.target).notebook.anchors).length,1,'invalid source is caught before any destination write');
 const altered=fixture(),alteredEntry=search(await altered.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];altered.data.get(altered.target).nodes[0].text+=' Changed';
 await assert.rejects(()=>altered.plugin.linkNotebookTextSelection(altered.snapshot,alteredEntry),/Zieltextstelle/);assert.equal(altered.node.text,altered.snapshot.text);
 const removed=fixture(),removedEntry=search(await removed.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];removed.files.delete(removed.target.path);
 await assert.rejects(()=>removed.plugin.linkNotebookTextSelection(removed.snapshot,removedEntry),/verschoben|gelöscht/);
 const failure=fixture(),failureEntry=search(await failure.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];failure.plugin.app.vault.process=async()=>{throw Error('write failed');};
 await assert.rejects(()=>failure.plugin.linkNotebookTextSelection(failure.snapshot,failureEntry),/write failed/);assert.equal(failure.node.text,failure.snapshot.text);
 const cancelled=fixture(),cancelEntry=search(await cancelled.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];await cancelled.plugin.linkNotebookTextSelection(cancelled.snapshot,cancelEntry,()=>true);assert.equal(cancelled.node.text,cancelled.snapshot.text);
 const live=fixture(true),liveEntry=search(await live.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];await live.plugin.linkNotebookTextSelection(live.snapshot,liveEntry);
 const liveData=live.data.get(live.target);assert.equal(liveData.nodes[1].text,'A newer unrelated draft');assert(Object.keys(live.targetView.canvas.history.data[0].notebook.anchors).some(key=>key.startsWith('^link-')),'native undo history retains the anchor');
 live.targetView.canvas.readonly=true;await assert.rejects(()=>live.plugin.ensureNotebookTextLinkTarget(liveEntry),/schreibgeschützt/);
 const page=fixture(),pageEntry=(await page.plugin.notebookTextLinkEntries()).find(entry=>entry.file===page.target&&entry.kind==='page');await page.plugin.linkNotebookTextSelection(page.snapshot,pageEntry);assert(!page.node.text.includes('#^'));assert.equal(Object.keys(page.data.get(page.target).notebook.anchors).length,1,'whole-page links do not create unnecessary anchors');
 const markdown=fixture(),mdEntry=(await markdown.plugin.notebookTextLinkEntries()).find(entry=>entry.file===markdown.md&&entry.kind==='heading');const originalMarkdown=markdown.data.get(markdown.md);await markdown.plugin.linkNotebookTextSelection(markdown.snapshot,mdEntry);assert(markdown.node.text.includes('#Eine Überschrift'));assert.equal(markdown.data.get(markdown.md),originalMarkdown);
 const afterAwait=fixture(),afterEntry=search(await afterAwait.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0],oldProcess=afterAwait.plugin.app.vault.process;
 afterAwait.plugin.app.vault.process=async(...args)=>{await oldProcess(...args);afterAwait.node.text+=' User changed source while target saved';};
 await assert.rejects(()=>afterAwait.plugin.linkNotebookTextSelection(afterAwait.snapshot,afterEntry),/inzwischen/);assert(afterAwait.node.text.endsWith('User changed source while target saved'));
 const destroyed=fixture(),destroyedEntry=search(await destroyed.plugin.notebookTextLinkEntries(),'Mira Wegzeichen')[0];let detachedWrites=0;
 destroyed.snapshot.editor={getValue:()=>destroyed.snapshot.text,replaceRange:()=>detachedWrites++};destroyed.snapshot.editorDom={isConnected:false};
 await destroyed.plugin.linkNotebookTextSelection(destroyed.snapshot,destroyedEntry);assert.equal(detachedWrites,0,'a disposed Canvas editor cannot absorb the edit');assert(destroyed.node.text.includes('#^link-'),'edit falls back to the live native node after the modal destroyed its editor');
 const same=fixture(),sameEntries=await same.plugin.notebookTextLinkEntries(),sameEntry=sameEntries.find(entry=>entry.file===same.source&&entry.kind==='text');
 same.plugin.trackCanvasNotebookAnchors({canvas:same.sourceCanvas,file:same.source});await same.plugin.linkNotebookTextSelection(same.snapshot,sameEntry);const selfData=same.data.get(same.source),selfAnchor=Object.values(selfData.notebook.anchors)[0];assert.equal(selfAnchor.length,selfData.nodes[0].text.length,'same-card links retain their target through the source edit');
 console.log('PASS: unified page/card/heading/paragraph search, accents/aliases and ranking, exact hidden anchors, formatting and link retargeting, source preservation, live drafts/history, native saves, duplicate reuse, cancellation, stale/deleted/readonly targets and sources, save failures, and concurrent edits.');
})().catch(error=>{console.error(error);process.exitCode=1;});

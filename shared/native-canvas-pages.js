// Native Canvas documents retain their notebook metadata when Obsidian saves them.
// Cards remain ordinary editable text/file nodes owned entirely by Canvas.
function notebookNewCanvasPage({title,created,aliases=[],text='',emptyCard=true}) {
  const id=Math.random().toString(16).slice(2,10)+Date.now().toString(16).slice(-8);
  const nodes=text||emptyCard?[{id,type:'text',text,x:24,y:48,width:650,height:400}]:[];
  return {nodes,edges:[],notebook:{version:1,frontmatter:{title,created,aliases},cards:nodes.length?{[id]:{label:'Notizen',appearance:'native'}}:{}}};
}

// Legacy conversion helper retained for compatibility tests.
// eslint-disable-next-line no-unused-vars
function notebookCanvasPage({text, layout, frontmatter, rewrite = value => value, drafts = {}, idFor = () => crypto.randomUUID().replaceAll('-', '').slice(0,16)}) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const blocks = spatialBlocks(text), nodes = [], cards = {}, used = new Set();
  const add = (box, original) => {
    const id = box.id || idFor(), draft = drafts[id]; let value = original;
    if (draft && (draft.expected === original || draft.value === original)) value = draft.value;
    const node = {id, type:'text', x:Number(box.x)||0, y:Number(box.y)||0, width:Math.max(150,spatialBoxWidth(box)), height:Math.max(60,Number(box.height)||300), text:rewrite(value)};
    if (box.label && box.label !== 'Verlauf') node.color = '#c6a34c';
    nodes.push(node); cards[id] = {label:box.label || 'Notizen', ...(box.typography ? {typography:box.typography} : {}), ...(box.integrationKey ? {integrationKey:box.integrationKey} : {})};
    if (draft && draft.expected !== original && draft.value !== original) {
      const extra=idFor();nodes.push({id:extra,type:'text',x:node.x+node.width+60,y:node.y,width:node.width,height:node.height,text:rewrite(draft.value),color:'#cc8844'});cards[extra]={label:'Ungespeicherter Entwurf: '+(box.label||'Notizen')};
    }
  };
  if (blocks.size) {
    const ordered = [...(layout?.boxes || [])].sort((a,b)=>(a.z||0)-(b.z||0));
    for (const box of ordered) if(blocks.has(box.id)){add(box,blocks.get(box.id).text);used.add(box.id);}
    for(const block of blocks.values())if(!used.has(block.id)){add({id:block.id,x:Math.max(700,...nodes.map(node=>node.x+node.width+60)),y:48,width:560,height:300,label:'Weitere Notiz'},block.text);}
    let remainder=text;for(const block of [...blocks.values()].reverse())remainder=remainder.slice(0,block.from)+remainder.slice(block.to);
    remainder=remainder.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim();
    if(remainder)add({x:24,y:Math.max(48,...nodes.map(node=>node.y+node.height+60)),width:650,height:120,label:'Quellen und weitere Notizen'},remainder);
  } else add({x:24,y:48,width:650,height:400,label:'Notizen'},body.trim());
  return {nodes,edges:[],notebook:{version:1,frontmatter:{...frontmatter},cards}};
}

function notebookCanvasAliasMatches(plugin, query) {
  const key=autoLinkKey(query);if(!key)return [];
  const result=[];
  for(const file of plugin.app.vault.getFiles().filter(file=>file.extension==='canvas')){
    if(plugin.data.hiddenFolders.some(folder=>file.path.startsWith(folder+'/')))continue;
    const meta=plugin.frontmatter(file),aliases=Array.isArray(meta.aliases)?meta.aliases:typeof meta.aliases==='string'?[meta.aliases]:[];
    for(const alias of [...new Set([file.basename,meta.title,...aliases].filter(value=>typeof value==='string'&&value.trim()))])if(autoLinkKey(alias).includes(key))result.push({file,alias,exact:autoLinkKey(alias)===key});
  }
  return result.sort((a,b)=>Number(b.exact)-Number(a.exact)||a.alias.length-b.alias.length||a.file.path.localeCompare(b.file.path,'de')).slice(0,50);
}

function notebookCanvasAnchorState(metadata, subpath, nodes) {
  if (typeof subpath !== 'string' || !subpath.startsWith('#')) return null;
  let key;try{key=decodeURIComponent(subpath.slice(1));}catch{key=subpath.slice(1);}
  const anchor=metadata?.anchors?.[key],node=nodes?.get(typeof anchor==='string'?anchor:anchor?.nodeId);
  if(!node||typeof node.text!=='string')return null;
  const offset=Math.max(0,Math.min(node.text.length,Number(anchor.offset)||0)),length=Math.max(1,Number(anchor.length)||1);
  return {match:{nodeId:node.id,content:node.text,matches:[[offset,Math.min(node.text.length,offset+length)]]}};
}

class NotebookCanvasLinkSuggest extends (EditorSuggest || class {}) {
  constructor(plugin){super(plugin.app);this.plugin=plugin;}
  onTrigger(cursor,editor){
    const before=editor.getLine(cursor.line).slice(0,cursor.ch),match=before.match(/\[\[([^[\]#^|\n]*)$/);
    if(!match||!notebookCanvasAliasMatches(this.plugin,match[1]).length)return null;
    return {start:{line:cursor.line,ch:cursor.ch-match[1].length},end:cursor,query:match[1]};
  }
  getSuggestions(context){return notebookCanvasAliasMatches(this.plugin,context.query);}
  renderSuggestion(item,element){element.createDiv({text:item.alias});element.createDiv({cls:'suggestion-note',text:item.file.path});}
  selectSuggestion(item){
    const context=this.context;if(!context)return;
    const {editor,start,end}=context,line=editor.getLine(end.line),last={...end};if(line.slice(end.ch,end.ch+2)===']]')last.ch+=2;
    const value=item.file.path+(item.alias===item.file.basename?'':'|'+item.alias)+']]';editor.replaceRange(value,start,last);editor.setCursor({line:start.line,ch:start.ch+value.length});
  }
}

class NotebookPageOpenModal extends (FuzzySuggestModal || Modal) {
  constructor(plugin){super(plugin.app);this.plugin=plugin;this.setPlaceholder('Seitenname oder Alias eingeben …');}
  getItems(){return this.plugin.allSections().flatMap(section=>this.plugin.pages(section));}
  getItemText(file){const meta=this.plugin.frontmatter(file),aliases=Array.isArray(meta.aliases)?meta.aliases:typeof meta.aliases==='string'?[meta.aliases]:[];return [meta.title||file.basename,...aliases,file.path].join(' · ');}
  onChooseItem(file){void this.plugin.openPage(file);}
}

const nativeCanvasPageMethods={
  async setupCanvasNotebook(){
    this.canvasNotebookMetadata=new Map();this.canvasNotebookViews=new WeakMap();
    // A plugin reload must not replace the viewport of an already visible page.
    for(const leaf of this.app.workspace.getLeavesOfType('canvas')){
      const view=leaf.view;
      if(view.file&&view.canvas?.canvasRect?.height>0&&view.canvas.zoomToFitQueued===false)this.canvasNotebookViews.set(view,view.file.path);
    }
    const read=async file=>{try{const data=JSON.parse(await this.app.vault.read(file));if(data.notebook?.version===1)this.canvasNotebookMetadata.set(file.path,data.notebook);else this.canvasNotebookMetadata.delete(file.path);}catch{}};
    const files=this.app.vault.getFiles().filter(file=>file.extension==='canvas');
    for(let offset=0;offset<files.length;offset+=20)await Promise.all(files.slice(offset,offset+20).map(read));
    this.registerEditorSuggest(new NotebookCanvasLinkSuggest(this));
    this.addCommand({id:'open-notebook-page',name:'Seite öffnen',callback:()=>new NotebookPageOpenModal(this).open()});
    this.addCommand({id:'remove-canvas-source-markers',name:'Import-Marker aus Canvas-Texten entfernen',callback:()=>void this.removeCanvasNotebookSourceMarkers().catch(error=>{console.error('Classic Notebook: Import-Marker',error);new Notice(error.message || 'Die Import-Marker konnten nicht entfernt werden.');})});
    for(const event of ['create','modify'])this.registerEvent(this.app.vault.on(event,file=>{if(file.extension==='canvas')void read(file).then(()=>{this.scheduleNotebookHeaders();this.scheduleAutoLinks();});}));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{if(this.canvasNotebookMetadata.has(oldPath)){this.canvasNotebookMetadata.set(file.path,this.canvasNotebookMetadata.get(oldPath));this.canvasNotebookMetadata.delete(oldPath);}}));
    this.registerEvent(this.app.vault.on('delete',file=>this.canvasNotebookMetadata.delete(file.path)));
    this.register(()=>{for(const leaf of this.app.workspace.getLeavesOfType('canvas')){for(const element of leaf.view.contentEl.querySelectorAll('.tn-canvas-card-label'))element.remove();for(const element of leaf.view.contentEl.querySelectorAll('.tn-canvas-consistent-card'))element.classList.remove('tn-canvas-consistent-card');}});
  },
  renderCanvasNotebookCards(){
    const leaves=this.app.workspace.getLeavesOfType('canvas'),views=new Set(leaves.map(leaf=>leaf.view));
    for(const view of this.canvasSearchHighlights?.keys()||[])if(!views.has(view))this.clearCanvasNotebookSearch(view);
    for(const leaf of leaves){
      const view=leaf.view,canvas=view.canvas,metadata=this.canvasNotebookMetadata?.get(view.file?.path)||(this.data.pageMeta?.[view.file?.path]?{}:null);if(!metadata||!canvas?.nodes)continue;
      this.trackCanvasNotebookViewport(view);
      this.trackCanvasNotebookAnchors(view);
      this.refreshCanvasNotebookSearch(view);
      for(const node of canvas.nodes.values()){
        if(typeof node.text!=='string'||!node.nodeEl)continue;
        const card=metadata.cards?.[node.id];
        node.nodeEl.classList.toggle('tn-canvas-consistent-card',!card||card.appearance==='native');
        if(!card)continue;
        node.nodeEl.classList.toggle('tn-canvas-imported-card',card.appearance!=='native');
        let label=node.nodeEl.querySelector(':scope > .tn-canvas-card-label');
        if(!label){label=node.nodeEl.createDiv({cls:'canvas-node-label tn-canvas-card-label'});label.style.pointerEvents='none';}
        if(label.textContent!==card.label)label.textContent=card.label;
        const rendered=node.nodeEl.querySelector('.markdown-preview-sizer');
        if(rendered&&card.appearance!=='native'){spatialParagraphSpacing(rendered,node.text,card.typography);}
        const editor=node.nodeEl.querySelector('.cm-content');if(editor)spatialTextMetrics(editor,card.typography);
      }
      if(!this.notebookNavigationPending?.has(leaf)&&(this.canvasNotebookViews.get(view)!==view.file.path||view.__notebookSearch||view.__notebookInitialViewport)&&canvas.canvasRect?.height>0){
        const first=this.canvasNotebookViews.get(view)!==view.file.path;this.canvasNotebookViews.set(view,view.file.path);
        const pending=view.__notebookSearch,initial=view.__notebookInitialViewport;delete view.__notebookSearch;delete view.__notebookInitialViewport;
        if(pending)this.revealCanvasNotebookMatch(view,pending);
        else if(first&&initial!==false)this.positionCanvasNotebookStart(view);
      }
    }
  },
  trackCanvasNotebookViewport(view){
    const canvas=view.canvas;
    if(!canvas||this.canvasViewportHooks?.has(canvas))return;
    this.canvasViewportHooks||=new WeakMap();
    const plugin=this,cleanups=[],nodes=new WeakSet();let enabled=true,editing=0;
    const managed=()=>enabled&&view.file?.extension==='canvas'&&(plugin.canvasNotebookMetadata?.has(view.file.path)||!!plugin.data.pageMeta?.[view.file.path]);
    const wrap=(object,key,make)=>{
      const original=object[key],owned=Object.prototype.hasOwnProperty.call(object,key);if(typeof original!=='function')return;
      const wrapped=make(original);object[key]=wrapped;
      cleanups.push(()=>{if(object[key]===wrapped){if(owned)object[key]=original;else delete object[key];}});
    };
    const track=node=>{
      if(!node||nodes.has(node)||typeof node.startEditing!=='function')return;
      nodes.add(node);
      wrap(node,'startEditing',original=>function(...args){editing++;try{return original.apply(this,args);}finally{editing--;}});
    };
    // Canvas fits the whole (potentially very tall) card when editing starts.
    // Suppress only that automatic fit; explicit zoom controls and links still work.
    wrap(canvas,'zoomToBbox',original=>function(...args){if(editing&&managed())return;return original.apply(this,args);});
    wrap(canvas,'addNode',original=>function(node,...args){const result=original.call(this,node,...args);track(node);return result;});
    wrap(canvas,'onResize',original=>function(...args){
      if(managed()&&plugin.canvasNotebookViews.get(view)===view.file.path&&!view.__notebookInitialViewport)this.zoomToFitQueued=false;
      return original.apply(this,args);
    });
    for(const node of canvas.nodes.values())track(node);
    this.canvasViewportHooks.set(canvas,true);
    this.register(()=>{enabled=false;for(const cleanup of cleanups.reverse())cleanup();});
  },
  canvasNotebookAnchorState(view,state){
    return notebookCanvasAnchorState(this.canvasNotebookMetadata?.get(view.file?.path),state?.subpath,view.canvas?.nodes);
  },
  positionCanvasNotebookStart(view){
    const canvas=view.canvas,nodes=[...canvas.nodes.values()];if(!canvas.canvasRect?.height)return;
    const minX=nodes.length?Math.min(...nodes.map(node=>node.x)):0,minY=nodes.length?Math.min(...nodes.map(node=>node.y)):0;
    canvas.setState({x:minX+canvas.canvasRect.width/2-24,y:minY+canvas.canvasRect.height/2-40,zoom:0});
  },
  revealCanvasNotebookMatch(view,state){
    const canvas=view.canvas,match=state?.match,node=canvas.nodes.get(match?.nodeId);if(!node||typeof node.text!=='string')return;
    if(this.revealCanvasNotebookExactMatch(view,state))return;
    const index=match.matches?.[0]?.[0]||0,text=match.content||node.text;let paragraph='';
    for(const part of text.matchAll(/[^\n](?:[^\n]|\n(?!\n))*(?:\n{2,}|$)/g))if(index>=part.index&&index<part.index+part[0].length){paragraph=spatialParagraphKey(part[0]);break;}
    const element=notebookCanvasAnchorElement(node,index,text)||[...node.nodeEl.querySelectorAll('.markdown-preview-sizer > :is(p,h1,h2,h3,ul,ol),.markdown-preview-sizer > :is(.el-p,.el-h1,.el-h2,.el-h3,.el-ul,.el-ol) > :is(p,h1,h2,h3,ul,ol)')].find(element=>spatialParagraphKey(element.textContent)===paragraph);
    const relative=element?(element.getBoundingClientRect().top-node.nodeEl.getBoundingClientRect().top)/canvas.scale:10;
    canvas.setState({x:node.x+canvas.canvasRect.width/2-24,y:node.y+relative+canvas.canvasRect.height/2-80,zoom:0});
  }
};

function notebookLinkPlain(value) {
  return String(value || '').replace(/<!--[\s\S]*?-->|<[^>]+>/g, '')
    .replace(/!?\[\[([^\]\n]+)\]\]/g, (_, inner) => inner.split('|').at(-1))
    .replace(/\[([^\]\n]+)\]\([^\n]*?\)/g, '$1').replace(/\*\*|__|~~|[`*]/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, token => ({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[token.toLowerCase()])
    .replace(/^\s*(?:>\s*)*(?:(?:#{1,6}|[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/gm, '').replace(/\s+/g, ' ').trim();
}
function notebookLinkSearchKey(value) { return notebookLinkPlain(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('de'); }

function notebookLinkTextBlocks(text) {
  const entries = []; let offset = 0, fence = null, yaml = /^---\r?\n/.test(text), paragraph = null;
  const flush = () => { if (paragraph) { entries.push(paragraph); paragraph = null; } };
  for (const line of text.split(/(?<=\n)/)) {
    const body = line.replace(/\r?\n$/, ''), marker = body.match(/^ {0,3}(`{3,}|~{3,})/);
    if (yaml) { if (offset && /^---\s*$/.test(body)) yaml = false; }
    else if (marker) { flush(); if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; }
    else if (!fence) {
      const heading = body.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/), bullet = /^\s*(?:[-+*]|\d+[.)])\s+/.test(body);
      if (!body.trim() || /^\s*(?:\^[-\w]+|<!--.*-->|[-*_]{3,})\s*$/.test(body) || /^(?: {4}|\t)/.test(body)) flush();
      else if (heading || bullet) { flush(); entries.push({ kind: heading ? 'heading' : 'text', from: offset, to: offset + body.length, label: notebookLinkPlain(heading ? heading[1] : body) }); }
      else if (paragraph) { paragraph.to = offset + body.length; paragraph.label = notebookLinkPlain(text.slice(paragraph.from, paragraph.to)); }
      else paragraph = { kind: 'text', from: offset, to: offset + body.length, label: notebookLinkPlain(body) };
    }
    offset += line.length;
  }
  flush(); return entries.filter(entry => entry.label);
}

function notebookLinkSearch(entries, query) {
  const key = notebookLinkSearchKey(query), words = key.split(/\s+/).filter(Boolean);
  if (!words.length) return entries.filter(entry => entry.kind === 'page').slice(0, 60);
  return entries.map((entry, order) => {
    const label = notebookLinkSearchKey(entry.label), title = notebookLinkSearchKey(entry.title), content = notebookLinkSearchKey(entry.preview), context = notebookLinkSearchKey(entry.path + ' ' + entry.cardLabel + ' ' + (entry.aliases||[]).join(' '));
    if (!words.every(word => (label + ' ' + title + ' ' + content + ' ' + context).includes(word))) return null;
    const score = (label === key ? 1200 : label.includes(key) ? 700 : 0) + (title === key ? 950 : title.includes(key) ? 450 : 0)
      + words.filter(word => label.includes(word)).length * 50 + words.filter(word=>title.includes(word)).length*60 + (content.includes(key) ? 80 : 0) + (entry.kind === 'heading' ? 35 : entry.kind === 'text' ? 25 : 0);
    return { entry, score, order };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 80).map(item => item.entry);
}

function notebookLinkSnippet(value, query) {
  const text = notebookLinkPlain(value), words = notebookLinkSearchKey(query).split(/\s+/).filter(Boolean), folded = notebookLinkSearchKey(text);
  const positions = words.map(word => folded.indexOf(word)).filter(at => at >= 0), at = positions.length ? Math.min(...positions) : 0, start = Math.max(0, at - 55);
  return (start ? '… ' : '') + text.slice(start, start + 230) + (start + 230 < text.length ? ' …' : '');
}

function notebookCanvasAnchorElement(node,index,text) {
  if(!node.nodeEl)return null;
  const blocks=notebookLinkTextBlocks(text),block=blocks.find(block=>index>=block.from&&index<=block.to);
  if(!block)return null;
  const key=notebookLinkSearchKey(block.label),list=/^\s*(?:[-+*]|\d+[.)])\s/.test(text.slice(block.from,block.to));
  const selector=block.kind==='heading'?'h1,h2,h3,h4,h5,h6':list?'li':'p,td,th,blockquote';
  const candidates=[...node.nodeEl.querySelectorAll(selector)].filter(element=>element.closest('.markdown-preview-sizer'));
  const ownText=element=>element.tagName==='LI'?[...element.childNodes].filter(child=>!['UL','OL'].includes(child.nodeName)).map(child=>child.textContent).join(''):element.textContent;
  let exact=candidates.filter(element=>notebookLinkSearchKey(ownText(element))===key);
  if(!list)exact=exact.filter(element=>!exact.some(child=>child!==element&&element.contains(child)));
  const occurrence=blocks.filter(candidate=>candidate.from<block.from&&candidate.kind===block.kind&&notebookLinkSearchKey(candidate.label)===key).length;
  return exact[occurrence]||exact[0]||candidates.find(element=>notebookLinkSearchKey(ownText(element)).includes(key))||null;
}

function notebookTextLinkEdit(text, from, to, linkFor) {
  if (from >= to) throw new Error('Bitte zuerst den Text markieren, der zum Link werden soll.');
  // Retarget existing links as a whole instead of nesting a new link in their label.
  for (const match of text.matchAll(/!?\[\[[^\n]*?\]\]|!?\[(?:[^\]\\]|\\.)*\]\([^\n]*?\)/g)) {
    if (match.index < to && match.index + match[0].length > from) {
      if (match[0].startsWith('!')) throw new Error('Bitte Text statt einer eingebetteten Datei markieren.');
      from = Math.min(from, match.index); to = Math.max(to, match.index + match[0].length);
    }
  }
  while (from < to && /[\r\n]/.test(text[from])) from++;
  while (to > from && /[\r\n]/.test(text[to - 1])) to--;
  if (text.slice(from, to).includes('\n')) throw new Error('Bitte Text innerhalb eines Absatzes markieren.');
  if(!notebookLinkTextBlocks(text).some(block=>from>=block.from&&to<=block.to))throw new Error('Bitte normalen Text außerhalb von Code oder Eigenschaften markieren.');
  const formats = notebookImportedFormats(text), masked = text.split('');
  if(formats.some(format=>[[format.from,format.openEnd],[format.closeStart,format.to]].some(([a,b])=>from>a&&from<b||to>a&&to<b)))throw new Error('Bitte den sichtbaren Text ohne Teile eines Format-Tags markieren.');
  for (const format of formats) for (const [a,b] of [[format.from,format.openEnd],[format.closeStart,format.to]]) for(let i=a;i<b;i++)masked[i]=' ';
  const protectedText = masked.join('');
  for (const match of protectedText.matchAll(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)|^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$|`+[^\n]*?`+|<[^>\n]*>|\$[^$\n]+\$/gm)) {
    if (match.index < to && match.index + match[0].length > from) throw new Error('Bitte normalen Text außerhalb von Code, Eigenschaften oder HTML markieren.');
  }
  // Keep a selected list/heading prefix outside the link.
  if (from === 0 || text[from-1] === '\n') from += text.slice(from,to).match(/^(?:[ \t]*(?:> ?)*(?:(?:#{1,6}|[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)/)?.[0].length || 0;
  const value = text.slice(from, to);
  const render = source => {
    source = source.replace(/\[\[([^\]\n]+)\]\]/g, (_,inner)=>inner.split('|').at(-1)).replace(/\[([^\]\n]+)\]\([^\n]*?\)/g,'$1');
    const plain = part => {
      const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return match[1] + (match[2] ? linkFor(match[2]) : '') + match[3];
    };
    let result='',at=0;
    for(const token of source.matchAll(/<\/?span\b[^>]*>|(\*\*|__|~~)(?=\S)(.+?)\1|(?<![\w\\])([*_])(?=\S)(.+?)\3(?!\w)/g)) {
      result+=plain(source.slice(at,token.index));
      result+=token[0].startsWith('<')?token[0]:(token[1]||token[3])+render(token[2]||token[4])+(token[1]||token[3]);
      at=token.index+token[0].length;
    }
    return result+plain(source.slice(at));
  };
  if (!notebookLinkPlain(value)) throw new Error('Bitte lesbaren Text markieren.');
  return { from, to, insert: render(value) };
}

class NotebookTextLinkModal extends Modal {
  constructor(plugin, selection) { super(plugin.app); this.plugin = plugin; this.textSelectionSnapshot = selection; this.entries = []; this.results = []; this.active = 0; }
  onOpen() {
    this.isOpen = true; this.modalEl.addClass('tn-link-dialog'); const root = this.contentEl; root.addClass('tn-text-link-modal');
    root.createEl('h2', { text:'Textstelle verknüpfen' });
    const quote = root.createDiv('tn-link-source'); quote.createSpan({text:'MARKIERTER TEXT',cls:'tn-link-eyebrow'});
    quote.createDiv({text:notebookLinkPlain(this.textSelectionSnapshot.text.slice(this.textSelectionSnapshot.from,this.textSelectionSnapshot.to)).slice(0,240),cls:'tn-link-source-text'});
    this.input = root.createEl('input',{type:'search',cls:'tn-link-search',attr:{placeholder:'Seite, Kartenüberschrift oder Text suchen …','aria-label':'Linkziel suchen',autocomplete:'off',spellcheck:'false',role:'combobox','aria-autocomplete':'list','aria-expanded':'true'}});
    this.input.oninput = () => this.renderResults();
    this.input.onkeydown = event => {
      if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); this.active=Math.max(0,Math.min(this.results.length-1,this.active+(event.key==='ArrowDown'?1:-1)));this.selectActive(); }
      if (event.key==='Enter') { event.preventDefault();if(this.results[this.active])void this.apply(this.results[this.active]); }
    };
    this.list=root.createDiv({cls:'tn-link-results',attr:{role:'listbox','aria-label':'Passende Linkziele',id:'tn-link-results-'+Date.now()}});this.input.setAttribute('aria-controls',this.list.id);
    this.status=root.createDiv({cls:'tn-link-status',text:'Seiten werden durchsucht …',attr:{role:'status','aria-live':'polite'}});
    const footer=root.createDiv('tn-link-footer');footer.createSpan({text:'↑↓ auswählen · Enter verknüpfen',cls:'tn-link-hint'});
    this.reload=footer.createEl('button',{text:'Suche aktualisieren'});this.reload.onclick=()=>void this.load();
    footer.createEl('button',{text:'Abbrechen'}).onclick=()=>this.close();
    this.input.focus();void this.load();
  }
  async load() {
    const generation = this.generation = (this.generation||0)+1;this.reload.disabled=true;
    try { const entries=await this.plugin.notebookTextLinkEntries();if(!this.isOpen||this.generation!==generation)return;this.entries=entries;this.renderResults(); }
    catch(error){if(this.isOpen)this.status.textContent=error.message||'Die Seiten konnten nicht geladen werden.';}
    finally{if(this.isOpen)this.reload.disabled=false;}
  }
  renderResults() {
    this.results=notebookLinkSearch(this.entries,this.input.value);this.active=0;this.list.empty();this.buttons=[];
    const kinds={page:'Seite',card:'Karte',heading:'Überschrift',text:'Textstelle'};
    for(const [index,entry]of this.results.entries()) {
      const row=this.list.createEl('button',{type:'button',cls:'tn-link-result',attr:{role:'option','aria-selected':String(index===0),id:this.list.id+'-'+index}});
      const heading=row.createDiv('tn-link-result-heading');heading.createSpan({text:entry.label.slice(0,160),cls:'tn-link-result-title'});heading.createSpan({text:kinds[entry.kind],cls:'tn-link-kind'});
      row.createDiv({text:entry.path+(entry.cardLabel?' › '+entry.cardLabel:''),cls:'tn-link-result-path'});
      const snippet=notebookLinkSnippet(entry.preview,this.input.value);if(snippet&&snippet!==entry.label)row.createDiv({text:snippet,cls:'tn-link-result-preview'});
      row.onclick=()=>void this.apply(entry);row.onfocus=()=>{this.active=index;this.selectActive(false);};this.buttons.push(row);
    }
    if(!this.results.length)this.list.createDiv({text:'Kein passender Treffer. Versuche einen Seitennamen oder andere Wörter aus der Textstelle.',cls:'tn-link-empty'});
    this.status.textContent=this.results.length?this.results.length+' passende Ziele. Ein Klick setzt den Link.':'Keine Treffer.';this.selectActive(false);
  }
  selectActive(scroll=true) {
    this.buttons?.forEach((button,index)=>{button.setAttribute('aria-selected',String(index===this.active));button.classList.toggle('is-selected',index===this.active);});
    const active=this.buttons?.[this.active];if(active){this.input.setAttribute('aria-activedescendant',active.id);if(scroll)active.scrollIntoView({block:'nearest'});}else this.input.removeAttribute('aria-activedescendant');
  }
  async apply(entry) {
    if(this.applying)return;this.applying=true;this.input.disabled=true;this.status.textContent='Verknüpfung wird gespeichert …';
    try{await this.plugin.linkNotebookTextSelection(this.textSelectionSnapshot,entry,()=>!this.isOpen);if(this.isOpen)this.close();}
    catch(error){if(this.isOpen)this.status.textContent=error.message||'Die Verknüpfung konnte nicht gespeichert werden.';}
    finally{this.applying=false;if(this.isOpen)this.input.disabled=false;}
  }
  onClose(){this.isOpen=false;this.contentEl.empty();}
}

const notebookTextLinkMethods={
  setupNotebookTextLinks() {
    this.addCommand({id:'link-notebook-text',name:'Textstelle verknüpfen',callback:()=>this.openNotebookTextLinkDialog()});
    if(typeof document!=='undefined') {
      this.registerDomEvent(document,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key?.toLowerCase()==='p')this.notebookLinkSelection=this.notebookLinkSnapshot();},true);
      this.registerDomEvent(document,'selectionchange',()=>{if(document.activeElement?.closest?.('.modal-container'))return;const selected=this.renderedCanvasTextSelection();if(selected)this.notebookLinkSelection=this.notebookLinkSnapshot(selected);});
      this.registerDomEvent(document,'pointerdown',event=>{if(event.target?.closest?.('.view-content')&&!event.target.closest('.modal-container')){this.notebookLinkSelection=null;this.notebookSelection=null;}},true);
    }
    this.registerEvent(this.app.workspace.on('file-open',()=>{this.notebookLinkSelection=null;}));
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor)=>{
      if(!editor.getSelection())return;
      const editorDom=editor.cm?.dom||document.activeElement?.closest?.('.cm-editor');
      const snapshot={editor,editorDom,text:editor.getValue(),from:editor.posToOffset(editor.getCursor('from')),to:editor.posToOffset(editor.getCursor('to')),canvasNode:this.canvasNodeForEditor(editorDom||document.activeElement)};
      menu.addItem(item=>item.setTitle('Textstelle verknüpfen …').setIcon('link').onClick(()=>this.openNotebookTextLinkDialog(snapshot)));
    }));
  },
  notebookLinkSnapshot(selection=this.captureNotebookTextSelection()) {
    if(!this.validNotebookTextSelection(selection))return null;
    const sourceFile=selection.canvasNode?this.app.workspace.getLeavesOfType('canvas').find(leaf=>leaf.view.canvas===selection.canvasNode.canvas)?.view.file:this.app.workspace.getActiveFile();
    return sourceFile?{...selection,sourceFile,sourcePath:sourceFile.path}:null;
  },
  validNotebookLinkSource(selection) {
    if(!selection?.sourceFile||selection.sourceFile.path!==selection.sourcePath||this.app.vault.getAbstractFileByPath(selection.sourcePath)!==selection.sourceFile)return false;
    if(selection.canvasNode&&!this.notebookLinkEditorConnected(selection)) {
      const {canvas,node}=selection.canvasNode;
      return !canvas.readonly&&canvas.nodes.get(node.id)===node&&node.text===selection.text;
    }
    return !!this.validNotebookTextSelection(selection);
  },
  notebookLinkEditorConnected(selection) {
    if(selection.view)return !!selection.view.dom.isConnected;
    if(selection.editorDom)return !!selection.editorDom.isConnected;
    return !!selection.editor&&!selection.canvasNode&&this.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view.file===selection.sourceFile&&leaf.view.editor===selection.editor);
  },
  openNotebookTextLinkDialog(selection=this.notebookLinkSelection||this.notebookLinkSnapshot()) {
    if(!selection?.sourceFile)selection=this.notebookLinkSnapshot(selection);
    if(!this.validNotebookLinkSource(selection)){new Notice('Bitte zuerst den Text markieren, der zum Link werden soll.');return;}
    try{notebookTextLinkEdit(selection.text,selection.from,selection.to,label=>label);new NotebookTextLinkModal(this,selection).open();}
    catch(error){new Notice(error.message);}
  },
  async notebookTextLinkEntries() {
    const files=this.app.vault.getFiles().filter(file=>['canvas','md'].includes(file.extension)&&!file.path.split('/').some(part=>part.startsWith('.'))&&!(this.data.hiddenPages||[]).includes(file.path)&&!(this.data.hiddenFolders||[]).some(folder=>file.path===folder||file.path.startsWith(folder+'/')));
    files.sort((a,b)=>a.path.localeCompare(b.path,'de'));const entries=[];
    for(let offset=0;offset<files.length;offset+=16) {
      const batch=await Promise.all(files.slice(offset,offset+16).map(async file=>{
        const path=file.path,view=this.app.workspace.getLeavesOfType(file.extension==='canvas'?'canvas':'markdown').find(leaf=>leaf.view.file===file)?.view;
        let data,text;
        if(file.extension==='canvas'){data=view?.canvas?.getData()||JSON.parse(await this.app.vault.read(file));text=(data.nodes||[]).map(node=>node.text||'').join('\n\n');}
        else text=view?.editor?.getValue()??await this.app.vault.read(file);
        const meta=data?.notebook?.frontmatter||this.frontmatter(file),title=meta.title||file.basename,aliases=Array.isArray(meta.aliases)?meta.aliases:typeof meta.aliases==='string'?[meta.aliases]:[],base={file,path,title,aliases,cardLabel:'',nodeText:null};
        const rows=[{...base,kind:'page',label:title,preview:text}];
        const add=(source,nodeId,cardLabel)=>{
          const blocks=notebookLinkTextBlocks(source);
          if(nodeId)rows.push({...base,nodeId,nodeText:source,cardLabel,kind:'card',label:cardLabel,preview:source,from:0,to:source.length});
          const headings=new Set();
          for(const block of blocks){if(!nodeId&&(block.kind!=='heading'||headings.has(block.label)))continue;headings.add(block.label);rows.push({...base,...block,nodeId,nodeText:source,cardLabel,preview:source.slice(block.from,block.to),markdownHeading:nodeId?null:block.label});}
        };
        if(data)for(const [index,node]of(data.nodes||[]).entries()) {
          if(typeof node.text==='string'&&node.text.trim())add(node.text,node.id,data.notebook?.cards?.[node.id]?.label||notebookLinkTextBlocks(node.text).find(block=>block.kind==='heading')?.label||'Textkarte '+(index+1));
        }
        if(!data)add(text,null,'');return rows;
      }));entries.push(...batch.flat());
    }
    return entries;
  },
  async ensureNotebookTextLinkTarget(entry) {
    const vault=this.app.vault;
    if(entry.file.path!==entry.path||vault.getAbstractFileByPath(entry.path)!==entry.file)throw new Error('Das Linkziel wurde verschoben oder gelöscht. Bitte die Suche aktualisieren.');
    if(entry.kind==='page')return '';
    if(entry.file.extension==='md') {
      const live=this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file===entry.file)?.view;
      const text=live?.editor?.getValue()??await vault.read(entry.file);
      if(text!==entry.nodeText)throw new Error('Das Linkziel wurde geändert. Bitte die Suche aktualisieren.');
      return '#'+entry.markdownHeading;
    }
    const views=this.app.workspace.getLeavesOfType('canvas').filter(leaf=>leaf.view.file===entry.file&&leaf.view.canvas).map(leaf=>leaf.view);
    const snapshots=views.map(view=>view.canvas.getData());
    if(snapshots.length>1&&new Set(snapshots.map(data=>JSON.stringify([data.nodes,data.edges]))).size>1)throw new Error('Die Zielseite hat unterschiedliche Entwürfe in mehreren Tabs. Bitte zuerst zusammenführen.');
    if(views.some(view=>view.canvas.readonly))throw new Error('Die Zielseite ist schreibgeschützt.');
    let key;
    const attach=data=>{
      const node=data.nodes?.find(node=>node.id===entry.nodeId);
      if(!node||node.text!==entry.nodeText)throw new Error('Die Zieltextstelle wurde geändert oder gelöscht. Bitte die Suche aktualisieren.');
      if(!Number.isInteger(entry.from)||!Number.isInteger(entry.to)||entry.from<0||entry.to<=entry.from||entry.to>node.text.length)throw new Error('Die Zieltextstelle ist nicht mehr gültig. Bitte die Suche aktualisieren.');
      const metadata=data.notebook||{},anchors={...metadata.anchors};
      const existing=Object.entries(anchors).find(([,anchor])=>anchor?.nodeId===entry.nodeId&&anchor.offset===entry.from&&anchor.length===entry.to-entry.from);
      key=existing?.[0]||key||'^link-'+crypto.randomUUID().replaceAll('-','').slice(0,16);
      anchors[key]={...anchors[key],nodeId:entry.nodeId,offset:entry.from,length:entry.to-entry.from};
      return {...data,notebook:{...metadata,version:1,anchors}};
    };
    let metadata;
    if(views.length) {
      const originals=[];
      try {
        for(const view of views){
          this.trackCanvasNotebookAnchors(view);view.canvas.requestPushHistory?.run?.();
          const data=attach(view.canvas.getData());originals.push({view,metadata:view.canvas.data.notebook,history:(view.canvas.history?.data||[]).map(snapshot=>snapshot.notebook)});view.canvas.data.notebook=data.notebook;metadata=data.notebook;
          for(const snapshot of view.canvas.history?.data||[]){const node=snapshot.nodes?.find(node=>node.id===entry.nodeId);const anchor=notebookMapAnchor(data.notebook.anchors[key],typeof node?.text==='string'?notebookTextChanges(entry.nodeText,node.text):[],node?.text?.length||0);snapshot.notebook={...snapshot.notebook,version:1,anchors:{...snapshot.notebook?.anchors,[key]:anchor}};}
        }
        await views[0].save();
      }catch(error){for(const item of originals){item.view.canvas.data.notebook=item.metadata;for(const [i,snapshot]of(item.view.canvas.history?.data||[]).entries())snapshot.notebook=item.history[i];}throw error;}
    }else await vault.process(entry.file,text=>{const data=attach(JSON.parse(text));metadata=data.notebook;return JSON.stringify(data,null,2);});
    this.canvasNotebookMetadata.set(entry.path,metadata);return '#'+key;
  },
  async linkNotebookTextSelection(selection,entry,cancelled=()=>false) {
    if(!this.validNotebookLinkSource(selection))throw new Error('Die markierte Textstelle wurde inzwischen geändert. Bitte erneut markieren.');
    if(cancelled())return;
    notebookTextLinkEdit(selection.text,selection.from,selection.to,label=>label);
    const subpath=await this.ensureNotebookTextLinkTarget(entry);
    if(cancelled())return;
    if(!this.validNotebookLinkSource(selection))throw new Error('Die markierte Textstelle wurde inzwischen geändert. Bitte erneut markieren.');
    if(entry.file.path!==entry.path||this.app.vault.getAbstractFileByPath(entry.path)!==entry.file)throw new Error('Das Linkziel wurde inzwischen verschoben oder gelöscht. Bitte die Suche aktualisieren.');
    const change=notebookTextLinkEdit(selection.text,selection.from,selection.to,label=>this.app.fileManager.generateMarkdownLink(entry.file,selection.sourcePath,subpath,label.replace(/&/g,'&amp;').replace(/\[/g,'&#91;').replace(/\]/g,'&#93;').replace(/\|/g,'&#124;')));
    const {editor,view,text,canvasNode}=selection,liveEditor=this.notebookLinkEditorConnected(selection)&&(editor?editor.getValue()===text:view?.state.doc.toString()===text);
    if(liveEditor){if(editor){editor.replaceRange(change.insert,editor.offsetToPos(change.from),editor.offsetToPos(change.to));editor.focus();}else{view.dispatch({changes:change,selection:{anchor:change.from+change.insert.length},scrollIntoView:true});view.focus();}}
    else if(canvasNode&&canvasNode.canvas.nodes.get(canvasNode.node.id)===canvasNode.node&&canvasNode.node.text===text&&!canvasNode.canvas.readonly){canvasNode.node.setText(text.slice(0,change.from)+change.insert+text.slice(change.to));canvasNode.canvas.requestSave();}
    else throw new Error('Die markierte Textstelle wurde inzwischen geändert. Bitte erneut markieren.');
    this.notebookSelection=null;this.notebookLinkSelection=null;return change;
  }
};

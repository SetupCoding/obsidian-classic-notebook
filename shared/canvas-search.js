// Source offsets from Canvas search are UTF-16 offsets. Keep them while removing
// invisible Markdown so a hit can become a DOM Range without changing the note.
function notebookCanvasVisibleSource(text,document){
  const hidden=new Uint8Array(text.length),code=[],tables=[];
  const hide=(from,to)=>hidden.fill(1,from,to);
  for(const separator of text.matchAll(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm)){
    const from=text.lastIndexOf('\n',Math.max(0,separator.index-2))+1;let to=text.indexOf('\n',separator.index);
    if(to<0)to=text.length;
    while(to<text.length){const next=text.indexOf('\n',to+1),end=next<0?text.length:next;if(!text.slice(to+1,end).includes('|'))break;to=end;}
    tables.push([from,to]);
  }
  for(const token of text.matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm)){
    const first=token[0].indexOf('\n')+1,last=token[0].lastIndexOf(token[1]);
    hide(token.index,token.index+first);hide(token.index+last,token.index+token[0].length);code.push([token.index,token.index+token[0].length]);
  }
  const inCode=at=>code.some(([from,to])=>at>=from&&at<to);
  for(const token of text.matchAll(/(`+)([^\n]*?)\1/g))if(!inCode(token.index)){
    hide(token.index,token.index+token[1].length);hide(token.index+token[0].length-token[1].length,token.index+token[0].length);code.push([token.index,token.index+token[0].length]);
  }
  for(const token of text.matchAll(/<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][\w-]*(?:\s[^>]*|\/?)>/g))if(!inCode(token.index))hide(token.index,token.index+token[0].length);
  for(const token of text.matchAll(/!?\[\[([^\]\n]+)\]\]|!?\[([^\]\n]*)\]\([^\n]*?\)/g))if(!inCode(token.index)){
    if(token[0].startsWith('!')){hide(token.index,token.index+token[0].length);continue;}
    if(token[1]!=null){const pipe=token[0].indexOf('|');hide(token.index,token.index+(pipe<0?2:pipe+1));hide(token.index+token[0].length-2,token.index+token[0].length);}
    else{hide(token.index,token.index+1);hide(token.index+1+token[2].length,token.index+token[0].length);}
  }
  for(const token of text.matchAll(/(\*\*|__|~~)(?=\S)(.+?)\1|(?<![\w\\])([*_])(?=\S)(.+?)\3(?!\w)/g))if(!inCode(token.index)){
    const size=(token[1]||token[3]).length;hide(token.index,token.index+size);hide(token.index+token[0].length-size,token.index+token[0].length);
  }
  for(const token of text.matchAll(/^\s*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$|^[ \t]*(?:> ?)*(?:(?:#{1,6}|[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)|^\^[\w-]+[ \t]*$/gm))if(!inCode(token.index))hide(token.index,token.index+token[0].length);
  for(const token of text.matchAll(/\\([\\`*{}\[\]()#+.!_>|~-])|\|/g))if(!inCode(token.index)&&!hidden[token.index]&&(token[1]||tables.some(([from,to])=>token.index>=from&&token.index<to)))hide(token.index,token.index+1);
  const result={text:'',starts:[],ends:[]},characters=[],decoder=document.createElement('textarea');
  const append=(value,from,to)=>{for(let i=0;i<value.length;i++){
    const char=/\s/.test(value[i])?' ':value[i];
    if(char===' '&&characters.at(-1)===' '){result.ends[result.ends.length-1]=to;continue;}
    characters.push(char);result.starts.push(from);result.ends.push(to);
  }};
  for(let at=0;at<text.length;at++){
    if(hidden[at])continue;
    const entity=text[at]==='&'&&text.slice(at).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i);
    if(entity&&!inCode(at)){decoder.innerHTML=entity[0];append(decoder.value,at,at+entity[0].length);at+=entity[0].length-1;}
    else append(text[at],at,at+1);
  }
  result.text=characters.join('');return result;
}

function notebookCanvasExactRanges(node,match){
  const document=node.nodeEl?.ownerDocument,text=node.text;
  if(!document||typeof text!=='string'||match.content!=null&&match.content!==text)return [];
  const renderer=node.child?.previewMode?.renderer,sections=renderer?.sections||[],groups=new Map(),result=[];
  if(typeof renderer?.text==='string'&&renderer.text!==renderer.lastText)return [];
  const offset=position=>{
    if(Number.isFinite(position?.offset))return position.offset;
    if(!Number.isFinite(position?.line))return null;
    let from=0;for(let line=0;line<position.line;line++){const next=text.indexOf('\n',from);if(next<0)return text.length;from=next+1;}
    return from+(position.col||0);
  };
  for(const pair of match.matches||[]){
    const [from,to]=pair;if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from||to>text.length)continue;
    const section=sections.find(section=>{const start=offset(section.start),end=offset(section.end);return start!=null&&end!=null&&from>=start&&from<=end;});
    const root=section?.el||node.nodeEl.querySelector('.markdown-preview-sizer');if(!root||root.isConnected===false)continue;
    const base=section?offset(section.start):0,end=section?Math.min(text.length,offset(section.end)+1):text.length;
    if(!groups.has(root))groups.set(root,{root,base,source:text.slice(base,end),pairs:[]});
    groups.get(root).pairs.push([from-base,to-base]);
  }
  for(const group of groups.values()){
    const source=notebookCanvasVisibleSource(group.source,document),pieces=[],walker=document.createTreeWalker(group.root,4);
    for(let part=walker.nextNode();part;part=walker.nextNode()){
      const excluded=part.parentElement?.closest('button,svg,script,style,.collapse-indicator,.list-bullet,.markdown-embed,.metadata-container,.tn-canvas-search-overlay');
      if(excluded&&group.root.contains(excluded))continue;
      let value='';const starts=[],ends=[];
      for(let at=0;at<part.data.length;at++){
        const char=/\s/.test(part.data[at])?' ':part.data[at];
        if(char===' '&&value.endsWith(' ')){ends[ends.length-1]=at+1;continue;}
        value+=char;starts.push(at);ends.push(at+1);
      }
      const left=value.length-value.trimStart().length,right=value.trimEnd().length;
      if(left<right)pieces.push({node:part,text:value.slice(left,right),starts:starts.slice(left,right),ends:ends.slice(left,right)});
    }
    let cursor=0;
    for(const piece of pieces){piece.forward=source.text.indexOf(piece.text,cursor);if(piece.forward>=0)cursor=piece.forward+piece.text.length;}
    cursor=source.text.length;
    for(let index=pieces.length-1;index>=0;index--){const piece=pieces[index];piece.backward=source.text.lastIndexOf(piece.text,cursor-piece.text.length);if(piece.backward>=0)cursor=piece.backward;}
    for(const [from,to] of group.pairs){
      const covered=[];
      for(const piece of pieces){
        if(piece.forward<0||piece.forward!==piece.backward)continue;
        let first=-1,last=-1;
        for(let at=0;at<piece.text.length;at++){const index=piece.forward+at;if(source.ends[index]>from&&source.starts[index]<to){if(first<0)first=at;last=at;}}
        if(first>=0)covered.push({piece,first,last});
      }
      if(!covered.length)continue;
      const first=covered[0],last=covered.at(-1),range=document.createRange();
      range.setStart(first.piece.node,first.piece.starts[first.first]);range.setEnd(last.piece.node,last.piece.ends[last.last]);result.push(range);
    }
  }
  return result;
}

const notebookCanvasSearchMethods={
  clearCanvasNotebookSearch(view){
    const record=this.canvasSearchHighlights?.get(view);if(!record)return;
    record.node.nodeEl?.classList.remove('tn-canvas-exact-search');
    this.canvasSearchHighlights.delete(view);this.publishCanvasNotebookSearch(record.node.nodeEl?.ownerDocument?.defaultView);
  },
  publishCanvasNotebookSearch(win){
    if(!win?.CSS?.highlights||!win.Highlight)return;
    const ranges=[...(this.canvasSearchHighlights?.values()||[])].filter(record=>record.node.nodeEl?.ownerDocument.defaultView===win).flatMap(record=>record.ranges||[]);
    if(ranges.length)win.CSS.highlights.set('cn-canvas-search',new win.Highlight(...ranges));else win.CSS.highlights.delete('cn-canvas-search');
  },
  refreshCanvasNotebookSearch(view){
    const record=this.canvasSearchHighlights?.get(view);if(!record)return;
    if(view.file!==record.file||record.node.text!==record.text||record.node.isEditing){this.clearCanvasNotebookSearch(view);return;}
    if(record.positioned&&record.ranges.length&&record.ranges.every(range=>record.node.nodeEl.contains(range.startContainer)&&record.node.nodeEl.contains(range.endContainer)))return;
    const ranges=notebookCanvasExactRanges(record.node,record.match);record.ranges=ranges;
    this.publishCanvasNotebookSearch(record.node.nodeEl?.ownerDocument?.defaultView);
    if(ranges.length&&!record.waitingForScroll&&!record.positioned&&(!ranges[0].getClientRects||ranges[0].getClientRects().length)){record.positioned=true;record.position?.();}
  },
  revealCanvasNotebookExactMatch(view,state){
    const canvas=view.canvas,match=state?.match,node=canvas?.nodes.get(match?.nodeId);
    if(!node?.nodeEl?.ownerDocument)return false;
    this.clearCanvasNotebookSearch(view);this.canvasSearchHighlights||=new Map();
    if(!this.canvasSearchCleanup){this.canvasSearchCleanup=true;this.register(()=>{for(const target of [...this.canvasSearchHighlights.keys()])this.clearCanvasNotebookSearch(target);});}
    const record={file:view.file,node,text:node.text,match,ranges:[],waitingForScroll:true};this.canvasSearchHighlights.set(view,record);
    node.nodeEl.classList.add('tn-canvas-exact-search');canvas.selectOnly?.(node);
    const valid=()=>this.canvasSearchHighlights.get(view)===record&&view.file===record.file&&node.text===record.text;
    record.position=()=>{
      if(!valid())return;
      const range=record.ranges[0];if(!range)return;
      const scale=canvas.scale||1,scroller=node.child?.previewMode?.renderer?.previewEl||node.nodeEl.querySelector('.markdown-preview-view');
      if(scroller&&scroller.scrollHeight>scroller.clientHeight){const hit=range.getBoundingClientRect(),box=scroller.getBoundingClientRect();scroller.scrollTop+=(hit.top-box.top)/scale-60;}
      for(let parent=range.startContainer.parentElement;parent&&node.nodeEl.contains(parent);parent=parent.parentElement){
        if(parent.scrollWidth>parent.clientWidth+1&&/auto|scroll/.test(parent.ownerDocument.defaultView.getComputedStyle(parent).overflowX)){
          const hit=range.getBoundingClientRect(),box=parent.getBoundingClientRect();if(hit.left<box.left||hit.right>box.right)parent.scrollLeft+=(hit.left-box.left)/scale-30;
        }
      }
      const hit=range.getBoundingClientRect(),box=node.nodeEl.getBoundingClientRect(),relativeY=(hit.top-box.top)/scale,relativeX=(hit.left-box.left)/scale;
      const left=node.x+Math.max(0,relativeX-canvas.canvasRect.width+120);
      canvas.setState({x:left+canvas.canvasRect.width/2-24,y:node.y+relativeY+canvas.canvasRect.height/2-100,zoom:0});
    };
    const finish=()=>{if(valid()){record.waitingForScroll=false;this.refreshCanvasNotebookSearch(view);}};
    const renderer=node.child?.previewMode?.renderer,line=node.text.slice(0,match.matches?.[0]?.[0]||0).split('\n').length-1;
    if(typeof renderer?.applyScrollDelayed==='function')renderer.applyScrollDelayed(line,{center:true,highlight:false},finish);else finish();
    return true;
  }
};

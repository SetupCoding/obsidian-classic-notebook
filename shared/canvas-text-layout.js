// Preview renders a blank-line run as one block gap. Give Live Preview that
// same total gap instead of adding full-height empty lines to heading padding.
// Only line decorations are added: source text, selections and undo stay native.
function notebookCanvasLayoutLines(text){
  const lines=[];let from=0,fence=null;
  for(const value of text.split('\n')){
    const body=value.replace(/\r$/,''),marker=body.match(/^ {0,3}(`{3,}|~{3,})/);
    const protectedLine=!!fence||!!marker;
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
    lines.push({from,blank:!protectedLine&&!body.trim(),heading:!protectedLine&&/^ {0,3}#{1,6}\s+\S/.test(body)});from+=value.length+1;
  }
  const result=[];
  for(let at=0;at<lines.length;at++){
    if(!lines[at].blank)continue;
    let end=at+1;while(end<lines.length&&lines[end].blank)end++;
    const heading=lines[end]?.heading&&!lines[at-1]?.heading,gap=heading?'--heading-spacing':'--p-spacing',count=end-at;
    for(let index=at;index<end;index++)result.push({from:lines[index].from,class:'cn-canvas-empty-line',style:'--cn-empty-space:calc(var('+gap+') / '+count+')'});
    at=end-1;
  }
  return result;
}

function notebookCanvasLayoutExtension(){
  const {StateField}=require('@codemirror/state'),{Decoration,EditorView}=require('@codemirror/view');
  const build=state=>Decoration.set(notebookCanvasLayoutLines(state.doc.toString()).map(line=>Decoration.line({attributes:{class:line.class,style:line.style}}).range(line.from)),true);
  return StateField.define({create:build,update:(value,transaction)=>transaction.docChanged?build(transaction.state):value,provide:field=>EditorView.decorations.from(field)});
}

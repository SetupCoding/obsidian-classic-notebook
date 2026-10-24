function notebookCanvasViewport(value) {
  if (!value || !['x','y','zoom'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
  return { x:value.x, y:value.y, zoom:value.zoom };
}

function notebookHasNavigationTarget(location) {
  return !!location && (!!location.subpath || location.match != null || location.line != null || location.startLoc != null || location.cursor != null || location.scroll != null);
}

const notebookPagePositionMethods = {
  notebookPagePosition(path) {
    const saved=this.data.pagePositions?.[path],viewport=notebookCanvasViewport(saved?.viewport);
    return saved?.type==='canvas'&&viewport?{type:'canvas',viewport,cards:saved.cards&&typeof saved.cards==='object'&&!Array.isArray(saved.cards)?saved.cards:{}}:null;
  },
  rememberNotebookPagePosition(view) {
    const file=view?.file,canvas=view?.canvas;
    if(file?.extension!=='canvas'||!canvas||view.__notebookInitialViewport||view.__notebookSearch)return false;
    if(this.app.vault.getAbstractFileByPath&&this.app.vault.getAbstractFileByPath(file.path)!==file)return false;
    if(canvas.canvasRect&&!(canvas.canvasRect.height>0))return false;
    const viewport=notebookCanvasViewport(canvas.getState?.()||view.getState?.()?.viewState);
    if(!viewport)return false;
    const previous=this.notebookPagePosition(file.path),cards={};
    for(const node of canvas.nodes?.values?.()||[]) {
      const mode=node.isEditing?node.child?.editMode:node.child?.previewMode;
      const scroll=mode?.getScroll?.()??mode?.renderer?.getScroll?.();
      if(typeof scroll==='number'&&Number.isFinite(scroll)&&scroll>=0)cards[node.id]={line:scroll};
      else {
        const element=node.nodeEl?.querySelector('.markdown-preview-view');
        if(element&&element.scrollHeight>element.clientHeight)cards[node.id]={top:element.scrollTop,left:element.scrollLeft};
        else if(previous?.cards[node.id])cards[node.id]=previous.cards[node.id];
      }
    }
    const saved={type:'canvas',viewport,cards};
    if(JSON.stringify(previous)===JSON.stringify(saved))return false;
    this.data.pagePositions||={};this.data.pagePositions[file.path]=saved;this.persist();return true;
  },
  rememberNotebookPagePositions() {
    const views=new Map(),active=this.app.workspace.activeLeaf?.view||this.app.workspace.getMostRecentLeaf?.()?.view;
    for(const leaf of this.app.workspace.getLeavesOfType('canvas'))if(!this.notebookNavigationPending?.has(leaf)&&leaf.view.file&&(!views.has(leaf.view.file.path)||leaf.view===active))views.set(leaf.view.file.path,leaf.view);
    for(const view of views.values())this.rememberNotebookPagePosition(view);
  },
  restoreNotebookCanvasCardPositions(view,saved) {
    const token=view.__notebookPositionToken={},file=view.file;
    const valid=()=>view.file===file&&view.__notebookPositionToken===token&&!view.__notebookSearch;
    for(const [id,position]of Object.entries(saved?.cards||{})) {
      if(!position||typeof position!=='object')continue;
      const node=view.canvas?.nodes?.get(id);if(!node)continue;
      if(typeof position.line==='number'&&Number.isFinite(position.line)&&position.line>=0) {
        const renderer=node.child?.previewMode?.renderer;
        if(node.isEditing&&typeof node.child?.editMode?.applyScroll==='function')node.child.editMode.applyScroll(position.line);
        else if(typeof renderer?.applyScroll==='function'&&!renderer.applyScroll(position.line)&&typeof renderer.onRendered==='function')renderer.onRendered(()=>{if(valid())renderer.applyScroll(position.line);});
      }else if(typeof position.top==='number'&&Number.isFinite(position.top)&&position.top>=0) {
        const apply=()=>{if(!valid())return;const element=node.nodeEl?.querySelector('.markdown-preview-view');if(element){element.scrollTop=position.top;element.scrollLeft=Number.isFinite(position.left)?position.left:0;}};
        apply();if(typeof window!=='undefined')window.requestAnimationFrame(apply);
      }
    }
  }
};

const notebookSectionTabMethods={
  syncNotebookSidebarHeaders(){
    const workspace=this.app.workspace,active=new Set();
    for(const leaf of workspace.getLeavesOfType(VIEW)){
      const host=leaf.view.containerEl?.closest('.workspace-tabs');
      if(host&&workspace.rightSplit?.containerEl?.contains(host)&&leaf.isVisible())active.add(host);
    }
    for(const host of workspace.containerEl.querySelectorAll('.cn-notebook-page-sidebar'))if(!active.has(host))host.classList.remove('cn-notebook-page-sidebar');
    for(const host of active)host.classList.add('cn-notebook-page-sidebar');
  },
  moveNotebookSection(source,target,after=false,group=this.data.group||''){
    if(group!==(this.data.group||'')||source===target)return false;
    const sections=this.sections(group),from=sections.indexOf(source);
    if(from<0||!sections.includes(target))return false;
    const reordered=sections.filter(path=>path!==source),at=reordered.indexOf(target)+(after?1:0);reordered.splice(at,0,source);
    if(reordered.every((path,index)=>path===sections[index]))return false;
    const siblings=new Set(sections),order=this.data.order||[],first=order.findIndex(path=>siblings.has(path)),others=order.filter(path=>!siblings.has(path));
    others.splice(first<0?others.length:first,0,...reordered);this.data.order=others;
    this.persist();this.refresh();return true;
  },
  bindNotebookSectionDrag(){
    const tabs=this.tabs,document=tabs.ownerDocument,host=document.defaultView;
    let drag=null;
    const clearIndicators=()=>{for(const tab of tabs.querySelectorAll('.tn-tab'))tab.classList.remove('tn-section-dragging','tn-section-before','tn-section-after');};
    const finish=()=>{drag=null;clearIndicators();tabs.classList.remove('tn-sections-dragging');};
    this.registerDomEvent(tabs,'pointerdown',event=>{
      const tab=event.target.closest('.tn-tab');
      if(event.button!==0||!tab||!tabs.contains(tab))return;
      drag={source:tab.dataset.section,group:this.data.group||'',x:event.clientX,y:event.clientY,pointerId:event.pointerId,active:false};
    });
    this.registerDomEvent(host,'pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      if(drag.group!==(this.data.group||'')){finish();return;}
      if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
      drag.active=true;event.preventDefault();tabs.classList.add('tn-sections-dragging');clearIndicators();
      for(const tab of tabs.querySelectorAll('.tn-tab'))if(tab.dataset.section===drag.source)tab.classList.add('tn-section-dragging');
      const bounds=tabs.getBoundingClientRect();
      if(event.clientY<bounds.top-20||event.clientY>bounds.bottom+20){drag.target=undefined;return;}
      if(event.clientX<bounds.left+25)tabs.scrollLeft-=18;else if(event.clientX>bounds.right-25)tabs.scrollLeft+=18;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.tn-tab');
      if(!target||!tabs.contains(target)||target.dataset.section===drag.source){drag.target=undefined;return;}
      const box=target.getBoundingClientRect();drag.target=target.dataset.section;drag.after=event.clientX>box.left+box.width/2;
      target.classList.add(drag.after?'tn-section-after':'tn-section-before');
    },{capture:true});
    this.registerDomEvent(host,'pointerup',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      const planned=drag;finish();if(!planned.active)return;
      event.preventDefault();this.suppressSectionClickUntil=Date.now()+350;
      if(planned.target!==undefined)this.moveNotebookSection(planned.source,planned.target,planned.after,planned.group);
    },{capture:true});
    this.registerDomEvent(host,'pointercancel',finish,{capture:true});
    this.registerDomEvent(host,'blur',finish);
    this.registerDomEvent(host,'keydown',event=>{if(event.key==='Escape'&&drag){if(drag.active)this.suppressSectionClickUntil=Date.now()+350;finish();}},{capture:true});
    this.register(finish);
  },
  async closeNotebookSidebarCanvases(){
    const workspace=this.app.workspace,leaves=[];
    const isCanvas=leaf=>(leaf.getViewState?.().type||leaf.view?.getViewType?.())==='canvas';
    workspace.iterateLeaves(workspace.rightSplit,leaf=>{if(isCanvas(leaf))leaves.push(leaf);});
    // Save live edits before closing ANY tab; failed saves leave all tabs open.
    for(const leaf of leaves)await leaf.view.save?.();
    let closed=0;for(const leaf of leaves)if(isCanvas(leaf)){leaf.detach();closed++;}
    await this.showPages();return closed;
  }
};

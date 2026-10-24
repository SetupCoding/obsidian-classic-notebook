// Obsidian sends its native keyboard and mouse history commands to activeLeaf.
// The page-list input can focus that sidebar leaf while a notebook page remains
// visible. Delegate only the sidebar's history actions to the current main tab.
const notebookHistoryMethods={
  bindNotebookHistoryCommands(){
    if(this.notebookHistoryCommandsBound)return;
    const plugin=this,commands=this.app.commands,patched=[];
    for(const [id,direction]of [['app:go-back','back'],['app:go-forward','forward']]){
      const command=commands?.findCommand?.(id)||commands?.commands?.[id],original=command?.checkCallback;
      if(typeof original!=='function')continue;
      const delegate=function(checking,...args){
        const sidebar=plugin.app.workspace.activeLeaf;
        if(sidebar&&plugin.notebookHistoryBridges?.has(sidebar)){
          const target=plugin.notebookHistoryTarget(sidebar);if(!target)return false;
          if(!checking)target.history[direction]();
          return true;
        }
        return original.call(this,checking,...args);
      };
      command.checkCallback=delegate;patched.push({command,original,delegate});
    }
    if(!patched.length)return;
    this.notebookHistoryCommandsBound=true;
    this.register(()=>{for(const {command,original,delegate}of patched)if(command.checkCallback===delegate)command.checkCallback=original;this.notebookHistoryCommandsBound=false;});
  },
  notebookHistoryTarget(sidebar){
    const workspace=this.app.workspace,document=sidebar.containerEl?.ownerDocument;
    const allowed=leaf=>leaf&&leaf!==sidebar&&leaf.history&&leaf.view?.getViewType?.()!==VIEW&&leaf.view?.navigation!==false&&(!document||leaf.containerEl?.ownerDocument===document);
    const recent=workspace.getMostRecentLeaf?.();if(allowed(recent))return recent;
    let target=null;
    workspace.iterateRootLeaves?.(leaf=>{if(allowed(leaf)&&leaf.isVisible?.()!==false&&(!target||(leaf.activeTime||0)>(target.activeTime||0)))target=leaf;});
    return target;
  },
  bindNotebookPageHistory(view){
    const leaf=view.leaf,history=leaf?.history;if(!history)return;
    this.notebookHistoryBridges||=new WeakMap();if(this.notebookHistoryBridges.has(leaf))return;
    const plugin=this,methods=[];
    for(const name of ['back','forward','go']){
      const original=history[name];if(typeof original!=='function')continue;
      const owned=Object.prototype.hasOwnProperty.call(history,name);
      const delegate=function(...args){const target=plugin.notebookHistoryTarget(leaf);if(target&&typeof target.history[name]==='function')return target.history[name](...args);};
      history[name]=delegate;methods.push({name,original,owned,delegate});
    }
    // Keep navigation=false: Obsidian uses this flag to select the destination
    // of ordinary file opens. Making the sidebar navigable replaces its list.
    this.bindNotebookHistoryCommands();
    let enabled=true;
    const cleanup=()=>{
      if(!enabled)return;enabled=false;
      for(const {name,original,owned,delegate}of methods)if(history[name]===delegate){if(owned)history[name]=original;else delete history[name];}
      if(plugin.notebookHistoryBridges.get(leaf)===cleanup)plugin.notebookHistoryBridges.delete(leaf);
    };
    this.notebookHistoryBridges.set(leaf,cleanup);view.register(cleanup);this.register(cleanup);
  }
};

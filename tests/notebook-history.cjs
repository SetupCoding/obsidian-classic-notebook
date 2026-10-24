const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={module:{exports:{}},require:()=>({Plugin:class{},ItemView:class{},FileView:class{},Modal:class{}})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),context);
const Notebook=context.module.exports,plugin=new Notebook(),cleanups=[],viewCleanups=[],document={activeElement:{id:'page-filter'}};
const a={file:'A.canvas',viewport:{x:200,y:400,zoom:0}},b={file:'B.canvas',viewport:{x:400,y:3000,zoom:-.5}},c={file:'C.canvas',viewport:{x:500,y:7400,zoom:.25}};
function makeLeaf(current,back=[],forward=[]){
 const leaf={containerEl:{ownerDocument:document},view:{navigation:true,getViewType:()=> 'canvas',state:current},activeTime:1,isVisible:()=>true};
 leaf.history={backHistory:back.slice(),forwardHistory:forward.slice(),back(){return this.go(-1);},forward(){return this.go(1);},go(steps){let next=leaf.view.state;while(steps>0&&this.forwardHistory.length){this.backHistory.push(next);next=this.forwardHistory.pop();steps--;}while(steps<0&&this.backHistory.length){this.forwardHistory.push(next);next=this.backHistory.pop();steps++;}leaf.view.state=next;return Promise.resolve();}};
 return leaf;
}
const main=makeLeaf(c,[a,b]),other=makeLeaf(a),sidebar=makeLeaf({sidebar:true},[{oldSidebar:true}]);sidebar.view.getViewType=()=> 'classic-notebook-pages';sidebar.view.navigation=false;sidebar.view.leaf=sidebar;sidebar.view.register=callback=>viewCleanups.push(callback);
let recent=main;const roots=[main,other];plugin.app={workspace:{activeLeaf:sidebar,getMostRecentLeaf:()=>recent,iterateRootLeaves:callback=>roots.forEach(callback)}};plugin.register=callback=>cleanups.push(callback);
const rootMethods={back:main.history.back,forward:main.history.forward,go:main.history.go},ownMethods={back:sidebar.history.back,forward:sidebar.history.forward,go:sidebar.history.go};
const commands=Object.fromEntries(['back','forward'].map(direction=>['app:go-'+direction,{checkCallback(checking){const leaf=plugin.app.workspace.activeLeaf;if(!leaf?.view.navigation)return false;if(!checking)return leaf.history[direction]();return true;}}]));
plugin.app.commands={findCommand:id=>commands[id]};
const originalCommands=Object.fromEntries(Object.entries(commands).map(([id,command])=>[id,command.checkCallback]));
const nativeCommand=async direction=>{const command=commands['app:go-'+direction];if(!command.checkCallback(true))return false;await command.checkCallback(false);return true;};
const nativeMouse=button=>button===3?sidebar.history.back():sidebar.history.forward();
(async()=>{
 assert.equal(await nativeCommand('back'),false,'the original native command is blocked when the sidebar owns focus');
 plugin.bindNotebookPageHistory?.(sidebar.view);
 assert.equal(sidebar.view.navigation,false,'ordinary file opens must never consider the page sidebar a destination');
 const nativeGetUnpinnedLeaf=()=>plugin.app.workspace.activeLeaf.view.navigation?plugin.app.workspace.activeLeaf:recent;
 assert.equal(nativeGetUnpinnedLeaf(),main,'clicking a page after focusing its list still opens in the main tab');
 assert.equal(await nativeCommand('back'),true,'native commands must target the visible page while the page filter has focus');assert.equal(main.view.state,b);assert.equal(plugin.app.workspace.activeLeaf,sidebar);assert.equal(document.activeElement.id,'page-filter','history navigation does not steal text-input focus');
 await nativeMouse(4);assert.equal(main.view.state,c,'mouse forward uses the same root history');await nativeMouse(3);assert.equal(main.view.state,b,'mouse back uses the same root history');await nativeCommand('back');assert.equal(main.view.state,a);assert.deepEqual(main.view.state.viewport,a.viewport);
 await sidebar.history.go(2);assert.equal(main.view.state,c,'multiple native history steps remain available');
 assert.deepEqual(sidebar.history.backHistory,[{oldSidebar:true}],'the sidebar history is not used as page history');assert.equal(main.history.back,rootMethods.back);assert.equal(main.history.forward,rootMethods.forward);assert.equal(main.history.go,rootMethods.go,'main-tab history methods are never patched');
 recent=other;await nativeMouse(3);assert.equal(other.view.state,a);assert.equal(main.view.state,c,'switching tabs changes the delegated target without moving a background tab');
 other.containerEl.ownerDocument={};main.activeTime=10;assert.equal(plugin.notebookHistoryTarget(sidebar),main,'a foreign window cannot receive the history command');
 main.isVisible=()=>false;recent=null;assert.equal(plugin.notebookHistoryTarget(sidebar),null);await nativeMouse(3);assert.equal(main.view.state,c,'no visible page is a safe no-op');main.isVisible=()=>true;recent=main;
 const before=cleanups.length;plugin.bindNotebookPageHistory(sidebar.view);assert.equal(cleanups.length,before,'reopening the sidebar cannot stack delegates');
 viewCleanups.forEach(cleanup=>cleanup());assert.equal(sidebar.view.navigation,false);for(const name of Object.keys(ownMethods))assert.equal(sidebar.history[name],ownMethods[name]);cleanups.forEach(cleanup=>cleanup());
 for(const [id,original]of Object.entries(originalCommands))assert.equal(commands[id].checkCallback,original,'unloading restores the native command');
 assert.equal(await nativeCommand('back'),false,'unloading restores native sidebar behavior');
 console.log('PASS: native keyboard and mouse history commands with focused page filter, repeated back/forward and multistep navigation, per-tab target, viewport preservation, window/visibility isolation, unchanged root history, safe no-target handling and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});

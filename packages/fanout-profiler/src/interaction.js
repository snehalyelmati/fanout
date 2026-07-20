export function createInteractionState(search=""){
	return{query:new URLSearchParams(search),nodes:new Map(),attempts:new Set(),turns:new Set(),paneWidths:{dag:320,inspector:360},maximized:null}
}
const key=(run,id)=>`${run}|${id}`;
export function selectionQuery(state,selection,run){const next=new URLSearchParams(state.query);if(selection.kind==="lineage")next.delete("run");else if(run)next.set("run",run);next.set("kind",selection.kind);next.set("id",selection.id);for(const [name,value] of [["node",selection.nodeId],["attempt",selection.attemptId],["turn",selection.turnId]])value?next.set(name,value):next.delete(name);return next}
export function setQuery(state,query){state.query=query}
export function restoreQuery(state,search){state.query=new URLSearchParams(search);return state.query}
export function revealSelection(state,selection,run){if(!run)return;const node=selection.kind==="node"?selection.id:selection.nodeId;if(node)state.nodes.set(run,node);const attempt=selection.kind==="attempt"||selection.kind==="stage"?selection.id:selection.attemptId;if(attempt)state.attempts.add(key(run,`attempt:${attempt}`));const turn=selection.kind==="turn"?selection.id:selection.turnId;if(attempt&&turn)state.turns.add(key(run,`turn:${attempt}:${turn}`))}
export function rowExpanded(state,row,run){if(row.kind==="node"||row.kind==="final-validation")return state.nodes.get(run)===(row.nodeId??row.id);if(row.kind==="attempt")return state.attempts.has(key(run,row.id));if(row.kind==="turn")return state.turns.has(key(run,row.id));return false}
export function toggleRow(state,row,run){if(row.kind==="node"||row.kind==="final-validation"){const node=row.nodeId??row.id;state.nodes.get(run)===node?state.nodes.delete(run):state.nodes.set(run,node);return}const values=row.kind==="attempt"?state.attempts:state.turns,id=key(run,row.id);values.has(id)?values.delete(id):values.add(id)}
export function resizePane(state,pane,size){return state.paneWidths[pane]=Math.max(200,Math.min(600,Math.round(size)))}
export function toggleMaximized(state,pane){return state.maximized=state.maximized===pane?null:pane}
export function restoreWorkspace(state){state.maximized=null}
const paneLabel=(pane)=>pane==="dag"?"DAG":pane==="evidence"?"Execution Evidence":"Inspector";
export function installPaneControls(state,onEscape){
	const main=document.querySelector("main"),controls=[...document.querySelectorAll("[data-maximize]")];
	const sync=()=>{if(state.maximized)main.dataset.maximized=state.maximized;else delete main.dataset.maximized;for(const item of controls){const active=item.dataset.maximize===state.maximized;item.textContent=active?"Restore":"Maximize";item.setAttribute("aria-label",`${active?"Restore":"Maximize"} ${paneLabel(item.dataset.maximize)} pane`)}};
	for(const control of controls)control.addEventListener("click",()=>{toggleMaximized(state,control.dataset.maximize);sync()});
	for(const separator of document.querySelectorAll("[data-resize]")){const pane=separator.dataset.resize,resize=(clientX)=>{const bounds=main.getBoundingClientRect(),size=pane==="dag"?clientX-bounds.left:bounds.right-clientX,value=resizePane(state,pane,size);main.style.setProperty(pane==="dag"?"--dag-width":"--inspector-width",`${value}px`);separator.setAttribute("aria-valuenow",String(value))};separator.addEventListener("pointerdown",event=>{separator.setPointerCapture(event.pointerId);resize(event.clientX)});separator.addEventListener("pointermove",event=>{if(separator.hasPointerCapture(event.pointerId))resize(event.clientX)});separator.addEventListener("keydown",event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();const direction=event.key==="ArrowRight"?1:-1,delta=pane==="dag"?direction*20:-direction*20,bounds=main.getBoundingClientRect(),current=state.paneWidths[pane],clientX=pane==="dag"?bounds.left+current+delta:bounds.right-current-delta;resize(clientX)})}
	document.addEventListener("keydown",event=>{if(event.key!=="Escape")return;restoreWorkspace(state);sync();onEscape()});
}

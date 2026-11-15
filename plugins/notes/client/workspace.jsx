import React, { useEffect, useRef, useState } from 'react';

// Keep one iframe mounted for the plugin lifetime. Switching to a Harness
// conversation hides it without destroying drafts, split panes, or undo history.
export function createWorkspace(ctx) {
  const frame=document.createElement('iframe');frame.title='Corilo Files.md 工作区';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
  frame.style.cssText='position:fixed;border:0;display:none;z-index:2;background:transparent';
  let dirty=false, observer, target;
  const resize=()=>{if(!target)return;const rect=target.getBoundingClientRect();Object.assign(frame.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});};
  const message=event=>{
    if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
    if(event.data?.type==='corilo-workspace-state')dirty=Boolean(event.data.dirty);
    if(event.data?.type==='corilo-workspace-agent')ctx.layout.selectPanel(null);
  };
  const guard=event=>{if(dirty){event.preventDefault();event.returnValue='';}};
  ctx.effect(()=>{
    document.body.append(frame);window.addEventListener('message',message);window.addEventListener('beforeunload',guard);window.addEventListener('resize',resize);
    return()=>{observer?.disconnect();frame.remove();window.removeEventListener('message',message);window.removeEventListener('beforeunload',guard);window.removeEventListener('resize',resize);};
  });
  return {attach(element){target=element;if(!frame.src)frame.src='api/corilo-notes/workspace/index.html';frame.style.display='block';resize();observer=new ResizeObserver(resize);observer.observe(element);frame.contentWindow?.postMessage({type:'corilo-workspace-visible'},location.origin);return()=>{observer.disconnect();target=null;frame.style.display='none';};}};
}
export function WorkspaceEntry({classic:Classic,workspace,...props}) {
  const [mode,setMode]=useState(null),[error,setError]=useState('');
  const connect=()=>{setError('');props.call('identity',{}).then(result=>setMode(result.interface||'classic')).catch(error=>setError(error.message));};
  useEffect(()=>{let alive=true;props.call('identity',{}).then(result=>{if(alive)setMode(result.interface||'classic');}).catch(error=>{if(alive)setError(error.message);});return()=>{alive=false;};},[]);
  if(error)return <section role="alert">{error}<button onClick={connect}>重新连接</button></section>;
  if(mode==='classic')return <Classic {...props}/>;
  if(mode==='filesmd')return <WorkspacePage workspace={workspace}/>;
  return <p role="status">正在打开工作区…</p>;
}
function WorkspacePage({workspace}) {
  const root=useRef(null);
  useEffect(()=>workspace.attach(root.current),[workspace]);
  return <section ref={root} aria-label="Corilo 工作区" style={{width:'100%',height:'100%',minHeight:240,paddingTop:'var(--dsh-frame-top-clearance,0px)'}}/>;
}

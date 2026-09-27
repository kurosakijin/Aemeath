"use client";
import {useEffect,useState} from "react";
import {Flame,Minus,RefreshCw,Square,X} from "lucide-react";

type DesktopBridge={
  isDesktop:boolean;
  windowAction:(action:"minimize"|"maximize"|"close")=>void;
  checkForUpdates:()=>void;
  onWindowState:(listener:(state:{maximized:boolean})=>void)=>()=>void;
};

export default function DesktopTitlebar(){
  const [bridge,setBridge]=useState<DesktopBridge|null>(null),[maximized,setMaximized]=useState(false);
  useEffect(()=>{
    const value=(window as typeof window&{aemeathDesktop?:DesktopBridge}).aemeathDesktop||null;
    if(!value?.isDesktop)return;
    setBridge(value);document.documentElement.classList.add("desktop-app");
    const dispose=value.onWindowState(state=>setMaximized(state.maximized));
    return()=>{dispose();document.documentElement.classList.remove("desktop-app")};
  },[]);
  if(!bridge)return null;
  return <header className="desktop-titlebar">
    <div className="desktop-titlebar-brand"><span><Flame size={15}/></span><strong>Aemeath</strong><i>DESKTOP</i></div>
    <div className="desktop-titlebar-drag" aria-hidden><b>Private conversations, closer together</b></div>
    <nav aria-label="Window controls">
      <button aria-label="Check for updates" title="Check for updates" onClick={()=>bridge.checkForUpdates()}><RefreshCw/></button>
      <button aria-label="Minimize" onClick={()=>bridge.windowAction("minimize")}><Minus/></button>
      <button aria-label={maximized?"Restore window":"Maximize"} onClick={()=>bridge.windowAction("maximize")}><Square/></button>
      <button className="desktop-window-close" aria-label="Close" onClick={()=>bridge.windowAction("close")}><X/></button>
    </nav>
  </header>;
}

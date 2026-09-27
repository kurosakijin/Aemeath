"use client";
import {Bookmark,Copy,Flag,MessageSquareReply,MoreHorizontal,Trash2,Volume2} from "lucide-react";
import {useState} from "react";
export default function MessageMenu({id,body,own,onReply,onDelete,onReport}:{id:string;body:string;own:boolean;onReply:()=>void;onDelete:()=>void;onReport:()=>void}){
 const [open,setOpen]=useState(false),[reaction,setReaction]=useState("");
 const text=body.startsWith("aemeath:image:")?"Shared image":body;
 return <div className="message-actions"><button className="message-more" aria-label="Message actions" onClick={()=>setOpen(!open)}><MoreHorizontal size={18}/></button>{reaction&&<span className="message-reaction">{reaction}</span>}{open&&<div className="message-menu">
  <div className="reaction-row">{["✅","😆","💯","❤️"].map(item=><button key={item} onClick={()=>{setReaction(item);setOpen(false)}}>{item}</button>)}</div>
  <button onClick={()=>{onReply();setOpen(false)}}><MessageSquareReply/> Reply</button>
  <button onClick={()=>{void navigator.clipboard.writeText(text);setOpen(false)}}><Copy/> Copy text</button>
  <button onClick={()=>{localStorage.setItem("aemeath-bookmark-"+id,text);setOpen(false)}}><Bookmark/> Bookmark message</button>
  <button onClick={()=>{speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));setOpen(false)}}><Volume2/> Speak message</button>
  <button onClick={()=>{void navigator.clipboard.writeText(id);setOpen(false)}}><Copy/> Copy message ID</button>
  {own&&<button className="danger" onClick={()=>{onDelete();setOpen(false)}}><Trash2/> Delete message</button>}
  {!own&&<button className="danger" onClick={()=>{onReport();setOpen(false)}}><Flag/> Report message</button>}
 </div>}</div>
}

"use client";
import { onlineChat as api, type LocalUser } from "@/lib/online";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Hash,
  Plus,
  Flame,
  Lock,
  ArrowUp,
  Users,
  ChevronDown,
  MessageCircle,
  ArrowRight,
  UserPlus,
  Menu,
  Settings,
  Copy,
  Check,
  X,
  Gamepad2,
  Heart,
  GraduationCap,
  BookOpen,
  ChevronRight,
  Volume2,
  MessageSquare,
  Pencil,
  Trash2,
  PanelRightClose,
  Bell,
  Shield,
  Crown,
  UserRound,
  UserMinus,
  AtSign,
  ImagePlus,
  Eye,
  EyeOff,
} from "lucide-react";
import VoiceRoom, {type VoiceControls} from "./voice-room";
import ServerSettings from "./server-settings";
import MessageMenu, {type MessageReaction} from "./message-menu";
import ImagePreview from "./image-preview";
import {compressChatImage,imageFromClipboard,imageSource,isImageMessage,isSpoilerImage,setImageSpoiler} from "@/lib/image-message";
import {notifyAemeath} from "@/lib/notifications";
import {readNavigationMemory,writeNavigationMemory} from "@/lib/navigation-memory";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
type Server = { id: string; name: string; owner: string; membership_role?:"owner"|"admin"|"member"; access?:"invite"|"closed"; icon?:string; banner?:string; traits?:string };
type Channel = {
  id: string;
  name: string;
  kind?: "text" | "voice" | "forum";
  topic?: string;
};
type Member = { id: string; name: string; joined?:number; role?:"owner"|"admin"|"member" };
type VoiceMember = Member & { channel:string; left_at?:number|string };
type VoiceInvite = {id:string;channel:string;channel_name:string;from_id:string;from_name:string;created:number;expires:number};
type InvitePreview = { code:string; expires:number; id:string; name:string; icon?:string; banner?:string; inviter:string; members:number };
type Message = {
  id: string;
  user: string;
  name: string;
  body: string;
  created: number;
  reactions?:MessageReaction[];
};
type ReactionRow=MessageReaction&{message:string};
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
function messageDate(value:number|string){const timestamp=Number(value);return new Date(Number.isFinite(timestamp)&&timestamp>=0?timestamp:0)}
function AttachmentDraft({source,name,spoiler,onSpoiler,onRemove,onReplace}:{source:string;name:string;spoiler:boolean;onSpoiler:()=>void;onRemove:()=>void;onReplace:(file:File)=>void}){return <div className="attachment-draft"><div className="attachment-tools"><button type="button" title={spoiler?"Remove spoiler":"Mark as spoiler"} onClick={onSpoiler}>{spoiler?<EyeOff size={17}/>:<Eye size={17}/>}</button><label title="Replace image"><Pencil size={16}/><input className="chat-image-input" type="file" accept="image/*" onChange={(e)=>{const file=e.target.files?.[0];e.target.value="";if(file)onReplace(file)}}/></label><button type="button" className="remove" title="Remove image" onClick={onRemove}><Trash2 size={17}/></button></div><div className={spoiler?"draft-image spoiler":"draft-image"}><img src={source} alt="Attachment preview"/></div><span>{name||"image.webp"}</span></div>}
export default function Aemeath({
  user,
  onSettings,
  onDirect,
  onProfile,
  onVoiceStatus,
  initialServer,
  startCreate = false,
}: {
  user: LocalUser;
  onSettings: () => void;
  onDirect: () => void;
  onProfile:()=>void;
  onVoiceStatus:(status:({serverId:string;serverName:string;channelId:string;channelName:string}&Partial<VoiceControls>)|null)=>void;
  initialServer: string;
  startCreate?: boolean;
}) {
  const [servers, setServers] = useState<Server[]>([]),
    [selected, setSelected] = useState(initialServer),
    [channels, setChannels] = useState<Channel[]>([]),
    [current, setCurrent] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
    [voiceMembers,setVoiceMembers]=useState<VoiceMember[]>([]),
    [activeVoice,setActiveVoice]=useState<{id:string;name:string;serverId:string;serverName:string;restore?:boolean;muted?:boolean;deafened?:boolean}|null>(null),
    [voiceInviteChannel,setVoiceInviteChannel]=useState(""),
    [incomingVoiceInvite,setIncomingVoiceInvite]=useState<VoiceInvite|null>(null),
    [messages, setMessages] = useState<Message[]>([]);
  const [name, setName] = useState(user?.name || "Your profile"),
    [modal, setModal] = useState(startCreate ? "picker" : ""),
    [field, setField] = useState(""),
    [code, setCode] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [formError, setFormError] = useState(""),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(!!user),
    [channelLoading, setChannelLoading] = useState(false),
    [mobile, setMobile] = useState(false),
    [showMembers, setShowMembers] = useState(true),
    [mobileMembers, setMobileMembers] = useState(false);
  const [memberProfile,setMemberProfile]=useState<Member|null>(null),[memberContext,setMemberContext]=useState<{member:Member;x:number;y:number}|null>(null);
  const [voiceChat, setVoiceChat] = useState(false);
  const [attachment,setAttachment]=useState(""),[attachmentName,setAttachmentName]=useState(""),[attachmentSpoiler,setAttachmentSpoiler]=useState(false);
  const [invitePreview,setInvitePreview]=useState<InvitePreview|null>(null),[inviteLoading,setInviteLoading]=useState(false);
  const [serverMenu, setServerMenu] = useState(false);
  const [channelType, setChannelType] = useState<"text" | "voice" | "forum">(
      "text",
    ),
    [channelTopic, setChannelTopic] = useState(""),
    [editingChannel, setEditingChannel] = useState("");
  const end = useRef<HTMLDivElement>(null),
    room = useRef(""),
    serverRef = useRef(""),
    messageAfter = useRef(0),
    pending = useRef<{ id: string; body: string; channel: string } | null>(
      null,
    ),
    messageCount = useRef(0);
  const rememberedChannel=useRef(""),channelsServer=useRef(""),seenVoiceInvites=useRef(new Set<string>());
  const server = servers.find((s) => s.id === selected),
    channel = channels.find((c) => c.id === current),
    isVoice = channel?.kind === "voice",
    voiceChannel = activeVoice||((isVoice&&channel&&server)?{id:channel.id,name:channel.name,serverId:server.id,serverName:server.name}:null),
    owner = server?.owner === user?.id,
    manager = owner || server?.membership_role === "admin";
  useEffect(()=>{if(!memberContext)return;const close=()=>setMemberContext(null),key=(event:KeyboardEvent)=>{if(event.key==="Escape")close()};window.addEventListener("click",close);window.addEventListener("resize",close);window.addEventListener("keydown",key);return()=>{window.removeEventListener("click",close);window.removeEventListener("resize",close);window.removeEventListener("keydown",key)}},[memberContext]);
  const open = (type: string) => {
    setFormError("");
    setField(type === "profile" ? name : "");
    setCode("");
    setCopied(false);
    setModal(type);
  };
  useEffect(()=>{if(initialServer)setSelected(initialServer)},[initialServer]);
  useEffect(()=>{try{const saved=sessionStorage.getItem(`aemeath-voice-session-${user.id}`);if(!saved)return;const value=JSON.parse(saved) as {id?:string;name?:string;serverId?:string;serverName?:string;muted?:boolean;deafened?:boolean};if(value.id&&value.name&&value.serverId&&value.serverName)setActiveVoice({...value,id:value.id,name:value.name,serverId:value.serverId,serverName:value.serverName,restore:true})}catch{}},[user.id]);
  const openChannel = (item?: Channel) => {
    setFormError("");
    setEditingChannel(item?.id || "");
    setField(item?.name || "");
    setChannelType(item?.kind || "text");
    setChannelTopic(item?.topic || "");
    setModal(item ? "edit-channel" : "channel");
  };
  const refreshServers = useCallback(async (preferred?: string) => {
    const data = await api();
    setServers(data.servers);
    if (data.profile?.name) setName(data.profile.name);
    setSelected((old) => {const candidate=preferred||old;return candidate&&data.servers.some((item:Server)=>item.id===candidate)?candidate:data.servers[0]?.id||""});
  }, []);
  useEffect(()=>{const saved=readNavigationMemory(user.id);if(saved?.view==="server"&&saved.server===initialServer)rememberedChannel.current=saved.channel||""},[user.id,initialServer]);
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      setModal("join");
      setField(invite);
      setInviteLoading(true);
      api("?invite="+encodeURIComponent(invite)).then((d)=>setInvitePreview(d.invite as InvitePreview)).catch((e)=>setFormError(e.message)).finally(()=>setInviteLoading(false));
    }
    if (!user) return;
    refreshServers()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, refreshServers]);
  useEffect(() => {
    serverRef.current = selected;
    channelsServer.current = "";
    setChannels([]);
    setMembers([]);
    setVoiceMembers([]);
    setCurrent("");
    setMessages([]);
    if (!selected) return;
    let alive = true;
    setChannelLoading(true);
    const load = async () => {
      try {
        const [d,voiceResponse] = await Promise.all([api("?server=" + encodeURIComponent(selected)),fetch("/api/voice?server="+encodeURIComponent(selected),{cache:"no-store"})]);
        const voiceData=voiceResponse.ok?await voiceResponse.json() as {members?:VoiceMember[]}:{members:[]};
        if (alive) {
          channelsServer.current = selected;
          setChannels(d.channels);
          setMembers(d.members);
          setVoiceMembers(voiceData.members||d.voiceMembers||[]);
          const voiceInvite=(d.voiceInvites||[])[0] as VoiceInvite|undefined;
          if(voiceInvite&&!seenVoiceInvites.current.has(voiceInvite.id)){seenVoiceInvites.current.add(voiceInvite.id);setIncomingVoiceInvite(voiceInvite);void notifyAemeath({key:`voice-invite-${voiceInvite.id}`,title:`${voiceInvite.from_name} invited you to voice`,body:`Join ${voiceInvite.channel_name}`,kind:"call"})}
          setCurrent((old) => {const candidate=d.channels.some((c:Channel)=>c.id===old)?old:d.channels.some((c:Channel)=>c.id===rememberedChannel.current)?rememberedChannel.current:"";rememberedChannel.current="";return candidate||d.channels[0]?.id||""});
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setChannelLoading(false);
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);
  useEffect(()=>{if(selected&&current&&channelsServer.current===selected)writeNavigationMemory(user.id,{view:"server",server:selected,channel:current})},[user.id,selected,current]);
  useEffect(() => {
    room.current = current;
    setMessages([]);
    setDraft("");
    pending.current = null;
    messageCount.current = 0;
    messageAfter.current = 0;
    if (!current) return;
    let alive = true;
    const poll = async () => {
      try {
        const after=messageAfter.current;
        const d = await api("?channel=" + encodeURIComponent(current)+(after?"&after="+Math.max(0,after-1):""));
        if (alive) {
          const incoming=(d.messages||[]) as Message[],reactionRows=(d.reactions||[]) as ReactionRow[],reactionMap=new Map<string,MessageReaction[]>();
          reactionRows.forEach(({message,...reaction})=>reactionMap.set(message,[...(reactionMap.get(message)||[]),reaction]));
          if(after)incoming.filter(item=>item.user!==user?.id&&Number(item.created)>after).forEach(item=>void notifyAemeath({key:`server-${item.id}`,title:`#${channel?.name||"lobby"} · ${server?.name||"Aemeath"}`,body:isImageMessage(item.body)?`${item.name||"Member"} sent an image`:`${item.name||"Member"}: ${item.body.slice(0,120)}`}));
          if(after)setMessages(old=>{const merged=new Map(old.map(item=>[item.id,item]));incoming.forEach(item=>merged.set(item.id,item));return [...merged.values()].sort((a,b)=>Number(a.created)-Number(b.created)).map(item=>({...item,reactions:reactionMap.get(item.id)||[]}))});
          else setMessages(incoming.map(item=>({...item,reactions:reactionMap.get(item.id)||[]})));
          if(incoming.length)messageAfter.current=Math.max(messageAfter.current,...incoming.map(item=>Number(item.created)||0));
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [current,user?.id,channel?.name,server?.name]);
  useEffect(() => {
    if (messages.length !== messageCount.current) {
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      messageCount.current = messages.length;
    }
  }, [messages]);
  async function reactMessage(id:string,emoji:string){await api("",{action:"react-message",id,emoji});setMessages(old=>old.map(message=>{if(message.id!==id)return message;const reactions=[...(message.reactions||[])],index=reactions.findIndex(reaction=>reaction.emoji===emoji),selected=index>=0&&reactions[index].reacted;for(let i=reactions.length-1;i>=0;i--){if(reactions[i].reacted&&reactions[i].emoji!==emoji){reactions[i]={...reactions[i],count:reactions[i].count-1,reacted:false};if(reactions[i].count<=0)reactions.splice(i,1)}}if(index>=0){const current=reactions.find(reaction=>reaction.emoji===emoji);if(current){current.count+=selected?-1:1;current.reacted=!selected;if(current.count<=0)reactions.splice(reactions.indexOf(current),1)}}else reactions.push({emoji,count:1,reacted:true});return{...message,reactions}}))}
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      if (!user)
        throw new Error("Sign in before creating or joining a server.");
      if (modal === "create") {
        const d = await api("", { action: "create", name: field });
        await refreshServers(d.id);
      }
      if (modal === "join") {
        let value = field.trim();
        try {
          if (value.startsWith("http"))
            value = new URL(value).searchParams.get("invite") || "";
        } catch {}
        if (!invitePreview) {
          const preview = await api("?invite="+encodeURIComponent(value));
          setField(value);
          setInvitePreview(preview.invite as InvitePreview);
          return;
        }
        const d = await api("", { action: "join", code: value });
        await refreshServers(d.id);
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (modal === "channel") {
        const d = await api("", {
          action: "channel",
          server: selected,
          name: field,
          kind: channelType,
          topic: channelTopic,
        });
        const data = await api("?server=" + encodeURIComponent(selected));
        setChannels(data.channels);
        setCurrent(d.id);
      }
      if (modal === "edit-channel") {
        await api("", {
          action: "edit-channel",
          server: selected,
          channel: editingChannel,
          name: field,
          kind: channelType,
          topic: channelTopic,
        });
        const data = await api("?server=" + encodeURIComponent(selected));
        setChannels(data.channels);
      }
      if (modal === "profile") {
        await api("", { action: "profile", name: field });
        setName(field.trim());
        if (selected) {
          const d = await api("?server=" + encodeURIComponent(selected));
          setMembers(d.members);
        }
      }
      setModal("");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteChannel() {
    if (!editingChannel || busy) return;
    setBusy(true);
    setFormError("");
    try {
      await api("", {
        action: "delete-channel",
        server: selected,
        channel: editingChannel,
      });
      const data = await api("?server=" + encodeURIComponent(selected));
      setChannels(data.channels);
      setCurrent(data.channels[0]?.id || "");
      setModal("");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function invite() {
    open("invite");
    setBusy(true);
    try {
      const d = await api("", { action: "invite", server: selected });
      setCode(window.location.origin + "/?invite=" + d.code);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e?: React.FormEvent,overrideBody?:string) {
    e?.preventDefault();
    if ((!draft.trim()&&!attachment) || sending || !current) return;
    const target = current,
      body = overrideBody||(attachment?setImageSpoiler(attachment,attachmentSpoiler):draft.trim());
    if (
      !pending.current ||
      pending.current.body !== body ||
      pending.current.channel !== target
    )
      pending.current = { id: crypto.randomUUID(), body, channel: target };
    setSending(true);
    try {
      await api("", { action: "message", ...pending.current });
      if (room.current === target) {
        setDraft("");
        setAttachment("");setAttachmentName("");setAttachmentSpoiler(false);
        pending.current = null;
        const d = await api("?channel=" + encodeURIComponent(target)+"&after="+Math.max(0,messageAfter.current-1));
        if (room.current === target) {const incoming=(d.messages||[]) as Message[];setMessages(old=>{const merged=new Map(old.map(item=>[item.id,item]));incoming.forEach(item=>merged.set(item.id,item));return [...merged.values()].sort((a,b)=>Number(a.created)-Number(b.created))});if(incoming.length)messageAfter.current=Math.max(messageAfter.current,...incoming.map(item=>Number(item.created)||0));}
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const signIn =
    "/signin-with-chatgpt?return_to=" +
    encodeURIComponent(
      typeof window === "undefined"
        ? "/"
        : window.location.pathname + window.location.search,
    );
  return (
    <>
    {modal === "server-settings" && server&&<ServerSettings server={server} members={members} onClose={()=>setModal("")} onInvite={()=>{setModal("");void invite()}} onSave={async(value)=>{await api("",{action:"edit-server",server:server.id,...value});await refreshServers(server.id)}} onManage={async(value)=>{await api("",{...value,server:server.id});const updated=await api("?server="+encodeURIComponent(server.id));setMembers(updated.members);await refreshServers(server.id)}}/>}
    <SidebarProvider>
      <div className="aemeath-app">
        <nav className={`server-rail${mobile?" mobile-open":""}`} aria-label="Servers">
          <div className="brand-icon" title="Aemeath">
            <Flame size={27} />
          </div>
          <div className="rail-line" />
          <button
            className="server-icon"
            title="Direct messages"
            aria-label="Direct messages"
            onClick={onDirect}
          >
            <MessageCircle />
          </button>
          <div className="rail-line" />
          {servers.map((s) => (
              <button
                key={s.id}
                className={"server-icon " + (selected === s.id ? "active" : "")}
                title={s.name}
                aria-label={s.name}
                aria-pressed={selected === s.id}
                onClick={() => {
                  setSelected(s.id);
                  setMobile(false);
                }}
              >
                {s.icon ? <img className="server-rail-image" src={s.icon} alt=""/> : initials(s.name)}
              </button>
            ))}
          <button
            className="server-icon add"
            title="Create or join a server"
            aria-label="Create or join a server"
            onClick={() => open("picker")}
          >
            <Plus />
          </button>
        </nav>
        <button className={`mobile-drawer-backdrop${mobile?" open":""}`} aria-label="Close navigation" onClick={()=>setMobile(false)}/>
        <Sidebar
          collapsible="none"
          className={"channel-sidebar " + (!mobile ? "mobile-hidden" : "")}
        >
          <SidebarContent>
            <header className="server-title">
              <button className="server-title-menu-button" onClick={()=>server&&setServerMenu(!serverMenu)} aria-expanded={serverMenu}>
                <span>{server?.name || "Your space"}</span>{server&&<ChevronDown size={16}/>} 
              </button>
              <div className="server-title-actions">
                {server&&<button className="server-invite-button" aria-label="Invite people" title="Invite people" onClick={()=>void invite()}><UserPlus size={18}/></button>}
                {mobile&&<button className="server-sidebar-close" aria-label="Close channels" onClick={()=>setMobile(false)}><X size={18}/></button>}
              </div>
            </header>
            {serverMenu&&server&&<div className="server-menu">
              <button onClick={()=>{setServerMenu(false);void invite()}}><UserPlus size={17}/> Invite to server</button>
              {manager&&<><button onClick={()=>{setServerMenu(false);setModal("server-settings")}}><Settings size={17}/> Server settings</button><button onClick={()=>{setServerMenu(false);openChannel()}}><Plus size={17}/> Create channel</button></>}
              <div/>
              <button><Bell size={17}/> Notification settings</button>
              <button><Shield size={17}/> Privacy settings</button>
              <div/>
              <button onClick={()=>{void navigator.clipboard.writeText(server.id);setServerMenu(false)}}><Copy size={17}/> Copy server ID</button>
            </div>}
            <div className="channel-group">
              <span>TEXT CHANNELS</span>
              {manager && (
                <button
                  title="Create channel"
                  aria-label="Create channel"
                  onClick={() => openChannel()}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            {channels.filter((c) => c.kind !== "voice").length ? (
              channels
                .filter((c) => c.kind !== "voice")
                .map((c) => (
                  <button
                    className={"channel " + (c.id === current ? "active" : "")}
                    key={c.id}
                    onClick={() => {
                      setCurrent(c.id);
                      setMobile(false);
                    }}
                    aria-pressed={c.id === current}
                  >
                    {c.kind === "forum" ? (
                      <MessageSquare size={19} />
                    ) : (
                      <Hash size={19} />
                    )}
                    {c.name}
                    {manager && (
                      <Pencil
                        className="channel-edit"
                        size={14}
                        onClick={(e) => {
                          e.stopPropagation();
                          openChannel(c);
                        }}
                      />
                    )}
                  </button>
                ))
            ) : (
              <div className="channel active">
                <Hash size={19} /> general
              </div>
            )}
            <div className="channel-group">
              <span>VOICE CHANNELS</span>
              {manager && (
                <button
                  title="Create voice channel"
                  onClick={() => {
                    openChannel();
                    setChannelType("voice");
                  }}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            {channels
              .filter((c) => c.kind === "voice")
              .map((c) => (
                <div className="voice-channel-block" key={c.id}><button
                  className={"channel " + (c.id === current ? "active" : "")}
                  onClick={() => {
                    setCurrent(c.id);
                    setMobile(false);
                  }}
                >
                  <Volume2 size={19} />
                  {c.name}
                  {manager && (
                    <Pencil
                      className="channel-edit"
                      size={14}
                      onClick={(e) => {
                        e.stopPropagation();
                        openChannel(c);
                      }}
                    />
                  )}
                </button>{voiceMembers.filter(person=>person.channel===c.id).map(person=><div className="voice-channel-member" key={person.id}><span>{initials(person.name||"Member")}</span><strong>{person.name||"Member"}</strong>{Number(person.left_at)>0&&<small>Reconnecting</small>}</div>)}</div>
              ))}
            <div className="sidebar-bottom">
              <Lock size={14} /> {server?.access==="closed"?"Membership closed":"Private by invitation"}
            </div>
          </SidebarContent>
          <div className="user-bar">
            <button className="user-profile-trigger" onClick={onProfile} aria-label="Show my profile"><div className="avatar">{initials(name)}</div><span>
              <strong>{name}</strong>
              <small>{user ? "Signed in" : "Sign in to connect"}</small>
            </span></button>
            {user && (
              <button
                className="profile-button"
                aria-label="Account settings"
                title="Account settings"
                onClick={onSettings}
              >
                <Settings size={17} />
              </button>
            )}
          </div>
        </Sidebar>
        <main className="chat-main">
          <header className="chat-header">
            <button
              className="mobile-menu"
              aria-label="Show channels"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            {isVoice ? <Volume2 size={23} /> : <Hash size={23} />}
            <strong>{channel?.name || "general"}</strong>
            <span className="header-divider" />
            <span className="channel-topic">{channel?.topic || (isVoice ? "Voice, video, and gameplay streams" : "A place for the everyday")}</span>
            <span className="header-right">
              <Lock size={14} /> Private space
            </span>
            <button
              className="toolbar-button"
              aria-label={isVoice ? "Toggle channel chat" : "Toggle members"}
              title={isVoice ? "Toggle channel chat" : "Toggle members"}
              onClick={() => {
                if (isVoice) setVoiceChat(!voiceChat);
                else if (window.innerWidth <= 1120) setMobileMembers(!mobileMembers);
                else setShowMembers(!showMembers);
              }}
            >
              {isVoice ? (voiceChat ? <PanelRightClose size={20}/> : <MessageCircle size={20}/>) : <Users size={20} />}
            </button>
          </header>
          {error && (
            <div className="error-banner" role="alert">
              {error}{" "}
              <button
                className="retry"
                onClick={() => {
                  refreshServers()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {incomingVoiceInvite&&<div className="voice-invite-banner"><div><strong>{incomingVoiceInvite.from_name} invited you to voice</strong><span>Join {incomingVoiceInvite.channel_name}</span></div><button className="join" onClick={()=>{const invite=incomingVoiceInvite;setIncomingVoiceInvite(null);setCurrent(invite.channel);void api("",{action:"voice-invite-response",id:invite.id})}}>Join</button><button aria-label="Dismiss voice invite" onClick={()=>{const invite=incomingVoiceInvite;setIncomingVoiceInvite(null);void api("",{action:"voice-invite-response",id:invite.id})}}><X size={16}/></button></div>}
          {voiceChannel&&<div className={`voice-room-host${current===voiceChannel.id?"":" background"}`}><VoiceRoom channel={voiceChannel.id} name={voiceChannel.name} user={{id:user.id,name}} autoJoin={!!voiceChannel.restore} initialMuted={!!voiceChannel.muted} initialDeafened={!!voiceChannel.deafened} onInvite={()=>{setVoiceInviteChannel(voiceChannel.id);setFormError("");setModal("voice-invite")}} onJoinedChange={joined=>{const status=joined?{...voiceChannel,restore:false}:null;setActiveVoice(status);try{if(status)sessionStorage.setItem(`aemeath-voice-session-${user.id}`,JSON.stringify(status));else sessionStorage.removeItem(`aemeath-voice-session-${user.id}`)}catch{}onVoiceStatus(status?{serverId:status.serverId,serverName:status.serverName,channelId:status.id,channelName:status.name}:null)}} onVoiceControls={controls=>{if(!controls){onVoiceStatus(null);return}const status={...voiceChannel,restore:false,muted:controls.muted,deafened:controls.deafened};setActiveVoice(status);try{sessionStorage.setItem(`aemeath-voice-session-${user.id}`,JSON.stringify(status))}catch{}onVoiceStatus({serverId:voiceChannel.serverId,serverName:voiceChannel.serverName,channelId:voiceChannel.id,channelName:voiceChannel.name,...controls})}}/></div>}
          {!isVoice&&<div className="conversation surface-enter" key={current || "welcome"}>
            {!server ? (
              <>
                <div className="welcome">
                  <div className="welcome-icon">
                    <Hash size={36} />
                  </div>
                  <span className="eyebrow">YOUR PEOPLE. YOUR PLACE.</span>
                  <h1>
                    A little space to
                    <br />
                    be together.
                  </h1>
                  <p>
                    Late-night ideas. Weekend plans. Everything in between.
                    <br />
                    Bring your people into a place that feels like yours.
                  </p>
                  {loading ? (
                    <div className="loading-text" role="status">
                      Loading your servers…
                    </div>
                  ) : user ? (
                    <>
                      <button
                        className="primary"
                        onClick={() => open("picker")}
                      >
                        Create your first server <Plus size={17} />
                      </button>
                      <button
                        className="join-link"
                        onClick={() => open("join")}
                      >
                        Have an invite? Join a server <span aria-hidden>↗</span>
                      </button>
                    </>
                  ) : (
                    <a className="primary" href={signIn} target="_top">
                      Sign in to get started <ArrowRight size={17} />
                    </a>
                  )}
                </div>
                <div className="welcome-note">
                  <span className="mini-brand">
                    <Flame size={20} />
                  </span>
                  <div>
                    <strong>
                      Welcome to Aemeath <span className="tag">YOUR SPACE</span>
                    </strong>
                    <p>
                      Start with a server. Add a few channels. Invite your
                      favorite people.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="chat-start">
                  <div className="welcome-icon">
                    <Hash size={34} />
                  </div>
                  <span className="eyebrow">{server.name}</span>
                  <h1>Welcome to #{channel?.name || "general"}</h1>
                  <p>
                    This is the beginning of your conversation. Make it a good
                    one.
                  </p>
                  {manager && members.length === 1 && (
                    <button className="primary" onClick={invite}>
                      <UserPlus size={16} /> Invite your people
                    </button>
                  )}
                </div>
                {channelLoading && (
                  <div className="loading-text">Loading channels…</div>
                )}
                {messages.map((m, i) => (
                  <div key={m.id}>
                    {(i === 0 ||
                      messageDate(messages[i - 1].created).toLocaleDateString() !==
                        messageDate(m.created).toLocaleDateString()) && (
                      <div className="day-divider">
                        {messageDate(m.created).toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    )}
                    <article className="message">
                      <div
                        className="avatar"
                        style={{
                          background:
                            m.user === user?.id ? "#655242" : "#414a58",
                          color: m.user === user?.id ? "#f2d2b6" : "#c2d1e7",
                        }}
                      >
                        {initials(m.name || "Member")}
                      </div>
                      <div className="message-body">
                        <strong>{m.name || "Member"}</strong>
                        {m.user === user?.id && (
                          <span className="tag">YOU</span>
                        )}
                        <time dateTime={messageDate(m.created).toISOString()}>
                          {messageDate(m.created).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        {isImageMessage(m.body)?<ImagePreview src={imageSource(m.body)} spoiler={isSpoilerImage(m.body)}/>:<p>{m.body}</p>}
                      </div>
                      <MessageMenu id={m.id} body={m.body} own={m.user===user.id||manager} reactions={m.reactions} onReact={emoji=>reactMessage(m.id,emoji)} onReply={()=>setDraft(`@${m.name||"Member"} `)} onDelete={async()=>{try{await api("",{action:"delete-message",id:m.id});setMessages(old=>old.filter(item=>item.id!==m.id))}catch(e){setError((e as Error).message)}}} onReport={()=>setError("Message reported for review.")}/>
                    </article>
                  </div>
                ))}
                {messages.length === 0 && !channelLoading && (
                  <div className="welcome-note">
                    <span className="mini-brand">
                      <MessageCircle size={20} />
                    </span>
                    <div>
                      <strong>The floor is yours.</strong>
                      <p>Send the first message to get things going.</p>
                    </div>
                  </div>
                )}
                <div ref={end} />
              </>
            )}
          </div>}
          {(!isVoice || voiceChat) && <div className={isVoice ? "composer-wrap voice-chat-drawer" : "composer-wrap"}>
            {isVoice && <div className="voice-chat-list">
              <div className="voice-chat-title"><MessageCircle size={17}/><strong>Channel chat</strong></div>
              {messages.length ? messages.map((m)=><article className="voice-chat-message" key={m.id}><div className="avatar">{initials(m.name||"Member")}</div><div><strong>{m.name||"Member"}</strong><time>{messageDate(m.created).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</time>{isImageMessage(m.body)?<ImagePreview src={imageSource(m.body)} spoiler={isSpoilerImage(m.body)}/>:<p>{m.body}</p>}</div><MessageMenu id={m.id} body={m.body} own={m.user===user.id||manager} reactions={m.reactions} onReact={emoji=>reactMessage(m.id,emoji)} onReply={()=>setDraft(`@${m.name||"Member"} `)} onDelete={async()=>{try{await api("",{action:"delete-message",id:m.id});setMessages(old=>old.filter(item=>item.id!==m.id))}catch(e){setError((e as Error).message)}}} onReport={()=>setError("Message reported for review.")}/></article>) : <div className="voice-chat-empty">Chat while you hang out in voice.</div>}
            </div>}
            {attachment&&<AttachmentDraft source={imageSource(attachment)} name={attachmentName} spoiler={attachmentSpoiler} onSpoiler={()=>setAttachmentSpoiler(!attachmentSpoiler)} onRemove={()=>{setAttachment("");setAttachmentName("");setAttachmentSpoiler(false)}} onReplace={async(file)=>{setSending(true);try{setAttachment(await compressChatImage(file));setAttachmentName(file.name)}catch(error){setError((error as Error).message)}finally{setSending(false)}}}/>}<form
              className={"composer " + (!current ? "disabled" : "")}
              onSubmit={send}
            >
              <Hash size={19} />
              <label className="attach-image" title="Attach an image" aria-label="Attach an image"><ImagePlus size={19}/><input className="chat-image-input" type="file" accept="image/*" disabled={!current||sending} onChange={async(e)=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setSending(true);try{setAttachment(await compressChatImage(file));setAttachmentName(file.name)}catch(error){setError((error as Error).message)}finally{setSending(false)}}}/></label>
              <textarea
                rows={1}
                aria-label={"Message #" + (channel?.name || "general")}
                placeholder={
                  current
                    ? "Message #" + channel?.name
                    : "Create or join a server to start chatting"
                }
                maxLength={4000}
                disabled={!current || sending}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={async(e)=>{const file=imageFromClipboard(e.clipboardData);if(!file)return;e.preventDefault();setSending(true);try{setAttachment(await compressChatImage(file));setAttachmentName(file.name||"Pasted image");setError("")}catch(error){setError((error as Error).message)}finally{setSending(false)}}}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={!current || (!draft.trim()&&!attachment) || sending}
              >
                <ArrowUp size={20} />
              </button>
            </form>
            <div className="composer-hint">
              {current
                ? "Enter to send · Shift + Enter for a new line · Messages refresh automatically"
                : "Your next great conversation starts here."}
            </div>
          </div>}
        </main>
        <aside
          className={
            "members-panel " +
            ((isVoice ? "desktop-hidden " : showMembers ? "" : "desktop-hidden ") +
              (mobileMembers ? "mobile-visible" : ""))
          }
        >
          <div className="members-heading">
            <Users size={17} /> YOUR CIRCLE{" "}
            {members.length > 0 && "— " + members.length}
          </div>
          {members.length ? (
            members.map((m) => (
              <button className="member" key={m.id} onClick={()=>setMemberProfile(m)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setMemberProfile(null);setMemberContext({member:m,x:Math.min(event.clientX,window.innerWidth-224),y:Math.min(event.clientY,window.innerHeight-310)})}}>
                <span className="member-avatar"><span className="avatar">{initials(m.name || "Member")}</span><i className={voiceMembers.some(person=>person.id===m.id&&!Number(person.left_at))||m.id===user.id?"":"idle"}/></span>
                <span className="member-name"><strong>{m.name || "Member"}</strong><small>{voiceMembers.find(person=>person.id===m.id&&!Number(person.left_at))?`In ${channels.find(item=>item.id===voiceMembers.find(person=>person.id===m.id)?.channel)?.name||"voice"}`:m.id===user.id?"Online":m.role==="owner"?"Server owner":m.role==="admin"?"Administrator":"Member"}</small></span>
                <span className={`member-role-icon ${m.role||"member"}`} title={m.role==="owner"?"Server owner":m.role==="admin"?"Administrator":"Member"}>{m.role==="owner"?<Crown size={13}/>:m.role==="admin"?<Shield size={13}/>:null}</span>
              </button>
            ))
          ) : (
            <div className="circle-empty">
              <div className="circle-icon">
                <Users size={28} />
              </div>
              <h3>Better with your people</h3>
              <p>
                Your server members will
                <br />
                feel right at home here.
              </p>
            </div>
          )}
          <div className="privacy-note">
            <Lock size={18} />
            <h4>Just your circle.</h4>
            <p>
              Your servers and conversations are only for the people you invite.
            </p>
          </div>
          {memberProfile&&<div className="member-profile-card"><button className="member-profile-close" aria-label="Close member profile" onClick={()=>setMemberProfile(null)}><X size={16}/></button><div className="member-profile-banner"/><div className="member-profile-avatar"><span>{initials(memberProfile.name||"Member")}</span><i className={voiceMembers.some(person=>person.id===memberProfile.id&&!Number(person.left_at))||memberProfile.id===user.id?"":"idle"}/></div><h3>{memberProfile.name||"Member"}</h3><p>{memberProfile.id===user.id?"This is you":voiceMembers.some(person=>person.id===memberProfile.id&&!Number(person.left_at))?"Currently in a voice lobby":memberProfile.role==="owner"?"Server owner":memberProfile.role==="admin"?"Server administrator":"Server member"}</p><div className="member-profile-meta"><span><strong>Role</strong>{memberProfile.role==="owner"?"Server owner":memberProfile.role==="admin"?"Administrator":"Member"}</span><span><strong>Member since</strong>{memberProfile.joined?new Date(Number(memberProfile.joined)).toLocaleDateString():"Member"}</span></div>{memberProfile.id!==user.id&&<button className="member-profile-mention" onClick={()=>{setDraft(current=>`${current}${current&&!current.endsWith(" ")?" ":""}@${memberProfile.name} `);if(isVoice)setVoiceChat(true);setMemberProfile(null)}}><AtSign size={15}/> Mention</button>}</div>}
        </aside>
        {memberContext&&<div className="member-context-menu" style={{left:memberContext.x,top:memberContext.y}} onClick={event=>event.stopPropagation()} role="menu"><button onClick={()=>{setMemberProfile(memberContext.member);setMemberContext(null)}}><UserRound size={16}/> Profile</button>{memberContext.member.id!==user.id&&<button onClick={()=>{setDraft(current=>`${current}${current&&!current.endsWith(" ")?" ":""}@${memberContext.member.name} `);if(isVoice)setVoiceChat(true);setMemberContext(null)}}><AtSign size={16}/> Mention</button>}<div/><button disabled={!owner||memberContext.member.role==="owner"} onClick={()=>void(async()=>{try{await api("",{action:"set-member-role",server:selected,user:memberContext.member.id,role:memberContext.member.role==="admin"?"member":"admin"});const updated=await api("?server="+encodeURIComponent(selected));setMembers(updated.members);setMemberContext(null)}catch(e){setError((e as Error).message)}})()}><Shield size={16}/> {memberContext.member.role==="admin"?"Remove admin":"Make admin"}</button>{manager&&<button onClick={()=>{setMemberContext(null);setModal("server-settings")}}><Settings size={16}/> Open in Mod View</button>}<div/><button onClick={()=>{void navigator.clipboard.writeText(memberContext.member.id);setMemberContext(null)}}><Copy size={16}/> Copy User ID</button>{manager&&memberContext.member.id!==user.id&&memberContext.member.role!=="owner"&&<button className="danger" onClick={()=>void(async()=>{try{await api("",{action:"remove-member",server:selected,user:memberContext.member.id});setMembers(old=>old.filter(item=>item.id!==memberContext.member.id));setMemberContext(null)}catch(e){setError((e as Error).message)}})()}><UserMinus size={16}/> Remove from server</button>}</div>}
      </div>
      <Dialog
        open={!!modal&&modal!=="server-settings"}
        onOpenChange={(v) => {
          if (!busy && !v) setModal("");
        }}
      >
        <DialogContent className="aemeath-dialog">
          <DialogTitle>
            {modal === "picker"
              ? "Create Your Server"
              : modal === "create"
                ? "A place for your people"
                : modal === "join"
                  ? "Join your people"
                  : modal === "channel"
                    ? "Create a channel"
                    : modal === "edit-channel"
                      ? "Edit channel"
                      : modal === "voice-invite"
                        ? "Invite a member to voice"
                      : modal === "profile"
                        ? "Make yourself at home"
                        : "Invite your people"}
          </DialogTitle>
          <DialogDescription>
            {modal === "picker"
              ? "Your server is where you and your friends hang out. Make yours and start talking."
              : modal === "create"
                ? "A small hangout, a group project, or your favorite corner of the internet."
                : modal === "join"
                  ? "Paste an invitation link or code from a server owner."
                  : modal === "channel"
                    ? "Give your next conversation a home."
                    : modal === "edit-channel"
                      ? "Change this channel's name, type, or topic."
                      : modal === "voice-invite"
                        ? "Send a notification to someone who is already a member of this server."
                      : modal === "profile"
                        ? "Choose the name your friends will see in chat."
                        : "Share this invitation with the people you want in " +
                          (server?.name || "your server") +
                          "."}
          </DialogDescription>
          {!user ? (
            <>
              <p className="muted-text">
                Sign in to create or join a private server.
              </p>
              <a className="primary" target="_top" href={signIn}>
                Sign in <ArrowRight size={17} />
              </a>
            </>
          ) : modal === "picker" ? (
            <div className="server-picker">
              <button className="server-choice" onClick={() => open("create")}>
                <span>🏞️</span>
                <strong>Create My Own</strong>
                <ChevronRight />
              </button>
              <p className="picker-label">Start from a template</p>
              {[
                [Gamepad2, "Gaming", "Gaming hangout"],
                [Heart, "Friends", "Friends group"],
                [GraduationCap, "Study Group", "Study group"],
                [BookOpen, "School Club", "School club"],
              ].map(([Icon, label, template]) => {
                const TemplateIcon = Icon as typeof Gamepad2;
                return (
                  <button
                    key={label as string}
                    className="server-choice"
                    onClick={() => {
                      setField(template as string);
                      setModal("create");
                    }}
                  >
                    <TemplateIcon />
                    <strong>{label as string}</strong>
                    <ChevronRight />
                  </button>
                );
              })}
              <h3>Have an invite already?</h3>
              <button
                className="secondary picker-join"
                onClick={() => open("join")}
              >
                Join a Server
              </button>
            </div>
          ) : modal === "voice-invite" ? (
            <div className="voice-member-picker">{members.filter(member=>member.id!==user.id&&!voiceMembers.some(person=>person.id===member.id&&person.channel===voiceInviteChannel)).length?members.filter(member=>member.id!==user.id&&!voiceMembers.some(person=>person.id===member.id&&person.channel===voiceInviteChannel)).map(member=><button disabled={busy} key={member.id} onClick={()=>void(async()=>{setBusy(true);setFormError("");try{await api("",{action:"invite-to-voice",server:selected,channel:voiceInviteChannel,user:member.id});setModal("")}catch(e){setFormError((e as Error).message)}finally{setBusy(false)}})()}><span className="avatar">{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.role==="admin"?"Administrator":member.role==="owner"?"Server owner":"Member"}</small></span><UserPlus size={17}/></button>):<p className="muted-text">Everyone in this server is already in the lobby.</p>}{formError&&<p className="form-error">{formError}</p>}</div>
          ) : modal === "invite" ? (
            <>
              {busy ? (
                <p className="muted-text" role="status">
                  Creating your invitation…
                </p>
              ) : (
                code && (
                  <>
                    <label className="form-label" htmlFor="invite-url">
                      Invitation link · expires in 7 days
                    </label>
                    <div className="invite-copy-row">
                    <input id="invite-url" readOnly value={code} onFocus={(e) => e.target.select()} />
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(code);
                          setCopied(true);
                        } catch {
                          setFormError(
                            "Select the link above and copy it manually.",
                          );
                        }
                      }}
                    >
                      {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    </div>
                    <p className="muted-text">
                      Friends need a Aemeath account and access to this private
                      site before joining.
                    </p>
                  </>
                )
              )}
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
            </>
          ) : modal === "join" && (invitePreview || inviteLoading) ? (
            <div className="invite-preview-wrap">
              {inviteLoading ? <p className="muted-text" role="status">Opening invitation…</p> : invitePreview && <>
                <div className="invite-server-art" style={{"--invite-banner":invitePreview.banner||"#ff5ca8"} as React.CSSProperties}><div className="invite-server-icon">{invitePreview.icon?<img src={invitePreview.icon} alt=""/>:initials(invitePreview.name)}</div></div>
                <p className="invite-kicker"><strong>{invitePreview.inviter}</strong> invited you to join</p>
                <h2>{invitePreview.name}</h2>
                <div className="invite-stats"><span><i/> {invitePreview.members} member{Number(invitePreview.members)===1?"":"s"}</span><span>Private server</span></div>
                {formError&&<p className="form-error" role="alert">{formError}</p>}
                <button className="primary invite-accept" disabled={busy} onClick={(e)=>void submit(e as unknown as React.FormEvent)}>{busy?"Joining…":"Accept invite"}<ArrowRight size={17}/></button>
                <button className="invite-use-code" onClick={()=>{setInvitePreview(null);setFormError("")}}>Use a different invite</button>
              </>}
            </div>
          ) : (
            <form onSubmit={submit} className="modal-form">
              <label className="form-label" htmlFor="modal-field">
                {modal === "create"
                  ? "Server name"
                  : modal === "join"
                    ? "Invitation link or code"
                    : modal === "channel" || modal === "edit-channel"
                      ? "Channel name"
                      : "Display name"}
              </label>
              <input
                autoFocus
                id="modal-field"
                className="form-input"
                placeholder={
                  modal === "create"
                    ? "e.g. The living room"
                    : modal === "channel" || modal === "edit-channel"
                      ? "e.g. weekend-plans"
                      : modal === "join"
                        ? "Paste your invitation"
                        : ""
                }
                value={field}
                onChange={(e) => {setField(e.target.value);if(modal==="join")setInvitePreview(null)}}
                maxLength={
                  modal === "join"
                    ? 500
                    : modal === "channel" || modal === "edit-channel"
                      ? 32
                      : modal === "profile"
                        ? 40
                        : 50
                }
                required
                disabled={busy}
              />
              {(modal === "channel" || modal === "edit-channel") && (
                <>
                  <span className="form-label">Channel type</span>
                  <div className="channel-type-picker">
                    {(
                      [
                        ["text", Hash, "Text", "Messages and everyday chat"],
                        [
                          "voice",
                          Volume2,
                          "Voice",
                          "Voice, video, and screen sharing",
                        ],
                        [
                          "forum",
                          MessageSquare,
                          "Forum",
                          "Organized discussions",
                        ],
                      ] as const
                    ).map(([value, Icon, label, help]) => (
                      <button
                        type="button"
                        className={channelType === value ? "selected" : ""}
                        key={value}
                        onClick={() => setChannelType(value)}
                      >
                        <Icon size={20} />
                        <span>
                          <strong>{label}</strong>
                          <small>{help}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <label className="form-label" htmlFor="channel-topic">
                    Channel topic
                  </label>
                  <textarea
                    id="channel-topic"
                    className="form-input channel-topic-input"
                    value={channelTopic}
                    onChange={(e) => setChannelTopic(e.target.value)}
                    maxLength={1000}
                    placeholder="What is this channel about?"
                    disabled={busy}
                  />
                </>
              )}
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !field.trim()}
                >
                  {busy
                    ? "Saving…"
                    : modal === "create"
                      ? "Create server"
                      : modal === "join"
                        ? "Join server"
                        : modal === "channel"
                          ? "Create channel"
                          : modal === "edit-channel"
                            ? "Save changes"
                            : "Save profile"}
                  <ArrowRight size={16} />
                </button>
                {modal === "edit-channel" && (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={busy}
                    onClick={deleteChannel}
                  >
                    <Trash2 size={16} /> Delete channel
                  </button>
                )}
                {modal === "create" && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => open("join")}
                  >
                    Join instead
                  </button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
    </>
  );
}


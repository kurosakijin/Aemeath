"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Flame,
  MessageCircle,
  Plus,
  Search,
  Phone,
  Video,
  ArrowUp,
  Settings,
  Menu,
  X,
  ArrowRight,
  Lock,
  AtSign,
  ImagePlus,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
} from "lucide-react";
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
import { request, onlineChat, type LocalUser } from "@/lib/online";
import Aemeath from "./aemeath";
import type {VoiceControls} from "./voice-room";
import {compressChatImage,imageFromClipboard,imageSource,isImageMessage,isSpoilerImage,setImageSpoiler} from "@/lib/image-message";
import { CallProvider, useCalls } from "./call-provider";
import MessageMenu from "./message-menu";
import ImagePreview from "./image-preview";
import {armNotifications,notifyAemeath} from "@/lib/notifications";
import {readNavigationMemory,writeNavigationMemory} from "@/lib/navigation-memory";
type Conversation = {
  id: string;
  peer: string;
  name: string;
  preview: string | null;
  updated: number;
  last_sender?: string | null;
  call_status?: string | null;
  call_reason?: string | null;
  call_kind?: "voice" | "video" | null;
  call_caller?: string | null;
  call_created?: number | string | null;
};
type Message = {
  id: string;
  sender: string;
  name: string;
  body: string;
  created: number | string;
};
const timestamp = (value: number | string) =>
  typeof value === "number" ? value : Number(value);
const messageDate = (value: number | string) => new Date(timestamp(value));
const callLabel = (call: Conversation, userId: string) => {
  if (!call.call_status) return null;
  if (call.call_status === "ringing")
    return call.call_caller === userId ? "Calling…" : "Incoming call";
  if (call.call_reason === "missed")
    return "Missed " + (call.call_kind || "voice") + " call";
  if (call.call_reason === "declined")
    return "Declined " + (call.call_kind || "voice") + " call";
  return "Last " + (call.call_kind || "voice") + " call ended";
};
function Initial({ name }: { name: string }) {
  return <div className="avatar">{name.slice(0, 2).toUpperCase()}</div>;
}
function Inbox({
  user,
  onSettings,
}: {
  user: LocalUser;
  onSettings: () => void;
}) {
  const [serverView, setServerView] = useState<string | null>(null),
    [servers, setServers] = useState<{ id: string; name: string }[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [selected, setSelected] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [sending, setSending] = useState(false),
    [mobile, setMobile] = useState(false),
    [dialog, setDialog] = useState(false),
    [search, setSearch] = useState(""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(""),
    [starting, setStarting] = useState(false),
    [more, setMore] = useState(false),
    [olderLoading, setOlderLoading] = useState(false);
  const [navigationReady,setNavigationReady]=useState(false);
  const [voiceStatus,setVoiceStatus]=useState<({serverId:string;serverName:string;channelId:string;channelName:string}&Partial<VoiceControls>)|null>(null);
  const [attachment,setAttachment]=useState(""),[attachmentName,setAttachmentName]=useState(""),[attachmentSpoiler,setAttachmentSpoiler]=useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    current = useRef(""),
    conversationSeen = useRef<Map<string,number>|null>(null),
    pending = useRef<{ id: string; body: string; conversation: string } | null>(
      null,
    ),
    count = useRef(0);
  const calls = useCalls();
  const conversation = conversations.find((c) => c.id === selected);
  useEffect(()=>{const saved=readNavigationMemory(user.id);if(saved?.view==="server"&&saved.server)setServerView(saved.server);else if(saved?.view==="direct"&&saved.conversation)setSelected(saved.conversation);setNavigationReady(true)},[user.id]);
  const refresh = useCallback(async () => {
    const [d, s] = await Promise.all([
      request<{ conversations: Conversation[] }>("/api/direct"),
      onlineChat(),
    ]);
    const stamps=new Map(d.conversations.map(item=>[item.id,timestamp(item.updated)]));
    if(conversationSeen.current)for(const item of d.conversations){const previous=conversationSeen.current.get(item.id)||0;if(timestamp(item.updated)>previous&&item.last_sender&&item.last_sender!==user.id&&item.call_status!=="ringing")void notifyAemeath({key:`dm-${item.id}-${item.updated}`,title:item.name,body:item.preview||"Sent you a message"})}
    conversationSeen.current=stamps;
    setConversations(d.conversations);
    setServers(s.servers);
    setSelected(old=>old&&d.conversations.some(item=>item.id===old)?old:"");
  }, [user.id]);
  useEffect(()=>{armNotifications()},[]);
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        await refresh();
        if (mounted) setError("");
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [refresh, serverView]);
  useEffect(() => {
    current.current = selected;
    setMessages([]);
    setDraft("");
    pending.current = null;
    count.current = 0;
    if (!selected) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await request<{ messages: Message[]; hasMore: boolean }>(
          "/api/direct?conversation=" + encodeURIComponent(selected),
        );
        if (alive) {
          setMessages((old) =>
            Array.from(
              new Map([...old, ...d.messages].map((m) => [m.id, m])).values(),
            ).sort((a, b) => timestamp(a.created) - timestamp(b.created)),
          );
          setMore((old) => old || d.hasMore);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    setMore(false);
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);
  useEffect(() => {
    if (messages.length > count.current && !olderLoading)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    count.current = messages.length;
  }, [messages, olderLoading]);
  useEffect(() => {
    if (!dialog) return;
    setPeople([]);
    setSearchError("");
    if (search.trim().length < 3) {
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      request<{ people: { id: string; name: string }[] }>(
        "/api/direct?username=" + encodeURIComponent(search.trim()),
      )
        .then((d) => {
          if (alive) setPeople(d.people);
        })
        .catch((e) => {
          if (alive) setSearchError(e.message);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search, dialog]);
  async function start(peer: string) {
    if (starting) return;
    setStarting(true);
    setSearchError("");
    try {
      const d = await request<{ id: string }>("/api/direct", {
        action: "start",
        peer,
      });
      await refresh();
      setSelected(d.id);
      setDialog(false);
      setMobile(false);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function send(e?: React.FormEvent,overrideBody?:string) {
    e?.preventDefault();
    if (!selected || (!draft.trim()&&!attachment) || sending) return;
    const id = selected;
    const body = overrideBody||(attachment?setImageSpoiler(attachment,attachmentSpoiler):draft.trim());
    if (
      !pending.current ||
      pending.current.body !== body ||
      pending.current.conversation !== id
    )
      pending.current = { id: crypto.randomUUID(), body, conversation: id };
    setSending(true);
    try {
      await request("/api/direct", { action: "send", ...pending.current });
      if (current.current === id) {
        setDraft("");
        setAttachment("");setAttachmentName("");setAttachmentSpoiler(false);
        pending.current = null;
        const d = await request<{ messages: Message[] }>(
          "/api/direct?conversation=" + id,
        );
        if (current.current === id)
          setMessages((old) =>
            Array.from(
              new Map([...old, ...d.messages].map((m) => [m.id, m])).values(),
            ).sort((a, b) => timestamp(a.created) - timestamp(b.created)),
          );
      }
      await refresh();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function older() {
    if (!messages.length || olderLoading) return;
    setOlderLoading(true);
    try {
      const d = await request<{ messages: Message[]; hasMore: boolean }>(
        "/api/direct?conversation=" +
          selected +
          "&before=" +
          timestamp(messages[0].created),
      );
      setMessages((old) =>
        Array.from(
          new Map([...d.messages, ...old].map((m) => [m.id, m])).values(),
        ).sort((a, b) => timestamp(a.created) - timestamp(b.created)),
      );
      setMore(d.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOlderLoading(false);
    }
  }
  const newMessage = () => {
    setSearch("");
    setPeople([]);
    setSearchError("");
    setDialog(true);
  };
  if(!navigationReady)return <div className="app-loading">Restoring your last channel…</div>;
  return (
    <>
      <div className={`persistent-app-view${serverView!==null?" active":" hidden"}`}>
      <Aemeath
        user={user}
        onSettings={onSettings}
        onDirect={() => {writeNavigationMemory(user.id,{view:"direct"});setServerView(null)}}
        onVoiceStatus={setVoiceStatus}
        initialServer={serverView||""}
        startCreate={serverView===""}
      />
      </div>
      <div className={`persistent-app-view${serverView===null?" active":" hidden"}`}>
      <SidebarProvider>
      <div className="aemeath-app dm-app">
        <nav className={`server-rail${mobile?" mobile-open":""}`} aria-label="Home and servers">
          <div className="brand-icon" title="Aemeath">
            <Flame size={27} />
          </div>
          <div className="rail-line" />
          <button
            className="server-icon active"
            aria-label="Direct messages"
            title="Direct messages"
            onClick={() => {
              setSelected("");
              writeNavigationMemory(user.id,{view:"direct"});
              setMobile(false);
            }}
          >
            <MessageCircle />
          </button>
          <div className="rail-line" />
          {servers.map((s) => (
            <button
              className="server-icon"
              key={s.id}
              title={s.name}
              aria-label={s.name}
              onClick={() => {writeNavigationMemory(user.id,{view:"server",server:s.id});setServerView(s.id)}}
            >
              {s.name.slice(0, 2).toUpperCase()}
            </button>
          ))}
          <button
            className="server-icon add"
            title="Add a server"
            aria-label="Add a server"
            onClick={() => setServerView("")}
          >
            <Plus />
          </button>
        </nav>
        <button className={`mobile-drawer-backdrop${mobile?" open":""}`} aria-label="Close navigation" onClick={()=>setMobile(false)}/>
        <Sidebar
          collapsible="none"
          className={
            "channel-sidebar dm-sidebar " + (!mobile ? "mobile-hidden" : "")
          }
        >
          <SidebarContent>
            <header className="server-title">
              <span>Messages</span>
              <button
                className="dm-close"
                aria-label="Close conversations"
                onClick={() => setMobile(false)}
              >
                <X size={17} />
              </button>
            </header>
            <button className="find-person" onClick={newMessage}>
              <Search size={16} /> Find a person <Plus size={15} />
            </button>
            <div className="channel-group">
              <span>DIRECT MESSAGES</span>
              <button onClick={newMessage} aria-label="New direct message">
                <Plus size={16} />
              </button>
            </div>
            {conversations.map((c) => (
              <button
                className={"dm-person " + (selected === c.id ? "active" : "")}
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  writeNavigationMemory(user.id,{view:"direct",conversation:c.id});
                  setMobile(false);
                }}
              >
                <Initial name={c.name} />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {callLabel(c, user.id) || c.preview || "Say hello"}
                  </small>
                </span>
              </button>
            ))}
            {!loading && !conversations.length && (
              <p className="empty-dm-list">
                Your conversations
                <br />
                will feel at home here.
              </p>
            )}
            <div className="sidebar-bottom">
              <Lock size={13} /> One conversation at a time.
            </div>
          </SidebarContent>
          <div className="user-bar">
            <Initial name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <small>My account</small>
            </div>
            <button
              className="profile-button"
              onClick={onSettings}
              aria-label="Account settings"
            >
              <Settings size={17} />
            </button>
          </div>
        </Sidebar>
        <main className="chat-main">
          <header className="chat-header">
            <button
              className="mobile-menu"
              aria-label="Show conversations"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            {conversation ? (
              <>
                <AtSign size={23} />
                <strong>{conversation.name}</strong>
                <span className="header-divider" />
                <span className="channel-topic">Direct message</span>
                <div className="dm-header-actions">
                  <button
                    title="Start voice call"
                    aria-label="Start voice call"
                    disabled={calls.active}
                    onClick={() =>
                      calls.start(conversation.id, conversation.name, "voice")
                    }
                  >
                    <Phone size={20} />
                  </button>
                  <button
                    title="Start video call"
                    aria-label="Start video call"
                    disabled={calls.active}
                    onClick={() =>
                      calls.start(conversation.id, conversation.name, "video")
                    }
                  >
                    <Video size={22} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <MessageCircle size={22} />
                <strong>Direct Messages</strong>
                <span className="header-right">
                  Your people, a little closer
                </span>
              </>
            )}
          </header>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="retry"
                onClick={() => refresh().catch((e) => setError(e.message))}
              >
                Retry
              </button>
            </div>
          )}
          <div className="conversation dm-conversation">
            {conversation ? (
              <>
                <div className="dm-start">
                  <Initial name={conversation.name} />
                  <h1>{conversation.name}</h1>
                  <p>
                    This is the beginning of your conversation with{" "}
                    <strong>{conversation.name}</strong>.
                  </p>
                  {callLabel(conversation, user.id) && (
                    <p className="call-history">
                      {callLabel(conversation, user.id)}
                      {conversation.call_created
                        ? " · " +
                          messageDate(
                            conversation.call_created,
                          ).toLocaleString()
                        : ""}
                    </p>
                  )}
                </div>
                {more && (
                  <button
                    className="load-older"
                    disabled={olderLoading}
                    onClick={older}
                  >
                    {olderLoading ? "Loading…" : "Load earlier messages"}
                  </button>
                )}
                {messages.map((m, i) => (
                  <div key={m.id}>
                    {(i === 0 ||
                      messageDate(messages[i - 1].created).toDateString() !==
                        messageDate(m.created).toDateString()) && (
                      <div className="day-divider">
                        {messageDate(m.created).toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    )}
                    <article className="message">
                      <Initial name={m.name} />
                      <div className="message-body">
                        <strong>{m.name}</strong>
                        {m.sender === user.id && (
                          <span className="tag">YOU</span>
                        )}
                        <time dateTime={messageDate(m.created).toISOString()}>
                          {messageDate(m.created).toLocaleTimeString(
                            undefined,
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </time>
                        {isImageMessage(m.body)?<ImagePreview src={imageSource(m.body)} spoiler={isSpoilerImage(m.body)}/>:<p>{m.body}</p>}
                      </div>
                      <MessageMenu id={m.id} body={m.body} own={m.sender===user.id} onReply={()=>setDraft(`@${m.name} `)} onDelete={async()=>{try{await request("/api/direct",{action:"delete-message",id:m.id});setMessages(old=>old.filter(item=>item.id!==m.id));await refresh()}catch(e){setError((e as Error).message)}}} onReport={()=>setError("Message reported for review.")}/>
                    </article>
                  </div>
                ))}
                {!messages.length && (
                  <div className="dm-first-message">
                    <MessageCircle size={18} />
                    <span>A simple hello goes a long way.</span>
                  </div>
                )}
                <div ref={bottom} />
              </>
            ) : (
              <div className="dm-welcome">
                <div className="dm-welcome-icon">
                  <MessageCircle size={42} />
                </div>
                <span className="eyebrow">NO SERVER NEEDED</span>
                <h1>
                  Good conversations
                  <br />
                  start with hello.
                </h1>
                <p>
                  Send a message, catch up on a voice call,
                  <br />
                  or see a familiar face. Just you and your people.
                </p>
                <button className="primary" onClick={newMessage}>
                  Start a conversation <ArrowRight size={18} />
                </button>
                <div className="dm-ways">
                  <span>
                    <MessageCircle size={18} /> Message
                  </span>
                  <span>
                    <Phone size={18} /> Voice
                  </span>
                  <span>
                    <Video size={19} /> Video
                  </span>
                </div>
                {loading && (
                  <p className="loading-text" role="status">
                    Loading your conversations…
                  </p>
                )}
              </div>
            )}
          </div>
          {conversation && (
            <div className="composer-wrap">
              {attachment&&<AttachmentDraft source={imageSource(attachment)} name={attachmentName} spoiler={attachmentSpoiler} onSpoiler={()=>setAttachmentSpoiler(!attachmentSpoiler)} onRemove={()=>{setAttachment("");setAttachmentName("");setAttachmentSpoiler(false)}} onReplace={async(file)=>{setSending(true);try{setAttachment(await compressChatImage(file));setAttachmentName(file.name)}catch(error){setError((error as Error).message)}finally{setSending(false)}}}/>}
              <form className="composer" onSubmit={send}>
                <label className="attach-image" title="Attach an image" aria-label="Attach an image"><ImagePlus size={19}/><input className="chat-image-input" type="file" accept="image/*" disabled={sending} onChange={async(e)=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setSending(true);try{setAttachment(await compressChatImage(file));setAttachmentName(file.name)}catch(error){setError((error as Error).message)}finally{setSending(false)}}}/></label>
                <textarea
                  rows={1}
                  aria-label={"Message " + conversation.name}
                  placeholder={"Message @" + conversation.name}
                  maxLength={4000}
                  value={draft}
                  disabled={sending}
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
                  aria-label="Send direct message"
                  disabled={sending || (!draft.trim()&&!attachment)}
                >
                  <ArrowUp size={20} />
                </button>
              </form>
              <div className="composer-hint">
                Enter to send · Shift + Enter for a new line
              </div>
            </div>
          )}
        </main>
      </div>
      <Dialog
        open={dialog}
        onOpenChange={(v) => {
          if (!starting) setDialog(v);
        }}
      >
        <DialogContent className="aemeath-dialog">
          <DialogTitle>Start a conversation</DialogTitle>
          <DialogDescription>
            Find someone by their exact Aemeath username.
          </DialogDescription>
          <label className="form-label" htmlFor="find-username">
            Username
          </label>
          <input
            id="find-username"
            className="form-input"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. alex"
            maxLength={24}
          />
          <div className="people-results" aria-live="polite">
            {searching ? (
              <p>Looking for your person…</p>
            ) : people.length ? (
              people.map((p) => (
                <button
                  disabled={starting}
                  key={p.id}
                  className="search-person"
                  onClick={() => start(p.id)}
                >
                  <Initial name={p.name} />
                  <strong>{p.name}</strong>
                  <span>
                    {starting ? "Opening…" : "Message"} <ArrowRight size={16} />
                  </span>
                </button>
              ))
            ) : search.trim().length >= 3 ? (
              <p>No account with that username yet.</p>
            ) : (
              <p>Enter at least 3 characters.</p>
            )}
          </div>
          {searchError && (
            <p className="form-error" role="alert">
              {searchError}
            </p>
          )}
          <p className="muted-text">
            Your friend needs a Aemeath account and access to this private site.
          </p>
        </DialogContent>
      </Dialog>
      </SidebarProvider>
      </div>
      {voiceStatus&&<div className="global-voice-status">
        <button className="global-voice-return" onClick={()=>{writeNavigationMemory(user.id,{view:"server",server:voiceStatus.serverId,channel:voiceStatus.channelId});setServerView(voiceStatus.serverId)}} aria-label={`Return to ${voiceStatus.channelName} voice channel`}>
          <span className="global-voice-status-icon"><Volume2 size={18}/></span>
          <span><strong>Voice Connected</strong><small>{voiceStatus.serverName} / {voiceStatus.channelName}</small></span>
        </button>
        <span className="global-voice-actions"><button className={voiceStatus.muted?"off":""} aria-label={voiceStatus.muted?"Unmute microphone":"Mute microphone"} onClick={voiceStatus.toggleMute}>{voiceStatus.muted?<MicOff size={17}/>:<Mic size={17}/>}</button><button className={voiceStatus.deafened?"off":""} aria-label={voiceStatus.deafened?"Undeafen":"Deafen"} onClick={voiceStatus.toggleDeafen}>{voiceStatus.deafened?<VolumeX size={17}/>:<Volume2 size={17}/>}</button></span>
      </div>}
    </>
  );
}
function AttachmentDraft({source,name,spoiler,onSpoiler,onRemove,onReplace}:{source:string;name:string;spoiler:boolean;onSpoiler:()=>void;onRemove:()=>void;onReplace:(file:File)=>void}){return <div className="attachment-draft"><div className="attachment-tools"><button type="button" title={spoiler?"Remove spoiler":"Mark as spoiler"} onClick={onSpoiler}>{spoiler?<EyeOff size={17}/>:<Eye size={17}/>}</button><label title="Replace image"><Pencil size={16}/><input className="chat-image-input" type="file" accept="image/*" onChange={(e)=>{const file=e.target.files?.[0];e.target.value="";if(file)onReplace(file)}}/></label><button type="button" className="remove" title="Remove image" onClick={onRemove}><Trash2 size={17}/></button></div><div className={spoiler?"draft-image spoiler":"draft-image"}><img src={source} alt="Attachment preview"/></div><span>{name||"image.webp"}</span></div>}
export default function Communication({
  user,
  onSettings,
}: {
  user: LocalUser;
  onSettings: () => void;
}) {
  return (
    <CallProvider user={user}>
      <Inbox user={user} onSettings={onSettings} />
    </CallProvider>
  );
}


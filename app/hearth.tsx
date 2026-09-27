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
} from "lucide-react";
import VoiceRoom from "./voice-room";
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
type Server = { id: string; name: string; owner: string };
type Channel = {
  id: string;
  name: string;
  kind?: "text" | "voice" | "forum";
  topic?: string;
};
type Member = { id: string; name: string };
type Message = {
  id: string;
  user: string;
  name: string;
  body: string;
  created: number;
};
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
export default function Hearth({
  user,
  onSettings,
  onDirect,
  initialServer,
  startCreate = false,
}: {
  user: LocalUser;
  onSettings: () => void;
  onDirect: () => void;
  initialServer: string;
  startCreate?: boolean;
}) {
  const [servers, setServers] = useState<Server[]>([]),
    [selected, setSelected] = useState(initialServer),
    [channels, setChannels] = useState<Channel[]>([]),
    [current, setCurrent] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
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
  const [voiceChat, setVoiceChat] = useState(false);
  const [channelType, setChannelType] = useState<"text" | "voice" | "forum">(
      "text",
    ),
    [channelTopic, setChannelTopic] = useState(""),
    [editingChannel, setEditingChannel] = useState("");
  const end = useRef<HTMLDivElement>(null),
    room = useRef(""),
    serverRef = useRef(""),
    pending = useRef<{ id: string; body: string; channel: string } | null>(
      null,
    ),
    messageCount = useRef(0);
  const server = servers.find((s) => s.id === selected),
    channel = channels.find((c) => c.id === current),
    isVoice = channel?.kind === "voice",
    owner = server?.owner === user?.id;
  const open = (type: string) => {
    setFormError("");
    setField(type === "profile" ? name : "");
    setCode("");
    setCopied(false);
    setModal(type);
  };
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
    setSelected((old) => preferred || old || data.servers[0]?.id || "");
  }, []);
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      setModal("join");
      setField(invite);
    }
    if (!user) return;
    refreshServers()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, refreshServers]);
  useEffect(() => {
    serverRef.current = selected;
    setChannels([]);
    setMembers([]);
    setCurrent("");
    setMessages([]);
    if (!selected) return;
    let alive = true;
    setChannelLoading(true);
    const load = async () => {
      try {
        const d = await api("?server=" + encodeURIComponent(selected));
        if (alive) {
          setChannels(d.channels);
          setMembers(d.members);
          setCurrent((old) =>
            d.channels.some((c: Channel) => c.id === old)
              ? old
              : d.channels[0]?.id || "",
          );
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setChannelLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);
  useEffect(() => {
    room.current = current;
    setMessages([]);
    setDraft("");
    pending.current = null;
    messageCount.current = 0;
    if (!current) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await api("?channel=" + encodeURIComponent(current));
        if (alive) {
          setMessages(d.messages);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [current]);
  useEffect(() => {
    if (messages.length !== messageCount.current) {
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      messageCount.current = messages.length;
    }
  }, [messages]);
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
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || sending || !current) return;
    const target = current,
      body = draft.trim();
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
        pending.current = null;
        const d = await api("?channel=" + encodeURIComponent(target));
        if (room.current === target) setMessages(d.messages);
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
    <SidebarProvider>
      <div className="hearth-app">
        <nav className="server-rail" aria-label="Servers">
          <div className="brand-icon" title="Hearth">
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
          {servers.length ? (
            servers.map((s) => (
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
                {initials(s.name)}
              </button>
            ))
          ) : (
            <div className="server-icon active">
              <MessageCircle />
            </div>
          )}
          <button
            className="server-icon add"
            title="Create or join a server"
            aria-label="Create or join a server"
            onClick={() => open("picker")}
          >
            <Plus />
          </button>
          <span className="rail-footer">h</span>
        </nav>
        <Sidebar
          collapsible="none"
          className={"channel-sidebar " + (!mobile ? "mobile-hidden" : "")}
        >
          <SidebarContent>
            <header className="server-title">
              <span>{server?.name || "Your space"}</span>
              <button
                aria-label="Close channels"
                onClick={() => setMobile(false)}
              >
                {mobile ? <X size={17} /> : <Lock size={15} />}
              </button>
            </header>
            <div className="server-intro">
              <span className="eyebrow">A LITTLE CLOSER</span>
              <h2>
                Good company.
                <br />
                Your own corner.
              </h2>
              <span>Make yourself at home.</span>
            </div>
            {server && owner && (
              <button className="invite-row" onClick={invite}>
                <UserPlus size={16} /> Invite your people
              </button>
            )}
            <div className="channel-group">
              <span>TEXT CHANNELS</span>
              {owner && (
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
                    {owner && (
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
              {owner && (
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
                <button
                  className={"channel " + (c.id === current ? "active" : "")}
                  key={c.id}
                  onClick={() => {
                    setCurrent(c.id);
                    setMobile(false);
                  }}
                >
                  <Volume2 size={19} />
                  {c.name}
                  {owner && (
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
              ))}
            <div className="sidebar-bottom">
              <Lock size={14} /> Private by invitation
            </div>
          </SidebarContent>
          <div className="user-bar">
            <div className="avatar">{initials(name)}</div>
            <div>
              <strong>{name}</strong>
              <small>{user ? "Signed in" : "Sign in to connect"}</small>
            </div>
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
          {isVoice && channel ? <VoiceRoom channel={channel.id} name={channel.name} user={{id:user.id,name}}/> : <div className="conversation">
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
                      Welcome to Hearth <span className="tag">YOUR SPACE</span>
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
                  {owner && members.length === 1 && (
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
                      new Date(messages[i - 1].created).toLocaleDateString() !==
                        new Date(m.created).toLocaleDateString()) && (
                      <div className="day-divider">
                        {new Date(m.created).toLocaleDateString(undefined, {
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
                        <time dateTime={new Date(m.created).toISOString()}>
                          {new Date(m.created).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        <p>{m.body}</p>
                      </div>
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
              <div className="voice-chat-title"><MessageCircle size={17}/><strong>Channel chat</strong><button aria-label="Close channel chat" onClick={()=>setVoiceChat(false)}><X size={17}/></button></div>
              {messages.length ? messages.map((m)=><article className="voice-chat-message" key={m.id}><div className="avatar">{initials(m.name||"Member")}</div><div><strong>{m.name||"Member"}</strong><time>{new Date(m.created).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</time><p>{m.body}</p></div></article>) : <div className="voice-chat-empty">Chat while you hang out in voice.</div>}
            </div>}
            <form
              className={"composer " + (!current ? "disabled" : "")}
              onSubmit={send}
            >
              <Hash size={19} />
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
                disabled={!current || !draft.trim() || sending}
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
              <div className="member" key={m.id}>
                <div className="avatar">{initials(m.name || "Member")}</div>
                <div className="member-name">
                  {m.name || "Member"}
                  <small>
                    {m.id === server?.owner ? "Server owner" : "Member"}
                    {m.id === user?.id ? " · You" : ""}
                  </small>
                </div>
              </div>
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
        </aside>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!busy && !v) setModal("");
        }}
      >
        <DialogContent className="hearth-dialog">
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
                    <input
                      id="invite-url"
                      className="form-input"
                      readOnly
                      value={code}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="primary"
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
                      {copied ? "Copied" : "Copy invitation"}
                    </button>
                    <p className="muted-text">
                      Friends need a Hearth account and access to this private
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
                onChange={(e) => setField(e.target.value)}
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
  );
}

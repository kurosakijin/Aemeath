"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff, MonitorUp, PhoneOff, Users } from "lucide-react";

type Person = { id: string; name: string };
type Signal = { id: string; from: string; body: string; created: number };
type Remote = Person & { stream: MediaStream };

async function post(channel: string, data: Record<string, unknown>) {
  const response = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, ...data }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(result.error || "The voice room is unavailable.");
  return result;
}

export default function VoiceRoom({ channel, name, user }: { channel: string; name: string; user: Person }) {
  const [joined, setJoined] = useState(false), [members, setMembers] = useState<Person[]>([]),
    [remotes, setRemotes] = useState<Remote[]>([]), [muted, setMuted] = useState(false),
    [camera, setCamera] = useState(false), [sharing, setSharing] = useState(false),
    [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const local = useRef<MediaStream | null>(null), localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()), names = useRef(new Map<string, string>()),
    after = useRef(Date.now()), alive = useRef(true), ice = useRef<RTCIceServer[]>([]);

  const signal = useCallback((to: string, body: unknown) => post(channel, { action: "signal", to, body: JSON.stringify(body) }), [channel]);
  const closePeer = useCallback((id: string) => {
    peers.current.get(id)?.close(); peers.current.delete(id);
    setRemotes((old) => old.filter((r) => r.id !== id));
  }, []);
  const makePeer = useCallback((person: Person) => {
    const existing = peers.current.get(person.id); if (existing) return existing;
    names.current.set(person.id, person.name);
    const pc = new RTCPeerConnection({ iceServers: ice.current }); peers.current.set(person.id, pc);
    local.current?.getTracks().forEach((track) => pc.addTrack(track, local.current!));
    pc.onicecandidate = (event) => { if (event.candidate) void signal(person.id, { type: "candidate", candidate: event.candidate }); };
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemotes((old) => [...old.filter((r) => r.id !== person.id), { ...person, stream }]);
    };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) closePeer(person.id); };
    return pc;
  }, [closePeer, signal]);
  const offer = useCallback(async (person: Person) => {
    const pc = makePeer(person); if (pc.signalingState !== "stable") return;
    await pc.setLocalDescription(await pc.createOffer());
    await signal(person.id, { type: "description", description: pc.localDescription });
  }, [makePeer, signal]);
  const handleSignal = useCallback(async (item: Signal) => {
    const message = JSON.parse(item.body), person = { id: item.from, name: names.current.get(item.from) || "Member" }, pc = makePeer(person);
    if (message.type === "candidate") { try { await pc.addIceCandidate(message.candidate); } catch {} return; }
    if (message.type !== "description") return;
    const description = message.description as RTCSessionDescriptionInit;
    if (description.type === "offer") {
      if (pc.signalingState !== "stable") { await pc.setLocalDescription({ type: "rollback" }); }
      await pc.setRemoteDescription(description); await pc.setLocalDescription(await pc.createAnswer());
      await signal(item.from, { type: "description", description: pc.localDescription });
    } else if (description.type === "answer" && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(description);
  }, [makePeer, signal]);

  const leave = useCallback(async () => {
    if (!joined && !local.current) return;
    setJoined(false); local.current?.getTracks().forEach((track) => track.stop()); local.current = null;
    peers.current.forEach((pc) => pc.close()); peers.current.clear(); setRemotes([]); setCamera(false); setSharing(false);
    try { await post(channel, { action: "leave" }); } catch {}
  }, [channel, joined]);
  useEffect(() => () => { alive.current = false; local.current?.getTracks().forEach((t) => t.stop()); peers.current.forEach((p) => p.close()); void post(channel, { action: "leave" }); }, [channel]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = local.current; }, [camera, sharing, joined]);
  useEffect(() => {
    if (!joined) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${after.current}`, { cache: "no-store" });
        const data = await response.json() as Record<string, any>; if (!response.ok) throw new Error(data.error);
        after.current = data.now || Date.now(); const list = (data.members || []) as Person[]; setMembers(list); list.forEach((p) => names.current.set(p.id, p.name));
        for (const item of (data.signals || []) as Signal[]) await handleSignal(item);
        for (const p of list) if (p.id !== user.id && !peers.current.has(p.id) && user.id < p.id) await offer(p);
        for (const id of [...peers.current.keys()]) if (!list.some((p) => p.id === id)) closePeer(id);
      } catch (e) { if (alive.current) setError((e as Error).message || "Could not refresh the voice room."); }
    };
    void poll(); const timer = setInterval(() => { void post(channel, { action: "heartbeat" }); void poll(); }, 1500);
    return () => clearInterval(timer);
  }, [channel, joined, user.id, offer, handleSignal, closePeer]);

  async function join() {
    setBusy(true); setError("");
    try {
      const config = await fetch("/api/calls?config=1").then((r) => r.json()) as Record<string, any>; ice.current = config.iceServers || [];
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      after.current = Date.now(); await post(channel, { action: "join" }); setMembers([user]); setJoined(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Microphone access is required to join."); local.current?.getTracks().forEach((t) => t.stop()); local.current = null; }
    finally { setBusy(false); }
  }
  async function renegotiate() { for (const p of members) if (p.id !== user.id) await offer(p); }
  async function toggleCamera() {
    if (!local.current) return;
    const old = local.current.getVideoTracks().find((t) => t.label !== "screen");
    if (old) { old.stop(); local.current.removeTrack(old); peers.current.forEach((pc) => pc.getSenders().find((s) => s.track === old)?.replaceTrack(null)); setCamera(false); return; }
    try { const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }); const track = media.getVideoTracks()[0]; local.current.addTrack(track); peers.current.forEach((pc) => pc.addTrack(track, local.current!)); setCamera(true); await renegotiate(); } catch (e) { setError((e as Error).message); }
  }
  async function shareScreen() {
    if (!local.current || sharing) return;
    try { const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); const track = media.getVideoTracks()[0]; track.addEventListener("ended", () => setSharing(false)); local.current.addTrack(track); peers.current.forEach((pc) => pc.addTrack(track, local.current!)); setSharing(true); await renegotiate(); } catch (e) { if ((e as DOMException).name !== "NotAllowedError") setError((e as Error).message); }
  }
  return <section className="voice-room">
    {!joined ? <div className="voice-empty"><div className="voice-orb"><VolumeIcon /></div><h1>{name}</h1><p>No one is currently in voice</p><button className="voice-join" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join Voice"}</button></div> : <>
      <div className="voice-grid">
        <div className="voice-tile local"><video ref={localVideo} autoPlay muted playsInline className={camera || sharing ? "" : "hidden"}/><div className="voice-avatar">{user.name.slice(0,2).toUpperCase()}</div><span>{user.name} · You</span></div>
        {remotes.map((remote) => <div className="voice-tile" key={remote.id}><RemoteVideo stream={remote.stream}/><div className="voice-avatar">{remote.name.slice(0,2).toUpperCase()}</div><span>{remote.name}</span></div>)}
      </div>
      <div className="voice-status"><Users size={15}/> {members.length} connected</div>
      <div className="voice-controls"><button className={muted ? "off" : ""} aria-label={muted ? "Unmute" : "Mute"} onClick={() => { const next=!muted; local.current?.getAudioTracks().forEach((t)=>t.enabled=!next); setMuted(next); }}>{muted?<MicOff/>:<Mic/>}</button><button className={camera ? "active" : ""} aria-label="Toggle camera" onClick={toggleCamera}>{camera?<Camera/>:<CameraOff/>}</button><button className={sharing ? "active" : ""} aria-label="Share gameplay or screen" onClick={shareScreen}><MonitorUp/></button><button className="hangup" aria-label="Leave voice" onClick={leave}><PhoneOff/></button></div>
    </>}
    {error && <div className="voice-error" role="alert">{error}</div>}
  </section>;
}
function RemoteVideo({ stream }: { stream: MediaStream }) { const ref=useRef<HTMLVideoElement>(null); useEffect(()=>{ if(ref.current) ref.current.srcObject=stream; },[stream]); return <video ref={ref} autoPlay playsInline/>; }
function VolumeIcon(){ return <span aria-hidden>◖))</span>; }

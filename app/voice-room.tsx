"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Users, X } from "lucide-react";

type Person = { id: string; name: string };
type Signal = { id: string; from: string; body: string; created: number };
type Remote = Person & { stream: MediaStream };
type DeviceOption = { deviceId: string; label: string };

let roomAudio: AudioContext | null = null;
function roomTone(kind: "join" | "leave") {
  try {
    roomAudio ??= new AudioContext();
    void roomAudio.resume();
    const now = roomAudio.currentTime + .015,
      master = roomAudio.createGain(),
      notes = kind === "join" ? [392, 523.25, 659.25] : [523.25, 392];
    master.gain.setValueAtTime(.0001, now);
    master.gain.exponentialRampToValueAtTime(.12, now + .025);
    master.gain.exponentialRampToValueAtTime(.0001, now + .52);
    master.connect(roomAudio.destination);
    notes.forEach((frequency, index) => {
      const oscillator = roomAudio!.createOscillator(), shimmer = roomAudio!.createGain(), start = now + index * .075;
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === "join" ? 1.018 : .985), start + .24);
      shimmer.gain.setValueAtTime(.0001, start);
      shimmer.gain.exponentialRampToValueAtTime(index === 0 ? .7 : .42, start + .018);
      shimmer.gain.exponentialRampToValueAtTime(.0001, start + .34);
      oscillator.connect(shimmer).connect(master); oscillator.start(start); oscillator.stop(start + .36);
    });
  } catch { /* Sound is optional when a browser blocks audio. */ }
}

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
    [error, setError] = useState(""), [busy, setBusy] = useState(false), [settings, setSettings] = useState(false),
    [microphones, setMicrophones] = useState<DeviceOption[]>([]), [cameras, setCameras] = useState<DeviceOption[]>([]),
    [speakers, setSpeakers] = useState<DeviceOption[]>([]), [micId, setMicId] = useState("default"),
    [cameraId, setCameraId] = useState("default"), [speakerId, setSpeakerId] = useState("default"),
    [echoCancellation, setEchoCancellation] = useState(true), [noiseSuppression, setNoiseSuppression] = useState(true),
    [sensitivity, setSensitivity] = useState(55);
  const local = useRef<MediaStream | null>(null), localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()), names = useRef(new Map<string, string>()),
    after = useRef(Date.now()), alive = useRef(true), ice = useRef<RTCIceServer[]>([]), knownMembers = useRef<Set<string> | null>(null),
    screenTrack = useRef<MediaStreamTrack | null>(null), cameraTrack = useRef<MediaStreamTrack | null>(null);

  const signal = useCallback((to: string, body: unknown) => post(channel, { action: "signal", to, body: JSON.stringify(body) }), [channel]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const options = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === "audioinput" ? "Microphone" : kind === "audiooutput" ? "Speaker" : "Camera"} ${i + 1}` }));
    setMicrophones(options("audioinput")); setSpeakers(options("audiooutput")); setCameras(options("videoinput"));
  }, []);
  const closePeer = useCallback((id: string) => {
    peers.current.get(id)?.close(); peers.current.delete(id);
    setRemotes((old) => old.filter((r) => r.id !== id));
  }, []);
  const makePeer = useCallback((person: Person) => {
    const existing = peers.current.get(person.id); if (existing) return existing;
    names.current.set(person.id, person.name);
    const pc = new RTCPeerConnection({ iceServers: ice.current }); peers.current.set(person.id, pc);
    local.current?.getAudioTracks().forEach((track) => pc.addTrack(track, local.current!));
    const activeVideo=screenTrack.current||cameraTrack.current;
    if(activeVideo)pc.addTrack(activeVideo,new MediaStream([activeVideo]));
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
    roomTone("leave");
    setJoined(false); local.current?.getTracks().forEach((track) => track.stop()); local.current = null;
    peers.current.forEach((pc) => pc.close()); peers.current.clear(); knownMembers.current = null; setRemotes([]); setCamera(false); setSharing(false);
    try { await post(channel, { action: "leave" }); } catch {}
  }, [channel, joined]);
  useEffect(() => () => { alive.current = false; local.current?.getTracks().forEach((t) => t.stop()); peers.current.forEach((p) => p.close()); void post(channel, { action: "leave" }); }, [channel]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = sharing&&screenTrack.current?new MediaStream([screenTrack.current]):local.current; }, [camera, sharing, joined]);
  useEffect(() => {
    if (joined) return;
    let active=true;
    const watch=async()=>{try{const response=await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${Date.now()}`,{cache:"no-store"}),data=await response.json() as Record<string,any>;if(active&&response.ok)setMembers((data.members||[]) as Person[]);}catch{/* Keep the room usable if presence refresh is interrupted. */}};
    void watch();const timer=setInterval(watch,2000);return()=>{active=false;clearInterval(timer)};
  },[channel,joined]);
  useEffect(() => {
    if (!joined) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${after.current}`, { cache: "no-store" });
        const data = await response.json() as Record<string, any>; if (!response.ok) throw new Error(data.error);
        after.current = data.now || Date.now(); const list = (data.members || []) as Person[], nextMembers = new Set(list.map((p) => p.id));
        if (knownMembers.current) {
          if (list.some((p) => p.id !== user.id && !knownMembers.current!.has(p.id))) roomTone("join");
          if ([...knownMembers.current].some((id) => id !== user.id && !nextMembers.has(id))) roomTone("leave");
        }
        knownMembers.current = nextMembers; setMembers(list); list.forEach((p) => names.current.set(p.id, p.name));
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
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation, noiseSuppression, deviceId: micId === "default" ? undefined : { exact: micId } }, video: false });
      await refreshDevices();
      after.current = Date.now(); await post(channel, { action: "join" }); knownMembers.current = new Set([user.id]); setMembers([user]); setJoined(true); roomTone("join");
    } catch (e) { setError(e instanceof Error ? e.message : "Microphone access is required to join."); local.current?.getTracks().forEach((t) => t.stop()); local.current = null; }
    finally { setBusy(false); }
  }
  async function renegotiate() { for (const p of members) if (p.id !== user.id) await offer(p); }
  async function toggleCamera() {
    if (!local.current) return;
    const old = cameraTrack.current;
    if (old) { old.stop(); local.current.removeTrack(old);cameraTrack.current=null;if(!sharing)peers.current.forEach((pc) => pc.getSenders().find((s) => s.track === old)?.replaceTrack(null)); setCamera(false); return; }
    try { const media = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cameraId === "default" ? undefined : { exact: cameraId }, facingMode: cameraId === "default" ? "user" : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } }); const track = media.getVideoTracks()[0]; cameraTrack.current=track; local.current.addTrack(track); peers.current.forEach((pc) => pc.addTrack(track, local.current!)); setCamera(true); await refreshDevices(); await renegotiate(); } catch (e) { setError((e as Error).message); }
  }
  async function changeMicrophone(id: string) {
    setMicId(id); if (!local.current) return;
    try { const media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id==="default"?undefined:{exact:id},echoCancellation,noiseSuppression},video:false}), next=media.getAudioTracks()[0], old=local.current.getAudioTracks()[0]; local.current.removeTrack(old); old?.stop(); local.current.addTrack(next); await Promise.all([...peers.current.values()].map(async(pc)=>{const sender=pc.getSenders().find((s)=>s.track?.kind==="audio"); if(sender) await sender.replaceTrack(next);})); } catch(e){setError((e as Error).message);}
  }
  async function changeCamera(id: string) { setCameraId(id); if (!camera || !local.current) return; const old=cameraTrack.current; try { const media=await navigator.mediaDevices.getUserMedia({video:{deviceId:id==="default"?undefined:{exact:id},facingMode:id==="default"?"user":undefined,width:{ideal:1280},height:{ideal:720}},audio:false}), next=media.getVideoTracks()[0]; cameraTrack.current=next;if(old)local.current.removeTrack(old);old?.stop();local.current.addTrack(next);if(!sharing)await Promise.all([...peers.current.values()].map(async(pc)=>{const sender=pc.getSenders().find((s)=>s.track?.kind==="video");if(sender)await sender.replaceTrack(next);}));setCamera(true); } catch(e){setError((e as Error).message);}}
  async function shareScreen() {
    if (!local.current || sharing) return;
    try {
      const media=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:60}},audio:true}),track=media.getVideoTracks()[0];screenTrack.current=track;
      const restore=async()=>{if(screenTrack.current!==track)return;screenTrack.current=null;local.current?.removeTrack(track);setSharing(false);const camera=cameraTrack.current;await Promise.all([...peers.current.values()].map(async(pc)=>{const sender=pc.getSenders().find((s)=>s.track===track||s.track?.kind==="video");if(sender)await sender.replaceTrack(camera&&camera.readyState==="live"?camera:null)}));track.stop();setLocalPreview();};
      track.addEventListener("ended",()=>{void restore()},{once:true});
      const senders=[...peers.current.values()].map((pc)=>pc.getSenders().find((s)=>s.track?.kind==="video"));
      local.current.addTrack(track);let added=false;
      await Promise.all([...peers.current.values()].map(async(pc)=>{const sender=pc.getSenders().find((s)=>s.track?.kind==="video");if(sender)await sender.replaceTrack(track);else{pc.addTrack(track,media);added=true;}}));
      setSharing(true);setLocalPreview(media);if(added)await renegotiate();
    } catch (e) { if ((e as DOMException).name !== "NotAllowedError") setError((e as Error).message); }
  }
  function setLocalPreview(stream:MediaStream|null=local.current){if(localVideo.current)localVideo.current.srcObject=stream}
  return <section className="voice-room">
    {!joined ? <div className="voice-empty"><div className="voice-orb"><VolumeIcon /></div><h1>{name}</h1><p>{members.length?`${members.length} ${members.length===1?"person is":"people are"} in voice`:"No one is currently in voice"}</p>{members.length>0&&<div className="voice-waiting-members">{members.map((person)=><div key={person.id}><span>{person.name.slice(0,2).toUpperCase()}</span><strong>{person.name}</strong><i>Connected</i></div>)}</div>}<button className="voice-join" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join Voice"}</button></div> : <>
      <div className="voice-grid">
        <div className="voice-tile local"><video ref={localVideo} autoPlay muted playsInline className={camera || sharing ? "" : "hidden"}/><div className="voice-avatar">{user.name.slice(0,2).toUpperCase()}</div><span>{user.name} · You</span></div>
        {remotes.map((remote) => <div className="voice-tile" key={remote.id}><RemoteVideo stream={remote.stream} speakerId={speakerId}/><div className="voice-avatar">{remote.name.slice(0,2).toUpperCase()}</div><span>{remote.name}</span></div>)}
      </div>
      <div className="voice-status"><Users size={15}/> {members.length} connected</div>
      <div className="voice-controls"><button className={muted ? "off" : ""} aria-label={muted ? "Unmute" : "Mute"} onClick={() => { const next=!muted; local.current?.getAudioTracks().forEach((t)=>t.enabled=!next); setMuted(next); }}>{muted?<MicOff/>:<Mic/>}</button><button className={camera ? "active" : ""} aria-label="Toggle camera" onClick={toggleCamera}>{camera?<Camera/>:<CameraOff/>}</button><button className={sharing ? "active" : ""} aria-label="Share gameplay or screen" onClick={shareScreen}><MonitorUp/></button><button className={settings ? "active" : ""} aria-label="Voice settings" onClick={()=>{setSettings(!settings);void refreshDevices();}}><Settings/></button><button className="hangup" aria-label="Leave voice" onClick={leave}><PhoneOff/></button></div>
      {settings && <aside className="voice-settings"><header><div><strong>Voice & video</strong><small>Choose how you join the room</small></div><button aria-label="Close voice settings" onClick={()=>setSettings(false)}><X size={18}/></button></header><label>Input device<select value={micId} onChange={(e)=>void changeMicrophone(e.target.value)}><option value="default">System default</option>{microphones.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Output device<select value={speakerId} onChange={(e)=>setSpeakerId(e.target.value)}><option value="default">System default</option>{speakers.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Camera<select value={cameraId} onChange={(e)=>void changeCamera(e.target.value)}><option value="default">System default</option>{cameras.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label className="voice-range">Input sensitivity <span>{sensitivity}%</span><input type="range" min="0" max="100" value={sensitivity} onChange={(e)=>setSensitivity(Number(e.target.value))}/></label><label className="voice-switch"><span><strong>Echo cancellation</strong><small>Reduce sound coming back through your microphone.</small></span><input type="checkbox" checked={echoCancellation} onChange={(e)=>setEchoCancellation(e.target.checked)}/></label><label className="voice-switch"><span><strong>Noise suppression</strong><small>Reduce fans, keyboards, and background noise.</small></span><input type="checkbox" checked={noiseSuppression} onChange={(e)=>setNoiseSuppression(e.target.checked)}/></label><p className="voice-settings-note">Device names appear after microphone or camera permission is allowed.</p></aside>}
    </>}
    {error && <div className="voice-error" role="alert">{error}</div>}
  </section>;
}
function RemoteVideo({ stream, speakerId }: { stream: MediaStream; speakerId: string }) { const ref=useRef<HTMLVideoElement>(null); useEffect(()=>{ if(ref.current) ref.current.srcObject=stream; const video=ref.current as (HTMLVideoElement & {setSinkId?:(id:string)=>Promise<void>})|null; if(video?.setSinkId) void video.setSinkId(speakerId).catch(()=>{}); },[stream,speakerId]); return <video ref={ref} autoPlay playsInline/>; }
function VolumeIcon(){ return <span aria-hidden>◖))</span>; }

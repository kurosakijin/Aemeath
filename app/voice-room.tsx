"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Settings, Users, X } from "lucide-react";

type Person = { id: string; name: string; reconnecting?:number|boolean; left_at?:number };
type Signal = { id: string; from: string; body: string; created: number };
type Remote = Person & { stream: MediaStream };
type DeviceOption = { deviceId: string; label: string };
type HistoryItem={id:string;name:string;event:"joined"|"left"|"rejoined";created:number};
type StreamQuality = "1080" | "1440";

async function tuneVideoSender(sender: RTCRtpSender | undefined, fps: number, quality: StreamQuality) {
  if (!sender) return;
  try {
    const parameters=sender.getParameters();
    parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];
    const encoding=parameters.encodings[0] as RTCRtpEncodingParameters & {maxFramerate?:number;networkPriority?:string;priority?:string};
    encoding.maxBitrate=quality==="1440"?20_000_000:12_000_000;
    encoding.maxFramerate=fps;
    encoding.scaleResolutionDownBy=1;
    encoding.networkPriority="high";encoding.priority="high";
    (parameters as RTCRtpSendParameters & {degradationPreference?:string}).degradationPreference="maintain-framerate";
    await sender.setParameters(parameters);
  } catch { /* Some mobile browsers manage sender quality automatically. */ }
}

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
    [sensitivity, setSensitivity] = useState(55), [remoteSharing, setRemoteSharing] = useState<Set<string>>(new Set()),
    [theaterStream, setTheaterStream] = useState(""), [streamFps,setStreamFps]=useState(60),
    [streamQuality,setStreamQuality]=useState<StreamQuality>("1080"),[history,setHistory]=useState<HistoryItem[]>([]),[clock,setClock]=useState(Date.now());
  const local = useRef<MediaStream | null>(null), localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()), names = useRef(new Map<string, string>()),
    after = useRef(Date.now()), alive = useRef(true), ice = useRef<RTCIceServer[]>([]), knownMembers = useRef<Set<string> | null>(null),
    screenTrack = useRef<MediaStreamTrack | null>(null), cameraTrack = useRef<MediaStreamTrack | null>(null),joinedRef=useRef(false);

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
    if(activeVideo){const sender=pc.addTrack(activeVideo,new MediaStream([activeVideo]));if(screenTrack.current)void tuneVideoSender(sender,streamFps,streamQuality)}
    pc.onicecandidate = (event) => { if (event.candidate) void signal(person.id, { type: "candidate", candidate: event.candidate }); };
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemotes((old) => [...old.filter((r) => r.id !== person.id), { ...person, stream }]);
    };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) closePeer(person.id); };
    return pc;
  }, [closePeer, signal, streamFps, streamQuality]);
  const offer = useCallback(async (person: Person) => {
    const pc = makePeer(person); if (pc.signalingState !== "stable") return;
    await pc.setLocalDescription(await pc.createOffer());
    await signal(person.id, { type: "description", description: pc.localDescription });
    if(screenTrack.current)await signal(person.id,{type:"stream-state",active:true});
  }, [makePeer, signal]);
  const handleSignal = useCallback(async (item: Signal) => {
    const message = JSON.parse(item.body), person = { id: item.from, name: names.current.get(item.from) || "Member" };
    if(message.type==="stream-state"){setRemoteSharing((old)=>{const next=new Set(old);if(message.active)next.add(item.from);else next.delete(item.from);return next});if(!message.active)setTheaterStream((old)=>old===item.from?"":old);return;}
    const pc = makePeer(person);
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
    setJoined(false);joinedRef.current=false; local.current?.getTracks().forEach((track) => track.stop()); local.current = null;
    peers.current.forEach((pc) => pc.close()); peers.current.clear(); knownMembers.current = null; setRemotes([]);setRemoteSharing(new Set());setTheaterStream(""); setCamera(false); setSharing(false);
    try { await post(channel, { action: "leave" }); } catch {}
  }, [channel, joined]);
  useEffect(() => () => { alive.current = false; local.current?.getTracks().forEach((t) => t.stop()); peers.current.forEach((p) => p.close()); if(joinedRef.current)void post(channel, { action: "leave" }); }, [channel]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = sharing&&screenTrack.current?new MediaStream([screenTrack.current]):local.current; }, [camera, sharing, joined]);
  useEffect(() => {
    if (joined) return;
    let active=true;
    const watch=async()=>{try{const response=await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${Date.now()}`,{cache:"no-store"}),data=await response.json() as Record<string,any>;if(active&&response.ok){setMembers((data.members||[]) as Person[]);setHistory((data.history||[]) as HistoryItem[])}}catch{/* Keep the room usable if presence refresh is interrupted. */}};
    void watch();const timer=setInterval(watch,2000);return()=>{active=false;clearInterval(timer)};
  },[channel,joined]);
  useEffect(() => {
    if (!joined) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${after.current}`, { cache: "no-store" });
        const data = await response.json() as Record<string, any>; if (!response.ok) throw new Error(data.error);
        after.current = data.now || Date.now(); const list = (data.members || []) as Person[],live=list.filter((p)=>!p.reconnecting), nextMembers = new Set(live.map((p) => p.id));setHistory((data.history||[]) as HistoryItem[]);
        if (knownMembers.current) {
          if (live.some((p) => p.id !== user.id && !knownMembers.current!.has(p.id))) roomTone("join");
          if ([...knownMembers.current].some((id) => id !== user.id && !nextMembers.has(id))) roomTone("leave");
        }
        knownMembers.current = nextMembers; setMembers(list); live.forEach((p) => names.current.set(p.id, p.name));
        for (const item of (data.signals || []) as Signal[]) await handleSignal(item);
        for (const p of live) if (p.id !== user.id && !peers.current.has(p.id) && user.id < p.id) await offer(p);
        for (const id of [...peers.current.keys()]) if (!live.some((p) => p.id === id)){closePeer(id);setRemoteSharing((old)=>{const next=new Set(old);next.delete(id);return next})}
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
      after.current = Date.now(); await post(channel, { action: "join" }); knownMembers.current = new Set([user.id]); setMembers([user]); setJoined(true);joinedRef.current=true; roomTone("join");
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
      const size=streamQuality==="1440"?{width:2560,height:1440}:{width:1920,height:1080};
      const media=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:streamFps,max:streamFps}},audio:true}),track=media.getVideoTracks()[0];
      track.contentHint="motion";await track.applyConstraints({width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:streamFps,max:streamFps}}).catch(()=>{});screenTrack.current=track;
      const restore=async()=>{if(screenTrack.current!==track)return;screenTrack.current=null;local.current?.removeTrack(track);setSharing(false);setTheaterStream("");await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:false})));const camera=cameraTrack.current;await Promise.all([...peers.current.values()].map(async(pc)=>{const sender=pc.getSenders().find((s)=>s.track===track||s.track?.kind==="video");if(sender)await sender.replaceTrack(camera&&camera.readyState==="live"?camera:null)}));track.stop();setLocalPreview();};
      track.addEventListener("ended",()=>{void restore()},{once:true});
      const senders=[...peers.current.values()].map((pc)=>pc.getSenders().find((s)=>s.track?.kind==="video"));
      local.current.addTrack(track);let added=false;
      await Promise.all([...peers.current.values()].map(async(pc)=>{let sender=pc.getSenders().find((s)=>s.track?.kind==="video");if(sender)await sender.replaceTrack(track);else{sender=pc.addTrack(track,media);added=true;}await tuneVideoSender(sender,streamFps,streamQuality)}));
      setSharing(true);setLocalPreview(media);await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:true})));if(added)await renegotiate();
    } catch (e) { if ((e as DOMException).name !== "NotAllowedError") setError((e as Error).message); }
  }
  function setLocalPreview(stream:MediaStream|null=local.current){if(localVideo.current)localVideo.current.srcObject=stream}
  return <section className="voice-room">
    {!joined ? <div className="voice-empty"><div className="voice-orb"><VolumeIcon /></div><h1>{name}</h1><p>{members.filter(m=>!m.reconnecting).length?`${members.filter(m=>!m.reconnecting).length} ${members.filter(m=>!m.reconnecting).length===1?"person is":"people are"} in voice`:"No one is currently in voice"}</p>{members.length>0&&<div className="voice-waiting-members">{members.map((person)=>{const remaining=person.reconnecting?Math.max(0,10-Math.floor((clock-Number(person.left_at||clock))/1000)):0;return <div key={person.id}><span>{person.name.slice(0,2).toUpperCase()}</span><strong>{person.name}</strong><i className={person.reconnecting?"reconnecting":""}>{person.reconnecting?`Reconnecting · ${remaining}s`:"Connected"}</i></div>})}</div>}<button className="voice-join" disabled={busy} onClick={join}>{busy ? "Joining…" : members.some(m=>m.id===user.id&&m.reconnecting)?"Rejoin Voice":"Join Voice"}</button>{history.length>0&&<div className="voice-history"><strong>Recent lobby activity</strong>{history.slice(0,6).map((item)=><div key={item.id}><span>{item.name}</span><em>{item.event==="rejoined"?"rejoined":item.event==="joined"?"joined":"left"}</em><time>{new Date(item.created).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</time></div>)}</div>}</div> : <>
      {(sharing||remoteSharing.size>0)&&<div className={"stream-deck "+(theaterStream?"theater":"")}>
        {sharing&&<StreamCard id={user.id} name={`${user.name}'s stream`} theater={theaterStream===user.id} onTheater={()=>setTheaterStream(theaterStream===user.id?"":user.id)}><TrackVideo track={screenTrack.current} muted/></StreamCard>}
        {remotes.filter((r)=>remoteSharing.has(r.id)).map((remote)=><StreamCard key={remote.id} id={remote.id} name={`${remote.name}'s stream`} theater={theaterStream===remote.id} onTheater={()=>setTheaterStream(theaterStream===remote.id?"":remote.id)}><RemoteVideo stream={remote.stream} speakerId={speakerId}/></StreamCard>)}
      </div>}
      <div className={"voice-grid "+((sharing||remoteSharing.size)?"with-streams":"")}>
        <div className="voice-tile local">{camera&&!sharing&&<video ref={localVideo} autoPlay muted playsInline/>}<div className="voice-avatar">{user.name.slice(0,2).toUpperCase()}</div>{sharing&&<span className="streaming-badge"><MonitorUp size={13}/> Streaming</span>}<span>{user.name} · You</span></div>
        {remotes.map((remote) => <div className="voice-tile" key={remote.id}>{!remoteSharing.has(remote.id)&&<RemoteVideo stream={remote.stream} speakerId={speakerId}/>}<div className="voice-avatar">{remote.name.slice(0,2).toUpperCase()}</div>{remoteSharing.has(remote.id)&&<span className="streaming-badge"><MonitorUp size={13}/> Streaming</span>}<span>{remote.name}</span></div>)}
      </div>
      <div className="voice-status"><Users size={15}/> {members.filter(m=>!m.reconnecting).length} connected</div>
      <div className="voice-controls"><button className={muted ? "off" : ""} aria-label={muted ? "Unmute" : "Mute"} onClick={() => { const next=!muted; local.current?.getAudioTracks().forEach((t)=>t.enabled=!next); setMuted(next); }}>{muted?<MicOff/>:<Mic/>}</button><button className={camera ? "active" : ""} aria-label="Toggle camera" onClick={toggleCamera}>{camera?<Camera/>:<CameraOff/>}</button><button className={sharing ? "active" : ""} aria-label="Share gameplay or screen" onClick={shareScreen}><MonitorUp/></button><button className={settings ? "active" : ""} aria-label="Voice settings" onClick={()=>{setSettings(!settings);void refreshDevices();}}><Settings/></button><button className="hangup" aria-label="Leave voice" onClick={leave}><PhoneOff/></button></div>
      {settings && <aside className="voice-settings"><header><div><strong>Voice, video & stream</strong><small>Choose how you join the room</small></div><button aria-label="Close voice settings" onClick={()=>setSettings(false)}><X size={18}/></button></header><label>Input device<select value={micId} onChange={(e)=>void changeMicrophone(e.target.value)}><option value="default">System default</option>{microphones.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Output device<select value={speakerId} onChange={(e)=>setSpeakerId(e.target.value)}><option value="default">System default</option>{speakers.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Camera<select value={cameraId} onChange={(e)=>void changeCamera(e.target.value)}><option value="default">System default</option>{cameras.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><div className="voice-stream-options"><label>Stream quality<select value={streamQuality} disabled={sharing} onChange={(e)=>setStreamQuality(e.target.value as StreamQuality)}><option value="1080">1080p · Smooth</option><option value="1440">1440p · High quality</option></select></label><label>Frame rate<select value={streamFps} disabled={sharing} onChange={(e)=>setStreamFps(Number(e.target.value))}><option value="60">60 FPS</option><option value="120">120 FPS</option></select></label></div><label className="voice-range">Input sensitivity <span>{sensitivity}%</span><input type="range" min="0" max="100" value={sensitivity} onChange={(e)=>setSensitivity(Number(e.target.value))}/></label><label className="voice-switch"><span><strong>Echo cancellation</strong><small>Reduce sound coming back through your microphone.</small></span><input type="checkbox" checked={echoCancellation} onChange={(e)=>setEchoCancellation(e.target.checked)}/></label><label className="voice-switch"><span><strong>Noise suppression</strong><small>Reduce fans, keyboards, and background noise.</small></span><input type="checkbox" checked={noiseSuppression} onChange={(e)=>setNoiseSuppression(e.target.checked)}/></label><p className="voice-settings-note">120 FPS depends on the shared display, browser, device encoder, and connection. Settings lock while a stream is live.</p></aside>}
    </>}
    {error && <div className="voice-error" role="alert">{error}</div>}
  </section>;
}
function RemoteVideo({ stream, speakerId }: { stream: MediaStream; speakerId: string }) { const ref=useRef<HTMLVideoElement>(null); useEffect(()=>{ if(ref.current) ref.current.srcObject=stream; const video=ref.current as (HTMLVideoElement & {setSinkId?:(id:string)=>Promise<void>})|null; if(video?.setSinkId) void video.setSinkId(speakerId).catch(()=>{}); },[stream,speakerId]); return <video ref={ref} autoPlay playsInline/>; }
function TrackVideo({track,muted=false}:{track:MediaStreamTrack|null;muted?:boolean}){const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{if(ref.current)ref.current.srcObject=track?new MediaStream([track]):null},[track]);return <video ref={ref} autoPlay playsInline muted={muted}/>}
function StreamCard({name,theater,onTheater,children}:{id:string;name:string;theater:boolean;onTheater:()=>void;children:React.ReactNode}){return <article className={"stream-card "+(theater?"expanded":"")}><header><span><MonitorUp size={15}/><strong>{name}</strong><b>LIVE</b></span><div><button aria-label={theater?"Exit theater view":"Open theater view"} onClick={onTheater}>{theater?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button aria-label="View fullscreen" onClick={(e)=>void(e.currentTarget.closest(".stream-card") as HTMLElement)?.requestFullscreen()}><Maximize2 size={17}/></button></div></header><div className="stream-video">{children}</div></article>}
function VolumeIcon(){ return <span aria-hidden>◖))</span>; }

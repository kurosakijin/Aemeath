"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ChevronDown, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, PhoneOff, PictureInPicture2, Settings, SwitchCamera, Users, X } from "lucide-react";
import {notifyAemeath} from "@/lib/notifications";

type Person = { id: string; name: string; reconnecting?:number|boolean; left_at?:number };
type Signal = { id: string; from: string; body: string; created: number };
type Remote = Person & { stream: MediaStream };
type DeviceOption = { deviceId: string; label: string };
type StreamQuality = "1080" | "1440";
type PeerSlots = { audio:RTCRtpSender; camera:RTCRtpSender; screen:RTCRtpSender };
function mediaPermissionDenied(error:unknown){const value=error as {name?:string;message?:string};return ["NotAllowedError","PermissionDeniedError","SecurityError"].includes(value?.name||"")||/permission|denied|not allowed|blocked/i.test(value?.message||String(error))}
async function finishIce(pc:RTCPeerConnection,timeoutMs=1800){if(pc.iceGatheringState==="complete")return;await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",change);resolve()},change=()=>{if(pc.iceGatheringState==="complete")done()},timer=setTimeout(done,timeoutMs);pc.addEventListener("icegatheringstatechange",change)})}

const cameraConstraints=(deviceId:string):MediaTrackConstraints=>({
  deviceId:["default","front","rear"].includes(deviceId)?undefined:{exact:deviceId},
  facingMode:deviceId==="rear"?{ideal:"environment"}:deviceId==="front"||deviceId==="default"?{ideal:"user"}:undefined,
  width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60},
});

async function tuneCameraSender(sender:RTCRtpSender|undefined){
  if(!sender)return;
  try{const parameters=sender.getParameters();parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];const encoding=parameters.encodings[0] as RTCRtpEncodingParameters&{networkPriority?:string;priority?:string};encoding.maxBitrate=6_000_000;encoding.maxFramerate=30;encoding.scaleResolutionDownBy=1;encoding.networkPriority="high";encoding.priority="high";(parameters as RTCRtpSendParameters&{degradationPreference?:string}).degradationPreference="maintain-resolution";await sender.setParameters(parameters)}catch{/* The browser may manage camera encoding itself. */}
}

async function tuneAudioSender(sender:RTCRtpSender|undefined){
  if(!sender)return;
  try{
    const parameters=sender.getParameters();
    parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];
    const encoding=parameters.encodings[0] as RTCRtpEncodingParameters&{networkPriority?:string;priority?:string;dtx?:string};
    encoding.maxBitrate=192_000;
    encoding.networkPriority="high";
    encoding.priority="high";
    encoding.dtx="disabled";
    await sender.setParameters(parameters);
  }catch{/* Older WebRTC engines choose their own audio encoding. */}
}

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

async function stableCapture(media:MediaStream,fps:number,width:number,height:number){
  const source=media.getVideoTracks()[0],video=document.createElement("video"),canvas=document.createElement("canvas"),sample=document.createElement("canvas");
  video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([source]);
  canvas.width=source.getSettings().width||width;canvas.height=source.getSettings().height||height;sample.width=32;sample.height=18;
  const context=canvas.getContext("2d",{alpha:false}),probe=sample.getContext("2d",{willReadFrequently:true}),stream=canvas.captureStream(fps),track=stream.getVideoTracks()[0];
  track.contentHint="motion";let stopped=false,frameHandle=0,timer:ReturnType<typeof setInterval>|null=null;
  const draw=()=>{if(stopped||video.readyState<2||!context||!probe)return;try{probe.drawImage(video,0,0,32,18);const pixels=probe.getImageData(0,0,32,18).data;let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>10)visible++;if(visible>8)context.drawImage(video,0,0,canvas.width,canvas.height)}catch{/* Retain the last valid frame. */}};
  await video.play();
  if("requestVideoFrameCallback" in video){const next=()=>{draw();if(!stopped)frameHandle=(video as HTMLVideoElement&{requestVideoFrameCallback:(callback:()=>void)=>number}).requestVideoFrameCallback(next)};frameHandle=(video as HTMLVideoElement&{requestVideoFrameCallback:(callback:()=>void)=>number}).requestVideoFrameCallback(next)}else timer=setInterval(draw,Math.max(8,1000/fps));
  return {track,stop:()=>{stopped=true;if(frameHandle&&"cancelVideoFrameCallback" in video)(video as HTMLVideoElement&{cancelVideoFrameCallback:(id:number)=>void}).cancelVideoFrameCallback(frameHandle);if(timer)clearInterval(timer);video.pause();video.srcObject=null;stream.getTracks().forEach((t)=>t.stop())}};
}

function mixShareAudio(microphone:MediaStreamTrack|null,system:MediaStreamTrack){
  const context=new AudioContext({latencyHint:"interactive"}),destination=context.createMediaStreamDestination(),compressor=context.createDynamicsCompressor(),nodes:AudioNode[]=[];
  compressor.threshold.value=-18;compressor.knee.value=18;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.25;compressor.connect(destination);nodes.push(compressor);
  for(const [track,level] of [[microphone,1],[system,.82]] as const)if(track&&track.readyState==="live"){
    const source=context.createMediaStreamSource(new MediaStream([track])),gain=context.createGain();gain.gain.value=level;source.connect(gain).connect(compressor);nodes.push(source,gain);
  }
  void context.resume();const output=destination.stream.getAudioTracks()[0];output.contentHint="music";
  return{track:output,stop:()=>{nodes.forEach(node=>node.disconnect());output.stop();void context.close()}}
}

let roomAudio: AudioContext | null = null;
function roomTone(kind: "join" | "leave" | "stream-start" | "stream-stop" | "watch-start" | "watch-stop") {
  try {
    roomAudio ??= new AudioContext();
    void roomAudio.resume();
    const now = roomAudio.currentTime + .015,
      master = roomAudio.createGain(),
      noteMap:Record<typeof kind,number[]>={join:[392,523.25,659.25],leave:[523.25,392],"stream-start":[329.63,493.88,739.99],"stream-stop":[659.25,440,293.66],"watch-start":[587.33,783.99],"watch-stop":[783.99,587.33]},
      notes=noteMap[kind];
    master.gain.setValueAtTime(.0001, now);
    master.gain.exponentialRampToValueAtTime(.12, now + .025);
    master.gain.exponentialRampToValueAtTime(.0001, now + .52);
    master.connect(roomAudio.destination);
    notes.forEach((frequency, index) => {
      const oscillator = roomAudio!.createOscillator(), shimmer = roomAudio!.createGain(), start = now + index * .075;
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (["join","stream-start","watch-start"].includes(kind) ? 1.018 : .985), start + .24);
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
    [streamQuality,setStreamQuality]=useState<StreamQuality>("1080"),[clock,setClock]=useState(Date.now()),[mobileDevice,setMobileDevice]=useState(false),[screenShareSupported,setScreenShareSupported]=useState(false);
  const [streamMenu,setStreamMenu]=useState(false);
  const local = useRef<MediaStream | null>(null), localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()), peerSlots=useRef(new Map<string,PeerSlots>()), names = useRef(new Map<string, string>()),
    pendingIce=useRef(new Map<string,RTCIceCandidateInit[]>()),
    after = useRef(Date.now()), alive = useRef(true), ice = useRef<RTCIceServer[]>([]), knownMembers = useRef<Set<string> | null>(null),
    microphoneTrack=useRef<MediaStreamTrack|null>(null),screenTrack = useRef<MediaStreamTrack | null>(null), screenAudioTrack=useRef<MediaStreamTrack|null>(null),screenAudioCleanup=useRef<(()=>void)|null>(null),cameraTrack = useRef<MediaStreamTrack | null>(null),joinedRef=useRef(false),stopSharingRef=useRef<(()=>Promise<void>)|null>(null),captureCleanup=useRef<(()=>void)|null>(null);

  const signal = useCallback((to: string, body: unknown) => post(channel, { action: "signal", to, body: JSON.stringify(body) }), [channel]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const options = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === "audioinput" ? "Microphone" : kind === "audiooutput" ? "Speaker" : "Camera"} ${i + 1}` }));
    setMicrophones(options("audioinput")); setSpeakers(options("audiooutput")); setCameras(options("videoinput"));
  }, []);
  const closePeer = useCallback((id: string) => {
    peers.current.get(id)?.close(); peers.current.delete(id);peerSlots.current.delete(id);pendingIce.current.delete(id);
    setRemotes((old) => old.filter((r) => r.id !== id));
  }, []);
  const makePeer = useCallback((person: Person) => {
    const existing = peers.current.get(person.id); if (existing) return existing;
    names.current.set(person.id, person.name);
    const pc = new RTCPeerConnection({ iceServers: ice.current }); peers.current.set(person.id, pc);
    const slots={audio:pc.addTransceiver("audio",{direction:"sendrecv"}).sender,camera:pc.addTransceiver("video",{direction:"sendrecv"}).sender,screen:pc.addTransceiver("video",{direction:"sendrecv"}).sender};peerSlots.current.set(person.id,slots);
    const activeAudio=screenAudioTrack.current||microphoneTrack.current;
    if(activeAudio){void slots.audio.replaceTrack(activeAudio);void tuneAudioSender(slots.audio)}
    if(cameraTrack.current){void slots.camera.replaceTrack(cameraTrack.current);void tuneCameraSender(slots.camera)}
    if(screenTrack.current){void slots.screen.replaceTrack(screenTrack.current);void tuneVideoSender(slots.screen,streamFps,streamQuality)}
    pc.onicecandidate = (event) => { if (event.candidate) void signal(person.id, { type: "candidate", candidate: event.candidate }); };
    pc.ontrack = (event) => {
      setRemotes((old) => {const existing=old.find(r=>r.id===person.id),stream=existing?.stream||new MediaStream(),incoming=event.streams[0]?.getTracks()||[event.track];incoming.forEach(track=>{if(!stream.getTracks().some(current=>current.id===track.id))stream.addTrack(track)});if(!stream.getTracks().some(current=>current.id===event.track.id))stream.addTrack(event.track);event.track.addEventListener("ended",()=>{try{stream.removeTrack(event.track)}catch{}},{once:true});return [...old.filter((r) => r.id !== person.id), { ...person, stream }];});
    };
    pc.onconnectionstatechange = () => { if(pc.connectionState==="failed")setError("Voice media could not connect. A TURN relay is required on some mobile networks and restrictive Wi-Fi.");if (["failed", "closed"].includes(pc.connectionState)) closePeer(person.id); };
    return pc;
  }, [closePeer, signal, streamFps, streamQuality]);
  const offer = useCallback(async (person: Person) => {
    const pc = makePeer(person); if (pc.signalingState !== "stable") return;
    await pc.setLocalDescription(await pc.createOffer());await finishIce(pc);
    await signal(person.id, { type: "description", description: pc.localDescription });
    if(screenTrack.current||cameraTrack.current)await signal(person.id,{type:"stream-state",active:true});
  }, [makePeer, signal]);
  const handleSignal = useCallback(async (item: Signal) => {
    const message = JSON.parse(item.body), person = { id: item.from, name: names.current.get(item.from) || "Member" };
    if(message.type==="stream-state"){setRemoteSharing((old)=>{const next=new Set(old);if(message.active)next.add(item.from);else next.delete(item.from);return next});if(!message.active)setTheaterStream((old)=>old===item.from?"":old);return;}
    if(message.type==="stream-watch"){roomTone(message.active?"watch-start":"watch-stop");return;}
    const pc = makePeer(person);
    if (message.type === "candidate") { if(pc.remoteDescription)try{await pc.addIceCandidate(message.candidate)}catch{}else pendingIce.current.set(item.from,[...(pendingIce.current.get(item.from)||[]),message.candidate]);return; }
    if (message.type !== "description") return;
    const description = message.description as RTCSessionDescriptionInit;
    if (description.type === "offer") {
      if (pc.signalingState !== "stable") { await pc.setLocalDescription({ type: "rollback" }); }
      await pc.setRemoteDescription(description);for(const candidate of pendingIce.current.get(item.from)||[])try{await pc.addIceCandidate(candidate)}catch{}pendingIce.current.delete(item.from);await pc.setLocalDescription(await pc.createAnswer());await finishIce(pc);
      await signal(item.from, { type: "description", description: pc.localDescription });
    } else if (description.type === "answer" && pc.signalingState === "have-local-offer"){await pc.setRemoteDescription(description);for(const candidate of pendingIce.current.get(item.from)||[])try{await pc.addIceCandidate(candidate)}catch{}pendingIce.current.delete(item.from)}
  }, [makePeer, signal]);

  const leave = useCallback(async () => {
    if (!joined && !local.current) return;
    roomTone("leave");
    setJoined(false);joinedRef.current=false;captureCleanup.current?.();captureCleanup.current=null;screenAudioCleanup.current?.();screenAudioCleanup.current=null; local.current?.getTracks().forEach((track) => track.stop()); local.current = null;microphoneTrack.current=null;screenAudioTrack.current=null;
    peers.current.forEach((pc) => pc.close()); peers.current.clear();peerSlots.current.clear();pendingIce.current.clear(); knownMembers.current = null; setRemotes([]);setRemoteSharing(new Set());setTheaterStream(""); setCamera(false); setSharing(false);
    try { await post(channel, { action: "leave" }); } catch {}
  }, [channel, joined]);
  useEffect(() => () => { alive.current = false;captureCleanup.current?.();screenAudioCleanup.current?.(); local.current?.getTracks().forEach((t) => t.stop()); peers.current.forEach((p) => p.close()); if(joinedRef.current)void post(channel, { action: "leave" }); }, [channel]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{const mobile=matchMedia("(pointer: coarse)").matches||navigator.maxTouchPoints>1;setMobileDevice(mobile);if(mobile)setCameraId(current=>current==="default"?"front":current);const legacy=navigator as Navigator&{getDisplayMedia?:typeof navigator.mediaDevices.getDisplayMedia};setScreenShareSupported(typeof navigator.mediaDevices?.getDisplayMedia==="function"||typeof legacy.getDisplayMedia==="function")},[]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = sharing&&screenTrack.current?new MediaStream([screenTrack.current]):local.current; }, [camera, sharing, joined]);
  useEffect(() => {
    if (joined) return;
    let active=true;
    const watch=async()=>{try{const response=await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${Date.now()}`,{cache:"no-store"}),data=await response.json() as Record<string,any>;if(active&&response.ok)setMembers((data.members||[]) as Person[])}catch{/* Keep the room usable if presence refresh is interrupted. */}};
    void watch();const timer=setInterval(watch,2000);return()=>{active=false;clearInterval(timer)};
  },[channel,joined]);
  useEffect(() => {
    if (!joined) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${after.current}`, { cache: "no-store" });
        const data = await response.json() as Record<string, any>; if (!response.ok) throw new Error(data.error);
        after.current = data.now || Date.now(); const list = (data.members || []) as Person[],live=list.filter((p)=>!p.reconnecting), nextMembers = new Set(live.map((p) => p.id));
        if (knownMembers.current) {
          const joinedPerson=live.find((p) => p.id !== user.id && !knownMembers.current!.has(p.id));if(joinedPerson)void notifyAemeath({key:`voice-${channel}-${joinedPerson.id}-${Date.now()}`,title:`${joinedPerson.name} joined ${name}`,body:"Someone joined your voice lobby",kind:"join"})
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
      let listenOnly=false;
      if(!navigator.mediaDevices?.getUserMedia){local.current=new MediaStream();listenOnly=true}
      else try { local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation, noiseSuppression, deviceId: micId === "default" ? undefined : { exact: micId } }, video: false });microphoneTrack.current=local.current.getAudioTracks()[0]||null;if(microphoneTrack.current)microphoneTrack.current.contentHint="speech";await refreshDevices(); }
      catch(e){if(mediaPermissionDenied(e)||(e instanceof DOMException&&e.name==="NotFoundError")){local.current=new MediaStream();listenOnly=true}else throw e}
      after.current = Date.now(); await post(channel, { action: "join" }); knownMembers.current = new Set([user.id]); setMembers([user]); setJoined(true);joinedRef.current=true; roomTone("join");
      setMuted(listenOnly);if(listenOnly)setError("Joined in listen-only mode. Use the microphone button when you are ready to allow access.");
    } catch (e) { setError(e instanceof Error ? e.message : "Microphone access is required to join."); local.current?.getTracks().forEach((t) => t.stop()); local.current = null; }
    finally { setBusy(false); }
  }
  async function toggleMute(){
    if(!local.current)return;
    const track=microphoneTrack.current;
    if(!track||track.readyState==="ended"){try{const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation,noiseSuppression,deviceId:micId==="default"?undefined:{exact:micId}},video:false}),nextTrack=media.getAudioTracks()[0];nextTrack.contentHint="speech";microphoneTrack.current=nextTrack;local.current.addTrack(nextTrack);await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.audio.replaceTrack(nextTrack);await tuneAudioSender(slot.audio)}));setMuted(false);setError("");await refreshDevices()}catch(e){setMuted(true);setError(mediaPermissionDenied(e)?"Microphone access is blocked by this browser. You are still connected in listen-only mode.":(e as Error).message)}return;}
    const next=!muted;track.enabled=!next;setMuted(next);
  }
  async function renegotiate() { for (const p of members) if (p.id !== user.id) await offer(p); }
  async function restoreMicrophoneAfterVideo(){
    if(screenAudioTrack.current)return;
    let microphone=microphoneTrack.current;
    if(!microphone||microphone.readyState==="ended"){try{const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation,noiseSuppression,deviceId:micId==="default"?undefined:{exact:micId}},video:false});microphone=media.getAudioTracks()[0];microphone.contentHint="speech";microphoneTrack.current=microphone;local.current?.addTrack(microphone)}catch(e){setMuted(true);setError(mediaPermissionDenied(e)?"The browser stopped microphone access when the camera closed. Press the microphone button to reconnect it.":(e as Error).message);return}}
    microphone.enabled=!muted;await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.audio.replaceTrack(microphone);await tuneAudioSender(slot.audio)}));
  }
  async function toggleCamera() {
    if (!local.current) return;
    const old = cameraTrack.current;
    if (old) { old.stop(); local.current.removeTrack(old);cameraTrack.current=null;await Promise.all([...peerSlots.current.values()].map(slot=>slot.camera.replaceTrack(null)));await restoreMicrophoneAfterVideo();await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:sharing})));setCamera(false); return; }
    try { const media = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(cameraId) }); const track = media.getVideoTracks()[0];track.contentHint="motion";cameraTrack.current=track; local.current.addTrack(track);await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.camera.replaceTrack(track);await tuneCameraSender(slot.camera)})); setCamera(true); await refreshDevices();await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:true}))); } catch (e) { setError((e as Error).message); }
  }
  async function changeMicrophone(id: string) {
    setMicId(id); if (!local.current) return;
    try { const media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id==="default"?undefined:{exact:id},echoCancellation,noiseSuppression},video:false}), next=media.getAudioTracks()[0], old=microphoneTrack.current;next.contentHint="speech"; if(old)local.current.removeTrack(old); old?.stop();microphoneTrack.current=next; local.current.addTrack(next); await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.audio.replaceTrack(next);await tuneAudioSender(slot.audio)})); } catch(e){setError(mediaPermissionDenied(e)?"Microphone access is blocked by this browser.":(e as Error).message);}
  }
  async function changeCamera(id: string) {
    setCameraId(id);if(!camera||!local.current)return;const old=cameraTrack.current,mobileFacing=id==="front"||id==="rear";
    try{
      if(mobileFacing&&old){local.current.removeTrack(old);old.stop();cameraTrack.current=null;await Promise.all([...peerSlots.current.values()].map(slot=>slot.camera.replaceTrack(null)))}
      const media=await navigator.mediaDevices.getUserMedia({video:cameraConstraints(id),audio:false}),next=media.getVideoTracks()[0];next.contentHint="motion";
      if(old&&!mobileFacing){local.current.removeTrack(old);old.stop()}cameraTrack.current=next;local.current.addTrack(next);await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.camera.replaceTrack(next);await tuneCameraSender(slot.camera)}));setCamera(true);setError("");
    }catch(e){if(mobileFacing)setCamera(false);setError((e as Error).message)}
  }
  async function switchMobileCamera(){await changeCamera(cameraId==="rear"?"front":"rear")}
  async function shareScreen() {
    if (!local.current || screenTrack.current) return;
    try {
      setError("");
      const legacy=navigator as Navigator&{getDisplayMedia?:(constraints?:DisplayMediaStreamOptions)=>Promise<MediaStream>},capture=typeof navigator.mediaDevices?.getDisplayMedia==="function"?navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices):typeof legacy.getDisplayMedia==="function"?legacy.getDisplayMedia.bind(navigator):null;
      if(!capture){setStreamMenu(false);if(!camera)await toggleCamera();throw new Error("Screen sharing is unavailable in this mobile browser, so Aemeath opened your camera instead.");}
      const size=mobileDevice?{width:Math.max(screen.width,720),height:Math.max(screen.height,1280)}:streamQuality==="1440"?{width:2560,height:1440}:{width:1920,height:1080},fps=mobileDevice?Math.min(streamFps,60):streamFps;
      const displayOptions=mobileDevice?{video:true,audio:false}:{video:{width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:fps,max:fps}},audio:true,surfaceSwitching:"include",systemAudio:"include"} as DisplayMediaStreamOptions;
      const media=await capture(displayOptions),sourceTrack=media.getVideoTracks()[0],displayAudio=media.getAudioTracks()[0]||null,captured=sourceTrack.getSettings();
      if(!mobileDevice)await sourceTrack.applyConstraints({width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:fps,max:fps}}).catch(()=>{});
      const stabilized=await stableCapture(media,fps,captured.width||size.width,captured.height||size.height),track=stabilized.track;captureCleanup.current=()=>{stabilized.stop();media.getTracks().forEach((t)=>t.stop())};screenTrack.current=track;
      if(displayAudio){const mixed=mixShareAudio(microphoneTrack.current,displayAudio);screenAudioTrack.current=mixed.track;screenAudioCleanup.current=mixed.stop;setError("")}else{screenAudioTrack.current=null;screenAudioCleanup.current=null;setError("This capture source did not provide audio. Choose a browser tab and enable Share tab audio, or choose Entire Screen with system audio.")}
      const outgoingAudio=screenAudioTrack.current;
      const restore=async()=>{if(screenTrack.current!==track)return;roomTone("stream-stop");screenTrack.current=null;screenAudioTrack.current=null;stopSharingRef.current=null;captureCleanup.current?.();captureCleanup.current=null;screenAudioCleanup.current?.();screenAudioCleanup.current=null;local.current?.removeTrack(track);setSharing(false);setStreamMenu(false);setTheaterStream("");const camera=cameraTrack.current,microphone=microphoneTrack.current;await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:!!camera&&camera.readyState==="live"})));await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.screen.replaceTrack(null);await slot.audio.replaceTrack(microphone&&microphone.readyState==="live"?microphone:null);await tuneAudioSender(slot.audio)}));track.stop();displayAudio?.stop();setLocalPreview();};
      stopSharingRef.current=restore;
      sourceTrack.addEventListener("ended",()=>{void restore()},{once:true});
      local.current.addTrack(track);await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.screen.replaceTrack(track);if(outgoingAudio)await slot.audio.replaceTrack(outgoingAudio);await tuneAudioSender(slot.audio);await tuneVideoSender(slot.screen,fps,streamQuality)}));
      setSharing(true);roomTone("stream-start");setLocalPreview(media);await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:true})));
    } catch (e) { if ((e as DOMException).name !== "NotAllowedError") setError((e as Error).message); }
  }
  function setLocalPreview(stream:MediaStream|null=local.current){if(localVideo.current)localVideo.current.srcObject=stream}
  const participantCount=Math.min(30,Math.max(1,1+remotes.length)),columns=participantCount<=9?3:participantCount<=16?4:participantCount<=25?5:6,rows=participantCount<=9?3:participantCount<=16?4:5,hasStreams=sharing||camera||remoteSharing.size>0;
  return <section className={`voice-room${joined?" joined":""}${joined&&!hasStreams?" no-streams":""}`} style={{"--voice-columns":columns,"--voice-rows":rows} as React.CSSProperties}>
    {!joined ? <div className="voice-empty"><div className="voice-orb"><VolumeIcon /></div><h1>{name}</h1><p>{members.filter(m=>!m.reconnecting).length?`${members.filter(m=>!m.reconnecting).length} ${members.filter(m=>!m.reconnecting).length===1?"person is":"people are"} in voice`:"No one is currently in voice"}</p>{members.length>0&&<div className="voice-waiting-members">{members.map((person)=>{const remaining=person.reconnecting?Math.max(0,10-Math.floor((clock-Number(person.left_at||clock))/1000)):0;return <div key={person.id}><span>{person.name.slice(0,2).toUpperCase()}</span><strong>{person.name}</strong><i className={person.reconnecting?"reconnecting":""}>{person.reconnecting?`Reconnecting · ${remaining}s`:"Connected"}</i></div>})}</div>}<button className="voice-join" disabled={busy} onClick={join}>{busy ? "Joining…" : members.some(m=>m.id===user.id&&m.reconnecting)?"Rejoin Voice":"Join Voice"}</button></div> : <>
      {(sharing||camera||remoteSharing.size>0)&&<div className={"stream-deck "+(theaterStream?"theater":"")}>
        {sharing&&<StreamCard id={user.id} name={`${user.name}'s stream`} theater={theaterStream===user.id} onTheater={()=>setTheaterStream(theaterStream===user.id?"":user.id)} onStop={()=>void stopSharingRef.current?.()} onChange={async()=>{await stopSharingRef.current?.();await shareScreen()}}><TrackVideo track={screenTrack.current} muted/></StreamCard>}
        {camera&&<StreamCard id={`${user.id}-camera`} name={`${user.name}'s camera`} theater={theaterStream===`${user.id}-camera`} onTheater={()=>setTheaterStream(theaterStream===`${user.id}-camera`?"":`${user.id}-camera`)} onStop={()=>void toggleCamera()}><TrackVideo track={cameraTrack.current} muted/></StreamCard>}
        {remotes.filter((r)=>remoteSharing.has(r.id)).flatMap((remote)=>remote.stream.getVideoTracks().map((track,index,tracks)=>{const tileId=`${remote.id}-${track.id}`,focused=theaterStream===tileId,label=tracks.length>1?(index===0?"camera":"screen"):"stream";return <StreamCard key={tileId} id={tileId} name={`${remote.name}'s ${label}`} theater={focused} onTheater={()=>{const active=!focused;setTheaterStream(active?tileId:"");void signal(remote.id,{type:"stream-watch",active})}} onWatch={(active)=>void signal(remote.id,{type:"stream-watch",active})}><TrackVideo track={track} muted/></StreamCard>}))}
      </div>}
      <RemoteAudioMixer remotes={remotes} speakerId={speakerId}/>
      <div className={"voice-grid "+((sharing||camera||remoteSharing.size)?"with-streams":"")}>
        <div className="voice-tile local"><div className="voice-avatar">{user.name.slice(0,2).toUpperCase()}</div>{(sharing||camera)&&<span className="streaming-badge"><MonitorUp size={13}/> Streaming</span>}<span>{user.name} · You</span></div>
        {remotes.map((remote) => <div className="voice-tile" key={remote.id}><div className="voice-avatar">{remote.name.slice(0,2).toUpperCase()}</div>{remoteSharing.has(remote.id)&&<span className="streaming-badge"><MonitorUp size={13}/> Streaming</span>}<span>{remote.name}</span></div>)}
      </div>
      <div className="voice-status"><Users size={15}/> {members.filter(m=>!m.reconnecting).length} connected</div>
      <div className="voice-controls"><button className={muted ? "off" : ""} aria-label={muted ? "Enable microphone" : "Mute"} onClick={()=>void toggleMute()}>{muted?<MicOff/>:<Mic/>}</button><button className={camera ? "active" : ""} aria-label="Toggle camera" onClick={toggleCamera}>{camera?<Camera/>:<CameraOff/>}</button>{mobileDevice&&camera&&<button className="active" aria-label="Switch between front and rear camera" title="Switch camera" onClick={()=>void switchMobileCamera()}><SwitchCamera/></button>}{(sharing||screenShareSupported)&&<div className="stream-control"><button className={sharing ? "active has-menu" : ""} aria-label={sharing?"Stream options":mobileDevice?"Share phone screen":"Share screen"} onClick={()=>sharing?setStreamMenu(!streamMenu):void shareScreen()}><MonitorUp/>{sharing&&<ChevronDown size={13}/>}</button>{streamMenu&&sharing&&<div className="stream-control-menu"><button onClick={()=>void stopSharingRef.current?.()}><X size={15}/> Stop streaming</button><button onClick={async()=>{await stopSharingRef.current?.();await shareScreen()}}><MonitorUp size={15}/> Change stream</button><div/><button onClick={()=>setError("Stream diagnostics are ready. Try another share source if the video is black.")}><MoreHorizontal size={15}/> Report a problem</button></div>}</div>}<button className={settings ? "active" : ""} aria-label="Voice settings" onClick={()=>{setSettings(!settings);void refreshDevices();}}><Settings/></button><button className="hangup" aria-label="Leave voice" onClick={leave}><PhoneOff/></button></div>
      {settings && <aside className="voice-settings"><header><div><strong>Voice, video & stream</strong><small>Choose how you join the room</small></div><button aria-label="Close voice settings" onClick={()=>setSettings(false)}><X size={18}/></button></header><label>Input device<select value={micId} onChange={(e)=>void changeMicrophone(e.target.value)}><option value="default">System default</option>{microphones.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Output device<select value={speakerId} onChange={(e)=>setSpeakerId(e.target.value)}><option value="default">System default</option>{speakers.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Camera<select value={cameraId} onChange={(e)=>void changeCamera(e.target.value)}>{mobileDevice?<><option value="front">Front camera</option><option value="rear">Rear camera</option></>:<><option value="default">System default</option>{cameras.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</>}</select></label><div className="voice-stream-options"><label>Stream quality<select value={streamQuality} disabled={sharing} onChange={(e)=>setStreamQuality(e.target.value as StreamQuality)}><option value="1080">1080p · Smooth</option><option value="1440">1440p · High quality</option></select></label><label>Frame rate<select value={streamFps} disabled={sharing} onChange={(e)=>setStreamFps(Number(e.target.value))}><option value="60">60 FPS</option><option value="120">120 FPS</option></select></label></div><label className="voice-range">Input sensitivity <span>{sensitivity}%</span><input type="range" min="0" max="100" value={sensitivity} onChange={(e)=>setSensitivity(Number(e.target.value))}/></label><label className="voice-switch"><span><strong>Echo cancellation</strong><small>Reduce sound coming back through your microphone.</small></span><input type="checkbox" checked={echoCancellation} onChange={(e)=>setEchoCancellation(e.target.checked)}/></label><label className="voice-switch"><span><strong>Noise suppression</strong><small>Reduce fans, keyboards, and background noise.</small></span><input type="checkbox" checked={noiseSuppression} onChange={(e)=>setNoiseSuppression(e.target.checked)}/></label><p className="voice-settings-note">120 FPS depends on the shared display, browser, device encoder, and connection. Settings lock while a stream is live.</p></aside>}
    </>}    {error && <div className="voice-error" role="alert">{error}</div>}
  </section>;
}
function RemoteAudioMixer({remotes,speakerId}:{remotes:Remote[];speakerId:string}){
  const ref=useRef<HTMLAudioElement>(null),trackSignature=remotes.flatMap(remote=>remote.stream.getAudioTracks().map(track=>`${remote.id}:${track.id}:${track.readyState}`)).sort().join("|");
  useEffect(()=>{
    const audio=ref.current as (HTMLAudioElement&{setSinkId?:(id:string)=>Promise<void>})|null;if(!audio)return;
    const context=new AudioContext({latencyHint:"interactive"}),destination=context.createMediaStreamDestination(),compressor=context.createDynamicsCompressor(),nodes:AudioNode[]=[];
    compressor.threshold.value=-16;compressor.knee.value=20;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.2;compressor.connect(destination);nodes.push(compressor);
    const tracks=remotes.flatMap(remote=>remote.stream.getAudioTracks()).filter(track=>track.readyState==="live"),level=Math.min(1,1.35/Math.sqrt(Math.max(1,tracks.length)));
    for(const track of tracks){const source=context.createMediaStreamSource(new MediaStream([track])),gain=context.createGain();gain.gain.value=level;source.connect(gain).connect(compressor);nodes.push(source,gain)}
    audio.srcObject=destination.stream;audio.muted=false;audio.volume=1;if(audio.setSinkId)void audio.setSinkId(speakerId).catch(()=>{});
    const play=()=>{void context.resume();if(tracks.length)void audio.play().catch(()=>{})};play();document.addEventListener("pointerdown",play,{passive:true});document.addEventListener("touchend",play,{passive:true});
    return()=>{document.removeEventListener("pointerdown",play);document.removeEventListener("touchend",play);audio.pause();audio.srcObject=null;nodes.forEach(node=>node.disconnect());destination.stream.getTracks().forEach(track=>track.stop());void context.close()};
  },[trackSignature,speakerId]);
  return <audio ref={ref} autoPlay playsInline/>;
}
function TrackVideo({track,muted=false}:{track:MediaStreamTrack|null;muted?:boolean}){const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{const video=ref.current;if(!video)return;video.srcObject=track?new MediaStream([track]):null;if(track)void video.play().catch(()=>{});return()=>{video.srcObject=null}},[track]);return <video ref={ref} autoPlay playsInline muted={muted}/>}
function StreamCard({name,theater,onTheater,onStop,onChange,onWatch,children}:{id:string;name:string;theater:boolean;onTheater:()=>void;onStop?:()=>void;onChange?:()=>void;onWatch?:(active:boolean)=>void;children:React.ReactNode}){const [menu,setMenu]=useState(false),card=useRef<HTMLElement>(null),fullscreenWatching=useRef(false);useEffect(()=>{const change=()=>{const active=document.fullscreenElement===card.current;if(active!==fullscreenWatching.current){fullscreenWatching.current=active;onWatch?.(active)}};document.addEventListener("fullscreenchange",change);return()=>document.removeEventListener("fullscreenchange",change)},[onWatch]);const pip=async(element:HTMLElement)=>{const video=element.querySelector("video");if(video&&document.pictureInPictureEnabled){video.addEventListener("enterpictureinpicture",()=>onWatch?.(true),{once:true});video.addEventListener("leavepictureinpicture",()=>onWatch?.(false),{once:true});await video.requestPictureInPicture().catch(()=>{})}};return <article ref={card} className={"stream-card "+(theater?"expanded":"")}><header><span><MonitorUp size={15}/><strong>{name}</strong><b>LIVE</b></span><div><button aria-label="Pop out stream" onClick={(e)=>void pip(e.currentTarget.closest(".stream-card") as HTMLElement)}><PictureInPicture2 size={17}/></button><button aria-label={theater?"Exit theater view":"Open theater view"} onClick={onTheater}>{theater?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button aria-label="View fullscreen" onClick={(e)=>void(e.currentTarget.closest(".stream-card") as HTMLElement)?.requestFullscreen()}><Maximize2 size={17}/></button><button aria-label="Stream options" onClick={()=>setMenu(!menu)}><MoreHorizontal size={17}/></button></div>{menu&&<div className="stream-card-menu">{onStop&&<button onClick={onStop}>Stop streaming</button>}{onChange&&<button onClick={onChange}>Change stream</button>}<button onClick={(e)=>void pip(e.currentTarget.closest(".stream-card") as HTMLElement)}>Pop out</button><button onClick={onTheater}>{theater?"Exit theater":"Theater view"}</button><button onClick={(e)=>void(e.currentTarget.closest(".stream-card") as HTMLElement)?.requestFullscreen()}>Fullscreen</button></div>}</header><div className="stream-video" onClick={onTheater} title={theater?"Exit theater view":"Open theater view"}>{children}</div></article>}
function VolumeIcon(){ return <span aria-hidden>◖))</span>; }

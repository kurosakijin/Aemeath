"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppWindow, Camera, CameraOff, ChevronUp, Headphones, Maximize2, Mic, MicOff, Minimize2, Monitor, MonitorUp, MoreHorizontal, PhoneOff, Settings, SwitchCamera, UserPlus, Users, Volume2, VolumeX, X } from "lucide-react";
import {notifyAemeath} from "@/lib/notifications";
import {Room as LiveKitRoom,RoomEvent as LiveKitRoomEvent,Track as LiveKitTrack,type RemoteAudioTrack,type RemoteParticipant,type RemoteTrack} from "livekit-client";

type Person = { id: string; name: string; reconnecting?:number|boolean; left_at?:number };
export type VoiceControls={muted:boolean;deafened:boolean;camera:boolean;sharing:boolean;toggleMute:()=>void;toggleDeafen:()=>void;toggleCamera:()=>void;toggleShare:()=>void;invite:()=>void;leave:()=>void};
type Signal = { id: string; from: string; body: string; created: number };
type Remote = Person & { stream: MediaStream };
type DeviceOption = { deviceId: string; label: string };
type StreamQuality = "720" | "1080" | "1440";
type DesktopSource={id:string;name:string;type:"window"|"screen";thumbnail:string;icon:string};
type DesktopBridge={getCaptureSources:()=>Promise<DesktopSource[]>;selectCaptureSource:(id:string)=>Promise<boolean>};
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
let voicePlaybackAudio: AudioContext | null = null;
function getVoicePlaybackAudio(){voicePlaybackAudio??=new AudioContext({latencyHint:"interactive"});return voicePlaybackAudio}
function roomTone(kind: "join" | "leave" | "stream-start" | "stream-stop" | "watch-start" | "watch-stop") {
  try {
    roomAudio ??= new AudioContext();
    void roomAudio.resume();
    const now = roomAudio.currentTime + .015,
      master = roomAudio.createGain(),
      noteMap:Record<typeof kind,number[]>={join:[392,523.25,659.25],leave:[523.25,392],"stream-start":[329.63,493.88,739.99],"stream-stop":[659.25,440,293.66],"watch-start":[587.33,783.99],"watch-stop":[783.99,587.33]},
      notes=noteMap[kind];
    master.gain.setValueAtTime(.0001, now);
    master.gain.exponentialRampToValueAtTime(.24, now + .025);
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

export default function VoiceRoom({ channel, name, user, onInvite, onJoinedChange, onVoiceControls, autoJoin=false, initialMuted=false, initialDeafened=false }: { channel: string; name: string; user: Person; onInvite:()=>void; onJoinedChange:(joined:boolean)=>void; onVoiceControls:(controls:VoiceControls|null)=>void; autoJoin?:boolean; initialMuted?:boolean; initialDeafened?:boolean }) {
  const [joined, setJoined] = useState(false), [members, setMembers] = useState<Person[]>([]),
    [remotes, setRemotes] = useState<Remote[]>([]), [muted, setMuted] = useState(false), [deafened,setDeafened]=useState(false),
    [camera, setCamera] = useState(false), [sharing, setSharing] = useState(false),
    [error, setError] = useState(""), [busy, setBusy] = useState(false), [settings, setSettings] = useState(false),
    [microphones, setMicrophones] = useState<DeviceOption[]>([]), [cameras, setCameras] = useState<DeviceOption[]>([]),
    [speakers, setSpeakers] = useState<DeviceOption[]>([]), [micId, setMicId] = useState("default"),
    [cameraId, setCameraId] = useState("default"), [speakerId, setSpeakerId] = useState("default"),
    [echoCancellation, setEchoCancellation] = useState(true), [noiseSuppression, setNoiseSuppression] = useState(true),
    [sensitivity, setSensitivity] = useState(55), [remoteSharing, setRemoteSharing] = useState<Set<string>>(new Set()),
    [streamFps,setStreamFps]=useState(60),
    [streamQuality,setStreamQuality]=useState<StreamQuality>("1080"),[clock,setClock]=useState(Date.now()),[mobileDevice,setMobileDevice]=useState(false),[screenShareSupported,setScreenShareSupported]=useState(false),[takenOver,setTakenOver]=useState(false),[mediaTransport,setMediaTransport]=useState<"mesh"|"livekit">("mesh"),[speakingIds,setSpeakingIds]=useState<Set<string>>(new Set()),[desktopSources,setDesktopSources]=useState<DesktopSource[]>([]),[sourceTab,setSourceTab]=useState<"window"|"screen">("window"),[sourcePicker,setSourcePicker]=useState(false),[sourceLoading,setSourceLoading]=useState(false);
  const [streamMenu,setStreamMenu]=useState(false),[streamLayout,setStreamLayout]=useState<"focus"|"tiles">("tiles"),[focusedStream,setFocusedStream]=useState(""),[memberMenu,setMemberMenu]=useState(""),[memberVolumes,setMemberVolumes]=useState<Record<string,number>>({}),[participantStates,setParticipantStates]=useState<Record<string,{muted:boolean;deafened:boolean}>>({});
  const local = useRef<MediaStream | null>(null), localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()), peerSlots=useRef(new Map<string,PeerSlots>()), names = useRef(new Map<string, string>()),
    pendingIce=useRef(new Map<string,RTCIceCandidateInit[]>()),seenSignals=useRef(new Set<string>()),polling=useRef(false),
    after = useRef(Date.now()), alive = useRef(true), ice = useRef<RTCIceServer[]>([]), knownMembers = useRef<Set<string> | null>(null),
    microphoneTrack=useRef<MediaStreamTrack|null>(null),screenTrack = useRef<MediaStreamTrack | null>(null), screenAudioTrack=useRef<MediaStreamTrack|null>(null),screenAudioCleanup=useRef<(()=>void)|null>(null),cameraTrack = useRef<MediaStreamTrack | null>(null),joinedRef=useRef(false),stopSharingRef=useRef<(()=>Promise<void>)|null>(null),captureCleanup=useRef<(()=>void)|null>(null),disconnectTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>()),restartAttempts=useRef(new Map<string,number>()),livekitRoom=useRef<LiveKitRoom|null>(null),livekitAudio=useRef(new Map<string,{track:RemoteAudioTrack;element:HTMLMediaElement}>()),speakerIdRef=useRef("default"),sfuActive=useRef(false),voiceSession=useRef(crypto.randomUUID()),mutedRef=useRef(false),deafenedRef=useRef(false),mutedBeforeDeafenRef=useRef(false);

  const voicePost=useCallback((data:Record<string,unknown>)=>post(channel,{...data,session:voiceSession.current}),[channel]);
  const signal = useCallback((to: string, body: unknown) => voicePost({ action: "signal", to, body: JSON.stringify(body) }), [voicePost]);
  const addLiveKitTrack=useCallback((track:RemoteTrack,participant:RemoteParticipant)=>{
    const mediaTrack=track.mediaStreamTrack;mediaTrack.enabled=true;
    if(track.kind===LiveKitTrack.Kind.Audio){const audioTrack=track as RemoteAudioTrack,key=track.sid||mediaTrack.id,previous=livekitAudio.current.get(key);if(!previous){const element=audioTrack.attach();element.autoplay=true;element.muted=true;element.setAttribute("playsinline","");element.style.display="none";document.body.appendChild(element);livekitAudio.current.set(key,{track:audioTrack,element})}}
    setRemotes(old=>{const existing=old.find(remote=>remote.id===participant.identity),stream=existing?.stream||new MediaStream();if(!stream.getTracks().some(current=>current.id===mediaTrack.id))stream.addTrack(mediaTrack);return[...old.filter(remote=>remote.id!==participant.identity),{id:participant.identity,name:participant.name||participant.identity,stream}]});
    if(mediaTrack.kind==="video")setRemoteSharing(old=>new Set(old).add(participant.identity));
  },[]);
  const removeLiveKitTrack=useCallback((track:RemoteTrack,participant:RemoteParticipant)=>{
    const mediaTrack=track.mediaStreamTrack;
    if(track.kind===LiveKitTrack.Kind.Audio){const key=track.sid||mediaTrack.id,attached=livekitAudio.current.get(key);attached?.track.detach();attached?.element.remove();livekitAudio.current.delete(key)}
    setRemotes(old=>old.map(remote=>{if(remote.id!==participant.identity)return remote;try{remote.stream.removeTrack(mediaTrack)}catch{}return remote}).filter(remote=>remote.stream.getTracks().length>0));
    if(mediaTrack.kind==="video")setRemoteSharing(old=>{const next=new Set(old);const remote=remotes.find(item=>item.id===participant.identity);if(!remote?.stream.getVideoTracks().some(item=>item.id!==mediaTrack.id))next.delete(participant.identity);return next});
  },[remotes]);
  const clearLiveKitAudio=useCallback(()=>{for(const {track,element} of livekitAudio.current.values()){track.detach();element.remove()}livekitAudio.current.clear()},[]);
  useEffect(()=>{speakerIdRef.current=speakerId;for(const {track} of livekitAudio.current.values())void track.setSinkId(speakerId).catch(()=>{})},[speakerId]);
  const syncPeerTracks=useCallback(async()=>{
    const audio=screenAudioTrack.current||microphoneTrack.current,camera=cameraTrack.current,screen=screenTrack.current;
    await Promise.allSettled([...peerSlots.current.values()].map(async slots=>{
      if(slots.audio.track!==audio){await slots.audio.replaceTrack(audio);await tuneAudioSender(slots.audio)}
      if(slots.camera.track!==camera){await slots.camera.replaceTrack(camera);if(camera)await tuneCameraSender(slots.camera)}
      if(slots.screen.track!==screen){await slots.screen.replaceTrack(screen);if(screen)await tuneVideoSender(slots.screen,streamFps,streamQuality)}
    }));
  },[streamFps,streamQuality]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const options = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === "audioinput" ? "Microphone" : kind === "audiooutput" ? "Speaker" : "Camera"} ${i + 1}` }));
    setMicrophones(options("audioinput")); setSpeakers(options("audiooutput")); setCameras(options("videoinput"));
  }, []);
  const closePeer = useCallback((id: string) => {
    const timer=disconnectTimers.current.get(id);if(timer)clearTimeout(timer);disconnectTimers.current.delete(id);
    restartAttempts.current.delete(id);
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
      event.track.enabled=true;
      setRemotes((old) => {const existing=old.find(r=>r.id===person.id),stream=existing?.stream||new MediaStream(),incoming=event.streams[0]?.getTracks()||[event.track];incoming.forEach(track=>{if(!stream.getTracks().some(current=>current.id===track.id))stream.addTrack(track)});if(!stream.getTracks().some(current=>current.id===event.track.id))stream.addTrack(event.track);event.track.addEventListener("ended",()=>{try{stream.removeTrack(event.track)}catch{}},{once:true});return [...old.filter((r) => r.id !== person.id), { ...person, stream }];});
    };
    pc.onconnectionstatechange = () => {
      const oldTimer=disconnectTimers.current.get(person.id);if(oldTimer){clearTimeout(oldTimer);disconnectTimers.current.delete(person.id)}
      if(pc.connectionState==="disconnected")disconnectTimers.current.set(person.id,setTimeout(()=>{if(pc.connectionState==="disconnected")closePeer(person.id)},8000));
      if(pc.connectionState==="connected"){restartAttempts.current.delete(person.id);setError(current=>current.startsWith("Voice media is reconnecting")?"":current)}
      if(pc.connectionState==="failed"){
        const attempts=restartAttempts.current.get(person.id)||0;
        if(attempts<2){restartAttempts.current.set(person.id,attempts+1);setError("Voice media is reconnecting through the relay…");void (async()=>{try{if(pc.signalingState!=="stable")return;pc.restartIce();await pc.setLocalDescription(await pc.createOffer({iceRestart:true}));await finishIce(pc,3000);await signal(person.id,{type:"description",description:pc.localDescription})}catch{closePeer(person.id)}})()}
        else closePeer(person.id);
      }
      if(pc.connectionState==="closed")closePeer(person.id);
    };
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
    if(message.type==="voice-state"){setParticipantStates(old=>({...old,[item.from]:{muted:!!message.muted,deafened:!!message.deafened}}));return;}
    if(message.type==="stream-state"){setRemoteSharing((old)=>{const next=new Set(old);if(message.active)next.add(item.from);else next.delete(item.from);return next});return;}
    if(message.type==="stream-watch"){roomTone(message.active?"watch-start":"watch-stop");return;}
    const pc = makePeer(person);
    if (message.type === "candidate") { if(pc.remoteDescription)try{await pc.addIceCandidate(message.candidate)}catch{}else pendingIce.current.set(item.from,[...(pendingIce.current.get(item.from)||[]),message.candidate]);return; }
    if (message.type !== "description") return;
    const description = message.description as RTCSessionDescriptionInit;
    if (description.type === "offer") {
      if (pc.signalingState !== "stable") { await pc.setLocalDescription({ type: "rollback" }); }
      await pc.setRemoteDescription(description);for(const candidate of pendingIce.current.get(item.from)||[])try{await pc.addIceCandidate(candidate)}catch{}pendingIce.current.delete(item.from);await pc.setLocalDescription(await pc.createAnswer());await finishIce(pc);
      await signal(item.from, { type: "description", description: pc.localDescription });
      if(screenTrack.current||cameraTrack.current)await signal(item.from,{type:"stream-state",active:true});
    } else if (description.type === "answer" && pc.signalingState === "have-local-offer"){await pc.setRemoteDescription(description);for(const candidate of pendingIce.current.get(item.from)||[])try{await pc.addIceCandidate(candidate)}catch{}pendingIce.current.delete(item.from)}
  }, [makePeer, signal]);

  const broadcastVoiceState=useCallback(async(nextMuted:boolean,nextDeafened:boolean)=>{
    const message={type:"voice-state",muted:nextMuted,deafened:nextDeafened};
    if(sfuActive.current)await livekitRoom.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)),{reliable:true});
    else await Promise.allSettled(members.filter(member=>member.id!==user.id).map(member=>signal(member.id,message)));
  },[members,signal,user.id]);

  const connectLiveKit=useCallback(async()=>{
    const response=await fetch(`/api/livekit?channel=${encodeURIComponent(channel)}`,{cache:"no-store"}),config=await response.json() as {enabled?:boolean;url?:string;token?:string;error?:string};
    if(!response.ok)throw new Error(config.error||"The media server is unavailable.");
    if(!config.enabled||!config.url||!config.token)return false;
    const room=new LiveKitRoom({adaptiveStream:true,dynacast:true,disconnectOnPageLeave:true});
    room.on(LiveKitRoomEvent.TrackSubscribed,(track,_publication,participant)=>addLiveKitTrack(track,participant));
    room.on(LiveKitRoomEvent.TrackUnsubscribed,(track,_publication,participant)=>removeLiveKitTrack(track,participant));
    room.on(LiveKitRoomEvent.ActiveSpeakersChanged,participants=>{const next=new Set(participants.map(participant=>participant.identity));setSpeakingIds(current=>current.size===next.size&&[...current].every(id=>next.has(id))?current:next)});
    room.on(LiveKitRoomEvent.DataReceived,(payload,participant)=>{if(!participant)return;try{const message=JSON.parse(new TextDecoder().decode(payload));if(message.type==="voice-state")setParticipantStates(old=>({...old,[participant.identity]:{muted:!!message.muted,deafened:!!message.deafened}}))}catch{}});
    room.on(LiveKitRoomEvent.ParticipantConnected,()=>{void livekitRoom.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({type:"voice-state",muted:mutedRef.current,deafened:deafenedRef.current})),{reliable:true})});
    room.on(LiveKitRoomEvent.ParticipantDisconnected,participant=>{setRemotes(old=>old.filter(remote=>remote.id!==participant.identity));setRemoteSharing(old=>{const next=new Set(old);next.delete(participant.identity);return next});setSpeakingIds(old=>{const next=new Set(old);next.delete(participant.identity);return next})});
    room.on(LiveKitRoomEvent.Reconnecting,()=>setError("Voice media is reconnecting through LiveKit…"));
    room.on(LiveKitRoomEvent.Reconnected,()=>setError(current=>current.startsWith("Voice media is reconnecting")?"":current));
    await room.connect(config.url,config.token,{autoSubscribe:true,maxRetries:5});
    livekitRoom.current=room;sfuActive.current=true;setMediaTransport("livekit");
    if(microphoneTrack.current)await room.localParticipant.publishTrack(microphoneTrack.current,{source:LiveKitTrack.Source.Microphone,audioPreset:{maxBitrate:192_000}});
    await room.startAudio().catch(()=>{});
    return true;
  },[channel,addLiveKitTrack,removeLiveKitTrack]);

  const leave = useCallback(async () => {
    if (!joined && !local.current) return;
    roomTone("leave");
    setJoined(false);onJoinedChange(false);onVoiceControls(null);joinedRef.current=false;mutedBeforeDeafenRef.current=false;setMediaTransport("mesh");setSpeakingIds(new Set());setDeafened(false);setParticipantStates({});captureCleanup.current?.();captureCleanup.current=null;screenAudioCleanup.current?.();screenAudioCleanup.current=null;clearLiveKitAudio();await livekitRoom.current?.disconnect();livekitRoom.current=null;sfuActive.current=false; local.current?.getTracks().forEach((track) => track.stop()); local.current = null;microphoneTrack.current=null;screenAudioTrack.current=null;
    disconnectTimers.current.forEach(timer=>clearTimeout(timer));disconnectTimers.current.clear();peers.current.forEach((pc) => pc.close()); peers.current.clear();peerSlots.current.clear();pendingIce.current.clear(); knownMembers.current = null; setRemotes([]);setRemoteSharing(new Set()); setCamera(false); setSharing(false);
    try { await voicePost({ action: "leave" }); } catch {}
  }, [joined,voicePost,clearLiveKitAudio,onJoinedChange,onVoiceControls]);
  useEffect(() => () => { alive.current = false;captureCleanup.current?.();screenAudioCleanup.current?.();clearLiveKitAudio();void livekitRoom.current?.disconnect();local.current?.getTracks().forEach((t) => t.stop());disconnectTimers.current.forEach(timer=>clearTimeout(timer));disconnectTimers.current.clear(); peers.current.forEach((p) => p.close()); if(joinedRef.current)void voicePost({ action: "leave" }); }, [voicePost,clearLiveKitAudio]);
  useEffect(()=>{if(!joined)return;const start=()=>{void getVoicePlaybackAudio().resume();void livekitRoom.current?.startAudio().catch(()=>{});for(const {element} of livekitAudio.current.values())void element.play().catch(()=>{})};document.addEventListener("pointerdown",start,{passive:true});document.addEventListener("touchend",start,{passive:true});return()=>{document.removeEventListener("pointerdown",start);document.removeEventListener("touchend",start)}},[joined]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{const mobile=matchMedia("(pointer: coarse)").matches||navigator.maxTouchPoints>1;setMobileDevice(mobile);if(mobile)setCameraId(current=>current==="default"?"front":current);const legacy=navigator as Navigator&{getDisplayMedia?:typeof navigator.mediaDevices.getDisplayMedia};setScreenShareSupported(typeof navigator.mediaDevices?.getDisplayMedia==="function"||typeof legacy.getDisplayMedia==="function")},[]);
  useEffect(()=>{if(!joined||!mobileDevice)return;document.documentElement.classList.add("mobile-voice-room-open");return()=>document.documentElement.classList.remove("mobile-voice-room-open")},[joined,mobileDevice]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = sharing&&screenTrack.current?new MediaStream([screenTrack.current]):local.current; }, [camera, sharing, joined]);
  useEffect(() => {
    if (joined) return;
    let active=true;
    const watch=async()=>{try{const response=await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${Date.now()}`,{cache:"no-store"}),data=await response.json() as Record<string,any>;if(active&&response.ok)setMembers((data.members||[]) as Person[])}catch{/* Keep the room usable if presence refresh is interrupted. */}};
    void watch();const timer=setInterval(watch,5000);return()=>{active=false;clearInterval(timer)};
  },[channel,joined]);
  useEffect(() => {
    if (!joined) return;
    const poll = async () => {
      if(polling.current)return;polling.current=true;
      try {
        const response = await fetch(`/api/voice?channel=${encodeURIComponent(channel)}&after=${Math.max(0,after.current-3000)}&session=${encodeURIComponent(voiceSession.current)}`, { cache: "no-store" });
        const data = await response.json() as Record<string, any>; if (!response.ok) throw new Error(data.error);
        if(data.displaced){roomTone("leave");joinedRef.current=false;setJoined(false);setMediaTransport("mesh");setSpeakingIds(new Set());setTakenOver(true);onJoinedChange(false);captureCleanup.current?.();captureCleanup.current=null;screenAudioCleanup.current?.();screenAudioCleanup.current=null;clearLiveKitAudio();await livekitRoom.current?.disconnect();livekitRoom.current=null;sfuActive.current=false;local.current?.getTracks().forEach(track=>track.stop());local.current=null;microphoneTrack.current=null;cameraTrack.current=null;screenTrack.current=null;screenAudioTrack.current=null;disconnectTimers.current.forEach(timer=>clearTimeout(timer));disconnectTimers.current.clear();peers.current.forEach(peer=>peer.close());peers.current.clear();peerSlots.current.clear();pendingIce.current.clear();setRemotes([]);setRemoteSharing(new Set());setCamera(false);setSharing(false);setError("");return}
        after.current = Math.max(after.current,data.now||Date.now()); let list = (data.members || []) as Person[];
        if(!list.some(person=>person.id===user.id)){await voicePost({action:"join"});list=[...list,user]}
        const live=list.filter((p)=>!p.reconnecting), presentMembers=new Set(list.map((p)=>p.id));
        if (knownMembers.current) {
          const joinedPerson=live.find((p) => p.id !== user.id && !knownMembers.current!.has(p.id));if(joinedPerson){void notifyAemeath({key:`voice-${channel}-${joinedPerson.id}-${Date.now()}`,title:`${joinedPerson.name} joined ${name}`,body:"Someone joined your voice lobby",kind:"join"});void broadcastVoiceState(muted,deafened)}
          if ([...knownMembers.current].some((id) => id !== user.id && !presentMembers.has(id))) roomTone("leave");
        }
        knownMembers.current = presentMembers; setMembers(list); live.forEach((p) => names.current.set(p.id, p.name));
        if(!sfuActive.current){
          for (const item of (data.signals || []) as Signal[]){if(seenSignals.current.has(item.id))continue;await handleSignal(item);seenSignals.current.add(item.id)}
          if(seenSignals.current.size>1000)seenSignals.current=new Set([...seenSignals.current].slice(-500));
          for (const p of live) if (p.id !== user.id && !peers.current.has(p.id) && user.id < p.id) await offer(p);
          await syncPeerTracks();
        }
        for (const id of [...peers.current.keys()]) if (!live.some((p) => p.id === id)){closePeer(id);setRemoteSharing((old)=>{const next=new Set(old);next.delete(id);return next})}
      } catch (e) { if (alive.current) setError((e as Error).message || "Could not refresh the voice room."); }
      finally{polling.current=false}
    };
    void poll(); const timer = setInterval(() => { void voicePost({ action: "heartbeat" }); void poll(); }, 5000);
    return () => clearInterval(timer);
  }, [channel, joined, user.id, offer, handleSignal, closePeer, syncPeerTracks,voicePost,clearLiveKitAudio,broadcastVoiceState,muted,deafened]);

  async function join() {
    const playback=getVoicePlaybackAudio();void playback.resume();
    setBusy(true); setError("");setTakenOver(false);
    try {
      const config = await fetch("/api/calls?config=1").then((r) => r.json()) as Record<string, any>; ice.current = config.iceServers || [];
      let listenOnly=false;
      if(!navigator.mediaDevices?.getUserMedia){local.current=new MediaStream();listenOnly=true}
      else try { local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation, noiseSuppression, deviceId: micId === "default" ? undefined : { exact: micId } }, video: false });microphoneTrack.current=local.current.getAudioTracks()[0]||null;if(microphoneTrack.current)microphoneTrack.current.contentHint="speech";await refreshDevices(); }
      catch(e){if(mediaPermissionDenied(e)||(e instanceof DOMException&&e.name==="NotFoundError")){local.current=new MediaStream();listenOnly=true}else throw e}
      after.current = Date.now();await connectLiveKit();await voicePost({ action: "join" }); knownMembers.current = new Set([user.id]); setMembers([user]); setJoined(true);onJoinedChange(true);joinedRef.current=true; roomTone("join");
      const restoredMuted=listenOnly||initialMuted||initialDeafened,restoredDeafened=!listenOnly&&initialDeafened;microphoneTrack.current&&(microphoneTrack.current.enabled=!restoredMuted);mutedRef.current=restoredMuted;deafenedRef.current=restoredDeafened;mutedBeforeDeafenRef.current=initialDeafened?initialMuted:restoredMuted;setMuted(restoredMuted);setDeafened(restoredDeafened);void broadcastVoiceState(restoredMuted,restoredDeafened);if(listenOnly)setError("Joined in listen-only mode. Use the microphone button when you are ready to allow access.");
    } catch (e) { setError(e instanceof Error ? e.message : "Microphone access is required to join."); local.current?.getTracks().forEach((t) => t.stop()); local.current = null; }
    finally { setBusy(false); }
  }
  async function toggleMute(){
    if(!local.current)return;
    const track=microphoneTrack.current;
    if(!track||track.readyState==="ended"){try{const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation,noiseSuppression,deviceId:micId==="default"?undefined:{exact:micId}},video:false}),nextTrack=media.getAudioTracks()[0];nextTrack.contentHint="speech";microphoneTrack.current=nextTrack;local.current.addTrack(nextTrack);if(sfuActive.current)await livekitRoom.current?.localParticipant.publishTrack(nextTrack,{source:LiveKitTrack.Source.Microphone,audioPreset:{maxBitrate:192_000}});await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.audio.replaceTrack(nextTrack);await tuneAudioSender(slot.audio)}));mutedRef.current=false;deafenedRef.current=false;setMuted(false);setDeafened(false);void broadcastVoiceState(false,false);setError("");await refreshDevices()}catch(e){mutedRef.current=true;setMuted(true);void broadcastVoiceState(true,deafened);setError(mediaPermissionDenied(e)?"Microphone access is blocked by this browser. You are still connected in listen-only mode.":(e as Error).message)}return;}
    const next=!muted;track.enabled=!next;mutedRef.current=next;setMuted(next);if(!next&&deafened){deafenedRef.current=false;setDeafened(false)}void broadcastVoiceState(next,next?deafened:false);
  }
  function toggleDeafen(){const next=!deafened,track=microphoneTrack.current;if(next){mutedBeforeDeafenRef.current=muted;track&&(track.enabled=false);mutedRef.current=true;deafenedRef.current=true;setMuted(true);setDeafened(true);void broadcastVoiceState(true,true);return}const restoreMuted=mutedBeforeDeafenRef.current;track&&(track.enabled=!restoreMuted);mutedRef.current=restoreMuted;deafenedRef.current=false;setMuted(restoreMuted);setDeafened(false);void broadcastVoiceState(restoreMuted,false)}
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
    if (old) { if(sfuActive.current)await livekitRoom.current?.localParticipant.unpublishTrack(old,false);old.stop(); local.current.removeTrack(old);cameraTrack.current=null;await Promise.all([...peerSlots.current.values()].map(slot=>slot.camera.replaceTrack(null)));await restoreMicrophoneAfterVideo();if(!sfuActive.current)await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:sharing})));setCamera(false); return; }
    try { const media = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(cameraId) }); const track = media.getVideoTracks()[0];track.contentHint="motion";cameraTrack.current=track; local.current.addTrack(track);if(sfuActive.current)await livekitRoom.current?.localParticipant.publishTrack(track,{source:LiveKitTrack.Source.Camera,simulcast:true});await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.camera.replaceTrack(track);await tuneCameraSender(slot.camera)})); setCamera(true); await refreshDevices();if(!sfuActive.current)await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:true}))); } catch (e) { setError((e as Error).message); }
  }
  async function changeMicrophone(id: string) {
    setMicId(id); if (!local.current) return;
    try { const media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id==="default"?undefined:{exact:id},echoCancellation,noiseSuppression},video:false}), next=media.getAudioTracks()[0], old=microphoneTrack.current;next.contentHint="speech";if(old&&sfuActive.current)await livekitRoom.current?.localParticipant.unpublishTrack(old,false);if(old)local.current.removeTrack(old); old?.stop();microphoneTrack.current=next; local.current.addTrack(next);if(sfuActive.current)await livekitRoom.current?.localParticipant.publishTrack(next,{source:LiveKitTrack.Source.Microphone,audioPreset:{maxBitrate:192_000}}); await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.audio.replaceTrack(next);await tuneAudioSender(slot.audio)})); } catch(e){setError(mediaPermissionDenied(e)?"Microphone access is blocked by this browser.":(e as Error).message);}
  }
  async function changeCamera(id: string) {
    setCameraId(id);if(!camera||!local.current)return;const old=cameraTrack.current,mobileFacing=id==="front"||id==="rear";
    try{
      if(mobileFacing&&old){if(sfuActive.current)await livekitRoom.current?.localParticipant.unpublishTrack(old,false);local.current.removeTrack(old);old.stop();cameraTrack.current=null;await Promise.all([...peerSlots.current.values()].map(slot=>slot.camera.replaceTrack(null)))}
      const media=await navigator.mediaDevices.getUserMedia({video:cameraConstraints(id),audio:false}),next=media.getVideoTracks()[0];next.contentHint="motion";
      if(old&&!mobileFacing){if(sfuActive.current)await livekitRoom.current?.localParticipant.unpublishTrack(old,false);local.current.removeTrack(old);old.stop()}cameraTrack.current=next;local.current.addTrack(next);if(sfuActive.current)await livekitRoom.current?.localParticipant.publishTrack(next,{source:LiveKitTrack.Source.Camera,simulcast:true});await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.camera.replaceTrack(next);await tuneCameraSender(slot.camera)}));setCamera(true);setError("");
    }catch(e){if(mobileFacing)setCamera(false);setError((e as Error).message)}
  }
  async function switchMobileCamera(){await changeCamera(cameraId==="rear"?"front":"rear")}
  async function openDesktopPicker(){const bridge=(window as typeof window&{aemeathDesktop?:DesktopBridge}).aemeathDesktop;if(!bridge)return false;setSourceLoading(true);setSourcePicker(true);try{const sources=await bridge.getCaptureSources();setDesktopSources(sources);if(!sources.some(item=>item.type===sourceTab))setSourceTab(sources.some(item=>item.type==="screen")?"screen":"window")}catch(e){setSourcePicker(false);setError((e as Error).message)}finally{setSourceLoading(false)}return true}
  async function shareScreen(sourceId?:string) {
    if (!local.current || screenTrack.current) return;
    try {
      setError("");
      const desktopBridge=(window as typeof window&{aemeathDesktop?:DesktopBridge}).aemeathDesktop;
      if(desktopBridge&&!sourceId){await openDesktopPicker();return}
      if(desktopBridge&&sourceId){const selected=await desktopBridge.selectCaptureSource(sourceId);if(!selected)throw new Error("That window is no longer available.");setSourcePicker(false)}
      const legacy=navigator as Navigator&{getDisplayMedia?:(constraints?:DisplayMediaStreamOptions)=>Promise<MediaStream>},capture=typeof navigator.mediaDevices?.getDisplayMedia==="function"?navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices):typeof legacy.getDisplayMedia==="function"?legacy.getDisplayMedia.bind(navigator):null;
      if(!capture){setStreamMenu(false);if(!camera)await toggleCamera();throw new Error("Screen sharing is unavailable in this mobile browser, so Aemeath opened your camera instead.");}
      const size=mobileDevice?{width:Math.max(screen.width,720),height:Math.max(screen.height,1280)}:streamQuality==="1440"?{width:2560,height:1440}:streamQuality==="720"?{width:1280,height:720}:{width:1920,height:1080},fps=mobileDevice?Math.min(streamFps,60):streamFps;
      const displayOptions=mobileDevice?{video:true,audio:false}:{video:{width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:fps,max:fps}},audio:true,surfaceSwitching:"include",systemAudio:"include"} as DisplayMediaStreamOptions;
      const media=await capture(displayOptions),sourceTrack=media.getVideoTracks()[0],displayAudio=media.getAudioTracks()[0]||null;
      if(!mobileDevice)await sourceTrack.applyConstraints({width:{ideal:size.width,max:size.width},height:{ideal:size.height,max:size.height},frameRate:{ideal:fps,max:fps}}).catch(()=>{});
      const track=sourceTrack;track.contentHint="detail";captureCleanup.current=()=>media.getTracks().forEach((item)=>item.stop());screenTrack.current=track;
      if(displayAudio){const mixed=mixShareAudio(microphoneTrack.current,displayAudio);screenAudioTrack.current=mixed.track;screenAudioCleanup.current=mixed.stop}else{screenAudioTrack.current=null;screenAudioCleanup.current=null}setError("");
      const outgoingAudio=screenAudioTrack.current;
      const restore=async()=>{if(screenTrack.current!==track)return;roomTone("stream-stop");if(sfuActive.current){await livekitRoom.current?.localParticipant.unpublishTrack(track,false);if(displayAudio)await livekitRoom.current?.localParticipant.unpublishTrack(displayAudio,false)}screenTrack.current=null;screenAudioTrack.current=null;stopSharingRef.current=null;captureCleanup.current?.();captureCleanup.current=null;screenAudioCleanup.current?.();screenAudioCleanup.current=null;local.current?.removeTrack(track);setSharing(false);setStreamMenu(false);const camera=cameraTrack.current,microphone=microphoneTrack.current;if(!sfuActive.current)await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:!!camera&&camera.readyState==="live"})));await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.screen.replaceTrack(null);await slot.audio.replaceTrack(microphone&&microphone.readyState==="live"?microphone:null);await tuneAudioSender(slot.audio)}));track.stop();displayAudio?.stop();setLocalPreview();};
      stopSharingRef.current=restore;
      sourceTrack.addEventListener("ended",()=>{void restore()},{once:true});
      local.current.addTrack(track);if(sfuActive.current){await livekitRoom.current?.localParticipant.publishTrack(track,{source:LiveKitTrack.Source.ScreenShare,simulcast:true});if(displayAudio)await livekitRoom.current?.localParticipant.publishTrack(displayAudio,{source:LiveKitTrack.Source.ScreenShareAudio})}await Promise.all([...peerSlots.current.values()].map(async slot=>{await slot.screen.replaceTrack(track);if(outgoingAudio)await slot.audio.replaceTrack(outgoingAudio);await tuneAudioSender(slot.audio);await tuneVideoSender(slot.screen,fps,streamQuality)}));
      setSharing(true);roomTone("stream-start");setLocalPreview(media);if(!sfuActive.current)await Promise.all(members.filter((p)=>p.id!==user.id).map((p)=>signal(p.id,{type:"stream-state",active:true})));
    } catch (e) { if ((e as DOMException).name !== "NotAllowedError") setError((e as Error).message); }
  }
  function setLocalPreview(stream:MediaStream|null=local.current){if(localVideo.current)localVideo.current.srcObject=stream}
  const autoJoinAttempted=useRef(false);useEffect(()=>{if(autoJoin&&!joined&&!busy&&!autoJoinAttempted.current){autoJoinAttempted.current=true;void join()}},[autoJoin,joined,busy]);
  useEffect(()=>{if(joined)onVoiceControls({muted,deafened,camera,sharing,toggleMute:()=>void toggleMute(),toggleDeafen,toggleCamera:()=>void toggleCamera(),toggleShare:()=>sharing?void stopSharingRef.current?.():void shareScreen(),invite:onInvite,leave:()=>void leave()});else onVoiceControls(null)},[joined,muted,deafened,camera,sharing]);
  const visibleMembers=members.filter(member=>!member.reconnecting),participantCount=Math.min(30,Math.max(1,visibleMembers.length)),columns=participantCount<=9?3:participantCount<=16?4:participantCount<=25?5:6,rows=participantCount<=9?3:participantCount<=16?4:5,hasStreams=sharing||camera||remoteSharing.size>0,streamingRemotes=remotes.filter(remote=>remoteSharing.has(remote.id)&&remote.stream.getVideoTracks().some(track=>track.readyState==="live")),remoteStreamIds=streamingRemotes.flatMap(remote=>remote.stream.getVideoTracks().filter(track=>track.readyState==="live").map(track=>`${remote.id}-${track.id}`)),streamIds=[...(sharing?[`${user.id}-screen`]:[]),...(camera?[`${user.id}-camera`]:[]),...remoteStreamIds],activeStream=streamIds.includes(focusedStream)?focusedStream:streamIds[0]||"",callTileCount=Math.min(31,visibleMembers.length+1),callColumns=callTileCount===1?1:callTileCount<=4?2:callTileCount<=9?3:4,callRows=Math.ceil(callTileCount/callColumns);
  const toggleStreamFocus=(id:string)=>{if(streamLayout==="focus"&&activeStream===id){setStreamLayout("tiles");setFocusedStream("")}else{setFocusedStream(id);setStreamLayout("focus")}};
  useEffect(()=>{if(!hasStreams){setStreamLayout("tiles");setFocusedStream("")}},[hasStreams]);
  return <section className={`voice-room${joined?" joined":""}${joined&&!hasStreams?" no-streams":""}`} data-transport={mediaTransport} style={{"--voice-columns":columns,"--voice-rows":rows,"--call-columns":callColumns,"--call-rows":callRows,"--call-count":callTileCount} as React.CSSProperties}>
    {takenOver&&<div className="voice-takeover" role="alert"><span>Your voice has been disconnected because you connected at another location.</span><button onClick={()=>void join()} disabled={busy}>{busy?"Reconnecting…":"Reconnect"}</button><button className="dismiss" aria-label="Dismiss" onClick={()=>setTakenOver(false)}><X size={18}/></button></div>}
    {sourcePicker&&<div className="desktop-stream-backdrop" onClick={()=>setSourcePicker(false)}><div className="desktop-stream-picker" role="dialog" aria-modal="true" aria-label="Choose what to stream" onClick={event=>event.stopPropagation()}><header><div><MonitorUp/><span><strong>Share your screen</strong><small>Choose a window or display to stream</small></span></div><button aria-label="Close stream picker" onClick={()=>setSourcePicker(false)}><X/></button></header><nav><button className={sourceTab==="window"?"active":""} onClick={()=>setSourceTab("window")}><AppWindow/> Applications</button><button className={sourceTab==="screen"?"active":""} onClick={()=>setSourceTab("screen")}><Monitor/> Entire screen</button></nav><div className="desktop-source-grid">{sourceLoading?<p>Finding shareable windows…</p>:desktopSources.filter(source=>source.type===sourceTab).map(source=><button key={source.id} onClick={()=>void shareScreen(source.id)}><span className="desktop-source-preview"><img src={source.thumbnail} alt=""/></span><strong>{source.icon&&<img src={source.icon} alt=""/>}{source.name}</strong></button>)}</div><footer><div><strong>Stream quality</strong><span>{streamQuality}p · {streamFps} FPS</span></div><div className="desktop-quality"><button className={streamQuality==="720"?"active":""} onClick={()=>setStreamQuality("720")}>720p</button><button className={streamQuality==="1080"?"active":""} onClick={()=>setStreamQuality("1080")}>1080p</button><button className={streamQuality==="1440"?"active":""} onClick={()=>setStreamQuality("1440")}>1440p</button><button className={streamFps===30?"active":""} onClick={()=>setStreamFps(30)}>30 FPS</button><button className={streamFps===60?"active":""} onClick={()=>setStreamFps(60)}>60 FPS</button></div></footer></div></div>}
    {!joined ? <div className="voice-empty"><div className="voice-orb"><VolumeIcon /></div><h1>{name}</h1><p>{members.filter(m=>!m.reconnecting).length?`${members.filter(m=>!m.reconnecting).length} ${members.filter(m=>!m.reconnecting).length===1?"person is":"people are"} in voice`:"No one is currently in voice"}</p>{members.length>0&&<div className="voice-waiting-members">{members.map((person)=>{const remaining=person.reconnecting?Math.max(0,10-Math.floor((clock-Number(person.left_at||clock))/1000)):0;return <div key={person.id}><span>{person.name.slice(0,2).toUpperCase()}</span><strong>{person.name}</strong><i className={person.reconnecting?"reconnecting":""}>{person.reconnecting?`Reconnecting · ${remaining}s`:"Connected"}</i></div>})}</div>}<button className="voice-join" disabled={busy} onClick={join}>{busy ? "Joining…" : members.some(m=>m.id===user.id&&m.reconnecting)?"Rejoin Voice":"Join Voice"}</button></div> : <>
      {(sharing||camera||remoteSharing.size>0)&&<div className={`stream-deck ${streamLayout}-view`}>
        {sharing&&<StreamCard id={`${user.id}-screen`} name={`${user.name}'s stream`} focused={activeStream===`${user.id}-screen`} onFocus={()=>toggleStreamFocus(`${user.id}-screen`)} onStop={()=>void stopSharingRef.current?.()} onChange={async()=>{await stopSharingRef.current?.();await shareScreen()}}><TrackVideo track={screenTrack.current} muted/></StreamCard>}
        {camera&&<StreamCard id={`${user.id}-camera`} name={`${user.name}'s camera`} focused={activeStream===`${user.id}-camera`} onFocus={()=>toggleStreamFocus(`${user.id}-camera`)} onStop={()=>void toggleCamera()}><TrackVideo track={cameraTrack.current} muted/></StreamCard>}
        {streamingRemotes.flatMap((remote)=>remote.stream.getVideoTracks().filter(track=>track.readyState==="live").map((track,index,tracks)=>{const tileId=`${remote.id}-${track.id}`,label=tracks.length>1?(index===0?"camera":"screen"):"stream";return <StreamCard key={tileId} id={tileId} name={`${remote.name}'s ${label}`} focused={activeStream===tileId} onFocus={()=>toggleStreamFocus(tileId)} onWatch={(active)=>void signal(remote.id,{type:"stream-watch",active})}><TrackVideo track={track} muted/></StreamCard>}))}
      </div>}
      <RemoteAudioMixer remotes={remotes} speakerId={speakerId} volumes={memberVolumes} deafened={deafened}/>
      <div className={"voice-grid "+((sharing||camera||remoteSharing.size)?"with-streams":"")}>
        <div className={`voice-tile local${speakingIds.has(user.id)&&!muted?" speaking":""}`}><div className="voice-avatar">{user.name.slice(0,2).toUpperCase()}</div>{(sharing||camera)&&<button className="watch-stream" onClick={()=>toggleStreamFocus(sharing?`${user.id}-screen`:`${user.id}-camera`)}><MonitorUp size={16}/> Watch Stream</button>}<span className="voice-name">{user.name}</span>{(muted||deafened)&&<span className="voice-state-icons" title={deafened?"Deafened":"Microphone muted"}>{deafened?<VolumeX size={16}/>:<MicOff size={16}/>}</span>}</div>
        {visibleMembers.filter(member=>member.id!==user.id).map((member) => {const remote=remotes.find(item=>item.id===member.id),state=participantStates[member.id],volume=memberVolumes[member.id]??100,memberStream=remoteStreamIds.find(id=>id.startsWith(`${member.id}-`));return <div className={`voice-tile participant${speakingIds.has(member.id)&&!state?.muted?" speaking":""}`} key={member.id} role="button" tabIndex={0} onClick={()=>setMemberMenu(current=>current===member.id?"":member.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setMemberMenu(current=>current===member.id?"":member.id)}}}><div className="voice-avatar">{member.name.slice(0,2).toUpperCase()}</div>{memberStream&&<button className="watch-stream" onClick={event=>{event.stopPropagation();toggleStreamFocus(memberStream)}}><MonitorUp size={16}/> Watch Stream</button>}<span className="voice-name">{member.name}{remote?"":" · Connecting…"}</span>{(state?.muted||state?.deafened)&&<span className="voice-state-icons" title={state.deafened?"Deafened":"Microphone muted"}>{state.deafened?<VolumeX size={16}/>:<MicOff size={16}/>}</span>}{memberMenu===member.id&&<div className="participant-volume-popover" onClick={event=>event.stopPropagation()}><header><strong>{member.name}</strong><small>{volume===0?"Muted":`${volume}%`}</small></header><label><Volume2 size={16}/><input aria-label={`${member.name} volume`} type="range" min="0" max="200" value={volume} onChange={event=>setMemberVolumes(old=>({...old,[member.id]:Number(event.target.value)}))}/></label><button className={volume===0?"active":""} onClick={()=>setMemberVolumes(old=>({...old,[member.id]:volume===0?100:0}))}>{volume===0?<Volume2 size={16}/>:<VolumeX size={16}/>} {volume===0?"Unmute":"Mute"}</button></div>}</div>})}
        {streamLayout==="tiles"&&<button className="voice-tile voice-invite-tile" onClick={onInvite}><span className="voice-invite-icon"><UserPlus size={24}/></span><strong>Invite to voice</strong><small>Bring someone into this lobby</small></button>}
      </div>
      <div className="voice-status"><Users size={15}/> {members.filter(m=>!m.reconnecting).length} connected</div>
      <div className="voice-controls"><button className={muted ? "off" : ""} aria-label={muted ? "Enable microphone" : "Mute"} onClick={()=>void toggleMute()}>{muted?<MicOff/>:<Mic/>}</button><button className={deafened ? "off" : ""} aria-label={deafened?"Undeafen":"Deafen"} onClick={toggleDeafen}>{deafened?<VolumeX/>:<Headphones/>}</button><button className={camera ? "active" : ""} aria-label="Toggle camera" onClick={toggleCamera}>{camera?<Camera/>:<CameraOff/>}</button>{mobileDevice&&camera&&<button className="active" aria-label="Switch between front and rear camera" title="Switch camera" onClick={()=>void switchMobileCamera()}><SwitchCamera/></button>}{(sharing||screenShareSupported)&&<div className={`stream-control${sharing?" sharing":""}`}><button className={sharing ? "active stream-main" : "stream-main"} aria-label={sharing?"Stop streaming":mobileDevice?"Share phone screen":"Share screen"} title={sharing?"Stop streaming":mobileDevice?"Share phone screen":"Share screen"} onClick={()=>sharing?void stopSharingRef.current?.():void shareScreen()}><MonitorUp/></button>{sharing&&<button className={`stream-menu-toggle${streamMenu?" active":""}`} aria-label="Open stream options" aria-expanded={streamMenu} onClick={()=>setStreamMenu(!streamMenu)}><ChevronUp size={14}/></button>}{streamMenu&&sharing&&<div className="stream-control-menu"><button onClick={()=>void stopSharingRef.current?.()}><X size={15}/> Stop streaming</button><button onClick={async()=>{await stopSharingRef.current?.();await shareScreen()}}><MonitorUp size={15}/> Change stream</button><div/><button onClick={()=>setError("Stream diagnostics are ready. Try another share source if the video is black.")}><MoreHorizontal size={15}/> Report a problem</button></div>}</div>}<button className={settings ? "active" : ""} aria-label="Voice settings" onClick={()=>{setSettings(!settings);void refreshDevices();}}><Settings/></button><button className="hangup" aria-label="Leave voice" onClick={leave}><PhoneOff/></button></div>
      {settings && <aside className="voice-settings"><header><div><strong>Voice, video & stream</strong><small>Choose how you join the room</small></div><button aria-label="Close voice settings" onClick={()=>setSettings(false)}><X size={18}/></button></header><label>Input device<select value={micId} onChange={(e)=>void changeMicrophone(e.target.value)}><option value="default">System default</option>{microphones.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Output device<select value={speakerId} onChange={(e)=>setSpeakerId(e.target.value)}><option value="default">System default</option>{speakers.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select></label><label>Camera<select value={cameraId} onChange={(e)=>void changeCamera(e.target.value)}>{mobileDevice?<><option value="front">Front camera</option><option value="rear">Rear camera</option></>:<><option value="default">System default</option>{cameras.map((d)=><option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</>}</select></label><div className="voice-stream-options"><label>Stream quality<select value={streamQuality} disabled={sharing} onChange={(e)=>setStreamQuality(e.target.value as StreamQuality)}><option value="1080">1080p · Smooth</option><option value="1440">1440p · High quality</option></select></label><label>Frame rate<select value={streamFps} disabled={sharing} onChange={(e)=>setStreamFps(Number(e.target.value))}><option value="60">60 FPS</option><option value="120">120 FPS</option></select></label></div><label className="voice-range">Input sensitivity <span>{sensitivity}%</span><input type="range" min="0" max="100" value={sensitivity} onChange={(e)=>setSensitivity(Number(e.target.value))}/></label><label className="voice-switch"><span><strong>Echo cancellation</strong><small>Reduce sound coming back through your microphone.</small></span><input type="checkbox" checked={echoCancellation} onChange={(e)=>setEchoCancellation(e.target.checked)}/></label><label className="voice-switch"><span><strong>Noise suppression</strong><small>Reduce fans, keyboards, and background noise.</small></span><input type="checkbox" checked={noiseSuppression} onChange={(e)=>setNoiseSuppression(e.target.checked)}/></label><p className="voice-settings-note">120 FPS depends on the shared display, browser, device encoder, and connection. Settings lock while a stream is live.</p></aside>}
    </>}    {error && <div className="voice-error" role="alert">{error}</div>}
  </section>;
}
function RemoteAudioMixer({remotes,speakerId,volumes,deafened}:{remotes:Remote[];speakerId:string;volumes:Record<string,number>;deafened:boolean}){
  const trackSignature=remotes.flatMap(remote=>remote.stream.getAudioTracks().map(track=>`${remote.id}:${track.id}:${track.readyState}`)).sort().join("|"),volumeSignature=JSON.stringify(volumes);
  useEffect(()=>{
    const context=getVoicePlaybackAudio() as AudioContext&{setSinkId?:(id:string)=>Promise<void>},compressor=context.createDynamicsCompressor(),nodes:AudioNode[]=[];
    compressor.threshold.value=-16;compressor.knee.value=20;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.2;compressor.connect(context.destination);nodes.push(compressor);
    const tracks=remotes.flatMap(remote=>remote.stream.getAudioTracks().map(track=>({remote,track}))).filter(item=>item.track.readyState==="live"),level=Math.min(1,1.35/Math.sqrt(Math.max(1,tracks.length)));
    for(const {remote,track} of tracks){const source=context.createMediaStreamSource(new MediaStream([track])),gain=context.createGain();gain.gain.value=deafened?0:level*((volumes[remote.id]??100)/100);source.connect(gain).connect(compressor);nodes.push(source,gain)}
    if(context.setSinkId)void context.setSinkId(speakerId).catch(()=>{});
    const play=()=>{void context.resume()};play();document.addEventListener("pointerdown",play,{passive:true});document.addEventListener("touchend",play,{passive:true});
    return()=>{document.removeEventListener("pointerdown",play);document.removeEventListener("touchend",play);nodes.forEach(node=>node.disconnect())};
  },[trackSignature,speakerId,volumeSignature,deafened,remotes,volumes]);
  return null;
}
function TrackVideo({track,muted=false}:{track:MediaStreamTrack|null;muted?:boolean}){const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{const video=ref.current;if(!video)return;video.srcObject=track?new MediaStream([track]):null;if(track)void video.play().catch(()=>{});return()=>{video.srcObject=null}},[track]);return <video ref={ref} autoPlay playsInline muted={muted}/>}
function StreamCard({name,focused,onFocus,onStop,onChange,onWatch,children}:{id:string;name:string;focused:boolean;onFocus:()=>void;onStop?:()=>void;onChange?:()=>void;onWatch?:(active:boolean)=>void;children:React.ReactNode}){const [menu,setMenu]=useState(false),[fullscreenActive,setFullscreenActive]=useState(false),card=useRef<HTMLElement>(null),fullscreenWatching=useRef(false);useEffect(()=>{const change=()=>{const active=document.fullscreenElement===card.current;setFullscreenActive(active);if(active!==fullscreenWatching.current){fullscreenWatching.current=active;onWatch?.(active)}};document.addEventListener("fullscreenchange",change);return()=>document.removeEventListener("fullscreenchange",change)},[onWatch]);const pip=async(element:HTMLElement)=>{const video=element.querySelector("video");if(video&&document.pictureInPictureEnabled){video.addEventListener("enterpictureinpicture",()=>onWatch?.(true),{once:true});video.addEventListener("leavepictureinpicture",()=>onWatch?.(false),{once:true});await video.requestPictureInPicture().catch(()=>{})}};const fullscreen=async()=>{if(document.fullscreenElement===card.current)await document.exitFullscreen().catch(()=>{});else await card.current?.requestFullscreen().catch(()=>{})};return <article ref={card} className={`stream-card${focused?" focused":""}`}><header><span><MonitorUp size={15}/><strong>{name}</strong><b>LIVE</b></span><div><button aria-label="Stream options" onClick={()=>setMenu(!menu)}><MoreHorizontal size={17}/></button></div>{menu&&<div className="stream-card-menu">{onStop&&<button onClick={onStop}>Stop streaming</button>}{onChange&&<button onClick={onChange}>Change stream</button>}<button onClick={(e)=>void pip(e.currentTarget.closest(".stream-card") as HTMLElement)}>Pop out</button></div>}</header><div className="stream-video" onClick={onFocus}>{children}<button className="stream-fullscreen" aria-label={fullscreenActive?"Exit stream fullscreen":"View stream fullscreen"} title={fullscreenActive?"Restore window":"Fullscreen"} onClick={(event)=>{event.stopPropagation();void fullscreen()}}>{fullscreenActive?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button></div></article>}
function VolumeIcon(){ return <span aria-hidden>◖))</span>; }

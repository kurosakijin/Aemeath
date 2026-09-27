"use client";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  X,
  Volume2,
  RefreshCw,
} from "lucide-react";
import { request, type LocalUser } from "@/lib/online";
import {notifyAemeath} from "@/lib/notifications";
type Call = {
  id: string;
  conversation: string;
  caller: string;
  callee: string;
  callerName?: string;
  kind: "voice" | "video";
  status: string;
  offer: string;
  answer: string | null;
  reason?: string;
};
const highQualityCamera=(facingMode:"user"|"environment"="user"):MediaTrackConstraints=>({facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60}});
async function tuneCallCamera(sender:RTCRtpSender|undefined){if(!sender)return;try{const parameters=sender.getParameters();parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];const encoding=parameters.encodings[0];encoding.maxBitrate=6_000_000;encoding.maxFramerate=30;encoding.scaleResolutionDownBy=1;(parameters as RTCRtpSendParameters&{degradationPreference?:string}).degradationPreference="maintain-resolution";await sender.setParameters(parameters)}catch{/* Mobile WebViews may select their own camera bitrate. */}}
type View = {
  id: string;
  name: string;
  kind: "voice" | "video";
  status: string;
  incoming?: Call;
};
const Context = createContext<{
  start: (conversation: string, name: string, kind: "voice" | "video") => void;
  active: boolean;
}>({ start: () => {}, active: false });
export const useCalls = () => useContext(Context);
async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", change);
      resolve();
    };
    const timeout = setTimeout(finish, 500);
    const change = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", change);
  });
}
export function CallProvider({
  user,
  children,
}: {
  user: LocalUser;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [muted, setMuted] = useState(false),
    [cameraOff, setCameraOff] = useState(false),
    [relay, setRelay] = useState(false),
    [remoteStream, setRemoteStream] = useState<MediaStream | null>(null),
    [localStream, setLocalStream] = useState<MediaStream | null>(null),
    [elapsed, setElapsed] = useState(0);
  const peer = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    active = useRef<View | null>(null),
    generation = useRef(0),
    started = useRef(0),
    remoteVideo = useRef<HTMLVideoElement>(null),
    localVideo = useRef<HTMLVideoElement>(null),
    ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pollBusy = useRef(false),
    heartbeatAt = useRef(0),
    alive = useRef(true),
    facing = useRef<"user" | "environment">("user"),
    lastAnswer = useRef("");
  const show = (v: View | null) => {
    active.current = v;
    setView(v);
  };
  const release = useCallback(() => {
    generation.current++;
    if (ringTimer.current) clearTimeout(ringTimer.current);
    if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    if (peer.current) {
      peer.current.onconnectionstatechange = null;
      peer.current.ontrack = null;
      peer.current.close();
      peer.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    started.current = 0;
    setElapsed(0);
    active.current = null;
    setView(null);
  }, []);
  const end = useCallback(
    async (reason = "ended") => {
      const id = active.current?.id;
      release();
      if (id)
        try {
          await request("/api/calls", { action: "end", id, reason });
        } catch {
          /* The server also expires disconnected calls. */
        }
    },
    [release],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const id = active.current?.id;
      if (id)
        void fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", id }),
          keepalive: true,
        });
      generation.current++;
      peer.current?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (ringTimer.current) clearTimeout(ringTimer.current);
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    };
  }, []);
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
    if (localVideo.current) localVideo.current.srcObject = localStream;
  }, [remoteStream, localStream, view?.kind]);
  useEffect(() => {
    if (!view || (!view.incoming && view.status !== "Ringing…")) return;
    let stopped = false,
      context: AudioContext | null = null,
      timer: ReturnType<typeof setInterval> | null = null;
    const ring = () => {
      if (stopped) return;
      context ??= new AudioContext();
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.frequency.value = view.incoming ? 880 : 440;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.34);
    };
    ring();
    timer = setInterval(ring, 1400);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      void context?.close();
    };
  }, [view?.id, view?.incoming, view?.status]);
  async function switchCamera() {
    const pc = peer.current,
      current = stream.current;
    if (!pc || !current) return;
    const nextFacing = facing.current === "user" ? "environment" : "user";
    const media = await navigator.mediaDevices.getUserMedia({
      video: highQualityCamera(nextFacing),
      audio: false,
    });
    const next = media.getVideoTracks()[0],
      previous = current.getVideoTracks()[0];
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    next.contentHint="motion";
    if (sender) {await sender.replaceTrack(next);await tuneCallCamera(sender)}
    else pc.addTrack(next, current);
    if (previous) {
      current.removeTrack(previous);
      previous.stop();
    }
    current.addTrack(next);
    facing.current = nextFacing;
    setLocalStream(new MediaStream(current.getTracks()));
  }
  async function upgradeToVideo() {
    const v = active.current,
      pc = peer.current,
      current = stream.current;
    if (!v || !pc || !current || v.kind !== "voice") return;
    const media = await navigator.mediaDevices.getUserMedia({
      video: highQualityCamera(),
      audio: false,
    });
    const track = media.getVideoTracks()[0];
    current.addTrack(track);
    track.contentHint="motion";const sender=pc.addTrack(track, current);await tuneCallCamera(sender);
    setLocalStream(new MediaStream(current.getTracks()));
    show({ ...v, kind: "video", status: "Adding video…" });
    await pc.setLocalDescription(await pc.createOffer());
    lastAnswer.current = "";
    await request("/api/calls", {
      action: "upgrade",
      id: v.id,
      offer: JSON.stringify(pc.localDescription),
    });
  }
  useEffect(() => {
    const t = setInterval(() => {
      if (started.current)
        setElapsed(Math.floor((Date.now() - started.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);
  async function setup(kind: "voice" | "video", version: number) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Calls need a browser with camera and microphone support over HTTPS.",
      );
    const config = await request<{
      iceServers: RTCIceServer[];
      relay: boolean;
    }>("/api/calls?config=1");
    if (version !== generation.current) throw new Error("Call cancelled.");
    setRelay(config.relay);
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video:
        kind === "video"
          ? {
              ...highQualityCamera(),
            }
          : false,
    });
    if (version !== generation.current || !alive.current) {
      media.getTracks().forEach((t) => t.stop());
      throw new Error("Call cancelled.");
    }
    stream.current = media;
    setLocalStream(media);
    const pc = new RTCPeerConnection({ iceServers: config.iceServers });
    peer.current = pc;
    media.getTracks().forEach((t) => {if(t.kind==="video")t.contentHint="motion";const sender=pc.addTrack(t, media);if(t.kind==="video")void tuneCallCamera(sender)});
    pc.ontrack = (e) => {
      if (version === generation.current)
        setRemoteStream(e.streams[0] || new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (version !== generation.current) return;
      if (pc.connectionState === "connected") {
        if (ringTimer.current) clearTimeout(ringTimer.current);
        if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
        if (!started.current) started.current = Date.now();
        show({ ...active.current!, status: "Connected" });
      }
      if (pc.connectionState === "disconnected") {
        show({ ...active.current!, status: "Reconnecting…" });
        disconnectTimer.current = setTimeout(() => {
          setError("The connection was lost. Please call again.");
          void end();
        }, 15000);
      }
      if (pc.connectionState === "failed") {
        setError(
          config.relay
            ? "Unable to connect the call. Please retry."
            : "The call could not connect on this network. A TURN relay may be needed.",
        );
        void end();
      }
    };
    return pc;
  }
  function explain(e: unknown) {
    if (e instanceof DOMException && e.name === "NotAllowedError")
      return "Camera or microphone permission was denied. Allow access in your browser and try again.";
    if (e instanceof DOMException && e.name === "NotFoundError")
      return "No microphone or camera was found. Check your device and try again.";
    return e instanceof Error ? e.message : "The call could not start.";
  }
  async function start(
    conversation: string,
    name: string,
    kind: "voice" | "video",
  ) {
    if (active.current) return;
    setError("");
    const version = ++generation.current;
    const id = crypto.randomUUID();
    show({
      id,
      name,
      kind,
      status:
        "Preparing your " + (kind === "video" ? "camera…" : "microphone…"),
    });
    try {
      const pc = await setup(kind, version);
      await pc.setLocalDescription(await pc.createOffer());
      if (version !== generation.current) return;
      await request("/api/calls", {
        action: "start",
        id,
        conversation,
        kind,
        offer: JSON.stringify(pc.localDescription),
      });
      if (version !== generation.current) {
        void request("/api/calls", { action: "end", id }).catch(() => {});
        return;
      }
      show({ id, name, kind, status: "Ringing…" });
      ringTimer.current = setTimeout(() => {
        setError("No answer. You can try again later.");
        void end();
      }, 60000);
    } catch (e) {
      if (version === generation.current) {
        setError(explain(e));
        await end();
      }
    }
  }
  async function answer() {
    const v = active.current;
    if (!v?.incoming) return;
    const version = ++generation.current;
    show({ ...v, status: "Connecting…", incoming: undefined });
    try {
      const pc = await setup(v.kind, version);
      await pc.setRemoteDescription(JSON.parse(v.incoming.offer));
      await pc.setLocalDescription(await pc.createAnswer());
      if (version !== generation.current) return;
      await request("/api/calls", {
        action: "answer",
        id: v.id,
        answer: JSON.stringify(pc.localDescription),
      });
      if (version !== generation.current) {
        void request("/api/calls", { action: "end", id: v.id }).catch(() => {});
        return;
      }
      ringTimer.current = setTimeout(() => {
        if (!started.current) {
          setError(
            "The call could not connect. Check your network and try again.",
          );
          void end();
        }
      }, 30000);
    } catch (e) {
      if (version === generation.current) {
        setError(explain(e));
        await end();
      }
    }
  }
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (pollBusy.current) return;
      pollBusy.current = true;
      try {
        const v = active.current;
        if (v) {
          if (v.status.startsWith("Preparing")) return;
          const data = await request<{ call: Call }>(
            "/api/calls?id=" + encodeURIComponent(v.id),
          );
          if (!mounted || active.current?.id !== v.id) return;
          const c = data.call;
          if (c.status === "ended") {
            if (c.reason === "declined")
              setError(v.name + " declined the call.");
            else if (c.reason === "missed")
              setError("No answer. Try again later.");
            release();
            return;
          }
          if (Date.now() - heartbeatAt.current > 10000) {
            heartbeatAt.current = Date.now();
            await request("/api/calls", { action: "heartbeat", id: v.id });
          }
          const pc = peer.current;
          if (c.status === "upgrading" && c.callee === user.id && pc) {
            await pc.setRemoteDescription(JSON.parse(c.offer));
            const camera = await navigator.mediaDevices.getUserMedia({
              video: highQualityCamera(),
              audio: false,
            });
            const track = camera.getVideoTracks()[0];
            stream.current?.addTrack(track);
            track.contentHint="motion";const sender=pc.addTrack(track, stream.current!);await tuneCallCamera(sender);
            setLocalStream(new MediaStream(stream.current!.getTracks()));
            await pc.setLocalDescription(await pc.createAnswer());
            await request("/api/calls", {
              action: "answer",
              id: c.id,
              answer: JSON.stringify(pc.localDescription),
            });
            show({ ...active.current!, kind: "video", status: "Connecting…" });
          }
          if (
            c.answer &&
            c.caller === user.id &&
            pc &&
            c.answer !== lastAnswer.current
          ) {
            await pc.setRemoteDescription(JSON.parse(c.answer));
            lastAnswer.current = c.answer;
            if (active.current?.id === v.id) {
              show({ ...active.current, status: "Connecting…" });
              if (ringTimer.current) clearTimeout(ringTimer.current);
              ringTimer.current = setTimeout(() => {
                if (!started.current) {
                  setError(
                    "The call could not connect. A relay may be required on this network.",
                  );
                  void end();
                }
              }, 30000);
            }
          }
        } else {
          const d = await request<{ incoming: Call | null }>("/api/calls");
          if (mounted && !active.current && d.incoming) {
            const c = d.incoming;
            void notifyAemeath({key:`call-${c.id}`,title:`Incoming ${c.kind} call`,body:`${c.callerName||"Someone"} is calling`,kind:"call"});
            setError("");
            show({
              id: c.id,
              name: c.callerName || "Someone",
              kind: c.kind,
              status: "Incoming " + c.kind + " call",
              incoming: c,
            });
          }
        }
      } catch (e) {
        if (active.current && !active.current.status.startsWith("Preparing")) {
          setError("Call connection interrupted. Retrying…");
        }
      } finally {
        pollBusy.current = false;
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [user.id, release, end]);
  useEffect(() => {
    const unload = () => {
      const id = active.current?.id;
      if (id)
        void fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", id }),
          keepalive: true,
        });
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    window.addEventListener("pagehide", unload);
    return () => window.removeEventListener("pagehide", unload);
  }, []);
  return (
    <Context.Provider value={{ start, active: !!view }}>
      {children}
      {error && (
        <div className="call-error" role="alert">
          <span>{error}</span>
          <button
            aria-label="Dismiss call message"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {view && (
        <section
          className="call-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={view.kind + " call with " + view.name}
        >
          <div className="call-heading">
            <span>
              {view.kind === "video" ? (
                <Video size={18} />
              ) : (
                <Phone size={18} />
              )}{" "}
              {view.kind === "video" ? "Video call" : "Voice call"}
            </span>
            <span>{relay ? "Relay available" : "Direct connection"}</span>
          </div>
          <div className="call-stage">
            {view.kind === "video" && remoteStream ? (
              <video
                className="remote-video"
                ref={remoteVideo}
                autoPlay
                playsInline
              />
            ) : (
              <div className="voice-person">
                <div>{view.name[0]?.toUpperCase()}</div>
                <h2>{view.name}</h2>
                <p>{view.status}</p>
              </div>
            )}
            {view.kind === "voice" && (
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className="audio-element"
              />
            )}
            {view.kind === "video" && localStream && (
              <video
                className="local-video"
                ref={localVideo}
                autoPlay
                muted
                playsInline
              />
            )}
          </div>
          <div className="call-caption">
            <strong>{view.name}</strong>
            <span>
              {view.status}
              {elapsed > 0
                ? " · " +
                  Math.floor(elapsed / 60) +
                  ":" +
                  String(elapsed % 60).padStart(2, "0")
                : ""}
            </span>
          </div>
          <div className="call-controls">
            {view.incoming ? (
              <>
                <button className="answer-call" onClick={answer}>
                  <Phone size={21} /> Answer
                </button>
                <button className="end-call" onClick={() => end("declined")}>
                  <PhoneOff size={21} /> Decline
                </button>
              </>
            ) : (
              <>
                <button
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                  aria-pressed={muted}
                  disabled={!localStream}
                  onClick={() => {
                    const next = !muted;
                    stream.current?.getAudioTracks().forEach((t) => {
                      t.enabled = !next;
                    });
                    setMuted(next);
                  }}
                >
                  {muted ? <MicOff /> : <Mic />}
                </button>
                {view.kind === "video" && (
                  <button
                    aria-label={
                      cameraOff ? "Turn camera on" : "Turn camera off"
                    }
                    aria-pressed={cameraOff}
                    disabled={!localStream}
                    onClick={() => {
                      const next = !cameraOff;
                      stream.current?.getVideoTracks().forEach((t) => {
                        t.enabled = !next;
                      });
                      setCameraOff(next);
                    }}
                  >
                    {cameraOff ? <VideoOff /> : <Video />}
                  </button>
                )}
                {view.kind === "voice" && !view.incoming && (
                  <button
                    aria-label="Turn on video"
                    title="Turn on video"
                    onClick={() => void upgradeToVideo()}
                  >
                    <Video />
                  </button>
                )}
                {view.kind === "video" && (
                  <button
                    aria-label="Switch camera"
                    title="Switch front or rear camera"
                    onClick={() => void switchCamera()}
                  >
                    <RefreshCw />
                  </button>
                )}
                <button
                  className="end-call"
                  onClick={() => end()}
                  aria-label="End call"
                >
                  <PhoneOff />
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </Context.Provider>
  );
}

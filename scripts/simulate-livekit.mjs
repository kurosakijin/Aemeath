import {readFileSync} from "node:fs";
import {AccessToken,RoomServiceClient} from "livekit-server-sdk";
import {AudioFrame,AudioSource,LocalAudioTrack,LocalVideoTrack,Room,RoomEvent,TrackKind,TrackPublishOptions,TrackSource,VideoBufferType,VideoFrame,VideoSource,dispose} from "@livekit/rtc-node";

function loadEnvironment(){
  for(const file of [".env.local",".env"]){
    try{for(const line of readFileSync(file,"utf8").split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2]}}catch{}
  }
}
function waitFor(check,timeout=25_000,label="condition"){
  return new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(check()){clearInterval(timer);resolve()}else if(Date.now()-started>timeout){clearInterval(timer);reject(new Error(`Timed out waiting for ${label}.`))}},100)});
}
async function tokenFor(apiKey,apiSecret,room,identity){const token=new AccessToken(apiKey,apiSecret,{identity,name:identity,ttl:"10m"});token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true});return token.toJwt()}
function syntheticAudio(index){
  const sampleRate=48_000,samples=960,source=new AudioSource(sampleRate,1),track=LocalAudioTrack.createAudioTrack(`microphone-${index}`,source);let phase=0,active=true;
  const pump=async()=>{while(active){const data=new Int16Array(samples),frequency=220+index*37;for(let i=0;i<samples;i++){data[i]=Math.round(Math.sin(phase)*2200);phase+=2*Math.PI*frequency/sampleRate}await source.captureFrame(new AudioFrame(data,sampleRate,1,samples));await new Promise(resolve=>setTimeout(resolve,20))}};void pump();
  return{track,stop:async()=>{active=false;await track.close()}};
}
function syntheticVideo(index,name,sourceKind){
  const width=320,height=180,source=new VideoSource(width,height),track=LocalVideoTrack.createVideoTrack(name,source),pixels=new Uint8Array(width*height*4);let frame=0,active=true;
  const timer=setInterval(()=>{if(!active)return;for(let i=0;i<pixels.length;i+=4){pixels[i]=(index*53+frame)%255;pixels[i+1]=(i/4+frame*3)%255;pixels[i+2]=(index*97)%255;pixels[i+3]=255}source.captureFrame(new VideoFrame(pixels,width,height,VideoBufferType.RGBA));frame++},100);
  return{track,sourceKind,stop:async()=>{active=false;clearInterval(timer);await track.close()}};
}
async function publish(room,media){for(const item of media){const options=new TrackPublishOptions();options.source=item.sourceKind;await room.localParticipant.publishTrack(item.track,options)}}

loadEnvironment();
const url=process.env.LIVEKIT_URL,apiKey=process.env.LIVEKIT_API_KEY,apiSecret=process.env.LIVEKIT_API_SECRET,count=Math.max(2,Math.min(30,Number(process.argv[2]||5)));
if(!url||!apiKey||!apiSecret)throw new Error("LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required.");
const roomName=`simulation-${Date.now()}`,service=new RoomServiceClient(url.replace(/^wss:/,"https:"),apiKey,apiSecret),rooms=[],media=[],subscriptions=new Map();
console.log(`Starting isolated ${count}-participant LiveKit simulation…`);
try{
  await service.createRoom({name:roomName,maxParticipants:30,emptyTimeout:60,departureTimeout:20,metadata:JSON.stringify({purpose:"automated-media-simulation"})});
  for(let index=0;index<count;index++){
    const identity=`sim-${index+1}`,room=new Room(),audio=syntheticAudio(index),tracks=[{...audio,sourceKind:TrackSource.SOURCE_MICROPHONE}];
    if(index<Math.min(2,count))tracks.push(syntheticVideo(index,`camera-${index+1}`,TrackSource.SOURCE_CAMERA));
    if(index===0)tracks.push(syntheticVideo(index,"screen-share",TrackSource.SOURCE_SCREENSHARE));
    subscriptions.set(identity,{audio:new Set(),video:new Set(),expectedVideo:index===0?1:index===1?2:3});
    room.on(RoomEvent.TrackSubscribed,(track,publication,participant)=>{const bucket=subscriptions.get(identity),key=publication.sid||`${participant.identity}-${track.name}`;(track.kind===TrackKind.KIND_AUDIO?bucket.audio:bucket.video).add(key)});
    await room.connect(url,await tokenFor(apiKey,apiSecret,roomName,identity),{autoSubscribe:true,dynacast:true});
    rooms.push({identity,room});media.push(...tracks);await publish(room,tracks);
  }
  await waitFor(()=>[...subscriptions.values()].every(value=>value.audio.size>=count-1),30_000,"every participant to receive every remote microphone");
  await waitFor(()=>[...subscriptions.values()].every(value=>value.video.size>=value.expectedVideo),30_000,"camera and screen subscriptions");
  const listed=await service.listParticipants(roomName);
  if(listed.length!==count)throw new Error(`Expected ${count} connected participants, found ${listed.length}.`);
  const first=rooms[0],replacement=new Room();let displaced=false;first.room.on(RoomEvent.Disconnected,()=>{displaced=true});
  await replacement.connect(url,await tokenFor(apiKey,apiSecret,roomName,first.identity),{autoSubscribe:true,dynacast:true});
  await waitFor(()=>displaced,15_000,"duplicate-device takeover");
  await replacement.disconnect();
  console.log(`PASS: ${count} participants connected through the SFU.`);
  console.log(`PASS: ${count*(count-1)} concurrent remote microphone subscriptions became active.`);
  console.log("PASS: synthetic cameras and screen sharing were published and subscribed.");
  console.log("PASS: duplicate-device takeover disconnected the older session.");
}finally{
  await Promise.allSettled(rooms.map(({room})=>room.disconnect()));
  await Promise.allSettled(media.map(item=>item.stop()));
  await service.deleteRoom(roomName).catch(()=>{});
  await dispose();
}

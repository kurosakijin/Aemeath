"use client";

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

type NoticeKind = "call" | "message" | "join";
let prepared = false;
let audio: AudioContext | null = null;
const notificationPromptKey = "aemeath.notifications.prompted.v1";

function notificationPromptRemembered() {
  try {
    return localStorage.getItem(notificationPromptKey) === "1" || document.cookie.split(";").some((part) => part.trim().startsWith(`${notificationPromptKey}=`));
  } catch { return false; }
}

function rememberNotificationPrompt() {
  try { localStorage.setItem(notificationPromptKey, "1"); } catch {}
  try { document.cookie = `${notificationPromptKey}=1; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch {}
}

function noticeId(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return Math.abs(hash || Date.now()) % 2147483647;
}

export async function prepareNotifications() {
  if (prepared || typeof window === "undefined") return;
  prepared = true;
  try {
    if (Capacitor.isNativePlatform()) {
      const current = await LocalNotifications.checkPermissions();
      if (current.display !== "granted" && !notificationPromptRemembered()) {
        rememberNotificationPrompt();
        await LocalNotifications.requestPermissions();
      }
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") return;
      await LocalNotifications.createChannel({id:"aemeath-events",name:"Calls and messages",description:"Incoming calls, new messages, and voice-room activity",importance:5,visibility:1,vibration:true,sound:"default"});
    } else if ("Notification" in window && Notification.permission === "default" && !notificationPromptRemembered()) {
      rememberNotificationPrompt();
      await Notification.requestPermission();
    }
  } catch { /* A failed or dismissed prompt stays remembered instead of interrupting every visit. */ }
}

export function armNotifications() {
  if (typeof document === "undefined") return;
  const enable = () => void prepareNotifications();
  document.addEventListener("pointerdown", enable, { once: true, passive: true });
  document.addEventListener("keydown", enable, { once: true });
  if (Capacitor.isNativePlatform()) void prepareNotifications();
}

export function notificationTone(kind: NoticeKind) {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const notes = kind === "call" ? [659.25, 783.99] : kind === "join" ? [392, 523.25, 659.25] : [880, 1174.66];
    const now = audio.currentTime + .01;
    notes.forEach((frequency, index) => {
      const oscillator = audio!.createOscillator(), gain = audio!.createGain(), start = now + index * .1;
      oscillator.type = kind === "call" ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, start);gain.gain.exponentialRampToValueAtTime(kind === "call" ? .15 : .08, start + .015);gain.gain.exponentialRampToValueAtTime(.0001, start + .3);
      oscillator.connect(gain).connect(audio!.destination);oscillator.start(start);oscillator.stop(start + .32);
    });
  } catch { /* Audio is optional when the platform blocks playback. */ }
}

export async function notifyAemeath({key,title,body,kind="message"}:{key:string;title:string;body:string;kind?:NoticeKind}) {
  notificationTone(kind);
  try {
    if (Capacitor.isNativePlatform()) {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") return;
      await LocalNotifications.schedule({notifications:[{id:noticeId(key),title,body,channelId:"aemeath-events",sound:"default",schedule:{at:new Date(Date.now()+100)}}]});
      return;
    }
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification(title,{body,icon:"/favicon.svg",tag:key});
    }
  } catch { /* Notifications must never interrupt chat or calls. */ }
}

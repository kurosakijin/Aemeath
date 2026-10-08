import { database } from "@/db/raw";
import { runtimeEnv } from "@/lib/server/runtime-env";
import {
  AppError,
  json,
  failure,
  input,
  str,
  requireAccount,
  throttle,
} from "@/lib/server/auth";
import { participant } from "../direct/route";
export const dynamic = "force-dynamic";
type Call = {
  id: string;
  caller: string;
  callee: string;
  status: string;
  offer: string | null;
  answer: string | null;
  kind: string;
  created: number;
  caller_seen: number;
  callee_seen: number;
};
async function expire() {
  const now = Date.now();
  const db = database();
  await db.batch([
    db
      .prepare(
        "UPDATE calls SET status='ended',reason='missed',offer=NULL,answer=NULL WHERE status='ringing' AND created<?",
      )
      .bind(now - 60000),
    db
      .prepare(
        "UPDATE calls SET status='ended',reason='disconnected',offer=NULL,answer=NULL WHERE status='active' AND (caller_seen<? OR callee_seen<?)",
      )
      .bind(now - 90000, now - 90000),
    db
      .prepare(
        `DELETE FROM call_locks WHERE expires<? OR "call" IN (SELECT id FROM calls WHERE status='ended')`,
      )
      .bind(now),
  ]);
}
async function callFor(id: string, user: string) {
  const c = await database()
    .prepare("SELECT * FROM calls WHERE id=? AND (caller=? OR callee=?)")
    .bind(id, user, user)
    .first<Call>();
  if (!c) throw new AppError("Call not found.", 404);
  return c;
}
export async function GET(r: Request) {
  try {
    const u = await requireAccount();
    const p = new URL(r.url).searchParams;
    if (p.has("config")) {
      let iceServers: RTCIceServer[] = [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
          ],
        },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ];
      let relay = true;
      const raw = runtimeEnv("ICE_SERVERS_JSON");
      if (raw) {
        const extra = JSON.parse(raw) as RTCIceServer[];
        if (Array.isArray(extra)) {
          iceServers = [...iceServers, ...extra];
          relay = extra.some((s) =>
            (Array.isArray(s.urls) ? s.urls : [s.urls]).some(
              (url) => url.startsWith("turn:") || url.startsWith("turns:"),
            ),
          );
        }
      }
      return json({ iceServers, relay });
    }
    const id = p.get("id");
    const db = database();
    if (id) {
      const c = await callFor(id, u.id);
      return json({ call: c });
    }
    const c = await db
      .prepare(
        "SELECT c.*,a.username AS callerName FROM calls c JOIN accounts a ON a.id=c.caller WHERE c.callee=? AND c.status='ringing' ORDER BY c.created DESC LIMIT 1",
      )
      .bind(u.id)
      .first();
    return json({ incoming: c });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    const u = await requireAccount();
    const d = await input(r, 150000);
    const db = database();
    const now = Date.now();
    if (d.action === "start") {
      await throttle("call-start:" + u.id, 8, 60000);
      const conversation = str(d.conversation);
      const conv = await participant(conversation, u.id);
      const peer = conv.first === u.id ? conv.second : conv.first;
      const offer = str(d.offer);
      const id = str(d.id);
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        !offer ||
        offer.length > 100000 ||
        !["voice", "video"].includes(str(d.kind))
      )
        throw new AppError("Invalid call.");
      try {
        const description = JSON.parse(offer);
        if (description.type !== "offer" || typeof description.sdp !== "string")
          throw 0;
      } catch {
        throw new AppError("Invalid call offer.");
      }
      const existing = await db
        .prepare("SELECT id FROM calls WHERE id=? AND caller=?")
        .bind(id, u.id)
        .first();
      if (existing) return json({ id });
      try {
        await db.batch([
          db
            .prepare(
              "INSERT INTO calls (id,conversation,caller,callee,kind,status,offer,created,updated,caller_seen,callee_seen) VALUES (?,?,?,?,?,'ringing',?,?,?,?,?)",
            )
            .bind(
              id,
              conversation,
              u.id,
              peer,
              str(d.kind),
              offer,
              now,
              now,
              now,
              now,
            ),
        ]);
      } catch (e) {
        if (String(e).includes("UNIQUE"))
          throw new AppError("You or this person is already in a call.", 409);
        throw e;
      }
      return json({ id });
    }
    const id = str(d.id);
    const c = await callFor(id, u.id);
    if (d.action === "end") {
      await db.batch([
        db
          .prepare(
            "UPDATE calls SET status='ended',reason=?,offer=NULL,answer=NULL,updated=? WHERE id=?",
          )
          .bind(d.reason === "declined" ? "declined" : "ended", now, id),
        db.prepare('DELETE FROM call_locks WHERE "call"=?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (d.action === "heartbeat") {
      if (c.status === "ended") return json({ ok: true });
      await db.batch([
        db
          .prepare(
            u.id === c.caller
              ? "UPDATE calls SET caller_seen=? WHERE id=?"
              : "UPDATE calls SET callee_seen=? WHERE id=?",
          )
          .bind(now, id),
        db
          .prepare('UPDATE call_locks SET expires=? WHERE user=? AND "call"=?')
          .bind(now + 90000, u.id, id),
      ]);
      return json({ ok: true });
    }
    if (d.action === "upgrade") {
      if (u.id !== c.caller || c.status !== "active")
        throw new AppError("This call cannot be upgraded.", 409);
      const offer = str(d.offer);
      try {
        const value = JSON.parse(offer);
        if (value.type !== "offer" || typeof value.sdp !== "string") throw 0;
      } catch {
        throw new AppError("Invalid video offer.");
      }
      await db
        .prepare(
          "UPDATE calls SET kind='video',status='upgrading',offer=?,answer=NULL,updated=? WHERE id=?",
        )
        .bind(offer, now, id)
        .run();
      return json({ ok: true });
    }
    if (d.action === "answer") {
      if (u.id !== c.callee)
        throw new AppError("Only the recipient can answer.", 403);
      if (
        !["ringing", "upgrading"].includes(c.status) ||
        (c.status === "ringing" && c.created < now - 60000)
      )
        throw new AppError("This call is no longer ringing.", 409);
      const answer = str(d.answer);
      try {
        const a = JSON.parse(answer);
        if (
          a.type !== "answer" ||
          typeof a.sdp !== "string" ||
          answer.length > 100000
        )
          throw 0;
      } catch {
        throw new AppError("Invalid call answer.");
      }
      const result = await db
        .prepare(
          "UPDATE calls SET answer=?,status='active',updated=?,callee_seen=? WHERE id=? AND status IN ('ringing','upgrading')",
        )
        .bind(answer, now, now, id)
        .run();
      if (!result.meta.changes)
        throw new AppError("Call already answered or ended.", 409);
      return json({ ok: true });
    }
    throw new AppError("Unknown action.");
  } catch (e) {
    return failure(e);
  }
}

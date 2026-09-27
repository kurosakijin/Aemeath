import { database } from "@/db/raw";
import {
  AppError,
  json,
  failure,
  input,
  str,
  requireAccount,
  throttle,
} from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function participant(id: string, user: string) {
  const row = await database()
    .prepare("SELECT * FROM conversations WHERE id=? AND (first=? OR second=?)")
    .bind(id, user, user)
    .first<{ id: string; first: string; second: string }>();
  if (!row) throw new AppError("Conversation not found.", 404);
  return row;
}
export async function GET(r: Request) {
  try {
    const u = await requireAccount();
    const db = database();
    const p = new URL(r.url).searchParams;
    const search = p.get("username");
    if (search !== null) {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(search.trim()))
        return json({ people: [] });
      const person = await db
        .prepare(
          "SELECT id,username AS name FROM accounts WHERE username_key=? AND id<>?",
        )
        .bind(search.trim().toLowerCase(), u.id)
        .first();
      return json({ people: person ? [person] : [] });
    }
    const id = p.get("conversation");
    if (id) {
      await participant(id, u.id);
      const before = Number(p.get("before") || Date.now() + 1);
      if (!Number.isFinite(before)) throw new AppError("Invalid cursor.");
      const rows = await db
        .prepare(
          "SELECT m.*,a.username AS name FROM direct_messages m JOIN accounts a ON a.id=m.sender WHERE m.conversation=? AND m.created<? ORDER BY m.created DESC,m.id DESC LIMIT 100",
        )
        .bind(id, before)
        .all();
      return json({
        messages: rows.results.reverse(),
        hasMore: rows.results.length === 100,
      });
    }
    const list = await db
      .prepare(
        "SELECT c.id,c.updated,a.id AS peer,a.username AS name,(SELECT CASE WHEN body LIKE 'aemeath:image:%' THEN 'Sent an image' ELSE body END FROM direct_messages WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS preview,(SELECT status FROM calls WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS call_status,(SELECT reason FROM calls WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS call_reason,(SELECT kind FROM calls WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS call_kind,(SELECT caller FROM calls WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS call_caller,(SELECT created FROM calls WHERE conversation=c.id ORDER BY created DESC LIMIT 1) AS call_created FROM conversations c JOIN accounts a ON a.id=CASE WHEN c.first=? THEN c.second ELSE c.first END WHERE c.first=? OR c.second=? ORDER BY c.updated DESC",
      )
      .bind(u.id, u.id, u.id)
      .all();
    return json({ conversations: list.results });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    const u = await requireAccount();
    const d = await input(r,420000);
    const db = database();
    if (d.action === "start") {
      await throttle("dm-start:" + u.id, 30, 60000);
      const peer = str(d.peer);
      if (peer === u.id) throw new AppError("Choose another person.");
      const other = await db
        .prepare("SELECT id FROM accounts WHERE id=?")
        .bind(peer)
        .first();
      if (!other) throw new AppError("Account not found.", 404);
      const pair = [u.id, peer].sort();
      const id = crypto.randomUUID();
      const now = Date.now();
      await db
        .prepare(
          "INSERT INTO conversations (id,first,second,pair,created,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(pair) DO NOTHING",
        )
        .bind(id, pair[0], pair[1], pair.join(":"), now, now)
        .run();
      const c = await db
        .prepare("SELECT id FROM conversations WHERE pair=?")
        .bind(pair.join(":"))
        .first();
      return json(c);
    }
    if (d.action === "send") {
      await throttle("dm-send:" + u.id, 80, 60000);
      const id = str(d.conversation);
      await participant(id, u.id);
      const body = str(d.body).trim(),
        messageId = str(d.id);
      const image=body.startsWith("aemeath:image:data:image/");
      if (!body || (!image&&body.length>4000) || (image&&body.length>400000) || !/^[a-f0-9-]{36}$/.test(messageId))
        throw new AppError("Send up to 4,000 characters or one compressed image.");
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            "INSERT INTO direct_messages (id,conversation,sender,body,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(messageId, id, u.id, body, now),
        db
          .prepare("UPDATE conversations SET updated=? WHERE id=?")
          .bind(now, id),
      ]);
      return json({ ok: true });
    }
    throw new AppError("Unknown action.");
  } catch (e) {
    return failure(e);
  }
}

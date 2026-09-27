import { chatUser as getChatGPTUser } from "@/lib/server/auth";
import { database } from "@/db/raw";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const bad = (message: string, status = 400) => json({ error: message }, status);
async function membership(server: string, user: string) {
  return database()
    .prepare(
      "SELECT s.* FROM servers s JOIN members m ON m.server=s.id WHERE s.id=? AND m.user=?",
    )
    .bind(server, user)
    .first<{ id: string; name: string; owner: string }>();
}
export async function GET(request: Request) {
  try {
    const db = database();
    const url = new URL(request.url);
    const inviteCode = url.searchParams.get("invite");
    if (inviteCode) {
      if (!/^[a-f0-9]{12,32}$/.test(inviteCode)) return bad("This invitation link is invalid.");
      const invite = await db.prepare(`SELECT i.code,i.expires,s.id,s.name,s.icon,s.banner,COALESCE(p.name,'A friend') AS inviter,(SELECT COUNT(*) FROM members m WHERE m.server=s.id) AS members FROM invites i JOIN servers s ON s.id=i.server LEFT JOIN profiles p ON p.id=s.owner WHERE i.code=? AND i.expires>?`).bind(inviteCode,Date.now()).first();
      if (!invite) return bad("This invite has expired or is no longer available.",404);
      return json({invite});
    }
    const user = await getChatGPTUser();
    if (!user) return bad("Please sign in to continue.", 401);
    const server = url.searchParams.get("server");
    const channel = url.searchParams.get("channel");
    if (channel) {
      const allowed = await db
        .prepare(
          "SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m.user=?",
        )
        .bind(channel, user.userId)
        .first();
      if (!allowed) return bad("This channel is unavailable.", 403);
      const after = Number(url.searchParams.get("after") || 0);
      const incremental = Number.isFinite(after) && after > 0;
      const rows = incremental
        ? await db.prepare("SELECT m.*,p.name FROM messages m LEFT JOIN profiles p ON p.id=m.user WHERE m.channel=? AND m.created>? ORDER BY m.created,m.id LIMIT 50").bind(channel,after).all()
        : await db.prepare("SELECT m.*,p.name FROM messages m LEFT JOIN profiles p ON p.id=m.user WHERE m.channel=? ORDER BY m.created DESC,m.id DESC LIMIT 50").bind(channel).all();
      return json({ messages: incremental ? rows.results : rows.results.reverse() });
    }
    if (server) {
      const allowed = await membership(server, user.userId);
      if (!allowed) return bad("This server is unavailable.", 403);
      const [cs, ms] = await Promise.all([
        db
          .prepare("SELECT * FROM channels WHERE server=? ORDER BY created,id")
          .bind(server)
          .all(),
        db
          .prepare(
            "SELECT m.user as id,p.name,m.joined FROM members m LEFT JOIN profiles p ON p.id=m.user WHERE m.server=? ORDER BY m.joined",
          )
          .bind(server)
          .all(),
      ]);
      return json({
        server: allowed,
        channels: cs.results,
        members: ms.results,
      });
    }
    const list = await db
      .prepare(
        "SELECT s.* FROM servers s JOIN members m ON m.server=s.id WHERE m.user=? ORDER BY s.created",
      )
      .bind(user.userId)
      .all();
    const profile = await db
      .prepare("SELECT name FROM profiles WHERE id=?")
      .bind(user.userId)
      .first();
    return json({ servers: list.results, profile });
  } catch (error) {
    console.error("Chat read failed", error);
    return bad("Could not load your conversations. Please try again.", 503);
  }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return bad("Please sign in to continue.", 401);
    if (Number(request.headers.get("content-length") || 0) > 700000)
      return bad("That request is too large.");
    let data;
    try {
      const raw = await request.text();
      if (raw.length > 700000) return bad("That request is too large.");
      data = JSON.parse(raw);
    } catch {
      return bad("Invalid request.");
    }
    const db = database();
    const now = Date.now();
    const uid = user.userId;
    const action = data.action;
    const defaultName = user.fullName || user.email.split("@")[0];
    await db
      .prepare(
        "INSERT INTO profiles (id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(uid, defaultName.slice(0, 40))
      .run();
    if (action === "profile") {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name || name.length > 40)
        return bad("Choose a name between 1 and 40 characters.");
      await db
        .prepare("UPDATE profiles SET name=? WHERE id=?")
        .bind(name, uid)
        .run();
      return json({ ok: true });
    }
    if (action === "create") {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name || name.length > 50)
        return bad("Choose a server name between 1 and 50 characters.");
      const id = crypto.randomUUID();
      const channel = crypto.randomUUID();
      await db.batch([
        db
          .prepare(
            "INSERT INTO servers (id,name,owner,created) VALUES (?,?,?,?)",
          )
          .bind(id, name, uid, now),
        db
          .prepare("INSERT INTO members (server,user,joined) VALUES (?,?,?)")
          .bind(id, uid, now),
        db
          .prepare(
            "INSERT INTO channels (id,server,name,created) VALUES (?,?,?,?)",
          )
          .bind(channel, id, "general", now),
      ]);
      return json({ id, channel });
    }
    if (action === "join") {
      const code = typeof data.code === "string" ? data.code.trim() : "";
      if (!/^[a-f0-9]{12,32}$/.test(code))
        return bad("Enter a valid invitation code.");
      const invite = await db
        .prepare("SELECT server FROM invites WHERE code=? AND expires>?")
        .bind(code, now)
        .first<{ server: string }>();
      if (!invite)
        return bad("This invite has expired or is no longer available.");
      await db
        .prepare(
          "INSERT INTO members (server,user,joined) VALUES (?,?,?) ON CONFLICT(server,user) DO NOTHING",
        )
        .bind(invite.server, uid, now)
        .run();
      return json({ id: invite.server });
    }
    if (action === "message") {
      const body = typeof data.body === "string" ? data.body.trim() : "";
      const image=/^aemeath:image:(?:spoiler:)?data:image\//.test(body);
      if (!body || (!image&&body.length>4000) || (image&&body.length>400000))
        return bad("Send up to 4,000 characters or one compressed image.");
      if (
        typeof data.channel !== "string" ||
        typeof data.id !== "string" ||
        !/^[-a-f0-9]{36}$/.test(data.id)
      )
        return bad("Invalid message.");
      const allowed = await db
        .prepare(
          "SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m.user=?",
        )
        .bind(data.channel, uid)
        .first();
      if (!allowed) return bad("You do not have access to this channel.", 403);
      await db
        .prepare(
          "INSERT INTO messages (id,channel,user,body,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(data.id, data.channel, uid, body, now)
        .run();
      return json({ ok: true });
    }
    if(action==="delete-message"){
      const id=typeof data.id==="string"?data.id:"";
      const found=await db.prepare("SELECT m.user,c.server FROM messages m JOIN channels c ON c.id=m.channel WHERE m.id=?").bind(id).first<{user:string;server:string}>();
      if(!found)return bad("Message not found.",404);
      const target=await membership(found.server,uid);
      if(!target||(found.user!==uid&&target.owner!==uid))return bad("You cannot delete this message.",403);
      await db.prepare("DELETE FROM messages WHERE id=?").bind(id).run();
      return json({ok:true});
    }
    if (typeof data.server !== "string") return bad("Choose a server.");
    const server = await membership(data.server, uid);
    if (!server || server.owner !== uid)
      return bad("Only the server owner can do that.", 403);
    if (action === "edit-server") {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      const icon = typeof data.icon === "string" ? data.icon : "";
      const banner = typeof data.banner === "string" ? data.banner : "#ff5ca8";
      const traits = Array.isArray(data.traits) ? data.traits.map((v:unknown)=>String(v).trim()).filter(Boolean).slice(0,5).join("|") : "";
      if (!name || name.length > 50) return bad("Choose a server name between 1 and 50 characters.");
      if (icon.length > 600000 || (icon && !icon.startsWith("data:image/"))) return bad("Choose a valid server image under 400 KB.");
      if (!/^#[0-9a-f]{6}$/i.test(banner)) return bad("Choose a valid banner color.");
      await db.prepare("UPDATE servers SET name=?,icon=?,banner=?,traits=? WHERE id=?").bind(name,icon,banner,traits,server.id).run();
      return json({ok:true});
    }
    if (action === "channel") {
      const name =
        typeof data.name === "string"
          ? data.name.trim().toLowerCase().replace(/\s+/g, "-")
          : "";
      const kind = ["text", "voice", "forum"].includes(data.kind)
        ? data.kind
        : "text";
      const topic =
        typeof data.topic === "string" ? data.topic.trim().slice(0, 1000) : "";
      if (!/^[a-z0-9_-]{1,32}$/.test(name))
        return bad("Use 1–32 letters, numbers, hyphens, or underscores.");
      const exists = await db
        .prepare("SELECT id FROM channels WHERE server=? AND name=?")
        .bind(server.id, name)
        .first();
      if (exists) return bad("A channel with that name already exists.");
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO channels (id,server,name,kind,topic,created) VALUES (?,?,?,?,?,?)",
        )
        .bind(id, server.id, name, kind, topic, now)
        .run();
      return json({ id });
    }
    if (action === "edit-channel") {
      const id = typeof data.channel === "string" ? data.channel : "";
      const name =
        typeof data.name === "string"
          ? data.name.trim().toLowerCase().replace(/\s+/g, "-")
          : "";
      const kind = ["text", "voice", "forum"].includes(data.kind)
        ? data.kind
        : "text";
      const topic =
        typeof data.topic === "string" ? data.topic.trim().slice(0, 1000) : "";
      if (!/^[a-z0-9_-]{1,32}$/.test(name))
        return bad("Use 1–32 letters, numbers, hyphens, or underscores.");
      const found = await db
        .prepare("SELECT id FROM channels WHERE id=? AND server=?")
        .bind(id, server.id)
        .first();
      if (!found) return bad("Channel not found.", 404);
      await db
        .prepare("UPDATE channels SET name=?,kind=?,topic=? WHERE id=?")
        .bind(name, kind, topic, id)
        .run();
      return json({ ok: true });
    }
    if (action === "delete-channel") {
      const id = typeof data.channel === "string" ? data.channel : "";
      const count = await db
        .prepare("SELECT COUNT(*)::int AS count FROM channels WHERE server=?")
        .bind(server.id)
        .first<{ count: number }>();
      if ((count?.count || 0) <= 1)
        return bad("A server must keep at least one channel.");
      await db.batch([
        db.prepare("DELETE FROM messages WHERE channel=?").bind(id),
        db.prepare("DELETE FROM voice_presence WHERE channel=?").bind(id),
        db.prepare("DELETE FROM voice_signals WHERE channel=?").bind(id),
        db
          .prepare("DELETE FROM channels WHERE id=? AND server=?")
          .bind(id, server.id),
      ]);
      return json({ ok: true });
    }
    if (action === "invite") {
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
      await db
        .prepare("INSERT INTO invites (code,server,expires) VALUES (?,?,?)")
        .bind(code, server.id, now + 7 * 86400000)
        .run();
      return json({ code });
    }
    return bad("Unknown action.");
  } catch (error) {
    console.error("Chat write failed", error);
    return bad(
      "Could not save your changes. Your input is still here; please try again.",
      503,
    );
  }
}

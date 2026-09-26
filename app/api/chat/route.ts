import {chatUser as getChatGPTUser} from '@/lib/server/auth';
import {database} from '@/db/raw';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const bad=(message:string,status=400)=>json({error:message},status);
async function membership(server:string,user:string){return database().prepare('SELECT s.* FROM servers s JOIN members m ON m.server=s.id WHERE s.id=? AND m.user=?').bind(server,user).first<{id:string;name:string;owner:string}>();}
export async function GET(request:Request){
 try{
 const user=await getChatGPTUser();if(!user)return bad('Please sign in to continue.',401);
 const db=database();const url=new URL(request.url);const server=url.searchParams.get('server');const channel=url.searchParams.get('channel');
 if(channel){const allowed=await db.prepare('SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m.user=?').bind(channel,user.userId).first();if(!allowed)return bad('This channel is unavailable.',403);
 const rows=await db.prepare('SELECT m.*,p.name FROM messages m LEFT JOIN profiles p ON p.id=m.user WHERE m.channel=? ORDER BY m.created DESC,m.id DESC LIMIT 200').bind(channel).all();return json({messages:rows.results.reverse()});}
 if(server){const allowed=await membership(server,user.userId);if(!allowed)return bad('This server is unavailable.',403);
 const [cs,ms]=await Promise.all([db.prepare('SELECT * FROM channels WHERE server=? ORDER BY created,id').bind(server).all(),db.prepare('SELECT m.user as id,p.name,m.joined FROM members m LEFT JOIN profiles p ON p.id=m.user WHERE m.server=? ORDER BY m.joined').bind(server).all()]);return json({server:allowed,channels:cs.results,members:ms.results});}
 const list=await db.prepare('SELECT s.* FROM servers s JOIN members m ON m.server=s.id WHERE m.user=? ORDER BY s.created').bind(user.userId).all();const profile=await db.prepare('SELECT name FROM profiles WHERE id=?').bind(user.userId).first();return json({servers:list.results,profile});
 }catch(error){console.error('Chat read failed',error);return bad('Could not load your conversations. Please try again.',503);}
}
export async function POST(request:Request){
 try{
 const user=await getChatGPTUser();if(!user)return bad('Please sign in to continue.',401);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return bad('Request not allowed.',403);
 if(Number(request.headers.get('content-length')||0)>12000)return bad('That request is too large.');
 let data;try{const raw=await request.text();if(raw.length>12000)return bad('That request is too large.');data=JSON.parse(raw);}catch{return bad('Invalid request.');}
 const db=database();const now=Date.now();const uid=user.userId;const action=data.action;
 const defaultName=user.fullName||user.email.split('@')[0];await db.prepare('INSERT INTO profiles (id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING').bind(uid,defaultName.slice(0,40)).run();
 if(action==='profile'){const name=typeof data.name==='string'?data.name.trim():'';if(!name||name.length>40)return bad('Choose a name between 1 and 40 characters.');await db.prepare('UPDATE profiles SET name=? WHERE id=?').bind(name,uid).run();return json({ok:true});}
 if(action==='create'){const name=typeof data.name==='string'?data.name.trim():'';if(!name||name.length>50)return bad('Choose a server name between 1 and 50 characters.');const id=crypto.randomUUID();const channel=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO servers (id,name,owner,created) VALUES (?,?,?,?)').bind(id,name,uid,now),db.prepare('INSERT INTO members (server,user,joined) VALUES (?,?,?)').bind(id,uid,now),db.prepare('INSERT INTO channels (id,server,name,created) VALUES (?,?,?,?)').bind(channel,id,'general',now)]);return json({id,channel});}
 if(action==='join'){const code=typeof data.code==='string'?data.code.trim():'';if(!/^[a-f0-9]{32}$/.test(code))return bad('Enter a valid invitation code.');const invite=await db.prepare('SELECT server FROM invites WHERE code=? AND expires>?').bind(code,now).first<{server:string}>();if(!invite)return bad('This invite has expired or is no longer available.');await db.prepare('INSERT INTO members (server,user,joined) VALUES (?,?,?) ON CONFLICT(server,user) DO NOTHING').bind(invite.server,uid,now).run();return json({id:invite.server});}
 if(action==='message'){const body=typeof data.body==='string'?data.body.trim():'';if(!body||body.length>4000)return bad('Messages must be between 1 and 4,000 characters.');if(typeof data.channel!=='string'||typeof data.id!=='string'||!/^[-a-f0-9]{36}$/.test(data.id))return bad('Invalid message.');const allowed=await db.prepare('SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m.user=?').bind(data.channel,uid).first();if(!allowed)return bad('You do not have access to this channel.',403);await db.prepare('INSERT INTO messages (id,channel,user,body,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(data.id,data.channel,uid,body,now).run();return json({ok:true});}
 if(typeof data.server!=='string')return bad('Choose a server.');const server=await membership(data.server,uid);if(!server||server.owner!==uid)return bad('Only the server owner can do that.',403);
 if(action==='channel'){const name=typeof data.name==='string'?data.name.trim().toLowerCase().replace(/\s+/g,'-'):'';if(!/^[a-z0-9_-]{1,32}$/.test(name))return bad('Use 1–32 letters, numbers, hyphens, or underscores.');const exists=await db.prepare('SELECT id FROM channels WHERE server=? AND name=?').bind(server.id,name).first();if(exists)return bad('A channel with that name already exists.');const id=crypto.randomUUID();await db.prepare('INSERT INTO channels (id,server,name,created) VALUES (?,?,?,?)').bind(id,server.id,name,now).run();return json({id});}
 if(action==='invite'){const code=crypto.randomUUID().replaceAll('-','');await db.prepare('INSERT INTO invites (code,server,expires) VALUES (?,?,?)').bind(code,server.id,now+7*86400000).run();return json({code});}
 return bad('Unknown action.');
 }catch(error){console.error('Chat write failed',error);return bad('Could not save your changes. Your input is still here; please try again.',503);}
}


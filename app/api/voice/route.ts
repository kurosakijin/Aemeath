import {database} from '@/db/raw';
import {AppError,json,failure,input,str,requireAccount} from '@/lib/server/auth';
export const dynamic='force-dynamic';

async function allowed(channel:string,user:string){const row=await database().prepare('SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m."user"=?').bind(channel,user).first();if(!row)throw new AppError('This voice channel is unavailable.',403)}

export async function GET(request:Request){
  try{
    const user=await requireAccount(),p=new URL(request.url).searchParams,channel=str(p.get('channel')),session=str(p.get('session'));await allowed(channel,user.id);
    const db=database(),after=Number(p.get('after')||0),now=Date.now();
    await Promise.all([db.prepare('DELETE FROM voice_presence WHERE updated<? OR ("left">0 AND "left"<?)').bind(now-30000,now-10000).run(),db.prepare('DELETE FROM voice_signals WHERE created<?').bind(now-120000).run()]);
    const [members,signals,owner]=await Promise.all([
      db.prepare('SELECT v."user" as id,a.username as name,v."left" as left_at,CASE WHEN v."left">0 THEN 1 ELSE 0 END as reconnecting FROM voice_presence v JOIN accounts a ON a.id=v."user" WHERE v.channel=? ORDER BY v.joined').bind(channel).all(),
      db.prepare('SELECT * FROM voice_signals WHERE channel=? AND "to"=? AND created>? ORDER BY created').bind(channel,user.id,after).all(),
      db.prepare('SELECT session,"left" FROM voice_presence WHERE channel=? AND "user"=?').bind(channel,user.id).first<{session:string;left:number}>(),
    ]);
    return json({members:members.results,signals:signals.results,now,displaced:!!session&&!!owner&&owner.session!==session&&Number(owner.left)===0});
  }catch(e){return failure(e)}
}

export async function POST(request:Request){
  try{
    const user=await requireAccount(),data=await input(request,120000),channel=str(data.channel),session=str(data.session);await allowed(channel,user.id);if(!session||session.length>100)throw new AppError('Invalid voice session.');
    const db=database(),now=Date.now();
    if(data.action==='join'){
      const existing=await db.prepare('SELECT 1 FROM voice_presence WHERE channel=? AND "user"=? AND ("left"=0 OR "left">?)').bind(channel,user.id,now-10000).first();
      if(!existing){const count=await db.prepare('SELECT COUNT(*)::int AS count FROM voice_presence WHERE channel=? AND ("left"=0 OR "left">?) AND updated>?').bind(channel,now-10000,now-20000).first<{count:number}>();if((count?.count||0)>=30)throw new AppError('This voice channel is full (30 people).',409)}
      await db.prepare('DELETE FROM voice_signals WHERE channel=? AND "to"=?').bind(channel,user.id).run();
      await db.prepare('INSERT INTO voice_presence (channel,"user",joined,updated,"left",session) VALUES (?,?,?,?,0,?) ON CONFLICT(channel,"user") DO UPDATE SET joined=EXCLUDED.joined,updated=EXCLUDED.updated,"left"=0,session=EXCLUDED.session').bind(channel,user.id,now,now,session).run();return json({ok:true});
    }
    if(data.action==='heartbeat'){const result=await db.prepare('UPDATE voice_presence SET updated=?,"left"=0 WHERE channel=? AND "user"=? AND session=?').bind(now,channel,user.id,session).run();return json({ok:true,active:result.meta.changes>0})}
    if(data.action==='leave'){await db.prepare('UPDATE voice_presence SET updated=?,"left"=? WHERE channel=? AND "user"=? AND session=? AND "left"=0').bind(now,now,channel,user.id,session).run();return json({ok:true})}
    if(data.action==='signal'){
      const active=await db.prepare('SELECT 1 FROM voice_presence WHERE channel=? AND "user"=? AND session=? AND "left"=0').bind(channel,user.id,session).first();if(!active)throw new AppError('This voice session moved to another device.',409);
      const to=str(data.to),body=str(data.body);if(!to||!body||body.length>100000)throw new AppError('Invalid voice signal.');await db.prepare('INSERT INTO voice_signals (id,channel,"from","to",body,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),channel,user.id,to,body,now).run();return json({ok:true});
    }
    throw new AppError('Unknown voice action.');
  }catch(e){return failure(e)}
}

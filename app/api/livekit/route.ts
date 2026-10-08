import {AccessToken} from "livekit-server-sdk";
import {database} from "@/db/raw";
import {runtimeEnv} from '@/lib/server/runtime-env';
import {AppError,failure,json,requireAccount,str} from "@/lib/server/auth";

export const dynamic="force-dynamic";

export async function GET(request:Request){
  try{
    const user=await requireAccount();
    const channel=str(new URL(request.url).searchParams.get("channel"));
    if(!channel)throw new AppError("A voice channel is required.");
    const member=await database().prepare('SELECT c.id FROM channels c JOIN members m ON m.server=c.server WHERE c.id=? AND m."user"=?').bind(channel,user.id).first();
    if(!member)throw new AppError("This voice channel is unavailable.",403);
    const url=runtimeEnv('LIVEKIT_URL'),apiKey=runtimeEnv('LIVEKIT_API_KEY'),apiSecret=runtimeEnv('LIVEKIT_API_SECRET');
    if(!url||!apiKey||!apiSecret)return json({enabled:false});
    const token=new AccessToken(apiKey,apiSecret,{identity:user.id,name:user.name,ttl:"2h"});
    token.addGrant({roomJoin:true,room:`voice-${channel}`,canPublish:true,canSubscribe:true,canPublishData:true});
    return json({enabled:true,url,token:await token.toJwt()});
  }catch(error){return failure(error)}
}

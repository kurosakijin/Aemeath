
import {scrypt,timingSafeEqual,randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {database} from '@/db/raw';
export class AppError extends Error{constructor(message:string,public status=400){super(message)}}
export function json(data:unknown,status=200,extra:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}})}
export function failure(e:unknown){if(e instanceof AppError)return json({error:e.message},e.status);console.error('Request failed',e instanceof Error?e.message:'unknown');return json({error:'The service is temporarily unavailable. Please try again.'},503)}
const trustedOrigins=['https://hearth-personal-chat.a4jin69.chatgpt.site','https://aemeath.vercel.app','https://aemeath-ltfah621q-kurosakijins-projects.vercel.app'];
function trusted(origin:string|null,current:string){return !origin||origin===current||trustedOrigins.includes(origin)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)}
export async function input(r:Request,max=12000){if(!r.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Expected JSON.',415);const raw=await r.text();if(raw.length>max)throw new AppError('Request too large.',413);try{const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw 0;return d as Record<string,unknown>;}catch{throw new AppError('Invalid request.')}}
export const str=(v:unknown)=>typeof v==='string'?v:'';
export const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function hashPassword(password:string,salt:string){return new Promise<string>((resolve,reject)=>scrypt(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024},(e,key)=>e?reject(e):resolve(key.toString('hex'))));}
export async function verifyPassword(password:string,salt:string,hash:string){const result=await hashPassword(password,salt);return timingSafeEqual(Buffer.from(result,'hex'),Buffer.from(hash,'hex'));}
export async function sessionHash(){const jar=await cookies();const token=jar.get('hearth_session')?.value;return token&&/^[a-f0-9]{64}$/.test(token)?digest(token):null;}
export async function getAccount(){const hash=await sessionHash();if(!hash)return null;return database().prepare('SELECT a.id,a.username AS name,a.email FROM accounts a JOIN auth_sessions s ON s.user=a.id WHERE s.hash=? AND s.expires>?').bind(hash,Date.now()).first<{id:string;name:string;email:string}>();}
export async function requireAccount(){const u=await getAccount();if(!u)throw new AppError('Please log in to continue.',401);return u;}
export async function chatUser(){const u=await getAccount();return u?{userId:u.id,fullName:u.name,email:u.email}:null;}
export function sessionCookie(token:string,request:Request,clear=false){return `hearth_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:604800}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function startSession(id:string){const token=randomBytes(32).toString('hex');await database().prepare('INSERT INTO auth_sessions (hash,user,expires) VALUES (?,?,?)').bind(digest(token),id,Date.now()+604800000).run();return token;}
export async function throttle(scope:string,limit:number,window=900000){const key=digest(scope);const now=Date.now();const r=await database().prepare('INSERT INTO auth_limits (key,hits,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_limits.expires<? THEN 1 ELSE auth_limits.hits+1 END,expires=CASE WHEN auth_limits.expires<? THEN excluded.expires ELSE auth_limits.expires END RETURNING hits').bind(key,now+window,now,now).first<{hits:number}>();if((r?.hits||0)>limit)throw new AppError('Too many attempts. Please try again in a few minutes.',429);}
export function validateAccount(name:string,email:string,password?:string){if(!/^[a-zA-Z0-9_]{3,24}$/.test(name))throw new AppError('Use 3–24 letters, numbers, or underscores.');if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('Enter a valid email.');if(password!==undefined&&(password.length<8||password.length>128))throw new AppError('Use 8–128 characters for your password.');}


'use client';
import type {ChatResult} from './local-prototype';
export type LocalUser={id:string;name:string;email:string};
export function usernameError(value:string){return /^[a-zA-Z0-9_]{3,24}$/.test(value.trim())?'':'Use 3–24 letters, numbers, or underscores.';}
export async function request<T=Record<string,unknown>>(url:string,data?:unknown):Promise<T>{const r=await fetch(url,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,cache:'no-store',credentials:'same-origin'});const payload=await r.json() as T&{error?:string};if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('aemeath-session-expired'));throw new Error(payload.error||'Unable to connect. Please try again.');}return payload;}
export async function currentUser(){return (await request<{user:LocalUser|null}>('/api/account')).user;}
export async function usernameAvailable(username:string,_excludeId?:string){return (await request<{available:boolean}>('/api/account?username='+encodeURIComponent(username))).available;}
export async function register(username:string,email:string,password:string){return (await request<{user:LocalUser}>('/api/account',{action:'register',username,email,password})).user;}
export async function login(identifier:string,password:string){return (await request<{user:LocalUser}>('/api/account',{action:'login',identifier,password})).user;}
export async function logout(){await request('/api/account',{action:'logout'});}
export async function updateAccount(username:string,email:string,currentPassword:string,newPassword:string){return (await request<{user:LocalUser}>('/api/account',{action:'update',username,email,currentPassword,newPassword})).user;}
export async function onlineChat(path='',data?:Record<string,unknown>){return request<ChatResult>('/api/chat'+path,data);}

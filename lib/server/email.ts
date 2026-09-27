import {AppError} from "./auth";

export function emailVerificationEnabled(){return Boolean(process.env.RESEND_API_KEY&&process.env.AUTH_EMAIL_FROM)}

export async function sendVerificationCode(email:string,code:string,purpose:"register"|"login"){
  if(!emailVerificationEnabled())throw new AppError("Email verification is not configured.",503);
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.AUTH_EMAIL_FROM,to:[email],subject:purpose==="register"?"Verify your Aemeath email":"Your Aemeath login code",html:`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#201c22;color:#f6eef2;border-radius:16px"><h1 style="margin:0 0 16px;color:#ff66ad">Aemeath</h1><p>${purpose==="register"?"Use this code to finish creating your account.":"Use this code to finish signing in."}</p><div style="font-size:34px;font-weight:800;letter-spacing:9px;padding:20px 0">${code}</div><p style="color:#aaa1a8">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`})});
  if(!response.ok)throw new AppError("We could not send the verification email. Please try again.",503);
}

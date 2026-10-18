import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {createOwnerSessionRouter,getOwnerSession,ownerSessionBindingActive,requireOwnerSession,type OwnerSessionContext} from '../../server/security/ownerSession';

type Reply={status:number;data:any;setCookie:string|null};
export interface MobileOwnerSessionFixture {
 context:OwnerSessionContext;
 pairingOwner:{bindingId:string;expiresAt:string};
 pairingOwnerFor(ttlMs:number):{bindingId:string;expiresAt:string};
 origin:string;cookie:string;headers:Record<string,string>;
 request(route:string,body?:unknown,headers?:Record<string,string>,method?:string):Promise<Reply>;
 logout():Promise<Reply>;
 rotate():Promise<Reply>;
 close():Promise<void>;
}
let cached:MobileOwnerSessionFixture|undefined;
let creating:Promise<MobileOwnerSessionFixture>|undefined;
/** Real owner-cookie/CSRF login. Same-process callers reuse the original LIVE owner; no authority mock. */
export async function getMobileOwnerSessionFixture():Promise<MobileOwnerSessionFixture>{
 assert.equal(process.env.EDITH_TEST_MODE,'true');assert.ok(process.env.EDITH_TEST_DATA_DIR);
 if(cached&&ownerSessionBindingActive(cached.context.bindingId))return cached;
 if(creating)return creating;
 creating=createFixture();try{cached=await creating;return cached;}finally{creating=undefined;}
}
async function createFixture():Promise<MobileOwnerSessionFixture>{
 const token=randomBytes(32).toString('hex');
 const app=express();app.use(express.json());app.use(createOwnerSessionRouter());
 let captured:OwnerSessionContext|undefined;
 app.get('/fixture-owner-context',requireOwnerSession,(req,res)=>{captured=getOwnerSession(req);res.json({success:true});});
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 let closed=false;
 const fixture={} as MobileOwnerSessionFixture;
 fixture.origin=origin;fixture.cookie='';fixture.headers={};
 fixture.request=async(route,body,headers=fixture.headers,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),setCookie:response.headers.get('set-cookie')};
 };
 fixture.pairingOwnerFor=ttlMs=>({bindingId:fixture.context.bindingId,expiresAt:new Date(Math.min(fixture.context.expiresAt,Date.now()+ttlMs)).toISOString()});
 fixture.close=async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};
 fixture.logout=()=>fixture.request('/api/security/session',undefined,fixture.headers,'DELETE');
 fixture.rotate=async()=>{
  const prior=process.env.EDITH_OWNER_TOKEN;
  process.env.EDITH_OWNER_TOKEN=token;
  try{
   const response=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer '+token}});
   const data=await response.json() as any;
   if(response.status===201){
    fixture.cookie=response.headers.get('set-cookie')!.split(';')[0];
    fixture.headers={origin,cookie:fixture.cookie,'content-type':'application/json','x-edith-csrf-token':data.session.csrfToken};
    captured=undefined;assert.equal((await fixture.request('/fixture-owner-context')).status,200);
    const readCaptured=():OwnerSessionContext|undefined=>captured;const capturedOwner=readCaptured();assert.ok(capturedOwner);
    fixture.context=capturedOwner;fixture.pairingOwner={bindingId:capturedOwner.bindingId,expiresAt:new Date(capturedOwner.expiresAt).toISOString()};
    assert.equal(ownerSessionBindingActive(capturedOwner.bindingId),true);
   }
   return {status:response.status,data,setCookie:response.headers.get('set-cookie')};
  }finally{if(prior===undefined)delete process.env.EDITH_OWNER_TOKEN;else process.env.EDITH_OWNER_TOKEN=prior;}
 };
 try{assert.equal((await fixture.rotate()).status,201);return fixture;}catch(error){await fixture.close();throw error;}
}

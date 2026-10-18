type Fetcher = typeof fetch;
export type PushEnvironment = Record<string,string|undefined>;
export class PushError extends Error { constructor(readonly code: string, readonly status = 400, readonly retryable = false) { super(code); } }
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function bytes(value: string): Uint8Array { return Uint8Array.from(atob(value),char => char.charCodeAt(0)); }
function url64(value: Uint8Array): string { return base64(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
const encoder = new TextEncoder();
function identity(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new PushError('PUSH_INPUT_INVALID'); return value; }
function exact(value: any, fields: string[]): void { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new PushError('PUSH_INPUT_INVALID'); }

/** Default fetch performs real Supabase, OAuth and FCM HTTP calls; no provider SDK or injected production sender. */
export class PushService {
  private oauth?: {token:string;expiresAt:number};
  constructor(private readonly env: PushEnvironment, private readonly fetcher: Fetcher = fetch, private readonly now = Date.now) {}
  private configured(sender = false): void {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_ANON_KEY || !this.env.SUPABASE_SERVICE_ROLE_KEY || !this.env.EDITH_PUSH_TOKEN_KEY || (sender && (!this.env.FCM_PROJECT_ID || !this.env.FCM_CLIENT_EMAIL || !this.env.FCM_PRIVATE_KEY))) throw new PushError('CONFIGURATION_REQUIRED',503);
    if (!/^https:\/\//.test(this.env.SUPABASE_URL) || (sender && !/^[A-Za-z0-9-]{1,100}$/.test(this.env.FCM_PROJECT_ID!))) throw new PushError('CONFIGURATION_REQUIRED',503);
  }
  async handle(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') throw new PushError('METHOD_NOT_ALLOWED',405);
      this.configured();
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new PushError('PUSH_INPUT_INVALID');
      // Bound the stream before JSON parsing; Content-Length alone is not trusted.
      const reader=request.body?.getReader(); if (!reader) throw new PushError('PUSH_INPUT_INVALID');
      const parts:Uint8Array[]=[];let size=0;
      for (;;) { const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();throw new PushError('PAYLOAD_TOO_LARGE',413);}parts.push(part.value); }
      const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
      let body:any;try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); } catch { throw new PushError('PUSH_INPUT_INVALID'); }
      const authorization=request.headers.get('authorization');if(!authorization || !/^Bearer \S+$/.test(authorization))throw new PushError('AUTH_REQUIRED',401);
      const user = await this.authenticate(authorization);
      if (body?.action === 'register' || body?.action === 'revoke') {
        exact(body,body.action==='register' ? ['action','deviceId','registrationToken','consent'] : ['action','deviceId']);
        const deviceId=identity(body.deviceId);
        if(body.action==='register' && (body.consent!==true || typeof body.registrationToken!=='string' || !/^[A-Za-z0-9:_.-]{10,4096}$/.test(body.registrationToken)))throw new PushError('PUSH_REGISTRATION_INVALID');
        const encrypted=body.action==='register' ? await this.encrypt(body.registrationToken,user.id,deviceId) : {ciphertext:'',iv:''};
        const result=await this.rpc('edith_push_register',{p_user_id:user.id,p_device_id:deviceId,p_ciphertext:encrypted.ciphertext,p_iv:encrypted.iv,p_revoke:body.action==='revoke'});
        return this.response(200,{success:true,registered:result.registered===true,revoked:result.revoked===true,provider:'fcm',delivered:false});
      }
      exact(body,['deviceId','eventId','kind','resourceId']);
      const deviceId=identity(body.deviceId),eventId=identity(body.eventId),resourceId=identity(body.resourceId);
      if(!['task','transfer'].includes(body.kind) || request.headers.get('idempotency-key')!==eventId)throw new PushError('PUSH_INPUT_INVALID');
      this.configured(true);
      // Acquire OAuth before reserving a send. OAuth failures cannot create ambiguous provider sends.
      const accessToken=await this.accessToken();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([deviceId,eventId,body.kind,resourceId]))))].map(value=>value.toString(16).padStart(2,'0')).join('');
      const claim=await this.rpc('edith_push_claim',{p_user_id:user.id,p_device_id:deviceId,p_event_id:eventId,p_kind:body.kind,p_resource_id:resourceId,p_fingerprint:hash});
      if(claim.state==='accepted' && typeof claim.receiptId==='string')return this.response(202,{success:true,accepted:true,receiptId:claim.receiptId,delivered:false,deduplicated:true});
      if(claim.state==='retry_wait')throw new PushError('PUSH_RETRY_WAIT',429,true);
      if(claim.state==='rejected')throw new PushError('PUSH_PREVIOUSLY_REJECTED',410);
      if(claim.state!=='claimed')throw new PushError('PUSH_OUTCOME_UNKNOWN',409);
      const finish=async(state:string,receipt:string|null=null,retrySeconds=60,revoke=false) => {
        try { return await this.rpc('edith_push_finish',{p_user_id:user.id,p_device_id:deviceId,p_event_id:eventId,p_attempt_id:claim.attemptId,p_version:claim.version,p_state:state,p_receipt_id:receipt,p_retry_seconds:retrySeconds,p_revoke:revoke}); }
        catch { throw new PushError('PUSH_OUTCOME_UNKNOWN',409); }
      };
      let registrationToken:string;
      try { registrationToken=await this.decrypt(claim,user.id,deviceId); } catch { await finish('rejected');throw new PushError('PUSH_REGISTRATION_INVALID',503); }
      let response:Response;
      try {
        response=await this.fetcher(`https://fcm.googleapis.com/v1/projects/${this.env.FCM_PROJECT_ID}/messages:send`,{method:'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify({message:{token:registrationToken,data:{eventId,kind:body.kind,resourceId},android:{priority:'normal',ttl:'300s'}}}),signal:AbortSignal.timeout(8000)});
      } catch {
        await finish('unknown');throw new PushError('PUSH_OUTCOME_UNKNOWN',409);
      }
      let result:any;
      try { result=await response.json(); } catch { await finish('unknown');throw new PushError('PUSH_OUTCOME_UNKNOWN',409); }
      if(response.ok) {
        const prefix=`projects/${this.env.FCM_PROJECT_ID}/messages/`;
        if(typeof result.name!=='string' || !result.name.startsWith(prefix) || result.name.length>256 || result.name.length===prefix.length) { await finish('unknown');throw new PushError('PUSH_OUTCOME_UNKNOWN',409); }
        try { await finish('accepted',result.name); } catch { throw new PushError('PUSH_OUTCOME_UNKNOWN',409); }
        return this.response(202,{success:true,accepted:true,receiptId:result.name,delivered:false});
      }
      const unregistered=Array.isArray(result.error?.details) && result.error.details.some((detail:any)=>detail['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode==='UNREGISTERED');
      if(unregistered && response.status===404) { await finish('rejected',null,60,true);throw new PushError('PUSH_REGISTRATION_REVOKED',410); }
      if([429,500,503].includes(response.status)) {
        const retry=response.headers.get('retry-after');const seconds=retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry)-this.now())/1000) : 60;
        await finish('retry_wait',null,Number.isFinite(seconds)?Math.max(60,Math.min(86400,seconds)):60);throw new PushError('PUSH_RETRY_WAIT',429,true);
      }
      await finish('rejected');throw new PushError([401,403].includes(response.status)?'CONFIGURATION_REQUIRED':'PUSH_PROVIDER_REJECTED',[401,403].includes(response.status)?503:422);
    } catch(error) {
      const mapped=error instanceof PushError ? error : new PushError('PUSH_SERVICE_UNAVAILABLE',503);
      return this.response(mapped.status,{success:false,accepted:false,delivered:false,errorCode:mapped.code,retryable:mapped.retryable});
    }
  }
  private response(status:number,body:unknown):Response { return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}}); }
  private async authenticate(authorization:string):Promise<{id:string}> {
    let response:Response;try {response=await this.fetcher(`${this.env.SUPABASE_URL}/auth/v1/user`,{headers:{authorization,apikey:this.env.SUPABASE_ANON_KEY!},signal:AbortSignal.timeout(5000)});}catch{throw new PushError('AUTH_UNAVAILABLE',503,true);}
    if(!response.ok)throw new PushError('AUTH_REQUIRED',401);
    const user=await response.json();if(typeof user.id!=='string' || !/^[a-f0-9-]{36}$/i.test(user.id))throw new PushError('AUTH_REQUIRED',401);return user;
  }
  private async rpc(name:string,body:unknown):Promise<any> {
    const response=await this.fetcher(`${this.env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{authorization:`Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:this.env.SUPABASE_SERVICE_ROLE_KEY!,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    const result=await response.json();
    if(!response.ok) {
      const allowed=['DEVICE_NOT_AUTHORIZED','RESOURCE_NOT_AUTHORIZED','PUSH_REGISTRATION_REQUIRED','PUSH_IDEMPOTENCY_CONFLICT','PUSH_ATTEMPT_STALE'];
      const code=allowed.find(code=>String(result?.message??'').includes(code))??'PUSH_STORAGE_UNAVAILABLE';
      throw new PushError(code,code.endsWith('NOT_AUTHORIZED')?403:code==='PUSH_IDEMPOTENCY_CONFLICT'?409:code==='PUSH_REGISTRATION_REQUIRED'?428:503);
    }
    return result;
  }
  private async key():Promise<CryptoKey> {
    let raw:Uint8Array;try{raw=bytes(this.env.EDITH_PUSH_TOKEN_KEY!);}catch{throw new PushError('CONFIGURATION_REQUIRED',503);}
    if(raw.length!==32)throw new PushError('CONFIGURATION_REQUIRED',503);
    return crypto.subtle.importKey('raw',raw as BufferSource,{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  private async encrypt(token:string,userId:string,deviceId:string) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(JSON.stringify([userId,deviceId,'fcm']))},await this.key(),encoder.encode(token));
    return {ciphertext:base64(new Uint8Array(encrypted)),iv:base64(iv)};
  }
  private async decrypt(registration:any,userId:string,deviceId:string):Promise<string> {
    const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(registration.iv) as BufferSource,additionalData:encoder.encode(JSON.stringify([userId,deviceId,'fcm']))},await this.key(),bytes(registration.ciphertext) as BufferSource);
    const token=new TextDecoder('utf-8',{fatal:true}).decode(result);if(!/^[A-Za-z0-9:_.-]{10,4096}$/.test(token))throw new PushError('PUSH_REGISTRATION_INVALID');return token;
  }
  private async accessToken():Promise<string> {
    if(this.oauth && this.oauth.expiresAt>this.now()+60000)return this.oauth.token;
    try {
      const header=url64(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
      const issued=Math.floor(this.now()/1000);
      const payload=url64(encoder.encode(JSON.stringify({iss:this.env.FCM_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600})));
      const pem=this.env.FCM_PRIVATE_KEY!.replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
      const key=await crypto.subtle.importKey('pkcs8',bytes(pem) as BufferSource,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(header+'.'+payload));
      const assertion=header+'.'+payload+'.'+url64(new Uint8Array(signature));
      const response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(5000)});
      const result=await response.json();if(!response.ok || typeof result.access_token!=='string' || !Number.isFinite(result.expires_in) || result.expires_in<=60)throw Error('OAuth rejected');
      this.oauth={token:result.access_token,expiresAt:this.now()+Math.min(3600,result.expires_in)*1000};return this.oauth.token;
    } catch { throw new PushError('CONFIGURATION_REQUIRED',503); }
  }
}

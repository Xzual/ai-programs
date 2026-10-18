import { PushService } from './pushService.ts';
// No dotenv/filesystem read; Supabase supplies function secrets at deployment runtime.
declare const Deno: { env: { get(name:string):string|undefined }; serve(handler:(request:Request)=>Promise<Response>):void };
const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','EDITH_PUSH_TOKEN_KEY','FCM_PROJECT_ID','FCM_CLIENT_EMAIL','FCM_PRIVATE_KEY'];
const service=new PushService(Object.fromEntries(names.map(name=>[name,Deno.env.get(name)])));
Deno.serve(request=>service.handle(request));

import {createHash} from 'node:crypto';
import sourceRegistry from './steamDetailProfiles.json';

// This source module is not a registration service. Parsing isolated data never
// replaces the compiled production registry or establishes actual UIA evidence.
const DOMAIN='edith.steam.detail-profile/1' as const;
const SCHEMA='edith.steam.detail-profile-registry/1' as const;
const MAX_BYTES=262144;
const phases=['pre_library','post_detail'] as const;
const anchors=['document','main','title','entry','entry_ancestors','main_ancestors','title_ancestors','every_visible','every_visible_intersecting_main'] as const;
const quantifiers=['exactly_one','every'] as const;
type Phase=typeof phases[number];
type Anchor=typeof anchors[number];
type Variant='BSTR'|'BOOL'|'I4';
type Primitive=string|boolean|number;
type Predicate=readonly [number,Variant,'eq',Primitive];
type Selector=readonly [Phase,Anchor,typeof quantifiers[number],readonly Predicate[]];
export type SteamDetailProfileDefinition=readonly [typeof DOMAIN,number,string,readonly Selector[],readonly Selector[],string];
export type SteamProfileApproval=Readonly<{domain:typeof DOMAIN;fingerprint:string;version:number;providerIdentity:string;evidenceSetDigest:string;approvedRevision:number;revoked:boolean}>;
type Catalog=Readonly<{id:string;propertyId:number;variant:Variant;allowedValues:readonly Primitive[];anchor:Anchor;proofAllowed:boolean}>;
type Identity=Readonly<{id:string;anchor:'main';frameworkCatalogId:string;providerCatalogId:string}>;
export type SteamDetailProfileRegistry=Readonly<{schema:typeof SCHEMA;revision:number;privacyCatalog:readonly Catalog[];providerIdentities:readonly Identity[];profiles:readonly Readonly<{approval:SteamProfileApproval;canonicalDefinition:SteamDetailProfileDefinition}>[];records:readonly SteamProfileApproval[]}>;
const types:Readonly<Record<number,Variant>>=Object.freeze({30002:'I4',30003:'I4',30010:'BOOL',30019:'BOOL',30022:'BOOL',30024:'BSTR',30079:'BOOL',30101:'BSTR',30102:'BSTR',30107:'BSTR',30157:'I4',30173:'I4',30174:'BOOL'});
const registries=new WeakSet<object>();
const bad:()=>never=()=>{throw new Error('NATIVE_STEAM_PROFILE_UNAPPROVED');};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const i4=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=-2147483648&&v<=2147483647&&!Object.is(v,-0);
const ascii=(v:unknown):v is string=>typeof v==='string'&&v.length<=4096&&/^[\x20-\x7e]*$/.test(v);
const typed=(tag:Variant,value:unknown)=>tag==='BSTR'?ascii(value):tag==='BOOL'?typeof value==='boolean':i4(value);
function keys(v:unknown,expected:readonly string[]):Record<string,any>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)bad();
  const actual=Reflect.ownKeys(v as object);
  if(actual.length!==expected.length||actual.some(k=>typeof k!=='string'||!expected.includes(k)))bad();
  for(const key of expected){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!('value' in d))bad();}
  return v as Record<string,any>;
}
function array(v:unknown,min:number,max:number):any[]{if(!Array.isArray(v)||v.length<min||v.length>max)bad();return v;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function ordered(values:readonly string[]){for(let n=1;n<values.length;n++)if(values[n-1]>=values[n])bad();}
const digest=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');

// The raw source parser rejects duplicate object keys before JSON information
// is lost. Depth, text size and token count are bounded before schema checking.
function rawJson(text:string):unknown{
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)bad();
  let at=0,tokens=0;
  const space=()=>{while(at<text.length&&/[\x20\t\r\n]/.test(text[at]))at++;};
  const string=():string=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='"'){try{return JSON.parse(text.slice(start,at));}catch{bad();}}if(c==='\\')at++;}return bad();};
  const read=(depth:number):any=>{
    if(depth>20||++tokens>40000)bad();space();const c=text[at];
    if(c==='"')return string();
    if(c==='['){at++;const out:any[]=[];space();if(text[at]===']'){at++;return out;}for(;;){out.push(read(depth+1));space();if(text[at]===']'){at++;return out;}if(text[at++]!==',')bad();}}
    if(c==='{'){at++;const out=Object.create(null),seen=new Set<string>();space();if(text[at]==='}'){at++;return out;}for(;;){space();if(text[at]!=='"')bad();const key=string();if(seen.has(key))bad();seen.add(key);space();if(text[at++]!==':')bad();out[key]=read(depth+1);space();if(text[at]==='}'){at++;return out;}if(text[at++]!==',')bad();}}
    const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    if(!match||!/^(?:true|false|null|-?(?:0|[1-9][0-9]*))$/.test(match[0]))bad();at+=match[0].length;return JSON.parse(match[0]);
  };
  const result=read(0);space();if(at!==text.length)bad();return result;
}
function inputData(input:unknown):unknown{
  if(typeof input==='string')return rawJson(input);
  let count=0,bytes=0;const seen=new Set<object>();
  const copy=(v:unknown,depth:number):any=>{
    if(depth>20||++count>40000)bad();
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){bytes+=Buffer.byteLength(v,'utf8');if(bytes>MAX_BYTES)bad();return v;}
    if(typeof v==='number'){if(!Number.isFinite(v))bad();return v;}
    if(!v||typeof v!=='object'||seen.has(v))bad();seen.add(v);
    if(Array.isArray(v)){
      if(v.length>40000||Reflect.ownKeys(v).length!==v.length+1)bad();
      const out=[];for(let n=0;n<v.length;n++){const d=Object.getOwnPropertyDescriptor(v,String(n));if(!d||!d.enumerable||!('value'in d))bad();out.push(copy(d.value,depth+1));}seen.delete(v);return out;
    }
    if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)bad();
    const out=Object.create(null);for(const key of Reflect.ownKeys(v)){if(typeof key!=='string')bad();bytes+=Buffer.byteLength(key,'utf8');if(bytes>MAX_BYTES)bad();const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!('value'in d))bad();out[key]=copy(d.value,depth+1);}seen.delete(v);return out;
  };
  const result=copy(input,0);if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_BYTES)bad();return result;
}
function selectors(value:unknown):Selector[]{
  const list=array(value,2,64),out:Selector[]=[];let previous=-1;const counts=[0,0];
  for(const item of list){
    const s=array(item,4,4),p=phases.indexOf(s[0]),a=anchors.indexOf(s[1]),q=quantifiers.indexOf(s[2]);
    if(p<0||a<0||q<0||p===0&&['title','title_ancestors'].includes(s[1])||++counts[p]>32)bad();
    const order=p*anchors.length+a;if(order<=previous)bad();previous=order;
    const predicates:Predicate[]=[];let last=0;
    for(const item of array(s[3],1,14)){const pred=array(item,4,4);if(!Number.isInteger(pred[0])||pred[0]<=last||!Object.hasOwn(types,pred[0])||types[pred[0]]!==pred[1]||pred[2]!=='eq'||!typed(pred[1],pred[3]))bad();last=pred[0];predicates.push([pred[0],pred[1],pred[2],pred[3]]);}
    out.push([s[0],s[1],s[2],predicates]);
  }
  if(counts.some(n=>n===0))bad();return out;
}
function definition(value:unknown):SteamDetailProfileDefinition{
  const d=array(value,6,6);if(d[0]!==DOMAIN||!positive(d[1])||!id(d[2])||!hash(d[5]))bad();
  const result:SteamDetailProfileDefinition=[DOMAIN,d[1],d[2],selectors(d[3]),selectors(d[4]),d[5]];
  // Minimum syntax guard only: MAIN/role/control structure alone cannot define
  // library or detail. This does not certify a predicate's page-kind meaning;
  // genuine discriminator/exclusion evidence still requires source review.
  for(const phase of phases)if(!result[3].some(s=>s[0]===phase&&
    ['document','main','main_ancestors','every_visible'].includes(s[1])&&
    s[3].some(p=>![30002,30003,30101,30157].includes(p[0]))))bad();
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>65536)bad();return result;
}
export function canonicalSteamDetailProfile(value:unknown):string{
  try{return JSON.stringify(definition(inputData(value)));}catch{return bad();}
}
export function parseSteamDetailProfiles(input:unknown):SteamDetailProfileRegistry{
  try{
    const top=keys(inputData(input),['schema','revision','privacyCatalog','providerIdentities','profiles']);
    if(top.schema!==SCHEMA||!positive(top.revision))bad();
    const catalog:Catalog[]=[],identities:Identity[]=[],profiles:{approval:SteamProfileApproval;canonicalDefinition:SteamDetailProfileDefinition}[]=[];
    const catalogPairs=new Set<string>();
    for(const item of array(top.privacyCatalog,0,64)){
      const c=keys(item,['id','propertyId','variant','allowedValues','anchor','proofAllowed']);
      if(!id(c.id)||!Number.isInteger(c.propertyId)||!Object.hasOwn(types,c.propertyId)||types[c.propertyId]!==c.variant||!anchors.includes(c.anchor)||typeof c.proofAllowed!=='boolean')bad();
      const pair=JSON.stringify([c.propertyId,c.variant,c.anchor]);if(catalogPairs.has(pair))bad();catalogPairs.add(pair);
      const values=array(c.allowedValues,1,32);if(values.some(v=>!typed(c.variant,v)))bad();ordered(values.map(v=>JSON.stringify([c.variant,v])));
      catalog.push({id:c.id,propertyId:c.propertyId,variant:c.variant,allowedValues:[...values],anchor:c.anchor,proofAllowed:c.proofAllowed});
    }
    ordered(catalog.map(c=>c.id));
    const identityPairs=new Set<string>();
    for(const item of array(top.providerIdentities,0,16)){
      const group=keys(item,['id','anchor','frameworkCatalogId','providerCatalogId']);
      if(!id(group.id)||group.anchor!=='main'||!id(group.frameworkCatalogId)||!id(group.providerCatalogId)||group.frameworkCatalogId===group.providerCatalogId)bad();
      const refs=[group.frameworkCatalogId,group.providerCatalogId].map(ref=>catalog.find(c=>c.id===ref));
      if(refs.some((c,n)=>!c||c.propertyId!==(n===0?30024:30107)||c.variant!=='BSTR'||c.anchor!=='main'||c.allowedValues.length!==1||c.proofAllowed!==false))bad();
      const pair=JSON.stringify(refs.map(c=>c!.allowedValues[0]));if(identityPairs.has(pair))bad();identityPairs.add(pair);
      identities.push({id:group.id,anchor:'main',frameworkCatalogId:group.frameworkCatalogId,providerCatalogId:group.providerCatalogId});
    }
    ordered(identities.map(g=>g.id));const versions=new Set<string>(),activeIdentities=new Set<string>();
    for(const item of array(top.profiles,0,16)){
      const profile=keys(item,['approval','canonicalDefinition']),a=keys(profile.approval,['domain','fingerprint','version','providerIdentity','evidenceSetDigest','approvedRevision','revoked']);
      if(a.domain!==DOMAIN||!hash(a.fingerprint)||!positive(a.version)||!id(a.providerIdentity)||!hash(a.evidenceSetDigest)||!positive(a.approvedRevision)||a.approvedRevision>top.revision||typeof a.revoked!=='boolean'||!identities.some(g=>g.id===a.providerIdentity))bad();
      const d=definition(profile.canonicalDefinition);
      if(d[1]!==a.version||d[2]!==a.providerIdentity||d[5]!==a.evidenceSetDigest||digest(JSON.stringify(d))!==a.fingerprint)bad();
      const version=JSON.stringify([a.providerIdentity,a.version]);if(versions.has(version)||!a.revoked&&activeIdentities.has(a.providerIdentity))bad();versions.add(version);if(!a.revoked)activeIdentities.add(a.providerIdentity);
      for(const list of [d[3],d[4]])for(const s of list)for(const pred of s[3]){
        const matches=catalog.filter(c=>c.propertyId===pred[0]&&c.variant===pred[1]&&c.anchor===s[1]&&c.allowedValues.includes(pred[3]));
        if(matches.length!==1||!matches[0].proofAllowed)bad();
      }
      profiles.push({approval:{domain:DOMAIN,fingerprint:a.fingerprint,version:a.version,providerIdentity:a.providerIdentity,evidenceSetDigest:a.evidenceSetDigest,approvedRevision:a.approvedRevision,revoked:a.revoked},canonicalDefinition:d});
    }
    ordered(profiles.map(p=>p.approval.fingerprint));
    const result=freeze({schema:SCHEMA,revision:top.revision,privacyCatalog:catalog,providerIdentities:identities,profiles,records:profiles.map(p=>p.approval)});
    registries.add(result);return result;
  }catch{return bad();}
}
export function lookupSteamDetailProfile(registry:SteamDetailProfileRegistry,fingerprint:unknown):SteamProfileApproval|undefined{
  if(!registry||!registries.has(registry)||!hash(fingerprint))return undefined;
  const matches=registry.records.filter(row=>row.fingerprint===fingerprint&&!row.revoked&&row.approvedRevision<=registry.revision);
  return matches.length===1?matches[0]:undefined;
}
export const STEAM_DETAIL_PROFILE_REGISTRY:SteamDetailProfileRegistry=parseSteamDetailProfiles(sourceRegistry);

'use strict';
const path=require('node:path');
const {isProxy}=require('node:util').types;
function rejected(){const error=new Error('EDITH_DESKTOP_OUTPUT_ROLE_REJECTED');error.code=error.message;throw error;}
function normalizeOutputRole(value){
  if(value===undefined)return Object.freeze({kind:'legacy'});
  if(!value||typeof value!=='object'||isProxy(value)||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)rejected();
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')))rejected();
  const kind=descriptors.kind?.value;
  if(kind==='legacy'&&keys.length===1)return Object.freeze({kind});
  const id=descriptors.id?.value;
  if(kind!=='candidate'||keys.length!==2||typeof id!=='string'||id.length!==64||!/^[a-f0-9]{64}$/.test(id))rejected();
  return Object.freeze({kind,id});
}
function resolveDesktopOutputRole(projectRoot,outputRole){
  const role=normalizeOutputRole(outputRole);
  if(typeof projectRoot!=='string'||!path.isAbsolute(projectRoot)||/^(?:\\\\|\/\/)/.test(projectRoot)||/[\x00-\x1f]/.test(projectRoot)||process.platform==='win32'&&!/^[A-Za-z]:[\\/]/.test(projectRoot))rejected();
  const tail=projectRoot.slice(path.parse(projectRoot).root.length);
  if(tail.split(/[\\/]/).some(part=>/[ .]$/.test(part)||part.includes(':')))rejected();
  const root=path.resolve(projectRoot),kind=role.kind,id=role.id??null;
  const candidateRoot=kind==='candidate'?path.join(root,'artifacts','desktop','candidates',id):null;
  const buildDir=candidateRoot?path.join(candidateRoot,'stage'):path.join(root,'.edith-build','desktop');
  const binaryDir=candidateRoot?path.join(candidateRoot,'binaries'):path.join(root,'src-tauri','binaries');
  const artifactRoot=candidateRoot??path.join(root,'artifacts','desktop');
  const pkgConfigText=JSON.stringify({bin:'server.cjs',pkg:{assets:[path.relative(buildDir,path.join(root,'node_modules','playwright-core','browsers.json')).replaceAll('\\','/')]}},null,2)+'\n';
  return Object.freeze({root,role,kind,id,candidateRoot,buildDir,binaryDir,entry:path.join(buildDir,'server.cjs'),output:path.join(binaryDir,'edith-backend-x86_64-pc-windows-msvc.exe'),resourceDir:path.join(buildDir,'resources'),frontendDir:candidateRoot?path.join(candidateRoot,'frontend'):path.join(root,'dist'),artifactRoot,portableRoot:path.join(artifactRoot,'portable'),tauriConfigPath:candidateRoot?path.join(candidateRoot,'tauri-candidate.json'):null,pkgConfigText});
}
module.exports=Object.freeze({normalizeOutputRole,resolveDesktopOutputRole});

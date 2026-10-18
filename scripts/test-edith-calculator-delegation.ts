import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Executes pure predicates extracted byte-for-byte from the actual Rust source.
// Native Win32 capture and actual UIA observations are deliberately not substituted.
const root=process.cwd(),out=path.join(root,'artifacts/repair-20261006/chat6/w4-calculator-steam-consumer');
const identityFile=path.join(root,'src-tauri/src/native_calculator_identity.rs'),uiaFile=path.join(root,'src-tauri/src/native_uia.rs');
const identity=fs.readFileSync(identityFile,'utf8'),uia=fs.readFileSync(uiaFile,'utf8');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const between=(source:string,start:string,end:string)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const identityPure=between(identity,'#[derive(Clone, Debug, PartialEq, Eq)]','pub(crate) fn revalidate')+
  between(identity,'pub(crate) fn require_same_identity','#[cfg(not(windows))]');
const types=between(uia,'#[derive(Clone, Debug, Serialize)]','pub(crate) fn steam_game_entry')
  .replaceAll(', Serialize','').replace(/^#\[serde\([^\n]*\)\]\r?\n/gm,'');
const relationStart=uia.lastIndexOf('#[derive',uia.indexOf('pub(crate) struct SteamRelationNode'));
assert.ok(relationStart>=0);
const relation=uia.slice(relationStart,uia.indexOf('struct Lease',relationStart));
const rust=`#![allow(dead_code)]
${identityPure}
${types}
${relation}
#[test] fn calculator_fixed_content_admission_and_identity_races() {
 let retained=NativeWindowIdentity {root_hwnd:10,root_pid:100,root_image:"C:/Windows/System32/ApplicationFrameHost.exe".into(),root_created:1,
 content:Some(CalculatorContentIdentity {hwnd:20,pid:200,image:"C:/Program Files/WindowsApps/Microsoft.WindowsCalculator_1_8wekyb3d8bbwe/CalculatorApp.exe".into(),created:2,ancestry:vec![10,15,20]})};
 assert!(require_same_identity(&retained,&retained.clone()).is_ok());
 assert!(delegated_element_allowed(&retained,200,&[(30,200),(20,200),(15,100),(10,100)]));
 for (pid,ancestors) in [(300,vec![(30,300),(20,200),(10,100)]),(200,vec![(30,200),(10,100)]),(200,vec![(10,100),(20,200)]),(200,vec![(20,200),(10,101)]),(200,vec![(20,200),(11,100)]),(200,vec![(20,200),(10,100),(40,100)]),(200,vec![(20,200);33])] {
  assert!(!delegated_element_allowed(&retained,pid,&ancestors));
 }
 let mut plain=retained.clone(); plain.content=None;assert!(!delegated_element_allowed(&plain,200,&[(20,200),(10,100)]));
 for case in 0..10 {let mut changed=retained.clone(); match case {
  0=>changed.root_hwnd=11,1=>changed.root_pid=101,2=>changed.root_image="C:/fake/ApplicationFrameHost.exe".into(),3=>changed.root_created=3,
  4=>changed.content.as_mut().unwrap().hwnd=21,5=>changed.content.as_mut().unwrap().pid=201,6=>changed.content.as_mut().unwrap().image="C:/fake/CalculatorApp.exe".into(),
  7=>changed.content.as_mut().unwrap().created=3,8=>changed.content.as_mut().unwrap().ancestry=vec![10,16,20],_=>changed.content=None};
  assert!(require_same_identity(&retained,&changed).is_err(),"changed fact {case}");
 }
}
#[test] fn calculator_protected_relative_package_shape() {
 use std::path::Path;
 assert!(calculator_package_relative(Path::new("Microsoft.WindowsCalculator_11.0_x64__8wekyb3d8bbwe/CalculatorApp.exe")));
 for name in ["CalculatorApp.exe","Microsoft.Other_1_8wekyb3d8bbwe/CalculatorApp.exe","Microsoft.WindowsCalculator__8wekyb3d8bbwe/CalculatorApp.exe","Microsoft.WindowsCalculator_1_8wekyb3d8bbwe/evil.exe","outside/Microsoft.WindowsCalculator_1_8wekyb3d8bbwe/CalculatorApp.exe"] {assert!(!calculator_package_relative(Path::new(name)),"{name}");}
}
fn p(id:i32,t:i32)->SteamPathNode {SteamPathNode {runtime_id:vec![id],control_type:t}}
fn node(id:i32,t:i32,name:&str,ancestry:Vec<SteamPathNode>,selected:Option<bool>,label:Option<Vec<i32>>)->SteamRelationNode {SteamRelationNode {runtime_id:vec![id],control_type:t,name:name.into(),ancestry,selected,eligible:true,labeled_by:label}}
#[test] fn steam_actual_source_relation_predicate_supplied_metadata_only() {
 let r=p(1,50032);let list=p(2,50008);let e=p(3,50007);let pane=p(4,50033);let title=p(5,50020);
 let entry=SteamEntryObservation {target:LocatedTarget {target_id:"fixture".into(),name:"Game".into(),control_type:50007,x:1,y:1,width:2,height:2,process_id:100,hwnd:10},runtime_id:vec![3],name:"Game".into(),ancestry:vec![r.clone(),list.clone(),e.clone()]};
 let facts=vec![node(1,50032,"root",vec![r.clone()],None,None),node(2,50008,"Library",vec![r.clone(),list.clone()],None,None),node(3,50007,"Game",entry.ancestry.clone(),Some(true),None),node(4,50033,"detail",vec![r.clone(),pane.clone()],None,Some(vec![3])),node(5,50020,"Game",vec![r.clone(),pane.clone(),title.clone()],None,None)];
 let observed=steam_relationship(&facts,&entry).unwrap();assert_eq!(observed.detail_container_runtime_id,vec![4]);assert_eq!(observed.labeled_by_subject_runtime_id,vec![4]);
 let mut title_label=facts.clone();title_label[3].labeled_by=None;title_label[4].labeled_by=Some(vec![3]);assert_eq!(steam_relationship(&title_label,&entry).unwrap().labeled_by_subject_runtime_id,vec![5]);
 for case in 0..9 {let mut bad=facts.clone();match case {
  0=>bad[3].labeled_by=None,1=>bad[3].labeled_by=Some(vec![99]),2=>bad[2].selected=Some(false),3=>bad[4].name="Other".into(),
  4=>bad[4].ancestry=vec![r.clone(),list.clone(),e.clone(),title.clone()],5=>bad.push(node(6,50007,"Other",vec![r.clone(),list.clone(),p(6,50007)],Some(true),None)),
  6=>bad.push(node(6,50020,"Game",vec![r.clone(),pane.clone(),p(6,50020)],None,None)),7=>bad[4].runtime_id=vec![4],_=>bad[3].eligible=false};
  assert!(steam_relationship(&bad,&entry).is_err(),"hostile relation {case}");
 }
 let mut oversized=facts.clone();oversized[4].runtime_id=vec![5;33];assert!(steam_relationship(&oversized,&entry).is_err());
 let mut many=facts.clone();many.resize(513,facts[0].clone());assert!(steam_relationship(&many,&entry).is_err());
}
`;
fs.mkdirSync(out,{recursive:true});
const harness=path.join(out,'test-native-pure-predicates.rs'),binary=path.join(out,'test-native-pure-predicates.exe');
fs.writeFileSync(harness,rust);
const compiler=path.join(root,'runtime/Packages/Rust-Toolchains/stable-x86_64-pc-windows-msvc/bin/rustc.exe');
const args=['--edition=2021','--test',harness,'-o',binary];
const compiled=spawnSync(compiler,args,{encoding:'utf8'});
fs.writeFileSync(path.join(out,'test-native-pure-compile.txt'),JSON.stringify({command:compiler,args,status:compiled.status,error:compiled.error?.message})+'\n'+compiled.stdout+compiled.stderr);
if(compiled.status!==0&&/linker `link.exe` not found/.test(compiled.stderr)){
  const metadataArgs=['--edition=2021','--test','--emit=metadata',harness,'-o',path.join(out,'test-native-pure-predicates.rmeta')];
  const metadata=spawnSync(compiler,metadataArgs,{encoding:'utf8'});
  fs.writeFileSync(path.join(out,'test-native-pure-metadata.txt'),JSON.stringify({command:compiler,args:metadataArgs,status:metadata.status})+'\n'+metadata.stdout+metadata.stderr);
  assert.equal(metadata.status,0,metadata.stderr);
  assert.equal(sha(fs.readFileSync(identityFile,'utf8')),sha(identity));assert.equal(sha(fs.readFileSync(uiaFile,'utf8')),sha(uia));
  console.log(JSON.stringify({actualSourcePurePredicatesMetadata:true,identitySha256:sha(identity),uiaSha256:sha(uia),harnessSha256:sha(rust),compilerExit:compiled.status,metadataExit:metadata.status,testExit:null,
    physicalAcceptance:false,providerAcceptance:false,scope:'actual pure-source fixture assertions typechecked only; NOT EXECUTED because MSVC link.exe is unavailable; Win32 capture and installed Steam profile unverified'}));
  process.exit(0);
}
assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
const run=spawnSync(binary,['--nocapture'],{encoding:'utf8'});
fs.writeFileSync(path.join(out,'test-native-pure-run.txt'),JSON.stringify({command:binary,args:['--nocapture'],status:run.status})+'\n'+run.stdout+run.stderr);
assert.equal(run.status,0,run.stdout+run.stderr);
assert.equal(sha(fs.readFileSync(identityFile,'utf8')),sha(identity));assert.equal(sha(fs.readFileSync(uiaFile,'utf8')),sha(uia));
console.log(JSON.stringify({actualSourcePurePredicates:true,identitySha256:sha(identity),uiaSha256:sha(uia),harnessSha256:sha(rust),compilerExit:compiled.status,testExit:run.status,
  physicalAcceptance:false,providerAcceptance:false,scope:'supplied native fact equality/admission and synthetic Steam LabeledBy relation metadata only; no actual Windows capture, installed Steam profile or physical input asserted'}));

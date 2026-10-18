//! Native-only OCR leases. The caller supplies actual capture and process approval;
//! no public command may accept those facts from a client.
use crate::native_ocr::OcrResult;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub type Rect = [i32; 4];
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameContext {
    pub session_id: String, pub incarnation: u64, pub workflow_id: Option<String>,
    pub observation_id: String, pub generation: u64, pub window_id: String,
    pub pid: u32, pub image_path_fingerprint: String, pub origin: [i32; 2],
    pub width: u32, pub height: u32, pub window_bounds: Rect,
    pub captured_at: u64, pub expires_at: u64,
}
#[derive(Clone, Debug)]
pub struct Frame { pub context: FrameContext, pub ocr: OcrResult }
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Postcondition { pub kind: String, pub before_text: String, pub after_text: String }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds { pub x: i32, pub y: i32, pub width: i32, pub height: i32, pub coordinate_space: &'static str }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticTarget {
    pub contract_version: u32, pub amendment: &'static str, pub target_id: String,
    pub observation_id: String, pub observation_generation: u64,
    pub provenance: &'static str, pub confidence: u32,
    pub text_fingerprint: String, pub physical_bounds: Bounds,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedTarget {
    pub target: SemanticTarget, pub window_id: String, pub window_process_id: u32,
    pub image_path_fingerprint: String, pub expires_at: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadbackReceipt {
    pub source: &'static str, pub kind: &'static str, pub target_id: String,
    pub canonical_action_id: String, pub pre_observation_id: String,
    pub post_observation_id: String, pub pre_generation: u64, pub post_generation: u64,
    pub window_id: String, pub window_process_id: u32, pub image_path_fingerprint: String,
    pub pre_text_fingerprint: String, pub post_text_fingerprint: String,
    pub expected_text_fingerprint: String, pub matched: bool, pub observed_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
enum State { Ready, InFlight(String), Consumed(String), Tombstone }
struct Lease {
    issued: IssuedTarget, context: FrameContext, bounds: Rect, scope: Rect,
    query: String, before: String, after: String, state: State,
    dispatched_at: Option<u64>,
}
#[derive(Default)]
pub struct Registry { leases: HashMap<String, Lease> }
fn fail<T>(message: &str) -> Result<T, String> { Err(format!("OCR_TARGET: {message}")) }
fn fingerprint(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }
fn intent(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 160 || text.chars().any(char::is_control) {
        return fail("intent requires 1..160 printable Unicode characters");
    }
    Ok(text.to_string())
}
fn contained(a: Rect, b: Rect) -> bool { a[0]>=b[0] && a[1]>=b[1] && a[2]<=b[2] && a[3]<=b[3] }
fn valid_rect(r: Rect) -> bool { r[0]<r[2] && r[1]<r[3] }
fn clip(a: Rect, b: Rect) -> Rect { [a[0].max(b[0]),a[1].max(b[1]),a[2].min(b[2]),a[3].min(b[3])] }
fn frame_bounds(c: &FrameContext) -> Rect { [c.origin[0],c.origin[1],c.origin[0]+c.width as i32,c.origin[1]+c.height as i32] }
fn identity(a: &FrameContext, b: &FrameContext) -> bool {
    a.session_id==b.session_id && a.incarnation==b.incarnation && a.workflow_id==b.workflow_id
        && a.window_id==b.window_id && a.pid==b.pid && a.image_path_fingerprint==b.image_path_fingerprint
        && a.origin==b.origin && a.width==b.width && a.height==b.height && a.window_bounds==b.window_bounds
}
fn validate_frame(frame: &Frame, now: u64) -> Result<(), String> {
    let c=&frame.context;
    if c.session_id.is_empty() || c.observation_id.is_empty() || c.window_id.is_empty()
        || c.pid==0 || c.image_path_fingerprint.is_empty() || c.width==0 || c.height==0
        || c.width>4096 || c.height>4096 || c.width!=frame.ocr.width || c.height!=frame.ocr.height
        || frame.ocr.source!="windows-ocr" || frame.ocr.words.len()>2048 || frame.ocr.text.len()>65536
        || c.captured_at>now || now>=c.expires_at || now>=c.captured_at.saturating_add(5000)
        || !valid_rect(c.window_bounds) { return fail("invalid, stale, or mixed OCR frame"); }
    let right=c.origin[0].checked_add(c.width as i32).ok_or("OCR frame overflow")?;
    let bottom=c.origin[1].checked_add(c.height as i32).ok_or("OCR frame overflow")?;
    if !valid_rect(clip([c.origin[0],c.origin[1],right,bottom],c.window_bounds)) { return fail("frame does not intersect owned window"); }
    let mut bytes=0usize;
    for (i,w) in frame.ocr.words.iter().enumerate() {
        bytes=bytes.checked_add(w.text.len()).ok_or("OCR text overflow")?;
        if bytes>65536 || w.text.trim().is_empty() || w.text.chars().any(char::is_control)
            || ![w.x,w.y,w.width,w.height].iter().all(|v|v.is_finite()) || w.x<0.0 || w.y<0.0
            || w.width<=0.0 || w.height<=0.0 || w.x+w.width>c.width as f32 || w.y+w.height>c.height as f32 {
            return fail("invalid OCR word geometry or text");
        }
        if frame.ocr.words[..i].iter().any(|p|p.x==w.x && p.y==w.y && p.width==w.width && p.height==w.height) {
            return fail("duplicate OCR geometry");
        }
    }
    Ok(())
}
fn word_bounds(frame: &Frame, i: usize) -> Rect {
    let w=&frame.ocr.words[i]; let o=frame.context.origin;
    [o[0]+w.x.floor() as i32,o[1]+w.y.floor() as i32,
        o[0]+(w.x+w.width).ceil() as i32,o[1]+(w.y+w.height).ceil() as i32]
}
// Phrases require consecutive provider words on the same physical line. A word
// gap cannot bridge unrelated regions or concatenate independent controls.
fn occurrences(frame: &Frame, phrase: &str, scope: Rect) -> Vec<Rect> {
    let tokens:Vec<&str>=phrase.split_whitespace().collect(); let mut found=Vec::new();
    for start in 0..frame.ocr.words.len() {
        let mut text=Vec::new(); let mut bounds=[i32::MAX,i32::MAX,i32::MIN,i32::MIN];
        let mut previous:Option<Rect>=None;
        for i in start..frame.ocr.words.len() {
            let r=word_bounds(frame,i); if !contained(r,scope) { break; }
            if let Some(p)=previous {
                let line_overlap=r[1].max(p[1])<r[3].min(p[3]);
                if !line_overlap || r[0]<p[2] || r[0]-p[2]>(r[3]-r[1]).max(p[3]-p[1])*3 { break; }
            }
            text.extend(frame.ocr.words[i].text.split_whitespace());
            if text.len()>tokens.len() || text!=tokens[..text.len()] { break; }
            bounds=[bounds[0].min(r[0]),bounds[1].min(r[1]),bounds[2].max(r[2]),bounds[3].max(r[3])];
            if text==tokens { found.push(bounds); break; }
            previous=Some(r);
        }
    }
    found
}
fn unique(frame: &Frame, phrase: &str, scope: Rect) -> Result<Rect,String> {
    let found=occurrences(frame,phrase,scope);
    if found.len()!=1 { return fail("text is absent or ambiguous within native scope"); }
    Ok(found[0])
}
impl Registry {
    pub fn issue(&mut self, frame:&Frame, query:&str, postcondition:&Postcondition, native_process_approved:bool, now:u64) -> Result<IssuedTarget,String> {
        if !native_process_approved { return fail("native process identity not approved"); }
        validate_frame(frame,now)?;
        if postcondition.kind!="unique_text_transition" { return fail("unsupported semantic postcondition"); }
        let query=intent(query)?; let before=intent(&postcondition.before_text)?; let after=intent(&postcondition.after_text)?;
        if before==after { return fail("transition texts must differ"); }
        let c=&frame.context; let owned_scope=clip(c.window_bounds,frame_bounds(c));
        let bounds=unique(frame,&query,owned_scope)?;
        let scope=[bounds[0].saturating_sub(128).max(c.window_bounds[0]),bounds[1].saturating_sub(128).max(c.window_bounds[1]),
            bounds[2].saturating_add(128).min(c.window_bounds[2]),bounds[3].saturating_add(128).min(c.window_bounds[3])];
        let scope=clip(scope,frame_bounds(c));
        unique(frame,&before,scope)?;
        if !occurrences(frame,&after,scope).is_empty() { return fail("expected after-text already present"); }
        self.leases.retain(|_,l|now<l.issued.expires_at);
        if self.leases.len()>=64 { return fail("native lease capacity exceeded"); }
        let mut random=[0u8;16]; getrandom::fill(&mut random).map_err(|_|"OCR native entropy unavailable")?;
        random[6]=(random[6]&0x0f)|0x40; random[8]=(random[8]&0x3f)|0x80;
        let hex:String=random.iter().map(|b|format!("{b:02x}")).collect();
        let id=format!("ocr-{}-{}-{}-{}-{}",&hex[..8],&hex[8..12],&hex[12..16],&hex[16..20],&hex[20..]);
        let issued=IssuedTarget { target:SemanticTarget {contract_version:2,amendment:"2.1",target_id:id.clone(),
            observation_id:c.observation_id.clone(),observation_generation:c.generation,provenance:"ocr",confidence:1,
            text_fingerprint:fingerprint(&query),physical_bounds:Bounds{x:bounds[0],y:bounds[1],width:bounds[2]-bounds[0],height:bounds[3]-bounds[1],coordinate_space:"physical_virtual_desktop"}},
            window_id:c.window_id.clone(),window_process_id:c.pid,image_path_fingerprint:c.image_path_fingerprint.clone(),
            expires_at:c.expires_at.min(c.captured_at.saturating_add(5000)) };
        if self.leases.contains_key(&id) { return fail("native target identity collision"); }
        self.leases.insert(id,Lease{issued:issued.clone(),context:c.clone(),bounds,scope,query,before,after,state:State::Ready,dispatched_at:None});
        Ok(issued)
    }
    fn lease(&self,id:&str,now:u64) -> Result<&Lease,String> {
        if !id.starts_with("ocr-") { return fail("wrong target namespace"); }
        let l=self.leases.get(id).ok_or("OCR_TARGET: unknown native target")?;
        if now>=l.issued.expires_at || now<l.context.captured_at { return fail("target expired"); }
        Ok(l)
    }
    /// Read the original native authority deadline; this never renews a lease.
    pub fn expires_at(&self,id:&str,now:u64)->Result<u64,String> {
        Ok(self.lease(id,now)?.issued.expires_at)
    }
    pub fn validate_metadata(&self,id:&str,metadata:&Map<String,Value>,context:&FrameContext,now:u64)->Result<(),String> {
        let l=self.lease(id,now)?;
        if l.state!=State::Ready || now>=context.expires_at || !identity(&l.context,context) || l.context.observation_id!=context.observation_id || l.context.generation!=context.generation {
            return fail("target state or observation mismatch");
        }
        let mut expected=serde_json::to_value(&l.issued.target).map_err(|_|"OCR metadata serialization failed")?
            .as_object().cloned().ok_or("OCR metadata must be object")?;
        expected.remove("targetId");
        if metadata!=&expected { return fail("forged, unknown, or altered target metadata"); }
        Ok(())
    }
    pub fn begin_dispatch(&mut self,id:&str,canonical_action_id:&str,context:&FrameContext,now:u64)->Result<(),String> {
        let l=self.lease(id,now)?;
        if canonical_action_id.is_empty() || now>=context.expires_at || l.state!=State::Ready || !identity(&l.context,context)
            || l.context.observation_id!=context.observation_id || l.context.generation!=context.generation { return fail("single-use dispatch context mismatch"); }
        self.leases.get_mut(id).unwrap().state=State::InFlight(canonical_action_id.to_string());
        Ok(())
    }
    pub fn validate_live(&self,id:&str,canonical_action_id:&str,frame:&Frame,native_process_approved:bool,now:u64)->Result<Rect,String> {
        let l=self.lease(id,now)?; validate_frame(frame,now)?;
        if !native_process_approved || l.state!=State::InFlight(canonical_action_id.to_string()) || !identity(&l.context,&frame.context)
            || l.context.observation_id!=frame.context.observation_id || l.context.generation!=frame.context.generation { return fail("live target identity mismatch"); }
        if unique(frame,&l.query,frame.context.window_bounds)?!=l.bounds { return fail("live OCR target moved"); }
        unique(frame,&l.before,l.scope)?;
        if !occurrences(frame,&l.after,l.scope).is_empty() { return fail("live transition already satisfied"); }
        Ok(l.bounds)
    }
    pub fn finish_dispatch(&mut self,id:&str,canonical_action_id:&str,input_succeeded:bool,now:u64)->Result<(),String> {
        // Tombstone even when a partial input or expired dispatch cannot yield proof.
        let l=self.leases.get_mut(id).ok_or("OCR_TARGET: unknown native target")?;
        let action_matches=match &l.state {
            State::Ready=>!input_succeeded,
            State::InFlight(action)|State::Consumed(action)=>action==canonical_action_id,
            State::Tombstone=>false,
        };
        if !action_matches { return fail("dispatch action mismatch or already tombstoned"); }
        let valid=l.state==State::InFlight(canonical_action_id.to_string()) && now<l.issued.expires_at && now>=l.context.captured_at;
        if !valid || !input_succeeded {
            l.state=State::Tombstone; l.query.clear(); l.before.clear(); l.after.clear();
            return if !input_succeeded {Ok(())} else {fail("dispatch state or deadline invalid")};
        }
        l.state=State::Consumed(canonical_action_id.to_string()); l.dispatched_at=Some(now); Ok(())
    }
    pub fn readback(&mut self,id:&str,canonical_action_id:&str,post:&Frame,native_process_approved:bool,now:u64)->Result<ReadbackReceipt,String> {
        let l=self.lease(id,now)?; validate_frame(post,now)?;
        if !native_process_approved || l.state!=State::Consumed(canonical_action_id.to_string()) || !identity(&l.context,&post.context)
            || post.context.observation_id==l.context.observation_id || post.context.generation<=l.context.generation
            || post.context.captured_at<=l.dispatched_at.ok_or("OCR dispatch timestamp absent")? { return fail("readback is not a compatible post-dispatch observation"); }
        unique(post,&l.after,l.scope)?;
        let after=fingerprint(&l.after);
        let receipt=ReadbackReceipt {source:"native_operator",kind:"ocr_semantic_transition",target_id:id.to_string(),canonical_action_id:canonical_action_id.to_string(),
            pre_observation_id:l.context.observation_id.clone(),post_observation_id:post.context.observation_id.clone(),pre_generation:l.context.generation,
            post_generation:post.context.generation,window_id:l.context.window_id.clone(),window_process_id:l.context.pid,image_path_fingerprint:l.context.image_path_fingerprint.clone(),
            pre_text_fingerprint:fingerprint(&l.before),post_text_fingerprint:after.clone(),expected_text_fingerprint:after,matched:true,observed_at:now};
        let l=self.leases.get_mut(id).unwrap();
        l.state=State::Tombstone; l.query.clear(); l.before.clear(); l.after.clear();
        Ok(receipt)
    }
    pub fn invalidate_all(&mut self) { self.leases.clear(); }
    pub fn invalidate_unused(&mut self) { self.leases.retain(|_,l|matches!(l.state,State::Consumed(_))); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_ocr::OcrWord;
    fn frame() -> Frame {
        Frame { context:FrameContext {session_id:"s".into(),incarnation:1,workflow_id:Some("reservation".into()),
            observation_id:"pre".into(),generation:1,window_id:"hwnd".into(),pid:42,image_path_fingerprint:"native-image".into(),
            origin:[-800,-300],width:800,height:300,window_bounds:[-800,-300,0,0],captured_at:1000,expires_at:10000},
            ocr:OcrResult {text:"Go Before".into(),source:"windows-ocr",width:800,height:300,
                words:vec![word("Go",200.0,100.0),word("Before",240.0,100.0)]} }
    }
    fn word(text:&str,x:f32,y:f32)->OcrWord {OcrWord{text:text.into(),x,y,width:30.0,height:20.0}}
    fn condition()->Postcondition {Postcondition{kind:"unique_text_transition".into(),before_text:"Before".into(),after_text:"After".into()}}
    fn issue(r:&mut Registry,f:&Frame)->IssuedTarget {r.issue(f,"Go",&condition(),true,1001).unwrap()}
    fn metadata(t:&IssuedTarget)->Map<String,Value> {let mut m=serde_json::to_value(&t.target).unwrap().as_object().unwrap().clone();m.remove("targetId");m}
    fn consumed(r:&mut Registry,f:&Frame,t:&IssuedTarget) {
        r.begin_dispatch(&t.target.target_id,"action",&f.context,1002).unwrap();
        r.validate_live(&t.target.target_id,"action",f,true,1003).unwrap();
        r.finish_dispatch(&t.target.target_id,"action",true,1004).unwrap();
    }
    fn post(f:&Frame)->Frame {let mut p=f.clone();p.context.observation_id="post".into();p.context.generation=2;p.context.captured_at=1005;p.ocr.words.push(word("After",200.0,140.0));p}
    #[test] fn negative_origin_real_geometry_and_exact_metadata() {
        let mut r=Registry::default();let f=frame();let t=issue(&mut r,&f);
        assert_eq!([t.target.physical_bounds.x,t.target.physical_bounds.y],[-600,-200]);
        assert_eq!(t.expires_at,6000);let mut m=metadata(&t);
        assert_eq!(r.expires_at(&t.target.target_id,1001).unwrap(),6000);
        assert!(r.expires_at(&t.target.target_id,6000).is_err());
        assert!(r.validate_metadata(&t.target.target_id,&m,&f.context,1001).is_ok());
        m.insert("success".into(),Value::Bool(true));assert!(r.validate_metadata(&t.target.target_id,&m,&f.context,1001).is_err());
        m=metadata(&t);m.insert("confidence".into(),Value::from(0));assert!(r.validate_metadata(&t.target.target_id,&m,&f.context,1001).is_err());
        assert!(r.validate_metadata("uia:forged",&metadata(&t),&f.context,1001).is_err());
        assert!(r.validate_metadata("ocr-forged",&metadata(&t),&f.context,1001).is_err());
    }
    #[test] fn malformed_mixed_and_outside_frames_fail_closed() {
        let f=frame();let mut r=Registry::default();
        for variant in 0..7 {let mut bad=f.clone();match variant {
            0=>bad.ocr.width=799,1=>bad.context.width=4097,2=>bad.context.window_bounds=[10,10,30,30],
            3=>bad.ocr.words[0].x=f32::NAN,4=>bad.ocr.words[0].width=900.0,
            5=>bad.ocr.words.push(bad.ocr.words[0].clone()),_=>bad.ocr.source="caller"};
            assert!(r.issue(&bad,"Go",&condition(),true,1001).is_err());}
        assert!(r.issue(&f,"Go",&condition(),false,1001).is_err());
    }
    #[test] fn ambiguity_before_scope_and_after_precondition() {
        let mut r=Registry::default();let f=frame();
        let mut bad=f.clone();bad.ocr.words.push(word("Go",600.0,200.0));assert!(r.issue(&bad,"Go",&condition(),true,1001).is_err());
        bad=f.clone();bad.ocr.words[1].x=600.0;assert!(r.issue(&bad,"Go",&condition(),true,1001).is_err());
        bad=f.clone();bad.ocr.words.push(word("After",220.0,130.0));assert!(r.issue(&bad,"Go",&condition(),true,1001).is_err());
        bad=f.clone();bad.ocr.words.push(word("Before",210.0,130.0));assert!(r.issue(&bad,"Go",&condition(),true,1001).is_err());
        bad=f.clone();bad.ocr.words.push(word("After",600.0,200.0));assert!(r.issue(&bad,"Go",&condition(),true,1001).is_ok());
    }
    #[test] fn exact_phrase_cannot_bridge_lines_or_distant_words() {
        let mut f=frame();f.ocr.words=vec![word("Click",200.0,100.0),word("Here",240.0,100.0),word("Before",200.0,140.0)];
        assert!(Registry::default().issue(&f,"Click Here",&condition(),true,1001).is_ok());
        f.ocr.words[1].y=160.0;assert!(Registry::default().issue(&f,"Click Here",&condition(),true,1001).is_err());
        f.ocr.words[1].y=100.0;f.ocr.words[1].x=600.0;assert!(Registry::default().issue(&f,"Click Here",&condition(),true,1001).is_err());
    }
    #[test] fn stale_expired_incarnation_generation_and_reservation() {
        let mut r=Registry::default();let f=frame();let t=issue(&mut r,&f);
        for variant in 0..5 {let mut c=f.context.clone();match variant {
            0=>c.incarnation+=1,1=>c.generation+=1,2=>c.workflow_id=Some("other".into()),3=>c.pid+=1,_=>c.image_path_fingerprint="other-image".into()};
            assert!(r.begin_dispatch(&t.target.target_id,"action",&c,1002).is_err());}
        assert!(r.begin_dispatch(&t.target.target_id,"action",&f.context,6000).is_err());
        let mut stale=f.clone();stale.context.captured_at=0;assert!(r.issue(&stale,"Go",&condition(),true,5000).is_err());
    }
    #[test] fn fresh_live_capture_original_expiry_and_partial_tombstone() {
        let mut r=Registry::default();let f=frame();let t=issue(&mut r,&f);
        r.begin_dispatch(&t.target.target_id,"action",&f.context,1002).unwrap();
        assert!(r.begin_dispatch(&t.target.target_id,"action",&f.context,1002).is_err());
        let mut live=f.clone();live.context.captured_at=1500;
        assert!(r.validate_live(&t.target.target_id,"action",&live,true,1501).is_ok());
        assert!(r.validate_live(&t.target.target_id,"other",&live,true,1501).is_err());
        live.ocr.words[0].x+=1.0;assert!(r.validate_live(&t.target.target_id,"action",&live,true,1501).is_err());
        r.finish_dispatch(&t.target.target_id,"action",false,1502).unwrap();
        assert!(r.begin_dispatch(&t.target.target_id,"action",&f.context,1503).is_err());
        assert!(r.readback(&t.target.target_id,"action",&post(&f),true,1503).is_err());
    }
    #[test] fn scoped_transition_before_may_remain_and_readback_is_single_use() {
        let mut r=Registry::default();let f=frame();let t=issue(&mut r,&f);consumed(&mut r,&f,&t);
        r.invalidate_unused();let p=post(&f);
        let receipt=r.readback(&t.target.target_id,"action",&p,true,1006).unwrap();
        assert!(receipt.matched);assert_eq!(receipt.expected_text_fingerprint,fingerprint("After"));
        assert!(r.readback(&t.target.target_id,"action",&p,true,1007).is_err());
    }
    #[test] fn unrelated_duplicate_after_and_changed_post_identity_cannot_prove_transition() {
        let mut r=Registry::default();let f=frame();let t=issue(&mut r,&f);consumed(&mut r,&f,&t);
        let mut p=post(&f);p.ocr.words.last_mut().unwrap().x=600.0;
        assert!(r.readback(&t.target.target_id,"action",&p,true,1006).is_err());
        p=post(&f);p.ocr.words.push(word("After",220.0,170.0));assert!(r.readback(&t.target.target_id,"action",&p,true,1006).is_err());
        p=post(&f);p.context.incarnation+=1;assert!(r.readback(&t.target.target_id,"action",&p,true,1006).is_err());
        p=post(&f);assert!(r.readback(&t.target.target_id,"other",&p,true,1006).is_err());
        assert!(r.readback(&t.target.target_id,"action",&p,true,6000).is_err());
        r.invalidate_all();assert!(r.readback(&t.target.target_id,"action",&p,true,1006).is_err());
    }
    #[test] fn observation_replacement_cancels_inflight_and_unused() {
        let mut r=Registry::default();let f=frame();let a=issue(&mut r,&f);let b=issue(&mut r,&f);
        r.begin_dispatch(&a.target.target_id,"action",&f.context,1002).unwrap();r.invalidate_unused();
        assert!(r.validate_live(&a.target.target_id,"action",&f,true,1003).is_err());
        assert!(r.begin_dispatch(&b.target.target_id,"action",&f.context,1003).is_err());
    }
    #[test] fn desktop_capture_clips_scope_to_owned_window_and_ignores_other_apps() {
        let mut f=frame();f.context.window_bounds=[-620,-220,-500,-120];
        f.ocr.words.push(word("Go",600.0,200.0));
        let mut r=Registry::default();let t=issue(&mut r,&f);let lease=r.leases.get(&t.target.target_id).unwrap();
        assert_eq!(lease.scope,[-620,-220,-500,-120]);
        f.context.window_bounds=[-900,-350,-500,-120];
        let t=issue(&mut r,&f);assert!(contained(r.leases.get(&t.target.target_id).unwrap().scope,frame_bounds(&f.context)));
    }
    #[test] fn failure_revoke_ready_or_successful_consumed_but_never_other_action() {
        let mut r=Registry::default();let f=frame();let ready=issue(&mut r,&f);
        r.finish_dispatch(&ready.target.target_id,"action",false,1002).unwrap();
        assert!(r.begin_dispatch(&ready.target.target_id,"action",&f.context,1003).is_err());
        let t=issue(&mut r,&f);consumed(&mut r,&f,&t);
        assert!(r.finish_dispatch(&t.target.target_id,"other",false,1005).is_err());
        assert_eq!(r.leases.get(&t.target.target_id).unwrap().state,State::Consumed("action".into()));
        r.finish_dispatch(&t.target.target_id,"action",false,1005).unwrap();
        assert!(r.readback(&t.target.target_id,"action",&post(&f),true,1006).is_err());
        assert!(r.leases.get(&t.target.target_id).unwrap().after.is_empty());
    }
}

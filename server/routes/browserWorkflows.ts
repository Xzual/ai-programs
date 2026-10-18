import {Router} from 'express';
import {browserWorkflowService,type BrowserWorkflowService} from '../../src/edith/browserWorkflowService';
import {getOwnerSession,requireOwnerSession,requireSameOrigin,requireProtectedMutation} from '../security/ownerSession';
import {browserNativeAuthority,type BrowserNativeAuthority} from '../browser/browserNativeAuthority';
import {getBrowserOperatorAdapter} from '../../src/edith/browserOperatorAdapter';

const composedAuthorities=new WeakSet<BrowserNativeAuthority>();
/** Trusted backend composition; request bodies cannot select or configure a producer. */
export function configureNativeBrowserBackend(authority:BrowserNativeAuthority=browserNativeAuthority):void {
  if(composedAuthorities.has(authority))return;
  authority.bindSources({producer:browserWorkflowService,engine:getBrowserOperatorAdapter().nativeSources});
  browserWorkflowService.configureNativeAuthority(authority);
  composedAuthorities.add(authority);
}

export function createBrowserWorkflowsRouter(service:Pick<BrowserWorkflowService,'capabilities'|'run'|'readArtifact'|'closeSession'>=browserWorkflowService,options:{nativeAuthority?:BrowserNativeAuthority}={}):Router {
  const router=Router();
  const authority=options.nativeAuthority??browserNativeAuthority;
  if(service===browserWorkflowService)configureNativeBrowserBackend(authority);
  router.get('/api/edith/browser/workflows/capabilities',requireOwnerSession,(_req,res)=>{
    res.json({success:true,capabilities:service.capabilities()});
  });
  router.post('/api/edith/browser/workflows',...requireProtectedMutation,async(req,res)=>{
    if(service===browserWorkflowService&&authority.currentBoot()&&req.body?.dryRun!==true&&authority.supportsStrategy(req.body?.action)){
      try{
        const owner=browserWorkflowService.captureOwner(req);
        const retained=browserWorkflowService.retainNativeWorkflowRequest(req,owner);
        if(browserWorkflowService.selectOriginalBrowserExecution(retained)==='native-candidate'){
          const attempt=browserWorkflowService.openNativeOriginal(owner,retained);
          const ticket=browserWorkflowService.startNativeOriginal(attempt);
          res.set('Cache-Control','no-store').status(202).json(ticket);return;
        }
      }catch{res.set('Cache-Control','no-store').status(400).json({success:false,errorCode:'NATIVE_WORKFLOW_ADMISSION_DENIED'});return;}
    }
    const result=await service.run(req.body??{},getOwnerSession(req)!.bindingId);
    res.status(result.success?200:result.errorCode==='PERMISSION_DENIED'?403:400).json(result);
  });
  router.get('/api/edith/browser/workflows/attempts/:attemptLookupRef',requireOwnerSession,requireSameOrigin,(req,res)=>{
    res.set('Cache-Control','no-store');
    if(req.method!=='GET'){res.status(405).set('Allow','GET').end();return;}
    if(!/^[A-Za-z0-9_-]{22,160}$/.test(req.params.attemptLookupRef)||req.originalUrl.includes('?')||req.headers['transfer-encoding']!==undefined||Number(req.headers['content-length']??0)!==0){res.status(400).json({success:false,errorCode:'INVALID_NATIVE_RESULT_REQUEST'});return;}
    try{
      if(service!==browserWorkflowService)throw Error('UNAVAILABLE');
      const owner=browserWorkflowService.captureOwner(req);
      const lookup=browserWorkflowService.resolveNativeAttemptLookup(owner,req.params.attemptLookupRef);
      const result=browserWorkflowService.readNativeWorkflowResult(owner,lookup);
      res.status('pending' in result&&result.pending?202:200).json(result);
    }catch{res.status(404).json({success:false,errorCode:'NATIVE_RESULT_NOT_FOUND'});}
  });
  router.get('/api/edith/browser/artifacts/:artifactId',requireOwnerSession,requireSameOrigin,(req,res)=>{
    if(req.method==='HEAD'){res.status(405).set('Allow','GET').end();return;}
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params.artifactId)||Object.keys(req.query).length||req.headers['transfer-encoding']!==undefined||Number(req.headers['content-length']??0)!==0||['range','if-range','if-match','if-none-match','if-modified-since','if-unmodified-since'].some(header=>req.headers[header]!==undefined)){
      res.status(400).json({success:false,errorCode:'INVALID_ARTIFACT_REQUEST'});return;
    }
    const owner=getOwnerSession(req)!.bindingId;
    let artifact:ReturnType<BrowserWorkflowService['readArtifact']>;
    try{artifact=service.readArtifact(req.params.artifactId,owner);}catch(error){
      const code=error instanceof Error?error.message:'';
      res.status(['OWNER_SESSION_REQUIRED','SESSION_EXPIRED','PAGE_NOT_FOUND'].includes(code)?404:500).json({success:false,errorCode:['OWNER_SESSION_REQUIRED','SESSION_EXPIRED','PAGE_NOT_FOUND'].includes(code)?'ARTIFACT_NOT_FOUND':'ARTIFACT_READ_FAILED'});return;
    }
    if(!Buffer.isBuffer(artifact.bytes)||!['text/plain; charset=utf-8','image/png'].includes(artifact.mime)){
      res.status(500).json({success:false,errorCode:'ARTIFACT_READ_FAILED'});return;
    }
    const bytes=Buffer.from(artifact.bytes);
    if(getOwnerSession(req)?.bindingId!==owner){res.status(401).json({success:false,errorCode:'OWNER_SESSION_REQUIRED'});return;}
    res.writeHead(200,{'Content-Type':artifact.mime,'Content-Length':bytes.length,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="edith-artifact.${artifact.mime==='image/png'?'png':'txt'}"`});
    res.end(bytes);
  });
  router.post('/api/edith/browser/sessions/:sessionId/close',...requireProtectedMutation,async(req,res)=>{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params.sessionId)||Object.keys(req.query).length||((Number(req.headers['content-length']??0)!==0||req.headers['transfer-encoding']!==undefined)&&(!req.is('application/json')||req.body===undefined))||(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==0))){
      res.status(400).json({success:false,errorCode:'INVALID_SESSION_CLOSE_REQUEST'});return;
    }
    const owner=getOwnerSession(req)!.bindingId;
    let failure:string|undefined;
    try{await service.closeSession(req.params.sessionId,owner);}catch(error){failure=error instanceof Error?error.message:'';}
    if(getOwnerSession(req)?.bindingId!==owner){res.status(401).json({success:false,errorCode:'OWNER_SESSION_REQUIRED'});return;}
    if(failure!==undefined&&failure!=='SESSION_EXPIRED'){
      res.status(failure==='OWNER_SESSION_REQUIRED'?403:500).json({success:false,errorCode:failure==='OWNER_SESSION_REQUIRED'?'OWNER_SESSION_REQUIRED':'SESSION_CLOSE_FAILED'});return;
    }
    res.status(200).json({success:true});
  });
  return router;
}

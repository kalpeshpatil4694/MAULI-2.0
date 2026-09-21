import { registerExecutor } from './executor-registry.js';
import { store } from './store.js';
import { addTaskToProject } from './projects.js';
import { selectAgents, seedAgents } from './agents.js';
import { listProjectArtifacts } from './artifacts.js';
import { now } from './core.js';

export const GATES = ['build','test','requirements','security','qa','integrity'];
const CAP = {
  build:['testing','verification'], test:['testing','verification'], requirements:['verification'],
  security:['security','verification'], qa:['testing','verification'], integrity:['verification']
};

function artifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace' || a.type === 'final-delivery'); }
function codeArtifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace'); }
function validFiles(projectId){
  return codeArtifacts(projectId).some(a => Array.isArray(a.content?.files) && a.content.files.length > 0 &&
    a.content.files.every(f => f && typeof f.path === 'string' && f.path.trim() && typeof f.content === 'string'));
}
function latestCodeArtifact(projectId){
  return codeArtifacts(projectId).sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')))[0]??null;
}
function gateTasks(projectId){ return store.list('tasks').filter(t => t.projectId === projectId && t.pipelineGate); }
function gateAgent(type){ seedAgents(); return selectAgents(CAP[type] ?? ['verification'], null, { requireAllTools:false })[0] ?? null; }

export function ensureProjectPipeline(projectId){
  const project = store.get('projects', projectId); if(!project) return null;
  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const finalQa = tasks.find(t => t.finalProjectVerification);
  if(!finalQa) return null;
  const existing = new Map(gateTasks(projectId).map(t => [t.gateType, t]));
  const generation = tasks.filter(t => !t.pipelineGate && !t.finalProjectVerification);
  let previousIds = generation.map(t => t.id);
  const created = [];

  for(const type of GATES){
    const gateSequence = 900 + GATES.indexOf(type);
    if(type === 'qa'){
      const qa = store.put('tasks', {
        ...finalQa, pipelineGate:true, gateType:'qa',
        title:'Final project QA gate', executor:'internal.pipeline-gate',
        requiredCapabilities:CAP.qa, acceptance:[{field:'type',equals:'plan'}],
        dependsOn:[...previousIds], sequence:gateSequence, id:finalQa.id
      });
      existing.set('qa',qa); previousIds=[qa.id]; continue;
    }
    if(existing.has(type)){
      const existingGate = existing.get(type);
      if(existingGate.sequence !== gateSequence) existing.set(type, store.put('tasks',{...existingGate,sequence:gateSequence,id:existingGate.id}));
      previousIds=[existing.get(type).id]; continue;
    }
    const agent=gateAgent(type);
    const task=addTaskToProject(projectId, {
      title:`Pipeline gate: ${type}`,
      description:`Mandatory ${type} gate for project ${projectId}`,
      requiredCapabilities:CAP[type], risk:'low',
      acceptance:[{field:'type',equals:'plan'}],
      assignedAgentId:agent?.id??null, toolNames:[], requiredTools:[],
      executor:'internal.pipeline-gate', maxAttempts:2, sequence:gateSequence,
      dependsOn:[...previousIds], pipelineGate:true, gateType:type
    });
    if(task){ created.push(task); previousIds=[task.id]; existing.set(type,task); }
  }

  const qa=existing.get('qa'), integrity=existing.get('integrity');
  if(integrity && qa && !integrity.dependsOn?.includes(qa.id))
    store.put('tasks',{...integrity,dependsOn:[qa.id],id:integrity.id});
  return {created,gates:gateTasks(projectId).map(t=>({id:t.id,type:t.gateType,state:t.state,dependsOn:t.dependsOn??[]}))};
}

function prior(projectId,type){ return store.list('tasks').find(t => t.projectId === projectId && t.pipelineGate && t.gateType === type); }

function parsePackage(files){
  const pkg=files.find(f=>f.path==='package.json');
  if(!pkg) return {exists:false,valid:false,buildScript:false,testScript:false};
  try{
    const value=JSON.parse(pkg.content);
    return {exists:true,valid:true,buildScript:typeof value?.scripts?.build==='string'&&value.scripts.build.trim().length>0,
      testScript:typeof value?.scripts?.test==='string'&&value.scripts.test.trim().length>0};
  }catch(_){ return {exists:true,valid:false,buildScript:false,testScript:false}; }
}

function qualityProblems(code){
  const problems=[];
  for(const a of code){
    if(a.metadata?.stub===true || a.metadata?.placeholder===true) problems.push(`${a.id}:placeholder-artifact`);
    for(const f of (a.content?.files??[])){
      if(typeof f?.content!=='string') continue;
      if(/AI generation unavailable|app placeholder|TODO\b|FIXME\b|coming soon/i.test(f.content))
        problems.push(`${a.id}:${f.path}:placeholder-marker`);
    }
  }
  return problems;
}

function securityProblems(code){
  return code.flatMap(a=>(a.content?.files??[]).map(f=>({path:f.path,content:f.content})))
    .filter(f=>/\beval\s*\(|new\s+Function\s*\(|child_process|execSync\s*\(|rm\s+-rf|curl\s+[^\n|]*\|\s*(sh|bash)|-----BEGIN (RSA|PRIVATE) KEY-----/i.test(f.content));
}

async function sha256(textValue){
  const bytes=new TextEncoder().encode(String(textValue??''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function gateResult(task){
  const pid=task.projectId, type=task.gateType, arts=artifacts(pid), code=codeArtifacts(pid);
  let passed=true, checks=[];
  const check=(name,value,reason)=>{ checks.push({name,passed:Boolean(value),...(value?{}:{reason})}); if(!value) passed=false; };

  if(type==='build'){
    const latest=latestCodeArtifact(pid), files=latest?.content?.files??[], pkg=parsePackage(files);
    check('generated_artifact_present',arts.length>0,'No generated artifact exists');
    check('source_files_valid',validFiles(pid),'Generated source files are missing or invalid');
    check('package_json_valid',!pkg.exists||pkg.valid,'package.json is invalid JSON');
    check('placeholder_free',qualityProblems(code).length===0,'Placeholder/stub markers remain in generated code');
    check('build_contract_present',!pkg.valid||pkg.buildScript||files.some(f=>f.path==='www/index.html'),'No build contract or static web entry point was found');
  } else if(type==='test'){
    const b=prior(pid,'build'), latest=latestCodeArtifact(pid), files=latest?.content?.files??[], pkg=parsePackage(files);
    check('build_gate_passed',b?.state==='completed','Build gate has not passed');
    check('artifact_structure_test',validFiles(pid),'Artifact structure test failed');
    check('test_contract_present',Boolean(pkg.testScript||latest?.content?.tests?.length||files.some(f=>/^(www\\/index\\.html|README\\.md)$/.test(f.path))),
      'No test/static validation contract was found');
  } else if(type==='requirements'){
    const t=prior(pid,'test'), p=store.get('projects',pid);
    check('test_gate_passed',t?.state==='completed','Test gate has not passed');
    check('objective_present',Boolean(String(p?.objective??'').trim()),'Project objective is missing');
    check('requirements_recorded',Array.isArray(p?.requirements)&&p.requirements.length>0,'Project requirements are missing');
  } else if(type==='security'){
    const r=prior(pid,'requirements'), risky=securityProblems(code);
    check('requirements_gate_passed',r?.state==='completed','Requirement verification has not passed');
    check('unsafe_patterns_absent',risky.length===0,risky.length?`Unsafe pattern found in: ${risky.map(x=>x.path).slice(0,5).join(', ')}`:'Unsafe patterns detected');
    check('placeholder_free',qualityProblems(code).length===0,'Placeholder/stub markers remain in generated code');
  } else if(type==='qa'){
    const s=prior(pid,'security');
    const generation=store.list('tasks').filter(t=>t.projectId===pid&&!t.pipelineGate&&!t.finalProjectVerification);
    check('security_gate_passed',s?.state==='completed','Security gate has not passed');
    check('all_project_tasks_complete',generation.every(t=>t.state==='completed'),'One or more generation tasks are incomplete');
    check('artifacts_present',arts.length>0,'No project artifact available for QA');
    check('artifact_files_valid',validFiles(pid),'Artifact files failed QA structure checks');
    check('placeholder_free',qualityProblems(code).length===0,'QA found placeholder/stub markers');
  } else if(type==='integrity'){
    const q=prior(pid,'qa'), ids=arts.map(a=>a.id);
    const files=code.flatMap(a=>(a.content?.files??[]).map(f=>({artifactId:a.id,path:f.path,content:f.content})));
    const manifest=[];
    for(const f of files) manifest.push({artifactId:f.artifactId,path:f.path,sha256:await sha256(f.content),bytes:new TextEncoder().encode(f.content).byteLength});
    check('qa_gate_passed',q?.state==='completed','QA gate has not passed');
    check('artifact_ids_unique',new Set(ids).size===ids.length,'Duplicate artifact IDs detected');
    check('artifact_metadata_valid',arts.every(a=>a.projectId===pid&&a.type&&a.createdAt),'Artifact metadata is incomplete');
    check('file_manifest_valid',manifest.length>0&&manifest.every(x=>x.path&&/^[a-f0-9]{64}$/.test(x.sha256)),'Artifact file manifest could not be generated');
    return {type:'plan',taskId:task.id,gate:type,passed,checks,verifiedAt:now(),manifest,summary:passed?`${type} gate passed.`:`${type} gate failed.`};
  }
  return {type:'plan',taskId:task.id,gate:type,passed,checks,verifiedAt:now(),summary:passed?`${type} gate passed.`:`${type} gate failed.`};
}

registerExecutor('internal.pipeline-gate', async ({task}) => gateResult(task), {
  description:'Mandatory MAULI delivery pipeline gate with build/test contracts, security checks, QA and artifact integrity evidence',
  scope:'internal',
  risk:'low'
});

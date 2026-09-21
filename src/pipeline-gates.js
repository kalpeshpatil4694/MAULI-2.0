import { registerExecutor } from './executor-registry.js';
import { store } from './store.js';
import { addTaskToProject } from './projects.js';
import { selectAgents, seedAgents } from './agents.js';
import { listProjectArtifacts } from './artifacts.js';
import { now } from './core.js';

// Mandatory delivery gates. The finalProjectVerification task is reused as the QA gate
// so the existing delivery contract remains compatible while adding the missing stages.
export const GATES = ['build','test','requirements','security','qa','integrity'];
const CAP = {
  build:['testing','verification'], test:['testing','verification'], requirements:['verification'],
  security:['security','verification'], qa:['testing','verification'], integrity:['verification']
};

function artifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace' || a.type === 'final-delivery'); }
function codeArtifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace'); }
function validFiles(projectId){ return codeArtifacts(projectId).some(a => Array.isArray(a.content?.files) && a.content.files.length > 0 && a.content.files.every(f => f && typeof f.path === 'string' && f.path.trim() && typeof f.content === 'string')); }
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
    if(type === 'qa'){
      const qa = store.put('tasks', {
        ...finalQa,
        pipelineGate:true,
        gateType:'qa',
        title:'Final project QA gate',
        executor:'internal.pipeline-gate',
        requiredCapabilities:CAP.qa,
        acceptance:[{field:'type',equals:'plan'}],
        dependsOn:[...previousIds],
        sequence:990,
        id:finalQa.id
      });
      existing.set('qa',qa); previousIds=[qa.id];
      continue;
    }
    if(existing.has(type)){ previousIds=[existing.get(type).id]; continue; }
    const agent=gateAgent(type);
    const task=addTaskToProject(projectId, {
      title:`Pipeline gate: ${type}`,
      description:`Mandatory ${type} gate for project ${projectId}`,
      requiredCapabilities:CAP[type],
      risk:'low',
      acceptance:[{field:'type',equals:'plan'}],
      assignedAgentId:agent?.id??null,
      toolNames:[], requiredTools:[],
      executor:'internal.pipeline-gate', maxAttempts:2,
      sequence:900+GATES.indexOf(type),
      dependsOn:[...previousIds], pipelineGate:true, gateType:type
    });
    if(task){ created.push(task); previousIds=[task.id]; existing.set(type,task); }
  }

  const qa=existing.get('qa');
  const integrity=existing.get('integrity');
  if(integrity && qa && !integrity.dependsOn?.includes(qa.id)) store.put('tasks',{...integrity,dependsOn:[qa.id],id:integrity.id});
  return {created,gates:gateTasks(projectId).map(t=>({id:t.id,type:t.gateType,state:t.state,dependsOn:t.dependsOn??[]}))};
}

function prior(projectId,type){ return store.list('tasks').find(t => t.projectId === projectId && t.pipelineGate && t.gateType === type); }
function gateResult(task){
  const pid=task.projectId, type=task.gateType, arts=artifacts(pid), code=codeArtifacts(pid);
  let passed=true, checks=[];
  const check=(name,value,reason)=>{ checks.push({name,passed:Boolean(value),...(value?{}:{reason})}); if(!value) passed=false; };

  if(type==='build'){
    check('generated_artifact_present',arts.length>0,'No generated artifact exists');
    check('source_files_valid',validFiles(pid),'Generated source files are missing or invalid');
  } else if(type==='test'){
    const b=prior(pid,'build');
    check('build_gate_passed',b?.state==='completed','Build gate has not passed');
    check('artifact_structure_test',validFiles(pid),'Artifact structure test failed');
  } else if(type==='requirements'){
    const t=prior(pid,'test'), p=store.get('projects',pid);
    check('test_gate_passed',t?.state==='completed','Test gate has not passed');
    check('objective_present',Boolean(String(p?.objective??'').trim()),'Project objective is missing');
    check('requirements_recorded',Array.isArray(p?.requirements),'Project requirements are missing');
  } else if(type==='security'){
    const r=prior(pid,'requirements');
    check('requirements_gate_passed',r?.state==='completed','Requirement verification has not passed');
    const risky=code.flatMap(a=>(a.content?.files??[]).map(f=>({path:f.path,content:f.content}))).filter(f=>/\beval\s*\(|new\s+Function\s*\(|child_process|execSync\s*\(|rm\s+-rf|curl\s+[^\n|]*\|\s*(sh|bash)|-----BEGIN (RSA|PRIVATE) KEY-----/i.test(f.content));
    check('unsafe_patterns_absent',risky.length===0,risky.length?`Unsafe pattern found in: ${risky.map(x=>x.path).slice(0,5).join(', ')}`:'Unsafe patterns detected');
  } else if(type==='qa'){
    const s=prior(pid,'security');
    check('security_gate_passed',s?.state==='completed','Security gate has not passed');
    check('all_project_tasks_complete',store.list('tasks').filter(t=>t.projectId===pid&&!t.pipelineGate&&!t.finalProjectVerification).every(t=>t.state==='completed'),'One or more generation tasks are incomplete');
    check('artifacts_present',arts.length>0,'No project artifact available for QA');
    check('artifact_files_valid',validFiles(pid),'Artifact files failed QA structure checks');
  } else if(type==='integrity'){
    const q=prior(pid,'qa');
    check('qa_gate_passed',q?.state==='completed','QA gate has not passed');
    const ids=arts.map(a=>a.id);
    check('artifact_ids_unique',new Set(ids).size===ids.length,'Duplicate artifact IDs detected');
    check('artifact_metadata_valid',arts.every(a=>a.projectId===pid&&a.type&&a.createdAt),'Artifact metadata is incomplete');
  }
  return {type:'plan',taskId:task.id,gate:type,passed,checks,verifiedAt:now(),summary:passed?`${type} gate passed.`:`${type} gate failed.`};
}

registerExecutor('internal.pipeline-gate', async ({task}) => gateResult(task), {
  description:'Mandatory MAULI delivery pipeline gate', risk:'low', scope:'internal',
  capabilities:['verification','quality-assurance','security','testing']
});

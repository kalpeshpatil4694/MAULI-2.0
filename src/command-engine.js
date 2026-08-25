import { now } from './core.js';
import { store } from './store.js';
import { d1Put, d1List } from './db.js';
import { prepareCommand, executePlannedProject } from './orchestrator.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { saveCommandResult } from './result-recorder.js';

const MAX_STEP_MS = 25_000;
const STALE_MS = 2 * 60_000;

function sameText(a,b){return String(a||'').trim().toLocaleLowerCase()===String(b||'').trim().toLocaleLowerCase()}
function entity(c){return {...c, lifecycle:Array.isArray(c.lifecycle)?c.lifecycle:[], progress:c.progress??{percent:0,completed:0,total:0,currentTask:null}, phase:c.phase??'accepted', updatedAt:c.updatedAt??now()}}
async function persist(env,c){const value=entity(c);if(env?.DB?.prepare) await d1Put(env,'commands',value); else store.put('commands',value);return value}
async function read(env,id){if(env?.DB?.prepare){const rows=await d1List(env,'commands');return rows.find(x=>x.id===id)||null}return store.get('commands',id)}
async function latestReusable(command){return listProjects().filter(p=>sameText(p?.founderCommand,command)&&['active','planning','escalated'].includes(p?.state)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0]??null}
function projectSnapshot(project){const tasks=listTasks().filter(t=>t.projectId===project?.id);const done=tasks.filter(t=>t.state==='completed').length;const current=tasks.find(t=>['queued','assigned','working','verifying'].includes(t.state));const failed=tasks.filter(t=>['failed','blocked'].includes(t.state)).length;const total=tasks.length;return{tasks,progress:{percent:total?Math.round(done/total*100):0,completed:done,total,currentTask:current?.id??null},current,failed}}
function phase(project,snap){if(!project)return'planning';if(snap.current?.state==='verifying')return'verifying';if(snap.current?.state==='working')return'executing';if(snap.current?.state==='blocked'||snap.failed)return'recovering';if(project.state==='completed')return'delivery';if(snap.progress.percent===100)return'qa';return'executing'}
async function withTimeout(p,ms){return Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Autonomous step exceeded ${ms}ms; checkpoint saved for automatic resume`)),ms))])}

export async function createCommandRecord(env,text){const c={id:`cmd_${crypto.randomUUID()}`,command:text,state:'accepted',phase:'accepted',progress:{percent:0,completed:0,total:0,currentTask:null},lifecycle:['accepted'],createdAt:now(),updatedAt:now(),result:null,resultFile:null,error:null};return persist(env,c)}

export async function runCommandStep(env,commandId){
  let command=await read(env,commandId);if(!command)return null;
  if(['completed','failed'].includes(command.state))return command;
  command=await persist(env,{...command,state:'running',phase:command.phase==='accepted'?'planning':command.phase,lifecycle:[...new Set([...(command.lifecycle||[]),'running'])],updatedAt:now(),error:null});
  let project=command.projectId?store.get('projects',command.projectId):await latestReusable(command.command);
  try{
    if(!project){
      const prepared=await withTimeout(prepareCommand(command.command,env),MAX_STEP_MS);
      if(prepared?.status==='awaiting_approval'){
        return persist(env,{...command,state:'awaiting_approval',phase:'awaiting_approval',projectId:prepared.project?.id??null,lifecycle:[...new Set([...command.lifecycle,'awaiting_approval'])],updatedAt:now(),result:prepared,resultFile:null});
      }
      project=prepared.project;command={...command,projectId:project?.id??null};
    }
    if(!project)throw new Error('Command planning did not create a project');
    const snap=projectSnapshot(project);const current=snap.current;
    if(!current){
      const terminal=project.state==='completed'||snap.progress.percent===100;
      const final={...command,state:terminal?'completed':'failed',phase:terminal?'delivery':'failed',progress:snap.progress,updatedAt:now(),result:{project,tasks:snap.tasks,progress:snap.progress,status:terminal?'completed':'failed'},error:terminal?null:'No executable task remains'};
      const rf=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:final.result,error:final.error},env);final.resultFile=rf;final.state=rf.saved?final.state:'failed';final.error=rf.saved?final.error:'Result file persistence failed';return persist(env,final);
    }
    const selected=current.assignedAgentId?store.get('agents',current.assignedAgentId):null;
    const result=await withTimeout(executePlannedProject({project,task:current,selectedAgent:selected,env,approved:true,plannedTasks:snap.tasks.filter(t=>!t.finalProjectVerification).map(t=>({task:t,selectedAgent:t.assignedAgentId?store.get('agents',t.assignedAgentId):null}))}),MAX_STEP_MS);
    project=result?.project??store.get('projects',project.id);const after=projectSnapshot(project);const p=phase(project,after);const done=project.state==='completed'||(after.progress.percent===100&&after.tasks.every(t=>t.state==='completed'));
    const out={project,tasks:after.tasks,progress:after.progress,status:result?.status??(done?'completed':'active'),verification:result?.verification??null,execution:result?.execution??null,finalDelivery:result?.finalDelivery??null};
    const rf=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:out},env);
    const finished=done&&rf.saved;return persist(env,{...command,state:finished?'completed':(result?.status==='blocked'||result?.status==='escalated'?'failed':'running'),phase:finished?'delivery':p,projectId:project.id,progress:after.progress,lifecycle:[...new Set([...command.lifecycle,p,finished?'completed':'checkpoint'])],updatedAt:now(),result:out,resultFile:rf,error:finished?null:(rf.saved?null:rf.reason)});
  }catch(error){
    const snap=project?projectSnapshot(project):{progress:command.progress,tasks:[]};const recoverable=/checkpoint saved|timeout/i.test(error?.message||'');const out={project,tasks:snap.tasks,progress:snap.progress,status:'checkpoint',error:error?.message||String(error)};let rf=null;try{rf=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:out,error:out.error},env)}catch{}
    return persist(env,{...command,state:recoverable?'running':'failed',phase:recoverable?'recovering':'failed',projectId:project?.id??command.projectId??null,progress:snap.progress,lifecycle:[...new Set([...command.lifecycle,recoverable?'recovering':'failed'])],updatedAt:now(),result:out,resultFile:rf,error:recoverable?null:out.error});
  }
}

export async function resumePendingCommands(env){const rows=env?.DB?.prepare?await d1List(env,'commands'):store.list('commands');const running=rows.filter(c=>['accepted','running','recovering'].includes(c.state)).sort((a,b)=>String(a.updatedAt).localeCompare(String(b.updatedAt)));for(const c of running.slice(0,3)){if(Date.now()-new Date(c.updatedAt).getTime()>STALE_MS||c.state==='accepted')await runCommandStep(env,c.id)}return running.length}

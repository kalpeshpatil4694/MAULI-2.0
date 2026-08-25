import { now } from './core.js';
import { d1Put, d1List } from './db.js';
import { executeAutonomously } from './orchestrator.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { saveCommandResult } from './result-recorder.js';

const localCommands = new Map();
const POLL_MS = 2000;
const MAX_RUNTIME_MS = 10 * 60 * 1000;

function commandId(){ return `cmd_${crypto.randomUUID()}`; }
function statusEntity(command){
  return {
    id:command.id,
    command:command.command,
    state:command.state,
    phase:command.phase??null,
    projectId:command.projectId??null,
    progress:command.progress??null,
    lifecycle:command.lifecycle??[],
    createdAt:command.createdAt,
    updatedAt:command.updatedAt,
    result:command.result??null,
    resultFile:command.resultFile??null,
    error:command.error??null
  };
}

async function persist(env, command){
  if(env?.DB && typeof env.DB.prepare==='function') await d1Put(env,'commands',statusEntity(command));
  else localCommands.set(command.id,statusEntity(command));
  return command;
}

export async function createCommand(env, commandText){
  const command={id:commandId(),command:commandText,state:'accepted',phase:'accepted',progress:{percent:0,completed:0,total:0,currentTask:null},lifecycle:['accepted'],createdAt:now(),updatedAt:now()};
  await persist(env,command);
  return command;
}

export async function getCommand(env,id){
  if(env?.DB && typeof env.DB.prepare==='function'){
    const rows=await d1List(env,'commands');
    return rows.find(x=>x.id===id)||null;
  }
  return localCommands.get(id)||null;
}

export async function listRecentCommands(env,limit=20){
  const rows=env?.DB&&typeof env.DB.prepare==='function'?await d1List(env,'commands'):Array.from(localCommands.values());
  return rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,Math.max(1,Math.min(50,Number(limit)||20)));
}

function snapshotForCommand(commandText, createdAt){
  const projects=listProjects().filter(p=>p?.founderCommand===commandText && String(p.createdAt??'')>=String(createdAt??''));
  const project=projects.sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')))[0]??null;
  const tasks=project?listTasks().filter(t=>t.projectId===project.id):[];
  const completed=tasks.filter(t=>t.state==='completed').length;
  const working=tasks.find(t=>t.state==='working');
  const blocked=tasks.find(t=>t.state==='blocked');
  const failed=tasks.filter(t=>t.state==='failed').length;
  const finalQa=tasks.find(t=>t.finalProjectVerification);
  let phase='planning';
  if(project){
    if(project.state==='completed') phase='delivery';
    else if(finalQa?.state==='working'||finalQa?.state==='verifying') phase='qa';
    else if(blocked) phase='recovering';
    else if(working) phase='executing';
    else if(tasks.some(t=>t.state==='verifying')) phase='verifying';
    else phase='executing';
  }
  return {project,tasks,phase,progress:{percent:tasks.length?Math.round((completed/tasks.length)*100):0,completed,total:tasks.length,currentTask:working?.id??null},failed};
}

async function monitorCommand(env, command, executionPromise){
  const started=Date.now();
  let lastSignature='';
  while(Date.now()-started<MAX_RUNTIME_MS){
    const current=await getCommand(env,command.id);
    if(current?.state==='failed'||current?.state==='completed') return current;
    const snap=snapshotForCommand(command.command,command.createdAt);
    const lifecycle=[...(current?.lifecycle??[])];
    if(!lifecycle.includes(snap.phase)) lifecycle.push(snap.phase);
    const signature=JSON.stringify([snap.phase,snap.project?.id,snap.progress,snap.failed]);
    if(signature!==lastSignature){
      lastSignature=signature;
      await persist(env,{...current,...command,state:'running',phase:snap.phase,projectId:snap.project?.id??null,progress:snap.progress,lifecycle,updatedAt:now(),result:null,error:null});
    }
    const done=await Promise.race([executionPromise.then(()=>true).catch(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),POLL_MS))]);
    if(done) return await getCommand(env,command.id);
  }
  return null;
}

export async function runCommand(env,command){
  const running={...command,state:'running',phase:'received',lifecycle:[...(command.lifecycle??[]),'received'],updatedAt:now()};
  await persist(env,running);
  const executionPromise=executeAutonomously(command.command,env);
  const monitorPromise=monitorCommand(env,running,executionPromise);
  try{
    const result=await Promise.race([
      executionPromise,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Command execution exceeded ${MAX_RUNTIME_MS/60000} minutes`)),MAX_RUNTIME_MS))
    ]);
    const current=await getCommand(env,command.id);
    if(current?.state==='failed'&&current.error) return current;
    const projects=result?.project?[result.project]:listProjects();
    const tasks=listTasks();
    const project=projects.find(p=>p?.id===result?.project?.id)||result?.project||null;
    const projectTasks=project?tasks.filter(t=>t.projectId===project.id):[];
    const safeCompleted=!project||project.state!=='completed'||(projectTasks.every(t=>t.state==='completed'||t.state==='failed')&&projectTasks.every(t=>t.state!=='queued'&&t.state!=='working'));
    const safeResult=project?.state==='completed'&&!safeCompleted?{...result,project:{...project,state:'active',completionGuard:'blocked-until-all-tasks-finish'}}:result;
    const saved=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:safeResult},env);
    const completed={...running,state:saved.saved?'completed':'failed',phase:saved.saved?'delivery':'failed',projectId:project?.id??current?.projectId??null,progress:result?.progress??project?.progress??current?.progress??null,lifecycle:[...(current?.lifecycle??running.lifecycle??[]),saved.saved?'completed':'failed'],updatedAt:now(),result:safeResult,resultFile:saved,error:saved.saved?null:'Result file persistence failed'};
    await persist(env,completed);
    return completed;
  }catch(error){
    const current=await getCommand(env,command.id);
    if(current?.state==='completed'||(current?.state==='failed'&&current.error)) return current;
    const snap=snapshotForCommand(command.command,command.createdAt);
    const failed={...running,state:'failed',phase:'failed',projectId:snap.project?.id??null,progress:snap.progress,lifecycle:[...(current?.lifecycle??running.lifecycle??[]),'failed'],updatedAt:now(),error:error?.message||'Command execution failed'};
    let resultFile=null;
    try{resultFile=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:null,error:failed.error,projectId:snap.project?.id??null,progress:snap.progress},env);}catch{}
    await persist(env,{...failed,resultFile});
    return {...failed,resultFile};
  }finally{
    await monitorPromise.catch(()=>{});
  }
}

export function startCommand(env,command,waitUntil){
  const job=runCommand(env,command);
  if(typeof waitUntil==='function') waitUntil(job);
  else job.catch(()=>{});
}

import { now } from './core.js';
import { d1Put, d1List } from './db.js';
import { executeAutonomously } from './orchestrator.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { saveCommandResult } from './result-recorder.js';

const localCommands = new Map();

function commandId(){ return `cmd_${crypto.randomUUID()}`; }
function statusEntity(command){ return { id:command.id, command:command.command, state:command.state, createdAt:command.createdAt, updatedAt:command.updatedAt, result:command.result??null, error:command.error??null }; }

async function persist(env, command){
  if(env?.DB && typeof env.DB.prepare==='function') await d1Put(env,'commands',statusEntity(command));
  else localCommands.set(command.id,statusEntity(command));
  return command;
}

export async function createCommand(env, commandText){
  const command={id:commandId(),command:commandText,state:'accepted',createdAt:now(),updatedAt:now()};
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

export async function runCommand(env,command){
  const running={...command,state:'running',updatedAt:now()};
  await persist(env,running);
  try{
    const result=await executeAutonomously(command.command,env);
    const projects=result?.project?[result.project]:listProjects();
    const tasks=listTasks();
    const project=projects.find(p=>p?.id===result?.project?.id)||result?.project||null;
    const projectTasks=project?tasks.filter(t=>t.projectId===project.id):[];
    const safeCompleted=!project||project.state!=='completed'||(projectTasks.every(t=>t.state==='completed'||t.state==='failed')&&projectTasks.every(t=>t.state!=='queued'&&t.state!=='working'));
    const safeResult=project?.state==='completed'&&!safeCompleted?{...result,project:{...project,state:'active',completionGuard:'blocked-until-all-tasks-finish'}}:result;
    const saved=await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:safeResult},env);
    const completed={...running,state:saved.saved?'completed':'failed',updatedAt:now(),result:safeResult,resultFile:saved,error:saved.saved?null:'Result file persistence failed'};
    await persist(env,completed);
    return completed;
  }catch(error){
    const failed={...running,state:'failed',updatedAt:now(),error:error?.message||'Command execution failed'};
    try{await saveCommandResult({command:command.command,commandId:command.id,generatedAt:now(),result:null,error:failed.error},env);}catch{}
    await persist(env,failed);
    return failed;
  }
}

export function startCommand(env,command,waitUntil){
  const job=runCommand(env,command);
  if(typeof waitUntil==='function') waitUntil(job);
  else job.catch(()=>{});
}

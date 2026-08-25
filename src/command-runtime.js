import { d1List } from './db.js';
import { createCommandRecord, runCommandStep, resumePendingCommands } from './command-engine.js';

export async function createCommand(env,commandText){return createCommandRecord(env,commandText)}
export async function getCommand(env,id){if(env?.DB?.prepare){const rows=await d1List(env,'commands');return rows.find(x=>x.id===id)||null}return (await import('./store.js')).store.get('commands',id)}
export async function listRecentCommands(env,limit=20){const rows=env?.DB?.prepare?await d1List(env,'commands'):(await import('./store.js')).store.list('commands');return rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,Math.max(1,Math.min(50,Number(limit)||20)))}
export async function runCommand(env,command){return runCommandStep(env,command.id)}
export async function startCommand(env,command,waitUntil){
  // The first lifecycle step is response-critical: awaiting it prevents Cloudflare's
  // 30s HTTP waitUntil ceiling from cancelling planning before its checkpoint is saved.
  const current=await runCommandStep(env,command.id);
  const job=(async()=>{let next=current;let guard=0;while(next&&['accepted','running','recovering'].includes(next.state)&&guard++<24){await new Promise(r=>setTimeout(r,100));next=await runCommandStep(env,command.id,true)}return next})();
  if(typeof waitUntil==='function')waitUntil(job);else job.catch(()=>{});
  return current;
}
export { resumePendingCommands };

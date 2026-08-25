import { d1List } from './db.js';
import { createCommandRecord, runCommandStep, resumePendingCommands } from './command-engine.js';

export async function createCommand(env,commandText){return createCommandRecord(env,commandText)}
export async function getCommand(env,id){if(env?.DB?.prepare){const rows=await d1List(env,'commands');return rows.find(x=>x.id===id)||null}return (await import('./store.js')).store.get('commands',id)}
export async function listRecentCommands(env,limit=20){const rows=env?.DB?.prepare?await d1List(env,'commands'):(await import('./store.js')).store.list('commands');return rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,Math.max(1,Math.min(50,Number(limit)||20)))}
export async function runCommand(env,command){return runCommandStep(env,command.id)}
export function startCommand(env,command,waitUntil){const job=(async()=>{let current=await runCommandStep(env,command.id);let guard=0;while(current&&['accepted','running','recovering'].includes(current.state)&&guard++<24){await new Promise(r=>setTimeout(r,100));current=await runCommandStep(env,command.id)}return current})();if(typeof waitUntil==='function')waitUntil(job);else job.catch(()=>{});return job}
export { resumePendingCommands };

import { now } from './core.js';
import { store } from './store.js';
const DEFAULT_ESTIMATES_MS={research:120000,'product-planning':120000,backend:300000,database:240000,frontend:360000,native:420000,pdf:180000,security:180000,testing:180000,'internal.plan':120000,'internal.code':300000,'internal.native':420000,'internal.pdf':180000};
// Estimates are a planning aid, not telemetry. One corrupted duration — a task whose
// recorded start sat weeks before its completion — fed a 679h sample into the history
// average, which then became the stored estimate of every later task of that type. The
// project card started reporting 2719h estimated / 679h remaining for a project that
// finishes in minutes. Clamp at every stage so no single sample can poison the rest.
export const MIN_TASK_ESTIMATE_MS=30_000;
export const MAX_TASK_ESTIMATE_MS=60*60*1000;
export const MAX_PROJECT_ESTIMATE_MS=24*60*60*1000;
function clampTaskEstimate(ms){const n=Number(ms);if(!Number.isFinite(n)||n<=0)return MIN_TASK_ESTIMATE_MS;return Math.min(MAX_TASK_ESTIMATE_MS,Math.max(MIN_TASK_ESTIMATE_MS,Math.round(n)));}
// A stored estimate only counts when it is plausible; anything larger (a poisoned value
// already written to D1) is discarded and recomputed. Exported so bulk serializers can
// strip the poisoned number from a payload instead of shipping it to clients.
export function sanitizeTaskEstimate(ms){const n=Number(ms);return Number.isFinite(n)&&n>0&&n<=MAX_TASK_ESTIMATE_MS?n:null;}
function clampProjectEstimate(ms){const n=Number(ms);if(!Number.isFinite(n)||n<=0)return 0;return Math.min(MAX_PROJECT_ESTIMATE_MS,Math.max(0,Math.round(n)));}
function key(t){if(t?.key&&DEFAULT_ESTIMATES_MS[t.key])return t.key;const c=Array.isArray(t?.requiredCapabilities)?t.requiredCapabilities:[];for(const k of ['research','product-planning','backend','database','frontend','native','pdf','security','testing'])if(c.includes(k))return k;return t?.executor||'internal.plan';}
export function estimateTaskDurationMs(task){
  const k=key(task);
  // Samples above the ceiling are recording errors, not signal: the defaults are 2-7
  // minutes, so a 679h "actual" has nothing useful to teach the estimator.
  const h=store.list('tasks').filter(t=>t.id!==task?.id&&t.state==='completed'&&key(t)===k).map(t=>Number(t.actualDurationMs)).filter(v=>Number.isFinite(v)&&v>0&&v<=MAX_TASK_ESTIMATE_MS).sort((a,b)=>a-b);
  if(h.length>=2){const v=h.length>=5?h.slice(1,-1):h;return clampTaskEstimate(v.reduce((a,b)=>a+b,0)/v.length);}
  return clampTaskEstimate(DEFAULT_ESTIMATES_MS[k]??120000);
}
export function formatDuration(ms){const n=Math.max(0,Number(ms)||0),x=Math.round(n/1000),h=Math.floor(x/3600),m=Math.floor(x%3600/60),s=x%60;return h?h+'h '+m+'m '+s+'s':m?m+'m '+s+'s':s+'s';}
export function enrichTaskTiming(t){
  if(!t)return t;
  const estimatedDurationMs=sanitizeTaskEstimate(t.estimatedDurationMs)??estimateTaskDurationMs(t);
  const end=t.completedAt||t.failedAt||null;
  const actualDurationMs=t.startedAt?Math.max(0,Date.parse(end||now())-Date.parse(t.startedAt)):Number(t.actualDurationMs)||0;
  const remainingMs=['completed','failed','cancelled'].includes(t.state)?0:Math.max(0,estimatedDurationMs-actualDurationMs);
  return {...t,estimatedDurationMs,estimatedDurationFormatted:formatDuration(estimatedDurationMs),actualDurationMs,actualDurationFormatted:formatDuration(actualDurationMs),elapsedMs:actualDurationMs,elapsedFormatted:formatDuration(actualDurationMs),remainingMs,remainingFormatted:formatDuration(remainingMs)};
}
export function estimateProjectDuration(tasks){
  const sum=(Array.isArray(tasks)?tasks:[]).reduce((s,t)=>s+(sanitizeTaskEstimate(t?.estimatedDurationMs)??estimateTaskDurationMs(t)),0);
  return clampProjectEstimate(sum);
}
export function enrichProjectTiming(project,tasks){
  const list=(Array.isArray(tasks)?tasks:[]).map(enrichTaskTiming);
  const stored=Number(project?.estimatedDurationMs);
  const estimatedDurationMs=Number.isFinite(stored)&&stored>0&&stored<=MAX_PROJECT_ESTIMATE_MS?stored:estimateProjectDuration(list);
  const startedAt=project?.commandStartedAt||project?.startedAt||project?.commandReceivedAt||project?.createdAt;
  const end=project?.commandCompletedAt||project?.completedAt||project?.failedAt;
  const actualDurationMs=startedAt?Math.max(0,Date.parse(end||now())-Date.parse(startedAt)):0;
  const remainingMs=['completed','failed','cancelled'].includes(project?.state)?0:clampProjectEstimate(list.filter(t=>!['completed','failed','cancelled'].includes(t.state)).reduce((s,t)=>s+(t.state==='working'?Math.max(0,t.remainingMs):Number(t.estimatedDurationMs)||0),0));
  return{estimatedDurationMs,estimatedDurationFormatted:formatDuration(estimatedDurationMs),actualDurationMs,actualDurationFormatted:formatDuration(actualDurationMs),elapsedMs:actualDurationMs,elapsedFormatted:formatDuration(actualDurationMs),remainingMs,remainingFormatted:formatDuration(remainingMs),tasks:list};
}

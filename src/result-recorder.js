import { store } from './store.js';

function normalizeResult(result) {
  if(!result||typeof result!=='object') return result;
  if(result.artifact) return result;
  if(result.finalDelivery?.id) return {...result,artifact:result.finalDelivery.id,artifactType:result.finalDelivery.type??'final-delivery'};
  if(result.execution?.result?.artifactId) return {...result,artifact:result.execution.result.artifactId};
  const projectId=result.project?.id;
  if(result.status==='completed'&&projectId&&store?.list){
    const a=(store.list('artifacts')||[]).filter(x=>x?.projectId===projectId&&x?.type==='final-delivery')
      .sort((x,y)=>String(y?.createdAt??'').localeCompare(String(x?.createdAt??'')))[0];
    if(a?.id) return {...result,artifact:a.id,artifactType:a.type};
  }
  return result;
}

function runId(result) {
  return result?.runId||result?.resultRunId||result?.execution?.id||result?.execution?.executionId||result?.project?.id||`run_${Date.now()}_${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
}

export async function diagnoseResultPersistence(env={}) {
  await store?.flush?.();
  return {
    ok:true,
    tokenConfigured:Boolean(env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT||env?.RESULT_GITHUB_TOKEN),
    storage:'D1',
    mode:'d1-only',
    githubSync:false,
    reason:'Runtime command results are persisted in D1; GitHub is not used as the runtime result database.'
  };
}

export async function saveCommandResult(result,env={}) {
  const id=runId(result);
  const payload={...result,result:normalizeResult(result.result),resultRunId:id,savedAt:new Date().toISOString()};
  // Runtime persistence is D1-backed through MemoryStore. The id is stable, so retries update the same entity.
  try {
    store.put('command_results',payload);
    await store?.flush?.();
    return {saved:true,runId:id,storage:'d1',githubSync:{synced:false,disabled:true},mode:'d1-only'};
  } catch(e) {
    return {saved:false,runId:id,storage:'d1',githubSync:{synced:false,disabled:true},mode:'d1-only',reason:e?.message||'Result persistence failed'};
  }
}

export function listCommandResults(){ return store.list('command_results')||[]; }
export function getCommandResult(runId){ return (store.list('command_results')||[]).find(r=>r?.resultRunId===runId)||null; }

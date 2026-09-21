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
  return result?.runId||result?.resultRunId||result?.execution?.id||result?.execution?.executionId||result?.project?.commandRunId||result?.project?.id||`run_${Date.now()}_${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;
}

function recordId(runIdValue){ return `command-result:${runIdValue}`; }

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
  const idValue=runId(result);
  const payload={
    ...result,
    id:recordId(idValue),
    resultRunId:idValue,
    result:normalizeResult(result.result),
    savedAt:new Date().toISOString(),
    persistenceVersion:2
  };
  try {
    // Canonical upsert: every command run owns exactly one command_results row.
    // Replays/retries therefore rewrite the same result instead of creating duplicates.
    const existing=store.get('command_results',payload.id);
    store.put('command_results',{...(existing??{}),...payload,id:payload.id});
    await store?.flush?.();
    return {saved:true,runId:idValue,recordId:payload.id,updated:Boolean(existing),storage:'d1',githubSync:{synced:false,disabled:true},mode:'d1-only'};
  } catch(e) {
    return {saved:false,runId:idValue,recordId:payload.id,storage:'d1',githubSync:{synced:false,disabled:true},mode:'d1-only',reason:e?.message||'Result persistence failed'};
  }
}

export function listCommandResults(){
  return (store.list('command_results')||[])
    .sort((a,b)=>String(b?.savedAt??b?.updatedAt??'').localeCompare(String(a?.savedAt??a?.updatedAt??'')));
}

export function getCommandResult(runIdValue){
  if(!runIdValue)return null;
  const canonical=store.get('command_results',recordId(runIdValue));
  if(canonical)return canonical;
  // Backward-compatible read for pre-v2 records; prefer the newest legacy row.
  return (store.list('command_results')||[])
    .filter(r=>r?.resultRunId===runIdValue)
    .sort((a,b)=>String(b?.savedAt??b?.updatedAt??'').localeCompare(String(a?.savedAt??a?.updatedAt??'')))[0]??null;
}

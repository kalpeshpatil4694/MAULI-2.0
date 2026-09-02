import { store } from './store.js';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'kalpeshpatil4694/MAULI-2.0';
const DEFAULT_PATH = 'Result/runs';
const DEFAULT_BRANCH = 'main';

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToUtf8(value) { const binary = atob(value.replace(/\n/g, '')); return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))); }
function headers(token) { return { Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'MAULI-2.0-result-recorder', 'Content-Type':'application/json' }; }
function config(env={}) { return { api:env?.GITHUB_API_URL||GITHUB_API, repo:env?.GITHUB_RESULT_REPO||DEFAULT_REPO, path:env?.GITHUB_RESULT_PATH||DEFAULT_PATH, branch:env?.GITHUB_RESULT_BRANCH||DEFAULT_BRANCH }; }
function tokenInfo(env={}) { const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT||env?.RESULT_GITHUB_TOKEN; return { token, tokenSource:env?.GITHUB_TOKEN?'GITHUB_TOKEN':env?.MAULI_GITHUB_TOKEN?'MAULI_GITHUB_TOKEN':env?.GITHUB_PAT?'GITHUB_PAT':env?.RESULT_GITHUB_TOKEN?'RESULT_GITHUB_TOKEN':null }; }
async function github(url,options={}) { const response=await fetch(url,options); const text=await response.text(); let data=null; try{data=text?JSON.parse(text):null;}catch{data={raw:text};} return {response,data}; }
async function readCurrent(url,h) { const {response,data}=await github(url,{headers:h}); if(response.ok)return{ok:true,sha:data?.sha||null,type:data?.type||null}; if(response.status===404)return{ok:true,sha:null,type:null}; return{ok:false,status:response.status,detail:data?.message||''}; }
function normalizeResult(result) {
  if(!result||typeof result!=='object')return result;
  if(result.artifact)return result;
  if(result.finalDelivery?.id)return{...result,artifact:result.finalDelivery.id,artifactType:result.finalDelivery.type??'final-delivery'};
  if(result.execution?.result?.artifactId)return{...result,artifact:result.execution.result.artifactId};
  const projectId=result.project?.id;
  if(result.status==='completed'&&projectId&&store?.list){const a=(store.list('artifacts')||[]).filter(x=>x?.projectId===projectId&&x?.type==='final-delivery').sort((x,y)=>String(y?.createdAt??'').localeCompare(String(x?.createdAt??'')))[0];if(a?.id)return{...result,artifact:a.id,artifactType:a.type};}
  return result;
}
function runId(result) { return result?.runId||result?.resultRunId||result?.execution?.id||result?.execution?.executionId||result?.project?.id||`run_${Date.now()}_${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`; }
function resultPath(base,id) { const clean=String(id).replace(/[^a-zA-Z0-9._-]/g,'_'); return `${base.replace(/\/$/,'')}/${clean}.json`; }

export async function diagnoseResultPersistence(env={}) {
  await store?.flush?.(); const cfg=config(env); const {token,tokenSource}=tokenInfo(env);
  if(!token)return{ok:false,tokenConfigured:false,reason:'GitHub token is not configured'};
  const url=`${cfg.api}/repos/${cfg.repo}/contents/${cfg.path}`; const current=await readCurrent(`${url}?ref=${encodeURIComponent(cfg.branch)}`,headers(token));
  if(!current.ok)return{ok:false,reason:`GitHub Result history read failed (${current.status})`};
  return{ok:true,tokenConfigured:true,tokenSource,repo:cfg.repo,path:cfg.path,branch:cfg.branch,exists:Boolean(current.sha),type:current.type||null,mode:'per-run upsert'};
}

export async function saveCommandResult(result,env={}) {
  await store?.flush?.(); const cfg=config(env); const {token}=tokenInfo(env); const id=runId(result);
  const payload={...result,result:normalizeResult(result.result),resultRunId:id,savedAt:new Date().toISOString()};
  // store.put() is entity-oriented. Persist exactly one entity per run instead of storing the entire array as one entity.
  try { store.put('command_results',payload); await store?.flush?.(); } catch (_) {}
  let githubSync=null;
  if(token){
    try{
      const ghPath=resultPath(cfg.path,id); const url=`${cfg.api}/repos/${cfg.repo}/contents/${ghPath.split('/').map(encodeURIComponent).join('/')}`; const h=headers(token); const ghPayload=JSON.stringify(payload,null,2)+'\n';
      const current=await readCurrent(`${url}?ref=${encodeURIComponent(cfg.branch)}`,h); const body={message:`chore: record MAULI command result ${id}`,content:utf8ToBase64(ghPayload),branch:cfg.branch}; if(current.ok&&current.sha)body.sha=current.sha;
      const {response,data}=await github(url,{method:'PUT',headers:h,body:JSON.stringify(body)}); githubSync=response.ok?{synced:true,commitSha:data?.commit?.sha||null}:{synced:false,reason:data?.message||`HTTP ${response.status}`};
    }catch(e){githubSync={synced:false,reason:e.message};}
  }
  return{saved:true,runId:id,storage:'local',githubSync:githubSync||{synced:false,reason:'No GitHub token configured'},mode:'local+github-sync'};
}
export function listCommandResults(){return store.list('command_results')||[];}
export function getCommandResult(runId){return(store.list('command_results')||[]).find(r=>r?.resultRunId===runId)||null;}
export function decodeStoredResult(content){return JSON.parse(base64ToUtf8(content));}

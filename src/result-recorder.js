import { store } from './store.js';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'kalpeshpatil4694/MAULI-2.0';
const DEFAULT_PATH = 'Result';
const DEFAULT_BRANCH = 'main';
const MAX_ATTEMPTS = 3;

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}
function base64ToUtf8(value) {
  const binary = atob(value.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}
function headers(token) {
  return { Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'MAULI-2.0-result-recorder', 'Content-Type':'application/json' };
}
function diag(stage, extra={}) { return { stage, at:new Date().toISOString(), ...extra }; }
function config(env={}) {
  return { api: env?.GITHUB_API_URL || GITHUB_API, repo: env?.GITHUB_RESULT_REPO || DEFAULT_REPO, path: env?.GITHUB_RESULT_PATH || DEFAULT_PATH, branch: env?.GITHUB_RESULT_BRANCH || DEFAULT_BRANCH };
}
function tokenInfo(env={}) {
  const token = env?.GITHUB_TOKEN || env?.MAULI_GITHUB_TOKEN || env?.GITHUB_PAT || env?.RESULT_GITHUB_TOKEN;
  const tokenSource = env?.GITHUB_TOKEN ? 'GITHUB_TOKEN' : env?.MAULI_GITHUB_TOKEN ? 'MAULI_GITHUB_TOKEN' : env?.GITHUB_PAT ? 'GITHUB_PAT' : env?.RESULT_GITHUB_TOKEN ? 'RESULT_GITHUB_TOKEN' : null;
  return { token, tokenSource };
}
async function github(url, options={}) {
  const response = await fetch(url, options); const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; } return { response, data };
}
async function readCurrent(url, requestHeaders) {
  const {response,data}=await github(url,{headers:requestHeaders}); if(response.ok) return {ok:true,sha:data?.sha||null,content:data?.content||''}; if(response.status===404) return {ok:true,sha:null,content:''}; return {ok:false,status:response.status,detail:data?.message||''};
}
async function verifyWrite(url, requestHeaders, expectedPayload, branch) {
  const verifyUrl = `${url}?ref=${encodeURIComponent(branch)}`; const {response,data}=await github(verifyUrl,{headers:requestHeaders}); if(!response.ok) return {ok:false,reason:`GitHub verification failed (${response.status})${data?.message?`: ${data.message}`:''}`}; let actual=''; try { actual=base64ToUtf8(data?.content||''); } catch {} return actual===expectedPayload ? {ok:true,sha:data?.sha||null} : {ok:false,reason:'GitHub verification failed: Result content does not match latest command result'};
}
function normalizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.artifact) return result;
  if (result.finalDelivery?.id) return { ...result, artifact: result.finalDelivery.id, artifactType: result.finalDelivery.type ?? 'final-delivery' };
  if (result.execution?.result?.artifactId) return { ...result, artifact: result.execution.result.artifactId };
  const projectId = result.project?.id;
  if (result.status === 'completed' && projectId && store?.list) {
    const artifacts = store.list('artifacts') || [];
    const finalDelivery = artifacts
      .filter(artifact => artifact?.projectId === projectId && artifact?.type === 'final-delivery')
      .sort((a, b) => String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? '')))[0];
    if (finalDelivery?.id) return { ...result, artifact: finalDelivery.id, artifactType: finalDelivery.type };
  }
  return result;
}
export async function diagnoseResultPersistence(env={}) {
  const cfg=config(env); const {token,tokenSource}=tokenInfo(env); const diagnostics=[diag('diagnostic-start',{repo:cfg.repo,path:cfg.path,branch:cfg.branch,api:cfg.api,tokenConfigured:Boolean(token),tokenSource})];
  if(!token) return {ok:false,tokenConfigured:false,reason:'GitHub token is not configured (expected GITHUB_TOKEN, MAULI_GITHUB_TOKEN, GITHUB_PAT, or RESULT_GITHUB_TOKEN)',diagnostics:diagnostics.concat(diag('missing-token'))};
  const url=`${cfg.api}/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`; const current=await readCurrent(`${url}?ref=${encodeURIComponent(cfg.branch)}`,headers(token));
  if(!current.ok) return {ok:false,tokenConfigured:true,reason:`GitHub Result read failed (${current.status})${current.detail?`: ${current.detail}`:''}`,diagnostics:diagnostics.concat(diag('read-failed',{status:current.status}))};
  return {ok:true,tokenConfigured:true,tokenSource,repo:cfg.repo,path:cfg.path,branch:cfg.branch,exists:Boolean(current.sha),sha:current.sha||null,diagnostics:diagnostics.concat(diag('read-ok',{exists:Boolean(current.sha),sha:current.sha||null}))};
}
export async function saveCommandResult(result, env) {
  const diagnostics=[]; const cfg=config(env); const {token,tokenSource}=tokenInfo(env); diagnostics.push(diag('start',{repo:cfg.repo,path:cfg.path,branch:cfg.branch,api:cfg.api,tokenConfigured:Boolean(token),tokenSource}));
  if(!token) return {saved:false,reason:'GitHub token is not configured (expected GITHUB_TOKEN, MAULI_GITHUB_TOKEN, GITHUB_PAT, or RESULT_GITHUB_TOKEN)',diagnostics:diagnostics.concat(diag('missing-token'))};
  const url=`${cfg.api}/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`; const requestHeaders=headers(token); const payload=JSON.stringify({ ...result, result: normalizeResult(result.result) },null,2)+'\n';
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++) {
    diagnostics.push(diag('read-start',{attempt})); const current=await readCurrent(`${url}?ref=${encodeURIComponent(cfg.branch)}`,requestHeaders);
    if(!current.ok) return {saved:false,reason:`GitHub read failed (${current.status})${current.detail?`: ${current.detail}`:''}`,diagnostics:diagnostics.concat(diag('read-failed',{attempt,status:current.status}))};
    diagnostics.push(diag('read-ok',{attempt,existingSha:current.sha,replacing:Boolean(current.sha)})); const body={message:'chore: replace latest MAULI command result',content:utf8ToBase64(payload),branch:cfg.branch}; if(current.sha) body.sha=current.sha;
    diagnostics.push(diag('write-start',{attempt,replacing:Boolean(current.sha)})); const {response,data}=await github(url,{method:'PUT',headers:requestHeaders,body:JSON.stringify(body)});
    if(response.ok) { diagnostics.push(diag('write-ok',{attempt,commitSha:data?.commit?.sha||null,contentSha:data?.content?.sha||null})); const verified=await verifyWrite(url,requestHeaders,payload,cfg.branch); diagnostics.push(diag(verified.ok?'verify-ok':'verify-failed',{attempt,sha:verified.sha||null,reason:verified.reason||null})); if(!verified.ok) return {saved:false,reason:verified.reason,diagnostics}; return {saved:true,replaced:Boolean(current.sha),path:cfg.path,branch:cfg.branch,commitSha:data?.commit?.sha||verified.sha||null,attempts:attempt,diagnostics}; }
    diagnostics.push(diag('write-failed',{attempt,status:response.status,error:data?.message||null})); if(response.status!==409 || attempt===MAX_ATTEMPTS) return {saved:false,reason:`GitHub write failed (${response.status})${data?.message?`: ${data.message}`:''}`,diagnostics};
  }
  return {saved:false,reason:'GitHub write failed after retries',diagnostics};
}
export function decodeStoredResult(content){ return JSON.parse(base64ToUtf8(content)); }

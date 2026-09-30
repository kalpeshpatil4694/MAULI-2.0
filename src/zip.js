function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function u16(v){return new Uint8Array([v&255,(v>>>8)&255])}
function u32(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255])}
function text(s){return new TextEncoder().encode(String(s??''))}
function concat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function safePath(path){return String(path||'file.txt').replace(/^\/+/, '').replace(/\.\.(?:\/|\\)/g,'').replace(/\\/g,'/')||'file.txt'}
// `artifacts` lets the caller pass the authoritative artifact list it already
// resolved (e.g. straight from D1 on a cold isolate) instead of re-deriving it
// from the row-capped in-memory cache.
// Newest artifact first. A project keeps one code-workspace artifact per generation run, all
// holding the whole file set, so the same path appears many times. The last copy used to win
// while the pool arrives newest-first, which meant /api/build-app pushed the OLDEST version of
// every file to the build branch: the dashboard showed one app and the APK contained another.
// Ordering by createdAt matches the artifact /api/build-app treats as latest.
function artifactStamp(a){const t=Date.parse(a?.createdAt||a?.updatedAt||'');return Number.isFinite(t)?t:0}
export function collectProjectFiles(projectId,artifact,store,provided){const pool=Array.isArray(provided)?provided:store.list('artifacts');const artifacts=pool.filter(a=>a.projectId===projectId&&a.type==='code-workspace').slice().sort((a,b)=>artifactStamp(b)-artifactStamp(a));const files=[];for(const a of artifacts){for(const f of (a.content?.files??[])){if(typeof f?.path==='string'&&typeof f?.content==='string')files.push({path:safePath(f.path),content:f.content})}}if(!files.length&&artifact?.content?.files){for(const f of artifact.content.files){if(typeof f?.path==='string'&&typeof f?.content==='string')files.push({path:safePath(f.path),content:f.content})}}const unique=new Map();for(const f of files)if(!unique.has(f.path))unique.set(f.path,f);return [...unique.values()]}
export function createZip(files){const locals=[],centrals=[];let offset=0;for(const file of files){const name=text(file.path),data=text(file.content),crc=crc32(data),local=concat([new Uint8Array([80,75,3,4]),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);const central=concat([new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);centrals.push(central);offset+=local.length}const body=concat([...locals,...centrals]);const cdSize=centrals.reduce((n,p)=>n+p.length,0),cdOffset=body.length-cdSize;const end=concat([new Uint8Array([80,75,5,6]),u16(0),u16(0),u16(files.length),u16(files.length),u32(cdSize),u32(cdOffset),u16(0)]);return concat([body,end])}

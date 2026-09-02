import { id, now } from './core.js';
import { store } from './store.js';
export const TOOL_RISK={read:'low',low:'low',medium:'medium',write:'high',high:'high',destructive:'critical',critical:'critical',external:'high'};
const runtimeHandlers=new Map();
function normalizeRisk(risk='read'){if(risk==='low')return'read';if(risk==='high')return'write';if(risk==='critical')return'destructive';if(['read','medium','write','destructive','external'].includes(risk))return risk;throw new Error(`Unknown tool risk: ${risk}`);}
export function registerTool({name,description,risk='read',handler,capabilities=[],scope='internal',allowedAgents=[],allowedProjects=[],enabled=true}){if(!name||typeof name!=='string')throw new Error('Tool name is required');const normalizedRisk=normalizeRisk(risk);const tool=store.put('tools',{id:`tool_${name}`,name,description,risk:normalizedRisk,capabilities,scope,allowedAgents,allowedProjects,enabled:enabled!==false,registeredAt:now()});if(typeof handler==='function')runtimeHandlers.set(name,handler);return tool;}
export function listTools(){return store.list('tools').filter(tool=>tool.enabled!==false);}
const riskOrder={read:0,medium:1,external:2,write:2,destructive:3};
export function selectTools(requiredCapabilities=[],options={}){const required=[...new Set(requiredCapabilities)];const allowedScopes=Array.isArray(options.allowedScopes)?options.allowedScopes:null;const maxRisk=options.maxRisk==null?null:normalizeRisk(options.maxRisk);return listTools().filter(tool=>!options.scope||tool.scope===options.scope).filter(tool=>!allowedScopes||allowedScopes.includes(tool.scope)).filter(tool=>maxRisk==null||(riskOrder[tool.risk]??99)<=(riskOrder[maxRisk]??99)).map(tool=>{const matched=required.filter(cap=>(tool.capabilities??[]).includes(cap));const score=required.length===0?1:matched.length*100+(matched.length===required.length?50:0);return{tool,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name)).map(x=>x.tool);}
export function toolsForTask(task,options={}){return selectTools(task?.requiredCapabilities??[],options).map(tool=>tool.name);}
function agentAllowed(tool,context){if(!tool.allowedAgents?.length)return true;return Boolean(context.agentId&&tool.allowedAgents.includes(context.agentId));}
function projectAllowed(tool,context){if(!tool.allowedProjects?.length)return true;return Boolean(context.projectId&&tool.allowedProjects.includes(context.projectId));}
export function authorizeTool(tool,context={}){const risk=normalizeRisk(tool.risk);if(!agentAllowed(tool,context))return{ok:false,reason:'agent_not_authorized'};if(!projectAllowed(tool,context))return{ok:false,reason:'project_not_authorized'};if(tool.scope==='external'&&!context.allowExternal)return{ok:false,reason:'external_scope_not_permitted'};if(risk!=='read'&&!context.approved)return{ok:false,reason:'approval_required'};if(risk==='destructive'&&!context.approvalId)return{ok:false,reason:'explicit_approval_id_required'};return{ok:true};}
export async function executeTool(name,input={},context={}){const tool=listTools().find(t=>t.name===name);if(!tool)throw new Error(`Tool not available: ${name}`);const authorization=authorizeTool(tool,context);if(!authorization.ok){const message={agent_not_authorized:'Agent is not authorized',project_not_authorized:'Project is not authorized',external_scope_not_permitted:'External scope is not permitted',approval_required:'Approval required',explicit_approval_id_required:'Explicit approval ID required'}[authorization.reason]??authorization.reason;throw new Error(`Tool authorization denied: ${message} (${authorization.reason})`);}const handler=runtimeHandlers.get(name);if(typeof handler!=='function')return{tool:name,status:'registered_no_runtime',input};const startedAt=now();try{const result=await handler(input,context);store.addEvent('tool.executed',{tool:name,agentId:context.agentId??null,projectId:context.projectId??null,startedAt,finishedAt:now(),status:'completed'});return result;}catch(error){store.addEvent('tool.failed',{tool:name,agentId:context.agentId??null,projectId:context.projectId??null,startedAt,finishedAt:now(),error:error.message});throw error;}}

function registerBuiltinTools(){
  // ═══ CORE TOOLS ═══
  registerTool({name:'health.check',description:'Returns runtime health',risk:'read',capabilities:['diagnostics'],handler:()=>({healthy:true,at:now()})});
  registerTool({name:'planning.execute',description:'Generates a controlled L1 execution plan for planning tasks',risk:'read',capabilities:['planning','product-planning'],handler:(input={})=>({healthy:true,type:'plan',taskId:input.taskId??null,summary:'Planning execution completed.',at:now()})});
  registerTool({name:'code.execute',description:'L1 code-generation runtime capability used by coding agents',risk:'read',capabilities:['coding','software-development','javascript'],handler:(input={})=>({tool:'code.execute',status:'available',taskId:input.taskId??null,summary:'Code generation runtime is available; generated files are returned as task artifacts.'})});
  registerTool({name:'test.run',description:'L1 test runtime capability used by engineering and QA agents',risk:'read',capabilities:['testing','verification'],handler:(input={})=>({tool:'test.run',status:'available',taskId:input.taskId??null,summary:'Test runtime is available for L1 verification.'})});

  // ═══ NEW: DATABASE TOOLS ═══
  registerTool({name:'database.query',description:'Execute SQL queries against D1 database',risk:'medium',capabilities:['database','schema','sql','data-analysis'],handler:(input={})=>({tool:'database.query',status:'available',taskId:input.taskId??null,summary:'Database query runtime available. Queries are executed against D1.',at:now()})});
  registerTool({name:'database.migrate',description:'Run database migrations and schema changes',risk:'write',capabilities:['database','schema','migration'],handler:(input={})=>({tool:'database.migrate',status:'available',taskId:input.taskId??null,summary:'Database migration runtime available for schema updates.',at:now()})});

  // ═══ NEW: FILE TOOLS ═══
  registerTool({name:'file.read',description:'Read files from the project workspace',risk:'read',capabilities:['file-operations','read-file'],handler:(input={})=>({tool:'file.read',status:'available',path:input.path??null,taskId:input.taskId??null,summary:'File read capability available.',at:now()})});
  registerTool({name:'file.write',description:'Write and create files in the project workspace',risk:'write',capabilities:['file-operations','write-file','create-file'],handler:(input={})=>({tool:'file.write',status:'available',path:input.path??null,taskId:input.taskId??null,summary:'File write capability available.',at:now()})});
  registerTool({name:'file.edit',description:'Edit existing files with precise string replacements',risk:'write',capabilities:['file-operations','edit-file','refactor'],handler:(input={})=>({tool:'file.edit',status:'available',path:input.path??null,taskId:input.taskId??null,summary:'File edit capability available.',at:now()})});

  // ═══ NEW: WEB TOOLS ═══
  registerTool({name:'web.search',description:'Search the web for information and documentation',risk:'external',capabilities:['research','analysis','web-search','search'],scope:'external',handler:(input={})=>({tool:'web.search',status:'available',query:input.query??null,taskId:input.taskId??null,summary:'Web search capability available for research tasks.',at:now()})});
  registerTool({name:'web.fetch',description:'Fetch and extract content from URLs',risk:'external',capabilities:['research','analysis','web-fetch','fetch-data'],scope:'external',handler:(input={})=>({tool:'web.fetch',status:'available',url:input.url??null,taskId:input.taskId??null,summary:'Web fetch capability available for data extraction.',at:now()})});

  // ═══ NEW: SECURITY TOOLS ═══
  registerTool({name:'security.scan',description:'Scan code for security vulnerabilities',risk:'read',capabilities:['security','audit','vulnerability-scan'],handler:(input={})=>({tool:'security.scan',status:'available',taskId:input.taskId??null,summary:'Security scanning capability available for vulnerability detection.',at:now()})});
  registerTool({name:'security.audit',description:'Perform comprehensive security audit',risk:'read',capabilities:['security','audit','compliance'],handler:(input={})=>({tool:'security.audit',status:'available',taskId:input.taskId??null,summary:'Security audit capability available for compliance checks.',at:now()})});

  // ═══ NEW: DESIGN TOOLS ═══
  registerTool({name:'ui.design',description:'Generate UI designs and component specifications',risk:'read',capabilities:['design','ui-ux','graphics','creative','frontend'],handler:(input={})=>({tool:'ui.design',status:'available',taskId:input.taskId??null,summary:'UI design capability available for generating component specs.',at:now()})});
  registerTool({name:'ui.prototype',description:'Create interactive UI prototypes and wireframes',risk:'read',capabilities:['design','ui-ux','prototype','wireframe'],handler:(input={})=>({tool:'ui.prototype',status:'available',taskId:input.taskId??null,summary:'UI prototype capability available for interactive mockups.',at:now()})});

  // ═══ NEW: DEPLOYMENT TOOLS ═══
  registerTool({name:'deploy.execute',description:'Deploy applications to cloud platforms',risk:'destructive',capabilities:['deployment','ci-cd','infrastructure','devops','cloud'],handler:(input={})=>({tool:'deploy.execute',status:'available',target:input.target??null,taskId:input.taskId??null,summary:'Deployment capability available for cloud platforms.',at:now()})});
  registerTool({name:'deploy.preview',description:'Create deployment previews and staging environments',risk:'read',capabilities:['deployment','preview','staging'],handler:(input={})=>({tool:'deploy.preview',status:'available',taskId:input.taskId??null,summary:'Deployment preview capability available for staging.',at:now()})});

  // ═══ NEW: DATA TOOLS ═══
  registerTool({name:'data.analyze',description:'Analyze data and generate insights',risk:'read',capabilities:['data-analysis','visualization','charts','analytics'],handler:(input={})=>({tool:'data.analyze',status:'available',taskId:input.taskId??null,summary:'Data analysis capability available for generating insights.',at:now()})});
  registerTool({name:'data.transform',description:'Transform and process data between formats',risk:'read',capabilities:['data-analysis','etl','transform','data-processing'],handler:(input={})=>({tool:'data.transform',status:'available',taskId:input.taskId??null,summary:'Data transformation capability available for format conversion.',at:now()})});

  // ═══ NEW: DOCUMENTATION TOOLS ═══
  registerTool({name:'documentation.generate',description:'Generate documentation for code and APIs',risk:'read',capabilities:['documentation','docs','api-docs'],handler:(input={})=>({tool:'documentation.generate',status:'available',taskId:input.taskId??null,summary:'Documentation generation capability available.',at:now()})});
  registerTool({name:'documentation.review',description:'Review and improve existing documentation',risk:'read',capabilities:['documentation','docs','review'],handler:(input={})=>({tool:'documentation.review',status:'available',taskId:input.taskId??null,summary:'Documentation review capability available.',at:now()})});

  // ═══ NEW: API TOOLS ═══
  registerTool({name:'api.test',description:'Test API endpoints and validate responses',risk:'read',capabilities:['api','testing','rest','graphql'],handler:(input={})=>({tool:'api.test',status:'available',endpoint:input.endpoint??null,taskId:input.taskId??null,summary:'API testing capability available for endpoint validation.',at:now()})});
  registerTool({name:'api.document',description:'Generate OpenAPI/Swagger documentation',risk:'read',capabilities:['api','documentation','openapi','swagger'],handler:(input={})=>({tool:'api.document',status:'available',taskId:input.taskId??null,summary:'API documentation capability available for OpenAPI specs.',at:now()})});

  // ═══ NEW: MOBILE TOOLS ═══
  registerTool({name:'mobile.build',description:'Build mobile applications for Android/iOS',risk:'write',capabilities:['mobile','android','ios','flutter','react-native'],handler:(input={})=>({tool:'mobile.build',status:'available',platform:input.platform??null,taskId:input.taskId??null,summary:'Mobile build capability available for app compilation.',at:now()})});
  registerTool({name:'mobile.preview',description:'Preview mobile app builds',risk:'read',capabilities:['mobile','preview','emulator'],handler:(input={})=>({tool:'mobile.preview',status:'available',taskId:input.taskId??null,summary:'Mobile preview capability available for build previews.',at:now()})});

  // ═══ NEW: AI/ML TOOLS ═══
  registerTool({name:'ai.train',description:'Train and fine-tune machine learning models',risk:'write',capabilities:['machine-learning','neural-networks','ai','data-science'],handler:(input={})=>({tool:'ai.train',status:'available',model:input.model??null,taskId:input.taskId??null,summary:'AI training capability available for model fine-tuning.',at:now()})});
  registerTool({name:'ai.infer',description:'Run inference on trained models',risk:'read',capabilities:['machine-learning','ai','inference','prediction'],handler:(input={})=>({tool:'ai.infer',status:'available',model:input.model??null,taskId:input.taskId??null,summary:'AI inference capability available for predictions.',at:now()})});

  // ═══ NEW: MEDIA TOOLS ═══
  registerTool({name:'media.generate',description:'Generate images, audio, and video content',risk:'write',capabilities:['media','creative','graphics','design'],handler:(input={})=>({tool:'media.generate',status:'available',type:input.type??null,taskId:input.taskId??null,summary:'Media generation capability available for creative content.',at:now()})});
  registerTool({name:'media.process',description:'Process and transform media files',risk:'read',capabilities:['media','processing','conversion'],handler:(input={})=>({tool:'media.process',status:'available',taskId:input.taskId??null,summary:'Media processing capability available for file transformation.',at:now()})});

  // ═══ NEW: MONITORING TOOLS ═══
  registerTool({name:'monitor.metrics',description:'Collect and analyze system metrics',risk:'read',capabilities:['monitoring','metrics','analytics'],handler:(input={})=>({tool:'monitor.metrics',status:'available',taskId:input.taskId??null,summary:'Monitoring capability available for metrics collection.',at:now()})});
  registerTool({name:'monitor.alerts',description:'Set up and manage alerting rules',risk:'medium',capabilities:['monitoring','alerts','notification'],handler:(input={})=>({tool:'monitor.alerts',status:'available',taskId:input.taskId??null,summary:'Alerting capability available for notification rules.',at:now()})});
}

// D1 hydration can contain stale copies of built-in tools. Re-registering the
// canonical definitions after hydration restores their capabilities, enabled
// state, and runtime handlers before L1 task planning begins.
export function ensureBuiltinTools(){registerBuiltinTools();return listTools();}

registerBuiltinTools();

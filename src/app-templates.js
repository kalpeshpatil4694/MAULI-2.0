// MAULI 2.0 — App Template Engine
// Generates complete working apps from project descriptions

function slug(name) {
  return String(name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function detectProjectType(objective, capabilities) {
  const text = (objective || '').toLowerCase();
  const caps = new Set((capabilities || []).map(String));
  if (/video call|video chat|screen record|webcam|recording/.test(text)) return 'video-recorder';
  if (/weather|forecast|temperature/.test(text)) return 'weather-app';
  if (/todo|task list|checklist|to-do/.test(text)) return 'todo-app';
  if (/chat|message|conversation|chatbot/.test(text)) return 'chat-app';
  if (/calculator|math|compute/.test(text)) return 'calculator';
  if (/portfolio|resume|personal|landing page|website/.test(text)) return 'portfolio';
  if (/e-commerce|shop|store|cart|product/.test(text)) return 'ecommerce';
  if (/dashboard|admin|analytics|monitor/.test(text)) return 'dashboard-app';
  if (/game|play|puzzle/.test(text)) return 'game-app';
  if (/note|journal|diary|notepad/.test(text)) return 'notes-app';
  if (caps.has('frontend') || caps.has('ui')) return 'web-app';
  return 'web-app';
}

function h(title, body, css, js) {
  var s = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
  s += '<title>' + title + '</title>';
  s += '<style>*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#0a0e1a;--card:#111827;--accent:#00d4ff;--accent2:#7c3aed;--green:#10b981;--red:#ef4444;--yellow:#f59e0b;--text:#e2e8f0;--text-muted:#94a3b8;--border:#1e293b}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}' + css + '</style>';
  s += '</head><body>' + body + '<script>' + js + '<\/script></body></html>';
  return s;
}

var VCSS = '*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#0a0e1a;--card:#111827;--accent:#00d4ff;--accent2:#7c3aed;--green:#10b981;--red:#ef4444;--yellow:#f59e0b;--text:#e2e8f0;--text-muted:#94a3b8;--border:#1e293b}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}';

function videoRecorderFiles() {
  var body = '<div class="app"><header class="hd"><h1>Video Call Recorder</h1><p>Record screen, webcam and audio</p></header>';
  body += '<div class="grid"><div class="pv"><video id="preview" autoplay muted playsinline></video>';
  body += '<div class="ov" id="ov"><span class="pulse"></span><span>Click Start to begin</span></div></div>';
  body += '<div class="ctrl"><label>Source</label><select id="src" class="sel"><option value="screen">Screen</option><option value="webcam">Webcam</option><option value="both">Both</option></select>';
  body += '<label>Audio</label><select id="aud" class="sel"><option value="system">System</option><option value="mic">Microphone</option><option value="both">Both</option></select>';
  body += '<div class="btns"><button id="startBtn" class="btn btn-go" onclick="startRec()">Start Recording</button>';
  body += '<button id="pauseBtn" class="btn btn-pa" onclick="pauseRec()" disabled>Pause</button>';
  body += '<button id="stopBtn" class="btn btn-st" onclick="stopRec()" disabled>Stop</button></div>';
  body += '<div class="timer" id="timer">00:00:00</div><div class="st" id="st">Ready</div></div></div>';
  body += '<div class="gal"><h2>Recordings</h2><div id="gallery" class="gallery"></div></div></div>';

  var css = '.app{max-width:1100px;margin:0 auto;padding:20px}.hd{text-align:center;padding:20px 0}.hd h1{font-size:28px;color:var(--accent)}.hd p{color:var(--text-muted)}.grid{display:grid;grid-template-columns:1fr 280px;gap:16px;margin:16px 0}.pv{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:16/9}.pv video{width:100%;height:100%;object-fit:contain}.ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--text-muted)}.ov.hid{display:none}.pulse{width:10px;height:10px;border-radius:50%;background:var(--red);animation:pulse 1.5s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.ctrl{background:var(--card);border-radius:12px;padding:16px;border:1px solid var(--border)}.ctrl label{display:block;font-size:11px;color:var(--text-muted);margin:10px 0 4px;text-transform:uppercase}.sel{width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)}.btns{display:flex;gap:6px;margin:12px 0}.btn{flex:1;padding:10px;border:none;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer}.btn-go{background:var(--green);color:#fff}.btn-pa{background:var(--yellow);color:#000}.btn-st{background:var(--red);color:#fff}.btn:disabled{opacity:.4;cursor:not-allowed}.timer{text-align:center;font-size:28px;font-family:monospace;color:var(--accent);padding:8px 0}.st{text-align:center;font-size:11px;color:var(--text-muted)}.gal{margin-top:24px}.gal h2{font-size:18px;margin-bottom:12px}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.gi{background:var(--card);border-radius:10px;overflow:hidden;border:1px solid var(--border)}.gi video{width:100%;aspect-ratio:16/9}.gi-i{padding:10px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted)}';
  var js = 'var mr,ch=[],recs=[],ti,sec=0;function startRec(){var src=document.getElementById("src").value;var opts={video:{width:1280,height:720,frameRate:30}};if(src==="screen"){navigator.mediaDevices.getDisplayMedia(opts).then(function(s){go(s)}).catch(function(e){document.getElementById("st").textContent="Error: "+e})}else if(src==="webcam"){navigator.mediaDevices.getUserMedia(opts).then(function(s){go(s)}).catch(function(e){document.getElementById("st").textContent="Error: "+e})}else{navigator.mediaDevices.getDisplayMedia(opts).then(function(s){go(s)}).catch(function(e){document.getElementById("st").textContent="Error: "+e})}}';
  js += 'function go(s){document.getElementById("preview").srcObject=s;document.getElementById("ov").classList.add("hid");var mt=MediaRecorder.isTypeSupported("video/webm;codecs=vp9")?"video/webm;codecs=vp9":"video/webm";mr=new MediaRecorder(s,{mimeType:mt});ch=[];mr.ondataavailable=function(e){if(e.data.size>0)ch.push(e.data)};mr.onstop=function(){saveRec()};mr.start(1000);s.getVideoTracks()[0].onended=function(){stopRec()};ui(true);startTimer();document.getElementById("st").textContent="Recording..."}';
  js += 'function pauseRec(){if(mr&&mr.state==="recording"){mr.pause();document.getElementById("st").textContent="Paused"}else if(mr&&mr.state==="paused"){mr.resume();document.getElementById("st").textContent="Recording..."}}';
  js += 'function stopRec(){if(mr&&mr.state!=="inactive"){mr.stop()}var p=document.getElementById("preview");if(p.srcObject){p.srcObject.getTracks().forEach(function(t){t.stop()});p.srcObject=null}document.getElementById("ov").classList.remove("hid");ui(false);stopTimer();document.getElementById("st").textContent="Stopped"}';
  js += 'function saveRec(){var b=new Blob(ch,{type:"video/webm"});var u=URL.createObjectURL(b);recs.push({url:u,name:"Recording "+recs.length,size:(b.size/1024/1024).toFixed(2)+" MB",time:new Date().toLocaleString()});renderGal()}';
  js += 'function renderGal(){var g=document.getElementById("gallery");if(recs.length===0){g.innerHTML="<div style=text-align:center;padding:40px;color:var(--text-muted)>No recordings yet</div>";return}g.innerHTML=recs.map(function(r,i){return "<div class=gi><video src="+r.url+" controls></video><div class=gi-i><span>"+r.name+" | "+r.size+"</span><button class=btn btn-go style=padding:4px 8px;font-size:11px onclick=dlRec("+i+")>Download</button></div></div>"}).join("")}';
  js += 'function dlRec(i){var a=document.createElement("a");a.href=recs[i].url;a.download="recording_"+i+".webm";a.click()}';
  js += 'function ui(r){document.getElementById("startBtn").disabled=r;document.getElementById("pauseBtn").disabled=!r;document.getElementById("stopBtn").disabled=!r}';
  js += 'function startTimer(){sec=0;ti=setInterval(function(){sec++;var h=String(Math.floor(sec/3600)).padStart(2,"0");var m=String(Math.floor((sec%3600)/60)).padStart(2,"0");var s=String(sec%60).padStart(2,"0");document.getElementById("timer").textContent=h+":"+m+":"+s},1000)}';
  js += 'function stopTimer(){clearInterval(ti);document.getElementById("timer").textContent="00:00:00";sec=0}';
  return [{ path: 'www/index.html', content: h('Video Call Recorder', body, css, js) }];
}

function weatherFiles() {
  var body = '<div class="app"><header class="hd"><h1>Weather App</h1></header>';
  body += '<div class="sb"><input id="ci" class="inp" placeholder="Search city..." onkeydown="if(event.key===\'Enter\')sw()">';
  body += '<button class="btn" onclick="sw()">Search</button><button class="btn bo" onclick="geo()">My Location</button></div>';
  body += '<div id="cur" class="cur"><div style="padding:20px;color:var(--text-muted)">Loading...</div></div>';
  body += '<div id="fc" class="fc"></div></div>';
  var css = '.app{max-width:700px;margin:0 auto;padding:20px}.hd{text-align:center;padding:16px 0}.hd h1{font-size:26px;color:var(--accent)}.sb{display:flex;gap:8px;margin:16px 0}.inp{flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px}.btn{padding:10px 16px;border:none;border-radius:8px;background:var(--accent);color:#000;font-weight:600;cursor:pointer;font-size:13px}.bo{background:transparent;border:1px solid var(--border);color:var(--text)}.cur{background:var(--card);border-radius:12px;padding:24px;text-align:center;border:1px solid var(--border);margin:16px 0}.tmp{font-size:56px;font-weight:700}.dt{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}.di{padding:10px;background:var(--bg);border-radius:8px;text-align:center}.di small{font-size:10px;color:var(--text-muted);display:block}.di span{font-size:16px;font-weight:600}.fc{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:16px}.fd{background:var(--card);border-radius:10px;padding:12px;text-align:center;border:1px solid var(--border)}.fd .d{font-size:11px;color:var(--text-muted)}.fd .ic{font-size:28px;margin:6px 0}.fd .tr{font-size:12px}';
  var js = 'function sw(){var c=document.getElementById("ci").value.trim();if(!c)return;dw(c)}';
  js += 'function geo(){navigator.geolocation.getCurrentPosition(function(p){dw(null,p.coords.latitude,p.coords.longitude)},function(){alert("Location denied")})}';
  js += 'async function dw(city,lat,lon){document.getElementById("cur").innerHTML="<div style=padding:20px;color:var(--text-muted)>Loading...</div>";try{var q=city||"";var url="https://wttr.in/"+encodeURIComponent(q)+"?format=j1";var r=await fetch(url);var d=await r.json();var c=d.current_condition[0]||{};var ic={"113":"\\u2600","116":"\\u26C5","119":"\\u2601","176":"\\uD83C\\uDF26","200":"\\u26C8","263":"\\uD83C\\uDF26","296":"\\uD83C\\uDF27","299":"\\uD83C\\uDF27","302":"\\uD83C\\uDF27","305":"\\uD83C\\uDF27","308":"\\uD83C\\uDF27","311":"\\uD83C\\uDF27","314":"\\uD83C\\uDF27","317":"\\u2744","320":"\\u2744","323":"\\u2744","326":"\\u2744","329":"\\u2744","332":"\\u2744","335":"\\u2744","338":"\\u2744","350":"\\uD83C\\uDF27","353":"\\uD83C\\uDF26","356":"\\uD83C\\uDF27","359":"\\uD83C\\uDF27","386":"\\u26C8","389":"\\u26C8","392":"\\u26C8","395":"\\u2744"};var icon=ic[c.weatherCode]||"\\uD83C\\uDF24";document.getElementById("cur").innerHTML="<div class=tmp>"+c.temp_C+"\\u00B0C</div><div style=font-size:18px>"+icon+" "+(c.weatherDesc[0]||{}).value+"</div><div style=color:var(--text-muted);margin-top:6px>"+(city||"Your Location")+"</div><div class=dt><div class=di><small>Feels Like</small><span>"+c.FeelsLikeC+"\\u00B0</span></div><div class=di><small>Humidity</small><span>"+c.humidity+"%</span></div><div class=di><small>Wind</small><span>"+c.windspeedKmph+" km/h</span></div><div class=di><small>UV</small><span>"+c.uvIndex+"</span></div><div class=di><small>Visibility</small><span>"+c.visibility+" km</span></div><div class=di><small>Pressure</small><span>"+c.pressure+"</span></div></div>";var days=d.weather||[];document.getElementById("fc").innerHTML=days.map(function(dy){var nm=new Date(dy.date).toLocaleDateString("en",{weekday:"short"});return "<div class=fd><div class=d>"+nm+"</div><div class=ic>"+icon+"</div><div class=tr>"+dy.mintempC+"\\u00B0 / "+dy.maxtempC+"\\u00B0</div></div>"}).join("")}catch(e){document.getElementById("cur").innerHTML="<div style=padding:20px;color:var(--red)>Error: "+e.message+"</div>"}}';
  js += 'sw()';
  return [{ path: 'www/index.html', content: h('Weather App', body, css, js) }];
}

function todoFiles() {
  var body = '<div class="app"><header class="hd"><h1>Task Manager</h1></header>';
  body += '<div class="ir"><input id="ti" class="inp" placeholder="Add a task..." onkeydown="if(event.key===\'Enter\')add()">';
  body += '<select id="pr" class="sel"><option value="low">Low</option><option value="med" selected>Medium</option><option value="high">High</option></select>';
  body += '<button class="btn" onclick="add()">Add</button></div>';
  body += '<div class="fl"><button class="fi active" onclick="flt(\'all\',this)">All</button><button class="fi" onclick="flt(\'active\',this)">Active</button><button class="fi" onclick="flt(\'done\',this)">Done</button></div>';
  body += '<div id="tl" class="tl"></div><div id="st" class="st"></div></div>';
  var css = '.app{max-width:600px;margin:0 auto;padding:20px}.hd{text-align:center;padding:16px 0}.hd h1{font-size:26px;color:var(--accent)}.ir{display:flex;gap:8px;margin:16px 0}.inp{flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px}.sel{padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)}.btn{padding:10px 16px;border:none;border-radius:8px;background:var(--accent);color:#000;font-weight:600;cursor:pointer}.fl{display:flex;gap:6px;margin:12px 0}.fi{padding:6px 14px;border:1px solid var(--border);border-radius:16px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:12px}.fi.active{background:var(--accent);color:#000;border-color:var(--accent)}.tl{display:flex;flex-direction:column;gap:6px}.ti{display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border-radius:8px;border:1px solid var(--border)}.ti.done{opacity:.5}.tc{width:20px;height:20px;border-radius:5px;border:2px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tc.ck{background:var(--green);border-color:var(--green)}.tt{flex:1;font-size:13px}.tt.done{text-decoration:line-through;color:var(--text-muted)}.tp{font-size:9px;padding:2px 6px;border-radius:8px;font-weight:600;text-transform:uppercase}.tp.high{background:rgba(239,68,68,.2);color:var(--red)}.tp.med{background:rgba(245,158,11,.2);color:var(--yellow)}.tp.low{background:rgba(16,185,129,.2);color:var(--green)}.td{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px}.st{text-align:center;padding:12px;color:var(--text-muted);font-size:12px}';
  var js = 'var tasks=JSON.parse(localStorage.getItem("mt")||"[]"),fl="all";';
  js += 'function sv(){localStorage.setItem("mt",JSON.stringify(tasks))}';
  js += 'function add(){var v=document.getElementById("ti").value.trim();if(!v)return;tasks.unshift({id:Date.now(),text:v,done:false,pri:document.getElementById("pr").value});sv();rr();document.getElementById("ti").value=""}';
  js += 'function tg(id){var t=tasks.find(function(t){return t.id===id});if(t){t.done=!t.done;sv();rr()}}';
  js += 'function dl(id){tasks=tasks.filter(function(t){return t.id!==id});sv();rr()}';
  js += 'function flt(f,el){fl=f;document.querySelectorAll(".fi").forEach(function(b){b.classList.remove("active")});el.classList.add("active");rr()}';
  js += 'function rr(){var list=tasks;if(fl==="active")list=tasks.filter(function(t){return!t.done});if(fl==="done")list=tasks.filter(function(t){return t.done});document.getElementById("tl").innerHTML=list.map(function(t){return "<div class=ti"+(t.done?" done":"")+"><div class=tc"+(t.done?" ck":"")+" onclick=tg("+t.id+")>"+(t.done?"&#10003;":"")+"</div><div class=tt"+(t.done?" done":"")+">"+t.text+"</div><span class=tp "+t.pri+">"+t.pri+"</span><button class=td onclick=dl("+t.id+")>x</button></div>"}).join("")||"<div style=text-align:center;padding:30px;color:var(--text-muted)>No tasks!</div>";var d=tasks.filter(function(t){return t.done}).length;document.getElementById("st").innerHTML=d+"/"+tasks.length+" completed"}';
  js += 'rr()';
  return [{ path: 'www/index.html', content: h('Task Manager', body, css, js) }];
}

function calculatorFiles() {
  var body = '<div class="ca"><div class="cc"><div class="cd"><div id="ex" class="ex"></div><div id="re" class="re">0</div></div>';
  body += '<div class="cb">';
  body += '<button class="bf" onclick="clr()">AC</button><button class="bf" onclick="bk()">BS</button><button class="bf" onclick="ins(\'%\')">%</button><button class="bo" onclick="ins(\'/\')">&#247;</button>';
  body += '<button class="bn" onclick="ins(\'7\')">7</button><button class="bn" onclick="ins(\'8\')">8</button><button class="bn" onclick="ins(\'9\')">9</button><button class="bo" onclick="ins(\'*\')">&#215;</button>';
  body += '<button class="bn" onclick="ins(\'4\')">4</button><button class="bn" onclick="ins(\'5\')">5</button><button class="bn" onclick="ins(\'6\')">6</button><button class="bo" onclick="ins(\'-\')">&#8722;</button>';
  body += '<button class="bn" onclick="ins(\'1\')">1</button><button class="bn" onclick="ins(\'2\')">2</button><button class="bn" onclick="ins(\'3\')">3</button><button class="bo" onclick="ins(\'+\')">+</button>';
  body += '<button class="bn bz" onclick="ins(\'0\')">0</button><button class="bn" onclick="ins(\'.\')">.</button><button class="be" onclick="eq()">=</button></div></div></div>';
  var css = '.ca{display:flex;justify-content:center;align-items:center;min-height:100vh}.cc{background:var(--card);border-radius:16px;padding:16px;border:1px solid var(--border);width:300px}.cd{background:var(--bg);border-radius:10px;padding:16px;margin-bottom:12px;text-align:right;min-height:80px}.ex{font-size:13px;color:var(--text-muted);word-break:break-all}.re{font-size:32px;font-weight:700;color:var(--accent)}.cb{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.cb button{padding:14px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}.bn{background:var(--bg);color:var(--text)}.bo{background:var(--accent);color:#000}.bf{background:var(--border);color:var(--text-muted)}.be{background:var(--green);color:#fff}.bz{grid-column:span 2}';
  var js = 'var e="",hr=0;';
  js += 'function ins(v){if(hr){e="";hr=0}e+=v;document.getElementById("ex").textContent=e}';
  js += 'function clr(){e="";hr=0;document.getElementById("ex").textContent="";document.getElementById("re").textContent="0"}';
  js += 'function bk(){e=e.slice(0,-1);document.getElementById("ex").textContent=e}';
  js += 'function eq(){try{var r=eval(e);document.getElementById("re").textContent=Number.isFinite(r)?parseFloat(r.toFixed(10)):"Error";document.getElementById("ex").textContent=e+"=";e=String(r);hr=1}catch(er){document.getElementById("re").textContent="Error"}}';
  js += 'document.addEventListener("keydown",function(ev){if(ev.key>="0"&&ev.key<="9")ins(ev.key);else if("+-*/".indexOf(ev.key)>=0)ins(ev.key);else if(ev.key===".")ins(".");else if(ev.key==="Enter"||ev.key==="=")eq();else if(ev.key==="Escape")clr();else if(ev.key==="Backspace")bk()})';
  return [{ path: 'www/index.html', content: h('Calculator', body, css, js) }];
}

function chatFiles() {
  var body = '<div class="ca2"><div class="sb2"><div class="sh">Rooms</div><div id="rl" class="rl"></div></div>';
  body += '<div class="cm"><div class="ch2"><span id="rn">General</span></div>';
  body += '<div id="mg" class="mg"></div>';
  body += '<div class="ci2"><input id="mi" class="inp" placeholder="Type a message..." onkeydown="if(event.key===\'Enter\')sm()"><button class="btn" onclick="sm()">Send</button></div></div></div>';
  var css = '.ca2{display:flex;height:100vh}.sb2{width:200px;background:var(--card);border-right:1px solid var(--border)}.sh{padding:16px;border-bottom:1px solid var(--border);font-weight:600;font-size:15px}.rl{padding:8px}.ri{padding:10px;border-radius:6px;cursor:pointer;margin:2px 0;font-size:13px}.ri:hover{background:var(--bg)}.ri.ac{background:var(--accent);color:#000}.cm{flex:1;display:flex;flex-direction:column}.ch2{padding:12px 16px;border-bottom:1px solid var(--border);font-weight:600}.mg{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}.ms{max-width:65%}.ms.usr{align-self:flex-end}.ms.bot{align-self:flex-start}.mb{padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.4}.ms.usr .mb{background:var(--accent);color:#000;border-bottom-right-radius:4px}.ms.bot .mb{background:var(--card);border:1px solid var(--border);border-bottom-left-radius:4px}.mt{font-size:9px;color:var(--text-muted);margin-top:2px;padding:0 4px}.ci2{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:6px}.inp{flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px}.btn{padding:8px 14px;border:none;border-radius:6px;background:var(--accent);color:#000;font-weight:600;cursor:pointer}';
  var js = 'var rooms=["General","Random","Tech","Ideas"],cr="General",ms={};';
  js += 'rooms.forEach(function(r){ms[r]=[{r:"bot",text:"Welcome to "+r+"!",t:new Date().toLocaleTimeString()}]});';
  js += 'function rr(){document.getElementById("rl").innerHTML=rooms.map(function(r){return "<div class=ri"+(r===cr?" ac":"")+" onclick=sw2(\\\""+r+"\\\")>"+r+"</div>"}).join("")}';
  js += 'function sw2(r){cr=r;document.getElementById("rn").textContent=r;rr();rm()}';
  js += 'function rm(){var m=ms[cr];document.getElementById("mg").innerHTML=m.map(function(msg){return "<div class=ms "+msg.r+"><div class=mb>"+msg.text+"</div><div class=mt>"+msg.t+"</div></div>"}).join("");document.getElementById("mg").scrollTop=99999}';
  js += 'function sm(){var v=document.getElementById("mi").value.trim();if(!v)return;ms[cr].push({r:"usr",text:v,t:new Date().toLocaleTimeString()});document.getElementById("mi").value="";rm();setTimeout(function(){var rp=["Got it!","Interesting!","Tell me more!","Great idea!","Sure thing!","Cool!","Nice!"];ms[cr].push({r:"bot",text:rp[Math.floor(Math.random()*rp.length)],t:new Date().toLocaleTimeString()});rm()},500+Math.random()*1000)}';
  js += 'rr();rm()';
  return [{ path: 'www/index.html', content: h('Chat App', body, css, js) }];
}

function webAppFiles(objective) {
  var name = (objective || 'Web Application').slice(0, 40);
  var body = '<nav class="nv"><div class="nb">My App</div><div class="nl"><a href="#" class="ac">Home</a><a href="#">Features</a><a href="#">About</a><a href="#">Contact</a></div></nav>';
  body += '<section class="hr"><h1>' + name + '</h1><p>A modern web application built with MAULI 2.0</p>';
  body += '<button class="btn lg" onclick="alert(\'Hello from MAULI!\')">Get Started</button></section>';
  body += '<section class="ft"><div class="fc2"><div class="fi2">Fast</div><p>Lightning performance</p></div>';
  body += '<div class="fc2"><div class="fi2">Secure</div><p>Enterprise security</p></div>';
  body += '<div class="fc2"><div class="fi2">Responsive</div><p>Works everywhere</p></div></section>';
  body += '<footer class="ftr"><p>Built with MAULI 2.0</p></footer>';
  var css = '.nv{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}.nb{font-size:16px;font-weight:700}.nl a{color:var(--text-muted);text-decoration:none;margin-left:16px;font-size:13px}.nl a.ac,.nl a:hover{color:var(--accent)}.hr{text-align:center;padding:60px 16px}.hr h1{font-size:40px;margin-bottom:12px;color:var(--accent)}.hr p{font-size:16px;color:var(--text-muted);margin-bottom:20px}.btn{padding:10px 20px;border:none;border-radius:8px;background:var(--accent);color:#000;font-weight:600;cursor:pointer}.lg{padding:14px 28px;font-size:16px}.ft{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:40px;max-width:800px;margin:0 auto}.fc2{text-align:center;padding:24px;background:var(--card);border-radius:12px;border:1px solid var(--border)}.fi2{font-size:28px;margin-bottom:8px}.fc2 p{color:var(--text-muted);font-size:13px}.ftr{text-align:center;padding:24px;color:var(--text-muted);font-size:12px;border-top:1px solid var(--border);margin-top:32px}';
  var js = 'document.querySelectorAll(".nl a").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();document.querySelectorAll(".nl a").forEach(function(l){l.classList.remove("ac")});a.classList.add("ac")})})';
  return [{ path: 'www/index.html', content: h(name, body, css, js) }];
}

function detectProjectType2(objective, capabilities) {
  var text = (objective || '').toLowerCase();
  var caps = new Set((capabilities || []).map(String));
  if (/video call|video chat|screen record|webcam|recording/.test(text)) return 'video-recorder';
  if (/weather|forecast|temperature/.test(text)) return 'weather-app';
  if (/todo|task list|checklist|to-do/.test(text)) return 'todo-app';
  if (/chat|message|conversation|chatbot/.test(text)) return 'chat-app';
  if (/calculator|math|compute/.test(text)) return 'calculator';
  if (/portfolio|resume|personal|landing page|website/.test(text)) return 'portfolio';
  if (/e-commerce|shop|store|cart|product/.test(text)) return 'ecommerce';
  if (/dashboard|admin|analytics|monitor/.test(text)) return 'dashboard-app';
  if (/game|play|puzzle/.test(text)) return 'game-app';
  if (/note|journal|diary|notepad/.test(text)) return 'notes-app';
  if (caps.has('frontend') || caps.has('ui')) return 'web-app';
  return 'web-app';
}

var GENERATORS = {
  'video-recorder': function() { return { summary: 'Video call recording app with screen/webcam recording, pause/resume, and download.', files: videoRecorderFiles(), tests: ['Recording starts/stops', 'Pause/resume works', 'Download saves file'], notes: ['Uses MediaRecorder API', 'No server required'] }; },
  'weather-app': function() { return { summary: 'Weather app with city search, geolocation, and 3-day forecast.', files: weatherFiles(), tests: ['City search works', 'Geolocation works', 'Forecast displays'], notes: ['Uses wttr.in free API', 'No API key needed'] }; },
  'todo-app': function() { return { summary: 'Task manager with priorities, filters, and localStorage persistence.', files: todoFiles(), tests: ['Add task works', 'Toggle complete', 'Filters work', 'LocalStorage saves'], notes: ['LocalStorage persistence', 'Priority levels'] }; },
  'calculator': function() { return { summary: 'Calculator with keyboard support and expression evaluation.', files: calculatorFiles(), tests: ['Basic operations', 'Keyboard input', 'Clear/backspace'], notes: ['Keyboard support', 'Error handling'] }; },
  'chat-app': function() { return { summary: 'Chat app with multiple rooms, message history, and auto-replies.', files: chatFiles(), tests: ['Send message', 'Switch rooms', 'Auto-reply'], notes: ['Multiple rooms', 'Message timestamps'] }; },
  'web-app': function(o) { return { summary: 'Responsive web application with modern UI.', files: webAppFiles(o), tests: ['Navigation works', 'Responsive layout'], notes: ['Modern design', 'Responsive'] }; }
};

export function generateFromTemplate(project) {
  var objective = project.objective || project.name || '';
  var capabilities = project.capabilities || project.requirements || [];
  var type = detectProjectType2(objective, capabilities);
  var gen = GENERATORS[type] || GENERATORS['web-app'];
  var result = gen(objective);
  return Object.assign({}, result, { type: type, projectType: type });
}

export function getAvailableTemplates() {
  return Object.keys(GENERATORS);
}

export { detectProjectType2 as detectProjectType };

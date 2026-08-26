const express=require('express'),http=require('http'),{Server}=require('socket.io'),{v4:uuid}=require('uuid'),multer=require('multer'),fs=require('fs');
const app=express(),srv=http.createServer(app),io=new Server(srv,{cors:{origin:'*'},maxHttpBufferSize:1e8});
app.use(express.json({limit:'50mb'}));
['uploads','data'].forEach(d=>{if(!fs.existsSync(d))fs.mkdirSync(d)});
app.use('/uploads',express.static('uploads'));
const up=multer({storage:multer.diskStorage({destination:'uploads/',filename:(r,f,cb)=>cb(null,Date.now()+'-'+f.originalname.replace(/[^a-z0-9.]/gi,'_'))})});
app.post('/upload',up.single('file'),(q,r)=>r.json({url:'/uploads/'+q.file.filename,name:q.file.originalname}));

let DB={users:{},posts:[],nextPost:1};
try{DB=JSON.parse(fs.readFileSync('data/db.json'))}catch(e){}
function save(){try{fs.writeFileSync('data/db.json',JSON.stringify(DB))}catch(e){}}

function getUser(id){return DB.users[id]||{id,name:'ناشناس',bio:'',followers:[],following:[]}}
function setUser(id,u){DB.users[id]=Object.assign(getUser(id),u);save()}

app.get('/api/me/:id',(q,r)=>r.json(getUser(q.params.id)));
app.post('/api/profile',(q,r)=>{setUser(q.body.id,{name:q.body.name,bio:q.body.bio||''});r.json(getUser(q.body.id))});
app.post('/api/follow',(q,r)=>{
  const a=getUser(q.body.from),b=getUser(q.body.to);
  if(!a.following.includes(q.body.to)){a.following.push(q.body.to);b.followers.push(q.body.from);setUser(q.body.from,a);setUser(q.body.to,b)}
  r.json({ok:1,f:b.followers.length})
});
app.post('/api/unfollow',(q,r)=>{
  const a=getUser(q.body.from),b=getUser(q.body.to);
  a.following=a.following.filter(x=>x!==q.body.to);b.followers=b.followers.filter(x=>x!==q.body.from);
  setUser(q.body.from,a);setUser(q.body.to,b);r.json({ok:1,f:b.followers.length})
});
app.get('/api/users',(q,r)=>r.json(Object.values(DB.users)));
app.get('/api/posts',(q,r)=>r.json(DB.posts.slice().reverse()));
app.post('/api/post',(q,r)=>{
  const p={id:DB.nextPost++,user:q.body.user,name:q.body.name,text:q.body.text||'',media:q.body.media||null,type:q.body.type||'text',likes:[],comments:[],ts:Date.now()};
  DB.posts.push(p);save();r.json(p)
});
app.post('/api/like',(q,r)=>{
  const p=DB.posts.find(x=>x.id==q.body.id);if(!p)return r.json({ok:0});
  const i=p.likes.indexOf(q.body.user);if(i>-1)p.likes.splice(i,1);else p.likes.push(q.body.user);
  save();r.json({ok:1,n:p.likes.length,liked:i===-1})
});
app.post('/api/comment',(q,r)=>{
  const p=DB.posts.find(x=>x.id==q.body.id);if(!p)return r.json({ok:0});
  p.comments.push({user:q.body.user,name:q.body.name,text:q.body.text,ts:Date.now()});save();r.json({ok:1,c:p.comments})
});

const lives=new Map(),online=new Map();
io.on('connection',s=>{
  s.on('reg',d=>{online.set(s.id,d.id);s.userId=d.id;s.userName=d.name;s.join('user_'+d.id)});
  s.on('start-live',({name})=>{const id=uuid().slice(0,8);lives.set(id,{id,host:s.id,name,viewers:0});s.join('live_'+id);s.emit('live-started',{id,name});io.emit('lives-updated',getLives())});
  s.on('end-live',id=>{const l=lives.get(id);if(l&&l.host===s.id){io.to('live_'+id).emit('live-ended');lives.delete(id);io.emit('lives-updated',getLives())}});
  s.on('join-live',id=>{const l=lives.get(id);if(!l)return s.emit('error-msg','میزبان آنلاین نیست');s.join('live_'+id);l.viewers++;io.to('live_'+id).emit('viewer-count',l.viewers);s.emit('joined',{id,name:l.name,host:l.host})});
  s.on('leave-live',id=>{s.leave('live_'+id);const l=lives.get(id);if(l){l.viewers=Math.max(0,l.viewers-1);io.to('live_'+id).emit('viewer-count',l.viewers)}});
  s.on('chat',d=>io.to('user_'+d.to).to('user_'+d.from).emit('chat',d));
  s.on('call',d=>io.to('user_'+d.to).emit('call',{...d,from:s.id,fromName:s.userName}));
  s.on('call-answer',d=>io.to('user_'+d.to).emit('call-answer',d));
  s.on('call-end',d=>io.to('user_'+d.to).emit('call-end',d));
  ['offer','answer','ice'].forEach(t=>s.on('rtc-'+t,d=>io.to('user_'+d.to).emit('rtc-'+t,{...d,from:s.id})));
  s.on('disconnect',()=>{online.delete(s.id);for(const[id,l]of lives)if(l.host===s.id){io.to('live_'+id).emit('live-ended');lives.delete(id)}io.emit('lives-updated',getLives())});
});
function getLives(){return Array.from(lives.values()).map(l=>({id:l.id,name:l.name,viewers:l.viewers}))}
app.get('/api/lives',(q,r)=>r.json(getLives()));
const PORT=process.env.PORT||3000;
srv.listen(PORT,()=>console.log('Rabbit Live on '+PORT));
app.get('/',(q,r)=>r.send(HTML));

const HTML=`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>🐰 Rabbit Live</title><script src="/socket.io/socket.io.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#0d0d1a;--purple:#7c3aed;--pink:#ec4899;--gold:#fbbf24;--glass:rgba(255,255,255,.08)}
body{font-family:-apple-system,Tahoma,sans-serif;background:var(--bg);color:#fff;min-height:100vh;padding-bottom:70px}
.wrap{max-width:600px;margin:0 auto;padding:12px}
.top{display:flex;justify-content:space-between;align-items:center;padding:10px 0 16px}
.logo{font-size:22px;font-weight:800;background:linear-gradient(135deg,var(--purple),var(--pink));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.nav{position:fixed;bottom:0;left:0;right:0;background:rgba(13,13,26,.95);backdrop-filter:blur(20px);display:flex;border-top:1px solid var(--glass);z-index:50}
.nav button{flex:1;padding:12px 0;background:none;border:none;color:rgba(255,255,255,.5);font-size:22px;cursor:pointer}
.nav button.on{color:var(--pink)}
.nav button small{display:block;font-size:9px;margin-top:2px}
.page{display:none}.page.on{display:block}
input,textarea,select{width:100%;padding:12px 16px;border-radius:12px;border:1px solid var(--glass);background:var(--glass);color:#fff;font-size:14px;outline:none;font-family:inherit;margin-bottom:10px}
input:focus,textarea:focus{border-color:var(--purple)}
.btn{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,var(--purple),var(--pink));color:#fff;font-size:15px;font-weight:700;cursor:pointer}
.btn.sm{width:auto;padding:8px 16px;font-size:13px;border-radius:20px}
.btn.red{background:linear-gradient(135deg,#ef4444,#b91c1c)}
.btn.ghost{background:var(--glass)}
.card{background:var(--glass);border:1px solid var(--glass);border-radius:16px;padding:14px;margin-bottom:12px}
.row{display:flex;align-items:center;gap:10px}
.av{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--pink));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.badge{background:linear-gradient(135deg,#ef4444,#dc2626);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;animation:bl 1.5s infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.6}}
.li{display:flex;align-items:center;gap:12px;padding:12px;background:var(--glass);border-radius:14px;margin-bottom:10px;cursor:pointer}
.li:active{transform:scale(.98)}
.modal{display:none;position:fixed;inset:0;z-index:200;background:#000;flex-direction:column}
.modal.on{display:flex;animation:su .3s}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
.mv{flex:1;position:relative;background:#000;display:flex;align-items:center;justify-content:center}
.mv video{width:100%;height:100%;object-fit:cover}
.ph{font-size:70px;opacity:.3;position:absolute}
.cx{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.5);border:none;color:#fff;font-size:18px;cursor:pointer;z-index:10}
.cp{height:180px;background:rgba(0,0,0,.8);display:flex;flex-direction:column;padding:10px}
.cms{flex:1;overflow-y:auto}
.cm{margin-bottom:5px;font-size:13px}.cm b{color:var(--gold);margin-left:4px}.cm.sys{color:rgba(255,255,255,.5);font-style:italic}
.cr{display:flex;gap:8px}
.cr input{flex:1;margin:0}
.sb{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--pink));border:none;color:#fff;font-size:16px;cursor:pointer}
.toast{position:fixed;top:70px;left:50%;transform:translateX(-50%) translateY(-20px);background:rgba(0,0,0,.9);padding:10px 18px;border-radius:10px;font-size:13px;z-index:500;opacity:0;transition:.3s;white-space:nowrap}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.msg{padding:8px 12px;border-radius:14px;margin-bottom:6px;max-width:75%;font-size:14px;word-wrap:break-word}
.msg.me{background:var(--purple);margin-right:auto}
.msg.them{background:var(--glass);margin-left:auto}
.msg audio,.msg img,.msg video{max-width:100%;border-radius:8px;margin-top:4px;display:block}
.msg a{color:var(--gold)}
.post-media{width:100%;border-radius:12px;margin:10px 0;max-height:400px;object-fit:cover}
.post-actions{display:flex;gap:18px;margin-top:10px;font-size:14px}
.post-actions span{cursor:pointer;display:flex;align-items:center;gap:5px}
.cmt{padding:8px 0;border-top:1px solid var(--glass);font-size:13px}
.cmt b{color:var(--gold);margin-left:5px}
.empty{text-align:center;padding:50px 20px;color:rgba(255,255,255,.3)}
.call-screen{position:fixed;inset:0;z-index:300;background:#000;display:none;flex-direction:column;align-items:center;justify-content:center}
.call-screen.on{display:flex}
.call-screen video{width:100%;height:60%;object-fit:cover;position:absolute;top:0}
.call-screen .local{position:absolute;bottom:100px;right:15px;width:100px;height:140px;border-radius:12px;object-fit:cover;border:2px solid #fff;z-index:2}
.call-info{position:absolute;top:40px;text-align:center;z-index:2}
.call-info h2{font-size:24px;margin-bottom:8px}
.call-btns{position:absolute;bottom:30px;display:flex;gap:20px;z-index:2}
.call-btns button{width:60px;height:60px;border-radius:50%;border:none;font-size:24px;cursor:pointer}
</style></head><body>
<div class="wrap">
<div class="top"><div class="logo">🐰 Rabbit Live</div><div id="meName" style="font-size:13px;color:#22c55e"></div></div>

<div id="pg-home" class="page on"><h3 style="margin-bottom:12px">🏠 فید</h3><div id="feed"></div></div>

<div id="pg-live" class="page"><button class="btn" id="glb" onclick="toggleLive()">🔴 شروع لایو</button><h3 style="margin:16px 0 12px">📺 لایوهای فعال</h3><div id="ll"></div></div>

<div id="pg-post" class="page"><h3 style="margin-bottom:12px">➕ پست جدید</h3>
<textarea id="ptxt" rows="3" placeholder="چی تو ذهنته؟"></textarea>
<input type="file" id="pfile" accept="image/*,video/*,audio/*" onchange="previewFile(this)">
<div id="pprev"></div>
<button class="btn" onclick="makePost()">انتشار پست 🚀</button></div>

<div id="pg-chat" class="page"><h3 style="margin-bottom:12px">💬 پیام‌ها</h3><div id="ulist"></div></div>

<div id="pg-me" class="page"><div class="card"><div class="row"><div class="av">🐰</div><div><div id="myName" style="font-weight:700"></div><div id="myBio" style="font-size:12px;color:rgba(255,255,255,.5)"></div></div></div>
<div style="display:flex;gap:20px;margin-top:14px"><div><b id="myPosts">0</b><br><small style="color:rgba(255,255,255,.5)">پست</small></div><div><b id="myFoll">0</b><br><small style="color:rgba(255,255,255,.5)">فالوور</small></div><div><b id="myFolg">0</b><br><small style="color:rgba(255,255,255,.5)">دنبال‌شده</small></div></div>
<button class="btn ghost" style="margin-top:14px" onclick="editProfile()">✏️ ویرایش پروفایل</button></div>
<h3 style="margin:16px 0 12px">پست‌های من</h3><div id="myposts"></div></div>
</div>

<div class="nav">
<button class="on" onclick="go('home',this)">🏠<small>خانه</small></button>
<button onclick="go('live',this)">📺<small>لایو</small></button>
<button onclick="go('post',this)">➕<small>پست</small></button>
<button onclick="go('chat',this)">💬<small>چت</small></button>
<button onclick="go('me',this)">👤<small>من</small></button>
</div>

<div id="liveModal" class="modal"><div class="mv"><video id="vid" autoplay playsinline></video><div class="ph" id="ph">🐰</div><button class="cx" onclick="closeLive()">✕</button><div style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.4);padding:6px 12px;border-radius:20px;font-size:13px" id="mhost"></div></div><div class="cp"><div id="lcms" class="cms"></div><div class="cr"><input id="lcin" placeholder="بنویسید..." onkeydown="if(event.key==='Enter')sendLC()"><button class="sb" onclick="sendLC()">➤</button></div></div></div>

<div id="chatModal" class="modal"><div style="padding:12px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.5)"><button class="cx" style="position:static" onclick="closeChat()">←</button><div class="av" style="width:36px;height:36px;font-size:15px">🐰</div><div style="flex:1"><div id="chatName" style="font-weight:700"></div><div style="font-size:11px;color:rgba(255,255,255,.5)">آنلاین</div></div><button class="btn sm" onclick="startCall('audio')">📞</button><button class="btn sm" onclick="startCall('video')">📹</button></div><div id="chatMsgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column-reverse"></div><div style="padding:10px;display:flex;gap:8px"><input type="file" id="cfile" style="display:none" onchange="sendFile(this)"><button class="sb" onclick="document.getElementById('cfile').click()">📎</button><button class="sb" id="recBtn" onmousedown="startRec()" onmouseup="stopRec()" ontouchstart="startRec()" ontouchend="stopRec()">🎤</button><input id="cin" placeholder="پیام..." onkeydown="if(event.key==='Enter')sendMsg()" style="flex:1;margin:0"><button class="sb" onclick="sendMsg()">➤</button></div></div>

<div id="postModal" class="modal"><div style="padding:12px;display:flex;align-items:center;gap:10px"><button class="cx" style="position:static" onclick="document.getElementById('postModal').classList.remove('on')">←</button><b>کامنت‌ها</b></div><div id="postBody" style="flex:1;overflow-y:auto;padding:12px"></div><div style="padding:10px;display:flex;gap:8px"><input id="cmtIn" placeholder="کامنت بنویس..." style="flex:1;margin:0"><button class="sb" onclick="addComment()">➤</button></div></div>

<div id="callScreen" class="call-screen"><video id="remoteVid" autoplay playsinline></video><video id="localVid" class="local" autoplay playsinline muted></video><div class="call-info"><h2 id="callName"></h2><div id="callStatus">در حال تماس...</div></div><div class="call-btns"><button id="callAccept" style="background:#22c55e;display:none" onclick="acceptCall()">✓</button><button style="background:#ef4444" onclick="endCall()">✕</button></div></div>

<div class="toast" id="toast"></div>

<script>
const socket=io();
let ME=localStorage.getItem('rl_id'),MYNAME=localStorage.getItem('rl_name')||'';
let pc=null,localStream=null,liveId=null,isHost=false,hostSock=null,chatWith=null,posts=[],curPost=null,recorder=null,recChunks=[],callPc=null,callStream=null,incomingCall=null;
const rtc={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
const $=id=>document.getElementById(id);
const toast=m=>{const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)};

if(!ME){const n=prompt('اسمت چیه؟ 🐰');if(n){ME='u'+Math.random().toString(36).slice(2,8);MYNAME=n;localStorage.setItem('rl_id',ME);localStorage.setItem('rl_name',n)}}
$('meName').textContent='🐰 '+MYNAME;
socket.emit('reg',{id:ME,name:MYNAME});

function go(p,el){document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));$('pg-'+p).classList.add('on');document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));if(el)el.classList.add('on');if(p==='home')loadFeed();if(p==='live')loadLives();if(p==='chat')loadUsers();if(p==='me')loadMe()}

async function api(u,d){const o={method:d?'POST':'GET',headers:{'Content-Type':'application/json'}};if(d)o.body=JSON.stringify(d);return(await fetch(u,o)).json()}

async function loadFeed(){posts=await api('/api/posts');$('feed').innerHTML=posts.length?posts.map(postHTML).join(''):'<div class="empty">هنوز پستی نیست 🐰</div>'}
function postHTML(p){
  let media='';
  if(p.media){if(p.type==='image')media='<img class="post-media" src="'+p.media+'">';else if(p.type==='video')media='<video class="post-media" src="'+p.media+'" controls></video>';else if(p.type==='audio')media='<audio src="'+p.media+'" controls style="width:100%;margin:10px 0"></audio>'}
  const liked=p.likes.includes(ME);
  return '<div class="card"><div class="row"><div class="av">🐰</div><div style="flex:1"><b>'+p.name+'</b><div style="font-size:11px;color:rgba(255,255,255,.4)">'+new Date(p.ts).toLocaleString('fa-IR')+'</div></div></div>'+(p.text?'<p style="margin:10px 0;line-height:1.7">'+p.text+'</p>':'')+media+'<div class="post-actions"><span onclick="likePost('+p.id+')">'+(liked?'❤️':'🤍')+' '+p.likes.length+'</span><span onclick="openPost('+p.id+')">💬 '+p.comments.length+'</span></div></div>'
}
async function likePost(id){const r=await api('/api/like',{id,user:ME});loadFeed()}
function openPost(id){curPost=posts.find(p=>p.id===id);renderPost();$('postModal').classList.add('on')}
function renderPost(){const p=curPost;if(!p)return;let media='';if(p.media){if(p.type==='image')media='<img class="post-media" src="'+p.media+'">';else if(p.type==='video')media='<video class="post-media" src="'+p.media+'" controls></video>';else if(p.type==='audio')media='<audio src="'+p.media+'" controls style="width:100%"></audio>'}$('postBody').innerHTML='<div class="row"><div class="av">🐰</div><b>'+p.name+'</b></div>'+(p.text?'<p style="margin:12px 0;line-height:1.7">'+p.text+'</p>':'')+media+'<hr style="border-color:var(--glass);margin:12px 0"><b>کامنت‌ها ('+p.comments.length+')</b>'+p.comments.map(c=>'<div class="cmt"><b>'+c.name+'</b>'+c.text+'</div>').join('')}
async function addComment(){const t=$('cmtIn').value.trim();if(!t)return;await api('/api/comment',{id:curPost.id,user:ME,name:MYNAME,text:t});$('cmtIn').value='';posts=await api('/api/posts');curPost=posts.find(p=>p.id===curPost.id);renderPost();loadFeed()}

let pendingFile=null,pendingType='text';
function previewFile(inp){const f=inp.files[0];if(!f)return;pendingFile=f;pendingType=f.type.startsWith('image')?'image':f.type.startsWith('video')?'video':f.type.startsWith('audio')?'audio':'file';$('pprev').innerHTML='<div class="card">📎 '+f.name+' ('+Math.round(f.size/1024)+'KB)</div>'}
async function makePost(){const t=$('ptxt').value.trim();if(!t&&!pendingFile)return toast('⚠️ چیزی بنویس یا فایل انتخاب کن');let media=null,type=pendingType;if(pendingFile){const fd=new FormData();fd.append('file',pendingFile);const r=await(await fetch('/upload',{method:'POST',body:fd})).json();media=r.url}await api('/api/post',{user:ME,name:MYNAME,text:t,media,type});$('ptxt').value='';$('pprev').innerHTML='';pendingFile=null;$('pfile').value='';toast('✅ منتشر شد');go('home',document.querySelectorAll('.nav button')[0])}

async function loadLives(){const ls=await api('/api/lives');$('ll').innerHTML=ls.length?ls.map(l=>'<div class="li '+(isHost&&l.id===liveId?'mine':'')+'" onclick="clickLive(\\''+l.id+'\\',\\''+l.name.replace(/'/g,"")+'\\','+(isHost&&l.id===liveId)+')"><div class="av">🐰</div><div style="flex:1"><b>'+l.name+'</b><div style="font-size:12px;color:rgba(255,255,255,.5)"><span class="badge">LIVE</span> 👁 '+l.viewers+'</div></div></div>').join(''):'<div class="empty">هنوز لایوی نیست</div>'}
function clickLive(id,name,mine){if(mine){$('vid').srcObject=localStream;openLive(name+' (شما)');return}if(isHost)return toast('⚠️ اول لایو خودت رو قطع کن');socket.emit('join-live',id);openLive(name)}
async function toggleLive(){if(isHost)return endLive();try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true})}catch(e){return toast('❌ دوربین در دسترس نیست')}socket.emit('start-live',{name:MYNAME})}
socket.on('live-started',d=>{liveId=d.id;isHost=true;$('glb').classList.add('red');$('glb').textContent='⏹ پایان لایو';$('vid').srcObject=localStream;$('vid').muted=true;openLive(d.name+' (شما)');addLC('سیستم','🎬 لایو شروع شد');loadLives()});
function endLive(){socket.emit('end-live',liveId);localStream?.getTracks().forEach(t=>t.stop());pc?.close();pc=null;isHost=false;liveId=null;$('glb').classList.remove('red');$('glb').textContent='🔴 شروع لایو';closeLive();toast('⏹ لایو تمام شد')}
socket.on('joined',d=>{liveId=d.id;hostSock=d.host;pc=new RTCPeerConnection(rtc);pc.ontrack=e=>{$('vid').srcObject=e.streams[0];$('vid').muted=false;$('ph').style.display='none'};pc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc-ice',{to:hostSock,room:liveId,candidate:e.candidate})};pc.createOffer().then(o=>{pc.setLocalDescription(o);socket.emit('rtc-offer',{to:hostSock,room:liveId,sdp:o})})});
socket.on('live-ended',()=>{if(!isHost){toast('🔚 لایو تمام شد');closeLive()}});
socket.on('lives-updated',()=>{if($('pg-live').classList.contains('on')&&!$('liveModal').classList.contains('on'))loadLives()});
socket.on('error-msg',m=>{toast('❌ '+m);closeLive()});
socket.on('viewer-count',n=>{if(isHost)addLC('سیستم','👁 بینندگان: '+n)});
socket.on('rtc-offer',async d=>{if(!isHost||!localStream)return;if(!pc){pc=new RTCPeerConnection(rtc);localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc-ice',{to:d.from,room:liveId,candidate:e.candidate})}}await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));const a=await pc.createAnswer();await pc.setLocalDescription(a);socket.emit('rtc-answer',{to:d.from,room:liveId,sdp:a})});
socket.on('rtc-answer',async d=>{await pc?.setRemoteDescription(new RTCSessionDescription(d.sdp))});
socket.on('rtc-ice',async d=>{await pc?.addIceCandidate(new RTCIceCandidate(d.candidate))});
function openLive(n){$('liveModal').classList.add('on');$('mhost').textContent=n;$('lcms').innerHTML='';$('vid').srcObject=null;$('ph').style.display='block'}
function closeLive(){if(!isHost){socket.emit('leave-live',liveId);pc?.close();pc=null;liveId=null;hostSock=null}$('liveModal').classList.remove('on');if(!isHost)$('vid').srcObject=null}
function sendLC(){const t=$('lcin').value.trim();if(!t)return;socket.emit('chat',{room:liveId,user:ME,name:MYNAME,text:t,to:null,live:1});$('lcin').value=''}
socket.on('chat',d=>{if(d.live&&d.room===liveId)addLC(d.name,d.text);else if(!d.live&&(d.to===ME||d.from===ME)&&chatWith&&(d.from===chatWith||d.to===chatWith))addMsg(d.from===ME?'me':'them',d)});
function addLC(u,t){const c=$('lcms'),e=document.createElement('div');e.className=u==='سیستم'?'cm sys':'cm';e.innerHTML=u==='سیستم'?t:'<b>'+u+':</b> '+t;c.appendChild(e);c.scrollTop=c.scrollHeight}

async function loadUsers(){const us=await api('/api/users');$('ulist').innerHTML=us.filter(u=>u.id!==ME).length?us.filter(u=>u.id!==ME).map(u=>'<div class="li" onclick="openChat(\\''+u.id+'\\',\\''+u.name.replace(/'/g,"")+'\\')"><div class="av">🐰</div><div style="flex:1"><b>'+u.name+'</b><div style="font-size:11px;color:rgba(255,255,255,.4)">'+(u.bio||'')+'</div></div></div>').join(''):'<div class="empty">هنوز کاربری نیست</div>'}
function openChat(id,name){chatWith=id;$('chatName').textContent=name;$('chatMsgs').innerHTML='';$('chatModal').classList.add('on')}
function closeChat(){$('chatModal').classList.remove('on');chatWith=null}
function sendMsg(){const t=$('cin').value.trim();if(!t||!chatWith)return;const d={from:ME,to:chatWith,name:MYNAME,text:t,type:'text'};socket.emit('chat',d);addMsg('me',d);$('cin').value=''}
function addMsg(side,d){const c=$('chatMsgs'),e=document.createElement('div');e.className='msg '+side;let body=d.text||'';if(d.type==='image')body+='<img src="'+d.media+'">';else if(d.type==='video')body+='<video src="'+d.media+'" controls></video>';else if(d.type==='audio')body+='<audio src="'+d.media+'" controls></audio>';else if(d.type==='file')body+='<a href="'+d.media+'" download target="_blank">📎 '+d.fname+'</a>';e.innerHTML=body;c.prepend(e)}
async function sendFile(inp){const f=inp.files[0];if(!f||!chatWith)return;const fd=new FormData();fd.append('file',f);const r=await(await fetch('/upload',{method:'POST',body:fd})).json();const type=f.type.startsWith('image')?'image':f.type.startsWith('video')?'video':f.type.startsWith('audio')?'audio':'file';const d={from:ME,to:chatWith,name:MYNAME,type,media:r.url,fname:f.name};socket.emit('chat',d);addMsg('me',d);inp.value=''}
function startRec(){recChunks=[];navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{recorder=new MediaRecorder(s);recorder.ondataavailable=e=>recChunks.push(e.data);recorder.onstop=async()=>{const blob=new Blob(recChunks,{type:'audio/webm'});const fd=new FormData();fd.append('file',blob,'voice.webm');const r=await(await fetch('/upload',{method:'POST',body:fd})).json();const d={from:ME,to:chatWith,name:MYNAME,type:'audio',media:r.url};socket.emit('chat',d);addMsg('me',d);s.getTracks().forEach(t=>t.stop())};recorder.start();toast('🎤 در حال ضبط...')})}
function stopRec(){if(recorder&&recorder.state==='recording'){recorder.stop();toast('✅ ارسال شد')}}

function startCall(type){if(!chatWith)return;navigator.mediaDevices.getUserMedia({audio:true,video:type==='video'}).then(s=>{callStream=s;$('localVid').srcObject=s;$('callScreen').classList.add('on');$('callName').textContent=$('chatName').textContent;$('callStatus').textContent='در حال تماس...';$('callAccept').style.display='none';callPc=new RTCPeerConnection(rtc);s.getTracks().forEach(t=>callPc.addTrack(t,s));callPc.ontrack=e=>{$('remoteVid').srcObject=e.streams[0];$('callStatus').textContent='متصل ✓'};callPc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc-ice',{to:chatWith,candidate:e.candidate,call:1})};socket.emit('call',{to:chatWith,type});callPc.createOffer().then(o=>{callPc.setLocalDescription(o);socket.emit('rtc-offer',{to:chatWith,sdp:o,call:1})})})}
socket.on('call',d=>{incomingCall=d;$('callScreen').classList.add('on');$('callName').textContent=d.fromName;$('callStatus').textContent=(d.type==='video'?'تماس تصویری':'تماس صوتی')+' ورودی';$('callAccept').style.display='block';navigator.mediaDevices.getUserMedia({audio:true,video:d.type==='video'}).then(s=>{callStream=s;$('localVid').srcObject=s;callPc=new RTCPeerConnection(rtc);s.getTracks().forEach(t=>callPc.addTrack(t,s));callPc.ontrack=e=>{$('remoteVid').srcObject=e.streams[0];$('callStatus').textContent='متصل ✓'};callPc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc-ice',{to:d.from,candidate:e.candidate,call:1})}})});
function acceptCall(){if(!incomingCall)return;socket.emit('call-answer',{to:incomingCall.from});callPc.createAnswer().then(a=>{callPc.setLocalDescription(a);socket.emit('rtc-answer',{to:incomingCall.from,sdp:a,call:1})});$('callAccept').style.display='none';$('callStatus').textContent='در حال اتصال...'}
socket.on('call-answer',d=>{});
socket.on('rtc-offer',async d=>{if(!d.call||!callPc)return;await callPc.setRemoteDescription(new RTCSessionDescription(d.sdp));if(callPc.signalingState==='have-remote-offer'){const a=await callPc.createAnswer();await callPc.setLocalDescription(a);socket.emit('rtc-answer',{to:d.from,sdp:a,call:1})}});
socket.on('rtc-answer',async d=>{if(d.call&&callPc)await callPc.setRemoteDescription(new RTCSessionDescription(d.sdp))});
socket.on('rtc-ice',async d=>{if(d.call&&callPc)await callPc.addIceCandidate(new RTCIceCandidate(d.candidate))});
socket.on('call-end',()=>endCall());
function endCall(){if(incomingCall)socket.emit('call-end',{to:incomingCall.from});else if(chatWith)socket.emit('call-end',{to:chatWith});callStream?.getTracks().forEach(t=>t.stop());callPc?.close();callPc=null;callStream=null;incomingCall=null;$('callScreen').classList.remove('on');$('remoteVid').srcObject=null;$('localVid').srcObject=null}

async function loadMe(){const u=await api('/api/me/'+ME);$('myName').textContent=u.name;$('myBio').textContent=u.bio||'بدون بیو';$('myFoll').textContent=u.followers.length;$('myFolg').textContent=u.following.length;const my=posts.filter(p=>p.user===ME);$('myPosts').textContent=my.length;$('myposts').innerHTML=my.length?my.map(postHTML).join(''):'<div class="empty">هنوز پستی نگذاشتی</div>'}
async function editProfile(){const n=prompt('اسم جدید:',MYNAME)||MYNAME;const b=prompt('بیو:','')||'';await api('/api/profile',{id:ME,name:n,bio});MYNAME=n;localStorage.setItem('rl_name',n);$('meName').textContent='🐰 '+n;socket.emit('reg',{id:ME,name:n});loadMe();toast('✅ ذخیره شد')}

loadFeed();
</script></body></html>`;

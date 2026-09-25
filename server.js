const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');

const PORT=Number(process.env.PORT||8080);
const ROOT=__dirname;
const DB=path.join(ROOT,'data','users.json');

const ADMIN_USER=(process.env.ADMIN_USER||'').trim().toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'';

// Chave usada futuramente pelo agente instalado no PC do GameCloud.
// Configure no Render antes de colocar o agente em produção.
const STREAM_AGENT_KEY=process.env.STREAM_AGENT_KEY||'';

const sessions=new Map();
const resetTokens=new Map();
const attempts=new Map();

// Estado atual do servidor de streaming.
// O Render mantém somente o estado; o agente no PC fará a execução real do FiveM.
const streaming={
enabled:true,
status:'offline',
game:'FiveM',
host:'PC-GAMECLOUD',
lastHeartbeat:null,
message:'Aguardando o computador GameCloud'
};

fs.mkdirSync(path.dirname(DB),{recursive:true});

let users={};

try{
users=JSON.parse(fs.readFileSync(DB,'utf8'));
}catch(e){
if(e.code!=='ENOENT')throw e;
}

function save(){
const tmp=DB+'.tmp';
fs.writeFileSync(tmp,JSON.stringify(users,null,2),{mode:0o600});
fs.renameSync(tmp,DB);
}

function digest(p,s){
return crypto.scryptSync(p,s,64).toString('hex');
}

function verify(p,u){
const a=Buffer.from(digest(p,u.salt),'hex');
const b=Buffer.from(u.hash,'hex');
return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function json(res,status,data){
res.writeHead(status,{
'Access-Control-Allow-Origin':'*',
'Content-Type':'application/json; charset=utf-8',
'Cache-Control':'no-store',
'X-Content-Type-Options':'nosniff',
'X-Frame-Options':'DENY',
'Content-Security-Policy':"default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';base-uri 'none';frame-ancestors 'none'"
});
res.end(JSON.stringify(data));
}

function read(req){
return new Promise((resolve,reject)=>{
let chunks=[],size=0;

req.on('data',c=>{
size+=c.length;

if(size>32768){
reject(new Error('Pedido muito grande'));
req.destroy();
}else{
chunks.push(c);
}
});

req.on('end',()=>{
try{
resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'));
}catch(e){
reject(e);
}
});

req.on('error',reject);
});
}

function session(req){
const t=(req.headers.authorization||'').replace(/^Bearer /,'');
const s=sessions.get(t);

if(!s||s.exp<Date.now()){
if(t)sessions.delete(t);
return null;
}

return s;
}

function rate(ip){
let r=attempts.get(ip)||{n:0,at:Date.now()};

if(Date.now()-r.at>60000){
r={n:0,at:Date.now()};
}

r.n++;
attempts.set(ip,r);

return r.n>40;
}

function agentAuthorized(req){
if(!STREAM_AGENT_KEY)return false;

const key=String(req.headers['x-stream-agent-key']||'');

if(!key)return false;

const a=Buffer.from(key);
const b=Buffer.from(STREAM_AGENT_KEY);

return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function cleanupStreamingHeartbeat(){
if(
streaming.lastHeartbeat &&
Date.now()-streaming.lastHeartbeat>90000
){
streaming.status='offline';
streaming.message='Computador GameCloud sem comunicação';
}
}

const server=http.createServer(async(req,res)=>{
let pathname;

try{
pathname=new URL(req.url,'http://localhost').pathname;
}catch{
return json(res,400,{error:'URL inválida'});
}

if(req.method==='OPTIONS'){
res.writeHead(204,{
'Access-Control-Allow-Origin':'*',
'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Stream-Agent-Key'
});
return res.end();
}

if(req.method==='GET'&&pathname==='/'){
res.writeHead(200,{
'Content-Type':'text/html; charset=utf-8',
'Cache-Control':'no-store'
});

return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);
}

if(req.method==='GET'&&pathname==='/app.js'){
res.writeHead(200,{
'Content-Type':'text/javascript; charset=utf-8',
'Cache-Control':'no-store'
});

return fs.createReadStream(path.join(ROOT,'app.js')).pipe(res);
}

if(req.method==='GET'&&pathname==='/api/health'){
cleanupStreamingHeartbeat();

return json(res,200,{
ok:true,
version:'4.1.0',
streaming:{
enabled:streaming.enabled,
status:streaming.status
}
});
}

/*
STATUS PÚBLICO DO GAMECLOUD

Este endpoint não inicia o FiveM.
Ele apenas informa se o computador GameCloud está conectado.
*/
if(req.method==='GET'&&pathname==='/api/stream/status'){
cleanupStreamingHeartbeat();

return json(res,200,{
ok:true,
enabled:streaming.enabled,
status:streaming.status,
game:streaming.game,
host:streaming.host,
message:streaming.message,
lastHeartbeat:streaming.lastHeartbeat
});
}

if(!pathname.startsWith('/api/')){
return json(res,404,{error:'Página não encontrada'});
}

const ip=req.socket.remoteAddress||'local';

if(req.method==='POST'&&rate(ip)){
return json(res,429,{error:'Aguarde um minuto e tente novamente'});
}

try{

const b=req.method==='POST'?await read(req):{};
const s=session(req);
const email=String(b.email||'').trim().toLowerCase();

/* =========================
CADASTRO
========================= */

if(pathname==='/api/users/register'&&req.method==='POST'){

if(
!/^[^\s@]+@[^\s@]+.[^\s@]+$/.test(email)||
String(b.password||'').length<8
){
return json(res,400,{
error:'Informe e-mail válido e senha com 8 caracteres ou mais'
});
}

if(users[email]||email===ADMIN_USER){
return json(res,409,{error:'E-mail já cadastrado'});
}

const salt=crypto.randomBytes(16).toString('hex');

users[email]={
email,
name:String(b.name||'Jogador').slice(0,60),
salt,
hash:digest(b.password,salt),
minutes:0
};

save();

return json(res,201,{ok:true});
}

/* =========================
LOGIN
========================= */

if(pathname==='/api/login'&&req.method==='POST'){

let role;
const emailFound=email;

if(
ADMIN_USER&&
ADMIN_PASSWORD&&
email===ADMIN_USER&&
crypto.timingSafeEqual(
crypto.createHash('sha256')
.update(String(b.password||''))
.digest(),
crypto.createHash('sha256')
.update(ADMIN_PASSWORD)
.digest()
)
){
role='admin';
}else if(
users[email]&&
verify(String(b.password||''),users[email])
){
role='player';
}else{
return json(res,401,{error:'E-mail ou senha incorretos'});
}

const token=crypto.randomBytes(32).toString('base64url');

sessions.set(token,{
role,
email:emailFound,
exp:Date.now()+(b.remember?3086400000:83600000)
});

return json(res,200,{
token,
role,
name:role==='admin'?'Administrador':users[email].name
});
}

/* =========================
USUÁRIO LOGADO
========================= */

if(pathname==='/api/me'&&req.method==='GET'){

if(!s){
return json(res,401,{error:'Entre na sua conta'});
}

return json(res,200,{
role:s.role,
email:s.email,
name:s.role==='admin'
?'Administrador'
:users[s.email]?.name||'Jogador',
minutes:users[s.email]?.minutes||0,
streaming:{
enabled:streaming.enabled,
status:streaming.status,
game:streaming.game
}
});
}

/* =========================
LOGOUT
========================= */

if(pathname==='/api/logout'&&req.method==='POST'){

const token=(req.headers.authorization||'').replace(/^Bearer /,'');

sessions.delete(token);

return json(res,200,{ok:true});
}

/* =========================
ESQUECI A SENHA
========================= */

if(pathname==='/api/password/forgot'&&req.method==='POST'){

if(users[email]){

const token=crypto.randomBytes(24).toString('hex');

resetTokens.set(token,{
email,
exp:Date.now()+15*60000
});

console.log(
'RECUPERAÇÃO LOCAL (configure e-mail antes de publicar): /?reset='+token
);
}

return json(res,200,{
message:'Se a conta existir, a recuperação foi solicitada. O envio por e-mail requer configuração adicional.'
});
}

/* =========================
ALTERAR SENHA
========================= */

if(pathname==='/api/password/reset'&&req.method==='POST'){

const r=resetTokens.get(String(b.token||''));

if(
!r||
r.exp<Date.now()||
String(b.password||'').length<8
){
return json(res,400,{
error:'Link inválido, expirado ou senha curta'
});
}

const u=users[r.email];

u.salt=crypto.randomBytes(16).toString('hex');
u.hash=digest(b.password,u.salt);

save();
resetTokens.delete(b.token);

return json(res,200,{ok:true});
}

/* =========================
ÁREA ADMINISTRATIVA
========================= */

if(pathname.startsWith('/api/admin/')){

if(!s||s.role!=='admin'){
return json(res,403,{
error:'Acesso exclusivo do administrador'
});
}

/* ---------- OVERVIEW ---------- */

if(pathname==='/api/admin/overview'&&req.method==='GET'){

const online=new Set(
[...sessions.values()]
.filter(x=>x.role==='player'&&x.exp>Date.now())
.map(x=>x.email)
);

cleanupStreamingHeartbeat();

return json(res,200,{
users:Object.keys(users).length,
playersOnline:online.size,
version:'4.1.0',

streaming:{
enabled:streaming.enabled,
status:streaming.status,
game:streaming.game,
host:streaming.host,
message:streaming.message,
lastHeartbeat:streaming.lastHeartbeat
},

players:Object.values(users).map(u=>({
email:u.email,
name:u.name,
minutes:u.minutes,
online:online.has(u.email)
}))
});
}

/* ---------- ADICIONAR TEMPO ---------- */

if(pathname==='/api/admin/time/add'&&req.method==='POST'){

const u=users[email];
const minutes=Number(b.minutes);

if(!u){
return json(res,404,{
error:'Jogador não encontrado'
});
}

if(
!Number.isSafeInteger(minutes)||
minutes<=0||
minutes>100000
){
return json(res,400,{
error:'Informe de 1 a 100000 minutos'
});
}

u.minutes+=minutes;
save();

return json(res,200,{
ok:true,
minutes:u.minutes
});
}

/* ---------- ATIVAR/DESATIVAR STREAMING ---------- */

if(pathname==='/api/admin/stream/toggle'&&req.method==='POST'){

if(typeof b.enabled!=='boolean'){
return json(res,400,{
error:'Informe enabled como true ou false'
});
}

streaming.enabled=b.enabled;

if(!streaming.enabled){
streaming.status='offline';
streaming.message='Streaming desativado pelo administrador';
}else{
streaming.message='Streaming ativado; aguardando o PC GameCloud';
}

return json(res,200,{
ok:true,
enabled:streaming.enabled,
status:streaming.status,
message:streaming.message
});
}

/* ---------- SOLICITAR INÍCIO DO FIVEM ---------- */

if(pathname==='/api/admin/stream/start'&&req.method==='POST'){

if(!streaming.enabled){
return json(res,400,{
error:'O streaming está desativado'
});
}

streaming.status='starting';
streaming.message='Solicitação de início do FiveM registrada';

return json(res,200,{
ok:true,
status:streaming.status,
message:streaming.message
});
}

/* ---------- SOLICITAR PARADA DO FIVEM ---------- */

if(pathname==='/api/admin/stream/stop'&&req.method==='POST'){

streaming.status='stopping';
streaming.message='Solicitação de parada do FiveM registrada';

return json(res,200,{
ok:true,
status:streaming.status,
message:streaming.message
});
}

}

/* =========================
AGENTE DO PC GAMECLOUD
========================= */

/*
O agente do PC usará estes endpoints.

O segredo NÃO deve ser colocado no código.
Ele será configurado no Render como:
STREAM_AGENT_KEY=uma_chave_secreta

O agente enviará:
X-Stream-Agent-Key: <chave>
*/

if(pathname==='/api/agent/heartbeat'&&req.method==='POST'){

if(!agentAuthorized(req)){
return json(res,401,{
error:'Agente não autorizado'
});
}

streaming.lastHeartbeat=Date.now();

if(b.status){
streaming.status=String(b.status).slice(0,30);
}

if(b.message){
streaming.message=String(b.message).slice(0,200);
}else{
streaming.message='PC GameCloud conectado';
}

if(b.host){
streaming.host=String(b.host).slice(0,100);
}

return json(res,200,{
ok:true,
enabled:streaming.enabled,
status:streaming.status,
game:streaming.game
});
}

/* ---------- AGENTE CONSULTA COMANDO ---------- */

if(pathname==='/api/agent/command'&&req.method==='GET'){

if(!agentAuthorized(req)){
return json(res,401,{
error:'Agente não autorizado'
});
}

let command='none';

if(streaming.status==='starting'){
command='start_fivem';
}else if(streaming.status==='stopping'){
command='stop_fivem';
}

return json(res,200,{
ok:true,
enabled:streaming.enabled,
command
});
}

/* ---------- AGENTE CONFIRMA EXECUÇÃO ---------- */

if(pathname==='/api/agent/status'&&req.method==='POST'){

if(!agentAuthorized(req)){
return json(res,401,{
error:'Agente não autorizado'
});
}

streaming.lastHeartbeat=Date.now();

if(b.status){
streaming.status=String(b.status).slice(0,30);
}

if(b.message){
streaming.message=String(b.message).slice(0,200);
}

if(b.host){
streaming.host=String(b.host).slice(0,100);
}

/*
Quando o agente informar que terminou uma ação,
limpamos o comando pendente.
*/

if(
streaming.status==='online'||
streaming.status==='offline'||
streaming.status==='error'
){
if(streaming.status==='online'){
streaming.message='FiveM disponível no PC GameCloud';
}

if(streaming.status==='offline'){
streaming.message='FiveM desligado';
}
}

return json(res,200,{
ok:true,
status:streaming.status,
message:streaming.message
});
}

/* =========================
ROTA NÃO ENCONTRADA
========================= */

return json(res,404,{
error:'Função não disponível'
});

}catch(e){

console.error(e);

return json(res,400,{
error:'Não foi possível processar o pedido'
});
}
});

server.listen(PORT,'0.0.0.0',()=>{
console.log(
'Império GameCloud: http://localhost:'+PORT
);
});

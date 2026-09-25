'use strict';

let token=localStorage.getItem('igc_token')||sessionStorage.getItem('igc_token')||'';
let role='';

const API_BASE='https://imperio-gamecloud-1.onrender.com/api/';

const el=id=>document.getElementById(id);

function show(page){
document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===page));
message('')
}

function message(text,error=false){
let p=el('message');
p.textContent=text;
p.className=error?'error':'success'
}

async function api(url,method='GET',data){
let response=await fetch(API_BASE+url,{
method,
headers:{
'Content-Type':'application/json',
...(token?{Authorization:'Bearer '+token}:{})
},
...(data?{body:JSON.stringify(data)}:{})
});

let body=await response.json();

if(!response.ok)throw Error(body.error||'Falha na conexão');

return body
}

async function load(){
let me=await api('me');
role=me.role;

if(role==='admin'){
show('admin');
await loadAdmin()
}else{
show('home');
el('greeting').textContent='Olá, '+me.name+'!';
el('minutes').textContent=me.minutes+' minutos'
}
}

async function loadAdmin(){
let data=await api('admin/overview');

el('users').textContent=data.users;
el('online').textContent=data.playersOnline;

let tbody=el('players');
tbody.replaceChildren();

data.players.forEach(p=>{
let tr=document.createElement('tr');

[p.name,p.email,String(p.minutes),p.online?'Online':'Offline'].forEach(v=>{
let td=document.createElement('td');
td.textContent=v;
tr.append(td)
});

tbody.append(tr)
})
}

function fail(e){
message(
e.message||'Não foi possível conectar ao servidor. Verifique se ele está ligado.',
true
)
}

document.querySelectorAll('[data-page]').forEach(b=>
b.addEventListener('click',()=>show(b.dataset.page))
);

el('loginForm').addEventListener('submit',async e=>{
e.preventDefault();

try{
let remember=el('remember').checked;

let result=await api('login','POST',{
email:el('email').value,
password:el('password').value,
remember
});

token=result.token;

localStorage.removeItem('igc_token');
sessionStorage.removeItem('igc_token');

(remember?localStorage:sessionStorage).setItem('igc_token',token);

el('password').value='';

await load()
}catch(err){
fail(err)
}
});

el('registerForm').addEventListener('submit',async e=>{
e.preventDefault();

try{
await api('users/register','POST',{
name:el('rname').value,
email:el('remail').value,
password:el('rpassword').value
});

el('email').value=el('remail').value;
el('rpassword').value='';

show('login');

message('Conta criada! Entre com seu e-mail e senha.')
}catch(err){
fail(err)
}
});

el('forgotForm').addEventListener('submit',async e=>{
e.preventDefault();

try{
let r=await api('password/forgot','POST',{
email:el('femail').value
});

message(r.message)
}catch(err){
fail(err)
}
});

el('resetForm').addEventListener('submit',async e=>{
e.preventDefault();

try{
await api('password/reset','POST',{
token:new URLSearchParams(location.search).get('reset'),
password:el('newpassword').value
});

history.replaceState(null,'',location.pathname);

show('login');

message('Senha alterada. Entre novamente.')
}catch(err){
fail(err)
}
});

el('timeForm').addEventListener('submit',async e=>{
e.preventDefault();

try{
let r=await api('admin/time/add','POST',{
email:el('playerEmail').value,
minutes:Number(el('addMinutes').value)
});

await loadAdmin();

message('Tempo atualizado: '+r.minutes+' minutos.')
}catch(err){
fail(err)
}
});

el('refresh').addEventListener('click',()=>load().catch(fail));

el('refreshAdmin').addEventListener('click',()=>
loadAdmin()
.then(()=>message('Painel atualizado.'))
.catch(fail)
);

document.querySelectorAll('.logout').forEach(b=>
b.addEventListener('click',async()=>{
try{
await api('logout','POST')
}catch{}

token='';

localStorage.removeItem('igc_token');
sessionStorage.removeItem('igc_token');

show('login');

message('Você saiu da conta.')
})
);

if(new URLSearchParams(location.search).has('reset')){
show('reset')
}else if(token){
load().catch(()=>{
token='';
localStorage.removeItem('igc_token');
sessionStorage.removeItem('igc_token');
show('login')
})
}

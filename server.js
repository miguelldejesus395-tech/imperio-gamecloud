'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const USER_PASSWORD = String(process.env.USER_PASSWORD || '12345678');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const DATA_FILE = path.join(__dirname, 'data', 'gamecloud.json');

const defaultPackages = [
  { id: 'basico', name: 'Básico', priceCents: 1000, ram: 4, vcpu: 2, gpu: 'GPU básica', storage: 50 },
  { id: 'intermediario', name: 'Intermediário', priceCents: 2000, ram: 8, vcpu: 4, gpu: 'GPU melhor', storage: 100 },
  { id: 'avancado', name: 'Avançado', priceCents: 3000, ram: 16, vcpu: 6, gpu: 'GPU avançada', storage: 200 },
  { id: 'premium', name: 'Premium', priceCents: 5000, ram: 32, vcpu: 8, gpu: 'GPU mais potente', storage: 400 }
];

let users, servers, packages, orders, tickets, minutesRateCents;

function readDatabase() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    users = Array.isArray(parsed.users) ? parsed.users : null;
    servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    packages = Array.isArray(parsed.packages) && parsed.packages.length ? parsed.packages : defaultPackages;
    orders = Array.isArray(parsed.orders) ? parsed.orders : [];
    tickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
    minutesRateCents = Number.isSafeInteger(parsed.minutesRateCents) ? parsed.minutesRateCents : 10;
  } catch (error) {
    users = null; servers = []; packages = defaultPackages; orders = []; tickets = []; minutesRateCents = 10;
  }
}

function saveDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ users, servers, packages, orders, tickets, minutesRateCents }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}

function passwordFields(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function passwordMatches(user, password) {
  if (user.passwordHash && user.passwordSalt) {
    const candidate = crypto.scryptSync(password, user.passwordSalt, 64);
    const stored = Buffer.from(user.passwordHash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
  }
  return false;
}

const sessions = new Map();
readDatabase();
const seedPassword = passwordFields(USER_PASSWORD);
if (!users) {
  users = [{
    id: 1,
    name: 'Miguel Silva',
    username: 'miguell003',
    email: 'miguel@email.com',
    ...seedPassword,
    minutes: 120,
    createdAt: new Date().toISOString()
  }];
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Muito grande.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function getCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const eqIndex = part.indexOf('=');
    if (eqIndex < 0) return;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    try { cookies[key] = decodeURIComponent(value); }
    catch { cookies[key] = value; }
  });
  return cookies;
}

function getSession(req) {
  const cookies = getCookies(req);
  const token = cookies.session || '';
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function getCurrentUser(req) {
  const session = getSession(req);
  if (!session) return null;
  return users.find(u => u.id === session.userId) || null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  ]);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', [
    'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  ]);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    minutes: user.minutes
  };
}

function findUserByLogin(value) {
  const login = String(value || '').trim().toLowerCase();
  return users.find(u =>
    u.email.toLowerCase() === login ||
    u.username.toLowerCase() === login
  );
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const baseUrl = 'http://' + (req.headers.host || 'localhost');
  const url = new URL(req.url, baseUrl);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readBody(req);
      const loginValue = String(body.email || body.username || '').trim();
      const password = String(body.password || '');
      const user = findUserByLogin(loginValue);

      if (!user || !passwordMatches(user, password)) {
        return sendJson(res, 401, { ok: false, error: 'Usuário ou senha incorretos!' });
      }

      const token = createToken();
      sessions.set(token, {
        userId: user.id,
        expiresAt: Date.now() + SESSION_TTL
      });
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Erro no login' });
    }
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = getCurrentUser(req);
    if (!user) {
      return sendJson(res, 401, { ok: false });
    }
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    const cookies = getCookies(req);
    if (cookies.session) sessions.delete(cookies.session);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const user = getCurrentUser(req);
    const isLoggedIn = !!user;
    const userName = user ? user.name : '';
    const userMinutes = user ? user.minutes : 120;
    const userEmail = user ? user.email : 'miguel@email.com';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Império GameCloud — FiveM na Nuvem</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
    :root {
      --fundo: #0b0e1f; --fundo2: #121838; --cartao: #1a2042; --destaque: #252d5c;
      --prim: #7b2cbf; --roxo: #9d4edd; --azul: #2563eb; --verde: #22c55e;
      --texto: #e6e8f0; --texto2: #9ca3af; --borda: #2a3366;
    }
    body { background: var(--fundo); color: var(--texto); min-height: 100vh; }
    
    .tela-login { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--fundo); }
    .login-card { background: var(--cartao); padding: 40px; border-radius: 16px; width: 100%; max-width: 420px; border: 1px solid var(--borda); }
    .login-card h2 { text-align: center; margin-bottom: 30px; font-size: 22px; }
    .login-card input { width: 100%; padding: 14px; margin: 8px 0; background: var(--fundo2); border: 1px solid var(--borda); color: #fff; border-radius: 8px; font-size: 15px; }
    .login-card button { width: 100%; padding: 14px; background: linear-gradient(90deg, var(--prim), var(--roxo)); border: none; color: #fff; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px; }
    .dica { text-align: center; margin-top: 15px; color: var(--texto2); font-size: 13px; }
    .oculto { display: none !important; }
    
    .container { display: grid; grid-template-columns: 250px 1fr 300px; gap: 16px; padding: 16px; max-width: 1920px; margin: 0 auto; }
    .sidebar-left { display: flex; flex-direction: column; gap: 8px; }
    .logo { font-size: 22px; font-weight: bold; padding: 12px 0 20px; }
    .menu-item { padding: 12px 16px; border-radius: 8px; color: var(--texto2); text-decoration: none; margin-bottom: 4px; }
    .menu-item.ativo { background: linear-gradient(90deg, var(--prim), var(--roxo)); color: #fff; font-weight: 600; }
    .menu-item:hover { background: var(--destaque); color: #fff; }
    .badge { background: var(--azul); font-size: 11px; padding: 2px 7px; border-radius: 10px; float: right; }
    
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .busca { background: var(--cartao); border: 1px solid var(--borda); padding: 10px 16px; border-radius: 8px; width: 320px; color: #fff; }
    .user-header { display: flex; align-items: center; gap: 12px; }
    .avatar-top { width: 36px; height: 36px; background: var(--azul); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .sair-btn { background: transparent; border: none; color: var(--texto2); cursor: pointer; padding: 6px 10px; border-radius: 6px; }
    
    .banner { background: linear-gradient(135deg, #1e1b4b, #312e81); border-radius: 14px; padding: 30px; text-align: center; margin-bottom: 20px; border: 1px solid var(--borda); }
    .banner h1 { font-size: 32px; margin-bottom: 8px; }
    .banner p { color: #a5b4fc; }
    
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: var(--cartao); border-radius: 10px; padding: 16px; border: 1px solid var(--borda); display: flex; align-items: center; gap: 12px; }
    .stat-valor { font-size: 22px; font-weight: bold; }
    .stat-texto { font-size: 12px; color: var(--texto2); }
    
    .grid-meio { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .card { background: var(--cartao); border-radius: 12px; padding: 20px; border: 1px solid var(--borda); }
    .status-online { color: var(--verde); }
    .btn-conectar { background: var(--azul); border: none; color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 10px; }
    .btn-gerenciar { background: var(--destaque); border: none; color: #fff; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-left: 8px; margin-top: 10px; }
    
    .botoes-acao { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .botao-acao { padding: 24px 20px; border-radius: 12px; border: none; color: #fff; cursor: pointer; text-align: left; font-weight: bold; }
    .roxo { background: linear-gradient(135deg, #6b21b0, #7e22ce); }
    .azul { background: linear-gradient(135deg, #1d4ed8, #3b82f6); }
    .escuro { background: var(--destaque); }
    
    .sidebar-right { display: flex; flex-direction: column; gap: 16px; }
    .conta-card { background: var(--cartao); border-radius: 12px; padding: 20px; border: 1px solid var(--borda); }
    .avatar-grande { width: 50px; height: 50px; background: var(--azul); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; }
    .btn-minutos { width: 100%; padding: 12px; background: linear-gradient(90deg, var(--prim), var(--roxo)); border: none; color: #fff; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 12px; }
    .acesso-item { display: block; padding: 12px; background: var(--destaque); border-radius: 8px; color: var(--texto); text-decoration: none; margin-bottom: 4px; }
  </style>
</head>
<body>
${!isLoggedIn ? `
<div class="tela-login">
  <div class="login-card">
    <h2>🔐 Entrar — Império GameCloud</h2>
    <input type="text" id="campo-login" placeholder="E-mail ou usuário">
    <input type="password" id="campo-senha" placeholder="Senha">
    <button onclick="fazerLogin()">Entrar</button>
    <p class="dica">Usuário: miguell003 | Senha: 12345678</p>
  </div>
</div>
` : `
<div class="container">
  <aside class="sidebar-left">
    <div class="logo">👑 IMPÉRIO GAMECLOUD</div>
    <a href="#" class="menu-item ativo">🏠 Início</a>
    <a href="#" class="menu-item">📋 Meus servidores</a>
    <a href="#" class="menu-item">🛒 Comprar servidor</a>
    <a href="#" class="menu-item">🛍️ Carrinho <span class="badge">2</span></a>
    <a href="#" class="menu-item">💳 Pagamento</a>
    <a href="#" class="menu-item">🎮 FiveM</a>
    <a href="#" class="menu-item">📦 Pedidos</a>
    <a href="#" class="menu-item">👤 Perfil</a>
    <a href="#" class="menu-item">⚙️ Configurações</a>
    <a href="#" class="menu-item">💬 Suporte</a>
  </aside>

  <main>
    <div class="top-bar">
      <input type="text" class="busca" placeholder="🔍 Buscar algo...">
      <div class="user-header">
        <span>${userName}</span>
        <div class="avatar-top">${userName.charAt(0)}</div>
        <button class="sair-btn" onclick="fazerLogout()">Sair</button>
      </div>
    </div>

    <div class="banner">
      <h1>👑 IMPÉRIO GAMECLOUD</h1>
      <p>FIVEM NA NUVEM — SEU JOGO, EM QUALQUER LUGAR</p>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div>⏱️</div>
        <div><div class="stat-valor">${userMinutes}</div><div class="stat-texto">Minutos disponíveis</div></div>
      </div>
      <div class="stat-card">
        <div>🗄️</div>
        <div><div class="stat-valor">1</div><div class="stat-texto">Servidor ativo</div></div>
      </div>
      <div class="stat-card">
        <div>🛒</div>
        <div><div class="stat-valor">2</div><div class="stat-texto">Pedidos</div></div>
      </div>
      <div class="stat-card">
        <div>🎮</div>
        <div><div class="stat-valor">FiveM</div><div class="stat-texto" style="color:var(--verde)">Online</div></div>
      </div>
    </div>

    <div class="grid-meio">
      <div class="card">
        <h3 style="margin-bottom:15px">Seus servidores</h3>
        <div>
          <h4>Servidor FiveM #1</h4>
          <p class="status-online">🟢 Online</p>
          <p style="font-size:13px;color:var(--texto2)">Plano: 1 Hora</p>
          <p style="font-size:13px;color:var(--texto2)">IP: 123.123.123.123:30120</p>
          <p style="font-size:13px;color:var(--texto2)">Expira em: 58 minutos</p>
          <button class="btn-conectar">Conectar</button>
          <button class="btn-gerenciar">Gerenciar</button>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:15px">Status do FiveM</h3>
        <p style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--destaque)">
          <span>Jogadores online</span><span style="color:var(--verde);font-weight:bold">24 / 128</span>
        </p>
        <p style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--destaque)">
          <span>Uptime</span><span style="font-weight:bold">99.9%</span>
        </p>
        <p style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--destaque)">
          <span>Latência</span><span style="font-weight:bold">18 ms</span>
        </p>
        <p style="display:flex;justify-content:space-between;padding:8px 0">
          <span>Última atualização</span><span style="font-weight:bold">Agora</span>
        </p>
      </div>
    </div>

    <div class="botoes-acao">
      <button class="botao-acao roxo">🛒 Comprar servidor</button>
      <button class="botao-acao azul">🎮 FiveM na nuvem</button>
      <button class="botao-acao escuro">🎧 Suporte</button>
    </div>
  </main>

  <aside class="sidebar-right">
    <div class="conta-card">
      <h3 style="margin-bottom:15px">Minha conta</h3>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:15px">
        <div class="avatar-grande">${userName.charAt(0)}</div>
        <div><h4>${userName}</h4><p style="font-size:13px;color:var(--texto2)">Usuário</p></div>
      </div>
      <p style="margin:8px 0;color:var(--texto2)">✉️ ${userEmail}</p>
      <p style="margin:8px 0;color:var(--texto2)">⏱️ ${userMinutes} minutos disponíveis</p>
      <p style="margin:8px 0;color:var(--texto2)">📅 Membro desde: 26/09/2026</p>
      <button class="btn-minutos">👑 Comprar mais minutos</button>
    </div>
    <div class="conta-card">
      <h3 style="margin-bottom:15px">Acesso rápido</h3>
      <a href="#" class="acesso-item">🛒 Comprar servidor</a>
      <a href="#" class="acesso-item">📋 Meus pedidos</a>
      <a href="#" class="acesso-item">🎮 FiveM</a>
      <a href="#" class="acesso-item">💬 Suporte</a>
    </div>
  </aside>
</div>
`}

<script>
async function fazerLogin() {
  const login = document.getElementById('campo-login').value;
  const senha = document.getElementById('campo-senha').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: login, username: login, password: senha })
  });
  if (res.ok) {
    alert('✅ Login realizado!');
    location.reload();
  } else {
    alert('❌ Usuário ou senha incorretos!');
  }
}

async function fazerLogout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}
</script>
</body>
</html>`;

    return sendHtml(res, html);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Página não encontrada.');
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 Império GameCloud rodando!');
  console.log('👉 Acesse: http://localhost:' + PORT);
  console.log('👤 Usuário: miguell003 | Senha: 12345678');
  console.log('========================================');
});

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);

const ADMIN_USER = String(process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const STREAM_AGENT_KEY = String(process.env.STREAM_AGENT_KEY || '');
const USER_PASSWORD = String(process.env.USER_PASSWORD || '12345678');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL = 1000 * 60 * 30;
const DATA_FILE = path.join(__dirname, 'data', 'gamecloud.json');

const defaultPackages = [
  { id: 'basico', name: 'Básico', priceCents: 1000, ram: 4, vcpu: 2, gpu: 'GPU básica', storage: 50, description: 'Uma base leve para começar no FiveM.' },
  { id: 'intermediario', name: 'Intermediário', priceCents: 2000, ram: 8, vcpu: 4, gpu: 'GPU melhor', storage: 100, description: 'Mais espaço para seu servidor crescer.' },
  { id: 'avancado', name: 'Avançado', priceCents: 3000, ram: 16, vcpu: 6, gpu: 'GPU avançada', storage: 200, description: 'Desempenho para comunidades maiores.' },
  { id: 'premium', name: 'Premium', priceCents: 5000, ram: 32, vcpu: 8, gpu: 'GPU mais potente', storage: 400, description: 'A configuração mais completa do catálogo.' }
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
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ users, servers, packages, orders, tickets, minutesRateCents }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
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
  return user.password === password;
}

const sessions = new Map();
const resetTokens = new Map();

readDatabase();
const seedPassword = passwordFields(USER_PASSWORD);
if (!users) {
  users = [{
    id: 1, name: 'Miguel Silva', username: 'miguell003', email: 'ewerton3220@gmail.com',
    ...seedPassword, minutes: 366, createdAt: new Date().toISOString()
  }];
}

function createToken() { return crypto.randomBytes(32).toString('hex'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) reject(new Error('Muito grande.')); });
    req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('JSON inválido.')); } });
    req.on('error', reject);
  });
}

function getCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    try { c[k] = decodeURIComponent(v); } catch { c[k] = v; }
  });
  return c;
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function getSession(req) {
  const cookies = getCookies(req);
  const token = getBearerToken(req) || cookies.session || '';
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) sessions.delete(token);
    return null;
  }
  return session;
}

function getCurrentUser(req) {
  const session = getSession(req);
  if (!session || session.role !== 'player') return null;
  return users.find(u => u.id === session.userId) || null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', [
    'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
    'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  ]);
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, email: user.email, minutes: user.minutes, role: 'player' };
}

function findUserByEmail(email) {
  return users.find(u => u.email.toLowerCase() === String(email).trim().toLowerCase());
}

function findUserByLogin(value) {
  const login = String(value || '').trim().toLowerCase();
  return users.find(u => u.email.toLowerCase() === login || u.username.toLowerCase() === login);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function unauthorized(res) { sendJson(res, 401, { ok: false, error: 'Não autorizado.' }); }
function badRequest(res, msg) { sendJson(res, 400, { ok: false, error: msg || 'Requisição inválida.' }); }
function serverError(res, msg) { sendJson(res, 500, { ok: false, error: msg || 'Erro interno.' }); }

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end();
    return;
  }

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'Império GameCloud', version: '4.2.0' });
  }

  if (method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readBody(req);
      const loginValue = String(body.email || body.username || '').trim();
      const password = String(body.password || '');
      const user = findUserByLogin(loginValue);
      if (!user || !passwordMatches(user, password)) {
        return sendJson(res, 401, { ok: false, error: 'Usuário ou senha incorretos.' });
      }
      const token = createToken();
      sessions.set(token, { role: 'player', userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL });
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, token, user: publicUser(user) });
    } catch (e) { return serverError(res); }
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = getCurrentUser(req);
    if (!user) return unauthorized(res);
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    const cookies = getCookies(req);
    if (cookies.session) sessions.delete(cookies.session);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/packages') {
    return sendJson(res, 200, { ok: true, packages: packages.map(p => ({ ...p })), minutesRateCents });
  }

  if (method === 'GET' && pathname === '/api/servers') {
    const user = getCurrentUser(req);
    if (!user) return unauthorized(res);
    return sendJson(res, 200, { ok: true, servers: servers.filter(s => s.userId === user.id) });
  }

  if (method === 'GET' && pathname === '/api/orders') {
    const user = getCurrentUser(req);
    if (!user) return unauthorized(res);
    return sendJson(res, 200, { ok: true, orders: orders.filter(o => o.userId === user.id) });
  }

  // === PÁGINA PRINCIPAL — PAINEL ===
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const user = getCurrentUser(req);
    const userName = user ? user.name : 'Visitante';
    const userMinutes = user ? user.minutes : 0;

    return sendHtml(res, `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Império GameCloud v4 — FiveM na Nuvem</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
    :root { --prim: #7b2cbf; --escuro: #0f111a; --meio: #1a1c2e; --claro: #2a2d3e; --texto: #e0e0e0; }
    body { background: var(--escuro); color: var(--texto); min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 15px; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--claro); }
    .search { background: var(--meio); padding: 8px 15px; border-radius: 6px; width: 260px; border: none; color: #fff; font-size: 14px; }
    .user-header { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 38px; height: 38px; background: var(--prim); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 200px 1fr 210px; gap: 15px; margin-top: 15px; }
    .menu-lateral { display: flex; flex-direction: column; gap: 6px; }
    .menu-lateral a { color: #aaa; text-decoration: none; padding: 11px 14px; border-radius: 6px; transition: 0.2s; }
    .menu-lateral a:hover, .menu-lateral a.ativo { background: var(--claro); color: #fff; font-weight: 600; }
    .banner { background: linear-gradient(135deg, #1e2035, #2d1b47); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 15px; }
    .banner h1 { font-size: 26px; margin-bottom: 5px; }
    .banner p { color: #b8b8b8; }
    .status-row { display: flex; gap: 18px; margin: 10px 0; flex-wrap: wrap; }
    .status-item { background: var(--meio); padding: 8px 14px; border-radius: 20px; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
    .card { background: var(--meio); padding: 22px; border-radius: 10px; }
    .card h3 { margin-bottom: 12px; font-size: 17px; }
    .card p { margin: 6px 0; color: #bbb; }
    .btn { background: var(--prim); color: #fff; border: none; padding: 11px 16px; border-radius: 6px; cursor: pointer; font-size: 15px; transition: 0.2s; }
    .btn:hover { background: #9d4edd; }
    .botoes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
    .sidebar-dir { background: var(--meio); border-radius: 10px; padding: 18px; height: fit-content; }
    .sidebar-dir h3 { margin-bottom: 15px; font-size: 16px; }
    .avatar-grande { width: 70px; height: 70px; background: var(--prim); border-radius: 50%; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; }
    .sidebar-dir p.nome { text-align: center; margin-bottom: 18px; font-weight: 600; }
    .sidebar-dir a { display: block; padding: 10px 0; color: #bbb; text-decoration: none; border-bottom: 1px solid var(--claro); }
    .sidebar-dir a:hover { color: #fff; }
    .acesso-rapido { margin-top: 15px; font-weight: bold; color: #fff; }
    .login-box { max-width: 420px; margin: 60px auto; background: var(--meio); padding: 30px; border-radius: 12px; }
    .login-box h2 { text-align: center; margin-bottom: 25px; }
    .login-box input { width: 100%; padding: 12px; margin: 8px 0; background: var(--escuro); border: 1px solid var(--claro); color: #fff; border-radius: 6px; font-size: 15px; }
    .login-box button { width: 100%; margin-top: 10px; }
    .oculto { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <div id="tela-login" class="login-box">
      <h2>🔐 Entrar — Império GameCloud</h2>
      <input type="text" id="campo-login" placeholder="E-mail ou usuário">
      <input type="password" id="campo-senha" placeholder="Senha">
      <button class="btn" onclick="fazerLogin()">Entrar</button>
      <p style="text-align:center; margin-top:15px; color:#888; font-size:13px;">Usuário: miguell003 | Senha: 12345678</p>
    </div>

    <div id="painel" class="oculto">
      <div class="top-bar">
        <input type="text" class="search" placeholder="🔍 Buscar...">
        <div class="user-header">
          <span id="nome-usuario-cabecalho">${userName}</span>
          <div class="avatar">${userName.charAt(0).toUpperCase()}</div>
          <button class="btn" style="padding:6px 12px; font-size:13px;" onclick="fazerLogout()">Sair</button>
        </div>
      </div>

      <div class="grid">
        <nav class="menu-lateral">
          <a href="#" class="ativo">INÍCIO</a>
          <a href="#">Servidores</a>
          <a href="#">Comprar</a>
          <a href="#">Carrinho</a>
          <a href="#">Pagamento</a>
          <a href="#">FiveM</a>
          <a href="#">Pedidos</a>
          <a href="#">Perfil</a>
          <a href="#">Configurações</a>
          <a href="#">Suporte</a>
        </nav>

        <main>
          <div class="banner">
            <h1>IMPÉRIO GAMECLOUD</h1>
            <p>FiveM na Nuvem — Hospedagem de qualidade</p>
          </div>

          <div class="status-row">
            <span class="status-item">⏱️ ${userMinutes} min restantes</span>
            <span class="status-item">🗄️ 1 servidor</span>
            <span class="status-item">🛒 2 pedidos</span>
            <span class="status-item">🎮 FiveM</span>
          </div>

          <div class="cards">
            <div class="card">
              <h3>Seus Servidores</h3>
              <p style="font-size:18px; font-weight:bold;">Servidor #1</p>
              <p style="color:#4ade80;">✅ Online</p>
              <button class="btn" style="margin-top:10px; width:100%;">Conectar / Gerenciar</button>
            </div>
            <div class="card">
              <h3>Status FiveM</h3>
              <p style="font-size:18px; font-weight:bold;">👥 24 / 128 jogadores</p>
              <p>Uptime: <span style="color:#4ade80; font-weight:bold;">99.9%</span></p>
            </div>
          </div>

          <div class="botoes">
            <button class="btn">Comprar Servidor</button>
            <button class="btn">FiveM na Nuvem</button>
            <button class="btn">Suporte</button>
          </div>
        </main>

        <aside class="sidebar-dir">
          <h3>MINHA CONTA</h3>
          <div class="avatar-grande" id="inicial-usuario">${userName.charAt(0).toUpperCase()}</div>
          <p class="nome" id="nome-usuario">${userName}</p>
          <a href="#">Dados</a>
          <a href="#">Comprar</a>
          <p class="acesso-rapido">ACESSO RÁPIDO</p>
        </aside>
      </div>
    </div>
  </div>

  <script>
    async function verificarSessao() {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const dados = await res.json();
          document.getElementById('tela-login').classList.add('oculto');
          document.getElementById('painel').classList.remove('oculto');
          if (dados.user) {
            document.getElementById('nome-usuario-cabecalho').textContent = dados.user.name;
            document.getElementById('nome-usuario').textContent = dados.user.name;
            document.getElementById('inicial-usuario').textContent = dados.user.name.charAt(0).toUpperCase();
          }
        }
      } catch {}
    }

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
        verificarSessao();
      } else {
        alert('❌ Usuário ou senha incorretos!');
      }
    }

    async function fazerLogout() {
      await fetch('/api/logout', { method: 'POST' });
      location.reload();
    }

    verificarSessao();
  </script>
</body>
</html>`);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Página não encontrada.');
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log(`🚀 Império GameCloud rodando!`);
  console.log(`👉 Acesse: http://localhost:${PORT}`);
  console.log(`👤 Usuário: miguell003 | Senha: 12345678`);
  console.log('========================================');
});

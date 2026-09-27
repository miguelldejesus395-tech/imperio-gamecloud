'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);

const ADMIN_USER = String(process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const STREAM_AGENT_KEY = String(process.env.STREAM_AGENT_KEY || '');
const USER_PASSWORD = String(process.env.USER_PASSWORD || '');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL = 1000 * 60 * 30;
const DATA_FILE = path.join(__dirname, 'data', 'gamecloud.json');

const defaultPackages = [
  { id: 'basico', name: 'Básico', priceCents: 1000, ram: 4, vcpu: 2, gpu: 'GPU básica', storage: 50, description: 'Uma base leve para começar no FiveM.' },
  { id: 'intermediario', name: 'Intermediário', priceCents: 2000, ram: 8, vcpu: 4, gpu: 'GPU melhor', storage: 100, description: 'Mais espaço para seu servidor crescer.' },
  { id: 'avancado', name: 'Avançado', priceCents: 3000, ram: 16, vcpu: 6, gpu: 'GPU avançada', storage: 200, description: 'Desempenho para comunidades maiores.' },
  { id: 'premium', name: 'Premium', priceCents: 5000, ram: 32, vcpu: 8, gpu: 'GPU mais potente', storage: 400, description: 'A configuração mais completa do catálogo.' }
];

function readDatabase() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : null,
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      packages: Array.isArray(parsed.packages) && parsed.packages.length ? parsed.packages : defaultPackages,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      minutesRateCents: Number.isSafeInteger(parsed.minutesRateCents) ? parsed.minutesRateCents : 10
    };
  } catch (error) {
    return { users: null, servers: [], packages: defaultPackages, orders: [], tickets: [], minutesRateCents: 10 };
  }
}

const database = readDatabase();
function saveDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({
    users, servers, packages, orders, tickets, minutesRateCents: database.minutesRateCents
  }, null, 2), { mode: 0o600 });
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
const agentCommands = [];

const seedPassword = passwordFields(USER_PASSWORD);
const users = database.users || [
  {
    id: 1,
    name: 'miguell003',
    username: 'miguell003',
    email: 'ewerton3220@gmail.com',
    ...seedPassword,
    minutes: 366,
    createdAt: new Date().toISOString()
  }
];
const servers = database.servers;
const packages = database.packages;
const orders = database.orders;
const tickets = database.tickets;

const streaming = {
  enabled: true,
  status: 'offline',
  game: 'FiveM',
  host: 'PC-GAMECLOUD',
  lastHeartbeat: null,
  message: 'Aguardando o PC de streaming.'
};

function json(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Stream-Agent-Key',
    'Access-Control-Allow-Methods':
      'GET, POST, OPTIONS'
  });

  res.end(JSON.stringify(data));
}

function text(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(message);
}

function unauthorized(res) {
  json(res, 401, {
    ok: false,
    error: 'Não autorizado.'
  });
}

function badRequest(res, message) {
  json(res, 400, {
    ok: false,
    error: message || 'Requisição inválida.'
  });
}

function notFound(res) {
  json(res, 404, {
    ok: false,
    error: 'Rota não encontrada.'
  });
}

function serverError(res, message) {
  json(res, 500, {
    ok: false,
    error: message || 'Erro interno do servidor.'
  });
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Corpo da requisição muito grande.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function getCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};

  header.split(';').forEach((part) => {
    const index = part.indexOf('=');

    if (index === -1) {
      return;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return '';
  }

  return authorization.slice(7).trim();
}

function getSession(req) {
  const cookies = getCookies(req);

  const cookieToken = cookies.session || '';
  const bearerToken = getBearerToken(req);

  const token = bearerToken || cookieToken;

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function getCurrentUser(req) {
  const session = getSession(req);

  if (!session || session.role !== 'player') {
    return null;
  }

  return (
    users.find((user) => user.id === session.userId) ||
    null
  );
}

function getAdminSession(req) {
  const cookies = getCookies(req);
  const cookieToken = cookies.admin_session || '';
  const bearerToken = getBearerToken(req);

  const token = bearerToken || cookieToken;

  if (!token) {
    return null;
  }

  const session = sessions.get(`admin:${token}`);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(`admin:${token}`);
    return null;
  }

  return session;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
      SESSION_TTL / 1000
    )}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    [
      'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
      'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
    ]
  );
}

function agentAuthorized(req) {
  if (!STREAM_AGENT_KEY) {
    return false;
  }

  const key = req.headers['x-stream-agent-key'];

  return Boolean(key && key === STREAM_AGENT_KEY);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    minutes: user.minutes,
    role: 'player'
  };
}

function findUserByEmail(email) {
  return users.find(
    (user) =>
      user.email.toLowerCase() ===
      String(email).trim().toLowerCase()
  );
}

function findUserByLogin(value) {
  const login = String(value || '').trim().toLowerCase();

  return users.find(
    (user) =>
      user.email.toLowerCase() === login ||
      user.username.toLowerCase() === login
  );
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Stream-Agent-Key',
      'Access-Control-Allow-Methods':
        'GET, POST, OPTIONS'
    });

    res.end();
    return;
  }

  if (method === 'GET' && pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      service: 'Império GameCloud',
      version: '4.2.0'
    });
    return;
  }

  /*
   * LOGIN DO JOGADOR
   */
  if (method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readBody(req);

      const loginValue = String(
        body.email ||
        body.username ||
        ''
      ).trim();

      const password = String(
        body.password || ''
      );

      const user = findUserByLogin(loginValue);

      if (!user || !passwordMatches(user, password)) {
        json(res, 401, {
          ok: false,
          error: 'Usuário, e-mail ou senha incorretos.'
        });
        return;
      }

      const token = createToken();

      sessions.set(token, {
        role: 'player',
        userId: user.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
      });

      setSessionCookie(res, token);

      json(res, 200, {
        ok: true,
        token: token,
        role: 'player',
        user: publicUser(user)
      });

      return;
    } catch (error) {
      console.error('Erro no login:', error);
      serverError(res, 'Erro ao realizar login.');
      return;
    }
  }

  /*
   * LOGIN DO ADMINISTRADOR
   */
  if (
    method === 'POST' &&
    pathname === '/api/admin/login'
  ) {
    try {
      const body = await readBody(req);

      const username = String(
        body.username || ''
      ).trim();

      const password = String(
        body.password || ''
      );

      if (
        username !== ADMIN_USER ||
        password !== ADMIN_PASSWORD
      ) {
        json(res, 401, {
          ok: false,
          error: 'Login de administrador inválido.'
        });
        return;
      }

      const token = createToken();

      sessions.set(`admin:${token}`, {
        role: 'admin',
        admin: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
      });

      res.setHeader(
        'Set-Cookie',
        `admin_session=${encodeURIComponent(
          token
        )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
          SESSION_TTL / 1000
        )}`
      );

      json(res, 200, {
        ok: true,
        token: token,
        role: 'admin',
        user: {
          role: 'admin',
          name: 'Administrador',
          username: ADMIN_USER
        }
      });

      return;
    } catch (error) {
      console.error('Erro no login admin:', error);
      serverError(
        res,
        'Erro no login administrativo.'
      );
      return;
    }
  }

  /*
   * CADASTRO DE JOGADOR
   */
  if (
    method === 'POST' &&
    pathname === '/api/users/register'
  ) {
    try {
      const body = await readBody(req);

      const name = String(
        body.name || ''
      ).trim();

      const email = String(
        body.email || ''
      ).trim().toLowerCase();

      const password = String(
        body.password || ''
      );

      if (!name || !email || !password) {
        badRequest(
          res,
          'Preencha todos os campos.'
        );
        return;
      }

      if (password.length < 8) {
        badRequest(
          res,
          'A senha precisa ter pelo menos 8 caracteres.'
        );
        return;
      }

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        badRequest(
          res,
          'Informe um e-mail válido.'
        );
        return;
      }

      if (email === ADMIN_USER.toLowerCase()) {
        badRequest(
          res,
          'Esse e-mail é reservado para o administrador.'
        );
        return;
      }

      if (findUserByEmail(email)) {
        json(res, 409, {
          ok: false,
          error: 'Este e-mail já está cadastrado.'
        });
        return;
      }

      const usernameBase =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 20) ||
        'jogador';

      let username = usernameBase;
      let number = 1;

      while (
        users.some(
          (user) =>
            user.username.toLowerCase() ===
            username.toLowerCase()
        )
      ) {
        username =
          usernameBase + number;
        number++;
      }

      const user = {
        id:
          users.length > 0
            ? Math.max(
                ...users.map((item) => item.id)
              ) + 1
            : 1,
        name: name,
        username: username,
        email: email,
        ...passwordFields(password),
        minutes: 0,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      saveDatabase();

      console.log(
        `Novo jogador cadastrado: ${email}`
      );

      json(res, 201, {
        ok: true,
        message:
          'Conta criada com sucesso. Agora faça login.',
        user: publicUser(user)
      });

      return;
    } catch (error) {
      console.error(
        'Erro no cadastro:',
        error
      );

      serverError(
        res,
        'Erro ao criar a conta.'
      );

      return;
    }
  }

  /*
   * DADOS DO USUÁRIO LOGADO
   */
  if (
    method === 'GET' &&
    pathname === '/api/me'
  ) {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      user: publicUser(user),
      role: 'player'
    });

    return;
  }

  /*
   * LOGOUT
   */
  if (
    method === 'POST' &&
    pathname === '/api/logout'
  ) {
    const bearerToken =
      getBearerToken(req);

    const cookies = getCookies(req);

    if (bearerToken) {
      sessions.delete(bearerToken);
    }

    if (cookies.session) {
      sessions.delete(cookies.session);
    }

    if (cookies.admin_session) {
      sessions.delete(
        `admin:${cookies.admin_session}`
      );
    }

    clearSessionCookie(res);

    json(res, 200, {
      ok: true
    });

    return;
  }

  /*
   * ESQUECI A SENHA
   */
  if (
    method === 'POST' &&
    pathname === '/api/forgot-password'
  ) {
    try {
      const body = await readBody(req);

      const email = String(
        body.email || ''
      ).trim().toLowerCase();

      const user = findUserByEmail(email);

      if (user) {
        const token = createToken();

        resetTokens.set(token, {
          userId: user.id,
          expiresAt:
            Date.now() + RESET_TTL
        });

        console.log(
          '================================'
        );
        console.log(
          'TOKEN DE RECUPERAÇÃO DE SENHA'
        );
        console.log(
          `E-mail: ${user.email}`
        );
        console.log(
          `Token: ${token}`
        );
        console.log(
          `Link: ?reset=${token}`
        );
        console.log(
          '================================'
        );
      }

      json(res, 200, {
        ok: true,
        message:
          'Se o e-mail estiver cadastrado, as instruções de recuperação foram geradas.'
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao processar recuperação de senha.'
      );
      return;
    }
  }

  /*
   * REDEFINIR SENHA
   */
  if (
    method === 'POST' &&
    pathname === '/api/reset-password'
  ) {
    try {
      const body = await readBody(req);

      const token = String(
        body.token || ''
      ).trim();

      const password = String(
        body.password || ''
      );

      if (!token || !password) {
        badRequest(
          res,
          'Token e nova senha são obrigatórios.'
        );
        return;
      }

      if (password.length < 8) {
        badRequest(
          res,
          'A nova senha precisa ter pelo menos 8 caracteres.'
        );
        return;
      }

      const reset =
        resetTokens.get(token);

      if (!reset) {
        json(res, 400, {
          ok: false,
          error:
            'Token inválido ou expirado.'
        });
        return;
      }

      if (
        Date.now() >
        reset.expiresAt
      ) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Token expirado.'
        });

        return;
      }

      const user = users.find(
        (item) =>
          item.id === reset.userId
      );

      if (!user) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Usuário não encontrado.'
        });

        return;
      }

      Object.assign(user, passwordFields(password));
      delete user.password;
      saveDatabase();

      resetTokens.delete(token);

      json(res, 200, {
        ok: true,
        message:
          'Senha alterada com sucesso.'
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao redefinir senha.'
      );
      return;
    }
  }

  // Catálogo público, com valores definidos no servidor.
  if (method === 'GET' && pathname === '/api/packages') {
    json(res, 200, { ok: true, packages: packages.map((item) => ({ ...item })), minutesRateCents: database.minutesRateCents });
    return;
  }

  if (method === 'GET' && pathname === '/api/servers') {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    json(res, 200, { ok: true, servers: servers.filter((item) => item.userId === user.id) });
    return;
  }

  if (method === 'GET' && pathname === '/api/orders') {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    json(res, 200, { ok: true, orders: orders.filter((item) => item.userId === user.id) });
    return;
  }

  if (pathname === '/api/support' && (method === 'GET' || method === 'POST')) {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    if (method === 'GET') { json(res, 200, { ok: true, tickets: tickets.filter((item) => item.userId === user.id) }); return; }
    try {
      const body = await readBody(req);
      const subject = String(body.subject || '').trim();
      const content = String(body.message || '').trim();
      if (subject.length < 3 || subject.length > 100 || content.length < 10 || content.length > 2000) { badRequest(res, 'Informe um assunto de 3 a 100 caracteres e uma mensagem de 10 a 2000 caracteres.'); return; }
      const ticket = { id: crypto.randomUUID(), userId: user.id, userName: user.name, email: user.email, subject, message: content, status: 'ABERTO', createdAt: new Date().toISOString() };
      tickets.unshift(ticket); saveDatabase(); json(res, 201, { ok: true, ticket }); return;
    } catch (error) { serverError(res, 'Não foi possível registrar o chamado.'); return; }
  }

  if (method === 'POST' && pathname === '/api/orders') {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    try {
      const body = await readBody(req);
      const packageId = body.packageId ? String(body.packageId) : '';
      const minutes = Number(body.minutes || 0);
      if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 50000 || (!packageId && minutes === 0)) {
        badRequest(res, 'Escolha um pacote e/ou uma quantidade válida de minutos.'); return;
      }
      const selectedPackage = packageId ? packages.find((item) => item.id === packageId) : null;
      if (packageId && !selectedPackage) { badRequest(res, 'Pacote indisponível. Atualize o catálogo e tente novamente.'); return; }
      const totalCents = (selectedPackage ? selectedPackage.priceCents : 0) + minutes * database.minutesRateCents;
      const order = {
        id: crypto.randomUUID(), userId: user.id, packageId: selectedPackage ? selectedPackage.id : null,
        packageName: selectedPackage ? selectedPackage.name : null,
        minutes, packagePriceCents: selectedPackage ? selectedPackage.priceCents : 0,
        minutesPriceCents: minutes * database.minutesRateCents, totalCents,
        status: 'PENDENTE', createdAt: new Date().toISOString(),
        paymentMessage: 'Pagamento pendente: não há gateway de pagamento configurado. Aguarde a aprovação manual do administrador.'
      };
      orders.unshift(order);
      saveDatabase();
      json(res, 201, { ok: true, order });
      return;
    } catch (error) { serverError(res, 'Não foi possível registrar o pedido.'); return; }
  }

  if (method === 'POST' && pathname === '/api/me/profile') {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    try {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (name.length < 2 || name.length > 60) { badRequest(res, 'O nome deve ter entre 2 e 60 caracteres.'); return; }
      user.name = name;
      saveDatabase();
      json(res, 200, { ok: true, user: publicUser(user) });
      return;
    } catch (error) { serverError(res, 'Não foi possível salvar o perfil.'); return; }
  }

  // Endpoints administrativos: todas as operações exigem sessão admin.
  if (pathname.startsWith('/api/admin/servers') || pathname.startsWith('/api/admin/orders') || pathname.startsWith('/api/admin/packages') || pathname === '/api/admin/minutes-price' || pathname === '/api/admin/support') {
    const admin = getAdminSession(req);
    if (!admin) { unauthorized(res); return; }

    if (method === 'GET' && pathname === '/api/admin/servers') {
      json(res, 200, { ok: true, servers: servers.map((item) => ({ ...item, userName: (users.find((user) => user.id === item.userId) || {}).name || 'Sem vínculo' })) }); return;
    }
    if (method === 'GET' && pathname === '/api/admin/orders') {
      json(res, 200, { ok: true, orders: orders.map((item) => ({ ...item, userName: (users.find((user) => user.id === item.userId) || {}).name || 'Usuário removido' })) }); return;
    }
    if (method === 'GET' && pathname === '/api/admin/packages') {
      json(res, 200, { ok: true, packages: packages.map((item) => ({ ...item })), minutesRateCents: database.minutesRateCents }); return;
    }

    if (method === 'POST' && pathname === '/api/admin/servers') {
      try {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        const type = String(body.type || '').trim();
        const userId = body.userId === '' || body.userId === null ? null : Number(body.userId);
        const ram = Number(body.ram), vcpu = Number(body.vcpu), storage = Number(body.storage);
        const gpu = String(body.gpu || '').trim();
        const status = String(body.status || 'offline');
        if (!name || name.length > 80 || !type || type.length > 40 || !Number.isSafeInteger(ram) || ram < 1 || ram > 512 || !Number.isSafeInteger(vcpu) || vcpu < 1 || vcpu > 128 || !Number.isSafeInteger(storage) || storage < 1 || storage > 10000 || !gpu || gpu.length > 100 || !['offline', 'online', 'provisioning', 'error'].includes(status)) {
          badRequest(res, 'Revise nome, tipo e especificações do servidor.'); return;
        }
        if (userId !== null && !users.some((item) => item.id === userId)) { badRequest(res, 'Usuário vinculado não encontrado.'); return; }
        const serverId = body.id ? String(body.id) : crypto.randomUUID();
        const existing = servers.findIndex((item) => item.id === serverId);
        const entry = { id: serverId, name, type, userId, ram, vcpu, gpu, storage, status, updatedAt: new Date().toISOString() };
        if (existing >= 0) servers[existing] = { ...servers[existing], ...entry };
        else { entry.createdAt = entry.updatedAt; servers.push(entry); }
        saveDatabase();
        json(res, existing >= 0 ? 200 : 201, { ok: true, server: entry });
        return;
      } catch (error) { serverError(res, 'Não foi possível salvar o servidor.'); return; }
    }

    if (method === 'GET' && pathname === '/api/admin/support') {
      json(res, 200, { ok: true, tickets: tickets.map((item) => ({ ...item })) }); return;
    }

    const deleteServer = pathname.match(/^\/api\/admin\/servers\/([^/]+)\/delete$/);
    if (method === 'POST' && deleteServer) {
      const index = servers.findIndex((item) => item.id === decodeURIComponent(deleteServer[1]));
      if (index < 0) { notFound(res); return; }
      servers.splice(index, 1); saveDatabase(); json(res, 200, { ok: true }); return;
    }

    const lifecycle = pathname.match(/^\/api\/admin\/servers\/([^/]+)\/(start|stop)$/);
    if (method === 'POST' && lifecycle) {
      const item = servers.find((serverItem) => serverItem.id === decodeURIComponent(lifecycle[1]));
      if (!item) { notFound(res); return; }
      json(res, 409, { ok: false, error: 'Controle de energia indisponível: não há agente de infraestrutura de servidores conectado. O status real não foi alterado.' }); return;
    }

    if (method === 'POST' && pathname === '/api/admin/packages') {
      try {
        const body = await readBody(req);
        const packageId = String(body.id || '');
        const priceCents = Number(body.priceCents);
        const item = packages.find((catalogItem) => catalogItem.id === packageId);
        if (!item || !Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 100000000) { badRequest(res, 'Pacote ou preço inválido.'); return; }
        item.priceCents = priceCents; saveDatabase(); json(res, 200, { ok: true, packages }); return;
      } catch (error) { serverError(res, 'Não foi possível salvar o catálogo.'); return; }
    }

    if (method === 'POST' && pathname === '/api/admin/minutes-price') {
      try {
        const body = await readBody(req);
        const cents = Number(body.priceCents);
        if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000) { badRequest(res, 'Informe um valor por minuto válido.'); return; }
        database.minutesRateCents = cents; saveDatabase(); json(res, 200, { ok: true, minutesRateCents: cents }); return;
      } catch (error) { serverError(res, 'Não foi possível salvar o preço dos minutos.'); return; }
    }

    const approve = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/approve$/);
    if (method === 'POST' && approve) {
      const order = orders.find((item) => item.id === decodeURIComponent(approve[1]));
      if (!order) { notFound(res); return; }
      if (order.status === 'PENDENTE') {
        const user = users.find((item) => item.id === order.userId);
        if (!user) { json(res, 409, { ok: false, error: 'O usuário deste pedido não existe mais.' }); return; }
        user.minutes = Number(user.minutes || 0) + order.minutes;
        if (order.packageId) {
          const item = packages.find((catalogItem) => catalogItem.id === order.packageId);
          if (item) servers.push({ id: crypto.randomUUID(), name: `${item.name} • FiveM`, type: 'FiveM RP', userId: user.id, ram: item.ram, vcpu: item.vcpu, gpu: item.gpu, storage: item.storage, status: 'offline', createdAt: new Date().toISOString() });
        }
        order.status = 'APROVADO'; order.approvedAt = new Date().toISOString();
        order.paymentMessage = 'Aprovado manualmente pelo administrador.';
        saveDatabase();
      }
      json(res, 200, { ok: true, order }); return;
    }

    notFound(res); return;
  }

  /*
   * STATUS DO STREAMING
   */
  if (
    method === 'GET' &&
    pathname === '/api/stream/status'
  ) {
    json(res, 200, {
      ok: true,
      streaming: streaming
    });

    return;
  }

  /*
   * JOGADOR PEDE PARA INICIAR FIVE M
   */
  if (
    method === 'POST' &&
    pathname === '/api/stream/start'
  ) {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    if (!streaming.enabled) {
      json(res, 400, {
        ok: false,
        error:
          'O streaming está desativado pelo administrador.'
      });

      return;
    }

    if (
      streaming.status !== 'online' ||
      !streaming.lastHeartbeat ||
      Date.now() - new Date(streaming.lastHeartbeat).getTime() > 90000
    ) {
      json(res, 400, {
        ok: false,
        error:
          'O PC de streaming está offline.'
      });

      return;
    }

    if (user.minutes <= 0) {
      json(res, 400, {
        ok: false,
        error:
          'Você não possui tempo disponível.'
      });

      return;
    }

    agentCommands.push({
      command: 'start_fivem',
      createdAt: Date.now(),
      userId: user.id
    });

    streaming.status = 'starting';
    streaming.message =
      'Iniciando FiveM...';

    json(res, 200, {
      ok: true,
      message:
        'Comando para iniciar o FiveM enviado ao PC de streaming.'
    });

    return;
  }

  /*
   * PAINEL ADMIN
   */
  if (
    method === 'GET' &&
    pathname === '/api/admin/overview'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        minutes: user.minutes,
        online: false
      })),
      streaming: streaming,
      servers: servers.map((item) => ({ ...item, userName: (users.find((user) => user.id === item.userId) || {}).name || 'Sem vínculo' })),
      orders: orders.map((item) => ({ ...item, userName: (users.find((user) => user.id === item.userId) || {}).name || 'Usuário removido' })),
      tickets: tickets.map((item) => ({ ...item })),
      packages: packages.map((item) => ({ ...item })),
      minutesRateCents: database.minutesRateCents
    });

    return;
  }

  /*
   * ADMIN STATUS
   */
  if (
    method === 'GET' &&
    pathname === '/api/admin/stream'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      streaming: streaming
    });

    return;
  }

  /*
   * ADMIN INICIA FIVE M
   */
  if (
    method === 'POST' &&
    pathname === '/api/admin/stream/start'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    if (
      streaming.status !== 'online' ||
      !streaming.lastHeartbeat ||
      Date.now() - new Date(streaming.lastHeartbeat).getTime() > 90000
    ) {
      json(res, 409, { ok: false, error: 'O agente GameCloud não está conectado. Nenhum comando foi enviado e o status real não foi alterado.' });
      return;
    }

    agentCommands.push({
      command: 'start_fivem',
      createdAt: Date.now(),
      userId: null
    });

    streaming.status = 'starting';
    streaming.message =
      'Administrador solicitou o início do FiveM.';

    json(res, 200, {
      ok: true,
      message:
        'Comando para iniciar o FiveM enviado ao PC.'
    });

    return;
  }

  /*
   * ADMIN PARA FIVE M
   */
  if (
    method === 'POST' &&
    pathname === '/api/admin/stream/stop'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    if (
      streaming.status !== 'online' ||
      !streaming.lastHeartbeat ||
      Date.now() - new Date(streaming.lastHeartbeat).getTime() > 90000
    ) {
      json(res, 409, { ok: false, error: 'O agente GameCloud não está conectado. Nenhum comando foi enviado e o status real não foi alterado.' });
      return;
    }

    agentCommands.push({
      command: 'stop_fivem',
      createdAt: Date.now(),
      userId: null
    });

    streaming.status = 'stopping';
    streaming.message =
      'Administrador solicitou o encerramento do FiveM.';

    json(res, 200, {
      ok: true,
      message:
        'Comando para encerrar o FiveM enviado ao PC.'
    });

    return;
  }

  /*
   * ADMIN ATIVA/DESATIVA STREAMING
   */
  if (
    method === 'POST' &&
    pathname === '/api/admin/stream/toggle'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    try {
      const body =
        await readBody(req);

      if (
        typeof body.enabled !==
        'boolean'
      ) {
        badRequest(
          res,
          'Informe enabled como verdadeiro ou falso.'
        );

        return;
      }

      streaming.enabled =
        body.enabled;

      if (!streaming.enabled) {
        streaming.message =
          'Streaming desativado pelo administrador.';
      } else {
        streaming.message =
          'Streaming ativado pelo administrador.';
      }

      json(res, 200, {
        ok: true,
        message:
          streaming.enabled
            ? 'Streaming ativado.'
            : 'Streaming desativado.',
        streaming: streaming
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao alterar o streaming.'
      );

      return;
    }
  }

  /*
   * ADMIN ALTERA TEMPO DO JOGADOR
   */
  if (
    method === 'POST' &&
    pathname === '/api/admin/time/add'
  ) {
    const admin =
      getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    try {
      const body =
        await readBody(req);

      const email = String(
        body.email || ''
      ).trim().toLowerCase();

      const minutes = Number(
        body.minutes
      );

      if (!email) {
        badRequest(
          res,
          'Informe o e-mail do jogador.'
        );

        return;
      }

      if (
        !Number.isSafeInteger(minutes) ||
        minutes < 1 ||
        minutes > 100000
      ) {
        badRequest(
          res,
          'Informe de 1 a 100000 minutos.'
        );

        return;
      }

      const user =
        findUserByEmail(email);

      if (!user) {
        json(res, 404, {
          ok: false,
          error:
            'Jogador não encontrado.'
        });

        return;
      }

      user.minutes += minutes;
      saveDatabase();

      json(res, 200, {
        ok: true,
        message:
          'Tempo adicionado com sucesso.',
        user: publicUser(user)
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao adicionar tempo.'
      );

      return;
    }
  }

  /*
   * HEARTBEAT DO PC
   */
  if (
    method === 'POST' &&
    pathname === '/api/agent/heartbeat'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body =
        await readBody(req);

      streaming.status =
        body.status || 'online';

      streaming.game =
        body.game || 'FiveM';

      streaming.host =
        body.host ||
        'PC-GAMECLOUD';

      streaming.message =
        body.message ||
        'PC de streaming online.';

      streaming.lastHeartbeat =
        new Date().toISOString();

      json(res, 200, {
        ok: true,
        streaming: streaming
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro no heartbeat.'
      );

      return;
    }
  }

  /*
   * AGENTE BUSCA COMANDO
   */
  if (
    method === 'GET' &&
    pathname === '/api/agent/command'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    const command =
      agentCommands.shift() || null;

    if (command) {
      console.log(
        `Comando entregue ao agente: ${command.command}`
      );
    }

    json(res, 200, {
      ok: true,
      command: command
        ? command.command
        : null,
      message: command
        ? 'Comando disponível.'
        : 'Nenhum comando pendente.'
    });

    return;
  }

  /*
   * AGENTE ATUALIZA STATUS
   */
  if (
    method === 'POST' &&
    pathname === '/api/agent/status'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body =
        await readBody(req);

      streaming.status =
        body.status ||
        streaming.status;

      streaming.message =
        body.message ||
        streaming.message;

      streaming.host =
        body.host ||
        streaming.host;

      streaming.lastHeartbeat =
        new Date().toISOString();

      json(res, 200, {
        ok: true,
        streaming: streaming
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao atualizar status do agente.'
      );

      return;
    }
  }

  /*
   * STATUS DO AGENTE
   */
  if (
    method === 'GET' &&
    pathname === '/api/agent/status'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      streaming: streaming
    });

    return;
  }

  /*
   * AGENTE PODE COLOCAR COMANDO NA FILA
   */
  if (
    method === 'POST' &&
    pathname === '/api/agent/command'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body =
        await readBody(req);

      if (!body.command) {
        badRequest(
          res,
          'Comando não informado.'
        );

        return;
      }

      agentCommands.push({
        command: String(
          body.command
        ),
        createdAt: Date.now(),
        userId:
          body.userId || null
      });

      json(res, 200, {
        ok: true,
        message:
          'Comando adicionado à fila.'
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao adicionar comando.'
      );

      return;
    }
  }

  /*
   * ARQUIVOS DO SITE
   */
  let filePath;

  if (pathname === '/') {
    filePath = path.join(
      __dirname,
      'index.html'
    );
  } else {
    filePath = path.join(
      __dirname,
      pathname.replace(/^\/+/, '')
    );
  }

  const projectRoot =
    path.resolve(__dirname);

  const resolvedFile =
    path.resolve(filePath);

  const publicFiles = new Set([
    'index.html', 'app.js', 'imperio-abertura.png',
    'imperio-admin.png', 'imperio-usuario.png'
  ]);
  const relativeFile = path.relative(projectRoot, resolvedFile).replace(/\\/g, '/');

  if (
    resolvedFile !== projectRoot &&
    !resolvedFile.startsWith(
      projectRoot + path.sep
    )
  ) {
    notFound(res);
    return;
  }

  if (!publicFiles.has(relativeFile)) {
    notFound(res);
    return;
  }

  if (resolvedFile === DATA_FILE || resolvedFile.startsWith(path.dirname(DATA_FILE) + path.sep) || path.basename(resolvedFile) === 'gamecloud.json') {
    notFound(res);
    return;
  }

  fs.stat(
    resolvedFile,
    (error, stats) => {
      if (
        error ||
        !stats.isFile()
      ) {
        notFound(res);
        return;
      }

      const ext =
        path.extname(
          resolvedFile
        ).toLowerCase();

      const contentTypes = {
        '.html':
          'text/html; charset=utf-8',

        '.js':
          'application/javascript; charset=utf-8',

        '.css':
          'text/css; charset=utf-8',

        '.json':
          'application/json; charset=utf-8',

        '.png':
          'image/png',

        '.jpg':
          'image/jpeg',

        '.jpeg':
          'image/jpeg',

        '.svg':
          'image/svg+xml',

        '.ico':
          'image/x-icon'
      };

      const contentType =
        contentTypes[ext] ||
        'application/octet-stream';

      fs.readFile(
        resolvedFile,
        (readError, data) => {
          if (readError) {
            text(
              res,
              500,
              'Erro ao carregar arquivo.'
            );

            return;
          }

          res.writeHead(200, {
            'Content-Type':
              contentType,

            'Cache-Control':
              'no-cache',

            'Access-Control-Allow-Origin':
              '*'
          });

          res.end(data);
        }
      );
    }
  );
});

/*
 * LIMPEZA DE SESSÕES E TOKENS
 */
setInterval(() => {
  const now = Date.now();

  for (
    const [token, session]
    of sessions.entries()
  ) {
    if (
      now > session.expiresAt
    ) {
      sessions.delete(token);
    }
  }

  for (
    const [token, reset]
    of resetTokens.entries()
  ) {
    if (
      now > reset.expiresAt
    ) {
      resetTokens.delete(token);
    }
  }
}, 1000 * 60 * 10);

/*
 * OFFLINE SE O PC PARAR DE RESPONDER
 */
setInterval(() => {
  if (
    streaming.lastHeartbeat &&
    Date.now() -
      new Date(
        streaming.lastHeartbeat
      ).getTime() >
      90000
  ) {
    streaming.status =
      'offline';

    streaming.message =
      'PC de streaming sem comunicação.';
  }
}, 30000);

/*
 * INICIA O SERVIDOR
 */
server.listen(
  PORT,
  () => {
    console.log(
      `Império GameCloud 4.2.0 rodando na porta ${PORT}`
    );

    console.log(
      `STREAM_AGENT_KEY configurada: ${Boolean(
        STREAM_AGENT_KEY
      )}`
    );

    console.log(
      `ADMIN_PASSWORD configurada: ${Boolean(
        ADMIN_PASSWORD
      )}`
    );

    console.log(
      `ADMIN_USER configurado: ${Boolean(
        ADMIN_USER
      )}`
    );

    console.log(
      `USER_PASSWORD configurada: ${Boolean(
        USER_PASSWORD
      )}`
    );
  }
);

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DB = path.join(ROOT, 'data', 'users.json');

const ADMIN_USER = String(process.env.ADMIN_USER || '')
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');

const STREAM_AGENT_KEY = String(
  process.env.STREAM_AGENT_KEY || ''
);

const sessions = new Map();
const resetTokens = new Map();
const attempts = new Map();

const streaming = {
  enabled: true,
  status: 'offline',
  game: 'FiveM',
  host: 'PC-GAMECLOUD',
  lastHeartbeat: null,
  message: 'Aguardando o PC de streaming.'
};

function ensureDatabase() {
  const dir = path.dirname(DB);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB)) {
    fs.writeFileSync(DB, '[]', 'utf8');
  }
}

ensureDatabase();

function loadUsers() {
  try {
    const data = fs.readFileSync(DB, 'utf8');
    const users = JSON.parse(data);

    return Array.isArray(users) ? users : [];
  } catch (error) {
    console.error('Erro ao carregar usuários:', error);
    return [];
  }
}

let users = loadUsers();

function saveUsers() {
  const dir = path.dirname(DB);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const temporary = `${DB}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(users, null, 2),
    'utf8'
  );

  fs.renameSync(temporary, DB);
}

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Stream-Agent-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(body);
}

function notFound(res) {
  json(res, 404, {
    ok: false,
    error: 'Rota não encontrada.'
  });
}

function unauthorized(res) {
  json(res, 401, {
    ok: false,
    error: 'Não autorizado.'
  });
}

function forbidden(res) {
  json(res, 403, {
    ok: false,
    error: 'Acesso negado.'
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Payload muito grande.'));
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
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function passwordDigest(password, salt) {
  return crypto
    .scryptSync(String(password), salt, 64)
    .toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  return {
    salt,
    hash: passwordDigest(password, salt)
  };
}

function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) {
    return false;
  }

  try {
    const expected = Buffer.from(user.hash, 'hex');
    const actual = Buffer.from(
      passwordDigest(password, user.salt),
      'hex'
    );

    if (expected.length !== actual.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a || ''));
  const second = Buffer.from(String(b || ''));

  if (first.length !== second.length) {
    return false;
  }

  if (first.length === 0) {
    return true;
  }

  return crypto.timingSafeEqual(first, second);
}

function createSession(type, email) {
  const token = randomToken(32);

  sessions.set(token, {
    type,
    email,
    createdAt: Date.now()
  });

  return token;
}

function getSession(req) {
  const authorization = String(
    req.headers.authorization || ''
  );

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return null;
  }

  return sessions.get(token) || null;
}

function requireSession(req, res) {
  const session = getSession(req);

  if (!session) {
    unauthorized(res);
    return null;
  }

  return session;
}

function requireAdmin(req, res) {
  const session = requireSession(req, res);

  if (!session) {
    return null;
  }

  if (session.type !== 'admin') {
    forbidden(res);
    return null;
  }

  return session;
}

function agentAuthorized(req) {
  if (!STREAM_AGENT_KEY) {
    return false;
  }

  return safeEqual(
    req.headers['x-stream-agent-key'],
    STREAM_AGENT_KEY
  );
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function rateLimit(key, max = 10, windowMs = 60000) {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || now - current.startedAt > windowMs) {
    attempts.set(key, {
      startedAt: now,
      count: 1
    });

    return true;
  }

  current.count += 1;

  return current.count <= max;
}

function publicUser(user) {
  return {
    email: user.email,
    name: user.name,
    minutes: Number(user.minutes || 0)
  };
}

function findUser(email) {
  const normalized = normalizeEmail(email);

  return users.find(
    user => normalizeEmail(user.email) === normalized
  );
}

function findUserIndex(email) {
  const normalized = normalizeEmail(email);

  return users.findIndex(
    user => normalizeEmail(user.email) === normalized
  );
}

function removeExpiredSessions() {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > maxAge) {
      sessions.delete(token);
    }
  }
}

setInterval(removeExpiredSessions, 60 * 60 * 1000).unref();

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Stream-Agent-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });

    res.end();
    return;
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = url.pathname;

  /*
   * HEALTH
   */

  if (req.method === 'GET' && pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      version: '4.1.0',
      streaming: {
        enabled: streaming.enabled,
        status: streaming.status
      }
    });

    return;
  }

  /*
   * STREAM STATUS
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/stream/status'
  ) {
    json(res, 200, {
      ok: true,
      streaming: {
        enabled: streaming.enabled,
        status: streaming.status,
        game: streaming.game,
        host: streaming.host,
        lastHeartbeat: streaming.lastHeartbeat,
        message: streaming.message
      }
    });

    return;
  }

  /*
   * REGISTER
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/users/register'
  ) {
    const ip = req.socket.remoteAddress || 'unknown';

    if (!rateLimit(`register:${ip}`, 10, 60000)) {
      json(res, 429, {
        ok: false,
        error: 'Muitas tentativas. Aguarde um pouco.'
      });

      return;
    }

    try {
      const body = await readBody(req);

      const email = normalizeEmail(body.email);
      const name = String(body.name || '').trim();
      const password = String(body.password || '');

      if (!validEmail(email)) {
        json(res, 400, {
          ok: false,
          error: 'E-mail inválido.'
        });

        return;
      }

      if (name.length < 2) {
        json(res, 400, {
          ok: false,
          error: 'Informe seu nome.'
        });

        return;
      }

      if (password.length < 8) {
        json(res, 400, {
          ok: false,
          error: 'A senha deve ter pelo menos 8 caracteres.'
        });

        return;
      }

      if (
        ADMIN_USER &&
        email === ADMIN_USER
      ) {
        json(res, 409, {
          ok: false,
          error: 'Este e-mail é reservado para o administrador.'
        });

        return;
      }

      if (findUser(email)) {
        json(res, 409, {
          ok: false,
          error: 'Este e-mail já está cadastrado.'
        });

        return;
      }

      const credentials = hashPassword(password);

      const user = {
        email,
        name,
        salt: credentials.salt,
        hash: credentials.hash,
        minutes: 0,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      saveUsers();

      console.log(`Novo jogador cadastrado: ${email}`);

      json(res, 201, {
        ok: true,
        message: 'Cadastro realizado com sucesso.',
        user: publicUser(user)
      });

      return;
    } catch (error) {
      console.error('Erro no cadastro:', error);

      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * LOGIN
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/login'
  ) {
    const ip = req.socket.remoteAddress || 'unknown';

    if (!rateLimit(`login:${ip}`, 20, 60000)) {
      json(res, 429, {
        ok: false,
        error: 'Muitas tentativas. Aguarde um pouco.'
      });

      return;
    }

    try {
      const body = await readBody(req);

      const email = normalizeEmail(body.email);
      const password = String(body.password || '');

      /*
       * ADMIN
       */

      if (
        ADMIN_USER &&
        email === ADMIN_USER &&
        ADMIN_PASSWORD &&
        safeEqual(password, ADMIN_PASSWORD)
      ) {
        const token = createSession(
          'admin',
          ADMIN_USER
        );

        json(res, 200, {
          ok: true,
          token,
          user: {
            email: ADMIN_USER,
            name: 'Administrador',
            role: 'admin'
          }
        });

        return;
      }

      /*
       * PLAYER
       */

      const user = findUser(email);

      if (
        !user ||
        !verifyPassword(password, user)
      ) {
        console.log(`Falha de login: ${email}`);

        json(res, 401, {
          ok: false,
          error: 'E-mail ou senha incorretos.'
        });

        return;
      }

      const token = createSession(
        'player',
        user.email
      );

      json(res, 200, {
        ok: true,
        token,
        user: {
          ...publicUser(user),
          role: 'player'
        }
      });

      return;
    } catch (error) {
      console.error('Erro no login:', error);

      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * ME
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/me'
  ) {
    const session = requireSession(req, res);

    if (!session) {
      return;
    }

    if (session.type === 'admin') {
      json(res, 200, {
        ok: true,
        user: {
          email: ADMIN_USER,
          name: 'Administrador',
          role: 'admin'
        }
      });

      return;
    }

    const user = findUser(session.email);

    if (!user) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      user: {
        ...publicUser(user),
        role: 'player'
      }
    });

    return;
  }

  /*
   * LOGOUT
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/logout'
  ) {
    const authorization = String(
      req.headers.authorization || ''
    );

    if (authorization.startsWith('Bearer ')) {
      const token = authorization.slice(7).trim();

      if (token) {
        sessions.delete(token);
      }
    }

    json(res, 200, {
      ok: true,
      message: 'Sessão encerrada.'
    });

    return;
  }

  /*
   * PLAYER STREAM START
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/stream/start'
  ) {
    const session = requireSession(req, res);

    if (!session) {
      return;
    }

    if (session.type !== 'player') {
      forbidden(res);
      return;
    }

    if (!streaming.enabled) {
      json(res, 503, {
        ok: false,
        error: 'O streaming está desativado.'
      });

      return;
    }

    if (streaming.status !== 'online') {
      json(res, 503, {
        ok: false,
        error: 'O PC de streaming está offline.',
        streaming: {
          status: streaming.status,
          game: streaming.game,
          host: streaming.host
        }
      });

      return;
    }

    const user = findUser(session.email);

    if (!user) {
      unauthorized(res);
      return;
    }

    if (Number(user.minutes || 0) <= 0) {
      json(res, 403, {
        ok: false,
        error: 'Você não possui minutos disponíveis.'
      });

      return;
    }

    json(res, 200, {
      ok: true,
      message: 'Solicitação de início enviada.',
      game: streaming.game,
      host: streaming.host
    });

    return;
  }

  /*
   * FORGOT PASSWORD
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/forgot-password'
  ) {
    try {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);

      const user = findUser(email);

      /*
       * Não revelamos se o e-mail existe.
       */

      if (user) {
        const token = randomToken(24);

        resetTokens.set(token, {
          email: user.email,
          expiresAt: Date.now() + 15 * 60 * 1000
        });

        console.log(
          `Token de recuperação para ${user.email}: ${token}`
        );
      }

      json(res, 200, {
        ok: true,
        message:
          'Se o e-mail estiver cadastrado, as instruções de recuperação foram geradas.'
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * RESET PASSWORD
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/reset-password'
  ) {
    try {
      const body = await readBody(req);

      const token = String(body.token || '');
      const password = String(body.password || '');

      if (password.length < 8) {
        json(res, 400, {
          ok: false,
          error: 'A senha deve ter pelo menos 8 caracteres.'
        });

        return;
      }

      const reset = resetTokens.get(token);

      if (
        !reset ||
        Date.now() > reset.expiresAt
      ) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Token inválido ou expirado.'
        });

        return;
      }

      const index = findUserIndex(reset.email);

      if (index < 0) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Usuário não encontrado.'
        });

        return;
      }

      const credentials = hashPassword(password);

      users[index].salt = credentials.salt;
      users[index].hash = credentials.hash;

      saveUsers();

      resetTokens.delete(token);

      json(res, 200, {
        ok: true,
        message: 'Senha alterada com sucesso.'
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * ADMIN OVERVIEW
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/admin/overview'
  ) {
    const session = requireAdmin(req, res);

    if (!session) {
      return;
    }

    json(res, 200, {
      ok: true,
      users: users.map(publicUser),
      totalUsers: users.length,
      streaming: {
        ...streaming
      }
    });

    return;
  }

  /*
   * ADMIN ADD TIME
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/time/add'
  ) {
    const session = requireAdmin(req, res);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);

      const email = normalizeEmail(body.email);
      const minutes = Number(body.minutes);

      if (
        !email ||
        !Number.isFinite(minutes) ||
        minutes <= 0
      ) {
        json(res, 400, {
          ok: false,
          error: 'E-mail ou quantidade de minutos inválidos.'
        });

        return;
      }

      const user = findUser(email);

      if (!user) {
        json(res, 404, {
          ok: false,
          error: 'Usuário não encontrado.'
        });

        return;
      }

      user.minutes =
        Number(user.minutes || 0) +
        Math.floor(minutes);

      saveUsers();

      json(res, 200, {
        ok: true,
        message: 'Minutos adicionados.',
        user: publicUser(user)
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * ADMIN STREAM TOGGLE
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/toggle'
  ) {
    const session = requireAdmin(req, res);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);

      if (typeof body.enabled === 'boolean') {
        streaming.enabled = body.enabled;
      } else {
        streaming.enabled = !streaming.enabled;
      }

      if (!streaming.enabled) {
        streaming.status = 'offline';
        streaming.message = 'Streaming desativado pelo administrador.';
      }

      json(res, 200, {
        ok: true,
        streaming: {
          ...streaming
        }
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * ADMIN STREAM START
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/start'
  ) {
    const session = requireAdmin(req, res);

    if (!session) {
      return;
    }

    streaming.enabled = true;
    streaming.status = 'online';
    streaming.message = 'Streaming iniciado pelo administrador.';
    streaming.lastHeartbeat = new Date().toISOString();

    json(res, 200, {
      ok: true,
      streaming: {
        ...streaming
      }
    });

    return;
  }

  /*
   * ADMIN STREAM STOP
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/stop'
  ) {
    const session = requireAdmin(req, res);

    if (!session) {
      return;
    }

    streaming.status = 'offline';
    streaming.message = 'Streaming parado pelo administrador.';

    json(res, 200, {
      ok: true,
      streaming: {
        ...streaming
      }
    });

    return;
  }

  /*
   * STREAM AGENT HEARTBEAT
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/agent/heartbeat'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body = await readBody(req);

      streaming.lastHeartbeat =
        new Date().toISOString();

      streaming.status =
        body.status === 'offline'
          ? 'offline'
          : 'online';

      if (body.game) {
        streaming.game = String(body.game);
      }

      if (body.host) {
        streaming.host = String(body.host);
      }

      if (body.message) {
        streaming.message = String(body.message);
      } else {
        streaming.message =
          streaming.status === 'online'
            ? 'PC de streaming online.'
            : 'PC de streaming offline.';
      }

      json(res, 200, {
        ok: true,
        streaming: {
          ...streaming
        }
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * STREAM AGENT COMMAND
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/agent/command'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body = await readBody(req);

      const command = String(
        body.command || ''
      ).trim();

      if (!command) {
        json(res, 400, {
          ok: false,
          error: 'Comando não informado.'
        });

        return;
      }

      console.log(
        `Comando recebido do agente: ${command}`
      );

      json(res, 200, {
        ok: true,
        command,
        message: 'Comando recebido.'
      });

      return;
    } catch {
      json(res, 400, {
        ok: false,
        error: 'Dados inválidos.'
      });

      return;
    }
  }

  /*
   * STREAM AGENT STATUS
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/agent/status'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      streaming: {
        ...streaming
      }
    });

    return;
  }

  /*
   * UNKNOWN ROUTE
   */

  notFound(res);
}

const server = http.createServer(
  async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      console.error('Erro inesperado:', error);

      if (!res.headersSent) {
        json(res, 500, {
          ok: false,
          error: 'Erro interno do servidor.'
        });
      } else {
        res.end();
      }
    }
  }
);

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Império GameCloud 4.1.0 rodando na porta ${PORT}`
    );

    console.log(
      `ADMIN_USER configurado: ${Boolean(ADMIN_USER)}`
    );

    console.log(
      `ADMIN_PASSWORD configurada: ${Boolean(ADMIN_PASSWORD)}`
    );

    console.log(
      `STREAM_AGENT_KEY configurada: ${Boolean(STREAM_AGENT_KEY)}`
    );
  }
);

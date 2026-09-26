'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const STREAM_AGENT_KEY = process.env.STREAM_AGENT_KEY || '';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL = 1000 * 60 * 30;

const sessions = new Map();
const resetTokens = new Map();
const attempts = new Map();

/*
 * FILA DE COMANDOS DO AGENTE
 *
 * O PC GameCloud consulta:
 * GET /api/agent/command
 *
 * Quando um jogador clica em "Iniciar FiveM",
 * o servidor coloca "start_fivem" nesta fila.
 */
const agentCommands = [];

/*
 * ESTADO DO STREAMING
 */
const streaming = {
  enabled: true,
  status: 'offline',
  game: 'FiveM',
  host: 'PC-GAMECLOUD',
  lastHeartbeat: null,
  message: 'Aguardando o PC de streaming.'
};

/*
 * USUÁRIOS
 */
const users = [
  {
    id: 1,
    username: 'Miguel003',
    email: 'miguel@example.com',
    password: '123456',
    minutes: 366,
    isAdmin: false
  }
];

/*
 * HELPERS
 */

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Stream-Agent-Key',
    'Access-Control-Allow-Methods':
      'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Length': Buffer.byteLength(body)
  });

  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });

  res.end(body);
}

function unauthorized(res) {
  json(res, 401, {
    ok: false,
    error: 'Não autorizado.'
  });
}

function notFound(res) {
  json(res, 404, {
    ok: false,
    error: 'Rota não encontrada.'
  });
}

function badRequest(res, message = 'Dados inválidos.') {
  json(res, 400, {
    ok: false,
    error: message
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();

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

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(user) {
  const token = generateToken();

  sessions.set(token, {
    userId: user.id,
    createdAt: Date.now()
  });

  return token;
}

function getSessionToken(req) {
  const header = req.headers.authorization || '';

  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  return null;
}

function getCurrentUser(req) {
  const token = getSessionToken(req);

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }

  return users.find(user => user.id === session.userId) || null;
}

function requireUser(req, res) {
  const user = getCurrentUser(req);

  if (!user) {
    unauthorized(res);
    return null;
  }

  return user;
}

function agentAuthorized(req) {
  if (!STREAM_AGENT_KEY) {
    return false;
  }

  const key = req.headers['x-stream-agent-key'];

  return Boolean(key && key === STREAM_AGENT_KEY);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    minutes: user.minutes,
    isAdmin: Boolean(user.isAdmin)
  };
}

function logRequest(req) {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.url}`
  );
}

/*
 * SERVIDOR
 */

const server = http.createServer(async (req, res) => {
  logRequest(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Stream-Agent-Key',
      'Access-Control-Allow-Methods':
        'GET, POST, PUT, DELETE, OPTIONS'
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
   * ==============================
   * LOGIN
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/login'
  ) {
    try {
      const body = await readBody(req);

      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      const user = users.find(
        item =>
          item.username.toLowerCase() === username.toLowerCase() &&
          item.password === password
      );

      if (!user) {
        json(res, 401, {
          ok: false,
          error: 'Usuário ou senha incorretos.'
        });

        return;
      }

      const token = createSession(user);

      json(res, 200, {
        ok: true,
        token,
        user: sanitizeUser(user)
      });

      return;
    } catch (error) {
      console.error('Erro no login:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * USUÁRIO ATUAL
   * ==============================
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/me'
  ) {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      user: sanitizeUser(user)
    });

    return;
  }

  /*
   * ==============================
   * LOGOUT
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/logout'
  ) {
    const token = getSessionToken(req);

    if (token) {
      sessions.delete(token);
    }

    json(res, 200, {
      ok: true
    });

    return;
  }

  /*
   * ==============================
   * ESQUECI MINHA SENHA
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/forgot-password'
  ) {
    try {
      const body = await readBody(req);

      const email = String(body.email || '')
        .trim()
        .toLowerCase();

      const user = users.find(
        item => item.email.toLowerCase() === email
      );

      /*
       * Por segurança, não revelamos se o e-mail existe.
       */
      if (!user) {
        json(res, 200, {
          ok: true,
          message:
            'Se o e-mail estiver cadastrado, as instruções serão enviadas.'
        });

        return;
      }

      const token = generateToken();

      resetTokens.set(token, {
        userId: user.id,
        createdAt: Date.now()
      });

      console.log(
        `Token de recuperação criado para ${user.email}: ${token}`
      );

      json(res, 200, {
        ok: true,
        message:
          'Solicitação de recuperação criada.',
        token
      });

      return;
    } catch (error) {
      console.error('Erro em forgot-password:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * RESET DE SENHA
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/reset-password'
  ) {
    try {
      const body = await readBody(req);

      const token = String(body.token || '');
      const password = String(body.password || '');

      if (!token || !password) {
        badRequest(res, 'Token e senha são obrigatórios.');
        return;
      }

      if (password.length < 6) {
        badRequest(
          res,
          'A senha deve possuir pelo menos 6 caracteres.'
        );
        return;
      }

      const reset = resetTokens.get(token);

      if (!reset) {
        badRequest(res, 'Token inválido ou expirado.');
        return;
      }

      if (Date.now() - reset.createdAt > RESET_TTL) {
        resetTokens.delete(token);

        badRequest(res, 'Token expirado.');
        return;
      }

      const user = users.find(
        item => item.id === reset.userId
      );

      if (!user) {
        badRequest(res, 'Usuário não encontrado.');
        return;
      }

      user.password = password;

      resetTokens.delete(token);

      json(res, 200, {
        ok: true,
        message: 'Senha alterada com sucesso.'
      });

      return;
    } catch (error) {
      console.error('Erro em reset-password:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * STATUS DO STREAMING
   * ==============================
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/stream/status'
  ) {
    json(res, 200, {
      ok: true,
      streaming
    });

    return;
  }

  /*
   * ==============================
   * INICIAR FIVEM PELO USUÁRIO
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/stream/start'
  ) {
    const user = requireUser(req, res);

    if (!user) {
      return;
    }

    if (!streaming.enabled) {
      json(res, 400, {
        ok: false,
        error: 'O streaming está desativado pelo administrador.'
      });

      return;
    }

    if (streaming.status !== 'online') {
      json(res, 400, {
        ok: false,
        error: 'O PC de streaming está offline.'
      });

      return;
    }

    if (Number(user.minutes) <= 0) {
      json(res, 400, {
        ok: false,
        error: 'Você não possui minutos disponíveis.'
      });

      return;
    }

    /*
     * COLOCA O COMANDO NA FILA.
     *
     * O agente do PC vai consultar
     * GET /api/agent/command
     * e retirar este comando.
     */

    agentCommands.push({
      command: 'start_fivem',
      createdAt: Date.now(),
      userId: user.id
    });

    console.log(
      'Comando start_fivem colocado na fila.'
    );

    json(res, 200, {
      ok: true,
      message: 'Solicitação de início enviada.',
      game: streaming.game,
      host: streaming.host
    });

    return;
  }

  /*
   * ==============================
   * ADMIN LOGIN
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/login'
  ) {
    try {
      const body = await readBody(req);

      const username = String(body.username || '');
      const password = String(body.password || '');

      if (
        username !== ADMIN_USER ||
        password !== ADMIN_PASSWORD
      ) {
        json(res, 401, {
          ok: false,
          error: 'Credenciais administrativas inválidas.'
        });

        return;
      }

      const token = generateToken();

      sessions.set(`admin:${token}`, {
        userId: 'admin',
        createdAt: Date.now(),
        admin: true
      });

      json(res, 200, {
        ok: true,
        token,
        admin: true
      });

      return;
    } catch (error) {
      console.error('Erro no login admin:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * FUNÇÃO DE AUTENTICAÇÃO ADMIN
   * ==============================
   */

  function isAdmin(req) {
    const token = getSessionToken(req);

    if (!token) {
      return false;
    }

    const session = sessions.get(`admin:${token}`);

    if (!session) {
      return false;
    }

    if (Date.now() - session.createdAt > SESSION_TTL) {
      sessions.delete(`admin:${token}`);
      return false;
    }

    return session.admin === true;
  }

  /*
   * ==============================
   * STATUS ADMIN
   * ==============================
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/admin/stream/status'
  ) {
    if (!isAdmin(req)) {
      unauthorized(res);
      return;
    }

    json(res, 200, {
      ok: true,
      streaming
    });

    return;
  }

  /*
   * ==============================
   * ADMIN ATIVA/DESATIVA STREAMING
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/toggle'
  ) {
    if (!isAdmin(req)) {
      unauthorized(res);
      return;
    }

    try {
      const body = await readBody(req);

      streaming.enabled = Boolean(body.enabled);

      if (!streaming.enabled) {
        streaming.status = 'offline';
        streaming.message =
          'Streaming desativado pelo administrador.';
      }

      json(res, 200, {
        ok: true,
        streaming
      });

      return;
    } catch (error) {
      console.error('Erro ao alterar streaming:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * ADMIN INICIA STREAMING
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/start'
  ) {
    if (!isAdmin(req)) {
      unauthorized(res);
      return;
    }

    streaming.enabled = true;
    streaming.status = 'online';
    streaming.game = 'FiveM';
    streaming.message =
      'PC de streaming online.';

    json(res, 200, {
      ok: true,
      streaming
    });

    return;
  }

  /*
   * ==============================
   * ADMIN PARA STREAMING
   * ==============================
   */

  if (
    req.method === 'POST' &&
    pathname === '/api/admin/stream/stop'
  ) {
    if (!isAdmin(req)) {
      unauthorized(res);
      return;
    }

    streaming.status = 'offline';
    streaming.message =
      'Streaming parado pelo administrador.';

    json(res, 200, {
      ok: true,
      streaming
    });

    return;
  }

  /*
   * ==============================
   * AGENTE - HEARTBEAT
   * ==============================
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

      streaming.status =
        body.status === 'offline'
          ? 'offline'
          : 'online';

      streaming.game =
        body.game || 'FiveM';

      streaming.host =
        body.host ||
        req.headers.host ||
        'PC-GAMECLOUD';

      streaming.lastHeartbeat = new Date().toISOString();

      streaming.message =
        body.message ||
        'PC de streaming conectado.';

      json(res, 200, {
        ok: true,
        streaming
      });

      return;
    } catch (error) {
      console.error('Erro no heartbeat:', error);
      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * AGENTE - BUSCAR COMANDO
   * ==============================
   *
   * IMPORTANTE:
   * O PowerShell usa GET aqui.
   */

  if (
    req.method === 'GET' &&
    pathname === '/api/agent/command'
  ) {
    if (!agentAuthorized(req)) {
      unauthorized(res);
      return;
    }

    /*
     * Retira o primeiro comando da fila.
     *
     * Se não houver comando:
     * command = null
     */

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
   * ==============================
   * AGENTE - STATUS
   * ==============================
   *
   * Mantemos GET para consulta do status.
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
      streaming
    });

    return;
  }

  /*
   * ==============================
   * AGENTE - COMANDO MANUAL
   * ==============================
   *
   * Mantém POST para compatibilidade
   * com chamadas administrativas/testes.
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

      const command = String(body.command || '').trim();

      if (!command) {
        badRequest(res, 'Comando não informado.');
        return;
      }

      console.log(
        `Comando recebido do agente: ${command}`
      );

      json(res, 200, {
        ok: true,
        command
      });

      return;
    } catch (error) {
      console.error(
        'Erro no comando do agente:',
        error
      );

      badRequest(res);
      return;
    }
  }

  /*
   * ==============================
   * ARQUIVOS ESTÁTICOS
   * ==============================
   */

  let filePath;

  if (pathname === '/') {
    filePath = path.join(
      __dirname,
      'frontend',
      'index.html'
    );
  } else if (
    pathname === '/index.html'
  ) {
    filePath = path.join(
      __dirname,
      'frontend',
      'index.html'
    );
  } else if (
    pathname === '/app.js'
  ) {
    filePath = path.join(
      __dirname,
      'frontend',
      'app.js'
    );
  } else if (
    pathname === '/style.css'
  ) {
    filePath = path.join(
      __dirname,
      'frontend',
      'style.css'
    );
  } else if (
    pathname === '/styles.css'
  ) {
    filePath = path.join(
      __dirname,
      'frontend',
      'styles.css'
    );
  } else {
    filePath = path.join(
      __dirname,
      'frontend',
      pathname.replace(/^\/+/, '')
    );
  }

  /*
   * Evita acesso a arquivos fora da pasta frontend.
   */

  const frontendRoot = path.resolve(
    path.join(__dirname, 'frontend')
  );

  const resolvedFile = path.resolve(filePath);

  if (
    !resolvedFile.startsWith(frontendRoot)
  ) {
    notFound(res);
    return;
  }

  fs.stat(resolvedFile, (error, stats) => {
    if (error || !stats.isFile()) {
      notFound(res);
      return;
    }

    const ext = path.extname(resolvedFile).toLowerCase();

    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const contentType =
      contentTypes[ext] ||
      'application/octet-stream';

    fs.readFile(resolvedFile, (readError, data) => {
      if (readError) {
        text(
          res,
          500,
          'Erro ao carregar arquivo.'
        );

        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });

      res.end(data);
    });
  });
});

/*
 * LIMPEZA DE SESSÕES EXPIRADAS
 */

setInterval(() => {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
    }
  }

  for (const [token, reset] of resetTokens.entries()) {
    if (now - reset.createdAt > RESET_TTL) {
      resetTokens.delete(token);
    }
  }
}, 60 * 1000);

/*
 * INICIALIZAÇÃO
 */

server.listen(PORT, () => {
  console.log('=================================');
  console.log(' IMPÉRIO GAMECLOUD 4.1.0');
  console.log('=================================');
  console.log(`Porta: ${PORT}`);
  console.log(
    `STREAM_AGENT_KEY configurada: ${Boolean(STREAM_AGENT_KEY)}`
  );
  console.log(
    `ADMIN_PASSWORD configurada: ${Boolean(ADMIN_PASSWORD)}`
  );
  console.log(
    `ADMIN_USER configurado: ${Boolean(ADMIN_USER)}`
  );
  console.log('=================================');
});

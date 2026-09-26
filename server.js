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
const agentCommands = [];

/*
 * ==============================
 * USUÁRIOS
 * ==============================
 */

const users = [
  {
    id: 1,
    username: 'Miguel003',
    email: 'miguel@example.com',
    password: '123456',
    minutes: 366
  }
];

/*
 * ==============================
 * STREAMING
 * ==============================
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
 * ==============================
 * FUNÇÕES AUXILIARES
 * ==============================
 */

function json(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });

  res.end(JSON.stringify(data));
}

function text(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });

  res.end(message);
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

function badRequest(res, message) {
  json(res, 400, {
    ok: false,
    error: message || 'Requisição inválida.'
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

    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function getSession(req) {
  const cookies = getCookies(req);
  const token = cookies.session;

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

  if (!session) {
    return null;
  }

  return users.find((user) => user.id === session.userId) || null;
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
    'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  );
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

function agentAuthorized(req) {
  if (!STREAM_AGENT_KEY) {
    return false;
  }

  const key = req.headers['x-stream-agent-key'];

  return Boolean(key && key === STREAM_AGENT_KEY);
}

/*
 * ==============================
 * SERVIDOR HTTP
 * ==============================
 */

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = parsedUrl.pathname;
  const method = req.method;

  /*
   * ==============================
   * API
   * ==============================
   */

  if (
    method === 'GET' &&
    pathname === '/api/health'
  ) {
    json(res, 200, {
      ok: true,
      service: 'Império GameCloud',
      version: '4.1.0'
    });

    return;
  }

  /*
   * ==============================
   * LOGIN
   * ==============================
   */

  if (
    method === 'POST' &&
    pathname === '/api/login'
  ) {
    try {
      const body = await readBody(req);

      const username = String(
        body.username || ''
      ).trim();

      const password = String(
        body.password || ''
      );

      const user = users.find(
        (item) =>
          item.username.toLowerCase() ===
            username.toLowerCase() &&
          item.password === password
      );

      if (!user) {
        json(res, 401, {
          ok: false,
          error: 'Usuário ou senha incorretos.'
        });

        return;
      }

      const token = createToken();

      sessions.set(token, {
        userId: user.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
      });

      setSessionCookie(res, token);

      json(res, 200, {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          minutes: user.minutes
        }
      });

      return;
    } catch (error) {
      serverError(res, 'Erro ao realizar login.');
      return;
    }
  }

  /*
   * ==============================
   * USUÁRIO ATUAL
   * ==============================
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
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        minutes: user.minutes
      }
    });

    return;
  }

  /*
   * ==============================
   * LOGOUT
   * ==============================
   */

  if (
    method === 'POST' &&
    pathname === '/api/logout'
  ) {
    const cookies = getCookies(req);

    if (cookies.session) {
      sessions.delete(cookies.session);
    }

    clearSessionCookie(res);

    json(res, 200, {
      ok: true
    });

    return;
  }

  /*
   * ==============================
   * ESQUECI A SENHA
   * ==============================
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

      const user = users.find(
        (item) =>
          item.email.toLowerCase() === email
      );

      /*
       * Por segurança, não informamos se o
       * e-mail existe ou não.
       */

      if (user) {
        const token = createToken();

        resetTokens.set(token, {
          userId: user.id,
          expiresAt: Date.now() + RESET_TTL
        });

        console.log(
          `Token de redefinição criado para ${user.email}: ${token}`
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
   * ==============================
   * RESETAR SENHA
   * ==============================
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

      const reset = resetTokens.get(token);

      if (!reset) {
        json(res, 400, {
          ok: false,
          error: 'Token inválido ou expirado.'
        });

        return;
      }

      if (Date.now() > reset.expiresAt) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Token expirado.'
        });

        return;
      }

      if (password.length < 6) {
        badRequest(
          res,
          'A senha deve ter pelo menos 6 caracteres.'
        );

        return;
      }

      const user = users.find(
        (item) => item.id === reset.userId
      );

      if (!user) {
        resetTokens.delete(token);

        json(res, 400, {
          ok: false,
          error: 'Usuário não encontrado.'
        });

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
      serverError(
        res,
        'Erro ao redefinir senha.'
      );

      return;
    }
  }

  /*
   * ==============================
   * STATUS DO STREAMING
   * ==============================
   */

  if (
    method === 'GET' &&
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
   * INICIAR FIVEM
   * ==============================
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

    if (streaming.status !== 'online') {
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

    json(res, 200, {
      ok: true,
      message:
        'Comando para iniciar o FiveM enviado ao PC de streaming.'
    });

    return;
  }

  /*
   * ==============================
   * ADMIN LOGIN
   * ==============================
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
        admin: true
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro no login administrativo.'
      );

      return;
    }
  }

  /*
   * ==============================
   * VERIFICA ADMIN
   * ==============================
   */

  function getAdminSession(request) {
    const cookies = getCookies(request);
    const token = cookies.admin_session;

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

  /*
   * ==============================
   * STATUS ADMIN
   * ==============================
   */

  if (
    method === 'GET' &&
    pathname === '/api/admin/stream'
  ) {
    const admin = getAdminSession(req);

    if (!admin) {
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
   * ALTERAR STREAMING
   * ==============================
   */

  if (
    method === 'POST' &&
    pathname === '/api/admin/stream'
  ) {
    const admin = getAdminSession(req);

    if (!admin) {
      unauthorized(res);
      return;
    }

    try {
      const body = await readBody(req);

      if (
        typeof body.enabled === 'boolean'
      ) {
        streaming.enabled = body.enabled;
      }

      if (typeof body.status === 'string') {
        streaming.status = body.status;
      }

      if (typeof body.game === 'string') {
        streaming.game = body.game;
      }

      if (typeof body.host === 'string') {
        streaming.host = body.host;
      }

      if (typeof body.message === 'string') {
        streaming.message = body.message;
      }

      json(res, 200, {
        ok: true,
        streaming
      });

      return;
    } catch (error) {
      serverError(
        res,
        'Erro ao atualizar o streaming.'
      );

      return;
    }
  }

  /*
   * ==============================
   * HEARTBEAT DO AGENTE
   * ==============================
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
      const body = await readBody(req);

      streaming.status =
        body.status || 'online';

      streaming.game =
        body.game || 'FiveM';

      streaming.host =
        body.host ||
        req.headers.host ||
        'PC-GAMECLOUD';

      streaming.message =
        body.message ||
        'PC de streaming online.';

      streaming.lastHeartbeat =
        new Date().toISOString();

      json(res, 200, {
        ok: true,
        streaming
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
   * ==============================
   * COMANDO PARA O AGENTE
   * ==============================
   *
   * O agente consulta esta rota usando GET.
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
   * ==============================
   * STATUS DO AGENTE
   * ==============================
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
      streaming
    });

    return;
  }

  /*
   * ==============================
   * COMANDO DIRETO DO AGENTE
   * ==============================
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
      const body = await readBody(req);

      if (!body.command) {
        badRequest(
          res,
          'Comando não informado.'
        );

        return;
      }

      agentCommands.push({
        command: String(body.command),
        createdAt: Date.now(),
        userId: body.userId || null
      });

      json(res, 200, {
        ok: true,
        message: 'Comando adicionado à fila.'
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
   * ==============================
   * ARQUIVOS ESTÁTICOS
   * ==============================
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

  /*
   * Evita acesso a arquivos fora
   * da pasta do projeto.
   */

  const projectRoot =
    path.resolve(__dirname);

  const resolvedFile =
    path.resolve(filePath);

  if (
    resolvedFile !== projectRoot &&
    !resolvedFile.startsWith(
      projectRoot + path.sep
    )
  ) {
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
              'no-cache'
          });

          res.end(data);
        }
      );
    }
  );
});

/*
 * ==============================
 * LIMPEZA DE SESSÕES EXPIRADAS
 * ==============================
 */

setInterval(() => {
  const now = Date.now();

  for (
    const [
      token,
      session
    ] of sessions.entries()
  ) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }

  for (
    const [
      token,
      reset
    ] of resetTokens.entries()
  ) {
    if (now > reset.expiresAt) {
      resetTokens.delete(token);
    }
  }
}, 1000 * 60 * 10);

/*
 * ==============================
 * INICIAR SERVIDOR
 * ==============================
 */

server.listen(PORT, () => {
  console.log(
    `Império GameCloud 4.1.0 rodando na porta ${PORT}`
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
});

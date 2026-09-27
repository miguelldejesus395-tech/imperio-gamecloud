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

const defaultSiteConfig = {
  brandName: 'IMPÉRIO GAMECLOUD',

  authTitle: 'Acesse sua conta',

  authText:
    'Entre para gerenciar seus servidores e seu tempo de jogo.',

  home: {
    eyebrow: 'Império GameCloud • FiveM',

    title: 'Olá, {name}.',

    text:
      'Seu próximo mundo começa aqui. Acompanhe o tempo, gerencie seus servidores e monte sua configuração.',

    primaryButton: 'Explorar pacotes',

    secondaryButton: 'Meus servidores',

    heroImage: 'imperio-usuario.png'
  },

  theme: {
    gold: '#f2c94c',
    background: '#090c12'
  }
};

const defaultPackages = [
  {
    id: 'basico',
    name: 'Básico',
    priceCents: 0,
    ram: 4,
    vcpu: 2,
    gpu: 'GPU básica',
    storage: 50,
    description: 'Configuração única do GameCloud. A cobrança é somente por minutos.'
  }
];

// Configuração única do servidor GameCloud.
// O cliente paga somente pelo tempo.
const standardServerProfile = {
  type: 'FiveM RP',
  ram: 4,
  vcpu: 2,
  gpu: 'GPU básica',
  storage: 50
};

function readDatabase() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );

    return {
      users: Array.isArray(parsed.users)
        ? parsed.users
        : null,

      servers: Array.isArray(parsed.servers)
        ? parsed.servers
        : [],

      // Catálogo antigo permanece no banco apenas
      // para compatibilidade/histórico.
      packages: Array.isArray(parsed.packages)
        ? parsed.packages
        : [],

      orders: Array.isArray(parsed.orders)
        ? parsed.orders
        : [],

      tickets: Array.isArray(parsed.tickets)
        ? parsed.tickets
        : [],

      minutesRateCents:
        Number.isSafeInteger(parsed.minutesRateCents)
          ? parsed.minutesRateCents
          : 10,

      siteConfig:
        parsed.siteConfig &&
        typeof parsed.siteConfig === 'object'
          ? parsed.siteConfig
          : defaultSiteConfig
    };
  } catch (error) {
    return {
      users: null,
      servers: [],
      packages: [],
      orders: [],
      tickets: [],
      minutesRateCents: 10,
      siteConfig: defaultSiteConfig
    };
  }
}

const database = readDatabase();

function saveDatabase() {
  fs.mkdirSync(
    path.dirname(DATA_FILE),
    { recursive: true }
  );

  const temporary = DATA_FILE + '.tmp';

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      {
        users,
        servers,
        packages,
        orders,
        tickets,
        minutesRateCents:
          database.minutesRateCents,
        siteConfig:
          database.siteConfig
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  fs.renameSync(
    temporary,
    DATA_FILE
  );
}

function passwordFields(password) {
  const salt =
    crypto.randomBytes(16).toString('hex');

  return {
    passwordSalt: salt,

    passwordHash:
      crypto
        .scryptSync(
          password,
          salt,
          64
        )
        .toString('hex')
  };
}

function passwordMatches(user, password) {
  if (
    user.passwordHash &&
    user.passwordSalt
  ) {
    const candidate =
      crypto.scryptSync(
        password,
        user.passwordSalt,
        64
      );

    const stored =
      Buffer.from(
        user.passwordHash,
        'hex'
      );

    return (
      stored.length ===
        candidate.length &&
      crypto.timingSafeEqual(
        stored,
        candidate
      )
    );
  }

  return user.password === password;
}

const sessions = new Map();
const resetTokens = new Map();
const agentCommands = [];
const streamAgents = new Map();

function getAgentId(req) {
  return String(req.headers['x-stream-agent-id'] || 'PC-GAMECLOUD').trim() || 'PC-GAMECLOUD';
}

function touchAgent(req, status, message) {
  const id = getAgentId(req);
  const previous = streamAgents.get(id) || {};
  const agent = {
    id,
    status,
    game: 'FiveM',
    lastHeartbeat: new Date().toISOString(),
    message: message || previous.message || 'Agente conectado.'
  };
  streamAgents.set(id, agent);
  return agent;
}

function publicAgents() {
  return Array.from(streamAgents.values())
    .sort((a,b) => a.id.localeCompare(b.id));
}

const seedPassword =
  passwordFields(USER_PASSWORD);

const users =
  database.users || [
    {
      id: 1,
      name: 'miguell003',
      username: 'miguell003',
      email: 'ewerton3220@gmail.com',
      ...seedPassword,
      minutes: 366,
      createdAt:
        new Date().toISOString()
    }
  ];

const servers =
  database.servers;

const packages =
  database.packages;

const orders =
  database.orders;

const tickets =
  database.tickets;

const streaming = {
  enabled: true,
  status: 'offline',
  game: 'FiveM',
  host: 'PC-GAMECLOUD',
  lastHeartbeat: null,
  message:
    'Aguardando o PC de streaming.'
};

function json(
  res,
  statusCode,
  data
) {
  res.writeHead(
    statusCode,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-cache',

      'Access-Control-Allow-Origin':
        '*',

      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Stream-Agent-Key, X-Stream-Agent-Id',

      'Access-Control-Allow-Methods':
        'GET, POST, OPTIONS'
    }
  );

  res.end(
    JSON.stringify(data)
  );
}

function text(
  res,
  statusCode,
  message
) {
  res.writeHead(
    statusCode,
    {
      'Content-Type':
        'text/plain; charset=utf-8',

      'Cache-Control':
        'no-cache',

      'Access-Control-Allow-Origin':
        '*'
    }
  );

  res.end(message);
}

function unauthorized(res) {
  json(
    res,
    401,
    {
      ok: false,
      error: 'Não autorizado.'
    }
  );
}

function badRequest(
  res,
  message
) {
  json(
    res,
    400,
    {
      ok: false,
      error:
        message ||
        'Requisição inválida.'
    }
  );
}

function notFound(res) {
  json(
    res,
    404,
    {
      ok: false,
      error:
        'Rota não encontrada.'
    }
  );
}

function serverError(
  res,
  message
) {
  json(
    res,
    500,
    {
      ok: false,
      error:
        message ||
        'Erro interno do servidor.'
    }
  );
}

function createToken() {
  return crypto
    .randomBytes(32)
    .toString('hex');
}

function readBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = '';

      req.on(
        'data',
        (chunk) => {
          body += chunk;

          if (
            body.length >
            1024 * 1024
          ) {
            reject(
              new Error(
                'Corpo da requisição muito grande.'
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => {
          if (!body) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(body)
            );
          } catch (error) {
            reject(
              new Error(
                'JSON inválido.'
              )
            );
          }
        }
      );

      req.on(
        'error',
        reject
      );
    }
  );
}

function getCookies(req) {
  const header =
    req.headers.cookie || '';

  const cookies = {};

  header
    .split(';')
    .forEach(
      (part) => {
        const index =
          part.indexOf('=');

        if (index === -1) {
          return;
        }

        const key =
          part
            .slice(0, index)
            .trim();

        const value =
          part
            .slice(index + 1)
            .trim();

        try {
          cookies[key] =
            decodeURIComponent(
              value
            );
        } catch {
          cookies[key] =
            value;
        }
      }
    );

  return cookies;
}

function getBearerToken(req) {
  const authorization =
    req.headers.authorization ||
    '';

  if (
    !authorization.startsWith(
      'Bearer '
    )
  ) {
    return '';
  }

  return authorization
    .slice(7)
    .trim();
}

function getSession(req) {
  const cookies =
    getCookies(req);

  const cookieToken =
    cookies.session || '';

  const bearerToken =
    getBearerToken(req);

  const token =
    bearerToken ||
    cookieToken;

  if (!token) {
    return null;
  }

  const session =
    sessions.get(token);

  if (!session) {
    return null;
  }

  if (
    Date.now() >
    session.expiresAt
  ) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function getCurrentUser(req) {
  const session =
    getSession(req);

  if (
    !session ||
    session.role !== 'player'
  ) {
    return null;
  }

  return (
    users.find(
      (user) =>
        user.id ===
        session.userId
    ) || null
  );
}

function getAdminSession(req) {
  const cookies =
    getCookies(req);

  const cookieToken =
    cookies.admin_session ||
    '';

  const bearerToken =
    getBearerToken(req);

  const token =
    bearerToken ||
    cookieToken;

  if (!token) {
    return null;
  }

  const session =
    sessions.get(
      `admin:${token}`
    );

  if (!session) {
    return null;
  }

  if (
    Date.now() >
    session.expiresAt
  ) {
    sessions.delete(
      `admin:${token}`
    );

    return null;
  }

  return session;
}

function setSessionCookie(
  res,
  token
) {
  res.setHeader(
    'Set-Cookie',
    `session=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
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

  const key =
    req.headers[
      'x-stream-agent-key'
    ];

  return Boolean(
    key &&
    key === STREAM_AGENT_KEY
  );
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

function findUserByEmail(
  email
) {
  return users.find(
    (user) =>
      user.email.toLowerCase() ===
      String(email)
        .trim()
        .toLowerCase()
  );
}

function findUserByLogin(
  value
) {
  const login =
    String(value || '')
      .trim()
      .toLowerCase();

  return users.find(
    (user) =>
      user.email
        .toLowerCase() ===
        login ||
      user.username
        .toLowerCase() ===
        login
  );
}

const server =
  http.createServer(
    async (req, res) => {
      const parsedUrl =
        new URL(
          req.url,
          `http://${
            req.headers.host ||
            'localhost'
          }`
        );

      const pathname =
        parsedUrl.pathname;

      const method =
        req.method;

      if (
        method === 'OPTIONS'
      ) {
        res.writeHead(
          204,
          {
            'Access-Control-Allow-Origin':
              '*',

            'Access-Control-Allow-Headers':
              'Content-Type, Authorization, X-Stream-Agent-Key, X-Stream-Agent-Id',

            'Access-Control-Allow-Methods':
              'GET, POST, OPTIONS'
          }
        );

        res.end();

        return;
      }

      if (
        method === 'GET' &&
        pathname ===
          '/api/health'
      ) {
        json(
          res,
          200,
          {
            ok: true,
            service:
              'Império GameCloud',
            version:
              '4.2.0'
          }
        );

        return;
      }
            if (
        method === 'GET' &&
        pathname === '/api/site-config'
      ) {
        json(
          res,
          200,
          {
            ok: true,
            config: database.siteConfig
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/stream/status'
      ) {
        json(
          res,
          200,
          {
            ok: true,
            streaming: {
              ...streaming
            }
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/stream/heartbeat'
      ) {
        if (!agentAuthorized(req)) {
          unauthorized(res);
          return;
        }

        const agent = touchAgent(req, 'online', 'PC de streaming conectado.');
        streaming.status = 'online';
        streaming.host = agent.id;
        streaming.lastHeartbeat = agent.lastHeartbeat;
        streaming.message = agent.message;

        json(
          res,
          200,
          {
            ok: true,
            streaming: {
              ...streaming
            }
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/stream/offline'
      ) {
        if (!agentAuthorized(req)) {
          unauthorized(res);
          return;
        }

        const agent = touchAgent(req, 'offline', 'PC de streaming offline.');
        streaming.status = 'offline';
        streaming.host = agent.id;
        streaming.lastHeartbeat = agent.lastHeartbeat;
        streaming.message = agent.message;

        json(
          res,
          200,
          {
            ok: true,
            streaming: {
              ...streaming
            }
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/stream/command'
      ) {
        if (!agentAuthorized(req)) {
          unauthorized(res);
          return;
        }

        const agentId = getAgentId(req);
        const commandIndex = agentCommands.findIndex(command =>
          !command.agentId || command.agentId === agentId
        );
        const command = commandIndex >= 0
          ? agentCommands.splice(commandIndex, 1)[0]
          : null;

        json(
          res,
          200,
          {
            ok: true,
            command
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/users/register'
      ) {
        let body;

        try {
          body = await readBody(req);
        } catch (error) {
          badRequest(
            res,
            error.message
          );
          return;
        }

        const name =
          String(
            body.name ||
            body.nome ||
            ''
          ).trim();

        const email =
          String(
            body.email || ''
          ).trim().toLowerCase();

        const password =
          String(
            body.password ||
            body.senha ||
            ''
          );

        if (
          !name ||
          name.length < 2
        ) {
          badRequest(
            res,
            'Informe um nome válido.'
          );
          return;
        }

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(email)
        ) {
          badRequest(
            res,
            'Informe e-mail válido.'
          );
          return;
        }

        if (
          password.length < 8
        ) {
          badRequest(
            res,
            'A senha precisa ter 8 caracteres ou mais.'
          );
          return;
        }

        if (
          findUserByEmail(email)
        ) {
          badRequest(
            res,
            'E-mail já cadastrado.'
          );
          return;
        }

        const credentials =
          passwordFields(
            password
          );

        const nextId =
          users.reduce(
            (highest, user) =>
              Math.max(
                highest,
                Number(user.id) || 0
              ),
            0
          ) + 1;

        const usernameBase =
          email
            .split('@')[0]
            .replace(
              /[^a-zA-Z0-9_]/g,
              ''
            )
            .slice(0, 24) ||
          `usuario${nextId}`;

        let username =
          usernameBase;

        let suffix = 1;

        while (
          users.some(
            (user) =>
              String(
                user.username || ''
              ).toLowerCase() ===
              username.toLowerCase()
          )
        ) {
          username =
            `${usernameBase}${suffix}`;
          suffix += 1;
        }

        const user = {
          id: nextId,
          name,
          username,
          email,
          ...credentials,
          minutes: 0,
          createdAt:
            new Date().toISOString()
        };

        users.push(user);

        saveDatabase();

        json(
          res,
          201,
          {
            ok: true,
            user: publicUser(user),
            message:
              'Conta criada com sucesso.'
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/admin/login'
      ) {
        let body;

        try {
          body = await readBody(req);
        } catch (error) {
          badRequest(res, error.message);
          return;
        }

        const login =
          String(
            body.username ||
            body.email ||
            body.login ||
            ''
          ).trim();

        const password =
          String(
            body.password ||
            body.senha ||
            ''
          );

        if (
          login === ADMIN_USER &&
          password === ADMIN_PASSWORD
        ) {
          const token = createToken();
          const adminKey = `admin:${token}`;

          sessions.set(
            adminKey,
            {
              role: 'admin',
              expiresAt: Date.now() + SESSION_TTL
            }
          );

          setSessionCookie(res, token);

          res.setHeader(
            'Set-Cookie',
            [
              `admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
            ]
          );

          json(
            res,
            200,
            {
              ok: true,
              token,
              role: 'admin',
              user: {
                name: 'Administrator',
                role: 'admin'
              }
            }
          );

          return;
        }

        json(
          res,
          401,
          {
            ok: false,
            error: 'Credenciais administrativas inválidas.'
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/login'
      ) {
        let body;

        try {
          body = await readBody(req);
        } catch (error) {
          badRequest(
            res,
            error.message
          );
          return;
        }

        const login =
          String(
            body.email ||
            body.username ||
            body.login ||
            ''
          ).trim();

        const password =
          String(
            body.password ||
            body.senha ||
            ''
          );

        const remember =
          Boolean(
            body.remember
          );


        const user =
          findUserByLogin(login);

        if (
          !user ||
          !passwordMatches(
            user,
            password
          )
        ) {
          json(
            res,
            401,
            {
              ok: false,
              error:
                'E-mail ou senha incorretos.'
            }
          );

          return;
        }

        const token =
          createToken();

        sessions.set(
          token,
          {
            role: 'player',
            userId: user.id,
            remember,
            expiresAt:
              Date.now() +
              SESSION_TTL
          }
        );

        setSessionCookie(
          res,
          token
        );

        json(
          res,
          200,
          {
            ok: true,
            token,
            role: 'player',
            user:
              publicUser(user)
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/logout'
      ) {
        const token =
          getBearerToken(req);

        if (token) {
          sessions.delete(token);
          sessions.delete(
            `admin:${token}`
          );
        }

        clearSessionCookie(res);

        json(
          res,
          200,
          {
            ok: true
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/me'
      ) {
        const session =
          getSession(req);

        if (
          session &&
          session.role === 'admin'
        ) {
          json(
            res,
            200,
            {
              ok: true,
              role: 'admin',
              user: {
                name:
                  'Administrator',
                role: 'admin'
              }
            }
          );

          return;
        }

        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        json(
          res,
          200,
          {
            ok: true,
            role: 'player',
            user:
              publicUser(user),
            streaming: {
              ...streaming
            }
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/packages'
      ) {
        json(
          res,
          200,
          {
            ok: true,

            // O catálogo antigo não é mais
            // utilizado para novas compras.
            packages: [],

            minutesRateCents:
              database.minutesRateCents,

            serverProfile:
              standardServerProfile
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/servers'
      ) {
        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        const userServers =
          servers.filter(
            (serverItem) =>
              Number(
                serverItem.userId
              ) === Number(user.id)
          );

        json(
          res,
          200,
          {
            ok: true,
            servers:
              userServers
          }
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/api/orders'
      ) {
        const session =
          getSession(req);

        if (!session) {
          unauthorized(res);
          return;
        }

        if (
          session.role === 'admin'
        ) {
          json(
            res,
            200,
            {
              ok: true,
              orders: orders
            }
          );

          return;
        }

        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        json(
          res,
          200,
          {
            ok: true,

            orders:
              orders.filter(
                (order) =>
                  Number(
                    order.userId
                  ) ===
                  Number(user.id)
              )
          }
        );

        return;
      }

      if (
        method === 'POST' &&
        pathname === '/api/orders'
      ) {
        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        let body;

        try {
          body = await readBody(req);
        } catch (error) {
          badRequest(
            res,
            error.message
          );
          return;
        }

        const minutes =
          Number(
            body.minutes || 0
          );

        if (
          !Number.isSafeInteger(
            minutes
          ) ||
          minutes < 1 ||
          minutes > 50000
        ) {
          badRequest(
            res,
            'Informe uma quantidade válida de minutos.'
          );
          return;
        }

        const rate =
          Number(
            database.minutesRateCents
          );

        const totalCents =
          minutes * rate;

        const order = {
          id:
            crypto
              .randomBytes(8)
              .toString('hex'),

          userId:
            user.id,

          packageId:
            null,

          packageName:
            'Tempo GameCloud',

          minutes,

          packagePriceCents:
            0,

          minutesPriceCents:
            totalCents,

          totalCents,

          status:
            'PENDENTE',

          createdAt:
            new Date().toISOString()
        };

        orders.push(order);

        saveDatabase();

        json(
          res,
          201,
          {
            ok: true,
            order
          }
        );

        return;
      }
            if (
        method === 'POST' &&
        pathname === '/api/me/profile'
      ) {
        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        try {
          const body =
            await readBody(req);

          const name =
            String(
              body.name || ''
            ).trim();

          if (
            name.length < 2 ||
            name.length > 60
          ) {
            badRequest(
              res,
              'O nome deve ter entre 2 e 60 caracteres.'
            );
            return;
          }

          user.name = name;

          saveDatabase();

          json(
            res,
            200,
            {
              ok: true,
              user:
                publicUser(user)
            }
          );

          return;
        } catch (error) {
          serverError(
            res,
            'Não foi possível salvar o perfil.'
          );

          return;
        }
      }

      /*
       * SUPORTE DO JOGADOR
       */

      if (
        pathname === '/api/support' &&
        (
          method === 'GET' ||
          method === 'POST'
        )
      ) {
        const user =
          getCurrentUser(req);

        if (!user) {
          unauthorized(res);
          return;
        }

        if (
          method === 'GET'
        ) {
          json(
            res,
            200,
            {
              ok: true,
              tickets:
                tickets.filter(
                  (item) =>
                    Number(
                      item.userId
                    ) ===
                    Number(user.id)
                )
            }
          );

          return;
        }

        try {
          const body =
            await readBody(req);

          const subject =
            String(
              body.subject || ''
            ).trim();

          const message =
            String(
              body.message || ''
            ).trim();

          if (
            subject.length < 3 ||
            subject.length > 100 ||
            message.length < 10 ||
            message.length > 2000
          ) {
            badRequest(
              res,
              'Informe um assunto de 3 a 100 caracteres e uma mensagem de 10 a 2000 caracteres.'
            );

            return;
          }

          const ticket = {
            id:
              crypto.randomUUID(),

            userId:
              user.id,

            userName:
              user.name,

            email:
              user.email,

            subject,

            message,

            status:
              'ABERTO',

            createdAt:
              new Date().toISOString()
          };

          tickets.unshift(ticket);

          saveDatabase();

          json(
            res,
            201,
            {
              ok: true,
              ticket
            }
          );

          return;
        } catch (error) {
          serverError(
            res,
            'Não foi possível registrar o chamado.'
          );

          return;
        }
      }

      /*
       * CONFIGURAÇÃO VISUAL
       */

      if (
        method === 'POST' &&
        pathname === '/api/admin/site-config'
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

          const input =
            body.siteConfig;

          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input)
          ) {
            badRequest(
              res,
              'Informe uma configuração visual válida.'
            );

            return;
          }

          const textValue = (
            value,
            fallback,
            maxLength
          ) => {
            if (
              typeof value !==
              'string'
            ) {
              return fallback;
            }

            const result =
              value
                .trim()
                .slice(
                  0,
                  maxLength
                );

            return (
              result ||
              fallback
            );
          };

          const colorValue = (
            value,
            fallback
          ) => {
            if (
              typeof value !==
              'string'
            ) {
              return fallback;
            }

            const valueTrimmed =
              value.trim();

            return /^#[0-9a-fA-F]{6}$/
              .test(valueTrimmed)
              ? valueTrimmed
              : fallback;
          };

          const previous =
            database.siteConfig ||
            defaultSiteConfig;

          const home =
            input.home &&
            typeof input.home ===
              'object'
              ? input.home
              : {};

          const theme =
            input.theme &&
            typeof input.theme ===
              'object'
              ? input.theme
              : {};

          const heroImage =
            textValue(
              home.heroImage,
              previous.home.heroImage,
              850000
            );

          if (
            heroImage !==
              'imperio-usuario.png' &&
            !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(
              heroImage
            )
          ) {
            badRequest(
              res,
              'A imagem da tela inicial deve ser PNG, JPG ou WEBP.'
            );

            return;
          }

          database.siteConfig = {
            brandName:
              textValue(
                input.brandName,
                defaultSiteConfig.brandName,
                80
              ),

            authTitle:
              textValue(
                input.authTitle,
                defaultSiteConfig.authTitle,
                100
              ),

            authText:
              textValue(
                input.authText,
                defaultSiteConfig.authText,
                300
              ),

            home: {
              eyebrow:
                textValue(
                  home.eyebrow,
                  defaultSiteConfig.home.eyebrow,
                  100
                ),

              title:
                textValue(
                  home.title,
                  defaultSiteConfig.home.title,
                  140
                ),

              text:
                textValue(
                  home.text,
                  defaultSiteConfig.home.text,
                  400
                ),

              primaryButton:
                textValue(
                  home.primaryButton,
                  defaultSiteConfig.home.primaryButton,
                  50
                ),

              secondaryButton:
                textValue(
                  home.secondaryButton,
                  defaultSiteConfig.home.secondaryButton,
                  50
                ),

              heroImage
            },

            theme: {
              gold:
                colorValue(
                  theme.gold,
                  defaultSiteConfig.theme.gold
                ),

              background:
                colorValue(
                  theme.background,
                  defaultSiteConfig.theme.background
                )
            }
          };

          saveDatabase();

          json(
            res,
            200,
            {
              ok: true,
              siteConfig:
                database.siteConfig
            }
          );

          return;
        } catch (error) {
          console.error(
            'Erro ao salvar configuração visual:',
            error
          );

          serverError(
            res,
            'Não foi possível salvar a configuração visual.'
          );

          return;
        }
      }

      /*
       * ENDPOINTS ADMINISTRATIVOS
       */

      if (
        pathname.startsWith(
          '/api/admin/'
        )
      ) {
        const admin =
          getAdminSession(req);

        if (!admin) {
          unauthorized(res);
          return;
        }

        if (
          method === 'GET' &&
          pathname === '/api/admin/stream/agents'
        ) {
          json(res, 200, {
            ok: true,
            agents: publicAgents()
          });
          return;
        }

        /*
         * VISÃO GERAL
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/overview'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              users:
                users.map(
                  (user) => ({
                    id: user.id,
                    name: user.name,
                    username:
                      user.username,
                    email:
                      user.email,
                    minutes:
                      Number(
                        user.minutes ||
                        0
                      ),
                    online: false
                  })
                ),

              streaming: {
                ...streaming
              },

              servers:
                servers.map(
                  (item) => ({
                    ...item,

                    userName:
                      (
                        users.find(
                          (user) =>
                            Number(
                              user.id
                            ) ===
                            Number(
                              item.userId
                            )
                        ) || {}
                      ).name ||
                      'Sem vínculo'
                  })
                ),

              orders:
                orders.map(
                  (item) => ({
                    ...item,

                    userName:
                      (
                        users.find(
                          (user) =>
                            Number(
                              user.id
                            ) ===
                            Number(
                              item.userId
                            )
                        ) || {}
                      ).name ||
                      'Usuário removido'
                  })
                ),

              tickets:
                tickets.map(
                  (item) => ({
                    ...item
                  })
                ),

              /*
               * Os pacotes antigos continuam
               * somente para compatibilidade
               * com dados históricos.
               *
               * Novas compras usam apenas
               * minutos.
               */

              packages:
                packages.map(
                  (item) => ({
                    ...item
                  })
                ),

              minutesRateCents:
                database.minutesRateCents,

              serverProfile:
                standardServerProfile
            }
          );

          return;
        }

        /*
         * STATUS DO STREAMING PARA ADMIN
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/stream'
        ) {
          json(
            res,
            200,
            {
              ok: true,
              streaming: {
                ...streaming
              }
            }
          );

          return;
        }

        /*
         * SERVIDORES DO ADMIN
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/servers'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              servers:
                servers.map(
                  (item) => ({
                    ...item,

                    userName:
                      (
                        users.find(
                          (user) =>
                            Number(
                              user.id
                            ) ===
                            Number(
                              item.userId
                            )
                        ) || {}
                      ).name ||
                      'Sem vínculo'
                  })
                )
            }
          );

          return;
        }

        /*
         * PEDIDOS DO ADMIN
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/orders'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              orders:
                orders.map(
                  (item) => ({
                    ...item,

                    userName:
                      (
                        users.find(
                          (user) =>
                            Number(
                              user.id
                            ) ===
                            Number(
                              item.userId
                            )
                        ) || {}
                      ).name ||
                      'Usuário removido'
                  })
                )
            }
          );

          return;
        }

        /*
         * CATÁLOGO DO ADMIN
         *
         * Não existem mais pacotes
         * para novas compras.
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/packages'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              packages: [],

              minutesRateCents:
                database.minutesRateCents,

              serverProfile:
                standardServerProfile
            }
          );

          return;
        }

        /*
         * ALTERAR PREÇO POR MINUTO
         */

        if (
          method === 'POST' &&
          pathname ===
            '/api/admin/minutes-price'
        ) {
          try {
            const body =
              await readBody(req);

            const cents =
              Number(
                body.priceCents
              );

            if (
              !Number.isSafeInteger(
                cents
              ) ||
              cents < 0 ||
              cents > 100000
            ) {
              badRequest(
                res,
                'Informe um valor por minuto válido.'
              );

              return;
            }

            database.minutesRateCents =
              cents;

            saveDatabase();

            json(
              res,
              200,
              {
                ok: true,

                minutesRateCents:
                  cents
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível salvar o preço dos minutos.'
            );

            return;
          }
        }

        /*
         * CRIAR OU EDITAR SERVIDOR
         */

        if (
          method === 'POST' &&
          pathname ===
            '/api/admin/servers'
        ) {
          try {
            const body =
              await readBody(req);

            const name =
              String(
                body.name ||
                  'Servidor GameCloud'
              ).trim();

            const type =
              String(
                body.type ||
                  standardServerProfile.type
              ).trim();

            const userId =
              body.userId === '' ||
              body.userId === null ||
              typeof body.userId ===
                'undefined'
                ? null
                : Number(
                    body.userId
                  );

            // Configuração única: sempre usa o perfil básico antigo.
            const ram =
              standardServerProfile.ram;

            const vcpu =
              standardServerProfile.vcpu;

            const storage =
              standardServerProfile.storage;

            const gpu =
              standardServerProfile.gpu;

            const status =
              String(
                body.status ||
                  'offline'
              );

            if (
              !name ||
              name.length > 80 ||
              !type ||
              type.length > 40 ||
              !Number.isSafeInteger(
                ram
              ) ||
              ram < 1 ||
              ram > 512 ||
              !Number.isSafeInteger(
                vcpu
              ) ||
              vcpu < 1 ||
              vcpu > 128 ||
              !Number.isSafeInteger(
                storage
              ) ||
              storage < 1 ||
              storage > 10000 ||
              !gpu ||
              gpu.length > 100 ||
              ![
                'offline',
                'online',
                'provisioning',
                'error'
              ].includes(status)
            ) {
              badRequest(
                res,
                'Revise os dados do servidor.'
              );

              return;
            }

            if (
              userId !== null &&
              !users.some(
                (item) =>
                  Number(
                    item.id
                  ) ===
                  Number(userId)
              )
            ) {
              badRequest(
                res,
                'Usuário vinculado não encontrado.'
              );

              return;
            }

            const serverId =
              body.id
                ? String(body.id)
                : crypto.randomUUID();

            const existingIndex =
              servers.findIndex(
                (item) =>
                  item.id ===
                  serverId
              );

            const now =
              new Date().toISOString();

            const entry = {
              id:
                serverId,

              name,

              type,

              userId,

              agentId:
                String(
                  body.agentId ||
                  'PC-GAMECLOUD'
                ).trim() || 'PC-GAMECLOUD',

              ram,

              vcpu,

              gpu,

              storage,

              status,

              updatedAt:
                now
            };

            if (
              existingIndex >= 0
            ) {
              servers[
                existingIndex
              ] = {
                ...servers[
                  existingIndex
                ],
                ...entry
              };
            } else {
              entry.createdAt =
                now;

              servers.push(
                entry
              );
            }

            saveDatabase();

            json(
              res,
              existingIndex >=
                0
                ? 200
                : 201,
              {
                ok: true,
                server: entry
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível salvar o servidor.'
            );

            return;
          }
        }

        /*
         * EXCLUIR SERVIDOR
         */

        const deleteServer =
          pathname.match(
            /^\/api\/admin\/servers\/([^/]+)\/delete$/
          );

        if (
          method === 'POST' &&
          deleteServer
        ) {
          const serverId =
            decodeURIComponent(
              deleteServer[1]
            );

          const index =
            servers.findIndex(
              (item) =>
                item.id ===
                serverId
            );

          if (
            index < 0
          ) {
            notFound(res);
            return;
          }

          servers.splice(
            index,
            1
          );

          saveDatabase();

          json(
            res,
            200,
            {
              ok: true
            }
          );

          return;
        }

        /*
         * CONTROLE DE SERVIDOR
         *
         * O painel não finge que iniciou
         * um servidor quando não existe
         * agente de infraestrutura conectado.
         */

        const lifecycle =
          pathname.match(
            /^\/api\/admin\/servers\/([^/]+)\/(start|stop)$/
          );

        if (
          method === 'POST' &&
          lifecycle
        ) {
          const serverId =
            decodeURIComponent(
              lifecycle[1]
            );

          const serverItem =
            servers.find(
              (item) =>
                item.id ===
                serverId
            );

          if (!serverItem) {
            notFound(res);
            return;
          }

          json(
            res,
            409,
            {
              ok: false,

              error:
                'Controle de energia indisponível: não há agente de infraestrutura de servidores conectado. O status real não foi alterado.'
            }
          );

          return;
        }

        /*
         * CHAMADOS DO ADMIN
         */

        if (
          method === 'GET' &&
          pathname ===
            '/api/admin/support'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              tickets:
                tickets.map(
                  (item) => ({
                    ...item
                  })
                )
            }
          );

          return;
        }

        /*
         * APROVAR PEDIDO
         */

        const approve =
          pathname.match(
            /^\/api\/admin\/orders\/([^/]+)\/approve$/
          );

        if (
          method === 'POST' &&
          approve
        ) {
          const orderId =
            decodeURIComponent(
              approve[1]
            );

          const order =
            orders.find(
              (item) =>
                item.id ===
                orderId
            );

          if (!order) {
            notFound(res);
            return;
          }

          if (
            order.status ===
            'PENDENTE'
          ) {
            const user =
              users.find(
                (item) =>
                  Number(
                    item.id
                  ) ===
                  Number(
                    order.userId
                  )
              );

            if (!user) {
              json(
                res,
                409,
                {
                  ok: false,

                  error:
                    'O usuário deste pedido não existe mais.'
                }
              );

              return;
            }

            /*
             * A compra agora adiciona
             * somente minutos.
             */

            const purchasedMinutes =
              Number(
                order.minutes || 0
              );

            if (
              !Number.isSafeInteger(
                purchasedMinutes
              ) ||
              purchasedMinutes <
                1
            ) {
              json(
                res,
                409,
                {
                  ok: false,

                  error:
                    'Este pedido possui uma quantidade de minutos inválida.'
                }
              );

              return;
            }

            user.minutes =
              Number(
                user.minutes || 0
              ) +
              purchasedMinutes;

            /*
             * Cria somente um servidor
             * padrão caso o usuário ainda
             * não possua um.
             */

            const userHasServer =
              servers.some(
                (item) =>
                  Number(
                    item.userId
                  ) ===
                  Number(
                    user.id
                  )
              );

            if (
              !userHasServer
            ) {
              const now =
                new Date().toISOString();

              servers.push({
                id:
                  crypto.randomUUID(),

                name:
                  `${user.name} • FiveM`,

                type:
                  standardServerProfile.type,

                userId:
                  user.id,

                ram:
                  standardServerProfile.ram,

                vcpu:
                  standardServerProfile.vcpu,

                gpu:
                  standardServerProfile.gpu,

                storage:
                  standardServerProfile.storage,

                status:
                  'offline',

                createdAt:
                  now,

                updatedAt:
                  now
              });
            }

            order.status =
              'APROVADO';

            order.approvedAt =
              new Date().toISOString();

            order.paymentMessage =
              'Aprovado manualmente pelo administrador.';

            saveDatabase();
          }

          json(
            res,
            200,
            {
              ok: true,
              order
            }
          );

          return;
        }
                /*
         * INICIAR FIVEM PELO USUÁRIO
         *
         * O comando é enviado ao agente do PC.
         * O servidor não finge que o jogo iniciou:
         * ele somente coloca o comando na fila.
         */

        if (
          method === 'POST' &&
          pathname === '/api/stream/start'
        ) {
          const user =
            getCurrentUser(req);

          if (!user) {
            unauthorized(res);
            return;
          }

          if (!streaming.enabled) {
            json(
              res,
              409,
              {
                ok: false,
                error:
                  'O streaming está desativado pelo administrador.'
              }
            );

            return;
          }

          const userServer =
            servers.find(
              (item) =>
                Number(
                  item.userId
                ) ===
                Number(user.id)
            );

          if (!userServer) {
            json(
              res,
              404,
              {
                ok: false,
                error:
                  'Você ainda não possui um servidor vinculado.'
              }
            );

            return;
          }

          const minutes =
            Number(
              user.minutes || 0
            );

          if (
            !Number.isSafeInteger(
              minutes
            ) ||
            minutes < 1
          ) {
            json(
              res,
              402,
              {
                ok: false,
                error:
                  'Você não possui minutos disponíveis.'
              }
            );

            return;
          }

          const command = {
            id:
              crypto.randomUUID(),

            type:
              'START_FIVEM',

            agentId:
              String(userServer.agentId || 'PC-GAMECLOUD'),

            userId:
              user.id,

            serverId:
              userServer.id,

            game:
              'FiveM',

            createdAt:
              new Date().toISOString()
          };

          agentCommands.push(
            command
          );

          streaming.status =
            'starting';

          streaming.game =
            'FiveM';

          streaming.host =
            'PC-GAMECLOUD';

          streaming.message =
            'Comando de inicialização enviado ao PC de streaming.';

          json(
            res,
            200,
            {
              ok: true,

              message:
                'Comando enviado. Aguardando o PC de streaming.',

              commandId:
                command.id,

              streaming: {
                ...streaming
              }
            }
          );

          return;
        }

        /*
         * PARAR FIVEM
         */

        if (
          method === 'POST' &&
          pathname === '/api/stream/stop'
        ) {
          const user =
            getCurrentUser(req);

          if (!user) {
            unauthorized(res);
            return;
          }

          const userServer =
            servers.find(
              (item) =>
                Number(
                  item.userId
                ) ===
                Number(user.id)
            );

          if (!userServer) {
            json(
              res,
              404,
              {
                ok: false,
                error:
                  'Servidor não encontrado.'
              }
            );

            return;
          }

          const command = {
            id:
              crypto.randomUUID(),

            type:
              'STOP_FIVEM',

            agentId:
              String(userServer.agentId || 'PC-GAMECLOUD'),

            userId:
              user.id,

            serverId:
              userServer.id,

            game:
              'FiveM',

            createdAt:
              new Date().toISOString()
          };

          agentCommands.push(
            command
          );

          streaming.status =
            'stopping';

          streaming.message =
            'Comando para parar o FiveM enviado ao PC de streaming.';

          json(
            res,
            200,
            {
              ok: true,

              message:
                'Comando para parar o FiveM enviado.',

              commandId:
                command.id,

              streaming: {
                ...streaming
              }
            }
          );

          return;
        }

        /*
         * HEARTBEAT DO USUÁRIO
         *
         * Permite consultar se o streaming
         * está vivo sem alterar o estado.
         */

        if (
          method === 'GET' &&
          pathname === '/api/stream/status'
        ) {
          json(
            res,
            200,
            {
              ok: true,

              streaming: {
                ...streaming
              }
            }
          );

          return;
        }

        /*
         * ADMIN — ALTERAR ESTADO DO STREAMING
         */

        if (
          method === 'POST' &&
          pathname ===
            '/api/admin/stream/toggle'
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

            streaming.enabled =
              Boolean(
                body.enabled
              );

            if (
              !streaming.enabled
            ) {
              streaming.status =
                'offline';

              streaming.message =
                'Streaming desativado pelo administrador.';
            } else if (
              streaming.status ===
              'offline'
            ) {
              streaming.message =
                'Aguardando o PC de streaming.';
            }

            json(
              res,
              200,
              {
                ok: true,

                streaming: {
                  ...streaming
                }
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível alterar o streaming.'
            );

            return;
          }
        }

        /*
         * ADMIN — LISTAR AGENTES
         */
        if (
          method === 'GET' &&
          pathname === '/api/admin/stream/agents'
        ) {
          if (!getAdminSession(req)) {
            unauthorized(res);
            return;
          }
          json(res, 200, { ok: true, agents: publicAgents() });
          return;
        }

        /*
         * ADMIN — ATUALIZAR STATUS
         */

        if (
          method === 'POST' &&
          pathname ===
            '/api/admin/stream/status'
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

            const allowed = [
              'offline',
              'online',
              'starting',
              'stopping',
              'error'
            ];

            const status =
              String(
                body.status ||
                  'offline'
              );

            if (
              !allowed.includes(
                status
              )
            ) {
              badRequest(
                res,
                'Status de streaming inválido.'
              );

              return;
            }

            streaming.status =
              status;

            streaming.lastHeartbeat =
              new Date().toISOString();

            if (
              typeof body.message ===
              'string'
            ) {
              streaming.message =
                body.message
                  .trim()
                  .slice(0, 300);
            }

            json(
              res,
              200,
              {
                ok: true,

                streaming: {
                  ...streaming
                }
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível atualizar o status.'
            );

            return;
          }
        }

        /*
         * ADMIN — RESPONDER CHAMADO
         */

        const ticketReply =
          pathname.match(
            /^\/api\/admin\/support\/([^/]+)$/
          );

        if (
          method === 'POST' &&
          ticketReply
        ) {
          const ticketId =
            decodeURIComponent(
              ticketReply[1]
            );

          const ticket =
            tickets.find(
              (item) =>
                item.id ===
                ticketId
            );

          if (!ticket) {
            notFound(res);
            return;
          }

          try {
            const body =
              await readBody(req);

            const status =
              String(
                body.status ||
                  ticket.status ||
                  'ABERTO'
              );

            const allowed =
              [
                'ABERTO',
                'EM_ANALISE',
                'RESPONDIDO',
                'FECHADO'
              ];

            if (
              !allowed.includes(
                status
              )
            ) {
              badRequest(
                res,
                'Status de chamado inválido.'
              );

              return;
            }

            ticket.status =
              status;

            if (
              typeof body.reply ===
              'string'
            ) {
              ticket.reply =
                body.reply
                  .trim()
                  .slice(0, 4000);

              ticket.repliedAt =
                new Date().toISOString();
            }

            ticket.updatedAt =
              new Date().toISOString();

            saveDatabase();

            json(
              res,
              200,
              {
                ok: true,
                ticket
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível atualizar o chamado.'
            );

            return;
          }
        }

        /*
         * ADMIN — ADICIONAR MINUTOS
         */

        const addMinutes =
          pathname.match(
            /^\/api\/admin\/users\/([^/]+)\/minutes$/
          );

        if (
          method === 'POST' &&
          addMinutes
        ) {
          const userId =
            Number(
              decodeURIComponent(
                addMinutes[1]
              )
            );

          const user =
            users.find(
              (item) =>
                Number(
                  item.id
                ) === userId
            );

          if (!user) {
            notFound(res);
            return;
          }

          try {
            const body =
              await readBody(req);

            const minutes =
              Number(
                body.minutes
              );

            if (
              !Number.isSafeInteger(
                minutes
              ) ||
              minutes < -50000 ||
              minutes > 50000
            ) {
              badRequest(
                res,
                'Quantidade de minutos inválida.'
              );

              return;
            }

            user.minutes =
              Math.max(
                0,
                Number(
                  user.minutes || 0
                ) +
                  minutes
              );

            saveDatabase();

            json(
              res,
              200,
              {
                ok: true,

                user:
                  publicUser(
                    user
                  )
              }
            );

            return;
          } catch (error) {
            serverError(
              res,
              'Não foi possível alterar os minutos.'
            );

            return;
          }
        }

        /*
         * ROTA ADMIN DESCONHECIDA
         */

        notFound(res);
        return;
      }

      /*
       * ARQUIVOS DO SITE
       */

      if (
        method === 'GET' &&
        (
          pathname === '/' ||
          pathname === '/index.html'
        )
      ) {
        const file =
          path.join(
            __dirname,
            'index.html'
          );

        if (
          fs.existsSync(file)
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8',

              'Cache-Control':
                'no-cache'
            }
          );

          res.end(
            fs.readFileSync(
              file
            )
          );

          return;
        }

        text(
          res,
          404,
          'index.html não encontrado.'
        );

        return;
      }

      if (
        method === 'GET' &&
        pathname === '/app.js'
      ) {
        const file =
          path.join(
            __dirname,
            'app.js'
          );

        if (
          fs.existsSync(file)
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/javascript; charset=utf-8',

              'Cache-Control':
                'no-cache'
            }
          );

          res.end(
            fs.readFileSync(
              file
            )
          );

          return;
        }

        text(
          res,
          404,
          'app.js não encontrado.'
        );

        return;
      }

      /*
       * ARQUIVOS ESTÁTICOS SIMPLES
       */

      const publicFiles = {
        '/favicon.ico': {
          file:
            path.join(
              __dirname,
              'favicon.ico'
            ),

          type:
            'image/x-icon'
        },

        '/imperio-usuario.png': {
          file:
            path.join(
              __dirname,
              'imperio-usuario.png'
            ),

          type:
            'image/png'
        }
      };

      const publicFile =
        publicFiles[pathname];

      if (
        method === 'GET' &&
        publicFile
      ) {
        if (
          fs.existsSync(
            publicFile.file
          )
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                publicFile.type,

              'Cache-Control':
                'public, max-age=3600'
            }
          );

          res.end(
            fs.readFileSync(
              publicFile.file
            )
          );

          return;
        }

        notFound(res);
        return;
      }

      /*
       * ROTA NÃO ENCONTRADA
       */

      notFound(res);
    }
  );

server.on(
  'error',
  (error) => {
    console.error(
      'Erro no servidor:',
      error
    );
  }
);

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Império GameCloud iniciado na porta ${PORT}`
    );
  }
);

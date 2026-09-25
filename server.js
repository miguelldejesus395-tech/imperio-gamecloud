'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DB = path.join(ROOT, 'data', 'users.json');

const ADMIN_USER = String(
  process.env.ADMIN_USER || ''
)
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD = String(
  process.env.ADMIN_PASSWORD || ''
);

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
  message: 'Aguardando o computador GameCloud'
};

fs.mkdirSync(path.dirname(DB), {
  recursive: true
});

let users = {};

try {
  const raw = fs.readFileSync(DB, 'utf8');
  users = JSON.parse(raw);

  if (
    !users ||
    typeof users !== 'object' ||
    Array.isArray(users)
  ) {
    users = {};
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(
      'Erro ao carregar users.json:',
      error
    );
  }

  users = {};
}

function save() {
  const tmp = DB + '.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify(users, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  fs.renameSync(tmp, DB);
}

function digest(password, salt) {
  return crypto
    .scryptSync(
      String(password),
      String(salt),
      64
    )
    .toString('hex');
}

function verify(password, user) {
  if (
    !user ||
    !user.salt ||
    !user.hash
  ) {
    return false;
  }

  try {
    const calculated = Buffer.from(
      digest(password, user.salt),
      'hex'
    );

    const stored = Buffer.from(
      String(user.hash),
      'hex'
    );

    if (
      calculated.length !==
      stored.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      calculated,
      stored
    );
  } catch (error) {
    return false;
  }
}

function json(res, status, data) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,X-Stream-Agent-Key',
    'Content-Type':
      'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options':
      'nosniff',
    'X-Frame-Options':
      'DENY',
    'Content-Security-Policy':
      "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';base-uri 'none';frame-ancestors 'none'"
  });

  res.end(JSON.stringify(data));
}

function read(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    req.on('data', chunk => {
      if (finished) {
        return;
      }

      size += chunk.length;

      if (size > 32768) {
        finished = true;

        reject(
          new Error('Pedido muito grande')
        );

        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (finished) {
        return;
      }

      finished = true;

      try {
        const text = Buffer
          .concat(chunks)
          .toString('utf8');

        if (!text.trim()) {
          resolve({});
          return;
        }

        resolve(JSON.parse(text));
      } catch (error) {
        reject(
          new Error('JSON inválido')
        );
      }
    });

    req.on('error', error => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    });
  });
}

function getToken(req) {
  return String(
    req.headers.authorization || ''
  )
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function getSession(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  const current =
    sessions.get(token);

  if (
    !current ||
    current.exp <= Date.now()
  ) {
    sessions.delete(token);
    return null;
  }

  return current;
}

function rateLimited(ip) {
  const now = Date.now();

  let record =
    attempts.get(ip);

  if (
    !record ||
    now - record.at > 60000
  ) {
    record = {
      n: 0,
      at: now
    };
  }

  record.n++;

  attempts.set(
    ip,
    record
  );

  return record.n > 40;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function agentAuthorized(req) {
  if (!STREAM_AGENT_KEY) {
    return false;
  }

  const key = String(
    req.headers[
      'x-stream-agent-key'
    ] || ''
  );

  if (!key) {
    return false;
  }

  const a =
    Buffer.from(key);

  const b =
    Buffer.from(
      STREAM_AGENT_KEY
    );

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

function cleanupStreamingHeartbeat() {
  if (
    streaming.lastHeartbeat &&
    Date.now() -
      streaming.lastHeartbeat >
      90000
  ) {
    streaming.status =
      'offline';

    streaming.message =
      'Computador GameCloud sem comunicação';
  }
}

function createSession(
  role,
  email,
  remember
) {
  const token =
    crypto
      .randomBytes(32)
      .toString('base64url');

  const duration =
    remember
      ? 30 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

  sessions.set(
    token,
    {
      role,
      email,
      exp:
        Date.now() +
        duration
    }
  );

  return token;
}

function onlinePlayers() {
  return new Set(
    [...sessions.values()]
      .filter(item =>
        item.role === 'player' &&
        item.exp > Date.now()
      )
      .map(item =>
        item.email
      )
  );
}

const server =
  http.createServer(
    async (req, res) => {
      let pathname;

      try {
        pathname =
          new URL(
            req.url,
            'http://localhost'
          ).pathname;
      } catch (error) {
        return json(
          res,
          400,
          {
            error:
              'URL inválida'
          }
        );
      }

      if (
        req.method ===
        'OPTIONS'
      ) {
        res.writeHead(
          204,
          {
            'Access-Control-Allow-Origin':
              '*',
            'Access-Control-Allow-Methods':
              'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type,Authorization,X-Stream-Agent-Key'
          }
        );

        return res.end();
      }

      /*
       * ARQUIVOS
       */

      if (
        req.method === 'GET' &&
        pathname === '/'
      ) {
        const file =
          path.join(
            ROOT,
            'index.html'
          );

        if (
          !fs.existsSync(file)
        ) {
          return json(
            res,
            404,
            {
              error:
                'index.html não encontrado'
            }
          );
        }

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/html; charset=utf-8',
            'Cache-Control':
              'no-store'
          }
        );

        return fs
          .createReadStream(file)
          .pipe(res);
      }

      if (
        req.method === 'GET' &&
        pathname === '/app.js'
      ) {
        const file =
          path.join(
            ROOT,
            'app.js'
          );

        if (
          !fs.existsSync(file)
        ) {
          return json(
            res,
            404,
            {
              error:
                'app.js não encontrado'
            }
          );
        }

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/javascript; charset=utf-8',
            'Cache-Control':
              'no-store'
          }
        );

        return fs
          .createReadStream(file)
          .pipe(res);
      }

      /*
       * HEALTH
       */

      if (
        req.method === 'GET' &&
        pathname ===
          '/api/health'
      ) {
        cleanupStreamingHeartbeat();

        return json(
          res,
          200,
          {
            ok: true,
            version:
              '4.1.0',
            streaming: {
              enabled:
                streaming.enabled,
              status:
                streaming.status
            }
          }
        );
      }

      /*
       * STATUS DO STREAM
       */

      if (
        req.method === 'GET' &&
        pathname ===
          '/api/stream/status'
      ) {
        cleanupStreamingHeartbeat();

        return json(
          res,
          200,
          {
            ok: true,
            enabled:
              streaming.enabled,
            status:
              streaming.status,
            game:
              streaming.game,
            host:
              streaming.host,
            message:
              streaming.message,
            lastHeartbeat:
              streaming.lastHeartbeat
          }
        );
      }

      if (
        !pathname.startsWith(
          '/api/'
        )
      ) {
        return json(
          res,
          404,
          {
            error:
              'Página não encontrada'
          }
        );
      }

      const ip =
        req.socket
          .remoteAddress ||
        'local';

      const authPath =
        pathname ===
          '/api/login' ||
        pathname ===
          '/api/users/register' ||
        pathname ===
          '/api/password/forgot' ||
        pathname ===
          '/api/password/reset';

      if (
        req.method === 'POST' &&
        authPath &&
        rateLimited(ip)
      ) {
        return json(
          res,
          429,
          {
            error:
              'Aguarde um minuto e tente novamente'
          }
        );
      }

      try {
        const body =
          req.method === 'POST'
            ? await read(req)
            : {};

        const session =
          getSession(req);

        const email =
          String(
            body.email || ''
          )
            .trim()
            .toLowerCase();

        /*
         * CADASTRO
         */

        if (
          pathname ===
            '/api/users/register' &&
          req.method === 'POST'
        ) {
          const password =
            String(
              body.password || ''
            );

          const name =
            String(
              body.name ||
                'Jogador'
            )
              .trim()
              .slice(0, 60);

          if (
            !validEmail(email) ||
            password.length < 8
          ) {
            return json(
              res,
              400,
              {
                error:
                  'Informe e-mail válido e senha com 8 caracteres ou mais'
              }
            );
          }

          if (
            users[email] ||
            (
              ADMIN_USER &&
              email ===
                ADMIN_USER
            )
          ) {
            return json(
              res,
              409,
              {
                error:
                  'E-mail já cadastrado'
              }
            );
          }

          const salt =
            crypto
              .randomBytes(16)
              .toString('hex');

          users[email] = {
            email,
            name:
              name ||
              'Jogador',
            salt,
            hash:
              digest(
                password,
                salt
              ),
            minutes: 0
          };

          save();

          console.log(
            'Novo jogador cadastrado:',
            email
          );

          return json(
            res,
            201,
            {
              ok: true,
              message:
                'Conta criada com sucesso'
            }
          );
        }

        /*
         * LOGIN
         */

        if (
          pathname ===
            '/api/login' &&
          req.method === 'POST'
        ) {
          const password =
            String(
              body.password || ''
            );

          let role = '';

          if (
            ADMIN_USER &&
            ADMIN_PASSWORD &&
            email ===
              ADMIN_USER
          ) {
            const enteredHash =
              crypto
                .createHash(
                  'sha256'
                )
                .update(password)
                .digest();

            const storedHash =
              crypto
                .createHash(
                  'sha256'
                )
                .update(
                  ADMIN_PASSWORD
                )
                .digest();

            if (
              crypto.timingSafeEqual(
                enteredHash,
                storedHash
              )
            ) {
              role =
                'admin';
            }
          }

          if (
            !role &&
            users[email] &&
            verify(
              password,
              users[email]
            )
          ) {
            role =
              'player';
          }

          if (!role) {
            console.log(
              'Falha de login:',
              email
            );

            return json(
              res,
              401,
              {
                error:
                  'E-mail ou senha incorretos'
              }
            );
          }

          const token =
            createSession(
              role,
              email,
              body.remember ===
                true
            );

          const user =
            users[email];

          return json(
            res,
            200,
            {
              ok: true,
              token,
              role,
              user: {
                email,
                name:
                  role ===
                  'admin'
                    ? 'Administrador'
                    : user?.name ||
                      'Jogador',
                role
              }
            }
          );
        }

        /*
         * USUÁRIO LOGADO
         */

        if (
          pathname ===
            '/api/me' &&
          req.method === 'GET'
        ) {
          if (!session) {
            return json(
              res,
              401,
              {
                error:
                  'Entre na sua conta'
              }
            );
          }

          if (
            session.role ===
            'admin'
          ) {
            return json(
              res,
              200,
              {
                ok: true,
                role:
                  'admin',
                email:
                  session.email,
                name:
                  'Administrador',
                minutes: 0,
                streaming: {
                  enabled:
                    streaming.enabled,
                  status:
                    streaming.status,
                  game:
                    streaming.game
                }
              }
            );
          }

          const user =
            users[
              session.email
            ];

          if (!user) {
            return json(
              res,
              404,
              {
                error:
                  'Jogador não encontrado'
              }
            );
          }

          return json(
            res,
            200,
            {
              ok: true,
              role:
                'player',
              email:
                user.email,
              name:
                user.name ||
                'Jogador',
              minutes:
                Number(
                  user.minutes
                ) || 0,
              streaming: {
                enabled:
                  streaming.enabled,
                status:
                  streaming.status,
                game:
                  streaming.game
              }
            }
          );
        }

        /*
         * INICIAR FIVEM - JOGADOR
         */

        if (
          pathname ===
            '/api/stream/start' &&
          req.method === 'POST'
        ) {
          if (!session) {
            return json(
              res,
              401,
              {
                error:
                  'Entre na sua conta'
              }
            );
          }

          if (
            session.role !==
            'player'
          ) {
            return json(
              res,
              403,
              {
                error:
                  'Esta função é para jogadores'
              }
            );
          }

          if (
            !streaming.enabled
          ) {
            return json(
              res,
              400,
              {
                error:
                  'O streaming está desativado pelo administrador'
              }
            );
          }

          const player =
            users[
              session.email
            ];

          if (!player) {
            return json(
              res,
              404,
              {
                error:
                  'Jogador não encontrado'
              }
            );
          }

          const minutes =
            Number(
              player.minutes
            );

          if (
            !Number.isSafeInteger(
              minutes
            ) ||
            minutes <= 0
          ) {
            return json(
              res,
              400,
              {
                error:
                  'Você não possui minutos disponíveis'
              }
            );
          }

          if (
            streaming.status ===
              'starting' ||
            streaming.status ===
              'online'
          ) {
            return json(
              res,
              409,
              {
                error:
                  'O FiveM já está iniciado ou sendo iniciado'
              }
            );
          }

          player.minutes =
            minutes - 1;

          save();

          streaming.status =
            'starting';

          streaming.message =
            'Jogador ' +
            (
              player.name ||
              'Jogador'
            ) +
            ' solicitou o início do FiveM';

          return json(
            res,
            200,
            {
              ok: true,
              status:
                streaming.status,
              minutes:
                player.minutes,
              message:
                'FiveM solicitado com sucesso'
            }
          );
        }

        /*
         * LOGOUT
         */

        if (
          pathname ===
            '/api/logout' &&
          req.method === 'POST'
        ) {
          const token =
            getToken(req);

          if (token) {
            sessions.delete(
              token
            );
          }

          return json(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /*
         * ESQUECI A SENHA
         */

        if (
          pathname ===
            '/api/password/forgot' &&
          req.method === 'POST'
        ) {
          if (
            users[email]
          ) {
            const resetToken =
              crypto
                .randomBytes(24)
                .toString('hex');

            resetTokens.set(
              resetToken,
              {
                email,
                exp:
                  Date.now() +
                  15 *
                    60 *
                    1000
              }
            );

            console.log(
              '================================'
            );

            console.log(
              'RECUPERAÇÃO DE SENHA'
            );

            console.log(
              'E-mail:',
              email
            );

            console.log(
              'Link:',
              '/?reset=' +
                resetToken
            );

            console.log(
              '================================'
            );
          }

          return json(
            res,
            200,
            {
              message:
                'Se a conta existir, a recuperação foi solicitada. O envio por e-mail requer configuração adicional.'
            }
          );
        }

        /*
         * RESET DE SENHA
         */

        if (
          pathname ===
            '/api/password/reset' &&
          req.method === 'POST'
        ) {
          const resetToken =
            String(
              body.token || ''
            );

          const newPassword =
            String(
              body.password || ''
            );

          const reset =
            resetTokens.get(
              resetToken
            );

          if (
            !reset ||
            reset.exp <=
              Date.now() ||
            newPassword.length <
              8
          ) {
            return json(
              res,
              400,
              {
                error:
                  'Link inválido, expirado ou senha curta'
              }
            );
          }

          const user =
            users[
              reset.email
            ];

          if (!user) {
            resetTokens.delete(
              resetToken
            );

            return json(
              res,
              404,
              {
                error:
                  'Usuário não encontrado'
              }
            );
          }

          user.salt =
            crypto
              .randomBytes(16)
              .toString('hex');

          user.hash =
            digest(
              newPassword,
              user.salt
            );

          save();

          resetTokens.delete(
            resetToken
          );

          return json(
            res,
            200,
            {
              ok: true,
              message:
                'Senha alterada com sucesso'
            }
          );
        }

        /*
         * ADMIN
         */

        if (
          pathname.startsWith(
            '/api/admin/'
          )
        ) {
          if (
            !session ||
            session.role !==
              'admin'
          ) {
            return json(
              res,
              403,
              {
                error:
                  'Acesso exclusivo do administrador'
              }
            );
          }

          /*
           * PAINEL
           */

          if (
            pathname ===
              '/api/admin/overview' &&
            req.method === 'GET'
          ) {
            const online =
              onlinePlayers();

            cleanupStreamingHeartbeat();

            return json(
              res,
              200,
              {
                ok: true,
                users:
                  Object.keys(
                    users
                  ).length,
                playersOnline:
                  online.size,
                version:
                  '4.1.0',
                streaming: {
                  enabled:
                    streaming.enabled,
                  status:
                    streaming.status,
                  game:
                    streaming.game,
                  host:
                    streaming.host,
                  message:
                    streaming.message,
                  lastHeartbeat:
                    streaming.lastHeartbeat
                },
                players:
                  Object.values(
                    users
                  ).map(
                    user => ({
                      email:
                        user.email,
                      name:
                        user.name ||
                        'Jogador',
                      minutes:
                        Number(
                          user.minutes
                        ) || 0,
                      online:
                        online.has(
                          user.email
                        )
                    })
                  )
              }
            );
          }

          /*
           * ADICIONAR MINUTOS
           */

          if (
            pathname ===
              '/api/admin/time/add' &&
            req.method === 'POST'
          ) {
            const playerEmail =
              String(
                body.email || ''
              )
                .trim()
                .toLowerCase();

            const minutes =
              Number(
                body.minutes
              );

            const user =
              users[
                playerEmail
              ];

            if (!user) {
              return json(
                res,
                404,
                {
                  error:
                    'Jogador não encontrado'
                }
              );
            }

            if (
              !Number.isSafeInteger(
                minutes
              ) ||
              minutes < 1 ||
              minutes > 100000
            ) {
              return json(
                res,
                400,
                {
                  error:
                    'Informe de 1 a 100000 minutos'
                }
              );
            }

            user.minutes =
              (
                Number(
                  user.minutes
                ) || 0
              ) +
              minutes;

            save();

            return json(
              res,
              200,
              {
                ok: true,
                minutes:
                  user.minutes
              }
            );
          }

          /*
           * ATIVAR / DESATIVAR STREAM
           */

          if (
            pathname ===
              '/api/admin/stream/toggle' &&
            req.method === 'POST'
          ) {
            if (
              typeof body.enabled !==
              'boolean'
            ) {
              return json(
                res,
                400,
                {
                  error:
                    'Informe enabled como true ou false'
                }
              );
            }

            streaming.enabled =
              body.enabled;

            if (
              !streaming.enabled
            ) {
              streaming.status =
                'offline';

              streaming.message =
                'Streaming desativado pelo administrador';
            } else {
              streaming.status =
                'offline';

              streaming.message =
                'Streaming ativado; aguardando o PC GameCloud';
            }

            return json(
              res,
              200,
              {
                ok: true,
                enabled:
                  streaming.enabled,
                status:
                  streaming.status,
                message:
                  streaming.message
              }
            );
          }

          /*
           * INICIAR FIVEM - ADMIN
           */

          if (
            pathname ===
              '/api/admin/stream/start' &&
            req.method === 'POST'
          ) {
            if (
              !streaming.enabled
            ) {
              return json(
                res,
                400,
                {
                  error:
                    'O streaming está desativado'
                }
              );
            }

            streaming.status =
              'starting';

            streaming.message =
              'Solicitação de início do FiveM registrada';

            return json(
              res,
              200,
              {
                ok: true,
                status:
                  streaming.status,
                message:
                  streaming.message
              }
            );
          }

          /*
           * PARAR FIVEM - ADMIN
           */

          if (
            pathname ===
              '/api/admin/stream/stop' &&
            req.method === 'POST'
          ) {
            streaming.status =
              'stopping';

            streaming.message =
              'Solicitação de parada do FiveM registrada';

            return json(
              res,
              200,
              {
                ok: true,
                status:
                  streaming.status,
                message:
                  streaming.message
              }
            );
          }

          return json(
            res,
            404,
            {
              error:
                'Função administrativa não encontrada'
            }
          );
        }

        /*
         * AGENTE GAMECLOUD
         */

        if (
          pathname ===
            '/api/agent/heartbeat' &&
          req.method === 'POST'
        ) {
          if (
            !agentAuthorized(req)
          ) {
            return json(
              res,
              401,
              {
                error:
                  'Agente não autorizado'
              }
            );
          }

          streaming.lastHeartbeat =
            Date.now();

          if (body.status) {
            streaming.status =
              String(
                body.status
              ).slice(
                0,
                30
              );
          }

          if (body.message) {
            streaming.message =
              String(
                body.message
              ).slice(
                0,
                200
              );
          } else {
            streaming.message =
              'PC GameCloud conectado';
          }

          if (body.host) {
            streaming.host =
              String(
                body.host
              ).slice(
                0,
                100
              );
          }

          return json(
            res,
            200,
            {
              ok: true,
              enabled:
                streaming.enabled,
              status:
                streaming.status,
              game:
                streaming.game
            }
          );
        }

        /*
         * COMANDO DO AGENTE
         */

        if (
          pathname ===
            '/api/agent/command' &&
          req.method === 'GET'
        ) {
          if (
            !agentAuthorized(req)
          ) {
            return json(
              res,
              401,
              {
                error:
                  'Agente não autorizado'
              }
            );
          }

          let command =
            'none';

          if (
            streaming.status ===
            'starting'
          ) {
            command =
              'start_fivem';
          } else if (
            streaming.status ===
            'stopping'
          ) {
            command =
              'stop_fivem';
          }

          return json(
            res,
            200,
            {
              ok: true,
              enabled:
                streaming.enabled,
              command
            }
          );
        }

        /*
         * STATUS DO AGENTE
         */

        if (
          pathname ===
            '/api/agent/status' &&
          req.method === 'POST'
        ) {
          if (
            !agentAuthorized(req)
          ) {
            return json(
              res,
              401,
              {
                error:
                  'Agente não autorizado'
              }
            );
          }

          streaming.lastHeartbeat =
            Date.now();

          if (body.status) {
            streaming.status =
              String(
                body.status
              ).slice(
                0,
                30
              );
          }

          if (body.message) {
            streaming.message =
              String(
                body.message
              ).slice(
                0,
                200
              );
          }

          if (body.host) {
            streaming.host =
              String(
                body.host
              ).slice(
                0,
                100
              );
          }

          if (
            streaming.status ===
            'online'
          ) {
            streaming.message =
              'FiveM disponível no PC GameCloud';
          }

          if (
            streaming.status ===
            'offline'
          ) {
            streaming.message =
              'FiveM desligado';
          }

          return json(
            res,
            200,
            {
              ok: true,
              status:
                streaming.status,
              message:
                streaming.message
            }
          );
        }

        return json(
          res,
          404,
          {
            error:
              'Função não disponível'
          }
        );
      } catch (error) {
        console.error(
          'Erro no servidor:',
          error
        );

        return json(
          res,
          500,
          {
            error:
              'Não foi possível processar o pedido'
          }
        );
      }
    }
  );

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      'Império GameCloud iniciado na porta ' +
        PORT
    );

    console.log(
      'Banco de usuários: ' +
        DB
    );

    console.log(
      'Admin configurado: ' +
        (
          ADMIN_USER
            ? 'sim'
            : 'não'
        )
    );

    console.log(
      'Agente GameCloud configurado: ' +
        (
          STREAM_AGENT_KEY
            ? 'sim'
            : 'não'
        )
    );
  }
);

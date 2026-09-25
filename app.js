'use strict';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role =
  localStorage.getItem('igc_role') ||
  sessionStorage.getItem('igc_role') ||
  '';

const API_BASE =
  'https://imperio-gamecloud-1.onrender.com/api/';

function el(id) {
  return document.getElementById(id);
}

function show(page) {
  document
    .querySelectorAll('.page')
    .forEach(function (p) {
      p.classList.toggle('active', p.id === page);
    });

  message('');
}

function message(text, error) {
  const p = el('message');

  if (!p) return;

  p.textContent = text || '';
  p.className = error ? 'error' : 'success';
}

function fail(error) {
  message(
    error && error.message
      ? error.message
      : 'Ocorreu um erro.',
    true
  );
}

async function api(url, method = 'GET', data = null) {
  const options = {
    method: method,
    headers: {}
  };

  if (data !== null) {
    options.headers['Content-Type'] =
      'application/json';

    options.body = JSON.stringify(data);
  }

  if (token) {
    options.headers.Authorization =
      'Bearer ' + token;
  }

  const response =
    await fetch(API_BASE + url, options);

  let result = {};

  try {
    result = await response.json();
  } catch (_) {
    result = {};
  }

  if (!response.ok) {
    throw new Error(
      result.error ||
      result.message ||
      'Erro ' + response.status
    );
  }

  return result;
}

function saveSession(result, remember) {
  token = result.token || '';
  role = result.user
    ? result.user.role
    : result.role || '';

  localStorage.removeItem('igc_token');
  localStorage.removeItem('igc_role');

  sessionStorage.removeItem('igc_token');
  sessionStorage.removeItem('igc_role');

  const storage =
    remember ? localStorage : sessionStorage;

  if (token) {
    storage.setItem('igc_token', token);
  }

  if (role) {
    storage.setItem('igc_role', role);
  }
}

function clearSession() {
  token = '';
  role = '';

  localStorage.removeItem('igc_token');
  localStorage.removeItem('igc_role');

  sessionStorage.removeItem('igc_token');
  sessionStorage.removeItem('igc_role');
}

function setText(id, value) {
  const node = el(id);

  if (node) {
    node.textContent =
      value === undefined ||
      value === null
        ? ''
        : String(value);
  }
}

function setVisible(id, visible) {
  const node = el(id);

  if (!node) return;

  node.style.display =
    visible ? '' : 'none';
}

function formatMinutes(minutes) {
  const value =
    Number.isFinite(Number(minutes))
      ? Number(minutes)
      : 0;

  return value + ' minuto' +
    (value === 1 ? '' : 's');
}

function streamStatusText(status) {
  switch (status) {
    case 'starting':
      return '🟡 Iniciando FiveM...';

    case 'stopping':
      return '🟠 Encerrando FiveM...';

    case 'online':
      return '🟢 FiveM online';

    case 'offline':
      return '⚫ FiveM offline';

    default:
      return status || '⚫ Offline';
  }
}

async function load() {
  try {
    const result =
      await api('me');

    if (
      result.user &&
      result.user.role
    ) {
      role = result.user.role;

      if (
        localStorage.getItem('igc_token')
      ) {
        localStorage.setItem(
          'igc_role',
          role
        );
      } else {
        sessionStorage.setItem(
          'igc_role',
          role
        );
      }

      show(
        role === 'admin'
          ? 'admin'
          : 'player'
      );

      setText(
        'userName',
        result.user.name ||
        result.user.username ||
        'Jogador'
      );

      setText(
        'userEmail',
        result.user.email || ''
      );

      setText(
        'minutes',
        formatMinutes(
          result.user.minutes || 0
        )
      );

      await loadPlayerStreamStatus();

      if (role === 'admin') {
        await loadAdmin();
        await loadStreamStatus();
      }

      return;
    }
  } catch (_) {
    clearSession();
  }

  show('login');
}

async function loadAdmin() {
  try {
    const result =
      await api('admin/overview');

    if (!result) return;

    setText(
      'totalPlayers',
      result.totalPlayers ??
      result.players ??
      0
    );

    setText(
      'onlinePlayers',
      result.onlinePlayers ??
      result.online ??
      0
    );

    if (
      Array.isArray(result.players)
    ) {
      const list = el('playersList');

      if (list) {
        list.innerHTML = '';

        result.players.forEach(
          function (player) {
            const item =
              document.createElement('div');

            item.className =
              'player-item';

            item.textContent =
              (player.name || '') +
              ' — ' +
              (player.email || '') +
              ' — ' +
              formatMinutes(
                player.minutes || 0
              );

            list.appendChild(item);
          }
        );
      }
    }
  } catch (error) {
    fail(error);
  }
}

async function loadStreamStatus() {
  try {
    const result =
      await api('stream/status');

    const text =
      streamStatusText(
        result.status
      );

    setText(
      'streamStatus',
      text
    );

    setText(
      'streamMessage',
      result.message || ''
    );

    const toggle =
      el('toggleStream');

    if (toggle) {
      toggle.textContent =
        result.enabled
          ? '🟢 Streaming ativado'
          : '🔴 Streaming desativado';
    }
  } catch (error) {
    setText(
      'streamStatus',
      '⚠️ Não foi possível consultar'
    );
  }
}

async function loadPlayerStreamStatus() {
  try {
    const result =
      await api('stream/status');

    setText(
      'playerStreamStatus',
      streamStatusText(
        result.status
      )
    );

    setText(
      'playerStreamMessage',
      result.message || ''
    );
  } catch (_) {
    setText(
      'playerStreamStatus',
      '⚫ Offline'
    );
  }
}

async function refreshAll() {
  try {
    await load();
  } catch (error) {
    fail(error);
  }
}

document.addEventListener(
  'DOMContentLoaded',
  function () {

    const loginForm =
      el('loginForm');

    if (loginForm) {
      loginForm.addEventListener(
        'submit',
        async function (event) {
          event.preventDefault();

          try {
            const email =
              el('loginEmail').value.trim();

            const password =
              el('loginPassword').value;

            const remember =
              el('remember')
                ? el('remember').checked
                : false;

            if (!email || !password) {
              throw new Error(
                'Informe o e-mail e a senha.'
              );
            }

            const button =
              loginForm.querySelector(
                'button[type="submit"]'
              );

            if (button) {
              button.disabled = true;
              button.textContent =
                'Entrando...';
            }

            const result =
              await api(
                'login',
                'POST',
                {
                  email: email,
                  password: password
                }
              );

            saveSession(
              result,
              remember
            );

            message(
              'Login realizado com sucesso!'
            );

            await load();

          } catch (error) {
            fail(error);

          } finally {
            const button =
              loginForm.querySelector(
                'button[type="submit"]'
              );

            if (button) {
              button.disabled = false;
              button.textContent =
                'Entrar';
            }
          }
        }
      );
    }

    const registerForm =
      el('registerForm');

    if (registerForm) {
      registerForm.addEventListener(
        'submit',
        async function (event) {
          event.preventDefault();

          try {
            const name =
              el('registerName').value.trim();

            const email =
              el('registerEmail')
                .value.trim();

            const password =
              el('registerPassword')
                .value;

            const result =
              await api(
                'register',
                'POST',
                {
                  name: name,
                  email: email,
                  password: password
                }
              );

            message(
              result.message ||
              'Conta criada com sucesso!'
            );

            show('login');

            if (el('loginEmail')) {
              el('loginEmail').value =
                email;
            }

          } catch (error) {
            fail(error);
          }
        }
      );
    }

    const logout =
      el('logout');

    if (logout) {
      logout.addEventListener(
        'click',
        async function () {
          try {
            await api(
              'logout',
              'POST'
            );
          } catch (_) {
          }

          clearSession();
          show('login');
        }
      );
    }

    const startStream =
      el('startStream');

    if (startStream) {
      startStream.addEventListener(
        'click',
        async function () {
          try {
            startStream.disabled = true;
            startStream.textContent =
              '🟡 Iniciando...';

            await api(
              'stream/start',
              'POST'
            );

            await loadStreamStatus();

          } catch (error) {
            fail(error);

          } finally {
            startStream.disabled =
              false;

            startStream.textContent =
              '🎮 Iniciar FiveM';
          }
        }
      );
    }

    const stopStream =
      el('stopStream');

    if (stopStream) {
      stopStream.addEventListener(
        'click',
        async function () {
          try {
            stopStream.disabled = true;
            stopStream.textContent =
              '🟠 Encerrando...';

            await api(
              'stream/stop',
              'POST'
            );

            await loadStreamStatus();

          } catch (error) {
            fail(error);

          } finally {
            stopStream.disabled =
              false;

            stopStream.textContent =
              '⛔ Parar FiveM';
          }
        }
      );
    }

    const toggleStream =
      el('toggleStream');

    if (toggleStream) {
      toggleStream.addEventListener(
        'click',
        async function () {
          try {
            const status =
              await api(
                'stream/status'
              );

            await api(
              'stream/toggle',
              'POST',
              {
                enabled:
                  !status.enabled
              }
            );

            await loadStreamStatus();

          } catch (error) {
            fail(error);
          }
        }
      );
    }

    const refreshStream =
      el('refreshStream');

    if (refreshStream) {
      refreshStream.addEventListener(
        'click',
        async function () {
          await loadStreamStatus();
        }
      );
    }

    const playerStart =
      el('playerStart');

    if (playerStart) {
      playerStart.addEventListener(
        'click',
        async function () {

          try {
            playerStart.disabled =
              true;

            playerStart.textContent =
              '🟡 Solicitando FiveM...';

            const result =
              await api(
                'stream/start',
                'POST'
              );

            setText(
              'minutes',
              formatMinutes(
                result.minutes || 0
              )
            );

            message(
              result.message ||
              'FiveM solicitado com sucesso!'
            );

            await loadPlayerStreamStatus();

          } catch (error) {

            playerStart.disabled =
              false;

            playerStart.textContent =
              '🎮 Iniciar FiveM';

            fail(error);
          }
        }
      );
    }

    const addTimeForm =
      el('addTimeForm');

    if (addTimeForm) {
      addTimeForm.addEventListener(
        'submit',
        async function (event) {
          event.preventDefault();

          try {
            const email =
              el('addTimeEmail')
                .value.trim();

            const minutes =
              Number(
                el('addTimeMinutes')
                  .value
              );

            if (!email) {
              throw new Error(
                'Informe o e-mail do jogador.'
              );
            }

            if (
              !Number.isFinite(minutes) ||
              minutes <= 0
            ) {
              throw new Error(
                'Informe uma quantidade válida de minutos.'
              );
            }

            const result =
              await api(
                'admin/add-time',
                'POST',
                {
                  email: email,
                  minutes: minutes
                }
              );

            message(
              result.message ||
              'Minutos adicionados!'
            );

            await loadAdmin();

          } catch (error) {
            fail(error);
          }
        }
      );
    }

    const forgotForm =
      el('forgotForm');

    if (forgotForm) {
      forgotForm.addEventListener(
        'submit',
        async function (event) {
          event.preventDefault();

          try {
            const email =
              el('forgotEmail')
                .value.trim();

            await api(
              'forgot',
              'POST',
              {
                email: email
              }
            );

            message(
              'Se a conta existir, a recuperação será processada.'
            );

          } catch (error) {
            fail(error);
          }
        }
      );
    }

    const resetForm =
      el('resetForm');

    if (resetForm) {
      resetForm.addEventListener(
        'submit',
        async function (event) {
          event.preventDefault();

          try {
            const tokenReset =
              el('resetToken').value.trim();

            const password =
              el('resetPassword').value;

            await api(
              'reset',
              'POST',
              {
                token: tokenReset,
                password: password
              }
            );

            message(
              'Senha alterada com sucesso!'
            );

            show('login');

          } catch (error) {
            fail(error);
          }
        }
      );
    }

    const goRegister =
      el('goRegister');

    if (goRegister) {
      goRegister.addEventListener(
        'click',
        function () {
          show('register');
        }
      );
    }

    const goLogin =
      el('goLogin');

    if (goLogin) {
      goLogin.addEventListener(
        'click',
        function () {
          show('login');
        }
      );
    }

    const goForgot =
      el('goForgot');

    if (goForgot) {
      goForgot.addEventListener(
        'click',
        function () {
          show('forgot');
        }
      );
    }

    const goReset =
      el('goReset');

    if (goReset) {
      goReset.addEventListener(
        'click',
        function () {
          show('reset');
        }
      );
    }

    show('login');

    if (token) {
      load();
    }
  }
);

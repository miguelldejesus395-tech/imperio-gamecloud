'use strict';

const APP_VERSION = '4.3.0';
const API_BASE = 'https://imperio-gamecloud-1.onrender.com/api/';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role =
  localStorage.getItem('igc_role') ||
  sessionStorage.getItem('igc_role') ||
  '';

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (!node) return;
  node.textContent =
    value === undefined || value === null ? '' : String(value);
}

function show(page) {
  document.querySelectorAll('.page').forEach(function (section) {
    section.classList.toggle('active', section.id === page);
  });

  document.querySelectorAll('.user-page').forEach(function (section) {
    section.style.display = section.id === page ? 'block' : 'none';
  });

  document.querySelectorAll('.side-btn').forEach(function (button) {
    button.classList.toggle(
      'active',
      button.getAttribute('data-page') === page
    );
  });
}

function message(text, isError) {
  const node = el('message');
  if (!node) return;
  node.textContent = text || '';
  node.className = isError ? 'error' : 'success';
}

function fail(error) {
  message(
    error && error.message ? error.message : 'Ocorreu um erro.',
    true
  );
}

async function api(path, method, data) {
  const options = {
    method: method || 'GET',
    headers: {}
  };

  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }

  if (token) {
    options.headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetch(API_BASE + path, options);

  let result = {};
  try {
    result = await response.json();
  } catch (error) {
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
  role =
    result.role ||
    (result.user ? result.user.role || '' : '');

  clearStoredSession();

  const storage = remember ? localStorage : sessionStorage;

  if (token) storage.setItem('igc_token', token);
  if (role) storage.setItem('igc_role', role);
}

function clearStoredSession() {
  localStorage.removeItem('igc_token');
  localStorage.removeItem('igc_role');
  sessionStorage.removeItem('igc_token');
  sessionStorage.removeItem('igc_role');
}

function clearSession() {
  token = '';
  role = '';
  clearStoredSession();
}

function formatMinutes(value) {
  const minutes = Number(value);
  const safe = Number.isFinite(minutes) ? minutes : 0;
  return safe + (safe === 1 ? ' minuto' : ' minutos');
}

function streamStatusText(status) {
  switch (status) {
    case 'starting':
      return '🟡 Iniciando FiveM...';
    case 'stopping':
      return '🟠 Encerrando FiveM...';
    case 'online':
      return '🟢 FiveM online';
    case 'error':
      return '🔴 Erro no GameCloud';
    case 'offline':
      return '⚫ FiveM offline';
    default:
      return status ? String(status) : '⚫ Offline';
  }
}

function setButtonBusy(button, busy, text) {
  if (!button) return;

  if (busy) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

/* =========================
   LOGIN ADMINISTRADOR
========================= */

function createAdminLogin() {
  if (el('adminLoginButton') || el('adminLoginPage')) return;

  const loginPage = el('login');
  if (!loginPage) return;

  const card = loginPage.querySelector('.card');
  if (!card) return;

  const button = document.createElement('button');
  button.id = 'adminLoginButton';
  button.type = 'button';
  button.className = 'wide';
  button.textContent = '👑 Entrar como administrador';
  button.style.marginTop = '10px';

  button.addEventListener('click', function () {
    show('adminLoginPage');
    message('');
  });

  card.appendChild(button);

  const section = document.createElement('section');
  section.id = 'adminLoginPage';
  section.className = 'page';

  section.innerHTML = `
    <div class="card auth">
      <h2>👑 Área administrativa</h2>
      <p class="muted">
        Entre usando o usuário e a senha de administrador
        configurados no Render.
      </p>

      <form id="adminLoginForm">
        <input
          id="adminUsername"
          type="text"
          autocomplete="username"
          placeholder="Usuário do administrador"
          required
        >

        <input
          id="adminPassword"
          type="password"
          autocomplete="current-password"
          placeholder="Senha do administrador"
          required
        >

        <label class="row">
          <input id="adminRemember" type="checkbox" checked>
          Manter administrador conectado
        </label>

        <button class="primary wide" type="submit">
          👑 Entrar no painel
        </button>
      </form>

      <button id="backToLogin" class="wide" type="button" style="margin-top:10px">
        Voltar para o login
      </button>
    </div>
  `;

  const main = document.querySelector('main.wrap');
  if (main) main.appendChild(section);

  const form = el('adminLoginForm');

  if (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();

      const username = el('adminUsername').value.trim();
      const password = el('adminPassword').value;
      const remember = el('adminRemember')
        ? el('adminRemember').checked
        : false;

      try {
        if (!username || !password) {
          throw new Error(
            'Informe o usuário e a senha do administrador.'
          );
        }

        const result = await api('admin/login', 'POST', {
          username: username,
          password: password
        });

        saveSession(result, remember);
        role = 'admin';

        show('admin');
        message('Login de administrador realizado com sucesso.');

        await loadAdmin();
        await loadStreamStatus();
      } catch (error) {
        fail(error);
      }
    });
  }

  const back = el('backToLogin');

  if (back) {
    back.addEventListener('click', function () {
      show('login');
      message('');
    });
  }
}

/* =========================
   STREAMING
========================= */

async function loadStreamStatus() {
  const result = await api('stream/status');
  const streaming = result.streaming || result;

  setText('streamStatus', streamStatusText(streaming.status));

  setText(
    'streamGame',
    streaming.game ? 'Jogo: ' + streaming.game : 'FiveM'
  );

  setText(
    'streamHost',
    streaming.host
      ? 'Computador: ' + streaming.host
      : 'PC-GAMECLOUD'
  );

  setText(
    'streamMessage',
    streaming.message || '—'
  );

  setText(
    'streamHeartbeat',
    streaming.lastHeartbeat
      ? new Date(streaming.lastHeartbeat).toLocaleString('pt-BR')
      : '—'
  );

  const toggle = el('toggleStream');

  if (toggle) {
    toggle.textContent = streaming.enabled
      ? '🔄 Desativar streaming'
      : '🔄 Ativar streaming';
  }

  setText(
    'playerStreamStatus',
    streamStatusText(streaming.status)
  );

  setText(
    'playerStreamStatus2',
    streamStatusText(streaming.status)
  );

  setText(
    'playerStreamMessage',
    streaming.message ||
      'Aguardando o computador GameCloud.'
  );

  setText(
    'serverStatusText',
    streaming.message ||
      streamStatusText(streaming.status)
  );

  setText(
    'playerMiniStatus',
    streaming.status === 'online'
      ? 'Online'
      : 'Aguardando'
  );
}

async function loadPlayerStreamStatus() {
  const result = await api('stream/status');
  const streaming = result.streaming || result;

  setText(
    'playerStreamStatus',
    streamStatusText(streaming.status)
  );

  setText(
    'playerStreamStatus2',
    streamStatusText(streaming.status)
  );

  setText(
    'playerStreamMessage',
    streaming.message ||
      'Aguardando o computador GameCloud.'
  );

  setText(
    'serverStatusText',
    streaming.message ||
      streamStatusText(streaming.status)
  );

  setText(
    'playerMiniStatus',
    streaming.status === 'online'
      ? 'Online'
      : 'Aguardando'
  );
}

async function startPlayerStream() {
  const buttons = [
    el('playerStart'),
    el('playerStart2')
  ].filter(Boolean);

  try {
    buttons.forEach(function (button) {
      setButtonBusy(button, true, '🟡 Iniciando...');
    });

    const result = await api('stream/start', 'POST');

    await loadPlayerStreamStatus();

    message(
      result.message ||
        'FiveM solicitado com sucesso.'
    );
  } catch (error) {
    fail(error);
  } finally {
    buttons.forEach(function (button) {
      setButtonBusy(button, false);
    });
  }
}

async function startAdminStream() {
  const button = el('startStream');

  try {
    setButtonBusy(button, true, '🟡 Iniciando...');

    const result = await api(
      'admin/stream/start',
      'POST'
    );

    await loadStreamStatus();

    message(
      result.message ||
        'Início do FiveM solicitado.'
    );
  } catch (error) {
    fail(error);
  } finally {
    setButtonBusy(button, false);
  }
}

async function stopAdminStream() {
  const button = el('stopStream');

  try {
    setButtonBusy(button, true, '🟠 Encerrando...');

    const result = await api(
      'admin/stream/stop',
      'POST'
    );

    await loadStreamStatus();

    message(
      result.message ||
        'Encerramento do FiveM solicitado.'
    );
  } catch (error) {
    fail(error);
  } finally {
    setButtonBusy(button, false);
  }
}

async function toggleAdminStream() {
  const button = el('toggleStream');

  try {
    setButtonBusy(button, true, '🔄 Alterando...');

    const status = await api('stream/status');
    const streaming = status.streaming || status;

    const result = await api(
      'admin/stream/toggle',
      'POST',
      {
        enabled: !streaming.enabled
      }
    );

    await loadStreamStatus();

    message(
      result.message ||
        'Configuração do streaming atualizada.'
    );
  } catch (error) {
    fail(error);
  } finally {
    setButtonBusy(button, false);
  }
}

/* =========================
   ADMIN
========================= */

async function loadAdmin() {
  const result = await api('admin/overview');

  const users = Array.isArray(result.users)
    ? result.users
    : [];

  setText('users', users.length);

  let onlineCount = 0;

  users.forEach(function (player) {
    if (player.online === true) onlineCount++;
  });

  setText('online', onlineCount);

  const tbody = el('players');
  if (!tbody) return;

  tbody.innerHTML = '';

  users.forEach(function (player) {
    const row = document.createElement('tr');

    const name = document.createElement('td');
    const email = document.createElement('td');
    const minutes = document.createElement('td');

    name.textContent =
      player.name ||
      player.username ||
      'Jogador';

    email.textContent =
      player.email || '—';

    minutes.textContent =
      formatMinutes(player.minutes);

    row.appendChild(name);
    row.appendChild(email);
    row.appendChild(minutes);

    tbody.appendChild(row);
  });
}

/* =========================
   USUÁRIO
========================= */

async function loadUser() {
  const result = await api('me');

  const user = result.user || result;

  setText(
    'greetingName',
    user.name ||
      user.username ||
      'Usuário'
  );

  setText(
    'sideName',
    user.name ||
      user.username ||
      'Usuário'
  );

  setText(
    'minutes',
    formatMinutes(user.minutes)
  );

  setText(
    'minutesMini',
    formatMinutes(user.minutes)
  );

  setText(
    'minutesServer',
    formatMinutes(user.minutes)
  );

  setText(
    'profileName',
    user.name ||
      user.username ||
      '—'
  );

  setText(
    'profileUsername',
    user.username ||
      '—'
  );

  setText(
    'profileEmail',
    user.email ||
      '—'
  );

  setText(
    'profileMinutes',
    formatMinutes(user.minutes)
  );

  show('user');

  await loadPlayerStreamStatus();
}

async function loginUser() {
  const email = el('email')
    ? el('email').value.trim()
    : '';

  const password = el('password')
    ? el('password').value
    : '';

  const remember = el('remember')
    ? el('remember').checked
    : false;

  if (!email || !password) {
    throw new Error(
      'Informe seu e-mail e sua senha.'
    );
  }

  const result = await api(
    'login',
    'POST',
    {
      email: email,
      password: password
    }
  );

  saveSession(result, remember);

  role = 'player';

  await loadUser();

  message(
    'Login realizado com sucesso.'
  );
}

async function registerUser() {
  const name = el('rname')
    ? el('rname').value.trim()
    : '';

  const email = el('remail')
    ? el('remail').value.trim()
    : '';

  const password = el('rpassword')
    ? el('rpassword').value
    : '';

  if (!name || !email || !password) {
    throw new Error(
      'Preencha todos os campos.'
    );
  }

  if (password.length < 8) {
    throw new Error(
      'A senha precisa ter pelo menos 8 caracteres.'
    );
  }

  const result = await api(
    'users/register',
    'POST',
    {
      name: name,
      email: email,
      password: password
    }
  );

  message(
    result.message ||
      'Cadastro realizado com sucesso.'
  );

  show('login');

  if (el('email')) {
    el('email').value = email;
  }

  if (el('password')) {
    el('password').value = '';
  }
}

async function forgotPassword() {
  const email = el('femail')
    ? el('femail').value.trim()
    : '';

  if (!email) {
    throw new Error(
      'Informe seu e-mail.'
    );
  }

  const result = await api(
    'forgot-password',
    'POST',
    {
      email: email
    }
  );

  message(
    result.message ||
      'Se o e-mail estiver cadastrado, as instruções serão enviadas.'
  );
}

async function resetPassword() {
  const password = el('newpassword')
    ? el('newpassword').value
    : '';

  const params =
    new URLSearchParams(window.location.search);

  const resetToken =
    params.get('token') ||
    params.get('reset') ||
    '';

  if (!resetToken) {
    throw new Error(
      'Token de recuperação não encontrado.'
    );
  }

  if (!password || password.length < 8) {
    throw new Error(
      'A nova senha precisa ter pelo menos 8 caracteres.'
    );
  }

  const result = await api(
    'reset-password',
    'POST',
    {
      token: resetToken,
      password: password
    }
  );

  message(
    result.message ||
      'Senha alterada com sucesso.'
  );

  show('login');
}

/* =========================
   NAVEGAÇÃO DO USUÁRIO
========================= */

function setupNavigation() {
  document
    .querySelectorAll('[data-page]')
    .forEach(function (button) {
      button.addEventListener('click', function () {
        const page =
          button.getAttribute('data-page');

        if (!page) return;

        show(page);

        if (page === 'home') {
          loadPlayerStreamStatus()
            .catch(fail);
        }

        if (page === 'servers') {
          loadPlayerStreamStatus()
            .catch(fail);
        }

        if (page === 'profile') {
          loadUser()
            .catch(fail);
        }
      });
    });
}

function setupLogin() {
  const form = el('loginForm');

  if (!form) return;

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      try {
        await loginUser();
      } catch (error) {
        fail(error);
      }
    }
  );

  const registerButton =
    el('showRegister');

  if (registerButton) {
    registerButton.addEventListener(
      'click',
      function () {
        show('register');
        message('');
      }
    );
  }

  const forgotButton =
    el('showForgot');

  if (forgotButton) {
    forgotButton.addEventListener(
      'click',
      function () {
        show('forgot');
        message('');
      }
    );
  }
}

function setupRegister() {
  const form = el('registerForm');

  if (form) {
    form.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        try {
          await registerUser();
        } catch (error) {
          fail(error);
        }
      }
    );
  }

  const back =
    el('backLoginFromRegister');

  if (back) {
    back.addEventListener(
      'click',
      function () {
        show('login');
        message('');
      }
    );
  }
}

function setupForgot() {
  const form = el('forgotForm');

  if (form) {
    form.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        try {
          await forgotPassword();
        } catch (error) {
          fail(error);
        }
      }
    );
  }

  const back =
    el('backLoginFromForgot');

  if (back) {
    back.addEventListener(
      'click',
      function () {
        show('login');
        message('');
      }
    );
  }
}

function setupReset() {
  const form = el('resetForm');

  if (form) {
    form.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        try {
          await resetPassword();
        } catch (error) {
          fail(error);
        }
      }
    );
  }

  const back =
    el('backLoginFromReset');

  if (back) {
    back.addEventListener(
      'click',
      function () {
        show('login');
        message('');
      }
    );
  }
}

/* =========================
   LOGOUT
========================= */

function logout() {
  clearSession();

  show('login');

  message(
    'Você saiu da sua conta.'
  );
}

function setupLogout() {
  const userLogout = el('logout');

  if (userLogout) {
    userLogout.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        logout();
      }
    );
  }

  const adminLogout =
    el('logoutAdmin');

  if (adminLogout) {
    adminLogout.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        logout();
      }
    );
  }
}

/* =========================
   BOTÕES DO USUÁRIO
========================= */

function setupPlayer() {
  const buttons = [
    el('playerStart'),
    el('playerStart2')
  ].filter(Boolean);

  buttons.forEach(function (button) {
    button.addEventListener(
      'click',
      function () {
        startPlayerStream();
      }
    );
  });

  const refresh =
    el('refresh');

  if (refresh) {
    refresh.addEventListener(
      'click',
      function () {
        loadPlayerStreamStatus()
          .catch(fail);
      }
    );
  }

  const refreshServer =
    el('refreshServer');

  if (refreshServer) {
    refreshServer.addEventListener(
      'click',
      function () {
        loadPlayerStreamStatus()
          .catch(fail);
      }
    );
  }

  const buyButtons = [
    el('buyMinutes'),
    el('buy')
  ].filter(Boolean);

  buyButtons.forEach(function (button) {
    button.addEventListener(
      'click',
      function () {
        show('buy');
      }
    );
  });
}

/* =========================
   ADMIN
========================= */

function setupAdmin() {
  const start =
    el('startStream');

  if (start) {
    start.addEventListener(
      'click',
      function () {
        startAdminStream();
      }
    );
  }

  const stop =
    el('stopStream');

  if (stop) {
    stop.addEventListener(
      'click',
      function () {
        stopAdminStream();
      }
    );
  }

  const toggle =
    el('toggleStream');

  if (toggle) {
    toggle.addEventListener(
      'click',
      function () {
        toggleAdminStream();
      }
    );
  }

  const refresh =
    el('refreshStream');

  if (refresh) {
    refresh.addEventListener(
      'click',
      function () {
        loadStreamStatus()
          .catch(fail);
      }
    );
  }

  const refreshAdmin =
    el('refreshAdmin');

  if (refreshAdmin) {
    refreshAdmin.addEventListener(
      'click',
      async function () {
        try {
          await loadAdmin();
          await loadStreamStatus();
        } catch (error) {
          fail(error);
        }
      }
    );
  }

  const form =
    el('timeForm');

  if (form) {
    form.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        const email =
          el('playerEmail')
            ? el('playerEmail').value.trim()
            : '';

        const minutes =
          el('addMinutes')
            ? Number(el('addMinutes').value)
            : 0;

        if (!email) {
          message(
            'Informe o e-mail do jogador.',
            true
          );
          return;
        }

        if (
          !Number.isFinite(minutes) ||
          minutes <= 0
        ) {
          message(
            'Informe uma quantidade de minutos válida.',
            true
          );
          return;
        }

        try {
          const result = await api(
            'admin/time/add',
            'POST',
            {
              email: email,
              minutes: minutes
            }
          );

          message(
            result.message ||
              'Minutos adicionados com sucesso.'
          );

          form.reset();

          await loadAdmin();
        } catch (error) {
          fail(error);
        }
      }
    );
  }
}

/* =========================
   SESSÃO
========================= */

async function restoreSession() {
  if (!token) {
    show('login');
    return;
  }

  try {
    const result = await api('me');

    const currentRole =
      result.role ||
      (result.user
        ? result.user.role
        : role);

    role = currentRole || role;

    if (role === 'admin') {
      show('admin');

      await loadAdmin();
      await loadStreamStatus();
    } else {
      role = 'player';

      await loadUser();
      await loadPlayerStreamStatus();
    }
  } catch (error) {
    clearSession();
    show('login');
  }
}

/* =========================
   INICIALIZAÇÃO
========================= */

async function init() {
  createAdminLogin();

  setupLogin();
  setupRegister();
  setupForgot();
  setupReset();

  setupNavigation();
  setupPlayer();
  setupAdmin();
  setupLogout();

  const path =
    window.location.pathname;

  const params =
    new URLSearchParams(
      window.location.search
    );

  if (
    path.includes('reset') ||
    params.get('token') ||
    params.get('reset')
  ) {
    show('reset');
    return;
  }

  await restoreSession();
}

document.addEventListener(
  'DOMContentLoaded',
  function () {
    init().catch(function (error) {
      console.error(
        'Erro ao iniciar o GameCloud:',
        error
      );
    });
  }
);

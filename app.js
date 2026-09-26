'use strict';

const APP_VERSION = '4.2.0';

const API_BASE =
  'https://imperio-gamecloud-1.onrender.com/api/';

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

function show(page) {
  document.querySelectorAll('.page').forEach(function (section) {
    section.classList.toggle(
      'active',
      section.id === page
    );
  });
}

function message(text, isError) {
  const node = el('message');

  if (!node) {
    return;
  }

  node.textContent = text || '';

  node.className = isError
    ? 'error'
    : 'success';
}

function fail(error) {
  message(
    error && error.message
      ? error.message
      : 'Ocorreu um erro.',
    true
  );
}

async function api(path, method, data) {
  const options = {
    method: method || 'GET',
    headers: {}
  };

  if (data !== undefined) {
    options.headers['Content-Type'] =
      'application/json';

    options.body =
      JSON.stringify(data);
  }

  if (token) {
    options.headers.Authorization =
      'Bearer ' + token;
  }

  const response =
    await fetch(
      API_BASE + path,
      options
    );

  let result = {};

  try {
    result =
      await response.json();
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
  token =
    result.token || '';

  role =
    result.role ||
    (
      result.user
        ? result.user.role || ''
        : ''
    );

  localStorage.removeItem(
    'igc_token'
  );

  localStorage.removeItem(
    'igc_role'
  );

  sessionStorage.removeItem(
    'igc_token'
  );

  sessionStorage.removeItem(
    'igc_role'
  );

  const storage =
    remember
      ? localStorage
      : sessionStorage;

  if (token) {
    storage.setItem(
      'igc_token',
      token
    );
  }

  if (role) {
    storage.setItem(
      'igc_role',
      role
    );
  }
}

function clearSession() {
  token = '';
  role = '';

  localStorage.removeItem(
    'igc_token'
  );

  localStorage.removeItem(
    'igc_role'
  );

  sessionStorage.removeItem(
    'igc_token'
  );

  sessionStorage.removeItem(
    'igc_role'
  );
}

function setText(id, value) {
  const node = el(id);

  if (!node) {
    return;
  }

  node.textContent =
    value === null ||
    value === undefined
      ? ''
      : String(value);
}

function formatMinutes(value) {
  const minutes =
    Number(value);

  const safe =
    Number.isFinite(minutes)
      ? minutes
      : 0;

  return safe +
    (
      safe === 1
        ? ' minuto'
        : ' minutos'
    );
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
      return status
        ? String(status)
        : '⚫ Offline';
  }
}

function setButtonBusy(
  button,
  busy,
  text
) {
  if (!button) {
    return;
  }

  if (busy) {
    button.disabled = true;

    button.dataset.originalText =
      button.textContent;

    button.textContent = text;
  } else {
    button.disabled = false;

    if (
      button.dataset.originalText
    ) {
      button.textContent =
        button.dataset.originalText;

      delete button.dataset.originalText;
    }
  }
}

/*
 * LOGIN ADMINISTRADOR
 *
 * O index.html atual não possui uma tela
 * separada para administrador.
 *
 * Por isso criamos a tela pelo JavaScript.
 */
function createAdminLogin() {
  if (
    el('adminLoginButton') ||
    el('adminLoginPage')
  ) {
    return;
  }

  const loginPage =
    el('login');

  if (!loginPage) {
    return;
  }

  const card =
    loginPage.querySelector('.card');

  if (!card) {
    return;
  }

  const button =
    document.createElement('button');

  button.id =
    'adminLoginButton';

  button.type =
    'button';

  button.className =
    'wide';

  button.textContent =
    '👑 Entrar como administrador';

  button.style.marginTop =
    '10px';

  button.addEventListener(
    'click',
    function () {
      show('adminLoginPage');
      message('');
    }
  );

  card.appendChild(button);

  const section =
    document.createElement('section');

  section.id =
    'adminLoginPage';

  section.className =
    'page';

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
          <input
            id="adminRemember"
            type="checkbox"
            checked
          >
          Manter administrador conectado
        </label>

        <button
          class="primary wide"
          type="submit"
        >
          👑 Entrar no painel
        </button>

      </form>

      <button
        id="backToLogin"
        class="wide"
        type="button"
      >
        Voltar para o login
      </button>
    </div>
  `;

  const main =
    document.querySelector('main.wrap');

  if (main) {
    main.appendChild(section);
  }

  const adminForm =
    el('adminLoginForm');

  if (adminForm) {
    adminForm.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        const username =
          el('adminUsername')
            .value
            .trim();

        const password =
          el('adminPassword')
            .value;

        const remember =
          el('adminRemember')
            ? el('adminRemember').checked
            : false;

        try {
          if (
            !username ||
            !password
          ) {
            throw new Error(
              'Informe o usuário e a senha do administrador.'
            );
          }

          const result =
            await api(
              'admin/login',
              'POST',
              {
                username:
                  username,
                password:
                  password
              }
            );

          saveSession(
            result,
            remember
          );

          role = 'admin';

          show('admin');

          message(
            'Login de administrador realizado com sucesso.'
          );

          await loadAdmin();
          await loadStreamStatus();

        } catch (error) {
          fail(error);
        }
      }
    );
  }

  const back =
    el('backToLogin');

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

async function loadStreamStatus() {
  const result =
    await api(
      'stream/status'
    );

  const streaming =
    result.streaming ||
    result;

  setText(
    'streamStatus',
    streamStatusText(
      streaming.status
    )
  );

  setText(
    'streamGame',
    'Jogo: ' +
      (
        streaming.game ||
        'FiveM'
      )
  );

  setText(
    'streamHost',
    'Computador: ' +
      (
        streaming.host ||
        '—'
      )
  );

  setText(
    'streamMessage',
    streaming.message ||
      '—'
  );

  setText(
    'streamHeartbeat',
    streaming.lastHeartbeat
      ? 'Último contato: ' +
        new Date(
          streaming.lastHeartbeat
        ).toLocaleString(
          'pt-BR'
        )
      : 'Último contato: —'
  );

  const toggle =
    el('toggleStream');

  if (toggle) {
    toggle.textContent =
      streaming.enabled
        ? '🔄 Desativar streaming'
        : '🔄 Ativar streaming';
  }
}

async function loadPlayerStreamStatus() {
  const result =
    await api(
      'stream/status'
    );

  const streaming =
    result.streaming ||
    result;

  setText(
    'playerStreamStatus',
    streamStatusText(
      streaming.status
    )
  );

  setText(
    'playerStreamMessage',
    streaming.message ||
      'Aguardando o computador GameCloud.'
  );
}

async function loadAdmin() {
  const result =
    await api(
      'admin/overview'
    );

  const users =
    Array.isArray(result.users)
      ? result.users
      : [];

  setText(
    'users',
    users.length
  );

  let onlineCount = 0;

  users.forEach(
    function (player) {
      if (
        player.online === true
      ) {
        onlineCount++;
      }
    }
  );

  setText(
    'online',
    onlineCount
  );

  const tbody =
    el('players');

  if (!tbody) {
    return;
  }

  tbody.innerHTML = '';

  users.forEach(
    function (player) {
      const row =
        document.createElement(
          'tr'
        );

      const name =
        document.createElement(
          'td'
        );

      const email =
        document.createElement(
          'td'
        );

      const minutes =
        document.createElement(
          'td'
        );

      const status =
        document.createElement(
          'td'
        );

      name.textContent =
        player.name ||
        player.username ||
        'Jogador';

      email.textContent =
        player.email ||
        '—';

      minutes.textContent =
        formatMinutes(
          player.minutes
        );

      status.textContent =
        player.online === true
          ? '🟢 Online'
          : '⚫ Offline';

      status.className =
        player.online === true
          ? 'online'
          : 'offline';

      row.appendChild(
        name
      );

      row.appendChild(
        email
      );

      row.appendChild(
        minutes
      );

      row.appendChild(
        status
      );

      tbody.appendChild(
        row
      );
    }
  );
}

async function loadUser() {
  /*
   * ADMINISTRADOR
   *
   * Não chamamos /me porque essa rota
   * é destinada ao jogador.
   */
  if (role === 'admin') {
    show('admin');

    await loadAdmin();
    await loadStreamStatus();

    return;
  }

  const result =
    await api(
      'me'
    );

  const user =
    result.user ||
    result;

  role =
    user.role ||
    result.role ||
    'player';

  const storage =
    localStorage.getItem(
      'igc_token'
    )
      ? localStorage
      : sessionStorage;

  if (role) {
    storage.setItem(
      'igc_role',
      role
    );
  }

  if (role === 'admin') {
    show('admin');

    await loadAdmin();
    await loadStreamStatus();

    return;
  }

  setText(
    'greeting',
    'Bem-vindo, ' +
      (
        user.name ||
        user.username ||
        'Jogador'
      ) +
      '!'
  );

  setText(
    'minutes',
    formatMinutes(
      user.minutes
    )
  );

  show('home');

  await loadPlayerStreamStatus();
}

async function logout() {
  try {
    if (token) {
      await api(
        'logout',
        'POST'
      );
    }
  } catch (error) {
  }

  clearSession();

  show('login');

  message(
    'Sessão encerrada.'
  );
}

async function startPlayerStream() {
  const button =
    el('playerStart');

  try {
    setButtonBusy(
      button,
      true,
      '🟡 Iniciando...'
    );

    const result =
      await api(
        'stream/start',
        'POST'
      );

    await loadPlayerStreamStatus();

    message(
      result.message ||
        'FiveM solicitado com sucesso.'
    );

  } catch (error) {
    fail(error);

  } finally {
    setButtonBusy(
      button,
      false
    );
  }
}

async function startAdminStream() {
  const button =
    el('startStream');

  try {
    setButtonBusy(
      button,
      true,
      '🟡 Iniciando...'
    );

    const result =
      await api(
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
    setButtonBusy(
      button,
      false
    );
  }
}

async function stopAdminStream() {
  const button =
    el('stopStream');

  try {
    setButtonBusy(
      button,
      true,
      '🟠 Encerrando...'
    );

    const result =
      await api(
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
    setButtonBusy(
      button,
      false
    );
  }
}

async function toggleAdminStream() {
  const button =
    el('toggleStream');

  try {
    setButtonBusy(
      button,
      true,
      '🔄 Alterando...'
    );

    const status =
      await api(
        'stream/status'
      );

    const currentStreaming =
      status.streaming ||
      status;

    const result =
      await api(
        'admin/stream/toggle',
        'POST',
        {
          enabled:
            !currentStreaming.enabled
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
    setButtonBusy(
      button,
      false
    );
  }
}

function setupNavigation() {
  document
    .querySelectorAll(
      '[data-page]'
    )
    .forEach(
      function (button) {
        button.addEventListener(
          'click',
          function () {
            const page =
              button.getAttribute(
                'data-page'
              );

            if (page) {
              show(page);

              message('');
            }
          }
        );
      }
    );
}

function setupLogin() {
  const form =
    el('loginForm');

  if (!form) {
    return;
  }

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      const email =
        el('email')
          .value
          .trim();

      const password =
        el('password')
          .value;

      const remember =
        el('remember')
          ? el('remember').checked
          : false;

      try {
        if (
          !email ||
          !password
        ) {
          throw new Error(
            'Informe o e-mail e a senha.'
          );
        }

        const result =
          await api(
            'login',
            'POST',
            {
              email:
                email,
              password:
                password,
              remember:
                remember
            }
          );

        saveSession(
          result,
          remember
        );

        message(
          'Login realizado com sucesso.'
        );

        await loadUser();

      } catch (error) {
        fail(error);
      }
    }
  );
}

function setupRegister() {
  const form =
    el('registerForm');

  if (!form) {
    return;
  }

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      const name =
        el('rname')
          .value
          .trim();

      const email =
        el('remail')
          .value
          .trim();

      const password =
        el('rpassword')
          .value;

      try {
        if (
          !name ||
          !email ||
          !password
        ) {
          throw new Error(
            'Preencha todos os campos.'
          );
        }

        if (
          password.length < 8
        ) {
          throw new Error(
            'A senha precisa ter pelo menos 8 caracteres.'
          );
        }

        const result =
          await api(
            'users/register',
            'POST',
            {
              name:
                name,
              email:
                email,
              password:
                password
            }
          );

        el('email').value =
          email;

        form.reset();

        show('login');

        message(
          result.message ||
            'Conta criada com sucesso. Agora faça login.'
        );

      } catch (error) {
        fail(error);
      }
    }
  );
}

function setupForgot() {
  const form =
    el('forgotForm');

  if (!form) {
    return;
  }

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      const email =
        el('femail')
          .value
          .trim();

      try {
        if (!email) {
          throw new Error(
            'Informe seu e-mail.'
          );
        }

        const result =
          await api(
            'forgot-password',
            'POST',
            {
              email:
                email
            }
          );

        form.reset();

        show('login');

        message(
          result.message ||
            'Solicitação enviada.'
        );

      } catch (error) {
        fail(error);
      }
    }
  );
}

async function setupReset() {
  const form =
    el('resetForm');

  if (!form) {
    return;
  }

  const params =
    new URLSearchParams(
      window.location.search
    );

  const resetToken =
    params.get('reset');

  if (!resetToken) {
    return;
  }

  show('reset');

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      const password =
        el('newpassword')
          .value;

      try {
        if (
          password.length < 8
        ) {
          throw new Error(
            'A nova senha precisa ter pelo menos 8 caracteres.'
          );
        }

        const result =
          await api(
            'reset-password',
            'POST',
            {
              token:
                resetToken,
              password:
                password
            }
          );

        form.reset();

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );

        show('login');

        message(
          result.message ||
            'Senha alterada com sucesso. Faça login.'
        );

      } catch (error) {
        fail(error);
      }
    }
  );
}

function setupPlayer() {
  const button =
    el('playerStart');

  if (button) {
    button.addEventListener(
      'click',
      startPlayerStream
    );
  }
}

function setupAdmin() {
  const start =
    el('startStream');

  const stop =
    el('stopStream');

  const toggle =
    el('toggleStream');

  const refreshStream =
    el('refreshStream');

  const refreshAdmin =
    el('refreshAdmin');

  const timeForm =
    el('timeForm');

  if (start) {
    start.addEventListener(
      'click',
      startAdminStream
    );
  }

  if (stop) {
    stop.addEventListener(
      'click',
      stopAdminStream
    );
  }

  if (toggle) {
    toggle.addEventListener(
      'click',
      toggleAdminStream
    );
  }

  if (refreshStream) {
    refreshStream.addEventListener(
      'click',
      async function () {
        try {
          await loadStreamStatus();

          message(
            'Status do GameCloud atualizado.'
          );

        } catch (error) {
          fail(error);
        }
      }
    );
  }

  if (refreshAdmin) {
    refreshAdmin.addEventListener(
      'click',
      async function () {
        try {
          await loadAdmin();

          await loadStreamStatus();

          message(
            'Painel atualizado.'
          );

        } catch (error) {
          fail(error);
        }
      }
    );
  }

  if (timeForm) {
    timeForm.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        const email =
          el('playerEmail')
            .value
            .trim();

        const minutes =
          Number(
            el('addMinutes')
              .value
          );

        try {
          if (!email) {
            throw new Error(
              'Informe o e-mail do jogador.'
            );
          }

          if (
            !Number.isSafeInteger(
              minutes
            ) ||
            minutes < 1 ||
            minutes > 100000
          ) {
            throw new Error(
              'Informe de 1 a 100000 minutos.'
            );
          }

          const result =
            await api(
              'admin/time/add',
              'POST',
              {
                email:
                  email,
                minutes:
                  minutes
              }
            );

          timeForm.reset();

          await loadAdmin();

          const updatedMinutes =
            result.user &&
            result.user.minutes !== undefined
              ? result.user.minutes
              : null;

          message(
            updatedMinutes !== null
              ? 'Tempo atualizado. O jogador agora possui ' +
                formatMinutes(
                  updatedMinutes
                ) +
                '.'
              : (
                result.message ||
                'Tempo do jogador atualizado com sucesso.'
              )
          );

        } catch (error) {
          fail(error);
        }
      }
    );
  }
}

async function init() {
  setupNavigation();

  setupLogin();
  setupRegister();
  setupForgot();
  setupPlayer();
  setupAdmin();

  /*
   * Cria o botão/tela de administrador.
   */
  createAdminLogin();

  document
    .querySelectorAll(
      '.logout'
    )
    .forEach(
      function (button) {
        button.addEventListener(
          'click',
          logout
        );
      }
    );

  const refresh =
    el('refresh');

  if (refresh) {
    refresh.addEventListener(
      'click',
      async function () {
        try {
          await loadUser();

          message(
            'Dados atualizados.'
          );

        } catch (error) {
          fail(error);
        }
      }
    );
  }

  await setupReset();

  const resetToken =
    new URLSearchParams(
      window.location.search
    ).get('reset');

  if (token) {
    try {
      /*
       * Se já existe uma sessão de administrador,
       * abrimos diretamente o painel.
       */
      if (role === 'admin') {
        show('admin');

        await loadAdmin();
        await loadStreamStatus();

        return;
      }

      await loadUser();

    } catch (error) {
      clearSession();

      show('login');

      message(
        'Sua sessão expirou. Entre novamente.',
        true
      );
    }

  } else if (!resetToken) {
    show('login');
  }
}

document.addEventListener(
  'DOMContentLoaded',
  function () {
    init().catch(fail);
  }
);

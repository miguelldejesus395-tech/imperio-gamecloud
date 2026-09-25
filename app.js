'use strict';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role = '';

const API_BASE =
  'https://imperio-gamecloud-1.onrender.com/api/';

const el = id => document.getElementById(id);

function show(page) {
  document
    .querySelectorAll('.page')
    .forEach(p =>
      p.classList.toggle('active', p.id === page)
    );

  message('');
}

function message(text, error = false) {
  const p = el('message');

  if (!p) return;

  p.textContent = text;
  p.className = error ? 'error' : 'success';
}

async function api(url, method = 'GET', data) {
  const response = await fetch(API_BASE + url, {
    method,

    headers: {
      'Content-Type': 'application/json',

      ...(token
        ? {
            Authorization:
              'Bearer ' + token
          }
        : {})
    },

    ...(data
      ? {
          body: JSON.stringify(data)
        }
      : {})
  });

  let body;

  try {
    body = await response.json();
  } catch {
    throw Error(
      'Resposta inválida do servidor.'
    );
  }

  if (!response.ok) {
    throw Error(
      body.error ||
      'Falha na conexão'
    );
  }

  return body;
}

async function load() {
  const me = await api('me');

  role = me.role;

  if (role === 'admin') {

    show('admin');

    await loadAdmin();

    await loadStreamStatus();

  } else {

    show('home');

    el('greeting').textContent =
      'Olá, ' + me.name + '!';

    el('minutes').textContent =
      me.minutes + ' minutos';

    await loadPlayerStreamStatus();
  }
}

async function loadAdmin() {
  const data =
    await api('admin/overview');

  el('users').textContent =
    data.users;

  el('online').textContent =
    data.playersOnline;

  const tbody =
    el('players');

  tbody.replaceChildren();

  data.players.forEach(player => {

    const tr =
      document.createElement('tr');

    [
      player.name,
      player.email,
      String(player.minutes),
      player.online
        ? 'Online'
        : 'Offline'
    ].forEach(value => {

      const td =
        document.createElement('td');

      td.textContent =
        value;

      tr.append(td);
    });

    tbody.append(tr);
  });
}

function setStreamStatus(element, status) {

  if (!element) {
    return;
  }

  element.className = '';

  if (status === 'online') {
    element.classList.add('online');
    element.textContent =
      '🟢 ONLINE';
    return;
  }

  if (status === 'starting') {
    element.classList.add('starting');
    element.textContent =
      '🟡 INICIANDO';
    return;
  }

  element.classList.add('offline');

  element.textContent =
    '⚪ OFFLINE';
}

function formatHeartbeat(value) {

  if (!value) {
    return 'Último contato: —';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Último contato: —';
  }

  return (
    'Último contato: ' +
    date.toLocaleString(
      'pt-BR'
    )
  );
}

async function loadStreamStatus() {

  try {

    const data =
      await api('stream/status');

    setStreamStatus(
      el('streamStatus'),
      data.status
    );

    el('streamGame').textContent =
      'Jogo: ' +
      (data.game || 'FiveM');

    el('streamHost').textContent =
      'Computador: ' +
      (data.host || '—');

    el('streamMessage').textContent =
      data.message || '—';

    el('streamHeartbeat').textContent =
      formatHeartbeat(
        data.lastHeartbeat
      );

  } catch (error) {

    if (el('streamStatus')) {

      el('streamStatus').textContent =
        'Erro ao consultar';

      el('streamStatus').className =
        'error';
    }

    console.error(
      error
    );
  }
}

async function loadPlayerStreamStatus() {

  try {

    const data =
      await api('stream/status');

    setStreamStatus(
      el('playerStreamStatus'),
      data.status
    );

    el('playerStreamMessage').textContent =
      data.message ||
      'Nenhuma informação disponível.';

  } catch (error) {

    el('playerStreamStatus').textContent =
      'Não foi possível verificar';

    el('playerStreamStatus').className =
      'error';

    el('playerStreamMessage').textContent =
      'Servidor GameCloud indisponível.';

    console.error(
      error
    );
  }
}

async function controlStream(
  endpoint,
  successMessage
) {

  try {

    await api(
      endpoint,
      'POST'
    );

    message(
      successMessage
    );

    await loadStreamStatus();

  } catch (error) {

    fail(error);
  }
}

function fail(error) {

  message(
    error.message ||
      'Não foi possível conectar ao servidor. Verifique se ele está ligado.',
    true
  );
}

/* Navegação */

document
  .querySelectorAll('[data-page]')
  .forEach(button => {

    button.addEventListener(
      'click',
      () => {
        show(
          button.dataset.page
        );
      }
    );
  });

/* Login */

el('loginForm')
  .addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const remember =
          el('remember').checked;

        const result =
          await api(
            'login',
            'POST',
            {
              email:
                el('email').value,

              password:
                el('password').value,

              remember
            }
          );

        token =
          result.token;

        localStorage.removeItem(
          'igc_token'
        );

        sessionStorage.removeItem(
          'igc_token'
        );

        (
          remember
            ? localStorage
            : sessionStorage
        ).setItem(
          'igc_token',
          token
        );

        el('password').value =
          '';

        await load();

      } catch (error) {

        fail(error);
      }
    }
  );

/* Cadastro */

el('registerForm')
  .addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        await api(
          'users/register',
          'POST',
          {
            name:
              el('rname').value,

            email:
              el('remail').value,

            password:
              el('rpassword').value
          }
        );

        el('email').value =
          el('remail').value;

        el('rpassword').value =
          '';

        show('login');

        message(
          'Conta criada! Entre com seu e-mail e senha.'
        );

      } catch (error) {

        fail(error);
      }
    }
  );

/* Recuperar senha */

el('forgotForm')
  .addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const result =
          await api(
            'password/forgot',
            'POST',
            {
              email:
                el('femail').value
            }
          );

        message(
          result.message
        );

      } catch (error) {

        fail(error);
      }
    }
  );

/* Alterar senha */

el('resetForm')
  .addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        await api(
          'password/reset',
          'POST',
          {
            token:
              new URLSearchParams(
                location.search
              ).get('reset'),

            password:
              el('newpassword').value
          }
        );

        history.replaceState(
          null,
          '',
          location.pathname
        );

        show('login');

        message(
          'Senha alterada. Entre novamente.'
        );

      } catch (error) {

        fail(error);
      }
    }
  );

/* Adicionar tempo */

el('timeForm')
  .addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const result =
          await api(
            'admin/time/add',
            'POST',
            {
              email:
                el('playerEmail').value,

              minutes:
                Number(
                  el('addMinutes').value
                )
            }
          );

        await loadAdmin();

        message(
          'Tempo atualizado: ' +
          result.minutes +
          ' minutos.'
        );

      } catch (error) {

        fail(error);
      }
    }
  );

/* Controle do GameCloud */

el('startStream')
  .addEventListener(
    'click',
    async () => {

      await controlStream(
        'admin/stream/start',
        'Comando para iniciar o FiveM enviado ao GameCloud.'
      );
    }
  );

el('stopStream')
  .addEventListener(
    'click',
    async () => {

      await controlStream(
        'admin/stream/stop',
        'Comando para encerrar o FiveM enviado ao GameCloud.'
      );
    }
  );

el('toggleStream')
  .addEventListener(
    'click',
    async () => {

      await controlStream(
        'admin/stream/toggle',
        'Estado do streaming atualizado.'
      );
    }
  );

el('refreshStream')
  .addEventListener(
    'click',
    async () => {

      await loadStreamStatus();

      message(
        'Status do GameCloud atualizado.'
      );
    }
  );

/* Atualizar jogador */

el('refresh')
  .addEventListener(
    'click',
    async () => {

      try {

        await load();

        message(
          'Dados atualizados.'
        );

      } catch (error) {

        fail(error);
      }
    }
  );

/* Atualizar painel */

el('refreshAdmin')
  .addEventListener(
    'click',
    async () => {

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

/* Logout */

document
  .querySelectorAll('.logout')
  .forEach(button => {

    button.addEventListener(
      'click',
      async () => {

        try {

          await api(
            'logout',
            'POST'
          );

        } catch {}

        token = '';

        localStorage.removeItem(
          'igc_token'
        );

        sessionStorage.removeItem(
          'igc_token'
        );

        show('login');

        message(
          'Você saiu da conta.'
        );
      }
    );
  });

/* Inicialização */

if (
  new URLSearchParams(
    location.search
  ).has('reset')
) {

  show('reset');

} else if (token) {

  load().catch(() => {

    token = '';

    localStorage.removeItem(
      'igc_token'
    );

    sessionStorage.removeItem(
      'igc_token'
    );

    show('login');
  });
}

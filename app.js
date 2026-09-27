/* =========================================================
   IMPÉRIO GAMECLOUD
   APP.JS
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   CONFIGURAÇÃO
--------------------------------------------------------- */

const API_BASE = 'https://imperio-gamecloud-1.onrender.com/api';

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

let siteConfig =
  JSON.parse(JSON.stringify(defaultSiteConfig));

let session = null;

let currentUser = null;

let currentAdmin = false;

let packages = [];

let servers = [];

let orders = [];

let tickets = [];

let adminData = {
  users: [],
  servers: [],
  orders: [],
  packages: [],
  tickets: [],
  minutesRateCents: 0
};

let selectedPackage = null;

let selectedMinutes = 0;

let cart = { packageId: null, minutes: 0 };
let minutesRateCents = 0;

function saveCart() {
  try {
    localStorage.setItem('gamecloud_cart', JSON.stringify(cart));
  } catch (error) {
    console.warn('Não foi possível salvar o carrinho:', error);
  }
}

function loadCart() {
  try {
    const raw = localStorage.getItem('gamecloud_cart');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && Number.isSafeInteger(Number(saved.minutes)) && Number(saved.minutes) >= 0) {
      cart = { packageId: saved.packageId || null, minutes: Number(saved.minutes) };
      selectedMinutes = Number(saved.minutes);
    }
  } catch (error) {
    console.warn('Não foi possível carregar o carrinho:', error);
    cart = { packageId: null, minutes: 0 };
  }
}
/* FiveM mini dashboard panel */
let fivemMiniTimer = null;
let fivemMiniServerId = null;
function updateFiveMMini(stream, server) {
  const panel=$('fivemMiniPanel'); if(!panel) return;
  const s=stream||{};
  const status=String(s.status||'offline');
  const labels={online:'Online',starting:'Iniciando...',stopping:'Parando...',error:'Erro',offline:'Offline'};
  const badge=$('fivemMiniBadge'), state=$('fivemMiniStatus');
  if(badge){badge.textContent=labels[status]||status;badge.className='status '+(status==='online'?'online':'');}
  if(state) state.textContent=labels[status]||status;
  if($('fivemMiniMessage')) $('fivemMiniMessage').textContent=s.message||'Aguardando o PC de streaming.';
  if($('fivemMiniHost')) $('fivemMiniHost').textContent=s.host||'PC de streaming';
  if($('fivemMiniServer')) $('fivemMiniServer').textContent=server?.name||'Servidor FiveM';
  if($('fivemMiniPlayers')) $('fivemMiniPlayers').textContent=(server?.players!=null&&server?.maxPlayers!=null)?server.players+' / '+server.maxPlayers:'—';
  if($('fivemMiniUptime')) $('fivemMiniUptime').textContent=server?.uptime||'—';
  panel.classList.remove('hidden');
}
function stopFiveMMiniPolling(){if(fivemMiniTimer){clearInterval(fivemMiniTimer);fivemMiniTimer=null;}}
async function refreshFiveMMini(){
  try{
    const result=await api('/stream/status');
    const server=(servers||[]).find(x=>String(x.id)===String(fivemMiniServerId)) || (servers||[])[0];
    updateFiveMMini(result.streaming,server);
    return result.streaming;
  }catch(e){console.warn('Mini FiveM:',e);return null;}
}
function openFiveMMini(serverId){
  fivemMiniServerId=serverId||fivemMiniServerId;
  const panel=$('fivemMiniPanel'); if(!panel) return;
  panel.classList.remove('hidden','minimized');
  refreshFiveMMini();
  stopFiveMMiniPolling();
  fivemMiniTimer=setInterval(refreshFiveMMini,5000);
}
function closeFiveMMini(){stopFiveMMiniPolling();$('fivemMiniPanel')?.classList.add('hidden');}
function bindFiveMMini(){
  const close = $('fivemMiniClose');
  const minimize = $('fivemMiniMinimize');
  const fullscreen = $('fivemMiniFullscreen');

  if (close && !close.dataset.bound) {
    close.dataset.bound = '1';
    close.addEventListener('click', closeFiveMMini);
  }

  if (minimize && !minimize.dataset.bound) {
    minimize.dataset.bound = '1';
    minimize.addEventListener('click', () => {
      $('fivemMiniPanel')?.classList.toggle('minimized');
    });
  }

  if (fullscreen && !fullscreen.dataset.bound) {
    fullscreen.dataset.bound = '1';
    fullscreen.addEventListener('click', () => {
      const panel = $('fivemMiniPanel');
      if (!panel) return;
      panel.classList.toggle('fullscreen');
      panel.classList.remove('minimized');
    });
  }
}



/* ---------------------------------------------------------
   ELEMENTOS
--------------------------------------------------------- */

const $ = (selector) =>
  document.querySelector(selector);

const $ = (selector) =>
  Array.from(document.querySelectorAll(selector));

/* Segurança de cliques principais: funciona mesmo se a inicialização
   de um painel falhar antes de registrar os listeners locais. */
document.addEventListener('click', event => {
  const button = event.target.closest?.('#addToCart');
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  addMinutesToCart();
}, true);


/* ---------------------------------------------------------
   MENSAGENS
--------------------------------------------------------- */

function showMessage(element, message, error = false) {

  if (!element) return;

  element.textContent = message || '';

  element.classList.toggle('error', !!error);
}


function say(message, error = false) {

  showMessage(
    $('#message'),
    message,
    error
  );
}


/* ---------------------------------------------------------
   API
--------------------------------------------------------- */

async function api(path, options = {}) {

  const headers = {
    ...(options.headers || {})
  };

  if (
    options.body &&
    typeof options.body !== 'string'
  ) {
    headers['Content-Type'] = 'application/json';

    options.body =
      JSON.stringify(options.body);
  }

  const isAuthEntryPoint =
    path === '/login' ||
    path === '/admin/login' ||
    path === '/users/register' ||
    path === '/forgot-password' ||
    path === '/reset-password';

  if (
    session &&
    session.token &&
    !isAuthEntryPoint
  ) {

    headers.Authorization =
      `Bearer ${session.token}`;
  }

  const response =
    await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

  let data = null;

  const contentType =
    response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {

    data = await response.json();

  } else {

    const text =
      await response.text();

    data = {
      message: text
    };
  }

  if (!response.ok) {

    const error =
      new Error(
        data?.message ||
        data?.error ||
        `Erro HTTP ${response.status}`
      );

    error.status = response.status;

    throw error;
  }

  return data;
}


/* ---------------------------------------------------------
   SESSÃO
--------------------------------------------------------- */

function saveSession(data, remember = true) {

  session = data;

  const storage =
    remember
      ? localStorage
      : sessionStorage;

  localStorage.removeItem('gamecloud_session');
  sessionStorage.removeItem('gamecloud_session');

  storage.setItem(
    'gamecloud_session',
    JSON.stringify(data)
  );
}


function loadStoredSession() {

  let raw =
    localStorage.getItem('gamecloud_session');

  if (!raw) {

    raw =
      sessionStorage.getItem(
        'gamecloud_session'
      );
  }

  if (!raw) return null;

  try {

    return JSON.parse(raw);

  } catch {

    localStorage.removeItem(
      'gamecloud_session'
    );

    sessionStorage.removeItem(
      'gamecloud_session'
    );

    return null;
  }
}


function clearSession() {

  session = null;

  currentUser = null;

  currentAdmin = false;

  localStorage.removeItem(
    'gamecloud_session'
  );

  sessionStorage.removeItem(
    'gamecloud_session'
  );
}


/* ---------------------------------------------------------
   PÁGINAS DE AUTENTICAÇÃO
--------------------------------------------------------- */

function showPage(id) {

  $$('.page').forEach(page => {

    page.classList.toggle(
      'active',
      page.id === id
    );

  });
}


function showLogin() {

  showPage('loginPage');
}


function showRegister() {

  showPage('registerPage');
}


function showForgot() {

  showPage('forgotPage');
}


function showReset() {

  showPage('resetPage');
}


function showAdminLogin() {

  showPage('adminLoginPage');
}


/* ---------------------------------------------------------
   APLICAÇÃO
--------------------------------------------------------- */

function showUserApp() {

  showPage('app');

  currentAdmin = false;

  setupUserNavigation();

  showUserSection('home');

  loadUserData();
}


function showAdminApp() {

  showPage('admin');

  currentAdmin = true;

  setupAdminNavigation();

  showAdminSection('overview');

  loadAdminData();

  loadSiteConfig();
}


/* ---------------------------------------------------------
   NAVEGAÇÃO DO USUÁRIO
--------------------------------------------------------- */

function showUserSection(id) {

  $$('.content-section').forEach(section => {

    section.classList.toggle(
      'active',
      section.id === id
    );

  });

  $$('.nav-item[data-page]').forEach(button => {

    button.classList.toggle(
      'active',
      button.dataset.page === id
    );

  });

  const titles = {

    home: 'Visão geral',

    servers: 'Meus servidores',

    buy: 'Comprar servidor',

    cart: 'Carrinho',

    payment: 'Pagamento',

    fivem: 'FiveM',

    orders: 'Pedidos',

    profile: 'Perfil',

    settings: 'Configurações',

    support: 'Suporte'
  };

  const title =
    $('#topbarTitle');

  if (title) {

    title.textContent =
      titles[id] || 'Império GameCloud';
  }
}


function setupUserNavigation() {

  $$('[data-page]').forEach(button => {

    if (
      button.dataset.page &&
      !button.dataset.bound
    ) {

      button.dataset.bound = '1';

      button.addEventListener(
        'click',
        () => {

          showUserSection(
            button.dataset.page
          );

        }
      );
    }

  });
}


/* ---------------------------------------------------------
   NAVEGAÇÃO ADMIN
--------------------------------------------------------- */

function showAdminSection(id) {

  $$('.admin-section').forEach(section => {

    section.classList.toggle(
      'active',
      section.id === `admin-${id}`
    );

  });

  $$('.admin-tab').forEach(button => {

    button.classList.toggle(
      'active',
      button.dataset.adminPage === id
    );

  });

  if (id === 'editor') {

    loadSiteConfig();

  }

}


function setupAdminAgents() {
  loadAdminAgents();
}

function setupAdminNavigation() {

  $$('.admin-tab').forEach(button => {

    if (button.dataset.bound) return;

    button.dataset.bound = '1';

    button.addEventListener(
      'click',
      () => {

        showAdminSection(
          button.dataset.adminPage
        );

      }
    );

  });
}


/* ---------------------------------------------------------
   CONFIGURAÇÃO DO SITE
--------------------------------------------------------- */

function cloneDefaultSiteConfig() {

  return JSON.parse(
    JSON.stringify(defaultSiteConfig)
  );
}


function mergeSiteConfig(config) {

  const base =
    cloneDefaultSiteConfig();

  if (!config || typeof config !== 'object') {

    return base;
  }

  return {

    ...base,

    ...config,

    home: {
      ...base.home,
      ...(config.home || {})
    },

    theme: {
      ...base.theme,
      ...(config.theme || {})
    }

  };
}


/* ---------------------------------------------------------
   APLICAR CONFIGURAÇÃO
--------------------------------------------------------- */

function applySiteConfig(config) {

  siteConfig =
    mergeSiteConfig(config);

  const root =
    document.documentElement;

  root.style.setProperty(
    '--gold',
    siteConfig.theme.gold
  );

  root.style.setProperty(
    '--gold2',
    siteConfig.theme.gold
  );

  root.style.setProperty(
    '--bg',
    siteConfig.theme.background
  );


  /* Marca */

  $$('.brand strong').forEach(element => {

    element.textContent =
      siteConfig.brandName;

  });


  /* Login */

  const loginTitle =
    $('#loginTitle');

  if (loginTitle) {

    loginTitle.textContent =
      siteConfig.authTitle;

  }


  const loginText =
    $('#loginText');

  if (loginText) {

    loginText.textContent =
      siteConfig.authText;

  }


  /* Tela inicial */

  const eyebrow =
    $('#homeEyebrow');

  if (eyebrow) {

    eyebrow.textContent =
      siteConfig.home.eyebrow;

  }


  const homeText =
    $('#homeText');

  if (homeText) {

    homeText.textContent =
      siteConfig.home.text;

  }


  const primary =
    $('#homePrimaryButton');

  if (primary) {

    primary.textContent =
      siteConfig.home.primaryButton;

  }


  const secondary =
    $('#homeSecondaryButton');

  if (secondary) {

    secondary.textContent =
      siteConfig.home.secondaryButton;

  }


  /* Imagem */

  const hero =
    $('#homeHero');

  if (hero && siteConfig.home.heroImage) {

    hero.style.backgroundImage =
      `linear-gradient(90deg,#111720f5 0%,#111720db 48%,#11172035 100%),url("${siteConfig.home.heroImage}")`;

  }


  updateEditorPreview();

}


/* ---------------------------------------------------------
   CARREGAR CONFIGURAÇÃO DO SERVIDOR
--------------------------------------------------------- */

async function loadSiteConfig() {

  try {

    const data =
      await api('/site-config');

    const config =
      data?.siteConfig ||
      data?.config ||
      data;

    siteConfig =
      mergeSiteConfig(config);

    applySiteConfig(siteConfig);

    fillSiteEditor(siteConfig);

  } catch (error) {

    console.warn(
      'Não foi possível carregar site-config:',
      error
    );

    siteConfig =
      cloneDefaultSiteConfig();

    applySiteConfig(siteConfig);

    fillSiteEditor(siteConfig);
  }
}


/* ---------------------------------------------------------
   PREENCHER EDITOR
--------------------------------------------------------- */

function fillSiteEditor(config) {

  const fields = {

    editorBrandName:
      config.brandName,

    editorAuthTitle:
      config.authTitle,

    editorAuthText:
      config.authText,

    editorHomeEyebrow:
      config.home.eyebrow,

    editorHomeTitle:
      config.home.title,

    editorHomeText:
      config.home.text,

    editorPrimaryButton:
      config.home.primaryButton,

    editorSecondaryButton:
      config.home.secondaryButton,

    editorGold:
      config.theme.gold,

    editorGoldText:
      config.theme.gold,

    editorBackground:
      config.theme.background,

    editorBackgroundText:
      config.theme.background
  };


  Object.entries(fields)
    .forEach(([id, value]) => {

      const element =
        document.getElementById(id);

      if (element) {

        element.value =
          value ?? '';

      }

    });


  const imageValue =
    $('#editorHeroImageValue');

  if (imageValue) {

    imageValue.value =
      config.home.heroImage || '';

  }


  const image =
    $('#editorHeroImage');

  if (
    image &&
    config.home.heroImage
  ) {

    image.src =
      config.home.heroImage;

    image.style.display =
      'block';

  }

  updateEditorPreview();
}
/* =========================================================
   EDITOR VISUAL
   ========================================================= */

function getEditorValue(id, fallback = '') {

  const element =
    document.getElementById(id);

  if (!element) return fallback;

  return element.value.trim();
}


function editorConfigFromForm() {

  const config =
    cloneDefaultSiteConfig();

  config.brandName =
    getEditorValue(
      'editorBrandName',
      config.brandName
    );

  config.authTitle =
    getEditorValue(
      'editorAuthTitle',
      config.authTitle
    );

  config.authText =
    getEditorValue(
      'editorAuthText',
      config.authText
    );

  config.home.eyebrow =
    getEditorValue(
      'editorHomeEyebrow',
      config.home.eyebrow
    );

  config.home.title =
    getEditorValue(
      'editorHomeTitle',
      config.home.title
    );

  config.home.text =
    getEditorValue(
      'editorHomeText',
      config.home.text
    );

  config.home.primaryButton =
    getEditorValue(
      'editorPrimaryButton',
      config.home.primaryButton
    );

  config.home.secondaryButton =
    getEditorValue(
      'editorSecondaryButton',
      config.home.secondaryButton
    );

  config.home.heroImage =
    getEditorValue(
      'editorHeroImageValue',
      config.home.heroImage
    );

  const gold =
    getEditorValue(
      'editorGoldText',
      config.theme.gold
    );

  const background =
    getEditorValue(
      'editorBackgroundText',
      config.theme.background
    );

  if (/^#[0-9a-fA-F]{6}$/.test(gold)) {

    config.theme.gold =
      gold;

  }

  if (/^#[0-9a-fA-F]{6}$/.test(background)) {

    config.theme.background =
      background;

  }

  return config;
}


/* ---------------------------------------------------------
   PRÉVIA DO EDITOR
--------------------------------------------------------- */

function updateEditorPreview() {

  const config =
    editorConfigFromForm();

  const previewEyebrow =
    $('#previewEyebrow');

  const previewTitle =
    $('#previewTitle');

  const previewText =
    $('#previewText');

  const previewPrimary =
    $('#previewPrimary');

  const previewSecondary =
    $('#previewSecondary');

  const previewHero =
    $('#editorPreviewHero');


  if (previewEyebrow) {

    previewEyebrow.textContent =
      config.home.eyebrow;

  }


  if (previewTitle) {

    previewTitle.textContent =
      config.home.title.replace(
        '{name}',
        'jogador'
      );

  }


  if (previewText) {

    previewText.textContent =
      config.home.text;

  }


  if (previewPrimary) {

    previewPrimary.textContent =
      config.home.primaryButton;

  }


  if (previewSecondary) {

    previewSecondary.textContent =
      config.home.secondaryButton;

  }


  if (previewHero) {

    previewHero.style.backgroundImage =
      `linear-gradient(90deg,#111720f5 0%,#111720db 48%,#11172035 100%),url("${config.home.heroImage || 'imperio-usuario.png'}")`;

  }

}


/* ---------------------------------------------------------
   STATUS DO EDITOR
--------------------------------------------------------- */

function setEditorStatus(
  message,
  error = false
) {

  const element =
    $('#editorStatus');

  if (!element) return;

  element.textContent =
    message || '';

  element.classList.toggle(
    'error',
    !!error
  );
}


/* ---------------------------------------------------------
   SALVAR EDITOR
--------------------------------------------------------- */

async function saveSiteConfig() {

  const config =
    editorConfigFromForm();

  if (!config.brandName) {

    setEditorStatus(
      'Informe o nome da marca.',
      true
    );

    return;

  }

  if (!config.authTitle) {

    setEditorStatus(
      'Informe o título da tela de login.',
      true
    );

    return;

  }

  if (!config.home.title) {

    setEditorStatus(
      'Informe o título da tela inicial.',
      true
    );

    return;

  }

  setEditorStatus(
    'Salvando alterações...'
  );


  try {

    const result =
      await api(
        '/admin/site-config',
        {
          method: 'POST',
          body: {
            siteConfig: config
          }
        }
      );


    siteConfig =
      mergeSiteConfig(
        result?.siteConfig ||
        result?.config ||
        config
      );


    applySiteConfig(
      siteConfig
    );

    fillSiteEditor(
      siteConfig
    );


    setEditorStatus(
      '✓ Alterações publicadas com sucesso.'
    );


  } catch (error) {

    console.error(
      'Erro ao salvar editor:',
      error
    );

    setEditorStatus(
      error.message ||
      'Não foi possível salvar as alterações.',
      true
    );

  }

}


/* ---------------------------------------------------------
   RESTAURAR PADRÃO
--------------------------------------------------------- */

function restoreSiteConfig() {

  const config =
    cloneDefaultSiteConfig();

  fillSiteEditor(
    config
  );

  applySiteConfig(
    config
  );

  setEditorStatus(
    'Padrão restaurado na prévia. Clique em "Publicar alterações" para salvar.'
  );

}


/* ---------------------------------------------------------
   UPLOAD DA IMAGEM
--------------------------------------------------------- */

function setupEditorImageUpload() {

  const input =
    $('#editorHeroUpload');

  if (!input || input.dataset.bound) {
    return;
  }

  input.dataset.bound =
    '1';


  input.addEventListener(
    'change',
    () => {

      const file =
        input.files?.[0];

      if (!file) return;


      if (!file.type.startsWith('image/')) {

        setEditorStatus(
          'Escolha uma imagem PNG, JPG ou WEBP.',
          true
        );

        input.value =
          '';

        return;

      }


      const maxSize =
        750 * 1024;


      if (file.size > maxSize) {

        setEditorStatus(
          'A imagem é muito grande. O limite é 750 KB.',
          true
        );

        input.value =
          '';

        return;

      }


      const reader =
        new FileReader();


      reader.onload = () => {

        const result =
          reader.result;

        if (
          typeof result !== 'string'
        ) {

          setEditorStatus(
            'Não foi possível ler a imagem.',
            true
          );

          return;

        }


        const hidden =
          $('#editorHeroImageValue');

        const preview =
          $('#editorHeroImage');


        if (hidden) {

          hidden.value =
            result;

        }


        if (preview) {

          preview.src =
            result;

          preview.style.display =
            'block';

        }


        updateEditorPreview();


        setEditorStatus(
          'Imagem carregada na prévia. Publique para salvar.'
        );

      };


      reader.onerror = () => {

        setEditorStatus(
          'Erro ao ler a imagem.',
          true
        );

      };


      reader.readAsDataURL(file);

    }
  );

}


/* ---------------------------------------------------------
   CAMPOS DO EDITOR EM TEMPO REAL
--------------------------------------------------------- */

function setupEditorLivePreview() {

  const ids = [

    'editorBrandName',

    'editorAuthTitle',

    'editorAuthText',

    'editorHomeEyebrow',

    'editorHomeTitle',

    'editorHomeText',

    'editorPrimaryButton',

    'editorSecondaryButton',

    'editorGoldText',

    'editorBackgroundText'

  ];


  ids.forEach(id => {

    const element =
      document.getElementById(id);

    if (!element || element.dataset.bound) {
      return;
    }

    element.dataset.bound =
      '1';


    element.addEventListener(
      'input',
      () => {

        const color =
          id === 'editorGoldText'
            ? $('#editorGold')
            : id === 'editorBackgroundText'
              ? $('#editorBackground')
              : null;


        if (color) {

          const value =
            element.value.trim();

          if (
            /^#[0-9a-fA-F]{6}$/.test(value)
          ) {

            color.value =
              value;

          }

        }


        updateEditorPreview();

      }
    );

  });


  const gold =
    $('#editorGold');

  if (
    gold &&
    !gold.dataset.bound
  ) {

    gold.dataset.bound =
      '1';

    gold.addEventListener(
      'input',
      () => {

        const text =
          $('#editorGoldText');

        if (text) {

          text.value =
            gold.value;

        }

        updateEditorPreview();

      }
    );

  }


  const background =
    $('#editorBackground');

  if (
    background &&
    !background.dataset.bound
  ) {

    background.dataset.bound =
      '1';

    background.addEventListener(
      'input',
      () => {

        const text =
          $('#editorBackgroundText');

        if (text) {

          text.value =
            background.value;

        }

        updateEditorPreview();

      }
    );

  }

}


/* ---------------------------------------------------------
   CONFIGURAR EDITOR
--------------------------------------------------------- */

function setupSiteEditor() {

  const form =
    $('#siteEditorForm');


  if (
    form &&
    !form.dataset.bound
  ) {

    form.dataset.bound =
      '1';


    form.addEventListener(
      'submit',
      async event => {

        event.preventDefault();

        await saveSiteConfig();

      }
    );

  }


  const restore =
    $('#restoreSiteConfig');


  if (
    restore &&
    !restore.dataset.bound
  ) {

    restore.dataset.bound =
      '1';

    restore.addEventListener(
      'click',
      restoreSiteConfig
    );

  }


  setupEditorImageUpload();

  setupEditorLivePreview();

}


/* ---------------------------------------------------------
   LOGIN
--------------------------------------------------------- */

async function handleLogin(event) {

  event.preventDefault();

  /*
     O login comum sempre começa uma sessão nova.
     Isso impede que um token/admin anterior seja reutilizado
     nesta tela.
  */
  clearSession();

  const message =
    $('#message');

  showMessage(
    message,
    'Entrando...'
  );


  const email =
    $('#loginEmail')?.value.trim();

  const password =
    $('#loginPassword')?.value || '';

  const remember =
    $('#rememberMe')?.checked !== false;


  try {

    const result =
      await api(
        '/login',
        {
          method: 'POST',
          body: {
            email,
            password,
            remember
          }
        }
      );


    if (!result?.token) {

      throw new Error(
        'O servidor não retornou uma sessão válida.'
      );

    }


    if (result.role === 'admin') {

      throw new Error(
        'Use o acesso administrativo para entrar como administrador.'
      );

    }

    saveSession(
      {
        ...result,
        role: 'player'
      },
      remember
    );

    currentAdmin = false;

    currentUser =
      result.user || null;

    showUserApp();


  } catch (error) {

    console.error(
      'Login:',
      error
    );

    showMessage(
      message,
      error.message ||
      'E-mail ou senha incorretos.',
      true
    );

  }

}


/* ---------------------------------------------------------
   REGISTRO
--------------------------------------------------------- */

async function handleRegister(event) {

  event.preventDefault();

  const message =
    $('#registerMessage');


  showMessage(
    message,
    'Criando sua conta...'
  );


  const name =
    $('#registerName')?.value.trim();

  const email =
    $('#registerEmail')?.value.trim();

  const password =
    $('#registerPassword')?.value || '';


  if (password.length < 8) {

    showMessage(
      message,
      'A senha precisa ter pelo menos 8 caracteres.',
      true
    );

    return;

  }


  try {

    const result =
      await api(
        '/users/register',
        {
          method: 'POST',
          body: {
            name,
            email,
            password
          }
        }
      );


    showMessage(
      message,
      result?.message ||
      'Conta criada com sucesso.'
    );


    setTimeout(
      () => {

        showLogin();

        const loginEmail =
          $('#loginEmail');

        if (loginEmail) {

          loginEmail.value =
            email;

        }

      },
      700
    );


  } catch (error) {

    console.error(
      'Registro:',
      error
    );

    showMessage(
      message,
      error.message ||
      'Não foi possível criar a conta.',
      true
    );

  }

}


/* ---------------------------------------------------------
   LOGIN ADMIN
--------------------------------------------------------- */

async function handleAdminLogin(event) {

  event.preventDefault();

  /*
     O acesso administrativo também começa uma sessão limpa,
     sem herdar o token do usuário comum.
  */
  clearSession();

  const message =
    $('#adminLoginMessage');


  showMessage(
    message,
    'Entrando...'
  );


  const user =
    $('#adminUser')?.value.trim();

  const password =
    $('#adminPassword')?.value || '';


  try {

    const result =
      await api(
        '/admin/login',
        {
          method: 'POST',
          body: {
            username: user,
            password
          }
        }
      );


    if (
      result?.role !== 'admin'
    ) {

      throw new Error(
        'Essa conta não possui acesso administrativo.'
      );

    }


    saveSession(
      result,
      true
    );


    showAdminApp();


  } catch (error) {

    console.error(
      'Login admin:',
      error
    );

    showMessage(
      message,
      error.message ||
      'Credenciais administrativas inválidas.',
      true
    );

  }

}


/* ---------------------------------------------------------
   LOGOUT
--------------------------------------------------------- */

async function logout() {

  try {
    if (session?.token) {
      await api('/logout', {
        method: 'POST'
      });
    }
  } catch (error) {
    console.warn('Logout:', error);
  } finally {
    clearSession();
    showLogin();
  }

}


async function logoutAdmin() {

  try {
    if (session?.token) {
      await api('/logout', {
        method: 'POST'
      });
    }
  } catch (error) {
    console.warn('Logout admin:', error);
  } finally {
    clearSession();
    showLogin();
  }

}
/* =========================================================
   DADOS DO USUÁRIO
   ========================================================= */

async function loadUserData() {
  try {
    const result = await api('/me');

    currentUser = result.user || result;

    const name =
      currentUser.name ||
      currentUser.username ||
      currentUser.email ||
      'Jogador';

    if ($('sideName')) $('sideName').textContent = name;
    if ($('topUser')) $('topUser').textContent = name;
    if ($('greetingName')) {
      $('greetingName').textContent =
        name;
    }

    if ($('minutes')) {
      $('minutes').textContent =
        Number(currentUser.minutes || 0).toLocaleString('pt-BR') + ' min';
    }

    if ($('profileName')) {
      $('profileName').value = currentUser.name || '';
    }

    if ($('profileEmail')) {
      $('profileEmail').value = currentUser.email || '';
    }

    if ($('profileUsername')) {
      $('profileUsername').value = currentUser.username || '';
    }

    await Promise.all([
      loadPackages(),
      loadServers(),
      loadOrders(),
      loadSupport()
    ]);

  } catch (error) {
    console.error(error);
    throw error;
  }
}


/* =========================================================
   PACOTES / CATÁLOGO
   ========================================================= */

async function loadPackages() {
  try {
    const result = await api('/packages');

    packages = Array.isArray(result.packages)
      ? result.packages
      : [];

    minutesRateCents =
      Number(result.minutesRateCents || 0);

    renderPackages();
    renderSelectionSummary();
    renderCart();

  } catch (error) {
    console.error('Erro ao carregar pacotes:', error);
  }
}


function renderPackages() {
  const root = $('packageGrid');
  if (!root) return;

  root.innerHTML = `
    <article class="package-card" style="grid-column:1/-1">
      <span class="eyebrow">SERVIDOR GAMECLOUD</span>
      <h3>Um único servidor. Você paga somente pelos minutos.</h3>
      <p class="muted">
        Não existem planos de RAM, vCPU, GPU ou armazenamento para escolher.
        Seu servidor FiveM é criado automaticamente quando o primeiro pedido
        de minutos for aprovado.
      </p>
      <div class="package-price">
        ${formatMoney(minutesRateCents)} <small>/ minuto</small>
      </div>
      <div class="notice green">
        Configuração do servidor definida pelo GameCloud. A cobrança é feita
        exclusivamente pelo tempo comprado.
      </div>
    </article>
  `;
}


/* =========================================================
   SERVIDORES
   ========================================================= */

async function loadServers() {
  try {
    const result = await api('/servers');

    servers = Array.isArray(result.servers)
      ? result.servers
      : [];

    renderServers();

  } catch (error) {
    console.error('Erro ao carregar servidores:', error);
  }
}


function renderServers() {
  const root = $('serversList');

  if (!root) return;

  if (!servers.length) {
    root.innerHTML = `
      <div class="panel">
        <h3>Nenhum servidor</h3>
        <p class="muted">
          Você ainda não possui servidores.
        </p>
      </div>
    `;
    return;
  }

  root.innerHTML = servers.map(server => {

    const online =
      String(server.status || '').toLowerCase() === 'online';

    return `
      <article class="server-card">

        <div class="server-card-top">

          <div>

            <span class="eyebrow">
              ${escapeHtml(server.type || 'Servidor')}
            </span>

            <h3>
              ${escapeHtml(server.name || 'Servidor')}
            </h3>

            <p>
              ${escapeHtml(
                server.userName ||
                'Sua instância GameCloud'
              )}
            </p>

          </div>

          <span class="status">

            <i class="dot ${online ? 'online' : ''}"></i>

            ${escapeHtml(
              server.status || 'offline'
            )}

          </span>

        </div>

        <div class="specs">

          <div class="spec">
            <small>RAM</small>
            <strong>
              ${Number(server.ram || 0)} GB
            </strong>
          </div>

          <div class="spec">
            <small>vCPU</small>
            <strong>
              ${Number(server.vcpu || 0)}
            </strong>
          </div>

          <div class="spec">
            <small>GPU</small>
            <strong>
              ${escapeHtml(server.gpu || '—')}
            </strong>
          </div>

          <div class="spec">
            <small>SSD</small>
            <strong>
              ${Number(server.storage || 0)} GB
            </strong>
          </div>

        </div>

        <div class="card-actions">

          <button
            class="btn primary small"
            data-fivem-start="${escapeHtml(server.id)}"
          >
            Abrir FiveM
          </button>

        </div>

      </article>
    `;

  }).join('');

  if ($('serverCount')) {
    $('serverCount').textContent =
      String(servers.length);
  }
}


/* =========================================================
   CARRINHO
   ========================================================= */

function renderCart() {
  const root = $('cartContent');
  if (!root) return;

  const minutes = Number(cart.minutes || 0);
  const rate = Number(minutesRateCents || 0);
  const total = minutes * rate;

  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    root.innerHTML = `
      <div class="empty">
        <h3>Seu carrinho está vazio</h3>
        <p>Escolha quantos minutos deseja comprar.</p>
      </div>
    `;

    if ($('cartSummary')) {
      $('cartSummary').innerHTML = `
        <div class="summary-line">
          <span>Total</span>
          <b>R$ 0,00</b>
        </div>
      `;
    }

    if ($('continueCheckout')) {
      $('continueCheckout').disabled = true;
    }
    return;
  }

  root.innerHTML = `
    <div class="panel-head">
      <div>
        <span class="eyebrow">SEU CARRINHO</span>
        <h2>Tempo GameCloud</h2>
      </div>
      <button class="btn danger small" id="clearCart" type="button">
        Limpar
      </button>
    </div>

    <div class="summary-line">
      <span>${minutes.toLocaleString('pt-BR')} minutos</span>
      <b>${formatMoney(total)}</b>
    </div>

    <div class="notice green" style="margin-top:14px">
      Compra somente de tempo. Nenhum pacote de hardware será cobrado.
    </div>
  `;

  if ($('cartSummary')) {
    $('cartSummary').innerHTML = `
      <div class="summary-line">
        <span>${minutes.toLocaleString('pt-BR')} minutos</span>
        <b>${formatMoney(total)}</b>
      </div>
      <div class="summary-line total">
        <span>Total</span>
        <b>${formatMoney(total)}</b>
      </div>
    `;
  }

  if ($('continueCheckout')) {
    $('continueCheckout').disabled = false;
  }

  $('clearCart')?.addEventListener('click', () => {
    cart = { packageId: null, minutes: 0 };
    selectedPackage = null;
    selectedMinutes = 0;
    saveCart();
    renderCart();
  });
}

/* =========================================================
   COMPRA DE MINUTOS
   ========================================================= */

function renderSelectionSummary() {
  const root = $('selectionSummary');
  const choice = Number($('minuteChoice')?.value || 0);
  const rate = Number(minutesRateCents || 0);
  const total = choice * rate;

  if ($('minutesRateLabel')) {
    $('minutesRateLabel').textContent =
      `Preço atual: ${formatMoney(rate)} por minuto.`;
  }

  if (!root) return;

  if (!Number.isSafeInteger(choice) || choice < 1) {
    root.innerHTML = `
      <div class="empty">
        Informe a quantidade de minutos.
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="summary-line">
      <span>Tempo</span>
      <b>${choice.toLocaleString('pt-BR')} min</b>
    </div>
    <div class="summary-line total">
      <span>Total</span>
      <b>${formatMoney(total)}</b>
    </div>
  `;
}

function addMinutesToCart() {
  const minutes = Number($('minuteChoice')?.value || 0);

  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 50000) {
    say('Informe entre 1 e 50.000 minutos.', true);
    return;
  }

  cart = {
    packageId: null,
    minutes
  };

  selectedPackage = null;
  selectedMinutes = minutes;

  saveCart();
  renderCart();
  showUserSection('cart');
}

async function createMinutesOrder() {
  const minutes = Number(cart.minutes || 0);

  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    say('Escolha os minutos antes de continuar.', true);
    showUserSection('buy');
    return;
  }

  const panel = $('paymentPanel');
  if (panel) {
    panel.innerHTML = '<p class="muted">Criando pedido...</p>';
  }

  try {
    const result = await api('/orders', {
      method: 'POST',
      body: { minutes }
    });

    const order = result.order || {};

    if (panel) {
      panel.innerHTML = `
        <div class="notice green">
          <strong>Pedido criado com sucesso.</strong><br>
          ${minutes.toLocaleString('pt-BR')} minutos —
          ${formatMoney(order.totalCents || minutes * minutesRateCents)}.
        </div>
        <p class="muted" style="margin-top:14px">
          O pedido ficará pendente até a confirmação do pagamento pelo administrador.
        </p>
        <div class="card-actions">
          <button class="btn primary" data-page="orders" type="button">
            Ver meus pedidos
          </button>
          <button class="btn" data-page="home" type="button">
            Voltar ao início
          </button>
        </div>
      `;
    }

    cart = { packageId: null, minutes: 0 };
    selectedMinutes = 0;
    selectedPackage = null;
    saveCart();
    await loadOrders();
    await loadUserData();

  } catch (error) {
    if (panel) {
      panel.innerHTML = `
        <div class="notice red">
          ${escapeHtml(error.message || 'Não foi possível criar o pedido.')}
        </div>
      `;
    }
  }
}

/* =========================================================
   STREAMING / FIVEM
   ========================================================= */

async function loadStreamStatus() {
  try {
    const result = await api('/stream/status');
    const stream = result.streaming || {};
    const status = String(stream.status || 'offline');

    if ($('streamStatus')) {
      $('streamStatus').innerHTML =
        `<i class="dot ${status === 'online' ? 'online' : ''}"></i>
         ${escapeHtml(status)}`;
    }

    if ($('streamMessage')) {
      $('streamMessage').textContent =
        stream.message || 'Aguardando o PC de streaming.';
    }

    if ($('playerMiniStatus')) {
      $('playerMiniStatus').textContent =
        status === 'online' ? 'Online' : 'Offline';
    }

    if ($('topOnlineText')) {
      $('topOnlineText').textContent =
        status === 'online' ? 'Online' : 'Offline';
    }

    if ($('topOnlineDot')) {
      $('topOnlineDot').classList.toggle(
        'online',
        status === 'online'
      );
    }

    return stream;
  } catch (error) {
    console.warn('Status do streaming:', error);
    return null;
  }
}

async function startFiveM(serverId) {
  try {
    const result = await api('/stream/start', {
      method: 'POST',
      body: { serverId }
    });

    say(result.message || 'Solicitação enviada.');
    fivemMiniServerId = serverId || fivemMiniServerId;
    openFiveMMini(serverId);
    await loadStreamStatus();
    showUserSection('fivem');
  } catch (error) {
    say(error.message || 'Não foi possível iniciar o FiveM.', true);
  }
}

async function stopFiveM() {
  try {
    const result = await api('/stream/stop', {
      method: 'POST',
      body: {}
    });

    say(result.message || 'Solicitação enviada.');
    await loadStreamStatus();
  } catch (error) {
    say(error.message || 'Não foi possível parar o FiveM.', true);
  }
}


/* =========================================================
   PEDIDOS
   ========================================================= */

async function loadOrders() {

  try {

    const result =
      await api('/orders');

    orders =
      Array.isArray(result.orders)
        ? result.orders
        : [];

    renderOrders();

  } catch (error) {

    console.error(
      'Erro ao carregar pedidos:',
      error
    );

  }
}


function renderOrders() {

  const root =
    $('ordersList');

  if (!root) return;

  if (!orders.length) {

    root.innerHTML = `
      <div class="panel">
        <h3>Nenhum pedido</h3>
        <p class="muted">
          Seus pedidos aparecerão aqui.
        </p>
      </div>
    `;

    return;
  }

  root.innerHTML =
    orders.map(order => `

      <article class="order-card">

        <div>

          <span class="status">
            ${escapeHtml(order.status || 'PENDENTE')}
          </span>

          <h3>
            ${escapeHtml(
              order.packageName ||
              'Tempo de jogo'
            )}
          </h3>

          <p class="muted">

            ${Number(order.minutes || 0)
              .toLocaleString('pt-BR')}
            min

            •

            ${
              order.createdAt
                ? new Date(
                    order.createdAt
                  ).toLocaleString('pt-BR')
                : ''
            }

          </p>

        </div>

        <strong>
          ${formatMoney(order.totalCents)}
        </strong>

      </article>

    `).join('');
}


/* =========================================================
   SUPORTE
   ========================================================= */

async function loadSupport() {

  try {

    const result =
      await api('/support');

    tickets =
      Array.isArray(result.tickets)
        ? result.tickets
        : [];

    renderSupport();

  } catch (error) {

    console.error(
      'Erro ao carregar suporte:',
      error
    );

  }
}


function renderSupport() {

  const root =
    $('supportHistory');

  if (!root) return;

  if (!tickets.length) {

    root.innerHTML = `
      <div class="muted">
        Nenhuma solicitação enviada.
      </div>
    `;

    return;
  }

  root.innerHTML = tickets.map(ticket => `

    <article class="order-card">

      <div>

        <span class="status">
          ${escapeHtml(
            ticket.status || 'ABERTO'
          )}
        </span>

        <h3>
          ${escapeHtml(
            ticket.subject || 'Suporte'
          )}
        </h3>

        <p>
          ${escapeHtml(
            ticket.message || ''
          )}
        </p>

      </div>

      <small>

        ${
          ticket.createdAt
            ? new Date(
                ticket.createdAt
              ).toLocaleString('pt-BR')
            : ''
        }

      </small>

    </article>

  `).join('');
}


/* =========================================================
   PAINEL ADMINISTRADOR
   ========================================================= */

async function loadAdminData() {

  try {

    const result =
      await api('/admin/overview');

    adminData = result;

    renderAdminDashboard(result);

  } catch (error) {

    console.error(
      'Erro ao carregar painel administrativo:',
      error
    );

    throw error;
  }
}


function renderAdminDashboard(data) {

  const users =
    Array.isArray(data.users)
      ? data.users
      : [];

  const adminServers =
    Array.isArray(data.servers)
      ? data.servers
      : [];

  const adminOrders =
    Array.isArray(data.orders)
      ? data.orders
      : [];

  const adminPackages =
    Array.isArray(data.packages)
      ? data.packages
      : [];

  if ($('adminUserCount')) {
    $('adminUserCount').textContent =
      users.length;
  }

  if ($('adminServerCount')) {
    $('adminServerCount').textContent =
      adminServers.length;
  }

  if ($('adminPendingCount')) {

    $('adminPendingCount').textContent =
      adminOrders.filter(
        order =>
          String(order.status)
            .toUpperCase() === 'PENDENTE'
      ).length;

  }

  renderAdminUsers(users);
  renderAdminServers(adminServers);
  renderAdminOrders(adminOrders);
  renderAdminPackages(adminPackages);

  if ($('minutesRate')) {

    $('minutesRate').value =
      (
        Number(
          data.minutesRateCents || 0
        ) / 100
      ).toFixed(2);

  }

  renderAdminTickets(
    Array.isArray(data.tickets)
      ? data.tickets
      : []
  );
}


/* =========================================================
   ADMIN — USUÁRIOS
   ========================================================= */

function renderAdminUsers(users) {

  const root =
    $('adminUsers');

  if (!root) return;

  if (!users.length) {

    root.innerHTML = `
      <tr>
        <td colspan="3">
          Nenhum usuário cadastrado.
        </td>
      </tr>
    `;

    return;
  }

  // O e-mail fica em uma coluna própria e visível no painel,
  // enquanto o nome de usuário permanece abaixo do nome.
  root.innerHTML =
    users.map(user => `

      <tr>

        <td>
          <strong>${escapeHtml(
            user.name || '—'
          )}</strong>
          <small style="display:block;opacity:.7;margin-top:3px">
            @${escapeHtml(
              user.username || '—'
            )}
          </small>
        </td>

        <td>
          <strong>${escapeHtml(
            user.email || '—'
          )}</strong>
        </td>

        <td>
          ${Number(
            user.minutes || 0
          ).toLocaleString('pt-BR')}
          min
          <button
            type="button"
            class="btn small"
            data-add-minutes-email="${escapeHtml(user.email || '')}"
            style="margin-left:6px">
            + minutos
          </button>
        </td>

      </tr>

    `).join('');
}

function renderAdminAgents(agents) {
  const root = $('adminAgents');
  if (!root) return;
  if (!agents.length) {
    root.innerHTML = '<div class="muted">Nenhum computador/agente conectado.</div>';
    return;
  }
  root.innerHTML = agents.map(agent => `
    <article class="admin-server-row">
      <div>
        <strong>${escapeHtml(agent.id)}</strong>
        <small>FiveM • heartbeat: ${escapeHtml(agent.lastHeartbeat || '—')}</small>
      </div>
      <div><span class="status">${escapeHtml(agent.status)}</span></div>
    </article>
  `).join('');
}

async function loadAdminAgents() {
  try {
    const result = await api('/admin/stream/agents');
    renderAdminAgents(result.agents || []);
  } catch (error) {
    console.warn('Agentes:', error);
  }
}

/* =========================================================
   ADMIN — SERVIDORES
   ========================================================= */

function renderAdminServers(list) {

  const root =
    $('adminServers');

  if (!root) return;

  if (!list.length) {

    root.innerHTML = `
      <div class="muted">
        Nenhum servidor cadastrado.
      </div>
    `;

    return;
  }

  root.innerHTML =
    list.map(server => `

      <article class="admin-server-row">

        <div>

          <strong>
            ${escapeHtml(
              server.name || 'Servidor'
            )}
          </strong>

          <small>
            ${escapeHtml(
              server.type || 'FiveM'
            )}

            •

            ${escapeHtml(
              server.userName ||
              'Sem vínculo'
            )}
          </small>

        </div>

        <div>

          <span class="status">
            ${escapeHtml(
              server.status || 'offline'
            )}
          </span>

          <small>
            ${Number(server.ram || 0)} GB RAM
            •
            ${Number(server.vcpu || 0)} vCPU
            •
            ${escapeHtml(server.gpu || '—')}
            •
            ${Number(server.storage || 0)} GB
          </small>

        </div>

        <div class="card-actions">

          <button
            class="btn small"
            data-edit-server="${escapeHtml(server.id)}"
          >
            Editar
          </button>

          <button
            class="btn danger small"
            data-delete-server="${escapeHtml(server.id)}"
          >
            Excluir
          </button>

        </div>

      </article>

    `).join('');
}


/* =========================================================
   ADMIN — PEDIDOS
   ========================================================= */

function renderAdminOrders(list) {

  const root =
    $('adminOrders');

  if (!root) return;

  if (!list.length) {

    root.innerHTML = `
      <div class="panel muted">
        Nenhum pedido registrado.
      </div>
    `;

    return;
  }

  root.innerHTML =
    list.map(order => `

      <article class="order-card">

        <div>

          <span class="status">
            ${escapeHtml(
              order.status || 'PENDENTE'
            )}
          </span>

          <h3>

            ${escapeHtml(
              order.userName ||
              order.email ||
              'Usuário'
            )}

            •

            ${escapeHtml(
              order.packageName ||
              'Tempo'
            )}

          </h3>

          <p class="muted">

            ${Number(
              order.minutes || 0
            ).toLocaleString('pt-BR')}
            min

          </p>

        </div>

        <div>

          <strong>
            ${formatMoney(
              order.totalCents
            )}
          </strong>

          ${
            String(order.status)
              .toUpperCase() === 'PENDENTE'
              ? `
                <button
                  class="btn primary small"
                  data-approve-order="${escapeHtml(order.id)}"
                >
                  Aprovar
                </button>
              `
              : ''
          }

        </div>

      </article>

    `).join('');
}


/* =========================================================
   ADMIN — CATÁLOGO
   ========================================================= */

function renderAdminPackages(list) {

  const root =
    $('adminCatalog');

  if (!root) return;

  if (!list.length) {

    root.innerHTML = `
      <div class="muted">
        Nenhum pacote cadastrado.
      </div>
    `;

    return;
  }

  root.innerHTML =
    list.map(pkg => `

      <form
        class="panel admin-package-form"
        data-package-id="${escapeHtml(pkg.id)}"
      >

        <div class="panel-head">

          <div>

            <span class="eyebrow">
              PACOTE
            </span>

            <h2>
              ${escapeHtml(pkg.name)}
            </h2>

            <p class="muted">

              ${Number(pkg.ram || 0)} GB RAM

              •

              ${Number(pkg.vcpu || 0)} vCPU

              •

              ${escapeHtml(pkg.gpu || '—')}

            </p>

          </div>

        </div>

        <div class="field">

          <label>
            Preço
          </label>

          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            value="${
              (
                Number(pkg.priceCents || 0) / 100
              ).toFixed(2)
            }"
            required
          >

        </div>

        <button
          class="btn primary"
          type="submit"
        >
          Salvar preço
        </button>

      </form>

    `).join('');
}


/* =========================================================
   ADMIN — SUPORTE
   ========================================================= */

function renderAdminTickets(list) {

  const root =
    $('adminTickets');

  if (!root) return;

  if (!list.length) {

    root.innerHTML = `
      <div class="muted">
        Nenhum chamado.
      </div>
    `;

    return;
  }

  root.innerHTML =
    list.map(ticket => `

      <article class="order-card">

        <div>

          <span class="status">
            ${escapeHtml(
              ticket.status || 'ABERTO'
            )}
          </span>

          <h3>
            ${escapeHtml(
              ticket.subject || 'Suporte'
            )}
          </h3>

          <p>
            ${escapeHtml(
              ticket.userName ||
              ticket.email ||
              ''
            )}
          </p>

          <p class="muted">
            ${escapeHtml(
              ticket.message || ''
            )}
          </p>

        </div>

      </article>

    `).join('');
}


/* =========================================================
   ADMIN — FORMULÁRIO DE SERVIDOR
   ========================================================= */

function clearServerForm() {

  const form =
    $('serverForm');

  if (form) {
    form.reset();
  }

  if ($('serverId')) {
    $('serverId').value = '';
  }

  if ($('serverFormTitle')) {
    $('serverFormTitle').textContent =
      'Criar servidor';
  }
}


/* =========================================================
   ADMIN — EVENTOS EXTRAS
   ========================================================= */

document.addEventListener(
  'click',
  async event => {

    const editButton =
      event.target.closest(
        '[data-edit-server]'
      );

    if (editButton) {

      const id =
        editButton.dataset.editServer;

      const server =
        adminData?.servers?.find(
          item => String(item.id) === String(id)
        );

      if (!server) return;

      if ($('serverId'))
        $('serverId').value =
          server.id || '';

      if ($('serverName'))
        $('serverName').value =
          server.name || '';

      if ($('serverType'))
        $('serverType').value =
          server.type || 'FiveM';

      if ($('serverAgent'))
        $('serverAgent').value =
          server.agentId || 'PC-GAMECLOUD';

      if ($('serverRam'))
        $('serverRam').value =
          server.ram || 0;

      if ($('serverVcpu'))
        $('serverVcpu').value =
          server.vcpu || 0;

      if ($('serverGpu'))
        $('serverGpu').value =
          server.gpu || '';

      if ($('serverStorage'))
        $('serverStorage').value =
          server.storage || 0;

      if ($('serverStatusInput'))
        $('serverStatusInput').value =
          server.status || 'offline';

      if ($('serverFormTitle'))
        $('serverFormTitle').textContent =
          'Editar servidor';

      return;
    }

    const deleteButton =
      event.target.closest(
        '[data-delete-server]'
      );

    if (deleteButton) {

      const id =
        deleteButton.dataset.deleteServer;

      if (
        !window.confirm(
          'Tem certeza que deseja excluir este servidor?'
        )
      ) {
        return;
      }

      try {

        await api(
          `/admin/servers/${encodeURIComponent(id)}/delete`,
          { method: 'POST', body: {} }
        );

        await loadAdminData();

        say(
          'Servidor excluído.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

      return;
    }

    const approveButton =
      event.target.closest(
        '[data-approve-order]'
      );

    if (approveButton) {

      try {

        await api(
          `/admin/orders/${encodeURIComponent(
            approveButton.dataset.approveOrder
          )}/approve`,
          { method: 'POST', body: {} }
        );

        await loadAdminData();

        say(
          'Pedido aprovado.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }

  }
);


/* =========================================================
   EVENTOS DO FLUXO PRINCIPAL
   ========================================================= */

function setupMainCommerceEvents() {
  if ($('minuteChoice') && !$('minuteChoice').dataset.bound) {
    $('minuteChoice').dataset.bound = '1';
    $('minuteChoice').addEventListener('input', renderSelectionSummary);
    $('minuteChoice').addEventListener('change', renderSelectionSummary);
  }

  if ($('addToCart') && !$('addToCart').dataset.bound) {
    $('addToCart').dataset.bound = '1';
    $('addToCart').addEventListener('click', addMinutesToCart);
  }

  if ($('continueCheckout') && !$('continueCheckout').dataset.bound) {
    $('continueCheckout').dataset.bound = '1';
    $('continueCheckout').addEventListener('click', () => {
      showUserSection('payment');
      const panel = $('paymentPanel');
      if (panel) {
        const minutes = Number(cart.minutes || 0);
        const total = minutes * Number(minutesRateCents || 0);
        panel.innerHTML = `
          <div class="panel-head">
            <div>
              <span class="eyebrow">CONFIRMAÇÃO</span>
              <h2>Compra de tempo</h2>
              <p>${minutes.toLocaleString('pt-BR')} minutos</p>
            </div>
            <strong>${formatMoney(total)}</strong>
          </div>
          <div class="notice">
            A compra será registrada como pedido pendente.
          </div>
          <button id="confirmMinutesOrder" class="btn primary full" type="button" style="margin-top:14px">
            Confirmar pedido
          </button>
        `;
        $('#confirmMinutesOrder')?.addEventListener('click', createMinutesOrder);
      }
    });
  }

  if ($('refreshAdminAgents') && !$('refreshAdminAgents').dataset.bound) {
    $('refreshAdminAgents').dataset.bound = '1';
    $('refreshAdminAgents').addEventListener('click', loadAdminAgents);
    loadAdminAgents();
  }

  if ($('refreshStream') && !$('refreshStream').dataset.bound) {
    $('refreshStream').dataset.bound = '1';
    $('refreshStream').addEventListener('click', loadStreamStatus);
  }

  if ($('startStream') && !$('startStream').dataset.bound) {
    $('startStream').dataset.bound = '1';
    $('startStream').addEventListener('click', async () => {
      try {
        const result = await api('/stream/start', {
          method: 'POST',
          body: {}
        });
        say(result.message || 'Solicitação enviada.');
        await loadStreamStatus();
      } catch (error) {
        say(error.message || 'Não foi possível iniciar o FiveM.', true);
      }
    });
  }

  if ($('stopStream') && !$('stopStream').dataset.bound) {
    $('stopStream').dataset.bound = '1';
    $('stopStream').addEventListener('click', stopFiveM);
  }

  if ($('minutePriceForm') && !$('minutePriceForm').dataset.bound) {
    $('minutePriceForm').dataset.bound = '1';
    $('minutePriceForm').addEventListener('submit', async event => {
      event.preventDefault();
      const value = Number($('#minutesRate')?.value || 0);
      const priceCents = Math.round(value * 100);

      try {
        await api('/admin/minutes-price', {
          method: 'POST',
          body: { priceCents }
        });
        minutesRateCents = priceCents;
        say('Preço por minuto salvo.');
        await loadAdminData();
      } catch (error) {
        say(error.message || 'Não foi possível salvar o preço.', true);
      }
    });
  }

  if ($('timeForm') && !$('timeForm').dataset.bound) {
    $('timeForm').dataset.bound = '1';
    $('timeForm').addEventListener('submit', async event => {
      event.preventDefault();

      const email = $('#playerEmail')?.value.trim().toLowerCase();
      const minutes = Number($('#addMinutes')?.value || 0);
      const user = (adminData.users || []).find(
        item => String(item.email || '').toLowerCase() === email
      );

      if (!user) {
        say('Jogador não encontrado.', true);
        return;
      }

      try {
        await api(
          `/admin/users/${encodeURIComponent(user.id)}/minutes`,
          {
            method: 'POST',
            body: { minutes }
          }
        );
        say('Minutos adicionados.');
        event.target.reset();
        await loadAdminData();
      } catch (error) {
        say(error.message || 'Não foi possível adicionar minutos.', true);
      }
    });
  }

  document.addEventListener('click', event => {
    const addMinutesButton = event.target.closest('[data-add-minutes-email]');
    if (addMinutesButton) {
      event.preventDefault();

      const email = String(
        addMinutesButton.dataset.addMinutesEmail || ''
      ).trim();

      const emailInput = $('#playerEmail');
      if (emailInput) {
        emailInput.value = email;
        emailInput.focus();
      }

      const minutesInput = $('#addMinutes');
      if (minutesInput && !minutesInput.value) {
        minutesInput.value = '60';
      }

      say(`Usuário ${email} selecionado. Informe a quantidade de minutos.`);
      return;
    }

    const addToCartButton = event.target.closest('#addToCart');
    if (addToCartButton) {
      event.preventDefault();
      addMinutesToCart();
      return;
    }

    const fivem = event.target.closest('[data-fivem-start]');
    if (fivem) {
      event.preventDefault();
      startFiveM(fivem.dataset.fivemStart);
      return;
    }

    const page = event.target.closest('[data-page]');
    if (page && !page.matches('.nav-item')) {
      showUserSection(page.dataset.page);
    }
  });

  loadStreamStatus();
}

/* =========================================================
   INICIALIZAÇÃO E NAVEGAÇÃO
   ========================================================= */

function setupRecoveryForms() {

  const forgotForm = $('#forgotForm');
  const forgotButton = forgotForm?.querySelector('button[type="submit"]');

  if (forgotForm) {
    forgotForm.addEventListener('submit', async event => {
      event.preventDefault();

      const message = $('#forgotMessage');
      const email = String($('#forgotEmail')?.value || '').trim();

      showMessage(message, 'Enviando código de recuperação...');

      if (!email) {
        showMessage(message, 'Informe seu e-mail.', true);
        return;
      }

      try {
        const result = await api('/forgot-password', {
          method: 'POST',
          body: { email }
        });

        const tokenInput = $('#resetToken');
        if (tokenInput) {
          tokenInput.value = '';
        }

        showPage('resetPage');

        showMessage(
          $('#resetMessage'),
          result.message || 'Código enviado para o seu e-mail. Verifique também a pasta de spam.'
        );
      } catch (error) {
        showMessage(
          message,
          error.message || 'Não foi possível solicitar a recuperação.',
          true
        );
      } finally {
        if (forgotButton) {
          forgotButton.disabled = false;
          forgotButton.textContent = 'Solicitar recuperação';
        }
      }
    });
  }

  if (forgotButton) {
    forgotButton.addEventListener('click', () => {
      forgotButton.disabled = true;
      forgotButton.textContent = 'Enviando...';
    });
  }

  $('#resetForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('#resetMessage');
    const token = $('#resetToken')?.value.trim() || new URLSearchParams(window.location.search).get('token') || '';

    try {
      const result = await api('/reset-password', {
        method: 'POST',
        body: { token, password: $('#resetPassword')?.value || '' }
      });
      showMessage(message, result.message || 'Senha atualizada.');
      window.setTimeout(showLogin, 700);
    } catch (error) {
      showMessage(message, error.message || 'Não foi possível alterar a senha.', true);
    }
  });
}

function setupAuthenticationNavigation() {

  const actions = {
    showRegister,
    showForgot,
    showAdminLogin,
    backLoginFromRegister: showLogin,
    backLoginFromForgot: showLogin,
    backLoginFromReset: showLogin,
    backLoginFromAdmin: showLogin
  };

  Object.entries(actions).forEach(([id, handler]) => {
    $(`#${id}`)?.addEventListener('click', handler);
  });

  $('#logoutUser')?.addEventListener('click', logout);
  $('#logoutAdmin')?.addEventListener('click', logoutAdmin);
}

async function restoreSession() {

  session = loadStoredSession();

  if (!session?.token) {
    showLogin();
    return;
  }

  try {
    const result = await api('/me');

    if (!result?.ok) {
      throw new Error('Sessão inválida.');
    }

    const serverRole =
      result?.role === 'admin'
        ? 'admin'
        : result?.role === 'player'
          ? 'player'
          : '';

    if (!serverRole) {
      throw new Error('Sessão sem função válida.');
    }

    session = {
      ...session,
      role: serverRole,
      user: result.user || null
    };

    const storage = localStorage.getItem('gamecloud_session')
      ? localStorage
      : sessionStorage;

    storage.setItem(
      'gamecloud_session',
      JSON.stringify(session)
    );

    currentAdmin =
      serverRole === 'admin';

    if (currentAdmin) {
      showAdminApp();
      await loadAdminAgents();
    } else {
      currentUser =
        result.user || null;
      showUserApp();
    }
  } catch (error) {
    console.warn('Sessão não pôde ser restaurada:', error);
    clearSession();
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindFiveMMini();
  $('#loginForm')?.addEventListener('submit', handleLogin);
  $('#registerForm')?.addEventListener('submit', handleRegister);
  $('#adminLoginForm')?.addEventListener('submit', handleAdminLogin);

  setupAuthenticationNavigation();
  loadCart();
  setupMainCommerceEvents();
  setupUserNavigation();
  setupAdminNavigation();
  setupAdminAgents();
  setupSiteEditor();
  setupRecoveryForms();
  loadSiteConfig();
  restoreSession();
});


/* =========================================================
   COMPATIBILIDADE COM O EDITOR
   ========================================================= */

function formatMoney(cents) {

  return (
    Number(cents || 0) / 100
  ).toLocaleString(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL'
    }
  );

}


/* =========================================================
   FINALIZAÇÃO
   ========================================================= */

window.GameCloudEditor = {
  getConfig: () =>
    JSON.parse(
      JSON.stringify(siteConfig)
    ),

  setConfig: config => {

    siteConfig =
      mergeSiteConfig(config);

    applySiteConfig(
      siteConfig
    );

    fillSiteEditor(
      siteConfig
    );

    updateEditorPreview();
  }
};


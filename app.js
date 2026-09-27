'use strict';

/* =========================================================
   IMPÉRIO GAMECLOUD
   APP.JS — PARTE 1/3
   ========================================================= */

const API_BASE = 'https://imperio-gamecloud-1.onrender.com/api/';
const CART_KEY = 'igc_cart_v1';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role =
  localStorage.getItem('igc_role') ||
  sessionStorage.getItem('igc_role') ||
  '';

let currentUser = null;
let catalog = [];
let servers = [];
let orders = [];
let tickets = [];

let minutesRateCents = 10;
let chosenPackage = null;
let cart = readCart();
let currentOrder = null;
let adminData = null;


/* =========================================================
   EDITOR VISUAL
   ========================================================= */

const defaultSiteConfig = {

  brandName: 'IMPÉRIO GAMECLOUD',

  authTitle: 'Acesse sua conta',

  authText:
    'Entre para gerenciar seus servidores e seu tempo de jogo.',

  home: {

    eyebrow:
      'Império GameCloud • FiveM',

    title:
      'Olá, {name}.',

    text:
      'Seu próximo mundo começa aqui. Acompanhe o tempo, gerencie seus servidores e monte sua configuração.',

    primaryButton:
      'Explorar pacotes',

    secondaryButton:
      'Meus servidores',

    heroImage:
      'imperio-usuario.png'

  },

  theme: {

    gold:
      '#f2c94c',

    background:
      '#090c12'

  }

};

let siteConfig =
  JSON.parse(
    JSON.stringify(defaultSiteConfig)
  );


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (id) =>
  document.getElementById(id);


const $$ = (selector) =>
  Array.from(
    document.querySelectorAll(selector)
  );


const money = (cents) =>
  (
    Number(cents || 0) / 100
  ).toLocaleString(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL'
    }
  );


const formatMoney = money;


const fmtMinutes = (value) =>
  `${Number(value || 0).toLocaleString('pt-BR')} min`;


function escapeHtml(value) {

  return String(value ?? '')
    .replace(
      /[&<>"']/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character])
    );

}


/* =========================================================
   MENSAGENS
   ========================================================= */

function say(text, error = false) {

  const node =
    $('message');

  if (!node) return;

  node.textContent =
    text || '';

  node.className =
    `message${error ? ' error' : ''}`;

  if (text) {

    window.setTimeout(
      () => {

        if (
          node.textContent === text
        ) {
          node.textContent = '';
        }

      },
      7000
    );

  }

}


function showMessage(
  element,
  message,
  error = false
) {

  if (!element) return;

  if (typeof element === 'string') {
    element = $(element);
  }

  if (!element) return;

  element.textContent =
    message || '';

  element.className =
    `message${error ? ' error' : ''}`;

}


/* =========================================================
   API
   ========================================================= */

async function api(
  route,
  method = 'GET',
  body
) {

  const headers = {};

  if (token) {

    headers.Authorization =
      `Bearer ${token}`;

  }

  if (body !== undefined) {

    headers['Content-Type'] =
      'application/json';

  }

  const response =
    await fetch(
      API_BASE +
        String(route).replace(
          /^\/+/,
          ''
        ),
      {
        method,
        headers,
        credentials:
          'same-origin',
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body)
      }
    );

  let result = {};

  try {

    result =
      await response.json();

  } catch {

    result = {};

  }

  if (!response.ok) {

    throw new Error(
      result.error ||
      result.message ||
      `Erro ${response.status}`
    );

  }

  return result;

}


/* =========================================================
   SESSÃO
   ========================================================= */

function
   /* =========================================================
   EDITOR VISUAL — PARTE 2
   ========================================================= */

function editorConfigFromForm() {

  const config =
    mergeSiteConfig(
      siteConfig
    );

  config.brandName =
    getEditorValue(
      'editorBrandName',
      config.brandName
    ).trim();

  config.authTitle =
    getEditorValue(
      'editorAuthTitle',
      config.authTitle
    ).trim();

  config.authText =
    getEditorValue(
      'editorAuthText',
      config.authText
    ).trim();

  config.home.eyebrow =
    getEditorValue(
      'editorHomeEyebrow',
      config.home.eyebrow
    ).trim();

  config.home.title =
    getEditorValue(
      'editorHomeTitle',
      config.home.title
    ).trim();

  config.home.text =
    getEditorValue(
      'editorHomeText',
      config.home.text
    ).trim();

  config.home.primaryButton =
    getEditorValue(
      'editorPrimaryButton',
      config.home.primaryButton
    ).trim();

  config.home.secondaryButton =
    getEditorValue(
      'editorSecondaryButton',
      config.home.secondaryButton
    ).trim();

  config.theme.gold =
    getEditorValue(
      'editorGold',
      config.theme.gold
    ).trim();

  config.theme.background =
    getEditorValue(
      'editorBackground',
      config.theme.background
    ).trim();

  const heroImage =
    getEditorValue(
      'editorHeroImageValue',
      config.home.heroImage
    ).trim();

  if (heroImage) {

    config.home.heroImage =
      heroImage;

  }

  return config;

}


/* =========================================================
   EDITOR — PRÉ-VISUALIZAÇÃO
   ========================================================= */

function updateEditorPreview() {

  const config =
    editorConfigFromForm();

  const previewEyebrow =
    $('previewEyebrow');

  const previewTitle =
    $('previewTitle');

  const previewText =
    $('previewText');

  const previewPrimary =
    $('previewPrimary');

  const previewSecondary =
    $('previewSecondary');

  const previewHero =
    $('editorPreviewHero');

  if (previewEyebrow) {

    previewEyebrow.textContent =
      config.home.eyebrow;

  }

  if (previewTitle) {

    const name =
      currentUser?.name ||
      currentUser?.username ||
      'Miguel';

    previewTitle.textContent =
      config.home.title.replace(
        /\{name\}/g,
        name
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

    if (
      config.home.heroImage
    ) {

      previewHero.style.backgroundImage =
        `url("${config.home.heroImage}")`;

    } else {

      previewHero.style.backgroundImage =
        'none';

    }

  }

}


/* =========================================================
   EDITOR — STATUS
   ========================================================= */

function setEditorStatus(
  message,
  error = false
) {

  const node =
    $('editorStatus');

  if (!node) return;

  node.textContent =
    message || '';

  node.className =
    `message${error ? ' error' : ''}`;

}


/* =========================================================
   EDITOR — SALVAR
   ========================================================= */

async function saveSiteConfig() {

  const button =
    $('saveSiteConfig');

  try {

    const config =
      editorConfigFromForm();

    setEditorStatus(
      'Salvando alterações...'
    );

    if (button) {

      button.disabled = true;
      button.textContent =
        'Salvando...';

    }

    const result =
      await api(
        '/admin/site-config',
        'POST',
        {
          siteConfig: config
        }
      );

    siteConfig =
      mergeSiteConfig(
        result.siteConfig ||
        config
      );

    applySiteConfig(
      siteConfig
    );

    fillSiteEditor(
      siteConfig
    );

    updateEditorPreview();

    setEditorStatus(
      '✓ Alterações salvas com sucesso.'
    );

    say(
      'Configuração do aplicativo atualizada.'
    );

  } catch (error) {

    console.error(
      'Erro ao salvar editor:',
      error
    );

    setEditorStatus(
      error.message ||
        'Não foi possível salvar.',
      true
    );

    say(
      error.message ||
        'Erro ao salvar.',
      true
    );

  } finally {

    if (button) {

      button.disabled = false;
      button.textContent =
        'Salvar alterações';

    }

  }

}


/* =========================================================
   EDITOR — RESTAURAR PADRÃO
   ========================================================= */

async function restoreSiteConfig() {

  const confirmed =
    window.confirm(
      'Restaurar o aplicativo para a configuração padrão?'
    );

  if (!confirmed) {
    return;
  }

  try {

    const
       /* =========================================================
   IMPÉRIO GAMECLOUD
   APP.JS — PARTE 3/3
   ========================================================= */


/* =========================================================
   EDITOR VISUAL — CONFIGURAÇÃO
   ========================================================= */

function editorConfigFromForm() {

  return mergeSiteConfig({

    brandName:
      getEditorValue(
        'editorBrandName',
        defaultSiteConfig.brandName
      ),

    authTitle:
      getEditorValue(
        'editorAuthTitle',
        defaultSiteConfig.authTitle
      ),

    authText:
      getEditorValue(
        'editorAuthText',
        defaultSiteConfig.authText
      ),

    home: {

      eyebrow:
        getEditorValue(
          'editorHomeEyebrow',
          defaultSiteConfig.home.eyebrow
        ),

      title:
        getEditorValue(
          'editorHomeTitle',
          defaultSiteConfig.home.title
        ),

      text:
        getEditorValue(
          'editorHomeText',
          defaultSiteConfig.home.text
        ),

      primaryButton:
        getEditorValue(
          'editorPrimaryButton',
          defaultSiteConfig.home.primaryButton
        ),

      secondaryButton:
        getEditorValue(
          'editorSecondaryButton',
          defaultSiteConfig.home.secondaryButton
        ),

      heroImage:
        getEditorValue(
          'editorHeroImageValue',
          defaultSiteConfig.home.heroImage
        )

    },

    theme: {

      gold:
        getEditorValue(
          'editorGold',
          defaultSiteConfig.theme.gold
        ),

      background:
        getEditorValue(
          'editorBackground',
          defaultSiteConfig.theme.background
        )

    }

  });

}


/* =========================================================
   EDITOR — STATUS
   ========================================================= */

function setEditorStatus(
  message,
  error = false
) {

  const element =
    $('editorStatus');

  if (!element) return;

  element.textContent =
    message || '';

  element.className =
    `message${error ? ' error' : ''}`;

}


/* =========================================================
   EDITOR — PRÉ-VISUALIZAÇÃO
   ========================================================= */

function updateEditorPreview() {

  const config =
    editorConfigFromForm();

  if ($('previewEyebrow')) {

    $('previewEyebrow').textContent =
      config.home.eyebrow;

  }

  if ($('previewTitle')) {

    $('previewTitle').textContent =
      config.home.title.replace(
        /\{name\}/g,
        'Miguel'
      );

  }

  if ($('previewText')) {

    $('previewText').textContent =
      config.home.text;

  }

  if ($('previewPrimary')) {

    $('previewPrimary').textContent =
      config.home.primaryButton;

  }

  if ($('previewSecondary')) {

    $('previewSecondary').textContent =
      config.home.secondaryButton;

  }

  if ($('editorPreviewHero')) {

    if (config.home.heroImage) {

      $('editorPreviewHero').style.backgroundImage =
        `url("${config.home.heroImage}")`;

    } else {

      $('editorPreviewHero').style.backgroundImage =
        '';

    }

  }

  const preview =
    $('editorPreview');

  if (preview) {

    preview.style.setProperty(
      '--gold',
      config.theme.gold
    );

    preview.style.setProperty(
      '--bg',
      config.theme.background
    );

  }

}


/* =========================================================
   EDITOR — SALVAR
   ========================================================= */

async function saveSiteConfig() {

  try {

    setEditorStatus(
      'Salvando alterações...'
    );

    const config =
      editorConfigFromForm();

    const result =
      await api(
        '/admin/site-config',
        'POST',
        {
          siteConfig: config
        }
      );

    siteConfig =
      mergeSiteConfig(
        result.siteConfig ||
        config
      );

    applySiteConfig(
      siteConfig
    );

    fillSiteEditor(
      siteConfig
    );

    updateEditorPreview();

    setEditorStatus(
      '✓ Alterações salvas com sucesso.'
    );

    say(
      'Alterações do aplicativo salvas.'
    );

  } catch (error) {

    console.error(
      'Erro ao salvar editor:',
      error
    );

    setEditorStatus(
      error.message ||
        'Não foi possível salvar.',
      true
    );

    say(
      error.message,
      true
    );

  }

}


/* =========================================================
   EDITOR — RESTAURAR PADRÃO
   ========================================================= */

async function restoreSiteConfig() {

  const confirmed =
    window.confirm(
      'Restaurar a aparência padrão do aplicativo?'
    );

  if (!confirmed) {
    return;
  }

  try {

    const config =
      cloneDefaultSiteConfig();

    siteConfig =
      config;

    fillSiteEditor(
      config
    );

    applySiteConfig(
      config
    );

    updateEditorPreview();

    setEditorStatus(
      'Configuração padrão carregada. Clique em "Salvar" para publicar.'
    );

  } catch (error) {

    setEditorStatus(
      error.message,
      true
    );

  }

}


/* =========================================================
   EDITOR — UPLOAD DA IMAGEM
   ========================================================= */

function setupEditorImageUpload() {

  const input =
    $('editorHeroUpload');

  if (!input) return;

  input.addEventListener(
    'change',
    () => {

      const file =
        input.files?.[0];

      if (!file) {
        return;
      }

      /*
       * Limite para evitar colocar arquivos
       * gigantes dentro da configuração.
       */

      if (
        file.size >
        750 * 1024
      ) {

        setEditorStatus(
          'A imagem deve ter no máximo 750 KB.',
          true
        );

        input.value = '';

        return;
      }

      if (
        !file.type.startsWith(
          'image/'
        )
      ) {

        setEditorStatus(
          'Selecione uma imagem válida.',
          true
        );

        input.value = '';

        return;
      }

      const reader =
        new FileReader();

      reader.onload = () => {

        const dataUrl =
          String(
            reader.result || ''
          );

        const hidden =
          $('editorHeroImageValue');

        if (hidden) {

          hidden.value =
            dataUrl;

        }

        const preview =
          $('editorPreviewHero');

        if (preview) {

          preview.style.backgroundImage =
            `url("${dataUrl}")`;

        }

        updateEditorPreview();

        setEditorStatus(
          'Imagem carregada. Clique em "Salvar alterações" para publicar.'
        );

      };

      reader.onerror = () => {

        setEditorStatus(
          'Não foi possível carregar a imagem.',
          true
        );

      };

      reader.readAsDataURL(
        file
      );

    }
  );

}


/* =========================================================
   EDITOR — PRÉVIA EM TEMPO REAL
   ========================================================= */

function setupEditorLivePreview() {

  const fields = [

    'editorBrandName',
    'editorAuthTitle',
    'editorAuthText',
    'editorHomeEyebrow',
    'editorHomeTitle',
    'editorHomeText',
    'editorPrimaryButton',
    'editorSecondaryButton',
    'editorGold',
    'editorBackground',
    'editorHeroImageValue'

  ];

  fields.forEach(
    id => {

      const element =
        $(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        'input',
        updateEditorPreview
      );

      element.addEventListener(
        'change',
        updateEditorPreview
      );

    }
  );

}


/* =========================================================
   EDITOR — INICIALIZAÇÃO
   ========================================================= */

function setupSiteEditor() {

  const saveButton =
    $('saveSiteConfig');

  if (saveButton) {

    saveButton.addEventListener(
      'click',
      saveSiteConfig
    );

  }

  const restoreButton =
    $('restoreSiteConfig');

  if (restoreButton) {

    restoreButton.addEventListener(
      'click',
      restoreSiteConfig
    );

  }

  setupEditorImageUpload();

  setupEditorLivePreview();

}


/* =========================================================
   LOGIN
   ========================================================= */

async function handleLogin(
  event
) {

  event.preventDefault();

  try {

    const result =
      await api(
        '/login',
        'POST',
        {
          email:
            $('email')?.value.trim(),

          password:
            $('password')?.value || ''
        }
      );

    setSession(
      result,
      $('remember')?.checked !== false
    );

    await loadUserData();

    showUserApp();

    say(
      'Login realizado com sucesso.'
    );

  } catch (error) {

    say(
      error.message,
      true
    );

  }

}


/* =========================================================
   CADASTRO
   ========================================================= */

async function handleRegister(
  event
) {

  event.preventDefault();

  try {

    const result =
      await api(
        '/users/register',
        'POST',
        {
          name:
            $('rname')?.value.trim(),

          email:
            $('remail')?.value.trim(),

          password:
            $('rpassword')?.value || ''
        }
      );

    showLogin();

    if ($('email')) {

      $('email').value =
        $('remail')?.value.trim() || '';

    }

    say(
      result.message ||
        'Conta criada com sucesso.'
    );

  } catch (error) {

    say(
      error.message,
      true
    );

  }

}


/* =========================================================
   LOGIN DO ADMINISTRADOR
   ========================================================= */

async function handleAdminLogin(
  event
) {

  event.preventDefault();

  try {

    const result =
      await api(
        '/admin/login',
        'POST',
        {
          username:
            $('adminUsername')?.value.trim(),

          password:
            $('adminPassword')?.value || ''
        }
      );

    if (
      result.role &&
      result.role !== 'admin'
    ) {

      throw new Error(
        'Esta conta não possui acesso administrativo.'
      );

    }

    setSession(
      result,
      $('adminRemember')?.checked !== false
    );

    showAdminApp();

    await loadAdminData();

    await loadSiteConfig();

    say(
      'Painel administrativo aberto.'
    );

  } catch (error) {

    say(
      error.message,
      true
    );

  }

}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

  try {

    await api(
      '/logout',
      'POST',
      {}
    );

  } catch {
    /*
     * A sessão pode já ter expirado.
     */
  }

  token = '';
  role = '';
  currentUser = null;

  clearStoredSession();

  showLogin();

  say(
    'Você saiu da sua conta.'
  );

}


async function logoutAdmin() {

  await logout();

}


/* =========================================================
   ADMIN — CARREGAR DADOS
   ========================================================= */

async function loadAdminData() {

  const result =
    await api(
      '/admin/overview'
    );

  adminData =
    result;

  renderAdminDashboard(
    result
  );

}


/* =========================================================
   FORMULÁRIOS
   ========================================================= */

function wireForms() {

  $('loginForm')?.addEventListener(
    'submit',
    handleLogin
  );

  $('registerForm')?.addEventListener(
    'submit',
    handleRegister
  );

  $('adminLoginForm')?.addEventListener(
    'submit',
    handleAdminLogin
  );


  /*
   * Perfil
   */

  $('profileForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const result =
          await api(
            '/me/profile',
            'POST',
            {
              name:
                $('profileName')?.value.trim()
            }
          );

        currentUser =
          result.user ||
          result;

        applySiteConfig(
          siteConfig
        );

        say(
          'Perfil atualizado.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Suporte
   */

  $('supportForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        await api(
          '/support',
          'POST',
          {
            subject:
              $('supportSubject')?.value.trim(),

            message:
              $('supportMessage')?.value.trim()
          }
        );

        $('supportForm').reset();

        await loadSupport();

        say(
          'Solicitação enviada para a equipe.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Formulário de servidor
   */

  $('serverForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const id =
          $('serverId')?.value;

        const body = {

          id:
            id || undefined,

          name:
            $('serverName')?.value.trim(),

          type:
            $('serverType')?.value,

          userId:
            $('serverUser')?.value || '',

          ram:
            Number(
              $('serverRam')?.value || 0
            ),

          vcpu:
            Number(
              $('serverVcpu')?.value || 0
            ),

          gpu:
            $('serverGpu')?.value.trim(),

          storage:
            Number(
              $('serverStorage')?.value || 0
            ),

          status:
            $('serverStatusInput')?.value ||
            'offline'

        };

        await api(
          '/admin/servers',
          'POST',
          body
        );

        clearServerForm();

        await loadAdminData();

        say(
          'Servidor salvo.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Preço por minuto
   */

  $('minutePriceForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const value =
          Number(
            $('minutesRate')?.value || 0
          );

        await api(
          '/admin/minutes-price',
          'POST',
          {
            priceCents:
              Math.round(
                value * 100
              )
          }
        );

        await loadAdminData();

        say(
          'Preço por minuto atualizado.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Adicionar minutos
   */

  $('timeForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        await api(
          '/admin/time/add',
          'POST',
          {
            email:
              $('playerEmail')?.value.trim(),

            minutes:
              Number(
                $('addMinutes')?.value || 0
              )
          }
        );

        $('timeForm').reset();

        await loadAdminData();

        say(
          'Minutos adicionados.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );

}


/* =========================================================
   AÇÕES DOS BOTÕES
   ========================================================= */

function wireActions() {

  document.addEventListener(
    'click',
    async event => {

      const pageButton =
        event.target.closest(
          '[data-page]'
        );

      if (
        pageButton &&
        pageButton.dataset.page
      ) {

        showUserSection(
          pageButton.dataset.page
        );

        return;
      }


      const button =
        event.target.closest(
          'button'
        );

      if (!button) {
        return;
      }


      try {

        /*
         * Navegação de autenticação
         */

        if (
          button.id ===
          'showRegister'
        ) {

          showRegister();

          return;
        }

        if (
          button.id ===
          'showForgot'
        ) {

          showForgot();

          return;
        }

        if (
          button.id ===
          'showAdmin'
        ) {

          showAdminLogin();

          return;
        }


        if (
          [
            'backToLogin',
            'backLoginFromRegister',
            'backLoginFromForgot',
            'backLoginFromReset'
          ].includes(
            button.id
          )
        ) {

          showLogin();

          return;
        }


        /*
         * Logout
         */

        if (
          button.id ===
            'logoutUser' ||
          button.id ===
            'logoutAdmin'
        ) {

          await logout();

          return;
        }


        /*
         * Seleção de pacote
         */

        if (
          button.dataset
            .selectPackage
        ) {

          chosenPackage =
            button.dataset
              .selectPackage;

          say(
            'Pacote selecionado.'
          );

          return;
        }


        /*
         * Adicionar ao carrinho
         */

        if (
          button.id ===
          'addToCart'
        ) {

          const minutes =
            Number(
              $('minuteChoice')?.value ||
              0
            );

          if (
            !chosenPackage &&
            minutes <= 0
          ) {

            throw new Error(
              'Selecione um pacote ou adicione minutos.'
            );

          }

          cart = {

            packageId:
              chosenPackage,

            minutes:
              minutes

          };

          saveCart();

          renderCart();

          showUserSection(
            'cart'
          );

          say(
            'Itens adicionados ao carrinho.'
          );

          return;
        }


        /*
         * Finalizar compra
         */

        if (
          button.id ===
          'continueCheckout'
        ) {

          const pkg =
            catalog.find(
              item =>
                item.id ===
                cart.packageId
            );

          if (
            !pkg &&
            !Number(cart.minutes || 0)
          ) {

            throw new Error(
              'Seu carrinho está vazio.'
            );

          }

          const result =
            await api(
              '/orders',
              'POST',
              {
                packageId:
                  pkg?.id || null,

                minutes:
                  Number(
                    cart.minutes || 0
                  )
              }
            );

          cart = {

            packageId:
              null,

            minutes:
              0

          };

          saveCart();

          currentOrder =
            result.order;

          showUserSection(
            'payment'
          );

          say(
            'Pedido criado com sucesso.'
          );

          return;
        }


        /*
         * Atualizar painel admin
         */

        if (
          button.id ===
          'refreshAdmin'
        ) {

          await loadAdminData();

          say(
            'Dados atualizados.'
          );

          return;
        }


        /*
         * Abas do administrador
         */

        if (
          button.dataset
            .adminPage
        ) {

          showAdminSection(
            button.dataset.adminPage
          );

          return;
        }


        /*
         * Editar servidor
         */

        if (
          button.dataset
            .editServer
        ) {

          const server =
            adminData?.servers?.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset.editServer
                )
            );

          if (!server) {
            return;
          }

          if ($('serverId'))
            $('serverId').value =
              server.id || '';

          if ($('serverName'))
            $('serverName').value =
              server.name || '';

          if ($('serverType'))
            $('serverType').value =
              server.type || 'FiveM';

          if ($('serverUser'))
            $('serverUser').value =
              server.userId || '';

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


        /*
         * Cancelar edição
         */

        if (
          button.id ===
          'cancelServerEdit'
        ) {

          clearServerForm();

          return;
        }


        /*
         * Excluir servidor
         */

        if (
          button.dataset
            .deleteServer
        ) {

          if (
            !window.confirm(
              'Excluir este servidor?'
            )
          ) {

            return;

          }

          await api(
            `/admin/servers/${encodeURIComponent(
              button.dataset.deleteServer
            )}/delete`,
            'POST',
            {}
          );

          await loadAdminData();

          say(
            'Servidor excluído.'
          );

          return;
        }


        /*
         * Aprovar pedido
         */

        if (
          button.dataset
            .approveOrder
        ) {

          await api(
            `/admin/orders/${encodeURIComponent(
              button.dataset.approveOrder
            )}/approve`,
            'POST',
            {}
          );

          await loadAdminData();

          say(
            'Pedido aprovado.'
          );

          return;
        }


        /*
         * Stream
         */

        if (
          button.id ===
          'startStream'
        ) {

          const result =
            await api(
              '/admin/stream/start',
              'POST',
              {}
            );

          await loadStream();

          say(
            result.message ||
              'Streaming iniciado.'
          );

          return;
        }


        if (
          button.id ===
          'stopStream'
        ) {

          const result =
            await api(
              '/admin/stream/stop',
              'POST',
              {}
            );

          await loadStream();

          say(
            result.message ||
              'Streaming parado.'
          );

          return;
        }


        /*
         * FiveM do usuário
         */

        if (
          button.dataset
            .fivemStart !==
          undefined
        ) {

          const result =
            await api(
              '/stream/start',
              'POST',
              {}
            );

          await loadStream();

          say(
            result.message ||
              'Streaming iniciado.'
          );

          return;
        }

      } catch (error) {

        console.error(error);

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Alteração de preço dos pacotes
   */

  document.addEventListener(
    'submit',
    async event => {

      const form =
        event.target.closest(
          '.admin-package-form'
        );

      if (!form) {
        return;
      }

      event.preventDefault();

      try {

        const price =
          Number(
            form.elements.price.value ||
            0
          );

        await api(
          '/admin/packages',
          'POST',
          {
            id:
              form.dataset.packageId,

            priceCents:
              Math.round(
                price * 100
              )
          }
        );

        await loadAdminData();

        say(
          'Preço do pacote atualizado.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  /*
   * Minutos
   */

  $('minuteChoice')?.addEventListener(
    'input',
    () => {

      const element =
        $('minuteChoice');

      if (
        element &&
        $('minuteChoiceValue')
      ) {

        $('minuteChoiceValue')
          .textContent =
          Number(
            element.value || 0
          ).toLocaleString(
            'pt-BR'
          );

      }

    }
  );

}


/* =========================================================
   FORMULÁRIO DE RECUPERAÇÃO
   ========================================================= */

function setupRecoveryForms() {

  $('forgotForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const result =
          await api(
            '/forgot-password',
            'POST',
            {
              email:
                $('femail')?.value.trim()
            }
          );

        say(
          result.message ||
            'Solicitação processada.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );


  $('resetForm')?.addEventListener(
    'submit',
    async event => {

      event.preventDefault();

      try {

        const params =
          new URLSearchParams(
            window.location.search
          );

        const resetToken =
          params.get('token') ||
          params.get('reset') ||
          '';

        const result =
          await api(
            '/reset-password',
            'POST',
            {
              token:
                resetToken,

              password:
                $('newpassword')?.value ||
                ''
            }
          );

        showLogin();

        say(
          result.message ||
            'Senha atualizada.'
        );

      } catch (error) {

        say(
          error.message,
          true
        );

      }

    }
  );

}


/* =========================================================
   RESTAURAR SESSÃO
   ========================================================= */

async function restoreSession() {

  if (!token) {

    showLogin();

    return;

  }

  try {

    if (
      role === 'admin'
    ) {

      showAdminApp();

      await loadAdminData();

      await loadSiteConfig();

      return;

    }

    role =
      'player';

    await loadUserData();

    showUserApp();

  } catch (error) {

    console.warn(
      'Sessão expirada:',
      error
    );

    token = '';
    role = '';

    clearStoredSession();

    showLogin();

  }

}


/* =========================================================
   INICIALIZAÇÃO DO APLICATIVO
   ========================================================= */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    try {

      wireForms();

      wireActions();

      setupUserNavigation();

      setupAdminNavigation();

      setupSiteEditor();

      setupRecoveryForms();

      /*
       * Carrega configuração visual
       * pública mesmo antes do login.
       */

      loadSiteConfig()
        .catch(
          error =>
            console.warn(
              'Configuração visual:',
              error
            )
        );

      /*
       * Restaura sessão existente.
       */

      restoreSession()
        .catch(
          error => {

            console.error(
              'Falha ao iniciar GameCloud:',
              error
            );

            showLogin();

          }
        );

    } catch (error) {

      console.error(
        'Erro fatal ao iniciar app.js:',
        error
      );

      showLogin();

    }

  }
);


/* =========================================================
   API PÚBLICA DO EDITOR
   ========================================================= */

window.GameCloudEditor = {

  getConfig() {

    return JSON.parse(
      JSON.stringify(
        siteConfig
      )
    );

  },

  setConfig(config) {

    siteConfig =
      mergeSiteConfig(
        config
      );

    applySiteConfig(
      siteConfig
    );

    fillSiteEditor(
      siteConfig
    );

    updateEditorPreview();

  }

};


/* =========================================================
   FIM DO APP.JS
   ========================================================= */

'use strict';

const API_BASE = '/api/';
const CART_KEY = 'igc_cart_v1';
let token = localStorage.getItem('igc_token') || sessionStorage.getItem('igc_token') || '';
let role = localStorage.getItem('igc_role') || sessionStorage.getItem('igc_role') || '';
let currentUser = null;
let catalog = [];
let minutesRateCents = 10;
let chosenPackage = null;
let cart = readCart();
let currentOrder = null;
let adminData = null;
const $ = (id) => document.getElementById(id);
const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMinutes = (value) => `${Number(value || 0).toLocaleString('pt-BR')} min`;

function readCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || 'null') || { packageId: null, minutes: 0 }; }
  catch { return { packageId: null, minutes: 0 }; }
}
function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function say(text, error = false) {
  const node = $('message'); if (!node) return;
  node.textContent = text || ''; node.className = `message${error ? ' error' : ''}`;
  if (text) window.setTimeout(() => { if (node.textContent === text) node.textContent = ''; }, 7000);
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
async function api(route, method = 'GET', body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API_BASE + route, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  let result = {};
  try { result = await response.json(); } catch { /* resposta sem JSON */ }
  if (!response.ok) throw new Error(result.error || result.message || `Erro ${response.status}`);
  return result;
}
function setSession(result, remember) {
  token = result.token || ''; role = result.role || 'player'; clearStoredSession();
  const store = remember ? localStorage : sessionStorage;
  store.setItem('igc_token', token); store.setItem('igc_role', role);
}
function clearStoredSession() {
  localStorage.removeItem('igc_token'); localStorage.removeItem('igc_role');
  sessionStorage.removeItem('igc_token'); sessionStorage.removeItem('igc_role');
}
function show(page) {
  document.querySelectorAll('.page').forEach((item) => item.classList.toggle('active', item.id === page));
  if (page === 'user') showUserPage('home');
}
const pageTitles = { home: 'Visão geral', servers: 'Meus servidores', buy: 'Comprar servidor', cart: 'Carrinho', payment: 'Pagamento', fivem: 'FiveM', orders: 'Pedidos', profile: 'Perfil', settings: 'Configurações', support: 'Suporte' };
function showUserPage(page) {
  document.querySelectorAll('.page').forEach((item) => item.classList.toggle('active', item.id === 'user'));
  document.querySelectorAll('.content-section').forEach((item) => item.classList.toggle('active', item.id === page));
  document.querySelectorAll('.nav-item[data-page]').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  if ($('topTitle')) $('topTitle').textContent = pageTitles[page] || 'GameCloud';
  if (page === 'cart') renderCart();
  if (page === 'orders') loadOrders().catch((error) => say(error.message, true));
  if (page === 'fivem') loadStream().catch((error) => say(error.message, true));
  if (page === 'support') loadSupport().catch((error) => say(error.message, true));
}
function serverCard(server) {
  const status = String(server.status || 'offline');
  const isOnline = status === 'online';
  return `<article class="server-card"><div class="server-card-top"><div><span class="eyebrow">${escapeHtml(server.type || 'Servidor')}</span><h3>${escapeHtml(server.name)}</h3><p>${escapeHtml(server.userName || 'Sua instância GameCloud')}</p></div><span class="status"><i class="dot ${isOnline ? 'online' : ''}"></i>${escapeHtml(status)}</span></div><div class="specs"><div class="spec"><small>RAM</small><strong>${Number(server.ram)} GB</strong></div><div class="spec"><small>vCPU</small><strong>${Number(server.vcpu)} cores</strong></div><div class="spec"><small>GPU</small><strong>${escapeHtml(server.gpu)}</strong></div><div class="spec"><small>Armazenamento</small><strong>${Number(server.storage)} GB</strong></div></div><div class="card-actions"><button class="btn primary small" data-fivem-start="${escapeHtml(server.id)}">Abrir FiveM</button><span class="muted small">${isOnline ? 'Estado reportado pelo agente' : 'Aguardando infraestrutura'}</span></div></article>`;
}
async function loadUser() {
  const result = await api('me'); currentUser = result.user || result;
  const name = currentUser.name || currentUser.username || 'Jogador';
  if ($('sideName')) $('sideName').textContent = name;
  if ($('topUser')) $('topUser').textContent = name;
  if ($('greetingName')) $('greetingName').textContent = name;
  if ($('minutes')) $('minutes').textContent = fmtMinutes(currentUser.minutes);
  if ($('profileName')) $('profileName').value = name;
  if ($('profileEmail')) $('profileEmail').value = currentUser.email || '';
  if ($('profileUsername')) $('profileUsername').value = currentUser.username || '';
  await Promise.all([loadCatalog(), loadServers(), loadOrders(), loadStream()]);
  show('user'); showUserPage('home');
}
async function loadCatalog() {
  const result = await api('packages'); catalog = Array.isArray(result.packages) ? result.packages : [];
  minutesRateCents = Number(result.minutesRateCents ?? 0); renderCatalog(); renderSelection(); renderCart();
}
function renderCatalog() {
  const root = $('packageGrid'); if (!root) return;
  root.innerHTML = catalog.map((item) => `<article class="package-card ${chosenPackage === item.id ? 'selected' : ''}"><span class="eyebrow">Pacote GameCloud</span><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml(item.description || 'Recursos dedicados para seu servidor.')}</p><div class="package-price">${money(item.priceCents)}</div><div class="package-specs"><span>RAM <b>${Number(item.ram)} GB</b></span><span>vCPU <b>${Number(item.vcpu)}</b></span><span>GPU <b>${escapeHtml(item.gpu)}</b></span><span>Armazenamento <b>${Number(item.storage)} GB</b></span></div><button class="btn ${chosenPackage === item.id ? 'primary' : ''} full" data-select-package="${escapeHtml(item.id)}">${chosenPackage === item.id ? 'Selecionado' : 'Selecionar pacote'}</button></article>`).join('');
  if ($('minutesRateLabel')) $('minutesRateLabel').textContent = `Tarifa atual: ${money(minutesRateCents)} por minuto. O administrador pode alterá-la no catálogo.`;
}
function selectionCents() {
  const selected = catalog.find((item) => item.id === chosenPackage);
  const minutes = Number($('minuteChoice')?.value || 0);
  return (selected?.priceCents || 0) + minutes * minutesRateCents;
}
function renderSelection() {
  const root = $('selectionSummary'); if (!root) return;
  const selected = catalog.find((item) => item.id === chosenPackage);
  const minutes = Number($('minuteChoice')?.value || 0);
  root.innerHTML = `<div class="summary-line"><span>Pacote</span><b>${selected ? escapeHtml(selected.name) : 'Não selecionado'}</b></div><div class="summary-line"><span>Tempo adicional</span><b>${fmtMinutes(minutes)}</b></div><div class="summary-line"><span>Subtotal do pacote</span><b>${money(selected?.priceCents || 0)}</b></div><div class="summary-line"><span>Subtotal do tempo</span><b>${money(minutes * minutesRateCents)}</b></div><div class="summary-line total"><span>Total</span><b>${money(selectionCents())}</b></div>`;
}
async function loadServers() {
  const result = await api('servers'); const list = Array.isArray(result.servers) ? result.servers : [];
  const markup = list.length ? list.map(serverCard).join('') : '<div class="panel muted">Você ainda não possui servidores. Escolha um pacote para começar.</div>';
  if ($('serversList')) $('serversList').innerHTML = markup;
  if ($('homeServers')) $('homeServers').innerHTML = list.length ? list.slice(0, 2).map(serverCard).join('') : '<div class="muted">Nenhum servidor vinculado ainda.</div>';
  if ($('fivemServers')) $('fivemServers').innerHTML = list.length ? list.map(serverCard).join('') : '<div class="panel muted">Nenhuma instância com FiveM vinculada.</div>';
  if ($('serverCount')) $('serverCount').textContent = String(list.length);
}
function cartTotals() {
  const item = catalog.find((entry) => entry.id === cart.packageId);
  const packageCents = item?.priceCents || 0;
  const minutesCents = Math.max(0, Number(cart.minutes) || 0) * minutesRateCents;
  return { item, packageCents, minutesCents, total: packageCents + minutesCents };
}
function renderCart() {
  const root = $('cartContent'); if (!root) return;
  const { item, packageCents, minutesCents, total } = cartTotals();
  const hasCart = Boolean(item || Number(cart.minutes) > 0);
  root.innerHTML = hasCart ? `<div class="panel-head"><div><h2>Itens da compra</h2><p>Um único pedido para o pacote e o tempo.</p></div><button id="clearCart" class="btn danger small">Remover</button></div>${item ? `<div class="summary-line"><span>Pacote ${escapeHtml(item.name)} • ${item.ram} GB RAM, ${item.vcpu} vCPU, ${escapeHtml(item.gpu)}</span><b>${money(packageCents)}</b></div>` : ''}${Number(cart.minutes) > 0 ? `<div class="summary-line"><span>${fmtMinutes(cart.minutes)}</span><b>${money(minutesCents)}</b></div>` : ''}` : '<div class="empty">Seu carrinho está vazio. Escolha um pacote e/ou minutos.</div>';
  if ($('cartSummary')) $('cartSummary').innerHTML = `<div class="summary-line"><span>Pacote</span><b>${money(packageCents)}</b></div><div class="summary-line"><span>Tempo</span><b>${money(minutesCents)}</b></div><div class="summary-line total"><span>Total</span><b>${money(total)}</b></div>`;
  if ($('continueCheckout')) $('continueCheckout').disabled = !hasCart;
  $('clearCart')?.addEventListener('click', () => { cart = { packageId: null, minutes: 0 }; saveCart(); renderCart(); });
}
async function loadOrders() {
  const result = await api('orders'); const items = Array.isArray(result.orders) ? result.orders : [];
  if ($('pendingCount')) $('pendingCount').textContent = String(items.filter((item) => item.status === 'PENDENTE').length);
  if ($('ordersList')) $('ordersList').innerHTML = items.length ? items.map((item) => `<article class="order-card"><div><span class="status">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.packageName || 'Tempo de jogo')}</h3><p class="muted">${fmtMinutes(item.minutes)} • ${new Date(item.createdAt).toLocaleString('pt-BR')}</p><p class="muted small">${escapeHtml(item.paymentMessage || '')}</p></div><strong>${money(item.totalCents)}</strong></article>`).join('') : '<div class="panel muted">Nenhum pedido registrado.</div>';
}
async function loadStream() {
  const result = await api('stream/status'); const stream = result.streaming || result;
  const label = ({ online: 'Online', starting: 'Iniciando', stopping: 'Encerrando', error: 'Erro', offline: 'Offline' })[stream.status] || 'Desconhecido';
  if ($('playerMiniStatus')) $('playerMiniStatus').textContent = label;
  if ($('streamStatus')) $('streamStatus').innerHTML = `<i class="dot ${stream.status === 'online' ? 'online' : ''}"></i>${escapeHtml(label)}`;
  if ($('streamMessage')) $('streamMessage').textContent = stream.message || 'Sem mensagem do agente.';
  if ($('adminStreamStatus')) $('adminStreamStatus').textContent = label;
  if ($('adminStreamMessage')) $('adminStreamMessage').textContent = stream.message || '—';
  if ($('adminStreamHeartbeat')) $('adminStreamHeartbeat').textContent = stream.lastHeartbeat ? new Date(stream.lastHeartbeat).toLocaleString('pt-BR') : 'Sem heartbeat';
  if ($('adminStreamShort')) $('adminStreamShort').textContent = label;
  const toggle = $('toggleStream'); if (toggle) toggle.textContent = stream.enabled ? 'Desativar streaming' : 'Ativar streaming';
}
function renderPayment(order) {
  currentOrder = order;
  const root = $('paymentPanel'); if (!root) return;
  root.innerHTML = `<div class="panel-head"><div><span class="eyebrow">Pedido ${escapeHtml(order.id.slice(0, 8))}</span><h2>Compra registrada</h2></div><span class="status">${escapeHtml(order.status)}</span></div><div class="summary-line"><span>Pacote</span><b>${escapeHtml(order.packageName || 'Não selecionado')}</b></div><div class="summary-line"><span>Tempo</span><b>${fmtMinutes(order.minutes)}</b></div><div class="summary-line total"><span>Total do pedido</span><b>${money(order.totalCents)}</b></div><div class="notice" style="margin-top:14px">${escapeHtml(order.paymentMessage)} Não informe dados de cartão nesta tela.</div><button class="btn ghost" data-page="orders" style="margin-top:14px">Ver histórico de pedidos</button>`;
}
function adminSection(page) {
  document.querySelectorAll('.admin-section').forEach((item) => item.classList.toggle('active', item.id === `admin-${page}`));
  document.querySelectorAll('.admin-tab').forEach((item) => item.classList.toggle('active', item.dataset.adminPage === page));
  if (page === 'servers') loadAdmin().catch((error) => say(error.message, true));
  if (page === 'orders') loadAdmin().catch((error) => say(error.message, true));
  if (page === 'catalog') loadAdmin().catch((error) => say(error.message, true));
}
function renderAdmin(data) {
  adminData = data;
  const users = data.users || [], servers = data.servers || [], orders = data.orders || [];
  if ($('adminUserCount')) $('adminUserCount').textContent = String(users.length);
  if ($('adminServerCount')) $('adminServerCount').textContent = String(servers.length);
  if ($('adminPendingCount')) $('adminPendingCount').textContent = String(orders.filter((item) => item.status === 'PENDENTE').length);
  if ($('adminUsers')) $('adminUsers').innerHTML = users.map((user) => `<tr><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email)}</td><td>${fmtMinutes(user.minutes)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum usuário.</td></tr>';
  if ($('serverUser')) $('serverUser').innerHTML = '<option value="">Sem vínculo</option>' + users.map((user) => `<option value="${Number(user.id)}">${escapeHtml(user.name)} • ${escapeHtml(user.email)}</option>`).join('');
  if ($('adminServers')) $('adminServers').innerHTML = servers.length ? servers.map((item) => `<article class="admin-server-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)} • ${escapeHtml(item.userName || 'Sem vínculo')}</small></div><div><span class="status">${escapeHtml(item.status)}</span><small>${Number(item.ram)} GB RAM • ${Number(item.vcpu)} vCPU • ${escapeHtml(item.gpu)} • ${Number(item.storage)} GB</small></div><div class="card-actions"><button class="btn small" data-edit-server="${escapeHtml(item.id)}">Editar</button><button class="btn danger small" data-delete-server="${escapeHtml(item.id)}">Excluir</button><button class="btn small" data-server-action="start" data-server-id="${escapeHtml(item.id)}">Iniciar</button><button class="btn small" data-server-action="stop" data-server-id="${escapeHtml(item.id)}">Parar</button></div></article>`).join('') : '<div class="muted">Nenhum servidor cadastrado.</div>';
  if ($('adminOrders')) $('adminOrders').innerHTML = orders.length ? orders.map((item) => `<article class="order-card"><div><span class="status">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.userName)} • ${escapeHtml(item.packageName || 'Tempo')}</h3><p class="muted">${fmtMinutes(item.minutes)} • ${new Date(item.createdAt).toLocaleString('pt-BR')}</p><p class="muted small">${escapeHtml(item.paymentMessage)}</p></div><div><strong>${money(item.totalCents)}</strong>${item.status === 'PENDENTE' ? `<button class="btn primary small" data-approve-order="${escapeHtml(item.id)}">Aprovar manualmente</button>` : ''}</div></article>`).join('') : '<div class="panel muted">Nenhum pedido.</div>';
  if ($('adminCatalog')) $('adminCatalog').innerHTML = (data.packages || []).map((item) => `<form class="panel admin-package-form" data-package-id="${escapeHtml(item.id)}"><div class="panel-head"><div><h2>${escapeHtml(item.name)}</h2><p>${Number(item.ram)} GB RAM • ${Number(item.vcpu)} vCPU • ${escapeHtml(item.gpu)}</p></div></div><div class="field"><label>Preço (R$)</label><input name="price" type="number" min="0" step="0.01" value="${(Number(item.priceCents) / 100).toFixed(2)}" required></div><button class="btn primary" style="margin-top:12px">Salvar preço</button></form>`).join('');
  if ($('minutesRate')) $('minutesRate').value = (Number(data.minutesRateCents || 0) / 100).toFixed(2);
  const tickets = data.tickets || [];
  if ($('adminTickets')) $('adminTickets').innerHTML = tickets.length ? tickets.map((item) => `<article class="order-card"><div><span class="status">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.userName)} • ${escapeHtml(item.email)}</p><p class="muted">${escapeHtml(item.message)}</p></div><small>${new Date(item.createdAt).toLocaleString('pt-BR')}</small></article>`).join('') : '<div class="muted">Nenhum chamado.</div>';
}
async function loadAdmin() { const result = await api('admin/overview'); renderAdmin(result); await loadStream(); }
function clearServerForm() { $('serverForm')?.reset(); if ($('serverId')) $('serverId').value = ''; if ($('serverFormTitle')) $('serverFormTitle').textContent = 'Criar servidor'; }
async function logout() {
  try { await api('logout', 'POST', {}); } catch { /* sessão pode já ter expirado */ }
  token = ''; role = ''; currentUser = null; clearStoredSession(); show('login'); say('Você saiu da sua conta.');
}

function wireForms() {
  $('loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('login', 'POST', { email: $('email').value.trim(), password: $('password').value }); setSession(result, $('remember').checked); await loadUser(); say('Login realizado.'); }
    catch (error) { say(error.message, true); }
  });
  $('registerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('users/register', 'POST', { name: $('rname').value.trim(), email: $('remail').value.trim(), password: $('rpassword').value }); show('login'); $('email').value = $('remail').value; say(result.message || 'Conta criada.'); }
    catch (error) { say(error.message, true); }
  });
  $('forgotForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('forgot-password', 'POST', { email: $('femail').value.trim() }); say(`${result.message} Se não houver e-mail configurado, o administrador deve consultar o log privado do servidor.`); }
    catch (error) { say(error.message, true); }
  });
  $('resetForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const params = new URLSearchParams(location.search); const result = await api('reset-password', 'POST', { token: params.get('token') || params.get('reset') || '', password: $('newpassword').value }); show('login'); say(result.message || 'Senha atualizada.'); }
    catch (error) { say(error.message, true); }
  });
  $('adminLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('admin/login', 'POST', { username: $('adminUsername').value.trim(), password: $('adminPassword').value }); setSession(result, $('adminRemember').checked); show('admin'); adminSection('overview'); await loadAdmin(); say('Sessão administrativa iniciada.'); }
    catch (error) { say(error.message, true); }
  });
  $('profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('me/profile', 'POST', { name: $('profileName').value.trim() }); currentUser = result.user; await loadUser(); showUserPage('profile'); say('Perfil atualizado.'); }
    catch (error) { say(error.message, true); }
  });
  $('supportForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('support', 'POST', { subject: $('supportSubject').value.trim(), message: $('supportMessage').value.trim() }); $('supportForm').reset(); await loadSupport(); say('Solicitação enviada para a equipe.'); }
    catch (error) { say(error.message, true); }
  });
  $('serverForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('serverId').value;
    const body = { id: id || undefined, name: $('serverName').value.trim(), type: $('serverType').value, userId: $('serverUser').value, ram: Number($('serverRam').value), vcpu: Number($('serverVcpu').value), gpu: $('serverGpu').value.trim(), storage: Number($('serverStorage').value), status: $('serverStatusInput').value };
    try { await api('admin/servers', 'POST', body); clearServerForm(); await loadAdmin(); say('Servidor salvo. Nenhuma máquina física foi provisionada.'); }
    catch (error) { say(error.message, true); }
  });
  $('minutePriceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('admin/minutes-price', 'POST', { priceCents: Math.round(Number($('minutesRate').value) * 100) }); await loadAdmin(); say('Preço por minuto atualizado.'); }
    catch (error) { say(error.message, true); }
  });
  $('timeForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('admin/time/add', 'POST', { email: $('playerEmail').value.trim(), minutes: Number($('addMinutes').value) }); $('timeForm').reset(); await loadAdmin(); say('Minutos adicionados.'); }
    catch (error) { say(error.message, true); }
  });
}
async function loadSupport() {
  const result = await api('support'); const items = result.tickets || [];
  if ($('supportHistory')) $('supportHistory').innerHTML = items.length ? `<h3>Solicitações anteriores</h3>${items.map((item) => `<article class="order-card"><div><span class="status">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.subject)}</h3><p class="muted">${escapeHtml(item.message)}</p></div><small>${new Date(item.createdAt).toLocaleString('pt-BR')}</small></article>`).join('')}` : '';
}
function wireActions() {
  document.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { showUserPage(pageButton.dataset.page); return; }
    const button = event.target.closest('button'); if (!button) return;
    try {
      if (button.id === 'showRegister') { show('register'); return; }
      if (button.id === 'showForgot') { show('forgot'); return; }
      if (button.id === 'showAdmin') { show('adminLogin'); return; }
      if (['backToLogin', 'backLoginFromRegister', 'backLoginFromForgot', 'backLoginFromReset'].includes(button.id)) { show('login'); return; }
      if (button.id === 'logoutUser' || button.id === 'logoutAdmin') { await logout(); return; }
      if (button.dataset.selectPackage) { chosenPackage = button.dataset.selectPackage; renderCatalog(); renderSelection(); return; }
      if (button.id === 'addToCart') {
        const minutes = Number($('minuteChoice').value || 0);
        if (!chosenPackage && minutes <= 0) throw new Error('Selecione um pacote ou adicione minutos.');
        cart = { packageId: chosenPackage, minutes }; saveCart(); renderCart(); showUserPage('cart'); say('Itens adicionados ao carrinho.'); return;
      }
      if (button.id === 'continueCheckout') {
        const { item, total } = cartTotals();
        if (!item && !cart.minutes) throw new Error('Seu carrinho está vazio.');
        const result = await api('orders', 'POST', { packageId: item?.id || null, minutes: Number(cart.minutes || 0) });
        cart = { packageId: null, minutes: 0 }; saveCart(); renderPayment(result.order); await loadOrders(); showUserPage('payment'); return;
      }
      if (button.id === 'refreshAdmin') { await loadAdmin(); say('Dados atualizados.'); return; }
      if (button.id === 'refreshStream' || button.id === 'refreshAdminStream') { await loadStream(); say('Status atualizado.'); return; }
      if (button.id === 'saveSettings') {
        clearStoredSession(); const store = $('rememberSetting').checked ? localStorage : sessionStorage;
        store.setItem('igc_token', token); store.setItem('igc_role', role); say('Preferência salva.'); return;
      }
      if (button.dataset.adminPage) { adminSection(button.dataset.adminPage); return; }
      if (button.dataset.editServer) {
        const item = adminData?.servers?.find((server) => server.id === button.dataset.editServer); if (!item) return;
        $('serverId').value = item.id; $('serverName').value = item.name; $('serverType').value = item.type; $('serverUser').value = item.userId ?? ''; $('serverRam').value = item.ram; $('serverVcpu').value = item.vcpu; $('serverGpu').value = item.gpu; $('serverStorage').value = item.storage; $('serverStatusInput').value = item.status; $('serverFormTitle').textContent = 'Editar servidor'; $('serverName').focus(); return;
      }
      if (button.id === 'cancelServerEdit') { clearServerForm(); return; }
      if (button.dataset.deleteServer) {
        if (!window.confirm('Excluir este registro de servidor?')) return;
        await api(`admin/servers/${encodeURIComponent(button.dataset.deleteServer)}/delete`, 'POST', {}); await loadAdmin(); say('Servidor excluído.'); return;
      }
      if (button.dataset.serverAction) {
        await api(`admin/servers/${encodeURIComponent(button.dataset.serverId)}/${button.dataset.serverAction}`, 'POST', {}); return;
      }
      if (button.dataset.approveOrder) {
        await api(`admin/orders/${encodeURIComponent(button.dataset.approveOrder)}/approve`, 'POST', {}); await loadAdmin(); say('Pedido aprovado; minutos creditados e servidor cadastrado como offline.'); return;
      }
      if (button.id === 'startStream' || button.id === 'stopStream') {
        const action = button.id === 'startStream' ? 'start' : 'stop'; const result = await api(`admin/stream/${action}`, 'POST', {}); await loadStream(); say(result.message); return;
      }
      if (button.id === 'toggleStream') {
        const result = await api('stream/status'); const stream = result.streaming || result;
        await api('admin/stream/toggle', 'POST', { enabled: !stream.enabled }); await loadStream(); say('Configuração atualizada.'); return;
      }
      if (button.dataset.fivemStart !== undefined) {
        const result = await api('stream/start', 'POST', {}); await loadStream(); say(result.message); return;
      }
    } catch (error) { say(error.message, true); }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('.admin-package-form'); if (!form) return;
    event.preventDefault();
    try { await api('admin/packages', 'POST', { id: form.dataset.packageId, priceCents: Math.round(Number(form.elements.price.value) * 100) }); await loadCatalog(); await loadAdmin(); say('Preço do pacote atualizado.'); }
    catch (error) { say(error.message, true); }
  });
  $('minuteChoice')?.addEventListener('change', renderSelection);
}
async function restoreSession() {
  if (!token) { show('login'); return; }
  try {
    if (role === 'admin') { show('admin'); adminSection('overview'); await loadAdmin(); }
    else { role = 'player'; await loadUser(); }
  } catch { clearStoredSession(); token = ''; role = ''; show('login'); }
}
document.addEventListener('DOMContentLoaded', () => {
  wireForms(); wireActions();
  $('rememberSetting').checked = Boolean(localStorage.getItem('igc_token'));
  restoreSession().catch((error) => { console.error('Falha ao restaurar sessão GameCloud:', error); show('login'); });
});

/* ================= 司机黑名单收集系统 - 前端 ================= */
// ===== 后端 API 地址配置 =====
// 前后端分离部署时，把这里改成后端地址（末尾不带斜杠），例如：
//   const API_BASE = 'https://your-app.onrender.com';
// 若前后端同源部署（后端和前端在同一个域名），保持空字符串即可。
const API_BASE = '';

const state = {
  user: null,
  token: localStorage.getItem('dl_token') || '',
  problems: [],
};

const $ = (sel) => document.querySelector(sel);

// ---------- 工具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function maskIdCard(ic) {
  ic = String(ic || '');
  if (ic.length <= 8) return ic;
  return ic.slice(0, 6) + '********' + ic.slice(-4);
}

function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2600);
}

async function api(path, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    if (res.status === 401) { logout(); }
    throw new Error(data.error || `请求失败(${res.status})`);
  }
  return data;
}

// ---------- 问题标签颜色 ----------
function tagColor(name) {
  if (/诈骗|骗/.test(name)) return 'tag-danger';
  if (/安全/.test(name)) return 'tag-danger';
  if (/回款|履约|欠|租金/.test(name)) return 'tag-warning';
  if (/纠纷/.test(name)) return 'tag-info';
  if (/经验|操作/.test(name)) return 'tag-primary';
  return 'tag-gray';
}
function problemTags(problems) {
  return (problems || []).map((p) => `<span class="tag ${tagColor(p.name)}">${esc(p.name)}</span>`).join('');
}

// ---------- 弹窗 ----------
function openModal(html, lg = false) {
  $('#modal-root').innerHTML = `
    <div class="modal-mask" data-close>
      <div class="modal ${lg ? 'lg' : ''}" data-stop>
        ${html}
      </div>
    </div>`;
  $('#modal-root').querySelector('.modal-close').onclick = closeModal;
  $('#modal-root').querySelector('[data-close]').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- 登录 ----------
function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">🚚</div>
        <h1>司机黑名单收集系统</h1>
        <div class="login-sub">车队运营 · 违规司机信息共享平台</div>
        <form id="login-form">
          <div class="form-item">
            <label>用户名</label>
            <input id="lg-user" autocomplete="username" placeholder="请输入用户名">
          </div>
          <div class="form-item">
            <label>密码</label>
            <input id="lg-pass" type="password" autocomplete="current-password" placeholder="请输入密码">
          </div>
          <button class="btn btn-primary btn-block" type="submit" style="padding:11px">登 录</button>
        </form>
      </div>
    </div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const username = $('#lg-user').value.trim();
    const password = $('#lg-pass').value;
    if (!username || !password) return toast('请输入用户名和密码', 'warning');
    try {
      const data = await api('/api/login', 'POST', { username, password });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('dl_token', data.token);
      await loadProblems();
      toast(`欢迎回来，${data.user.display_name}`, 'success');
      location.hash = defaultRoute();
      renderApp();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function logout() {
  api('/api/logout', 'POST').catch(() => {});
  state.user = null;
  state.token = '';
  localStorage.removeItem('dl_token');
  location.hash = '';
  renderLogin();
}

async function loadProblems() {
  try { const d = await api('/api/problems'); state.problems = d.problems; } catch (e) { state.problems = []; }
}

// ---------- 主框架 ----------
function defaultRoute() { return state.user.role === 'manager' ? 'all' : 'my'; }

const NAV = {
  manager: [
    { id: 'all', title: '全部司机', icon: '🗂️', view: renderAllDrivers },
    { id: 'add', title: '新增司机', icon: '➕', view: renderAddDriver },
    { id: 'query', title: '司机查询', icon: '🔍', view: renderQuery },
    { id: 'dict', title: '问题字典维护', icon: '📖', view: renderDictManage },
    { id: 'users', title: '运营商账号', icon: '👥', view: renderUsers },
  ],
  operator: [
    { id: 'my', title: '我的司机', icon: '🗂️', view: renderMyDrivers },
    { id: 'add', title: '新增司机', icon: '➕', view: renderAddDriver },
    { id: 'query', title: '司机查询', icon: '🔍', view: renderQuery },
    { id: 'dict', title: '问题字典', icon: '📖', view: renderDictView },
  ],
};

function renderApp() {
  const role = state.user.role;
  const nav = NAV[role];
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-brand"><span class="logo">🚚</span>司机黑名单系统</div>
        <nav class="sidebar-nav" id="sidebar-nav">
          <div class="nav-title">功能菜单</div>
          ${nav.map((n) => `
            <a class="nav-item ${currentRoute() === n.id ? 'active' : ''}" data-route="${n.id}">
              <span class="ico">${n.icon}</span>${n.title}
            </a>`).join('')}
        </nav>
        <div class="sidebar-user">
          <div class="avatar ${role === 'manager' ? 'mgr' : ''}">${esc((state.user.display_name || 'U').charAt(0))}</div>
          <div>
            <div class="u-name">${esc(state.user.display_name)}</div>
            <div class="u-role">${role === 'manager' ? '系统经理' : '运营商'}</div>
          </div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <h2 id="topbar-title"></h2>
          <div class="right">
            <span class="muted">${esc(state.user.company || '')}</span>
            <button class="btn btn-ghost btn-sm" onclick="logout()">退出登录</button>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.onclick = () => { location.hash = el.dataset.route; };
  });
  route();
}

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split('/')[0];
  return r || defaultRoute();
}

function setTitle(t) { $('#topbar-title').textContent = t; }

async function route() {
  if (!state.user) return renderLogin();
  const nav = NAV[state.user.role];
  const id = currentRoute();
  const item = nav.find((n) => n.id === id);
  const target = item ? item : nav[0];
  if (item !== target) location.hash = target.id;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === target.id);
  });
  setTitle(target.title);
  await target.view();
}

window.addEventListener('hashchange', () => { if (state.user) route(); });

// ================= 问题/特征下拉多选组件 =================
function problemDropdownHTML() {
  return `
    <div class="select-dropdown" id="problem-dd">
      <div class="trigger" id="problem-dd-trigger" data-stop>
        <span id="problem-tags"></span>
        <span class="arrow">▾</span>
      </div>
      <div class="panel" id="problem-panel" data-stop></div>
    </div>`;
}

function initProblemDropdown({ selected = new Set(), onChange }) {
  const root = $('#problem-dd');
  const trigger = $('#problem-dd-trigger');
  const panel = $('#problem-panel');
  const tagsEl = $('#problem-tags');

  function renderPanel() {
    if (!state.problems.length) {
      panel.innerHTML = '<div class="opt-empty">暂无可用的问题/特征选项，请联系管理员维护</div>';
      return;
    }
    panel.innerHTML = state.problems.map((p) => `
      <label class="option">
        <input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
        <span class="tag ${tagColor(p.name)}">${esc(p.name)}</span>
      </label>`).join('');
    panel.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = () => {
        const id = Number(cb.value);
        if (cb.checked) selected.add(id); else selected.delete(id);
        renderTags(); onChange && onChange(selected);
      };
    });
  }

  function renderTags() {
    const items = state.problems.filter((p) => selected.has(p.id));
    tagsEl.innerHTML = items.length
      ? items.map((p) => `<span class="tag ${tagColor(p.name)}">${esc(p.name)}</span>`).join('')
      : '<span class="placeholder">请选择问题/特征类型（可多选）</span>';
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    root.classList.toggle('open');
    if (root.classList.contains('open')) renderPanel();
  };
  document.addEventListener('click', () => root.classList.remove('open'));

  renderTags();
}

// ================= 司机表单（新增/编辑共用） =================
function driverFormHTML(driver) {
  const sel = new Set((driver?.problems || []).map((p) => p.id));
  return `
    <div class="grid-2">
      <div class="form-item">
        <label class="required">司机姓名</label>
        <input class="input" id="f-name" value="${esc(driver?.name || '')}" placeholder="请输入司机姓名">
      </div>
      <div class="form-item">
        <label class="required">身份证号</label>
        <input class="input" id="f-idcard" value="${esc(driver?.id_card || '')}" placeholder="请输入身份证号">
        <div class="hint" id="f-idcard-hint"></div>
      </div>
      <div class="form-item">
        <label>联系电话</label>
        <input class="input" id="f-phone" value="${esc(driver?.phone || '')}" placeholder="选填">
      </div>
      <div class="form-item">
        <label>驾驶证准驾车型</label>
        <input class="input" id="f-license" value="${esc(driver?.license_no || '')}" placeholder="如 A2 / B2，选填">
      </div>
    </div>
    <div class="form-item">
      <label class="required">具体问题 / 特征类型（下拉菜单，可多选）</label>
      ${problemDropdownHTML()}
    </div>
    <div class="form-item">
      <label>具体问题说明</label>
      <textarea class="input" id="f-desc" placeholder="请说明司机的具体问题，如事故、拖欠租金、失联等经过">${esc(driver?.issue_desc || '')}</textarea>
    </div>
    <div class="form-item">
      <label>司机特征描述</label>
      <textarea class="input" id="f-features" placeholder="请描述司机特征，便于放车时识别，如驾驶习惯、常用车型等">${esc(driver?.features || '')}</textarea>
    </div>`;
}

function bindDriverForm({ selected = new Set(), onChange, checkDup = true }) {
  initProblemDropdown({ selected, onChange });
  const ic = $('#f-idcard');
  if (checkDup) {
    ic.addEventListener('blur', async () => {
      const v = ic.value.trim();
      const hint = $('#f-idcard-hint');
      if (!/^[0-9Xx]{15,18}$/.test(v)) { hint.textContent = ''; return; }
      try {
        const d = await api('/api/drivers/query?id_card=' + encodeURIComponent(v));
        if (d.drivers.length) {
          hint.innerHTML = `<span style="color:#dc2626">⚠ 该身份证已有 ${d.drivers.length} 条黑名单记录（来自 ${d.drivers.map((x) => esc(x.operator_company)).join('、')}）</span>`;
        } else {
          hint.textContent = '✓ 未查到已有记录';
          hint.style.color = '#16a34a';
        }
      } catch (e) { /* ignore */ }
    });
  }
}

function readDriverForm() {
  const problemIds = [...$('#problem-dd').querySelectorAll('input:checked')].map((i) => Number(i.value));
  return {
    name: $('#f-name').value.trim(),
    id_card: $('#f-idcard').value.trim(),
    phone: $('#f-phone').value.trim(),
    license_no: $('#f-license').value.trim(),
    problemIds,
    issue_desc: $('#f-desc').value.trim(),
    features: $('#f-features').value.trim(),
  };
}

function validateDriver(d) {
  if (!d.name) return '请输入司机姓名';
  if (!/^[0-9Xx]{15,18}$/.test(d.id_card)) return '身份证号格式不正确（15/18位）';
  if (!d.problemIds.length) return '请至少选择一个问题/特征类型';
  return null;
}

// ================= 新增司机 =================
async function renderAddDriver() {
  if (!state.problems.length) await loadProblems();
  $('#content').innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="card-title">🚚 新增司机（提交黑名单信息）</div>
      <div class="alert alert-info">提交后该司机将被纳入黑名单库，新开户运营商放车前可通过 <b>姓名</b> 或 <b>身份证号</b> 查询到。</div>
      <div id="add-form">${driverFormHTML(null)}</div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn btn-primary" id="btn-submit">提交司机信息</button>
        <button class="btn btn-ghost" onclick="location.hash='my'">返回列表</button>
      </div>
    </div>`;

  bindDriverForm({ selected: new Set() });

  $('#btn-submit').onclick = async () => {
    const d = readDriverForm();
    const err = validateDriver(d);
    if (err) return toast(err, 'warning');
    const btn = $('#btn-submit');
    btn.disabled = true; btn.textContent = '提交中...';
    try {
      const data = await api('/api/drivers', 'POST', d);
      toast('司机信息已提交成功', 'success');
      if (data.duplicate) {
        toast(`提示：该身份证已由 ${data.duplicate.name} 所在运营商提交过记录`, 'warning');
      }
      setTimeout(() => { location.hash = 'my'; }, 600);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = '提交司机信息';
    }
  };
}

// ================= 我的司机（运营商）/ 全部司机（经理） =================
function driverTableHTML(drivers, { showOperator = false, actions = true }) {
  if (!drivers.length) {
    return `<div class="empty"><div class="big">🗂️</div>暂无司机数据</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>姓名</th><th>身份证号</th><th>电话</th>
          ${showOperator ? '<th>维护运营商</th>' : ''}
          <th>问题/特征</th><th>录入时间</th><th style="width:150px">操作</th>
        </tr></thead>
        <tbody>
          ${drivers.map((d) => `
            <tr>
              <td><b>${esc(d.name)}</b></td>
              <td>${esc(maskIdCard(d.id_card))}</td>
              <td>${esc(d.phone || '-')}</td>
              ${showOperator ? `<td><span class="badge badge-op">${esc(d.operator_company || d.operator_name || '-')}</span></td>` : ''}
              <td>${problemTags(d.problems)}</td>
              <td class="muted">${esc(d.created_at || '')}</td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" data-view="${d.id}">详情</button>
                ${actions ? `<button class="btn btn-sm" style="background:var(--primary-light);color:var(--primary-dark)" data-edit="${d.id}">编辑</button>
                <button class="btn btn-danger btn-sm" data-del="${d.id}">删除</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderMyDrivers() {
  $('#content').innerHTML = `<div class="card"><div class="card-title">我的司机</div><div id="list-loading" class="empty">加载中...</div></div>`;
  const d = await api('/api/drivers/mine');
  const rows = d.drivers;
  $('#content').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${rows.length}</div><div class="lbl">我维护的司机总数</div></div>
      <div class="stat-card"><div class="num">${new Set(rows.flatMap((r) => r.problems.map((p) => p.name))).size}</div><div class="lbl">涉及问题类型数</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="input" id="mine-search" placeholder="按姓名 / 身份证筛选" style="width:260px">
        <span class="spacer"></span>
        <button class="btn btn-primary" onclick="location.hash='add'">＋ 新增司机</button>
      </div>
      <div id="mine-table">${driverTableHTML(rows)}</div>
    </div>`;

  $('#mine-search').oninput = (e) => {
    const k = e.target.value.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      r.name.toLowerCase().includes(k) || r.id_card.includes(k) || (r.phone || '').includes(k)
    );
    $('#mine-table').innerHTML = driverTableHTML(filtered);
  };
  bindTableActions('#mine-table', rows);
}

async function renderAllDrivers() {
  $('#content').innerHTML = `<div class="card"><div class="card-title">全部司机</div><div class="empty">加载中...</div></div>`;
  let users = [];
  try { users = (await api('/api/users')).users; } catch (e) { /* ignore */ }
  const d = await api('/api/drivers');
  const rows = d.drivers;
  const ops = users.filter((u) => u.role === 'operator');

  $('#content').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${rows.length}</div><div class="lbl">黑名单司机总数</div></div>
      <div class="stat-card"><div class="num">${ops.length}</div><div class="lbl">运营商数量</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="input" id="all-name" placeholder="姓名" style="width:140px">
        <input class="input" id="all-idcard" placeholder="身份证号" style="width:200px">
        <select class="input" id="all-operator" style="width:180px">
          <option value="">全部运营商</option>
          ${ops.map((u) => `<option value="${u.id}">${esc(u.company || u.display_name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="all-search">查询</button>
        <button class="btn btn-ghost" id="all-reset">重置</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" onclick="location.hash='add'">＋ 新增司机</button>
      </div>
      <div id="all-table">${driverTableHTML(rows, { showOperator: true })}</div>
    </div>`;

  const doSearch = async () => {
    const qs = new URLSearchParams();
    const n = $('#all-name').value.trim();
    const ic = $('#all-idcard').value.trim();
    const oid = $('#all-operator').value;
    if (n) qs.set('name', n);
    if (ic) qs.set('id_card', ic);
    if (oid) qs.set('operator_id', oid);
    const res = await api('/api/drivers?' + qs.toString());
    $('#all-table').innerHTML = driverTableHTML(res.drivers, { showOperator: true });
    bindTableActions('#all-table', res.drivers);
  };
  $('#all-search').onclick = doSearch;
  $('#all-reset').onclick = () => {
    $('#all-name').value = ''; $('#all-idcard').value = ''; $('#all-operator').value = '';
    doSearch();
  };
  bindTableActions('#all-table', rows);
}

function bindTableActions(selector, rows) {
  const table = $(selector);
  if (!table) return;
  table.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.view || btn.dataset.edit || btn.dataset.del);
    const d = rows.find((r) => r.id === id);
    if (btn.dataset.view) return openDriverDetail(d || await api(`/api/drivers/${id}`).then((x) => x.driver));
    if (btn.dataset.edit) return openDriverEdit(d);
    if (btn.dataset.del) {
      if (!confirm(`确定删除司机「${d.name}」的黑名单记录吗？删除后不可恢复。`)) return;
      try {
        await api(`/api/drivers/${id}`, 'DELETE');
        toast('已删除', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

// ---------- 司机详情 ----------
function openDriverDetail(d) {
  openModal(`
    <div class="modal-head"><h3>司机详情</h3><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div class="detail-grid">
        <div class="detail-item"><div class="k">姓名</div><div class="v">${esc(d.name)}</div></div>
        <div class="detail-item"><div class="k">身份证号</div><div class="v">${esc(d.id_card)}</div></div>
        <div class="detail-item"><div class="k">联系电话</div><div class="v">${esc(d.phone || '-')}</div></div>
        <div class="detail-item"><div class="k">驾驶证准驾车型</div><div class="v">${esc(d.license_no || '-')}</div></div>
        <div class="detail-item"><div class="k">维护运营商</div><div class="v">${esc(d.operator_company || d.operator_name || '-')}</div></div>
        <div class="detail-item"><div class="k">录入时间</div><div class="v">${esc(d.created_at || '-')}</div></div>
        <div class="detail-item full"><div class="k">问题 / 特征类型</div><div class="v">${problemTags(d.problems) || '<span class="muted">无</span>'}</div></div>
        <div class="detail-item full"><div class="k">具体问题说明</div><div class="v">${esc(d.issue_desc || '无')}</div></div>
        <div class="detail-item full"><div class="k">司机特征描述</div><div class="v">${esc(d.features || '无')}</div></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">关闭</button></div>`, true);
}

// ---------- 编辑司机 ----------
async function openDriverEdit(d) {
  if (!state.problems.length) await loadProblems();
  openModal(`
    <div class="modal-head"><h3>编辑司机信息</h3><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div id="edit-form">${driverFormHTML(d)}</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save">保存修改</button>
    </div>`, true);

  bindDriverForm({ selected: new Set((d.problems || []).map((p) => p.id)), checkDup: false });

  $('#btn-save').onclick = async () => {
    const v = readDriverForm();
    const err = validateDriver(v);
    if (err) return toast(err, 'warning');
    try {
      await api(`/api/drivers/${d.id}`, 'PUT', v);
      toast('保存成功', 'success');
      closeModal();
      route();
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ================= 司机查询（按姓名/身份证） =================
async function renderQuery() {
  $('#content').innerHTML = `
    <div class="card" style="max-width:960px">
      <div class="card-title">🔍 司机查询（放车前核实）</div>
      <div class="alert alert-info">输入 <b>姓名</b> 或 <b>身份证号</b>（至少一项）查询黑名单库中<b>全部运营商</b>提交的司机信息。</div>
      <div class="toolbar">
        <input class="input" id="q-name" placeholder="司机姓名" style="width:160px">
        <input class="input" id="q-idcard" placeholder="身份证号（精确匹配）" style="width:220px">
        <button class="btn btn-primary" id="q-search">查询</button>
        <button class="btn btn-ghost" id="q-reset">清空</button>
      </div>
      <div id="q-result"></div>
    </div>`;

  const doSearch = async () => {
    const name = $('#q-name').value.trim();
    const id_card = $('#q-idcard').value.trim();
    if (!name && !id_card) return toast('请至少输入姓名或身份证号之一', 'warning');
    const qs = new URLSearchParams();
    if (name) qs.set('name', name);
    if (id_card) qs.set('id_card', id_card);
    $('#q-result').innerHTML = '<div class="empty">查询中...</div>';
    try {
      const d = await api('/api/drivers/query?' + qs.toString());
      const rows = d.drivers;
      if (!rows.length) {
        $('#q-result').innerHTML = `<div class="empty"><div class="big">✅</div><b>未查询到违规记录</b><div class="muted">可以正常放车，但仍建议关注司机日常表现</div></div>`;
        return;
      }
      $('#q-result').innerHTML = `
        <div class="alert alert-warn">共查询到 <b>${rows.length}</b> 条违规记录，请谨慎放车！</div>
        ${driverTableHTML(rows, { showOperator: true, actions: false })}`;
      bindTableActions('#q-result', rows);
    } catch (e) { $('#q-result').innerHTML = ''; toast(e.message, 'error'); }
  };

  $('#q-search').onclick = doSearch;
  $('#q-reset').onclick = () => { $('#q-name').value = ''; $('#q-idcard').value = ''; $('#q-result').innerHTML = ''; };
  $('#q-name').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
  $('#q-idcard').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
}

// ================= 问题字典（运营商只读） =================
async function renderDictView() {
  if (!state.problems.length) await loadProblems();
  $('#content').innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="card-title">📖 司机问题 / 特征字典</div>
      <div class="alert alert-info">以下为提交司机信息时的<b>下拉菜单选项</b>，由系统管理员维护。如需新增选项请联系管理员。</div>
      <div class="table-wrap"><table>
        <thead><tr><th style="width:60px">序号</th><th>问题 / 特征名称</th></tr></thead>
        <tbody>${state.problems.map((p, i) => `
          <tr><td>${i + 1}</td><td><span class="tag ${tagColor(p.name)}">${esc(p.name)}</span></td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}

// ================= 问题字典维护（经理） =================
async function renderDictManage() {
  $('#content').innerHTML = `
    <div class="card" style="max-width:820px">
      <div class="card-title">📖 司机问题 / 特征字典维护（下拉菜单选项）</div>
      <div class="alert alert-info">此字典将作为司机提交表单中<b>“具体问题/特征类型”下拉菜单</b>的选项，可新增、编辑、停用、排序。</div>
      <div class="toolbar">
        <input class="input" id="dict-name" placeholder="新增问题/特征名称，如：有酒驾记录" style="width:320px">
        <button class="btn btn-primary" id="dict-add">＋ 添加</button>
      </div>
      <div id="dict-list"><div class="empty">加载中...</div></div>
    </div>`;

  const load = async () => {
    const d = await api('/api/problems/manage');
    const rows = d.problems;
    const activeCount = rows.filter((p) => p.is_active).length;
    $('#dict-list').innerHTML = `
      <div class="muted" style="margin-bottom:10px">共 ${rows.length} 项，启用 ${activeCount} 项 / 停用 ${rows.length - activeCount} 项</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:50px">排序</th><th>名称</th><th style="width:80px">状态</th>
          <th style="width:190px">操作</th>
        </tr></thead>
        <tbody>${rows.map((p, i) => `
          <tr>
            <td>
              <button class="btn btn-sm" style="padding:3px 8px" data-move="${p.id}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-sm" style="padding:3px 8px" data-move="${p.id}" data-dir="down" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>
            </td>
            <td><span class="tag ${tagColor(p.name)}">${esc(p.name)}</span></td>
            <td>${p.is_active ? '<span class="badge badge-op">启用</span>' : '<span class="badge badge-off">停用</span>'}</td>
            <td class="actions">
              <button class="btn btn-sm" style="background:var(--primary-light);color:var(--primary-dark)" data-edit="${p.id}">编辑</button>
              <button class="btn btn-sm" data-toggle="${p.id}">${p.is_active ? '停用' : '启用'}</button>
              <button class="btn btn-danger btn-sm" data-del="${p.id}">删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    $('#dict-list').onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = Number(btn.dataset.move || btn.dataset.edit || btn.dataset.toggle || btn.dataset.del);
      if (btn.dataset.move) {
        await api(`/api/problems/${id}/move?dir=${btn.dataset.dir}`, 'POST');
        return load();
      }
      if (btn.dataset.edit) {
        const p = rows.find((r) => r.id === id);
        const name = prompt('修改问题/特征名称：', p.name);
        if (name && name.trim() && name.trim() !== p.name) {
          try { await api(`/api/problems/${id}`, 'PUT', { name: name.trim() }); toast('已更新', 'success'); load(); }
          catch (err) { toast(err.message, 'error'); }
        }
        return;
      }
      if (btn.dataset.toggle) {
        const p = rows.find((r) => r.id === id);
        await api(`/api/problems/${id}`, 'PUT', { is_active: !p.is_active });
        toast(p.is_active ? '已停用' : '已启用', 'success');
        return load();
      }
      if (btn.dataset.del) {
        if (!confirm('确定删除该问题/特征？关联的司机记录将同步移除该标签。')) return;
        await api(`/api/problems/${id}`, 'DELETE');
        toast('已删除', 'success');
        load();
      }
    };
  };

  $('#dict-add').onclick = async () => {
    const name = $('#dict-name').value.trim();
    if (!name) return toast('请输入问题/特征名称', 'warning');
    try {
      await api('/api/problems', 'POST', { name });
      $('#dict-name').value = '';
      toast('已添加', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#dict-name').addEventListener('keydown', (e) => e.key === 'Enter' && $('#dict-add').click());

  load();
}

// ================= 运营商账号管理（经理） =================
async function renderUsers() {
  const d = await api('/api/users');
  const rows = d.users;
  $('#content').innerHTML = `
    <div class="card" style="max-width:900px">
      <div class="toolbar">
        <div class="card-title" style="margin:0">👥 运营商账号管理</div>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="add-user">＋ 新增账号</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>用户名</th><th>名称</th><th>所属单位</th><th>角色</th><th>状态</th><th style="width:150px">操作</th>
        </tr></thead>
        <tbody>${rows.map((u) => `
          <tr>
            <td><b>${esc(u.username)}</b></td>
            <td>${esc(u.display_name)}</td>
            <td>${esc(u.company || '-')}</td>
            <td>${u.role === 'manager' ? '<span class="badge badge-mgr">经理</span>' : '<span class="badge badge-op">运营商</span>'}</td>
            <td>${u.is_active ? '<span class="badge badge-op">正常</span>' : '<span class="badge badge-off">停用</span>'}</td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" data-edit="${u.id}">编辑</button>
              ${u.role === 'operator' ? `<button class="btn btn-danger btn-sm" data-del="${u.id}">删除</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  $('#add-user').onclick = () => openUserModal(null);
  $('#content').onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.edit) { const u = rows.find((r) => r.id === Number(btn.dataset.edit)); openUserModal(u); }
    if (btn.dataset.del) {
      const u = rows.find((r) => r.id === Number(btn.dataset.del));
      if (!confirm(`确定删除账号「${u.username}」吗？该运营商维护的司机数据将同时被删除。`)) return;
      api(`/api/users/${u.id}`, 'DELETE').then(() => { toast('已删除', 'success'); renderUsers(); }).catch((err) => toast(err.message, 'error'));
    }
  };
}

function openUserModal(user) {
  openModal(`
    <div class="modal-head"><h3>${user ? '编辑账号' : '新增账号'}</h3><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div class="grid-2">
        <div class="form-item">
          <label class="required">用户名</label>
          <input class="input" id="u-username" value="${esc(user?.username || '')}" ${user ? 'disabled' : ''} placeholder="2-20位字母/数字/下划线">
        </div>
        <div class="form-item">
          <label>${user ? '重置密码' : '密码'}${user ? '' : '<span style="color:#dc2626"> *</span>'}</label>
          <input class="input" id="u-password" type="password" placeholder="${user ? '留空则不修改' : '至少6位'}">
        </div>
        <div class="form-item">
          <label class="required">显示名称</label>
          <input class="input" id="u-name" value="${esc(user?.display_name || '')}" placeholder="如：西南运营中心">
        </div>
        <div class="form-item">
          <label>所属单位</label>
          <input class="input" id="u-company" value="${esc(user?.company || '')}" placeholder="选填">
        </div>
        <div class="form-item">
          <label class="required">角色</label>
          <select class="input" id="u-role">
            <option value="operator" ${user?.role === 'operator' ? 'selected' : ''}>运营商</option>
            <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>经理</option>
          </select>
        </div>
        ${user ? `<div class="form-item">
          <label>状态</label>
          <select class="input" id="u-active">
            <option value="1" ${user.is_active ? 'selected' : ''}>正常</option>
            <option value="0" ${!user.is_active ? 'selected' : ''}>停用</option>
          </select>
        </div>` : ''}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="u-save">保存</button>
    </div>`);

  $('#u-save').onclick = async () => {
    const payload = {
      username: $('#u-username').value.trim(),
      password: $('#u-password').value,
      display_name: $('#u-name').value.trim(),
      company: $('#u-company').value.trim(),
      role: $('#u-role').value,
    };
    if (user) {
      payload.is_active = $('#u-active').value === '1';
      if (!payload.password) delete payload.password;
      delete payload.username;
      try { await api(`/api/users/${user.id}`, 'PUT', payload); toast('已保存', 'success'); closeModal(); renderUsers(); }
      catch (e) { toast(e.message, 'error'); }
    } else {
      try { await api('/api/users', 'POST', payload); toast('账号已创建', 'success'); closeModal(); renderUsers(); }
      catch (e) { toast(e.message, 'error'); }
    }
  };
}

// ================= 启动 =================
(async function init() {
  if (state.token) {
    try {
      const d = await api('/api/me');
      state.user = d.user;
      await loadProblems();
    } catch (e) { /* token 无效则回到登录 */ }
  }
  if (state.user) renderApp();
  else renderLogin();
})();

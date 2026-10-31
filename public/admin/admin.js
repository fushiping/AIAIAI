import { api, appPath, escapeHtml, formatBytes } from '../assets/api.js';

const viewMeta = {
  dashboard: { title: '工作台', subtitle: '查看站点运营数据与待处理事项', permission: 'analytics' },
  analytics: { title: '数据统计', subtitle: '分析项目访问、软件下载与资料下载表现', permission: 'analytics' },
  projects: { title: '项目管理', subtitle: '维护项目内容、上下架状态与可下载文件', permission: 'projects' },
  categories: { title: '分类管理', subtitle: '配置前台项目分类与展示顺序', permission: 'categories' },
  inquiries: { title: '咨询留言', subtitle: '查看访客合作需求并记录跟进结果', permission: 'inquiries' },
  settings: { title: '内容与设置', subtitle: '更新首页文案、站点信息与下载规则', permission: 'settings' },
  admins: { title: '管理员账号', subtitle: '创建子管理员并分配后台操作权限', permission: 'admins' }
};

const permissionLabels = {
  projects: '项目管理',
  categories: '分类管理',
  analytics: '数据统计',
  inquiries: '咨询留言',
  settings: '内容设置',
  admins: '账号管理'
};

const statusLabels = {
  new: '新留言',
  processing: '跟进中',
  done: '已处理'
};

const state = {
  user: null,
  currentView: '',
  renderToken: 0,
  overview: null,
  projects: [],
  categories: [],
  inquiries: [],
  settings: null,
  contentSchema: null,
  featuredProjectOptions: null,
  analyticsRange: '30',
  settingsTab: 'content',
  fileProject: null,
  editingProjectId: null,
  projectCoverUrl: '',
  confirmCallback: null,
  promptCallback: null,
  inquiryId: null
};

const filters = {
  projects: { search: '', categoryId: '', status: '', sort: 'sort_desc' },
  inquiries: { search: '', status: '', read: '' }
};

function byId(id) {
  return document.getElementById(id);
}

function hasPermission(permission) {
  return Boolean(state.user?.isSuper || state.user?.permissions?.includes(permission));
}

function adminToast(message, type = 'default', duration = 3600) {
  const region = byId('adminToastRegion');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `admin-toast ${type}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => {
    item.classList.add('leaving');
    window.setTimeout(() => item.remove(), 220);
  }, duration);
}

async function adminApi(url, options = {}) {
  try {
    return await api(url, options);
  } catch (error) {
    if (error.status === 401 && state.user) {
      showLogin('登录状态已失效，请重新登录');
    }
    throw error;
  }
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value ?? '');
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatDateShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function setButtonBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  const label = button.querySelector('.button-label');
  const loading = button.querySelector('.button-loading');
  if (label) label.hidden = busy;
  if (loading) loading.hidden = !busy;
}

function updateModalLock() {
  const open = [...document.querySelectorAll('dialog')].some((dialog) => dialog.open);
  document.body.classList.toggle('modal-open', open);
}

function closeDialog(id) {
  const dialog = byId(id);
  if (dialog?.open) dialog.close();
}

function confirmAction({ title, text, confirmLabel = '确认删除', callback }) {
  setText('confirmDialogTitle', title);
  setText('confirmDialogText', text);
  setText('confirmActionButton', confirmLabel);
  state.confirmCallback = callback;
  byId('confirmDialog').showModal();
  updateModalLock();
}

function promptAction({ title, label, value, confirmLabel = '确认修改', maxLength = 180, callback }) {
  const form = byId('promptForm');
  form.reset();
  setText('promptDialogTitle', title);
  setText('promptDialogLabel', label);
  form.elements.value.maxLength = maxLength;
  form.elements.value.value = value || '';
  form.querySelector('button[type="submit"]').textContent = confirmLabel;
  state.promptCallback = callback;
  byId('promptDialog').showModal();
  updateModalLock();
  window.setTimeout(() => {
    form.elements.value.focus();
    form.elements.value.select();
  }, 80);
}

async function initialize() {
  updateTopbarDate();
  bindGlobalEvents();
  try {
    const response = await api('/api/admin/auth/me');
    showApp(response.data.user);
  } catch (error) {
    showLogin();
  } finally {
    window.setTimeout(() => {
      byId('pageLoader')?.classList.add('done');
      window.setTimeout(() => byId('pageLoader')?.remove(), 300);
    }, 120);
  }
}

function updateTopbarDate() {
  setText('topbarDate', new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).format(new Date()));
}

function showLogin(message = '') {
  state.user = null;
  closeAllDialogs();
  byId('adminApp').hidden = true;
  byId('loginScreen').hidden = false;
  byId('loginForm').reset();
  const error = byId('loginError');
  error.hidden = !message;
  error.textContent = message;
  window.setTimeout(() => byId('loginForm').elements.username.focus(), 100);
}

function showApp(user) {
  state.user = user;
  byId('loginScreen').hidden = true;
  byId('adminApp').hidden = false;
  updateUserInterface();
  updatePermissionNavigation();
  const requested = routeFromHash();
  const target = canAccessView(requested) ? requested : firstAllowedView();
  renderView(target, false);
}

function updateUserInterface() {
  if (!state.user) return;
  const initial = (state.user.displayName || state.user.username || '管').slice(0, 1);
  setText('sidebarAvatar', initial);
  setText('sidebarUserName', state.user.displayName);
  setText('sidebarUserRole', state.user.isSuper ? '超级管理员' : '子管理员');
}

function updatePermissionNavigation() {
  document.querySelectorAll('.admin-nav-item[data-permission]').forEach((button) => {
    const permission = button.dataset.permission;
    button.hidden = permission === 'admins' ? !state.user.isSuper : !hasPermission(permission);
  });
}

function canAccessView(view) {
  const meta = viewMeta[view];
  if (!meta) return false;
  if (meta.permission === 'admins') return state.user.isSuper;
  return hasPermission(meta.permission);
}

function firstAllowedView() {
  return ['dashboard', 'projects', 'categories', 'inquiries', 'analytics', 'settings', 'admins']
    .find(canAccessView) || 'dashboard';
}

function routeFromHash() {
  return window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
}

function renderView(view, updateHash = true) {
  if (!state.user) return;
  if (!canAccessView(view)) {
    view = firstAllowedView();
  }
  state.currentView = view;
  if (updateHash && window.location.hash !== `#/${view}`) {
    history.replaceState(null, '', `#/${view}`);
  }
  const meta = viewMeta[view];
  setText('viewTitle', meta.title);
  setText('viewSubtitle', meta.subtitle);
  document.title = `${meta.title}｜傅先生AI项目VIP运营管理`;
  document.querySelectorAll('.admin-nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  closeMobileSidebar();
  renderCurrentView();
}

async function renderCurrentView(force = false) {
  if (!state.currentView) return;
  const token = ++state.renderToken;
  const root = byId('viewRoot');
  const refresh = byId('refreshViewButton');
  refresh?.classList.add('spinning');
  if (!force && root) {
    root.innerHTML = '<div class="content-loading"><span></span>正在加载数据...</div>';
  }
  try {
    switch (state.currentView) {
      case 'dashboard': await renderDashboard(token); break;
      case 'analytics': await renderAnalytics(token); break;
      case 'projects': await renderProjectsView(token); break;
      case 'categories': await renderCategoriesView(token); break;
      case 'inquiries': await renderInquiriesView(token); break;
      case 'settings': await renderSettingsView(token); break;
      case 'admins': await renderAdminsView(token); break;
      default: renderView(firstAllowedView());
    }
  } catch (error) {
    if (token !== state.renderToken) return;
    root.innerHTML = `
      <div class="data-panel">
        <div class="table-empty">
          <div>
            <p>${escapeHtml(error.message || '页面加载失败')}</p>
            <button class="secondary-button" type="button" data-retry-view>重新加载</button>
          </div>
        </div>
      </div>
    `;
    root.querySelector('[data-retry-view]')?.addEventListener('click', () => renderCurrentView());
  } finally {
    if (token === state.renderToken) refresh?.classList.remove('spinning');
  }
}

function bindGlobalEvents() {
  byId('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = byId('loginError');
    errorBox.hidden = true;
    setButtonBusy(form, true);
    try {
      const response = await api('/api/admin/auth/login', {
        method: 'POST',
        body: {
          username: form.elements.username.value,
          password: form.elements.password.value
        }
      });
      showApp(response.data.user);
    } catch (error) {
      errorBox.textContent = error.message || '登录失败，请检查账号和密码';
      errorBox.hidden = false;
    } finally {
      setButtonBusy(form, false);
    }
  });

  byId('toggleLoginPassword').addEventListener('click', () => {
    const input = byId('loginForm').elements.password;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  byId('adminNav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button && !button.hidden) renderView(button.dataset.view);
  });

  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    const view = routeFromHash();
    if (view !== state.currentView) renderView(view, false);
  });

  byId('refreshViewButton').addEventListener('click', () => renderCurrentView());

  byId('mobileSidebarButton').addEventListener('click', openMobileSidebar);
  byId('sidebarOverlay').addEventListener('click', closeMobileSidebar);

  byId('userMenuButton').addEventListener('click', (event) => {
    event.stopPropagation();
    const popover = byId('userPopover');
    const open = !popover.hidden;
    popover.hidden = open;
    byId('userMenuButton').setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.sidebar-user')) {
      byId('userPopover').hidden = true;
      byId('userMenuButton').setAttribute('aria-expanded', 'false');
    }
  });

  byId('openPasswordButton').addEventListener('click', () => {
    byId('passwordForm').reset();
    byId('passwordDialog').showModal();
    byId('userPopover').hidden = true;
    updateModalLock();
  });

  byId('logoutButton').addEventListener('click', async () => {
    byId('userPopover').hidden = true;
    try {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } catch {
      // 无论服务端返回如何，前端会话界面都应退出。
    }
    showLogin('已安全退出管理后台');
  });

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
  });

  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', updateModalLock);
  });

  byId('confirmCancelButton').addEventListener('click', () => {
    state.confirmCallback = null;
    closeDialog('confirmDialog');
  });
  byId('confirmActionButton').addEventListener('click', async () => {
    const callback = state.confirmCallback;
    state.confirmCallback = null;
    closeDialog('confirmDialog');
    if (callback) await callback();
  });

  byId('promptForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const callback = state.promptCallback;
    const value = event.currentTarget.elements.value.value.trim();
    if (!value) return;
    state.promptCallback = null;
    closeDialog('promptDialog');
    if (callback) await callback(value);
  });

  bindProjectFormEvents();
  bindFileManagerEvents();
  bindCategoryFormEvents();
  bindInquiryFormEvents();
  bindAdminFormEvents();
  bindPasswordFormEvents();
}

function openMobileSidebar() {
  byId('adminSidebar').classList.add('open');
  byId('sidebarOverlay').classList.add('open');
}

function closeMobileSidebar() {
  byId('adminSidebar').classList.remove('open');
  byId('sidebarOverlay').classList.remove('open');
}

function closeAllDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  updateModalLock();
}

async function renderDashboard(token) {
  const response = await adminApi('/api/admin/overview?range=30');
  if (token !== state.renderToken) return;
  const data = response.data;
  state.overview = data;
  updateInquiryBadge(data.summary.unreadInquiries);
  const root = byId('viewRoot');
  root.innerHTML = `
    <section class="welcome-strip">
      <div class="welcome-copy">
        <span>OPERATIONS OVERVIEW</span>
        <h2>${greeting()}，${escapeHtml(state.user.displayName)}</h2>
        <p>这里是站点近 30 天的运营概况，及时处理合作线索会让项目阵地更有效。</p>
      </div>
      <div class="welcome-actions">
        ${hasPermission('projects') ? `
          <button type="button" data-dashboard-action="new-project">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            新增项目
          </button>
        ` : ''}
        ${hasPermission('inquiries') ? `
          <button type="button" data-dashboard-action="inquiries">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4V5Z"/></svg>
            处理留言
          </button>
        ` : ''}
        <a href="../" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></svg>
          查看前台
        </a>
      </div>
    </section>

    <div class="stats-grid">
      ${statCard('累计访问', data.summary.visits, '近 30 天站点访问次数', 'eye', '')}
      ${statCard('文件下载', data.summary.downloads, `软件 ${data.summary.softwareDownloads} · 资料 ${data.summary.documentDownloads}`, 'download', 'gold')}
      ${statCard('合作咨询', data.summary.inquiries, `${data.summary.unreadInquiries} 条未读留言`, 'message', 'green')}
      ${statCard('已上架项目', data.summary.publishedProjects, '当前前台可见项目', 'folder', 'amber')}
    </div>

    <div class="overview-main-grid">
      <section class="data-panel chart-panel">
        <div class="panel-heading">
          <div><h3>访问与下载趋势</h3><p>近 30 天数据变化</p></div>
          <div class="chart-legend"><span><i></i>访问</span><span><i></i>下载</span></div>
        </div>
        ${chartMarkup(data.trend)}
      </section>
      <section class="data-panel">
        <div class="panel-heading">
          <div><h3>项目关注排行</h3><p>按访问量排序</p></div>
          ${hasPermission('analytics') ? '<button class="panel-link" type="button" data-go-view="analytics">数据详情 <svg viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4"/></svg></button>' : ''}
        </div>
        <div class="top-projects-list">
          ${data.topProjects.length ? data.topProjects.map((project, index) => `
            <div class="top-project-item">
              <span class="top-project-index">${String(index + 1).padStart(2, '0')}</span>
              <div><h4>${escapeHtml(project.name)}</h4><p>${project.downloads} 次文件下载</p></div>
              <span class="top-project-number">${project.views}</span>
            </div>
          `).join('') : '<div class="table-empty compact">暂无项目访问数据</div>'}
        </div>
      </section>
    </div>

    <section class="data-panel">
      <div class="panel-heading">
        <div><h3>最新合作咨询</h3><p>优先处理未读留言</p></div>
        ${hasPermission('inquiries') ? '<button class="panel-link" type="button" data-go-view="inquiries">全部留言 <svg viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4"/></svg></button>' : ''}
      </div>
      ${hasPermission('inquiries') ? `
        <div class="recent-table-wrap">
          ${data.recentInquiries.length ? `
            <table class="admin-table">
              <thead><tr><th>访客</th><th>联系方式</th><th>意向项目</th><th>状态</th><th>提交时间</th><th></th></tr></thead>
              <tbody>
                ${data.recentInquiries.map((item) => `
                  <tr>
                    <td><div class="table-contact"><span class="table-avatar">${escapeHtml(item.name.slice(0, 1))}</span><div class="table-cell-stack"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.company || '个人 / 未填写公司')}</span></div></div></td>
                    <td>${escapeHtml(item.phone)}</td>
                    <td>${escapeHtml(item.projectName || '未指定项目')}</td>
                    <td><span class="status-pill ${item.status}">${statusLabels[item.status]}</span></td>
                    <td>${formatDateShort(item.createdAt)}</td>
                    <td><button class="action-link" type="button" data-open-inquiry="${item.id}">查看</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="table-empty">暂时还没有合作咨询</div>'}
        </div>
      ` : '<div class="table-empty">当前账号没有查看咨询留言的权限</div>'}
    </section>
  `;

  root.querySelector('[data-dashboard-action="new-project"]')?.addEventListener('click', () => openProjectEditor());
  root.querySelector('[data-dashboard-action="inquiries"]')?.addEventListener('click', () => renderView('inquiries'));
  root.querySelector('[data-go-view="analytics"]')?.addEventListener('click', () => renderView('analytics'));
  root.querySelector('[data-go-view="inquiries"]')?.addEventListener('click', () => renderView('inquiries'));
  root.querySelectorAll('[data-open-inquiry]').forEach((button) => {
    button.addEventListener('click', () => openInquiry(Number(button.dataset.openInquiry)));
  });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function statCard(label, value, detail, icon, tone) {
  const icons = {
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/>',
    message: '<path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 12.5h5"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3V6Z"/>'
  };
  return `
    <article class="stat-card">
      <div class="stat-card-head">
        <span class="stat-card-label">${escapeHtml(label)}</span>
        <span class="stat-icon ${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg></span>
      </div>
      <div class="stat-card-value">${Number(value || 0).toLocaleString('zh-CN')}</div>
      <div class="stat-card-foot"><span class="stat-detail">${escapeHtml(detail)}</span></div>
    </article>
  `;
}

function chartMarkup(trend, options = {}) {
  const data = trend || [];
  const max = Math.max(1, ...data.map((item) => Math.max(Number(item.visits || 0), Number(item.downloads || 0))));
  const labelEvery = data.length > 20 ? 5 : data.length > 10 ? 2 : 1;
  return `
    <div class="chart-wrap">
      <div class="chart-grid"><i></i><i></i><i></i><i></i></div>
      <div class="chart-bars" role="img" aria-label="${escapeHtml(options.label || '访问与下载趋势图')}">
        ${data.map((item, index) => {
          const visitsHeight = Math.max(1, (Number(item.visits || 0) / max) * 100);
          const downloadsHeight = Math.max(1, (Number(item.downloads || 0) / max) * 100);
          const label = String(item.day || '').slice(5).replace('-', '/');
          return `
            <div class="chart-day" title="${escapeHtml(item.day)}：访问 ${item.visits}，下载 ${item.downloads}">
              <div class="chart-bar-group">
                <i class="chart-bar" style="height:${visitsHeight.toFixed(2)}%"></i>
                <i class="chart-bar download" style="height:${downloadsHeight.toFixed(2)}%"></i>
              </div>
              <span>${index % labelEvery === 0 || index === data.length - 1 ? label : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function updateInquiryBadge(count) {
  const badge = byId('inquiryBadge');
  if (!badge) return;
  const number = Number(count || 0);
  badge.hidden = number <= 0 || !hasPermission('inquiries');
  badge.textContent = number > 99 ? '99+' : String(number);
}

async function renderAnalytics(token) {
  const range = state.analyticsRange;
  const [overviewResponse, projectsResponse] = await Promise.all([
    adminApi(`/api/admin/overview?range=${range}`),
    adminApi(`/api/admin/analytics/projects?range=${range}`)
  ]);
  if (token !== state.renderToken) return;
  const data = overviewResponse.data;
  const projectMetrics = projectsResponse.data;
  state.overview = data;
  updateInquiryBadge(data.summary.unreadInquiries);
  const root = byId('viewRoot');
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left">
        <div><h2>数据表现</h2><p>按时间范围查看站点与单项目表现</p></div>
      </div>
      <div class="range-tabs">
        ${rangeButton('7', '近 7 天')}
        ${rangeButton('30', '近 30 天')}
        ${rangeButton('90', '近 90 天')}
        ${rangeButton('all', '全部')}
      </div>
    </div>

    <div class="analytics-summary">
      ${miniMetric('站点访问', data.summary.visits, 'eye')}
      ${miniMetric('软件下载', data.summary.softwareDownloads, 'download')}
      ${miniMetric('资料下载', data.summary.documentDownloads, 'file')}
      ${miniMetric('合作咨询', data.summary.inquiries, 'message')}
    </div>

    <div class="analytics-chart-grid">
      <section class="data-panel chart-panel">
        <div class="panel-heading">
          <div><h3>访问与下载趋势</h3><p>${range === 'all' ? '总体汇总，趋势展示最近 30 天' : rangeDescription(range)}</p></div>
          <div class="chart-legend"><span><i></i>访问</span><span><i></i>下载</span></div>
        </div>
        ${chartMarkup(data.trend, { label: '访问与下载趋势' })}
      </section>
      <section class="data-panel">
        <div class="panel-heading"><div><h3>访问量 Top 5</h3><p>项目关注程度</p></div></div>
        <div class="top-projects-list">
          ${data.topProjects.length ? data.topProjects.map((project, index) => `
            <div class="top-project-item">
              <span class="top-project-index">${String(index + 1).padStart(2, '0')}</span>
              <div><h4>${escapeHtml(project.name)}</h4><p>${project.downloads} 次下载</p></div>
              <span class="top-project-number">${project.views}</span>
            </div>
          `).join('') : '<div class="table-empty compact">所选时间范围内暂无访问数据</div>'}
        </div>
      </section>
    </div>

    <section class="data-panel">
      <div class="panel-heading">
        <div><h3>单项目数据</h3><p>访问次数、软件下载量与资料下载量</p></div>
        <span class="muted-text">${range === 'all' ? '全部时间' : `统计周期：${rangeDescription(range)}`}</span>
      </div>
      <div class="recent-table-wrap">
        ${projectMetrics.length ? `
          <table class="admin-table">
            <thead><tr><th>项目名称</th><th>状态</th><th>访问次数</th><th>软件下载</th><th>资料下载</th><th>下载合计</th></tr></thead>
            <tbody>
              ${projectMetrics.map((project) => `
                <tr>
                  <td><strong>${escapeHtml(project.name)}</strong></td>
                  <td><span class="status-pill ${project.published ? 'published' : 'hidden'}">${project.published ? '已上架' : '已下架'}</span></td>
                  <td>${project.views.toLocaleString('zh-CN')}</td>
                  <td>${project.softwareDownloads.toLocaleString('zh-CN')}</td>
                  <td>${project.documentDownloads.toLocaleString('zh-CN')}</td>
                  <td><strong>${project.totalDownloads.toLocaleString('zh-CN')}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="table-empty">暂无项目数据</div>'}
      </div>
    </section>
  `;
  root.querySelectorAll('[data-analytics-range]').forEach((button) => {
    button.addEventListener('click', () => {
      state.analyticsRange = button.dataset.analyticsRange;
      renderCurrentView();
    });
  });
}

function rangeButton(value, label) {
  return `<button class="${state.analyticsRange === value ? 'active' : ''}" type="button" data-analytics-range="${value}">${label}</button>`;
}

function rangeDescription(range) {
  return `近 ${range} 天`;
}

function miniMetric(label, value, icon) {
  const icons = {
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/>',
    file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/>',
    message: '<path d="M4 5h16v12H9l-5 4V5Z"/>'
  };
  return `
    <div class="analytics-mini-card">
      <span><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg></span>
      <div><strong>${Number(value || 0).toLocaleString('zh-CN')}</strong><small>${label}</small></div>
    </div>
  `;
}

async function renderProjectsView(token) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters.projects)) {
    if (value) query.set(key, value);
  }
  const [projectsResponse, categoriesResponse] = await Promise.all([
    adminApi(`/api/admin/projects?${query}`),
    adminApi('/api/admin/categories').catch(() => ({ data: [] }))
  ]);
  if (token !== state.renderToken) return;
  state.projects = projectsResponse.data;
  if (categoriesResponse.data?.length) state.categories = categoriesResponse.data;
  const root = byId('viewRoot');
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left">
        <div><h2>全部项目</h2><p>共 ${state.projects.length} 个项目符合当前筛选</p></div>
      </div>
      <div class="view-toolbar-right">
        <button class="primary-button" type="button" id="newProjectButton">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          新增项目
        </button>
      </div>
    </div>
    <section class="data-panel">
      <div class="filter-bar">
        <form id="projectFilterForm">
          <label class="filter-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
            <input type="search" name="search" value="${escapeHtml(filters.projects.search)}" placeholder="搜索项目名称、简介或标签">
          </label>
          <select class="filter-select" name="categoryId">
            <option value="">全部分类</option>
            ${state.categories.map((category) => `<option value="${category.id}" ${String(filters.projects.categoryId) === String(category.id) ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
          </select>
          <select class="filter-select" name="status">
            ${selectOption('', '全部状态', filters.projects.status)}
            ${selectOption('published', '已上架', filters.projects.status)}
            ${selectOption('hidden', '已下架', filters.projects.status)}
          </select>
          <select class="filter-select" name="sort">
            ${selectOption('sort_desc', '排序权重', filters.projects.sort)}
            ${selectOption('updated_desc', '最近更新', filters.projects.sort)}
            ${selectOption('name_asc', '项目名称', filters.projects.sort)}
            ${selectOption('oldest', '创建最早', filters.projects.sort)}
          </select>
          <button class="filter-button" type="submit">筛选</button>
          <button class="filter-button" type="button" data-clear-project-filter>重置</button>
        </form>
        <span class="filter-result-text">更新后前台自动生效</span>
      </div>
      <div class="batch-bar" id="projectBatchBar" hidden>
        已选择 <strong id="projectSelectedCount">0</strong> 个项目
        <div class="batch-actions">
          <button class="small-button" type="button" data-batch-action="publish">批量上架</button>
          <button class="small-button" type="button" data-batch-action="unpublish">批量下架</button>
          <button class="small-button" type="button" data-batch-action="delete">批量删除</button>
        </div>
      </div>
      <div class="recent-table-wrap">
        ${state.projects.length ? `
          <table class="admin-table projects-table">
            <thead>
              <tr>
                <th class="table-checkbox"><input class="checkbox" type="checkbox" id="projectSelectAll" aria-label="全选项目"></th>
                <th>项目</th><th>分类 / 标签</th><th>文件</th><th>排序</th><th>上架</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${state.projects.map((project) => projectTableRow(project)).join('')}
            </tbody>
          </table>
        ` : '<div class="table-empty">没有找到符合筛选条件的项目</div>'}
      </div>
    </section>
  `;
  byId('newProjectButton')?.addEventListener('click', () => openProjectEditor());
  byId('projectFilterForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    filters.projects = {
      search: form.elements.search.value.trim(),
      categoryId: form.elements.categoryId.value,
      status: form.elements.status.value,
      sort: form.elements.sort.value
    };
    renderCurrentView();
  });
  root.querySelector('[data-clear-project-filter]')?.addEventListener('click', () => {
    filters.projects = { search: '', categoryId: '', status: '', sort: 'sort_desc' };
    renderCurrentView();
  });
  bindProjectTableActions(root);
}

function selectOption(value, label, current) {
  return `<option value="${value}" ${String(value) === String(current) ? 'selected' : ''}>${label}</option>`;
}

function projectTableRow(project) {
  return `
    <tr data-project-row="${project.id}">
      <td class="table-checkbox"><input class="checkbox project-row-checkbox" type="checkbox" value="${project.id}" aria-label="选择 ${escapeHtml(project.name)}"></td>
      <td>
        <div class="project-table-name">
          <span class="project-cover-thumb"><img src="${escapeHtml(appPath(project.coverCardUrl || project.coverUrl || '/assets/favicon.svg'))}" alt="" loading="lazy" width="720" height="405" decoding="async"></span>
          <span class="table-cell-stack"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.slogan)}</span></span>
        </div>
      </td>
      <td>
        <div class="table-cell-stack">
          <strong>${escapeHtml(project.categoryName)}</strong>
          <div class="mini-tags">${(project.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        </div>
      </td>
      <td><div class="file-count-badge"><span>软件 ${project.softwareCount}</span><span>资料 ${project.documentCount}</span><span>链接 ${project.linkCount || 0}</span></div></td>
      <td>${project.sortWeight}</td>
      <td>
        <label class="switch-control" title="切换上架状态">
          <input type="checkbox" data-project-publish="${project.id}" ${project.published ? 'checked' : ''}>
          <i></i><span>${project.published ? '已上架' : '已下架'}</span>
        </label>
      </td>
      <td>${formatDateShort(project.updatedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="action-link" type="button" data-project-action="edit" data-project-id="${project.id}">编辑</button>
          <button class="action-link" type="button" data-project-action="files" data-project-id="${project.id}">文件</button>
          <button class="action-link danger" type="button" data-project-action="delete" data-project-id="${project.id}">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function bindProjectTableActions(root) {
  root.querySelectorAll('[data-project-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.projectId);
      const project = state.projects.find((item) => item.id === id);
      if (button.dataset.projectAction === 'edit') openProjectEditor(id);
      if (button.dataset.projectAction === 'files') openFileManager(id);
      if (button.dataset.projectAction === 'delete' && project) {
        confirmAction({
          title: '删除项目',
          text: `确定删除“${project.name}”吗？项目内容、关联文件与下载记录会一并删除，此操作不可恢复。`,
          callback: async () => {
            try {
              await adminApi(`/api/admin/projects/${id}`, { method: 'DELETE' });
              adminToast('项目已删除', 'success');
              renderCurrentView();
            } catch (error) {
              adminToast(error.message || '删除失败', 'error');
            }
          }
        });
      }
    });
  });

  root.querySelectorAll('[data-project-publish]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = Number(input.dataset.projectPublish);
      const published = input.checked;
      input.disabled = true;
      try {
        await adminApi(`/api/admin/projects/${id}`, { method: 'PATCH', body: { published } });
        const project = state.projects.find((item) => item.id === id);
        if (project) project.published = published;
        const label = input.parentElement.querySelector('span');
        if (label) label.textContent = published ? '已上架' : '已下架';
        adminToast(published ? '项目已上架' : '项目已下架', 'success');
      } catch (error) {
        input.checked = !published;
        adminToast(error.message || '状态更新失败', 'error');
      } finally {
        input.disabled = false;
      }
    });
  });

  const checkboxes = [...root.querySelectorAll('.project-row-checkbox')];
  const selectAll = byId('projectSelectAll');
  const updateBatch = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked);
    byId('projectBatchBar').hidden = selected.length === 0;
    setText('projectSelectedCount', selected.length);
    if (selectAll) {
      selectAll.checked = selected.length > 0 && selected.length === checkboxes.length;
      selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
    }
  };
  selectAll?.addEventListener('change', () => {
    checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
    updateBatch();
  });
  checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateBatch));

  root.querySelectorAll('[data-batch-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const ids = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => Number(checkbox.value));
      const action = button.dataset.batchAction;
      if (ids.length === 0) return;
      if (action === 'delete') {
        confirmAction({
          title: '批量删除项目',
          text: `确定删除已选择的 ${ids.length} 个项目吗？相关文件也会一并删除，且无法恢复。`,
          callback: async () => {
            try {
              await adminApi('/api/admin/projects/batch', { method: 'POST', body: { ids, action } });
              adminToast('所选项目已删除', 'success');
              renderCurrentView();
            } catch (error) {
              adminToast(error.message || '批量删除失败', 'error');
            }
          }
        });
        return;
      }
      batchUpdateProjects(ids, action);
    });
  });
}

async function batchUpdateProjects(ids, action) {
  try {
    const response = await adminApi('/api/admin/projects/batch', { method: 'POST', body: { ids, action } });
    adminToast(`已更新 ${response.data.affected} 个项目`, 'success');
    renderCurrentView();
  } catch (error) {
    adminToast(error.message || '批量操作失败', 'error');
  }
}

async function openProjectEditor(projectId = null) {
  try {
    if (!state.categories.length) {
      try {
        const response = await adminApi('/api/admin/categories');
        state.categories = response.data;
      } catch {
        state.categories = [];
      }
    }
    const project = projectId
      ? (await adminApi(`/api/admin/projects/${projectId}`)).data
      : {
          name: '',
          slogan: '',
          description: '',
          highlights: [],
          tags: [],
          categoryId: null,
          coverUrl: '',
          sortWeight: 0,
          published: true
        };
    state.editingProjectId = projectId;
    state.projectCoverUrl = project.coverUrl || '';
    const form = byId('projectForm');
    form.reset();
    form.elements.name.value = project.name || '';
    form.elements.slogan.value = project.slogan || '';
    form.elements.description.value = project.description || '';
    form.elements.highlights.value = (project.highlights || []).join('\n');
    form.elements.tags.value = (project.tags || []).join('，');
    form.elements.sortWeight.value = project.sortWeight ?? 0;
    form.elements.published.checked = project.published !== false;
    form.elements.coverUrl.value = state.projectCoverUrl;
    form.elements.categoryId.innerHTML = `
      <option value="">未分类</option>
      ${state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}
    `;
    form.elements.categoryId.value = project.categoryId ? String(project.categoryId) : '';
    setText('projectEditorTitle', projectId ? '编辑项目' : '新增项目');
    updateCoverPreview(state.projectCoverUrl);
    byId('coverUploadProgress').hidden = true;
    byId('projectEditorDialog').showModal();
    updateModalLock();
  } catch (error) {
    adminToast(error.message || '项目内容加载失败', 'error');
  }
}

function updateCoverPreview(url) {
  state.projectCoverUrl = url || '';
  const preview = byId('projectCoverPreview');
  byId('projectCoverUrl').value = state.projectCoverUrl;
  preview.classList.toggle('has-image', Boolean(state.projectCoverUrl));
  preview.querySelector('img')?.remove();
  if (state.projectCoverUrl) {
    const image = document.createElement('img');
    image.src = state.projectCoverUrl;
    image.alt = '项目封面预览';
    image.addEventListener('error', () => {
      image.remove();
      preview.classList.remove('has-image');
    });
    preview.prepend(image);
  }
}

function bindProjectFormEvents() {
  const form = byId('projectForm');
  byId('projectCoverInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      adminToast('封面仅支持 JPG、PNG 或 WEBP 图片', 'error');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      adminToast('封面图片不能超过 5MB', 'error');
      event.target.value = '';
      return;
    }
    const progress = byId('coverUploadProgress');
    progress.hidden = false;
    const data = new FormData();
    data.append('file', file);
    try {
      const response = await adminApi('/api/admin/upload/cover', { method: 'POST', body: data });
      updateCoverPreview(response.data.url);
      adminToast('封面已上传', 'success');
    } catch (error) {
      adminToast(error.message || '封面上传失败', 'error');
    } finally {
      progress.hidden = true;
      event.target.value = '';
    }
  });

  byId('removeProjectCover').addEventListener('click', () => {
    updateCoverPreview('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: form.elements.name.value.trim(),
      slogan: form.elements.slogan.value.trim(),
      description: form.elements.description.value.trim(),
      highlights: form.elements.highlights.value.split(/\n+/).map((item) => item.trim()).filter(Boolean),
      tags: form.elements.tags.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      categoryId: form.elements.categoryId.value ? Number(form.elements.categoryId.value) : null,
      coverUrl: state.projectCoverUrl,
      sortWeight: Number(form.elements.sortWeight.value || 0),
      published: form.elements.published.checked
    };
    form.elements.name.setCustomValidity(
      payload.name.length < 2 ? '项目名称至少需要 2 个字符' : ''
    );
    form.elements.tags.setCustomValidity(
      payload.tags.length < 2 ? '请至少填写两个项目标签，用逗号分隔' : ''
    );
    form.elements.highlights.setCustomValidity(
      payload.highlights.length < 1 ? '请至少填写一个功能亮点' : ''
    );
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const submitError = byId('projectSubmitError');
    submitError.hidden = true;
    submitError.textContent = '';
    setButtonBusy(form, true);
    try {
      const url = state.editingProjectId
        ? `/api/admin/projects/${state.editingProjectId}`
        : '/api/admin/projects';
      await adminApi(url, { method: state.editingProjectId ? 'PATCH' : 'POST', body: payload });
      adminToast(state.editingProjectId ? '项目已更新' : '项目已创建', 'success');
      closeDialog('projectEditorDialog');
      renderCurrentView();
    } catch (error) {
      submitError.textContent = error.message || '项目保存失败，请检查填写内容后重试';
      submitError.hidden = false;
      adminToast(error.message || '项目保存失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });

  ['name', 'tags', 'highlights'].forEach((name) => {
    form.elements[name].addEventListener('input', () => {
      form.elements[name].setCustomValidity('');
      byId('projectSubmitError').hidden = true;
    });
  });
}

async function renderCategoriesView(token) {
  const response = await adminApi('/api/admin/categories');
  if (token !== state.renderToken) return;
  state.categories = response.data;
  const root = byId('viewRoot');
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left"><div><h2>项目分类</h2><p>共 ${state.categories.length} 个分类，点击排序权重可控制前台顺序</p></div></div>
      <button class="primary-button" type="button" id="newCategoryButton">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        新增分类
      </button>
    </div>
    ${state.categories.length ? `
      <div class="category-card-grid">
        ${state.categories.map((category) => categoryCard(category)).join('')}
      </div>
    ` : `
      <div class="data-panel">
        <div class="table-empty">
          <div><p>还没有项目分类，先创建一个分类来组织项目内容。</p><button class="primary-button" type="button" data-add-empty-category>新增分类</button></div>
        </div>
      </div>
    `}
  `;
  byId('newCategoryButton')?.addEventListener('click', () => openCategoryEditor());
  root.querySelector('[data-add-empty-category]')?.addEventListener('click', () => openCategoryEditor());
  root.querySelectorAll('[data-category-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.categoryId);
      const category = state.categories.find((item) => item.id === id);
      if (!category) return;
      if (button.dataset.categoryAction === 'edit') openCategoryEditor(category);
      if (button.dataset.categoryAction === 'delete') {
        confirmAction({
          title: '删除分类',
          text: `确定删除“${category.name}”吗？该分类下的 ${category.projectCount} 个项目会变为未分类，项目本身不会被删除。`,
          callback: async () => {
            try {
              await adminApi(`/api/admin/categories/${id}`, { method: 'DELETE' });
              adminToast('分类已删除', 'success');
              renderCurrentView();
            } catch (error) {
              adminToast(error.message || '分类删除失败', 'error');
            }
          }
        });
      }
    });
  });
  root.querySelectorAll('[data-category-active]').forEach((input) => {
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await adminApi(`/api/admin/categories/${input.dataset.categoryActive}`, {
          method: 'PATCH',
          body: { active: input.checked }
        });
        const label = input.parentElement.querySelector('span');
        if (label) label.textContent = input.checked ? '显示' : '隐藏';
        adminToast(input.checked ? '分类已显示' : '分类已隐藏', 'success');
      } catch (error) {
        input.checked = !input.checked;
        adminToast(error.message || '状态更新失败', 'error');
      } finally {
        input.disabled = false;
      }
    });
  });
}

function categoryCard(category) {
  return `
    <article class="category-admin-card">
      <div class="category-card-top">
        <span class="category-icon-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z"/></svg>
        </span>
        <span class="category-order">ORDER ${category.sortOrder}</span>
      </div>
      <h3>${escapeHtml(category.name)}</h3>
      <p>${escapeHtml(category.description || '暂未填写分类说明')}</p>
      <div class="category-card-footer">
        <span class="category-project-count"><b>${category.projectCount}</b> 个项目</span>
        <div class="category-actions">
          <label class="switch-control">
            <input type="checkbox" data-category-active="${category.id}" ${category.active ? 'checked' : ''}>
            <i></i><span>${category.active ? '显示' : '隐藏'}</span>
          </label>
          <button class="action-link" type="button" data-category-action="edit" data-category-id="${category.id}">编辑</button>
          <button class="action-link danger" type="button" data-category-action="delete" data-category-id="${category.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function openCategoryEditor(category = null) {
  const form = byId('categoryForm');
  form.reset();
  form.elements.id.value = category?.id || '';
  form.elements.name.value = category?.name || '';
  form.elements.description.value = category?.description || '';
  form.elements.sortOrder.value = category?.sortOrder ?? 0;
  form.elements.active.checked = category?.active !== false;
  setText('categoryDialogTitle', category ? '编辑分类' : '新增分类');
  byId('categoryDialog').showModal();
  updateModalLock();
}

function bindCategoryFormEvents() {
  const form = byId('categoryForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setButtonBusy(form, true);
    const id = form.elements.id.value;
    const payload = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      sortOrder: Number(form.elements.sortOrder.value || 0),
      active: form.elements.active.checked
    };
    try {
      await adminApi(id ? `/api/admin/categories/${id}` : '/api/admin/categories', {
        method: id ? 'PATCH' : 'POST',
        body: payload
      });
      adminToast(id ? '分类已更新' : '分类已创建', 'success');
      closeDialog('categoryDialog');
      renderCurrentView();
    } catch (error) {
      adminToast(error.message || '分类保存失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });
}

async function openFileManager(projectId) {
  try {
    const response = await adminApi(`/api/admin/projects/${projectId}`);
    state.fileProject = response.data;
    setText('fileManagerTitle', response.data.name);
    setText('fileManagerSubtitle', '管理软件、资料与外部跳转链接');
    byId('fileUploadForm').reset();
    byId('projectLinkForm').reset();
    renderAdminFileList();
    byId('fileManagerDialog').showModal();
    updateModalLock();
  } catch (error) {
    adminToast(error.message || '项目文件加载失败', 'error');
  }
}

function renderAdminFileList() {
  const project = state.fileProject;
  if (!project) return;
  const files = project.files || [];
  const links = project.links || [];
  setText('fileTotalText', `共 ${files.length + links.length} 个资源（文件 ${files.length} · 链接 ${links.length}）`);
  const list = byId('adminFileList');
  if (files.length === 0 && links.length === 0) {
    list.innerHTML = '<div class="table-empty compact">该项目还没有资源。可上传软件安装包、资料文档，或添加外部跳转链接。</div>';
    return;
  }
  const fileRows = files.map((file) => `
    <div class="admin-file-row" data-file-row="${file.id}">
      <div class="admin-file-main">
        <span class="admin-file-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">${file.type === 'software'
            ? '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/>'
            : '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/>'}</svg>
        </span>
        <span class="table-cell-stack">
          <strong title="${escapeHtml(file.displayName)}">${escapeHtml(file.displayName)}</strong>
          <span>${formatBytes(file.size)} · ${formatDateShort(file.createdAt)}</span>
        </span>
      </div>
      <span class="type-pill ${file.type}">${file.type === 'software' ? '软件包' : '项目资料'}</span>
      <span class="muted-text">${escapeHtml(file.mimeType || '文件')}</span>
      <span class="status-pill published">可下载</span>
      <div class="file-row-actions">
        <button class="action-link" type="button" data-file-action="download" data-file-id="${file.id}">下载</button>
        <button class="action-link" type="button" data-file-action="rename" data-file-id="${file.id}">重命名</button>
        <button class="action-link" type="button" data-file-action="replace" data-file-id="${file.id}">替换</button>
        <button class="action-link danger" type="button" data-file-action="delete" data-file-id="${file.id}">删除</button>
      </div>
    </div>
  `).join('');
  const linkRows = links.map((link) => {
    let host = '外部链接';
    try {
      host = new URL(link.url).hostname;
    } catch {
      // 无效历史数据仍可在后台删除或修正。
    }
    return `
      <div class="admin-file-row" data-link-row="${link.id}">
        <div class="admin-file-main">
          <span class="admin-file-icon link">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>
          </span>
          <span class="table-cell-stack">
            <strong title="${escapeHtml(link.displayName)}">${escapeHtml(link.displayName)}</strong>
            <span title="${escapeHtml(link.url)}">${escapeHtml(link.url)}</span>
          </span>
        </div>
        <span class="type-pill link">外部链接</span>
        <span class="muted-text">${escapeHtml(host)}</span>
        <span class="status-pill published">可跳转</span>
        <div class="file-row-actions">
          <a class="action-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">访问</a>
          <button class="action-link" type="button" data-link-action="rename" data-link-id="${link.id}">名称</button>
          <button class="action-link" type="button" data-link-action="url" data-link-id="${link.id}">地址</button>
          <button class="action-link danger" type="button" data-link-action="delete" data-link-id="${link.id}">删除</button>
        </div>
      </div>
    `;
  }).join('');
  list.innerHTML = fileRows + linkRows;
}

async function refreshFileProject() {
  if (!state.fileProject) return;
  const response = await adminApi(`/api/admin/projects/${state.fileProject.id}`);
  state.fileProject = response.data;
  renderAdminFileList();
}

function bindFileManagerEvents() {
  const form = byId('fileUploadForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.fileProject) return;
    const file = form.elements.file.files?.[0];
    if (!file) {
      adminToast('请选择要上传的文件', 'error');
      return;
    }
    setButtonBusy(form, true);
    const data = new FormData();
    data.append('file', file);
    data.append('type', form.elements.type.value);
    data.append('displayName', form.elements.displayName.value.trim() || file.name);
    try {
      await adminApi(`/api/admin/projects/${state.fileProject.id}/files`, { method: 'POST', body: data });
      await refreshFileProject();
      form.reset();
      adminToast('文件已上传，前台可立即下载', 'success');
    } catch (error) {
      adminToast(error.message || '文件上传失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });

  const linkForm = byId('projectLinkForm');
  linkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.fileProject) return;
    const displayName = linkForm.elements.displayName.value.trim();
    const url = linkForm.elements.url.value.trim();
    if (!displayName) {
      adminToast('请填写链接在前台显示的名称', 'error');
      linkForm.elements.displayName.focus();
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      adminToast('请填写完整的 http:// 或 https:// 链接', 'error');
      linkForm.elements.url.focus();
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      adminToast('链接仅支持 HTTP 或 HTTPS 地址', 'error');
      return;
    }
    setButtonBusy(linkForm, true);
    try {
      await adminApi(`/api/admin/projects/${state.fileProject.id}/links`, {
        method: 'POST',
        body: { displayName, url: parsedUrl.toString(), sortOrder: 0 }
      });
      await refreshFileProject();
      linkForm.reset();
      adminToast('跳转链接已添加，前台可立即访问', 'success');
    } catch (error) {
      adminToast(error.message || '链接添加失败', 'error');
    } finally {
      setButtonBusy(linkForm, false);
    }
  });

  byId('adminFileList').addEventListener('click', (event) => {
    const linkButton = event.target.closest('[data-link-action]');
    if (linkButton && state.fileProject) {
      const link = state.fileProject.links?.find((item) => item.id === Number(linkButton.dataset.linkId));
      if (!link) return;
      const action = linkButton.dataset.linkAction;
      if (action === 'rename') {
        promptAction({
          title: '修改链接展示名称',
          label: '前台显示的链接名称',
          value: link.displayName,
          callback: async (value) => {
            try {
              await adminApi(`/api/admin/links/${link.id}`, { method: 'PATCH', body: { displayName: value } });
              await refreshFileProject();
              adminToast('链接名称已更新', 'success');
            } catch (error) {
              adminToast(error.message || '链接名称更新失败', 'error');
            }
          }
        });
      }
      if (action === 'url') {
        promptAction({
          title: '修改跳转地址',
          label: '完整的 HTTP / HTTPS 链接',
          value: link.url,
          maxLength: 2000,
          callback: async (value) => {
            try {
              await adminApi(`/api/admin/links/${link.id}`, { method: 'PATCH', body: { url: value } });
              await refreshFileProject();
              adminToast('跳转地址已更新', 'success');
            } catch (error) {
              adminToast(error.message || '跳转地址更新失败', 'error');
            }
          }
        });
      }
      if (action === 'delete') {
        confirmAction({
          title: '删除跳转链接',
          text: `确定删除“${link.displayName}”吗？访客端入口会立即失效。`,
          callback: async () => {
            try {
              await adminApi(`/api/admin/links/${link.id}`, { method: 'DELETE' });
              await refreshFileProject();
              adminToast('跳转链接已删除', 'success');
            } catch (error) {
              adminToast(error.message || '链接删除失败', 'error');
            }
          }
        });
      }
      return;
    }
    const button = event.target.closest('[data-file-action]');
    if (!button || !state.fileProject) return;
    const file = state.fileProject.files.find((item) => item.id === Number(button.dataset.fileId));
    if (!file) return;
    const action = button.dataset.fileAction;
    if (action === 'download') {
      const anchor = document.createElement('a');
      anchor.href = appPath(`/api/admin/files/${file.id}/download`);
      anchor.download = file.displayName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }
    if (action === 'rename') {
      promptAction({
        title: '修改文件展示名称',
        label: '前台显示的文件名',
        value: file.displayName,
        callback: async (value) => {
          try {
            await adminApi(`/api/admin/files/${file.id}`, { method: 'PATCH', body: { displayName: value } });
            await refreshFileProject();
            adminToast('文件名已更新', 'success');
          } catch (error) {
            adminToast(error.message || '文件名更新失败', 'error');
          }
        }
      });
    }
    if (action === 'replace') replaceProjectFile(file);
    if (action === 'delete') {
      confirmAction({
        title: '删除项目文件',
        text: `确定删除“${file.displayName}”吗？前台下载入口会立即失效，原文件将从存储目录移除。`,
        callback: async () => {
          try {
            await adminApi(`/api/admin/files/${file.id}`, { method: 'DELETE' });
            await refreshFileProject();
            adminToast('文件已删除', 'success');
          } catch (error) {
            adminToast(error.message || '文件删除失败', 'error');
          }
        }
      });
    }
  });
}

function replaceProjectFile(file) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.zip,.rar,.7z,.exe,.msi,.dmg,.pkg';
  input.addEventListener('change', async () => {
    const selected = input.files?.[0];
    if (!selected) return;
    if (selected.size > 200 * 1024 * 1024) {
      adminToast('替换文件不能超过 200MB', 'error');
      return;
    }
    const data = new FormData();
    data.append('file', selected);
    data.append('displayName', file.displayName);
    adminToast('正在替换文件...');
    try {
      await adminApi(`/api/admin/files/${file.id}/replace`, { method: 'PUT', body: data });
      await refreshFileProject();
      adminToast('文件已替换，原下载链接已失效', 'success');
    } catch (error) {
      adminToast(error.message || '文件替换失败', 'error');
    }
  });
  input.click();
}

async function renderInquiriesView(token) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters.inquiries)) {
    if (value) query.set(key, value);
  }
  const response = await adminApi(`/api/admin/inquiries?${query}`);
  if (token !== state.renderToken) return;
  state.inquiries = response.data;
  updateInquiryBadge(response.meta.unreadCount);
  const root = byId('viewRoot');
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left"><div><h2>合作线索</h2><p>共 ${state.inquiries.length} 条记录，${response.meta.unreadCount} 条未读</p></div></div>
    </div>
    <section class="data-panel">
      <div class="filter-bar">
        <form id="inquiryFilterForm">
          <label class="filter-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
            <input type="search" name="search" value="${escapeHtml(filters.inquiries.search)}" placeholder="搜索姓名、电话、公司或需求">
          </label>
          <select class="filter-select" name="status">
            ${selectOption('', '全部状态', filters.inquiries.status)}
            ${selectOption('new', '新留言', filters.inquiries.status)}
            ${selectOption('processing', '跟进中', filters.inquiries.status)}
            ${selectOption('done', '已处理', filters.inquiries.status)}
          </select>
          <select class="filter-select" name="read">
            ${selectOption('', '全部阅读状态', filters.inquiries.read)}
            ${selectOption('unread', '仅未读', filters.inquiries.read)}
            ${selectOption('read', '仅已读', filters.inquiries.read)}
          </select>
          <button class="filter-button" type="submit">筛选</button>
          <button class="filter-button" type="button" data-clear-inquiry-filter>重置</button>
        </form>
        <span class="filter-result-text">线索仅用于业务跟进</span>
      </div>
      <div class="recent-table-wrap">
        ${state.inquiries.length ? `
          <table class="admin-table">
            <thead><tr><th>访客</th><th>联系方式</th><th>意向项目</th><th>需求摘要</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
            <tbody>
              ${state.inquiries.map((item) => `
                <tr>
                  <td>
                    <div class="table-contact">
                      <span class="table-avatar">${escapeHtml(item.name.slice(0, 1))}</span>
                      <div class="table-cell-stack"><strong>${!item.isRead ? '<i class="unread-dot" style="display:inline-block;margin-right:5px"></i>' : ''}${escapeHtml(item.name)}</strong><span>${escapeHtml(item.company || '个人 / 未填写公司')}</span></div>
                    </div>
                  </td>
                  <td><div class="table-cell-stack"><strong>${escapeHtml(item.phone)}</strong><span>${escapeHtml(item.wechat || '未填写微信')}</span></div></td>
                  <td>${escapeHtml(item.projectName || '未指定')}</td>
                  <td><span class="muted-text">${escapeHtml(item.message.slice(0, 30))}${item.message.length > 30 ? '…' : ''}</span></td>
                  <td><span class="status-pill ${item.status}">${statusLabels[item.status]}</span></td>
                  <td>${formatDateShort(item.createdAt)}</td>
                  <td><button class="action-link" type="button" data-inquiry-action="open" data-inquiry-id="${item.id}">查看详情</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="table-empty">暂无符合条件的咨询留言</div>'}
      </div>
    </section>
  `;
  byId('inquiryFilterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    filters.inquiries = {
      search: form.elements.search.value.trim(),
      status: form.elements.status.value,
      read: form.elements.read.value
    };
    renderCurrentView();
  });
  root.querySelector('[data-clear-inquiry-filter]').addEventListener('click', () => {
    filters.inquiries = { search: '', status: '', read: '' };
    renderCurrentView();
  });
  root.querySelectorAll('[data-inquiry-action="open"]').forEach((button) => {
    button.addEventListener('click', () => openInquiry(Number(button.dataset.inquiryId)));
  });
}

async function openInquiry(id) {
  try {
    const response = await adminApi(`/api/admin/inquiries/${id}`);
    const inquiry = response.data;
    state.inquiryId = id;
    setText('inquiryTime', `提交于 ${formatDateTime(inquiry.createdAt)}`);
    setText('inquiryAvatar', inquiry.name.slice(0, 1));
    setText('inquiryName', inquiry.name);
    setText('inquiryCompany', inquiry.company || '个人 / 未填写公司');
    setText('inquiryPhone', inquiry.phone);
    setText('inquiryWechat', inquiry.wechat || '未填写');
    setText('inquiryProject', inquiry.projectName || '未指定项目');
    setText('inquiryFile', inquiry.sourceFileName || '未指定文件');
    setText('inquiryMessage', inquiry.message);
    const badge = byId('inquiryStatusBadge');
    badge.className = `status-pill ${inquiry.status}`;
    badge.textContent = statusLabels[inquiry.status];
    const form = byId('inquiryForm');
    form.elements.id.value = id;
    form.elements.status.value = inquiry.status;
    form.elements.isRead.value = inquiry.isRead ? '1' : '0';
    form.elements.adminNote.value = inquiry.adminNote || '';
    byId('inquiryDialog').showModal();
    updateModalLock();

    if (!inquiry.isRead) {
      try {
        await adminApi(`/api/admin/inquiries/${id}`, { method: 'PATCH', body: { isRead: true } });
        form.elements.isRead.value = '1';
        const badgeElement = byId('inquiryBadge');
        const current = Number.parseInt(badgeElement.textContent || '0', 10) || 0;
        updateInquiryBadge(Math.max(0, current - 1));
      } catch {
        // 自动已读失败不影响查看与后续保存。
      }
    }
  } catch (error) {
    adminToast(error.message || '咨询详情加载失败', 'error');
  }
}

function bindInquiryFormEvents() {
  const form = byId('inquiryForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setButtonBusy(form, true);
    try {
      await adminApi(`/api/admin/inquiries/${state.inquiryId}`, {
        method: 'PATCH',
        body: {
          status: form.elements.status.value,
          isRead: form.elements.isRead.value === '1',
          adminNote: form.elements.adminNote.value.trim()
        }
      });
      adminToast('咨询处理状态已保存', 'success');
      closeDialog('inquiryDialog');
      if (state.currentView === 'inquiries' || state.currentView === 'dashboard') renderCurrentView();
    } catch (error) {
      adminToast(error.message || '保存失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });

  byId('deleteInquiryButton').addEventListener('click', () => {
    confirmAction({
      title: '删除咨询记录',
      text: '确定删除这条合作咨询吗？访客联系方式与跟进备注将永久移除。',
      callback: async () => {
        try {
          await adminApi(`/api/admin/inquiries/${state.inquiryId}`, { method: 'DELETE' });
          closeDialog('inquiryDialog');
          adminToast('咨询记录已删除', 'success');
          renderCurrentView();
        } catch (error) {
          adminToast(error.message || '删除失败', 'error');
        }
      }
    });
  });
}

async function renderSettingsView(token) {
  if (!state.settings) {
    const response = await adminApi('/api/admin/settings');
    state.settings = response.data;
  }
  if (state.settingsTab === 'text' && !state.contentSchema) {
    const response = await adminApi('/api/admin/content-schema');
    state.contentSchema = response.data;
  }
  if (state.settingsTab === 'content') {
    const response = await adminApi('/api/admin/project-options');
    state.featuredProjectOptions = response.data;
  }
  if (token !== state.renderToken) return;
  const root = byId('viewRoot');
  const currentTab = state.settingsTab;
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left"><div><h2>站点配置</h2><p>保存后前台接口立即返回新内容，无需修改代码</p></div></div>
      <a class="secondary-button" href="../" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></svg>
        预览前台
      </a>
    </div>
    <div class="settings-tabs">
      <button class="${currentTab === 'content' ? 'active' : ''}" type="button" data-settings-tab="content">首页文案</button>
      <button class="${currentTab === 'site' ? 'active' : ''}" type="button" data-settings-tab="site">站点信息</button>
      <button class="${currentTab === 'widget' ? 'active' : ''}" type="button" data-settings-tab="widget">悬浮联系</button>
      <button class="${currentTab === 'text' ? 'active' : ''}" type="button" data-settings-tab="text">全站文字</button>
      <button class="${currentTab === 'download' ? 'active' : ''}" type="button" data-settings-tab="download">下载规则</button>
    </div>
    <div class="settings-layout">
      <section class="data-panel settings-form-panel">
        ${settingsTabContent(currentTab)}
      </section>
      <aside class="settings-aside-card">
        ${settingsAside(currentTab)}
      </aside>
    </div>
  `;
  root.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.settingsTab = button.dataset.settingsTab;
      renderCurrentView();
    });
  });
  bindSettingsForm(currentTab);
}

function settingsTabContent(tab) {
  const settings = state.settings;
  if (tab === 'site') {
    return `
      <form id="settingsForm">
        <div class="settings-section-title"><b>01</b><div><h3>站点基础信息</h3><p>品牌名称、浏览器标题与页脚展示内容</p></div></div>
        <div class="form-grid two">
          ${settingInput('站点名称', 'siteName', settings.siteName, '例如：傅先生AI项目VIP')}
          ${settingInput('品牌简称', 'brandShort', settings.brandShort, '例如：傅先生 AI')}
        </div>
        ${settingInput('浏览器页面标题', 'documentTitle', settings.documentTitle)}
        <div class="settings-section-title" style="margin-top:28px"><b>02</b><div><h3>联系与咨询信息</h3><p>访客在合作咨询区看到的联系方式</p></div></div>
        <div class="form-grid two">
          ${settingInput('QQ 咨询号码', 'contactPhone', settings.contactPhone)}
          ${settingInput('咨询微信', 'contactWechat', settings.contactWechat)}
          ${settingInput('响应时间', 'contactHours', settings.contactHours)}
          ${settingInput('咨询小标题', 'contactEyebrow', settings.contactEyebrow)}
          ${settingInput('咨询区块序号', 'contactSectionIndex', settings.contactSectionIndex, '例如：03')}
          ${settingInput('咨询区块英文标题', 'contactSectionLabel', settings.contactSectionLabel, '例如：START A CONVERSATION')}
        </div>
        ${settingInput('咨询标题', 'contactTitle', settings.contactTitle, '', true)}
        ${settingInput('咨询区说明', 'contactSubtitle', settings.contactSubtitle, '', true)}
        ${settingInput('表单信息说明', 'contactNotice', settings.contactNotice, '', true)}
        <div class="settings-section-title" style="margin-top:28px"><b>03</b><div><h3>页脚信息</h3><p>版权文字与备案号预留位</p></div></div>
        <div class="form-grid two">
          ${settingInput('版权文字', 'footerCopyright', settings.footerCopyright)}
          ${settingInput('备案号预留位', 'icpNumber', settings.icpNumber, '例如：京ICP备xxxxxxxx号')}
        </div>
        <div class="settings-form-actions">
          <button class="primary-button" type="submit"><span class="button-label">保存站点信息</span><span class="button-loading" hidden>正在保存...</span></button>
        </div>
      </form>
    `;
  }
  if (tab === 'download') {
    return `
      <form id="settingsForm">
        <div class="settings-section-title"><b>01</b><div><h3>文件下载控制</h3><p>下载规则对所有已上架项目文件生效</p></div></div>
        <div class="download-rule-card">
          <label class="switch-row">
            <input type="checkbox" name="downloadRequireLead" ${settings.downloadRequireLead ? 'checked' : ''}>
            <i></i>
            <span><strong>下载前需留资</strong><small>开启后，访客需提交姓名和联系电话才能获取文件</small></span>
          </label>
          <div class="form-grid two">
            <label class="admin-field">
              <span>单 IP 每日下载次数</span>
              <input type="number" name="downloadDailyLimit" min="0" max="1000" value="${Number(settings.downloadDailyLimit || 0)}">
              <small>填写 0 表示不限制；软件与资料下载均计入次数</small>
            </label>
          </div>
        </div>
        <div class="settings-form-actions">
          <button class="primary-button" type="submit"><span class="button-label">保存下载规则</span><span class="button-loading" hidden>正在保存...</span></button>
        </div>
      </form>
    `;
  }
  if (tab === 'widget') {
    return `
      <form id="settingsForm">
        <div class="settings-section-title"><b>浮</b><div><h3>右侧悬浮联系</h3><p>固定跟随页面滚动，点击后展示二维码和管理员信息</p></div></div>
        <label class="switch-field padded widget-switch">
          <span>前台显示状态</span>
          <span class="switch-row">
            <input type="checkbox" name="floatingContactEnabled" ${settings.floatingContactEnabled ? 'checked' : ''}>
            <i></i>
            <span><strong>显示联系浮标</strong><small>关闭后访客端不再显示浮动联系入口</small></span>
          </span>
        </label>

        <div class="widget-image-grid">
          <div class="widget-image-card">
            <div class="widget-image-card-head"><div><strong>联系二维码</strong><small>建议正方形高清图片，不超过 5MB</small></div><span>QR CODE</span></div>
            <input type="hidden" name="floatingContactQrUrl" id="floatingContactQrUrl" value="${escapeHtml(settings.floatingContactQrUrl || '')}">
            <div class="widget-image-preview qr">
              <img id="widgetQrPreview" src="${escapeHtml(appPath(settings.floatingContactQrUrl || '/assets/contact-qr-placeholder.svg'))}" alt="联系二维码预览">
            </div>
            <div class="widget-image-actions">
              <label class="small-button primary">
                <input type="file" id="widgetQrInput" accept=".jpg,.jpeg,.png,.webp" hidden>
                <span>上传 / 替换</span>
              </label>
              <button class="small-button" type="button" data-remove-widget-image="qr">清除</button>
            </div>
          </div>
          <div class="widget-image-card">
            <div class="widget-image-card-head"><div><strong>管理员标识</strong><small>头像、Logo 或认证标识图片</small></div><span>ADMIN MARK</span></div>
            <input type="hidden" name="floatingContactAdminImageUrl" id="floatingContactAdminImageUrl" value="${escapeHtml(settings.floatingContactAdminImageUrl || '')}">
            <div class="widget-image-preview admin">
              <img id="widgetAdminPreview" src="${escapeHtml(appPath(settings.floatingContactAdminImageUrl || '/assets/admin-emblem.svg'))}" alt="管理员标识预览">
            </div>
            <div class="widget-image-actions">
              <label class="small-button primary">
                <input type="file" id="widgetAdminInput" accept=".jpg,.jpeg,.png,.webp" hidden>
                <span>上传 / 替换</span>
              </label>
              <button class="small-button" type="button" data-remove-widget-image="admin">清除</button>
            </div>
          </div>
        </div>

        <div class="widget-copy-section">
          <div class="form-grid two">
            ${settingInput('浮标文字', 'floatingContactLabel', settings.floatingContactLabel, '例如：联系顾问')}
            ${settingInput('弹窗眉题', 'floatingContactEyebrow', settings.floatingContactEyebrow, '例如：DIRECT CONTACT')}
          </div>
          ${settingInput('弹窗标题', 'floatingContactTitle', settings.floatingContactTitle)}
          ${settingInput('弹窗说明', 'floatingContactDescription', settings.floatingContactDescription, '', true)}
          <div class="form-grid two">
            ${settingInput('管理员名称', 'floatingContactAdminName', settings.floatingContactAdminName)}
            ${settingInput('管理员身份', 'floatingContactAdminTitle', settings.floatingContactAdminTitle)}
            ${settingInput('认证标识文字', 'floatingContactBadge', settings.floatingContactBadge)}
            ${settingInput('扫码提示', 'floatingContactQrHint', settings.floatingContactQrHint)}
          </div>
          ${settingInput('弹窗底部说明', 'floatingContactNote', settings.floatingContactNote, '', true)}
        </div>
        <div class="settings-form-actions">
          <button class="primary-button" type="submit"><span class="button-label">保存悬浮联系</span><span class="button-loading" hidden>正在保存...</span></button>
        </div>
      </form>
    `;
  }
  if (tab === 'text') {
    const uiText = settings.uiText || {};
    const groups = state.contentSchema?.groups || [];
    return `
      <form id="settingsForm">
        <div class="settings-section-title"><b>文</b><div><h3>前台所有公共文字</h3><p>项目名称、项目介绍和分类介绍分别在对应管理模块维护</p></div></div>
        <div class="site-text-note">
          提示文案中的 <code>{file}</code>、<code>{limit}</code> 是动态变量，保存时请保留占位符。
        </div>
        <div class="site-text-groups">
          ${groups.map((group, index) => `
            <details class="site-text-group" ${index < 2 ? 'open' : ''}>
              <summary>
                <span><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.description)}</small></span>
                <b>${group.fields.length} 项</b>
              </summary>
              <div class="site-text-fields">
                ${group.fields.map((field) => {
                  const value = uiText[field.key] ?? '';
                  if (field.type === 'textarea') {
                    return `
                      <label class="admin-field">
                        <span>${escapeHtml(field.label)}</span>
                        <textarea rows="3" maxlength="${field.max}" data-ui-key="${escapeHtml(field.key)}">${escapeHtml(value)}</textarea>
                        <small>${escapeHtml(field.key)} · 最多 ${field.max} 字</small>
                      </label>
                    `;
                  }
                  return `
                    <label class="admin-field">
                      <span>${escapeHtml(field.label)}</span>
                      <input type="text" maxlength="${field.max}" value="${escapeHtml(value)}" data-ui-key="${escapeHtml(field.key)}">
                      <small>${escapeHtml(field.key)} · 最多 ${field.max} 字</small>
                    </label>
                  `;
                }).join('')}
              </div>
            </details>
          `).join('')}
        </div>
        <div class="settings-form-actions">
          <button class="primary-button" type="submit"><span class="button-label">保存全站文字</span><span class="button-loading" hidden>正在保存...</span></button>
        </div>
      </form>
    `;
  }

  return `
    <form id="settingsForm">
      <div class="settings-section-title"><b>01</b><div><h3>首屏内容</h3><p>访客打开站点后第一眼看到的核心信息</p></div></div>
      <label class="admin-field">
        <span>首屏精选项目</span>
        <select name="featuredProjectId">
          <option value="">自动选择排序第一的已上架项目</option>
          ${(state.featuredProjectOptions || []).map((project) => `
            <option value="${project.id}" ${Number(settings.featuredProjectId) === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>
          `).join('')}
        </select>
        <small>只显示当前已上架项目；所选项目下架后将自动回退到排序第一的项目</small>
      </label>
      ${settingInput('首屏眉题', 'heroEyebrow', settings.heroEyebrow)}
      ${settingInput('主标题', 'heroTitle', settings.heroTitle, '使用换行控制两行标题', true)}
      ${settingInput('副标题', 'heroSubtitle', settings.heroSubtitle, '', true)}
      ${settingInput('信任背书', 'heroTrust', settings.heroTrust, '', true)}
      ${settingTextarea('首屏特点标签', 'heroHighlights', (settings.heroHighlights || []).join('\n'), '每行一个，建议 3-6 项')}
      ${settingInput('价值主张金句', 'serviceStatement', settings.serviceStatement, '', true)}

      <div class="settings-section-title" style="margin-top:28px"><b>02</b><div><h3>信任保障区</h3><p>说明服务优势、落地支持与更新承诺</p></div></div>
      ${settingInput('保障区标题', 'trustHeading', settings.trustHeading, '可使用换行控制展示', true)}
      ${settingInput('保障区说明', 'trustSubtitle', settings.trustSubtitle, '', true)}
      <div class="admin-field">
        <span>保障要点</span>
        <div class="repeater-list" id="trustPointRepeater">
          ${(settings.trustPoints || []).map((point) => trustPointItem(point)).join('')}
        </div>
        <button class="add-repeater" type="button" id="addTrustPoint">+ 添加保障要点</button>
      </div>

      <div class="settings-section-title" style="margin-top:28px"><b>03</b><div><h3>合作流程</h3><p>让访客了解从咨询到交付的完整路径</p></div></div>
      ${settingInput('流程标题', 'processTitle', settings.processTitle)}
      <div class="admin-field">
        <span>流程步骤</span>
        <div class="repeater-list" id="processStepRepeater">
          ${(settings.processSteps || []).map((step) => processStepItem(step)).join('')}
        </div>
        <button class="add-repeater" type="button" id="addProcessStep">+ 添加流程步骤</button>
      </div>
      <div class="settings-form-actions">
        <button class="primary-button" type="submit"><span class="button-label">保存首页内容</span><span class="button-loading" hidden>正在保存...</span></button>
      </div>
    </form>
  `;
}

function settingInput(label, name, value, placeholder = '', textarea = false) {
  if (textarea) {
    return `
      <label class="admin-field">
        <span>${escapeHtml(label)}</span>
        <textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>
      </label>
    `;
  }
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input type="text" name="${name}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}">
    </label>
  `;
}

function settingTextarea(label, name, value, hint = '') {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function trustPointItem(point = {}) {
  return `
    <div class="repeater-item" data-repeater-item="trust">
      <label class="admin-field"><span>序号</span><input data-key="index" value="${escapeHtml(point.index || '')}" maxlength="8" placeholder="01"></label>
      <label class="admin-field"><span>标题</span><input data-key="title" value="${escapeHtml(point.title || '')}" maxlength="80" placeholder="保障要点标题"></label>
      <label class="admin-field"><span>说明</span><input data-key="description" value="${escapeHtml(point.description || '')}" maxlength="400" placeholder="说明服务优势或落地支持"></label>
      <button class="remove-repeater" type="button" data-remove-repeater aria-label="删除此项"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
  `;
}

function processStepItem(step = {}) {
  return `
    <div class="repeater-item process" data-repeater-item="process">
      <label class="admin-field"><span>步骤标题</span><input data-key="title" value="${escapeHtml(step.title || '')}" maxlength="80" placeholder="例如：评估与演示"></label>
      <label class="admin-field"><span>步骤说明</span><input data-key="description" value="${escapeHtml(step.description || '')}" maxlength="300" placeholder="简要说明这一步会发生什么"></label>
      <button class="remove-repeater" type="button" data-remove-repeater aria-label="删除此项"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
  `;
}

function settingsAside(tab) {
  const content = {
    content: {
      kicker: 'CONTENT TIPS',
      title: '让项目看起来可信，也说清楚边界',
      text: '首屏优先描述业务价值，不使用无法验证的夸张数字。详细介绍与文件内容保持一致，合作承诺以最终方案为准。',
      tips: ['标题尽量控制在两行以内', '信任背书说明实际服务方式', '项目内容在项目管理中单独维护']
    },
    site: {
      kicker: 'SITE INFO',
      title: '建立清晰、可核验的联系方式',
      text: '建议填写真实可用的合作电话和微信，备案号需在上线前替换为实际备案信息。',
      tips: ['站点名称会同步用于前台品牌', '联系方式旁可补充响应时间', '备案号上线前必须核对']
    },
    widget: {
      kicker: 'CONTACT WIDGET',
      title: '让访客随时找到项目顾问',
      text: '浮标固定在页面右侧，不影响正文阅读。二维码和管理员标识建议使用清晰正方形图片，上传后点击保存即可推送前台。',
      tips: ['二维码支持 JPG、PNG、WEBP', '管理员图片为空时显示名称首字', '关闭开关可完全隐藏浮标']
    },
    download: {
      kicker: 'DOWNLOAD RULES',
      title: '在获取线索与下载体验之间取平衡',
      text: '需要高质量线索时，可开启下载前留资；如果更重视资料传播，可保持直接下载并设置合理的 IP 限制。',
      tips: ['软件与资料文件分别统计下载量', '下载链接为一次性短效链接', '文件替换后旧链接自动失效']
    },
    text: {
      kicker: 'GLOBAL TEXT',
      title: '所有公共界面文字集中管理',
      text: '项目名称、项目介绍、分类名称与首页长文案在其他专用模块中维护；本页覆盖导航、按钮、表单、弹层、页脚和操作提示。',
      tips: ['保存后通过 SSE 即时同步', '非浏览器限制的错误提示由系统安全校验返回', '动态变量占位符需要保留']
    }
  }[tab];
  return `
    <span>${content.kicker}</span>
    <h3>${content.title}</h3>
    <p>${content.text}</p>
    <div class="settings-tip-list">${content.tips.map((tip) => `<span><i></i>${tip}</span>`).join('')}</div>
  `;
}

function collectRepeater(selector) {
  return [...document.querySelectorAll(`${selector} [data-repeater-item]`)].map((item) => ({
    ...Object.fromEntries([...item.querySelectorAll('[data-key]')].map((input) => [input.dataset.key, input.value.trim()])),
    index: item.querySelector('[data-key="index"]')?.value.trim() || ''
  })).filter((item) => item.title || item.description);
}

function bindSettingsForm(tab) {
  const form = byId('settingsForm');
  if (!form) return;
  document.querySelectorAll('[data-remove-repeater]').forEach((button) => {
    button.addEventListener('click', () => button.closest('[data-repeater-item]')?.remove());
  });
  byId('addTrustPoint')?.addEventListener('click', () => {
    const container = byId('trustPointRepeater');
    if (container.children.length >= 6) {
      adminToast('信任保障要点最多 6 项', 'error');
      return;
    }
    const index = String(container.children.length + 1).padStart(2, '0');
    container.insertAdjacentHTML('beforeend', trustPointItem({ index }));
    container.lastElementChild.querySelector('[data-remove-repeater]').addEventListener('click', (event) => {
      event.currentTarget.closest('[data-repeater-item]')?.remove();
    });
  });
  byId('addProcessStep')?.addEventListener('click', () => {
    const container = byId('processStepRepeater');
    if (container.children.length >= 8) {
      adminToast('合作流程最多 8 步', 'error');
      return;
    }
    container.insertAdjacentHTML('beforeend', processStepItem());
    container.lastElementChild.querySelector('[data-remove-repeater]').addEventListener('click', (event) => {
      event.currentTarget.closest('[data-repeater-item]')?.remove();
    });
  });

  if (tab === 'widget') {
    bindWidgetImageEditor(form);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setButtonBusy(form, true);
    let payload = {};
    if (tab === 'site') {
      ['siteName', 'brandShort', 'documentTitle', 'contactPhone', 'contactWechat', 'contactHours',
        'contactEyebrow', 'contactSectionIndex', 'contactSectionLabel', 'contactTitle',
        'contactSubtitle', 'contactNotice', 'footerCopyright', 'icpNumber']
        .forEach((name) => { payload[name] = form.elements[name].value.trim(); });
    } else if (tab === 'download') {
      payload = {
        downloadRequireLead: form.elements.downloadRequireLead.checked,
        downloadDailyLimit: Number(form.elements.downloadDailyLimit.value || 0)
      };
    } else if (tab === 'text') {
      payload.uiText = Object.fromEntries(
        [...form.querySelectorAll('[data-ui-key]')].map((input) => [
          input.dataset.uiKey,
          input.value
        ])
      );
    } else if (tab === 'widget') {
      [
        'floatingContactLabel', 'floatingContactTitle', 'floatingContactDescription',
        'floatingContactEyebrow', 'floatingContactAdminName', 'floatingContactAdminTitle',
        'floatingContactBadge', 'floatingContactQrHint', 'floatingContactNote'
      ].forEach((name) => {
        payload[name] = form.elements[name].value.trim();
      });
      payload.floatingContactEnabled = form.elements.floatingContactEnabled.checked;
      payload.floatingContactQrUrl = form.elements.floatingContactQrUrl.value;
      payload.floatingContactAdminImageUrl = form.elements.floatingContactAdminImageUrl.value;
    } else {
      ['heroEyebrow', 'heroTitle', 'heroSubtitle', 'heroTrust', 'serviceStatement',
        'trustHeading', 'trustSubtitle', 'processTitle']
        .forEach((name) => { payload[name] = form.elements[name].value.trim(); });
      payload.heroHighlights = form.elements.heroHighlights.value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      payload.trustPoints = collectRepeater('#trustPointRepeater');
      payload.processSteps = collectRepeater('#processStepRepeater');
      payload.featuredProjectId = form.elements.featuredProjectId.value
        ? Number(form.elements.featuredProjectId.value)
        : null;
    }
    try {
      const response = await adminApi('/api/admin/settings', { method: 'PATCH', body: payload });
      state.settings = response.data;
      adminToast('配置已保存，前台已同步生效', 'success');
    } catch (error) {
      adminToast(error.message || '保存失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });
}

function bindWidgetImageEditor(form) {
  const imageConfig = {
    qr: {
      input: byId('widgetQrInput'),
      preview: byId('widgetQrPreview'),
      field: 'floatingContactQrUrl',
      fallback: appPath('/assets/contact-qr-placeholder.svg'),
      label: '联系二维码'
    },
    admin: {
      input: byId('widgetAdminInput'),
      preview: byId('widgetAdminPreview'),
      field: 'floatingContactAdminImageUrl',
      fallback: appPath('/assets/admin-emblem.svg'),
      label: '管理员标识'
    }
  };

  for (const config of Object.values(imageConfig)) {
    if (!config.input) continue;
    config.input.addEventListener('change', async () => {
      const file = config.input.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        adminToast('仅支持 JPG、PNG 或 WEBP 图片', 'error');
        config.input.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        adminToast('图片不能超过 5MB', 'error');
        config.input.value = '';
        return;
      }
      const data = new FormData();
      data.append('file', file);
      adminToast(`正在上传${config.label}...`);
      try {
        const upload = await adminApi('/api/admin/upload/widget-image', { method: 'POST', body: data });
        await adminApi('/api/admin/settings', {
          method: 'PATCH',
          body: { [config.field]: upload.data.url }
        });
        state.settings = { ...state.settings, [config.field]: upload.data.url };
        form.elements[config.field].value = upload.data.url;
        config.preview.src = appPath(upload.data.url);
        adminToast(`${config.label}已更新，前台已同步`, 'success');
      } catch (error) {
        adminToast(error.message || `${config.label}上传失败`, 'error');
      } finally {
        config.input.value = '';
      }
    });
  }

  document.querySelectorAll('[data-remove-widget-image]').forEach((button) => {
    button.addEventListener('click', async () => {
      const type = button.dataset.removeWidgetImage;
      const config = imageConfig[type];
      if (!config) return;
      try {
        await adminApi('/api/admin/settings', {
          method: 'PATCH',
          body: { [config.field]: '' }
        });
        state.settings = { ...state.settings, [config.field]: '' };
        form.elements[config.field].value = '';
        config.preview.src = config.fallback;
        adminToast(`${config.label}已清除，前台已同步`, 'success');
      } catch (error) {
        adminToast(error.message || '清除失败', 'error');
      }
    });
  });
}

async function renderAdminsView(token) {
  const response = await adminApi('/api/admin/admins');
  if (token !== state.renderToken) return;
  const admins = response.data;
  const root = byId('viewRoot');
  root.innerHTML = `
    <div class="view-toolbar">
      <div class="view-toolbar-left"><div><h2>后台账号</h2><p>共 ${admins.length} 个管理员，按最小权限原则分配功能</p></div></div>
      <button class="primary-button" type="button" id="newAdminButton">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        新增子管理员
      </button>
    </div>
    <div class="admin-account-grid">
      ${admins.map((admin) => adminAccountCard(admin)).join('')}
    </div>
  `;
  byId('newAdminButton').addEventListener('click', () => openAdminEditor());
  root.querySelectorAll('[data-admin-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.adminId);
      const admin = admins.find((item) => item.id === id);
      if (!admin) return;
      if (button.dataset.adminAction === 'edit') openAdminEditor(admin);
      if (button.dataset.adminAction === 'delete') {
        confirmAction({
          title: '删除管理员账号',
          text: `确定删除“${admin.displayName}（${admin.username}）”吗？该账号将立即无法登录后台。`,
          callback: async () => {
            try {
              await adminApi(`/api/admin/admins/${id}`, { method: 'DELETE' });
              adminToast('管理员账号已删除', 'success');
              renderCurrentView();
            } catch (error) {
              adminToast(error.message || '账号删除失败', 'error');
            }
          }
        });
      }
    });
  });
}

function adminAccountCard(admin) {
  const isCurrent = state.user.id === admin.id;
  return `
    <article class="admin-account-card">
      <div class="admin-account-head">
        <span class="admin-account-avatar">${escapeHtml((admin.displayName || admin.username).slice(0, 1))}</span>
        <div><h3>${escapeHtml(admin.displayName)} ${isCurrent ? '<small class="muted-text">（当前账号）</small>' : ''}</h3><p>@${escapeHtml(admin.username)}</p></div>
        <span class="admin-role-badge">${admin.isSuper ? '超级管理员' : '子管理员'}</span>
      </div>
      <div class="admin-account-meta">
        <span>${admin.active ? '<span class="status-pill published">账号启用</span>' : '<span class="status-pill hidden">账号停用</span>'}</span>
        <span>最近登录：${admin.lastLoginAt ? formatDateShort(admin.lastLoginAt) : '尚未登录'}</span>
      </div>
      <div class="admin-permission-tags">
        ${admin.isSuper
          ? '<span>全部运营权限</span><span>账号管理</span>'
          : admin.permissions.map((permission) => `<span>${permissionLabels[permission] || permission}</span>`).join('')}
      </div>
      <div class="admin-card-actions">
        <button class="action-link" type="button" data-admin-action="edit" data-admin-id="${admin.id}">编辑账号</button>
        ${!admin.isSuper ? `<button class="action-link danger" type="button" data-admin-action="delete" data-admin-id="${admin.id}">删除</button>` : ''}
      </div>
    </article>
  `;
}

function openAdminEditor(admin = null) {
  const form = byId('adminForm');
  form.reset();
  form.elements.id.value = admin?.id || '';
  form.elements.username.value = admin?.username || '';
  form.elements.username.disabled = Boolean(admin);
  form.elements.displayName.value = admin?.displayName || '';
  form.elements.password.value = '';
  form.elements.password.required = !admin;
  form.elements.active.checked = admin?.active !== false;
  form.elements.active.disabled = Boolean(admin?.isSuper);
  [...form.querySelectorAll('input[name="permissions"]')].forEach((input) => {
    input.checked = Boolean(admin?.permissions?.includes(input.value));
    input.disabled = Boolean(admin?.isSuper);
  });
  const permissionField = form.querySelector('.permissions-field');
  permissionField.hidden = Boolean(admin?.isSuper);
  setText('adminDialogTitle', admin ? '编辑管理员账号' : '新增子管理员');
  setText('adminPasswordLabel', admin ? '重置密码（选填）' : '初始密码');
  setText('adminPasswordHint', admin ? '留空表示不修改当前密码' : '子管理员首次登录后应修改密码');
  form.elements.password.placeholder = admin ? '留空则不修改密码' : '至少 8 位，需包含字母和数字';
  byId('adminDialog').showModal();
  updateModalLock();
}

function bindAdminFormEvents() {
  const form = byId('adminForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const permissions = [...form.querySelectorAll('input[name="permissions"]:checked')].map((input) => input.value);
    if (!form.elements.id.value && permissions.length === 0) {
      adminToast('请至少分配一项操作权限', 'error');
      return;
    }
    setButtonBusy(form, true);
    const id = form.elements.id.value;
    const payload = {
      displayName: form.elements.displayName.value.trim(),
      permissions,
      active: form.elements.active.checked
    };
    if (!id) payload.username = form.elements.username.value.trim();
    if (form.elements.password.value) payload.password = form.elements.password.value;
    try {
      await adminApi(id ? `/api/admin/admins/${id}` : '/api/admin/admins', {
        method: id ? 'PATCH' : 'POST',
        body: payload
      });
      adminToast(id ? '管理员账号已更新' : '子管理员账号已创建', 'success');
      closeDialog('adminDialog');
      if (id && Number(id) === state.user.id) {
        const me = await adminApi('/api/admin/auth/me');
        state.user = me.data.user;
        updateUserInterface();
      }
      renderCurrentView();
    } catch (error) {
      adminToast(error.message || '账号保存失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });
}

function bindPasswordFormEvents() {
  const form = byId('passwordForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {
      adminToast('两次输入的新密码不一致', 'error');
      return;
    }
    setButtonBusy(form, true);
    try {
      await adminApi('/api/admin/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: form.elements.currentPassword.value,
          newPassword: form.elements.newPassword.value
        }
      });
      form.reset();
      closeDialog('passwordDialog');
      adminToast('登录密码已修改', 'success');
    } catch (error) {
      adminToast(error.message || '密码修改失败', 'error');
    } finally {
      setButtonBusy(form, false);
    }
  });
}

initialize();

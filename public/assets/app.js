import { api, appPath, escapeHtml, formatBytes, toast } from './api.js';

const state = {
  settings: {},
  categories: [],
  projects: [],
  metrics: {},
  activeCategory: 'all',
  currentProject: null,
  pendingFile: null,
  filePickerType: null
};
let siteFingerprint = '';
let lastSiteSync = 0;
let liveSyncTimer = null;

const fileIcons = {
  software: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 19h14"/></svg>',
  document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>'
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value ?? '');
}

function renderMultiline(element, value) {
  if (!element) return;
  const lines = String(value ?? '').split(/\n+/);
  element.replaceChildren();
  lines.forEach((line, index) => {
    if (index > 0) element.append(document.createElement('br'));
    element.append(document.createTextNode(line));
  });
}

function safeCover(value) {
  const url = String(value || '');
  return url.startsWith('/') && !url.startsWith('//') ? appPath(url) : appPath('/assets/favicon.svg');
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function uiText(key, fallback = '') {
  const value = state.settings.uiText?.[key];
  return typeof value === 'string' ? value : fallback;
}

function applyUiTemplate(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined ? match : String(values[key])
  ));
}

function applyUiText() {
  document.querySelectorAll('[data-content-key]').forEach((element) => {
    if (element.id === 'leadFileName' && state.pendingFile?.file) return;
    const value = uiText(element.dataset.contentKey);
    element.textContent = value;
  });
  document.querySelectorAll('[data-content-placeholder]').forEach((element) => {
    const value = uiText(element.dataset.contentPlaceholder);
    element.placeholder = value;
  });
  document.querySelectorAll('[data-content-default]').forEach((element) => {
    const value = uiText(element.dataset.contentDefault);
    const previousDefault = element.defaultValue;
    element.defaultValue = value;
    if (!element.value || element.value === previousDefault) element.value = value;
  });
  if (state.currentProject && byId('projectDialog')?.open) {
    updateDetailButtons(state.currentProject);
  }
  if (byId('fileDialog')?.open && state.filePickerType) {
    setText(
      'fileDialogTitle',
      state.filePickerType === 'software'
        ? uiText('detail.softwarePickerTitle')
        : state.filePickerType === 'document'
          ? uiText('detail.documentPickerTitle')
          : uiText('detail.linkPickerTitle')
    );
  }
}

async function init() {
  bindStaticEvents();
  setupReveal();
  setupNavigation();
  try {
    await loadSiteData();
    trackVisit();
    connectLiveUpdates();
    window.setInterval(() => syncSiteData(), 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSiteSync > 30_000) {
        syncSiteData();
      }
    });
  } catch (error) {
    renderBootstrapError(error);
  }
}

async function loadSiteData() {
  const response = await api('/api/public/bootstrap');
  const data = response.data;
  const fingerprint = JSON.stringify({
    settings: data.settings,
    categories: data.categories,
    projects: data.projects,
    metrics: data.metrics
  });
  const changed = fingerprint !== siteFingerprint;
  siteFingerprint = fingerprint;
  lastSiteSync = Date.now();
  if (changed) {
    state.settings = data.settings || {};
    state.categories = data.categories || [];
    state.projects = data.projects || [];
    state.metrics = data.metrics || {};
    if (
      state.activeCategory !== 'all'
      && !state.categories.some((category) => String(category.id) === String(state.activeCategory))
    ) {
      state.activeCategory = 'all';
    }
    applySiteContent();
    renderFeaturedProject();
    renderCategories();
    renderProjects();
  }
  if (byId('projectDialog')?.open && state.currentProject) {
    await refreshOpenProjectDetail();
  }
  return changed;
}

async function syncSiteData() {
  if (document.visibilityState !== 'visible') return;
  try {
    await loadSiteData();
  } catch {
    // 后台短时不可用时不打断访客当前操作，下一轮再同步。
  }
}

function connectLiveUpdates() {
  if (!('EventSource' in window)) return;
  const source = new EventSource(appPath('/api/public/events'));
  source.addEventListener('connected', () => {
    document.documentElement.dataset.liveStatus = 'connected';
    syncSiteData();
  });
  source.addEventListener('site-update', () => {
    window.clearTimeout(liveSyncTimer);
    liveSyncTimer = window.setTimeout(() => syncSiteData(), 120);
  });
  source.addEventListener('error', () => {
    document.documentElement.dataset.liveStatus = 'reconnecting';
  });
}

function applySiteContent() {
  const settings = state.settings;
  document.title = settings.documentTitle || settings.siteName || '傅先生AI项目VIP';
  document.querySelectorAll('.brand-text').forEach((node) => {
    node.textContent = settings.siteName || '傅先生AI项目VIP';
  });
  const description = document.querySelector('meta[name="description"]');
  if (description && settings.heroSubtitle) description.content = settings.heroSubtitle;

  setText('heroEyebrow', settings.heroEyebrow);
  renderMultiline(byId('heroTitle'), settings.heroTitle);
  setText('heroSubtitle', settings.heroSubtitle);
  setText('heroTrust', settings.heroTrust);
  setText('serviceStatement', settings.serviceStatement);
  setText('trustHeading', settings.trustHeading);
  setText('trustSubtitle', settings.trustSubtitle);
  renderMultiline(byId('trustHeading'), settings.trustHeading);
  setText('processTitle', settings.processTitle);
  setText('contactEyebrow', settings.contactEyebrow);
  setText('contactSectionIndex', settings.contactSectionIndex);
  setText('contactSectionLabel', settings.contactSectionLabel);
  renderMultiline(byId('contactTitle'), settings.contactTitle);
  setText('contactSubtitle', settings.contactSubtitle);
  setText('contactPhone', settings.contactPhone);
  setText('contactWechat', settings.contactWechat);
  setText('contactHours', settings.contactHours);
  setText('contactNotice', settings.contactNotice);
  setText('footerCopyright', settings.footerCopyright);
  setText('icpNumber', settings.icpNumber);
  applyUiText();
  renderFloatingContact();

  const highlights = byId('heroHighlights');
  if (highlights) {
    highlights.replaceChildren();
    (settings.heroHighlights || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      highlights.append(li);
    });
  }

  const trustPoints = byId('trustPoints');
  if (trustPoints) {
    trustPoints.replaceChildren();
    for (const [index, point] of (settings.trustPoints || []).entries()) {
      const article = document.createElement('article');
      article.className = 'trust-card';
      const icon = index % 3 === 0
        ? '<path d="M4 19V5h16v14H4Z"/><path d="M8 9h8M8 13h5"/>'
        : index % 3 === 1
          ? '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'
          : '<path d="M20 7h-9M14 17H5M17 4l3 3-3 3M7 14l-3 3 3 3"/>';
      article.innerHTML = `
        <span class="trust-number">${escapeHtml(point.index || String(index + 1).padStart(2, '0'))}</span>
        <div class="trust-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></div>
        <h3>${escapeHtml(point.title)}</h3>
        <p>${escapeHtml(point.description)}</p>
      `;
      trustPoints.append(article);
    }
  }

  const processSteps = byId('processSteps');
  if (processSteps) {
    processSteps.replaceChildren();
    (settings.processSteps || []).forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'process-item';
      item.innerHTML = `
        <b>${String(index + 1).padStart(2, '0')}</b>
        <h4>${escapeHtml(step.title)}</h4>
        <p>${escapeHtml(step.description)}</p>
      `;
      processSteps.append(item);
    });
  }

  setText('metricProjects', state.metrics.publishedProjects ?? state.projects.length);
  setText('metricCategories', state.metrics.categories ?? state.categories.length);
}

function renderFeaturedProject() {
  const selectedId = Number(state.settings.featuredProjectId || 0);
  const project = state.projects.find((item) => Number(item.id) === selectedId) || state.projects[0];
  const container = byId('heroFeatured');
  if (!container) return;
  container.onclick = null;
  container.onkeydown = null;
  if (!project) {
    container.innerHTML = `
      <div class="panel-topline"><span>${escapeHtml(uiText('hero.featuredLabel'))}</span><span class="live-state"><i></i> ${escapeHtml(uiText('hero.featuredStatus'))}</span></div>
      <div class="panel-project-info" style="padding:55px 18px 38px">
        <span class="panel-category">${escapeHtml(uiText('hero.featuredCategory'))}</span>
        <h2>${escapeHtml(uiText('hero.featuredLoadingTitle'))}</h2>
        <p>${escapeHtml(uiText('hero.featuredLoadingDesc'))}</p>
      </div>
    `;
    container.onclick = () => scrollToSection('contact');
    return;
  }
  container.innerHTML = `
    <div class="panel-topline">
      <span>${escapeHtml(uiText('hero.featuredLabel'))}</span>
      <span class="live-state"><i></i> ${escapeHtml(uiText('hero.featuredStatus'))}</span>
    </div>
    <div class="panel-cover">
      <img src="${escapeHtml(safeCover(project.coverUrl))}" alt="${escapeHtml(project.name)} 项目封面" loading="eager">
    </div>
    <div class="panel-project-info">
      <span class="panel-category">${escapeHtml(project.categoryName)}</span>
      <h2>${escapeHtml(project.name)}</h2>
      <p>${escapeHtml(project.slogan)}</p>
    </div>
    <div class="panel-footer">
      <span>${escapeHtml(uiText('hero.featuredFooter'))}</span>
      <span class="panel-arrow">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4"/></svg>
      </span>
    </div>
  `;
  container.setAttribute('role', 'button');
  container.setAttribute('tabindex', '0');
  container.setAttribute('aria-label', `查看项目：${project.name}`);
  const open = () => openProject(project.id);
  container.onclick = open;
  container.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
}

function renderFloatingContact() {
  const settings = state.settings;
  const button = byId('floatingContactButton');
  const dialog = byId('contactQrDialog');
  if (!button) return;
  const enabled = Boolean(settings.floatingContactEnabled);
  button.hidden = !enabled;
  if (!enabled && dialog?.open) dialog.close();
  if (!enabled) return;

  const label = settings.floatingContactLabel || '联系顾问';
  setText('floatingContactLabel', label);
  button.setAttribute('aria-label', label);
  setText('floatingContactEyebrow', settings.floatingContactEyebrow);
  setText('floatingContactTitle', settings.floatingContactTitle);
  setText('floatingContactDescription', settings.floatingContactDescription);
  setText('floatingContactQrHint', settings.floatingContactQrHint);
  setText('floatingContactAdminName', settings.floatingContactAdminName);
  setText('floatingContactAdminTitle', settings.floatingContactAdminTitle);
  setText('floatingContactBadge', settings.floatingContactBadge);
  setText('floatingContactNote', settings.floatingContactNote);

  const qr = byId('floatingContactQr');
  if (qr) {
    qr.src = settings.floatingContactQrUrl
      ? safeCover(settings.floatingContactQrUrl)
      : '/assets/contact-qr-placeholder.svg';
  }

  const adminImage = byId('floatingContactAdminImage');
  const fallback = byId('floatingContactAdminFallback');
  const adminName = settings.floatingContactAdminName || 'F';
  if (fallback) fallback.textContent = adminName.slice(0, 1);
  if (adminImage) {
    if (settings.floatingContactAdminImageUrl) {
      adminImage.src = safeCover(settings.floatingContactAdminImageUrl);
      adminImage.hidden = false;
      if (fallback) fallback.hidden = true;
    } else {
      adminImage.removeAttribute('src');
      adminImage.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }
}

function renderCategories() {
  const container = byId('categoryFilter');
  if (!container) return;
  const counts = new Map();
  for (const project of state.projects) {
    counts.set(project.categoryId, (counts.get(project.categoryId) || 0) + 1);
  }
  const buttons = [
    `<button class="category-button ${state.activeCategory === 'all' ? 'active' : ''}" type="button" data-category="all">
      <span>${escapeHtml(uiText('projects.allFilter'))}</span><b>${state.projects.length}</b>
    </button>`,
    ...state.categories.map((category) => `
      <button class="category-button ${String(state.activeCategory) === String(category.id) ? 'active' : ''}" type="button" data-category="${category.id}">
        <span>${escapeHtml(category.name)}</span><b>${counts.get(category.id) || 0}</b>
      </button>
    `)
  ];
  container.innerHTML = buttons.join('');
  setText('allProjectCount', state.projects.length);
}

function renderProjects() {
  const grid = byId('projectGrid');
  if (!grid) return;
  const filtered = state.activeCategory === 'all'
    ? state.projects
    : state.projects.filter((project) => String(project.categoryId) === String(state.activeCategory));

  const category = state.categories.find((item) => String(item.id) === String(state.activeCategory));
  setText(
    'categoryDescription',
    category?.description || uiText('projects.defaultCategoryDesc')
  );

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-projects">
        <div>
          <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 12h32v28H8zM8 20h32M17 7v10M31 7v10"/></svg>
          <h3>${escapeHtml(uiText('projects.emptyTitle'))}</h3>
          <p>${escapeHtml(uiText('projects.emptyDesc'))}</p>
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((project, index) => {
    const tags = (project.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    return `
      <article class="project-card" data-project-card="${project.id}">
        <div class="card-cover">
          <img src="${escapeHtml(safeCover(project.coverUrl))}" alt="${escapeHtml(project.name)} 项目封面" loading="lazy">
          <span class="card-category">${escapeHtml(project.categoryName)}</span>
          <span class="card-index">${escapeHtml(uiText('projects.cardPrefix'))} / ${String(index + 1).padStart(2, '0')}</span>
        </div>
        <div class="card-body">
          <h3>${escapeHtml(project.name)}</h3>
          <p class="card-slogan">${escapeHtml(project.slogan)}</p>
          <div class="card-tags">${tags}</div>
          <div class="card-divider"></div>
          <div class="card-footer">
            <div class="card-file-stats">
              <span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 19h14"/></svg>
                ${project.softwareCount || 0} ${escapeHtml(uiText('projects.softwareUnit'))}
              </span>
              <span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/></svg>
                ${project.documentCount || 0} ${escapeHtml(uiText('projects.documentUnit'))}
              </span>
              ${project.linkCount > 0 ? `
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>
                  ${project.linkCount} ${escapeHtml(uiText('projects.linkUnit'))}
                </span>
              ` : ''}
            </div>
            <button class="card-view-button" type="button" data-open-project="${project.id}">
              <span>${escapeHtml(uiText('projects.cardAction'))}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4"/></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function openProject(projectId) {
  try {
    const response = await api(`/api/public/projects/${projectId}`);
    const project = applyProjectDetail(response.data);
    const dialog = byId('projectDialog');
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('dialog-open');
    api('/api/public/track', {
      method: 'POST',
      body: { type: 'project_view', projectId: project.id, path: `/#project-${project.id}` }
    }).catch(() => {});
  } catch (error) {
    toast(error.message || uiText('messages.detailLoadFailed'), 'error');
  }
}

function applyProjectDetail(project) {
  state.currentProject = project;
  setText('detailCategory', project.categoryName);
  setText('detailTitle', project.name);
  setText('detailSlogan', project.slogan);
  setText('detailDescription', project.description);

  const cover = byId('detailCover');
  cover.src = safeCover(project.coverUrl);
  cover.alt = `${project.name}项目封面`;

  const tags = byId('detailTags');
  tags.replaceChildren();
  (project.tags || []).forEach((tag) => {
    const span = document.createElement('span');
    span.textContent = tag;
    tags.append(span);
  });

  const highlights = byId('detailHighlights');
  highlights.replaceChildren();
  (project.highlights || []).forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    highlights.append(item);
  });

  renderDetailFiles(project);
  updateDetailButtons(project);
  return project;
}

async function refreshOpenProjectDetail() {
  if (!state.currentProject) return;
  try {
    const response = await api(`/api/public/projects/${state.currentProject.id}`);
    applyProjectDetail(response.data);
  } catch {
    byId('projectDialog')?.close();
    state.currentProject = null;
  }
}

function renderDetailFiles(project) {
  const list = byId('detailFileList');
  const files = project.files || [];
  const links = project.links || [];
  setText(
    'detailFileCount',
    `${files.length} ${uiText('detail.fileCountSuffix')} · ${links.length} ${uiText('detail.linkCountSuffix')}`
  );
  if (files.length === 0 && links.length === 0) {
    list.innerHTML = `<div class="file-empty">${escapeHtml(uiText('detail.noFiles'))}</div>`;
    return;
  }
  list.innerHTML = files.map((file) => fileRowTemplate(file)).join('')
    + links.map((link) => linkRowTemplate(link)).join('');
}

function fileRowTemplate(file) {
  return `
    <div class="file-row">
      <span class="file-icon">${fileIcons[file.type] || fileIcons.document}</span>
      <span class="file-info">
        <strong title="${escapeHtml(file.displayName)}">${escapeHtml(file.displayName)}</strong>
        <span>${escapeHtml(file.type === 'software' ? uiText('detail.fileTypeSoftware') : uiText('detail.fileTypeDocument'))} · ${formatBytes(file.size)}</span>
      </span>
      <button class="file-download" type="button" data-download-file="${file.id}">
        <span>${escapeHtml(uiText('detail.downloadAction'))}</span>
        ${fileIcons.software}
      </button>
    </div>
  `;
}

function linkRowTemplate(link) {
  const url = safeExternalUrl(link.url);
  if (!url) return '';
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // safeExternalUrl 已校验，这里仅用于展示域名。
  }
  return `
    <div class="file-row">
      <span class="file-icon">${fileIcons.link}</span>
      <span class="file-info">
        <strong title="${escapeHtml(link.displayName)}">${escapeHtml(link.displayName)}</strong>
        <span>${escapeHtml(uiText('detail.linkType'))} · ${escapeHtml(host)}</span>
      </span>
      <a class="file-download" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <span>${escapeHtml(uiText('detail.linkAction'))}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></svg>
      </a>
    </div>
  `;
}

function updateDetailButtons(project) {
  const software = (project.files || []).filter((file) => file.type === 'software');
  const documents = (project.files || []).filter((file) => file.type === 'document');
  const links = project.links || [];
  const softwareButton = byId('detailSoftwareButton');
  const documentButton = byId('detailDocumentButton');
  const linkButton = byId('detailLinkButton');
  softwareButton.disabled = software.length === 0;
  documentButton.disabled = documents.length === 0;
  linkButton.disabled = links.length === 0;
  softwareButton.querySelector('span').textContent = software.length > 1
    ? `${uiText('detail.softwareAction')} (${software.length})`
    : uiText('detail.softwareAction');
  documentButton.querySelector('span').textContent = documents.length > 1
    ? `${uiText('detail.documentAction')} (${documents.length})`
    : uiText('detail.documentAction');
  linkButton.querySelector('span').textContent = links.length > 1
    ? `${uiText('detail.linkAction')} (${links.length})`
    : uiText('detail.linkAction');
}

function chooseFile(type) {
  const project = state.currentProject;
  if (!project) return;
  const files = (project.files || []).filter((file) => file.type === type);
  if (files.length === 0) {
    toast(type === 'software' ? uiText('messages.softwareUnavailable') : uiText('messages.documentUnavailable'));
    return;
  }
  if (files.length === 1) {
    beginDownload(files[0], project);
    return;
  }
  const fileDialog = byId('fileDialog');
  state.filePickerType = type;
  setText('fileDialogTitle', type === 'software'
    ? uiText('detail.softwarePickerTitle')
    : uiText('detail.documentPickerTitle'));
  byId('filePickerList').innerHTML = files.map((file) => fileRowTemplate(file)).join('');
  if (!fileDialog.open) fileDialog.showModal();
  document.body.classList.add('dialog-open');
}

function chooseLink() {
  const project = state.currentProject;
  if (!project) return;
  const links = project.links || [];
  if (links.length === 0) return;
  if (links.length > 1) {
    const fileDialog = byId('fileDialog');
    state.filePickerType = 'link';
    setText('fileDialogTitle', uiText('detail.linkPickerTitle'));
    byId('filePickerList').innerHTML = links.map((link) => linkRowTemplate(link)).join('');
    if (!fileDialog.open) fileDialog.showModal();
    document.body.classList.add('dialog-open');
    return;
  }
  const url = safeExternalUrl(links[0].url);
  if (!url) {
    toast(uiText('messages.downloadUnavailable'), 'error');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function beginDownload(file, project = state.currentProject) {
  try {
    toast(uiText('messages.downloadChecking'));
    const response = await api(`/api/public/downloads/${file.id}/prepare`, { method: 'POST' });
    const result = response.data;
    if (!result.allowed) {
      if (result.reason === 'lead_required') {
        openLeadDialog(file, project);
      } else if (result.reason === 'limit_reached') {
        toast(result.message || uiText('messages.downloadLimitFallback'), 'error', 5000);
      } else {
        toast(uiText('messages.downloadUnavailable'), 'error');
      }
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = result.downloadUrl;
    anchor.download = file.displayName || '';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast(applyUiTemplate(uiText('messages.downloadStarted'), { file: file.displayName }), 'success');
  } catch (error) {
    toast(error.message || uiText('messages.downloadFailed'), 'error');
  }
}

function openLeadDialog(file, project) {
  state.pendingFile = { file, project };
  const form = byId('leadForm');
  form.reset();
  byId('leadFileName').textContent = file.displayName;
  byId('leadProjectId').value = project?.id || '';
  byId('leadSourceFileId').value = file.id;
  const dialog = byId('leadDialog');
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
  window.setTimeout(() => form.elements.name?.focus(), 100);
}

function setContactIntent(project) {
  const banner = byId('contactIntent');
  if (!project) {
    banner.hidden = true;
    byId('contactIntentText').textContent = '';
    byId('contactProjectId').value = '';
    return;
  }
  banner.hidden = false;
  byId('contactIntentText').textContent = project.name;
  byId('contactProjectId').value = project.id;
}

function validatePublicForm(form) {
  const controls = [
    form.elements.name,
    form.elements.phone,
    form.elements.message,
    form.elements.privacyConsent
  ].filter(Boolean);
  controls.forEach((control) => control.setCustomValidity(''));

  const checks = [
    [form.elements.name, form.elements.name?.value.trim().length >= 2, uiText('validation.name')],
    [form.elements.phone, /^[0-9+\-()\s]{6,30}$/.test(form.elements.phone?.value.trim() || ''), uiText('validation.phone')],
    [form.elements.message, form.elements.message?.value.trim().length >= 5, uiText('validation.message')],
    [form.elements.privacyConsent, Boolean(form.elements.privacyConsent?.checked), uiText('validation.consent')]
  ];
  const failed = checks.find(([control, valid]) => control && !valid);
  if (failed) {
    const [control, , message] = failed;
    control.setCustomValidity(message);
    control.reportValidity();
    return false;
  }
  return form.checkValidity();
}

async function submitConsultation(form, options = {}) {
  if (!validatePublicForm(form)) {
    return null;
  }
  const button = form.querySelector('button[type="submit"]');
  const label = button?.querySelector('.button-label');
  const loading = button?.querySelector('.button-loading');
  if (button) button.disabled = true;
  if (label) label.hidden = true;
  if (loading) loading.hidden = false;

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.privacyConsent = formData.get('privacyConsent') === 'on';
  if (payload.projectId) payload.projectId = Number(payload.projectId);
  if (payload.sourceFileId) payload.sourceFileId = Number(payload.sourceFileId);

  try {
    const response = await api('/api/public/inquiries', { method: 'POST', body: payload });
    return response.data;
  } catch (error) {
    toast(error.message || uiText('messages.contactFailed'), 'error');
    return null;
  } finally {
    if (button) button.disabled = false;
    if (label) label.hidden = false;
    if (loading) loading.hidden = true;
  }
}

function bindStaticEvents() {
  byId('projectGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-project]');
    if (button) openProject(Number(button.dataset.openProject));
  });

  byId('categoryFilter')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.activeCategory = button.dataset.category === 'all' ? 'all' : Number(button.dataset.category);
    renderCategories();
    renderProjects();
  });

  document.querySelectorAll('[data-close-project]').forEach((button) => {
    button.addEventListener('click', () => byId('projectDialog').close());
  });
  document.querySelectorAll('[data-close-files]').forEach((button) => {
    button.addEventListener('click', () => byId('fileDialog').close());
  });
  document.querySelectorAll('[data-close-lead]').forEach((button) => {
    button.addEventListener('click', () => byId('leadDialog').close());
  });
  document.querySelectorAll('[data-close-contact-qr]').forEach((button) => {
    button.addEventListener('click', () => byId('contactQrDialog').close());
  });

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', updateDialogLock);
  }

  byId('detailContactButton')?.addEventListener('click', () => {
    const project = state.currentProject;
    byId('projectDialog').close();
    setContactIntent(project);
    window.setTimeout(() => scrollToSection('contact'), 80);
  });
  byId('detailSoftwareButton')?.addEventListener('click', () => chooseFile('software'));
  byId('detailDocumentButton')?.addEventListener('click', () => chooseFile('document'));
  byId('detailLinkButton')?.addEventListener('click', chooseLink);

  byId('detailFileList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-download-file]');
    if (!button || !state.currentProject) return;
    const file = state.currentProject.files.find((item) => Number(item.id) === Number(button.dataset.downloadFile));
    if (file) beginDownload(file);
  });
  byId('filePickerList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-download-file]');
    if (!button || !state.currentProject) return;
    const file = state.currentProject.files.find((item) => Number(item.id) === Number(button.dataset.downloadFile));
    if (file) {
      byId('fileDialog').close();
      beginDownload(file);
    }
  });

  byId('clearIntent')?.addEventListener('click', () => setContactIntent(null));

  byId('floatingContactButton')?.addEventListener('click', () => {
    const dialog = byId('contactQrDialog');
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('dialog-open');
  });

  byId('contactForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await submitConsultation(form);
    if (!result) return;
    toast(result.message || uiText('messages.contactSubmitted'), 'success', 5000);
    form.reset();
    setContactIntent(null);
    setText('messageCount', '0');
  });

  const message = byId('contactForm')?.elements.message;
  message?.addEventListener('input', () => setText('messageCount', message.value.length));

  byId('leadForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await submitConsultation(form);
    if (!result) return;
    const pending = state.pendingFile;
    byId('leadDialog').close();
    toast(result.message || uiText('messages.leadSubmitted'), 'success', 5000);
    form.reset();
    if (pending?.file) {
      window.setTimeout(() => beginDownload(pending.file, pending.project), 120);
    }
  });
}

function updateDialogLock() {
  const hasOpenDialog = [...document.querySelectorAll('dialog')].some((dialog) => dialog.open);
  document.body.classList.toggle('dialog-open', hasOpenDialog);
}

function setupNavigation() {
  const header = byId('siteHeader');
  const menuButton = byId('mobileMenuButton');
  const mobileNav = byId('mobileNav');

  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menuButton.setAttribute('aria-label', open ? '打开导航菜单' : '关闭导航菜单');
    mobileNav?.classList.toggle('open', !open);
  });

  mobileNav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuButton?.setAttribute('aria-expanded', 'false');
      mobileNav?.classList.remove('open');
    });
  });

  const sectionMap = new Map([
    ['projects', document.querySelector('.desktop-nav a[href="#projects"]')],
    ['trust', document.querySelector('.desktop-nav a[href="#trust"]')],
    ['contact', document.querySelector('.desktop-nav a[href="#contact"]')]
  ]);
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      document.querySelectorAll('.desktop-nav a').forEach((link) => link.classList.remove('active'));
      sectionMap.get(entry.target.id)?.classList.add('active');
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  for (const id of sectionMap.keys()) {
    const section = byId(id);
    if (section) observer.observe(section);
  }
}

function scrollToSection(id) {
  const section = byId(id);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08 });
  items.forEach((item) => observer.observe(item));
}

function trackVisit() {
  try {
    if (sessionStorage.getItem('fushi_visit_tracked')) return;
    sessionStorage.setItem('fushi_visit_tracked', '1');
  } catch {
    // 浏览器禁用 SessionStorage 时仍允许统计本次访问。
  }
  api('/api/public/track', {
    method: 'POST',
    body: { type: 'visit', path: `${window.location.pathname}${window.location.hash}` }
  }).catch(() => {});
}

function renderBootstrapError(error) {
  const grid = byId('projectGrid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-projects">
        <div>
          <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18"/><path d="M24 14v12M24 32h.01"/></svg>
          <h3>${escapeHtml(uiText('messages.projectDataError'))}</h3>
          <p>${escapeHtml(error.message || uiText('messages.networkHint'))}</p>
        </div>
      </div>
    `;
  }
  toast(error.message || uiText('messages.dataLoadFailed'), 'error', 6000);
}

init();

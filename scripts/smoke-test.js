import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.TEST_BASE_URL || process.argv[2] || 'http://127.0.0.1:18931').replace(/\/$/, '');
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || process.argv[3] || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || process.argv[4] || 'FushiVIP@2026';

class ApiClient {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeCookies(response) {
    const values = response.headers.getSetCookie?.() || [];
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  async request(url, options = {}) {
    const headers = {
      Origin: BASE_URL,
      'User-Agent': 'FushiVIP-SmokeTest/1.0',
      ...(options.headers || {})
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let body = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${BASE_URL}${url}`, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual'
    });
    this.storeCookies(response);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.arrayBuffer();
    return { response, payload };
  }

  async json(url, options = {}) {
    const { response, payload } = await this.request(url, options);
    if (!response.ok || payload?.success === false) {
      throw new Error(`${options.method || 'GET'} ${url} -> ${response.status}: ${payload?.error?.message || '请求失败'}`);
    }
    return payload;
  }
}

const results = [];
function pass(label) {
  results.push(label);
  console.log(`PASS  ${label}`);
}

const admin = new ApiClient();
const publicClient = new ApiClient();
let projectId = null;
let fileId = null;
let linkId = null;
let inquiryId = null;
let categoryId = null;
let childAdminId = null;
let uploadedCoverPath = null;
let settingsChanged = false;
let originalHeroTrust = null;
let originalNavCta = null;
let featuredSettingChanged = false;
let originalFeaturedProjectId = null;
let widgetQrSettingChanged = false;
let originalWidgetQrUrl = null;
let uploadedWidgetPath = null;

try {
  const health = await publicClient.json('/api/public/health');
  assert.equal(health.data.status, 'ok');
  pass('服务健康检查');

  const bootstrap = await publicClient.json('/api/public/bootstrap');
  assert.equal(bootstrap.data.settings.siteName, '傅先生AI项目VIP');
  assert.ok(bootstrap.data.projects.length >= 1);
  assert.ok(bootstrap.data.categories.length >= 1);
  pass('访客端动态配置、分类与项目数据');

  const unauthorized = await publicClient.request('/api/admin/auth/me');
  assert.equal(unauthorized.response.status, 401);
  pass('后台接口未登录拦截');

  const wrongLogin = await publicClient.request('/api/admin/auth/login', {
    method: 'POST',
    json: { username: ADMIN_USERNAME, password: 'wrong-password' }
  });
  assert.equal(wrongLogin.response.status, 401);
  pass('错误密码登录失败');

  const login = await admin.json('/api/admin/auth/login', {
    method: 'POST',
    json: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
  });
  assert.equal(login.data.user.isSuper, true);
  const me = await admin.json('/api/admin/auth/me');
  assert.equal(me.data.user.username, ADMIN_USERNAME);
  pass('管理员登录与 HttpOnly 会话');

  const overview = await admin.json('/api/admin/overview?range=30');
  assert.ok(Array.isArray(overview.data.trend));
  assert.equal(overview.data.trend.length, 30);
  pass('运营概览与 30 天趋势数据');

  const contentSchema = await admin.json('/api/admin/content-schema');
  const contentFieldCount = contentSchema.data.groups.reduce((sum, group) => sum + group.fields.length, 0);
  assert.ok(contentFieldCount >= 100);
  pass('全站文字配置结构完整');

  const widgetSettings = (await admin.json('/api/admin/settings')).data;
  originalWidgetQrUrl = widgetSettings.floatingContactQrUrl || '';
  const widgetImageForm = new FormData();
  widgetImageForm.append(
    'file',
    new Blob([
      Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
    ], { type: 'image/png' }),
    'widget-qr-test.png'
  );
  const widgetUpload = await admin.json('/api/admin/upload/widget-image', {
    method: 'POST',
    body: widgetImageForm
  });
  uploadedWidgetPath = path.join(ROOT_DIR, 'storage', widgetUpload.data.storageKey);
  const widgetAsset = await publicClient.request(widgetUpload.data.url);
  assert.equal(widgetAsset.response.status, 200);
  assert.match(widgetAsset.response.headers.get('content-type') || '', /^image\//);
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { floatingContactQrUrl: widgetUpload.data.url }
  });
  widgetQrSettingChanged = true;
  const widgetBootstrap = await publicClient.json('/api/public/bootstrap');
  assert.equal(widgetBootstrap.data.settings.floatingContactQrUrl, widgetUpload.data.url);
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { floatingContactQrUrl: originalWidgetQrUrl }
  });
  widgetQrSettingChanged = false;
  pass('悬浮联系二维码上传与配置');

  const suffix = Date.now().toString(36);
  const category = await admin.json('/api/admin/categories', {
    method: 'POST',
    json: {
      name: `自动化测试分类-${suffix}`,
      description: '冒烟测试临时分类',
      sortOrder: 999,
      active: true
    }
  });
  categoryId = category.data.id;
  await admin.json(`/api/admin/categories/${categoryId}`, {
    method: 'PATCH',
    json: { description: '已更新的测试分类说明' }
  });
  pass('分类新增与编辑');

  const coverBlob = new Blob([
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  ], { type: 'image/png' });
  const coverForm = new FormData();
  coverForm.append('file', coverBlob, 'test-cover.png');
  const cover = await admin.json('/api/admin/upload/cover', { method: 'POST', body: coverForm });
  assert.match(cover.data.url, /^\/media\/covers\//);
  uploadedCoverPath = path.join(ROOT_DIR, 'storage', cover.data.storageKey);
  const coverAsset = await publicClient.request(cover.data.url);
  assert.equal(coverAsset.response.status, 200);
  assert.match(coverAsset.response.headers.get('content-type') || '', /^image\//);
  pass('项目封面上传与格式校验');

  const project = await admin.json('/api/admin/projects', {
    method: 'POST',
    json: {
      name: `自动化验收项目-${suffix}`,
      slogan: '用于验证完整发布、文件与下载链路的临时项目',
      description: '这是自动化测试创建的项目。\n\n验证项目创建、上下架、文件上传与访客下载流程。',
      highlights: ['完整后台 CRUD', '受控文件分发', '下载数据统计'],
      tags: ['自动化测试', '接口联调', '临时项目'],
      categoryId,
      coverUrl: cover.data.url,
      sortWeight: 999,
      published: true
    }
  });
  projectId = project.data.id;
  assert.equal(project.data.published, true);
  pass('项目新增并关联自定义分类与封面');

  const fileForm = new FormData();
  fileForm.append('file', new Blob(['傅先生AI项目VIP 自动化下载验收文件。\n'], { type: 'text/plain' }), 'acceptance.txt');
  fileForm.append('type', 'document');
  fileForm.append('displayName', '自动化验收项目资料.txt');
  const uploaded = await admin.json(`/api/admin/projects/${projectId}/files`, {
    method: 'POST',
    body: fileForm
  });
  fileId = uploaded.data.id;
  assert.equal(uploaded.data.type, 'document');
  pass('项目资料文件上传与自定义名称');

  const invalidUpload = new FormData();
  invalidUpload.append('file', new Blob(['alert(1)'], { type: 'application/javascript' }), 'malicious.js');
  invalidUpload.append('type', 'document');
  const invalidUploadResult = await admin.request(`/api/admin/projects/${projectId}/files`, {
    method: 'POST',
    body: invalidUpload
  });
  assert.equal(invalidUploadResult.response.status, 422);
  pass('上传扩展名白名单拦截');

  await admin.json(`/api/admin/files/${fileId}`, {
    method: 'PATCH',
    json: { displayName: '重命名后的验收资料.txt' }
  });
  pass('下载文件重命名');

  const replacement = new FormData();
  replacement.append('file', new Blob(['这是替换后的项目资料。\n'], { type: 'text/plain' }), 'replacement.txt');
  replacement.append('displayName', '替换后的验收资料.txt');
  await admin.json(`/api/admin/files/${fileId}/replace`, { method: 'PUT', body: replacement });
  const replacedProject = await admin.json(`/api/admin/projects/${projectId}`);
  assert.equal(replacedProject.data.files[0].displayName, '替换后的验收资料.txt');
  pass('项目文件替换与展示名保留');

  const link = await admin.json(`/api/admin/projects/${projectId}/links`, {
    method: 'POST',
    json: {
      displayName: '项目在线演示',
      url: 'https://example.com/project-demo',
      sortOrder: 1
    }
  });
  linkId = link.data.id;
  const invalidLink = await admin.request(`/api/admin/links/${linkId}`, {
    method: 'PATCH',
    json: { url: 'javascript:alert(1)' }
  });
  assert.equal(invalidLink.response.status, 422);
  await admin.json(`/api/admin/links/${linkId}`, {
    method: 'PATCH',
    json: { displayName: '项目在线演示入口', url: 'https://example.com/project-demo?v=2' }
  });
  pass('项目外链新增、地址校验与编辑');

  await admin.json('/api/admin/projects/batch', {
    method: 'POST',
    json: { ids: [projectId], action: 'unpublish' }
  });
  const hiddenProject = await publicClient.request(`/api/public/projects/${projectId}`);
  assert.equal(hiddenProject.response.status, 404);
  await admin.json('/api/admin/projects/batch', {
    method: 'POST',
    json: { ids: [projectId], action: 'publish' }
  });
  pass('项目批量下架/上架与前台可见性联动');

  const publicDetail = await publicClient.json(`/api/public/projects/${projectId}`);
  assert.equal(publicDetail.data.files.length, 1);
  assert.equal(publicDetail.data.files[0].displayName, '替换后的验收资料.txt');
  assert.equal(publicDetail.data.links.length, 1);
  assert.equal(publicDetail.data.links[0].displayName, '项目在线演示入口');
  pass('访客项目详情返回后台最新内容与文件');

  const projectOptions = await admin.json('/api/admin/project-options');
  assert.ok(projectOptions.data.length >= 2);
  const featuredTarget = projectOptions.data.find((project) => project.id !== projectId);
  const currentSettingsForFeatured = (await admin.json('/api/admin/settings')).data;
  originalFeaturedProjectId = currentSettingsForFeatured.featuredProjectId ?? null;
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { featuredProjectId: featuredTarget.id }
  });
  featuredSettingChanged = true;
  const featuredBootstrap = await publicClient.json('/api/public/bootstrap');
  assert.equal(featuredBootstrap.data.settings.featuredProjectId, featuredTarget.id);
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { featuredProjectId: originalFeaturedProjectId }
  });
  featuredSettingChanged = false;
  pass('后台选择首屏精选项目');

  const originalSettings = (await admin.json('/api/admin/settings')).data;
  originalHeroTrust = originalSettings.heroTrust;
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { heroTrust: '自动化同步验证内容' }
  });
  const syncedBootstrap = await publicClient.json('/api/public/bootstrap');
  assert.equal(syncedBootstrap.data.settings.heroTrust, '自动化同步验证内容');
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { heroTrust: originalHeroTrust }
  });
  originalHeroTrust = null;
  pass('后台首页文案更新即时反映到访客接口');

  const originalUiSettings = (await admin.json('/api/admin/settings')).data;
  originalNavCta = originalUiSettings.uiText['nav.cta'];
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { uiText: { 'nav.cta': '实时咨询入口' } }
  });
  const syncedUiBootstrap = await publicClient.json('/api/public/bootstrap');
  assert.equal(syncedUiBootstrap.data.settings.uiText['nav.cta'], '实时咨询入口');
  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { uiText: { 'nav.cta': originalNavCta } }
  });
  originalNavCta = null;
  pass('全站按钮与提示文字动态更新');

  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { downloadRequireLead: true, downloadDailyLimit: 20 }
  });
  settingsChanged = true;
  const blockedDownload = await publicClient.json(`/api/public/downloads/${fileId}/prepare`, { method: 'POST' });
  assert.equal(blockedDownload.data.allowed, false);
  assert.equal(blockedDownload.data.reason, 'lead_required');
  pass('下载前留资规则生效');

  const inquiry = await publicClient.json('/api/public/inquiries', {
    method: 'POST',
    json: {
      name: '测试访客',
      company: '自动化测试企业',
      phone: '13800138000',
      wechat: 'smoke-test',
      message: '希望获取项目资料并了解合作方式。',
      projectId,
      sourceFileId: fileId,
      privacyConsent: true
    }
  });
  inquiryId = inquiry.data.id;
  assert.equal(inquiry.data.downloadUnlocked, true);
  pass('访客咨询提交并解锁下载');

  const prepared = await publicClient.json(`/api/public/downloads/${fileId}/prepare`, { method: 'POST' });
  assert.equal(prepared.data.allowed, true);
  const download = await publicClient.request(prepared.data.downloadUrl);
  assert.equal(download.response.status, 200);
  assert.ok(download.payload.byteLength > 0);
  pass('一次性下载令牌与文件流');

  const reused = await publicClient.request(prepared.data.downloadUrl);
  assert.equal(reused.response.status, 410);
  pass('下载令牌不可重复使用');

  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { downloadDailyLimit: 1 }
  });
  const limited = await publicClient.json(`/api/public/downloads/${fileId}/prepare`, { method: 'POST' });
  assert.equal(limited.data.allowed, false);
  assert.equal(limited.data.reason, 'limit_reached');
  pass('单 IP 每日下载次数限制');

  const inquiryDetail = await admin.json(`/api/admin/inquiries/${inquiryId}`);
  assert.equal(inquiryDetail.data.name, '测试访客');
  await admin.json(`/api/admin/inquiries/${inquiryId}`, {
    method: 'PATCH',
    json: { status: 'processing', isRead: true, adminNote: '自动化测试跟进备注' }
  });
  pass('咨询详情、已读状态与跟进备注');

  const metrics = await admin.json('/api/admin/analytics/projects?range=30');
  const metric = metrics.data.find((item) => item.id === projectId);
  assert.equal(metric.documentDownloads, 1);
  pass('单项目资料下载数据统计');

  await admin.json('/api/admin/settings', {
    method: 'PATCH',
    json: { downloadRequireLead: false, downloadDailyLimit: 0 }
  });
  settingsChanged = false;
  pass('下载规则恢复');

  const childPassword = 'SmokeTest2026';
  const child = await admin.json('/api/admin/admins', {
    method: 'POST',
    json: {
      username: `smoke_${suffix}`,
      displayName: '自动化测试子管理员',
      password: childPassword,
      permissions: ['projects', 'categories'],
      active: true
    }
  });
  childAdminId = child.data.id;
  const childClient = new ApiClient();
  await childClient.json('/api/admin/auth/login', {
    method: 'POST',
    json: { username: `smoke_${suffix}`, password: childPassword }
  });
  await childClient.json('/api/admin/projects');
  const forbiddenSettings = await childClient.request('/api/admin/settings');
  assert.equal(forbiddenSettings.response.status, 403);
  const forbiddenAdmins = await childClient.request('/api/admin/admins');
  assert.equal(forbiddenAdmins.response.status, 403);
  pass('子管理员权限分级与越权拦截');

  await admin.json(`/api/admin/admins/${childAdminId}`, {
    method: 'PATCH',
    json: { password: 'SmokeUpdated2026' }
  });
  const childReloginClient = new ApiClient();
  await childReloginClient.json('/api/admin/auth/login', {
    method: 'POST',
    json: { username: `smoke_${suffix}`, password: 'SmokeUpdated2026' }
  });
  await childReloginClient.json('/api/admin/auth/change-password', {
    method: 'POST',
    json: { currentPassword: 'SmokeUpdated2026', newPassword: 'SmokeChanged2026' }
  });
  pass('子管理员密码重置与自助修改');

  await admin.json(`/api/admin/admins/${childAdminId}`, { method: 'DELETE' });
  childAdminId = null;
  pass('子管理员账号删除');

  await admin.json(`/api/admin/inquiries/${inquiryId}`, { method: 'DELETE' });
  inquiryId = null;
  pass('咨询记录删除');

  await admin.json(`/api/admin/projects/${projectId}`, { method: 'DELETE' });
  projectId = null;
  fileId = null;
  linkId = null;
  pass('项目删除及关联文件清理');

  await admin.json(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
  categoryId = null;
  pass('分类删除');

  console.log(`\n${results.length} 项冒烟测试全部通过。`);
} catch (error) {
  console.error('\nSMOKE TEST FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  try {
    if (settingsChanged) {
      await admin.json('/api/admin/settings', {
        method: 'PATCH',
        json: { downloadRequireLead: false, downloadDailyLimit: 0 }
      });
    }
  } catch {}
  try {
    if (originalHeroTrust !== null) {
      await admin.json('/api/admin/settings', {
        method: 'PATCH',
        json: { heroTrust: originalHeroTrust }
      });
    }
  } catch {}
  try {
    if (originalNavCta !== null) {
      await admin.json('/api/admin/settings', {
        method: 'PATCH',
        json: { uiText: { 'nav.cta': originalNavCta } }
      });
    }
  } catch {}
  try {
    if (featuredSettingChanged) {
      await admin.json('/api/admin/settings', {
        method: 'PATCH',
        json: { featuredProjectId: originalFeaturedProjectId }
      });
    }
  } catch {}
  try {
    if (widgetQrSettingChanged) {
      await admin.json('/api/admin/settings', {
        method: 'PATCH',
        json: { floatingContactQrUrl: originalWidgetQrUrl }
      });
    }
  } catch {}
  try {
    if (inquiryId) await admin.json(`/api/admin/inquiries/${inquiryId}`, { method: 'DELETE' });
  } catch {}
  try {
    if (projectId) await admin.json(`/api/admin/projects/${projectId}`, { method: 'DELETE' });
  } catch {}
  try {
    if (categoryId) await admin.json(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
  } catch {}
  try {
    if (childAdminId) await admin.json(`/api/admin/admins/${childAdminId}`, { method: 'DELETE' });
  } catch {}
  try {
    if (uploadedCoverPath) await fs.unlink(uploadedCoverPath);
  } catch {}
  try {
    if (uploadedWidgetPath) await fs.unlink(uploadedWidgetPath);
  } catch {}
}

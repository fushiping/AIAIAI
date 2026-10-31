import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'test-output');
const BASE_URL = (process.env.TEST_BASE_URL || process.argv[2] || 'http://127.0.0.1:18931').replace(/\/$/, '');
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});
const errors = [];

async function createPage(viewport) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('401')) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  return { context, page };
}

try {
  const desktop = await createPage({ width: 1440, height: 1050 });
  await desktop.page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await desktop.page.locator('.project-card:not(.skeleton-card)').first().waitFor();
  await desktop.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-desktop.png') });
  await desktop.page.locator('#floatingContactButton').waitFor({ state: 'visible' });
  const floatingPosition = await desktop.page.locator('#floatingContactButton').evaluate(
    (element) => getComputedStyle(element).position
  );
  if (floatingPosition !== 'fixed') throw new Error('联系浮标未固定定位');
  await desktop.page.locator('#floatingContactButton').click();
  await desktop.page.locator('#contactQrDialog[open]').waitFor();
  const qrLoaded = await desktop.page.locator('#floatingContactQr').evaluate(
    (image) => image.complete && image.naturalWidth > 0
  );
  if (!qrLoaded) throw new Error('联系二维码弹窗图片未加载');
  await desktop.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-contact-qr.png') });
  await desktop.page.locator('[data-close-contact-qr]').click();
  await desktop.page.locator('#projects').scrollIntoViewIfNeeded();
  await desktop.page.waitForTimeout(250);
  await desktop.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-projects.png') });
  await desktop.page.locator('#contact').scrollIntoViewIfNeeded();
  await desktop.page.waitForTimeout(250);
  await desktop.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-contact.png') });
  await desktop.page.locator('#contactForm button[type="submit"]').click();
  const validationMessage = await desktop.page.locator('#contactForm [name="name"]').evaluate(
    (element) => element.validationMessage
  );
  if (!validationMessage.includes('至少 2 个字符')) {
    throw new Error(`前台表单校验提示未应用配置：${validationMessage}`);
  }
  await desktop.page.evaluate(() => {
    document.querySelector('#contactForm').reset();
    document.querySelectorAll('#contactForm [name]').forEach((element) => element.setCustomValidity?.(''));
  });

  const adminLogin = await desktop.context.request.post(`${BASE_URL}/api/admin/auth/login`, {
    data: {
      username: process.env.TEST_ADMIN_USERNAME || 'admin',
      password: process.env.TEST_ADMIN_PASSWORD || 'FushiVIP@2026'
    }
  });
  if (!adminLogin.ok()) throw new Error(`实时推送测试登录失败：${adminLogin.status()}`);
  const settingsResponse = await desktop.context.request.get(`${BASE_URL}/api/admin/settings`);
  const settingsPayload = await settingsResponse.json();
  const projectOptionsResponse = await desktop.context.request.get(`${BASE_URL}/api/admin/project-options`);
  const projectOptions = (await projectOptionsResponse.json()).data;
  const originalFeatured = projectOptions.find(
    (project) => project.id === settingsPayload.data.featuredProjectId
  ) || projectOptions[0];
  const featuredTarget = projectOptions.find((project) => project.id !== originalFeatured.id);
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { featuredProjectId: featuredTarget.id }
  });
  await desktop.page.waitForFunction(
    (name) => document.querySelector('#heroFeatured h2')?.textContent === name,
    featuredTarget.name
  );
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { featuredProjectId: settingsPayload.data.featuredProjectId || null }
  });
  await desktop.page.waitForFunction(
    (name) => document.querySelector('#heroFeatured h2')?.textContent === name,
    originalFeatured.name
  );
  const originalCta = settingsPayload.data.uiText['nav.cta'];
  const liveCta = `实时入口 ${Date.now()}`;
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { uiText: { 'nav.cta': liveCta } }
  });
  await desktop.page.waitForFunction(
    (label) => document.querySelector('.nav-cta span')?.textContent === label,
    liveCta
  );
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { uiText: { 'nav.cta': originalCta } }
  });
  await desktop.page.waitForFunction(
    (label) => document.querySelector('.nav-cta span')?.textContent === label,
    originalCta
  );
  const originalQrUrl = settingsPayload.data.floatingContactQrUrl;
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { floatingContactQrUrl: '/assets/admin-emblem.svg' }
  });
  await desktop.page.waitForFunction(
    () => new URL(document.querySelector('#floatingContactQr')?.src).pathname.endsWith('/assets/admin-emblem.svg')
  );
  await desktop.context.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { floatingContactQrUrl: originalQrUrl }
  });
  await desktop.page.waitForFunction(
    (url) => new URL(document.querySelector('#floatingContactQr')?.src).pathname.endsWith(url),
    originalQrUrl
  );

  const cardCount = await desktop.page.locator('.project-card:not(.skeleton-card)').count();
  if (cardCount < 1) throw new Error(`访客端项目卡片数量异常：${cardCount}`);

  await desktop.page.locator('[data-open-project]').first().click();
  await desktop.page.locator('#projectDialog[open]').waitFor();
  const dialogScroll = await desktop.page.locator('#projectDialog .dialog-scroll').evaluate((element) => ({
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
    scrollable: element.scrollHeight > element.clientHeight
  }));
  if (dialogScroll.scrollbarWidth !== 'none' || !dialogScroll.scrollable) {
    throw new Error(`项目详情滚动区域检查失败：${JSON.stringify(dialogScroll)}`);
  }
  await desktop.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-project-detail.png') });
  const downloadPromise = desktop.page.waitForEvent('download');
  await desktop.page.locator('#detailDocumentButton').click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().includes('项目资料') && !download.suggestedFilename().endsWith('.txt')) {
    throw new Error(`浏览器下载文件名异常：${download.suggestedFilename()}`);
  }
  await desktop.page.locator('[data-close-project]').click();
  await desktop.context.close();

  const mobile = await createPage({ width: 390, height: 844 });
  await mobile.page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await mobile.page.locator('.project-card:not(.skeleton-card)').first().waitFor();
  const mobileOverflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (mobileOverflow > 1) throw new Error(`访客端移动布局出现横向溢出：${mobileOverflow}px`);
  await mobile.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-mobile.png') });
  await mobile.page.locator('#mobileMenuButton').click();
  await mobile.page.screenshot({ path: path.join(OUTPUT_DIR, 'public-mobile-menu.png') });
  await mobile.context.close();

  const admin = await createPage({ width: 1440, height: 1000 });
  await admin.page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
  await admin.page.locator('#loginScreen:not([hidden])').waitFor();
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-login.png') });
  await admin.page.locator('#loginForm input[name="username"]').fill(process.env.TEST_ADMIN_USERNAME || 'admin');
  await admin.page.locator('#loginForm input[name="password"]').fill(process.env.TEST_ADMIN_PASSWORD || 'FushiVIP@2026');
  await admin.page.locator('#loginForm button[type="submit"]').click();
  await admin.page.locator('#adminApp:not([hidden])').waitFor();
  await admin.page.locator('.welcome-strip').waitFor();
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-dashboard.png') });

  await admin.page.locator('[data-view="projects"]').click();
  await admin.page.locator('.projects-table').waitFor();
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-projects.png') });
  await admin.page.locator('#newProjectButton').click();
  await admin.page.locator('#projectEditorDialog[open]').waitFor();
  const uniqueProjectName = `界面保存验收-${Date.now()}`;
  await admin.page.locator('#projectForm [name="name"]').fill(uniqueProjectName);
  await admin.page.locator('#projectForm [name="slogan"]').fill('验证后台项目表单可以正常保存');
  await admin.page.locator('#projectForm [name="description"]').fill('这是浏览器自动化验收创建的临时项目。\n用于确认保存按钮和校验提示正常。');
  await admin.page.locator('#projectForm [name="highlights"]').fill('完整表单保存\n错误提示可见');
  await admin.page.locator('#projectForm [name="tags"]').fill('验收测试');
  await admin.page.locator('#projectForm button[type="submit"]').click();
  const tagValidation = await admin.page.locator('#projectForm [name="tags"]').evaluate(
    (element) => element.validationMessage
  );
  if (!tagValidation.includes('两个项目标签')) {
    throw new Error(`项目标签校验未生效：${tagValidation}`);
  }
  await admin.page.locator('#projectForm [name="tags"]').fill('验收测试，界面保存');
  const saveResponsePromise = admin.page.waitForResponse(
    (response) => response.url().endsWith('/api/admin/projects') && response.request().method() === 'POST'
  );
  await admin.page.locator('#projectForm button[type="submit"]').click();
  const saveResponse = await saveResponsePromise;
  if (!saveResponse.ok()) throw new Error(`项目界面保存失败：${saveResponse.status()}`);
  const savedProject = await saveResponse.json();
  await admin.page.locator('#projectEditorDialog').waitFor({ state: 'hidden' });
  await admin.page.locator(`text=${uniqueProjectName}`).first().waitFor();
  await admin.context.request.delete(`${BASE_URL}/api/admin/projects/${savedProject.data.id}`);

  await admin.page.locator('[data-view="categories"]').click();
  await admin.page.locator('#newCategoryButton').waitFor();
  await admin.page.locator('#newCategoryButton').click();
  await admin.page.locator('#categoryDialog[open]').waitFor();
  await admin.page.locator('[data-close-dialog="categoryDialog"]').first().click();

  await admin.page.locator('[data-view="settings"]').click();
  await admin.page.locator('#settingsForm').waitFor();
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-settings.png') });
  await admin.page.locator('[data-settings-tab="text"]').click();
  await admin.page.locator('.site-text-group').first().waitFor();
  const textFieldCount = await admin.page.locator('[data-ui-key]').count();
  if (textFieldCount < 100) throw new Error(`全站文字字段数量异常：${textFieldCount}`);
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-site-text.png') });
  await admin.page.locator('[data-settings-tab="widget"]').click();
  await admin.page.locator('.widget-image-card').first().waitFor();
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-contact-widget.png') });
  await admin.page.locator('[data-settings-tab="site"]').click();
  await admin.page.locator('#settingsForm').waitFor();
  await admin.page.locator('[data-settings-tab="download"]').click();
  await admin.page.locator('input[name="downloadDailyLimit"]').waitFor();

  await admin.page.locator('[data-view="admins"]').click();
  await admin.page.locator('#newAdminButton').waitFor();
  await admin.page.locator('#newAdminButton').click();
  await admin.page.locator('#adminDialog[open]').waitFor();
  await admin.page.locator('[data-close-dialog="adminDialog"]').first().click();

  await admin.page.setViewportSize({ width: 390, height: 844 });
  await admin.page.waitForTimeout(350);
  const adminOverflow = await admin.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (adminOverflow > 1) throw new Error(`管理后台移动布局出现横向溢出：${adminOverflow}px`);
  await admin.page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-mobile.png') });
  await admin.context.close();

  if (errors.length) {
    console.error('浏览器运行错误：');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`视觉验收完成：${OUTPUT_DIR}`);
    console.log('已生成桌面端与移动端截图，浏览器控制台无错误。');
  }
} finally {
  await browser.close();
}

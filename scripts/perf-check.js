import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();
page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(30000);
await page.addInitScript(() => {
  window.__lcp = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__lcp = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});

const started = Date.now();
await page.goto('https://123mrfu.vip/', { waitUntil: 'domcontentloaded' });
await page.locator('#heroFeatured img').waitFor();
await page.waitForFunction(() => {
  const image = document.querySelector('#heroFeatured img');
  return image?.naturalWidth > 0;
});
await page.locator('.hero-copy.visible').waitFor();
await page.locator('#heroFeatured img').evaluate((image) => image.decode());
await page.waitForTimeout(800);
await page.waitForFunction(() => document.querySelectorAll('.project-card img').length > 0);
const elapsed = Date.now() - started;
const metrics = await page.evaluate(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const images = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/media/covers/'))
    .map((entry) => ({
      url: entry.name,
      transferSize: entry.transferSize,
      duration: Math.round(entry.duration)
    }));
  return {
    domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
    loadEvent: Math.round(navigation.loadEventEnd),
    htmlTransferSize: navigation.transferSize,
    htmlDecodedSize: navigation.decodedBodySize,
    lcp: Math.round(window.__lcp),
    images
  };
});
await page.screenshot({ path: 'test-output/performance-123mrfu.png' });
console.log(JSON.stringify({ totalWaitMs: elapsed, ...metrics }, null, 2));
await page.locator('#projects').scrollIntoViewIfNeeded();
await page.waitForFunction(() => [...document.querySelectorAll('.project-card img')]
  .every((image) => image.naturalWidth > 0));
await page.waitForTimeout(250);
await page.screenshot({ path: 'test-output/performance-123mrfu-projects.png' });
await page.locator('#floatingContactButton').click();
await page.waitForFunction(() => {
  const image = document.querySelector('#floatingContactQr');
  return image?.naturalWidth > 0;
});
console.log('QR_LAZY_LOAD=PASS');
await browser.close();

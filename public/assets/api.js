export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const appBasePath = (() => {
  const modulePath = new URL(import.meta.url).pathname;
  const assetsIndex = modulePath.lastIndexOf('/assets/api.js');
  return assetsIndex >= 0 ? `${modulePath.slice(0, assetsIndex)}/` : '/';
})();

export function appPath(pathname) {
  const value = String(pathname || '');
  if (!value || /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }
  if (appBasePath !== '/' && value.startsWith(appBasePath)) return value;
  return `${appBasePath}${value.replace(/^\/+/, '')}`;
}

export async function api(url, options = {}) {
  const requestOptions = {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.headers || {}) }
  };
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }
  const response = await fetch(appPath(url), requestOptions);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 响应交给统一错误提示处理。
  }
  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      payload?.error?.message || `请求失败（${response.status}）`,
      response.status,
      payload?.error?.code || 'REQUEST_FAILED'
    );
  }
  return payload;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function toast(message, type = 'default', duration = 3600) {
  const region = document.querySelector('#toastRegion');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => {
    item.classList.add('leaving');
    window.setTimeout(() => item.remove(), 220);
  }, duration);
}

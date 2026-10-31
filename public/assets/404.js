import { api } from './api.js';

try {
  const response = await api('/api/public/bootstrap');
  const copy = response.data.settings.uiText || {};
  document.querySelectorAll('[data-content-key]').forEach((element) => {
    if (typeof copy[element.dataset.contentKey] === 'string') {
      element.textContent = copy[element.dataset.contentKey];
    }
  });
  if (copy['notFound.documentTitle']) document.title = copy['notFound.documentTitle'];
} catch {
  // 保留 HTML 中的默认提示，接口短时不可用时仍能返回站点。
}

import fs from 'node:fs';
import { all, getSettings, one } from '../db.js';
import { projectMeta, projectSelect } from '../utils.js';
import { resolveStoragePath } from './storage.js';

export function getPublicSiteData() {
  const settings = getSettings();
  const categories = all(`
    SELECT id, name, description, sort_order
    FROM categories WHERE active = 1 ORDER BY sort_order DESC, id ASC
  `).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order
  }));
  const projects = all(`${projectSelect()} WHERE p.published = 1 ORDER BY p.sort_weight DESC, p.id DESC`)
    .map((row) => projectMeta(row));
  const totalDownloads = Number(one(`
    SELECT COUNT(*) AS count FROM analytics_events
    WHERE event_type IN ('download_software', 'download_document')
  `)?.count || 0);

  return {
    settings,
    categories,
    projects,
    metrics: {
      publishedProjects: projects.length,
      categories: categories.length,
      totalDownloads
    }
  };
}

function imageDataUri(url, maxBytes = 250 * 1024) {
  if (!String(url || '').startsWith('/media/covers/')) return '';
  try {
    const storageKey = String(url).replace(/^\/media\//, '');
    const filePath = resolveStoragePath(storageKey);
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) return '';
    const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const mimeType = extension === '.webp'
      ? 'image/webp'
      : extension === '.png'
        ? 'image/png'
        : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : '';
    if (!mimeType) return '';
    return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return '';
  }
}

export function getInitialSiteData() {
  const data = getPublicSiteData();
  const featuredId = Number(data.settings.featuredProjectId || 0);
  const featured = data.projects.find((project) => project.id === featuredId) || data.projects[0];
  if (featured) {
    data.featuredImageData = imageDataUri(featured.coverMediumUrl || featured.coverUrl);
  }
  for (const project of data.projects.slice(0, 3)) {
    project.cardImageData = imageDataUri(project.coverCardUrl || project.coverUrl, 80 * 1024);
  }
  return data;
}

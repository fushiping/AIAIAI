import fs from 'node:fs/promises';
import path from 'node:path';
import { COVERS_DIR } from '../server/config.js';
import { all, db, nowIso, transaction } from '../server/db.js';
import { optimizeExistingCover } from '../server/services/image-optimizer.js';

const rows = all(`
  SELECT cover_url FROM projects
  WHERE cover_url LIKE '/media/covers/%'
  GROUP BY cover_url
`);

let optimized = 0;
let skipped = 0;
for (const row of rows) {
  const filename = path.basename(decodeURIComponent(row.cover_url));
  const sourcePath = path.join(COVERS_DIR, filename);
  try {
    await fs.access(sourcePath);
    const urls = await optimizeExistingCover(sourcePath);
    transaction(() => {
      db.prepare(`
        UPDATE projects SET cover_url = ?, updated_at = ?
        WHERE cover_url = ?
      `).run(urls.cover, nowIso(), row.cover_url);
    });
    optimized += 1;
    console.log(`OPTIMIZED ${row.cover_url} -> ${urls.cover}`);
  } catch (error) {
    skipped += 1;
    console.warn(`SKIPPED ${row.cover_url}: ${error.message}`);
  }
}

db.close();
console.log(JSON.stringify({ optimized, skipped }));

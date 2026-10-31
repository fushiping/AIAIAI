import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_TEXT_DEFAULTS, UI_TEXT_SCHEMA } from '../server/content.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  path.join(ROOT_DIR, 'public', 'index.html'),
  path.join(ROOT_DIR, 'public', '404.html'),
  path.join(ROOT_DIR, 'public', 'assets', 'app.js'),
  path.join(ROOT_DIR, 'server', 'routes', 'public.js')
];
const keys = new Set();

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/data-content-(?:key|placeholder|default)="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of content.matchAll(/uiText\('([^']+)'/g)) {
    keys.add(match[1]);
  }
  for (const match of content.matchAll(/uiText\['([^']+)'\]/g)) {
    keys.add(match[1]);
  }
}

const schemaKeys = new Set(UI_TEXT_SCHEMA.flatMap((group) => group.fields.map((field) => field.key)));
const missingDefaults = [...schemaKeys].filter((key) => !Object.hasOwn(UI_TEXT_DEFAULTS, key));
const missingSchema = [...keys].filter((key) => !schemaKeys.has(key));
const orphanDefaults = [...schemaKeys].filter((key) => !Object.hasOwn(UI_TEXT_DEFAULTS, key));

assert.deepEqual(missingDefaults, [], `缺少默认值的字段：${missingDefaults.join(', ')}`);
assert.deepEqual(missingSchema, [], `前台使用了未配置的字段：${missingSchema.join(', ')}`);
assert.deepEqual(orphanDefaults, [], `结构定义中存在无默认值字段：${orphanDefaults.join(', ')}`);

console.log(`文案配置检查通过：${schemaKeys.size} 个后台字段，${keys.size} 个前台引用。`);

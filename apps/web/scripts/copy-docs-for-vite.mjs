/**
 * Copies repo-root docs/*.md into src/bundled-docs/ so Vite can bundle them.
 * import.meta.glob outside apps/web is ignored in production builds; this keeps /docs TOC populated.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');
const docsSrc = join(webRoot, '..', '..', 'docs');
const dest = join(webRoot, 'src', 'bundled-docs');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let n = 0;
for (const name of readdirSync(docsSrc)) {
  if (!name.endsWith('.md')) continue;
  const abs = join(docsSrc, name);
  if (!statSync(abs).isFile()) continue;
  copyFileSync(abs, join(dest, name));
  n += 1;
}

console.log(`Copied ${n} markdown file(s) from docs/ to`, dest);

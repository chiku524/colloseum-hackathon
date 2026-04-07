import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');
const idlSrc = join(webRoot, '..', '..', 'idl', 'creator_treasury.json');
const idlDest = join(webRoot, 'api', 'idl.json');
mkdirSync(dirname(idlDest), { recursive: true });
copyFileSync(idlSrc, idlDest);
console.log('Copied IDL to', idlDest);

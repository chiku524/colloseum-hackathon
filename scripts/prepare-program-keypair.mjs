#!/usr/bin/env node
/**
 * Copies keys/creator_treasury-dev-keypair.json → target/deploy/creator_treasury-keypair.json
 * so `anchor build` / `anchor deploy` use the same program id as declare_id!.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'keys', 'creator_treasury-dev-keypair.json');
const destDir = join(root, 'target', 'deploy');
const dest = join(destDir, 'creator_treasury-keypair.json');

if (!existsSync(src)) {
  console.error('Missing', src);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('Copied program keypair to', dest);

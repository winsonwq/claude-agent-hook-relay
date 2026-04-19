#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
console.log(`ERROR: Do not publish locally.`);
console.log(`To publish v${pkg.version}, run:`);
console.log(`  git tag v${pkg.version} && git push origin v${pkg.version}`);
console.log(`This triggers GitHub Actions to publish to npm.`);
process.exit(1);

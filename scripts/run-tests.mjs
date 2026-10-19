// Cross-platform test runner: finds src/**/*.test.ts and runs node:test with tsx.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = walk(join(root, 'src')).sort();
if (files.length === 0) {
  console.error('No test files found');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);

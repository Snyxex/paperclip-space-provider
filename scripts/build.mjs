import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');
const verifyOnly = process.argv.includes('--verify-only');
if (!verifyOnly) await mkdir(output, { recursive: true });
for (const name of (await readdir(source)).filter(n => n.endsWith('.js'))) {
  const file = path.join(source, name);
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (!verifyOnly) await writeFile(path.join(output, name), await readFile(file));
}
console.log(verifyOnly ? 'Syntax checked.' : 'Built plugin distribution.');

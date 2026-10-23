import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
const issues = [];
const secretRules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['embedded URL credentials', /https?:\/\/[^\s/@]+:[^\s/@]+@/],
];
const textExtensions = /(?:^|\/)(?:Jenkinsfile|Dockerfile|\.gitignore|\.npmrc|LICENSE|[^/]+\.(?:md|json|js|mjs|cjs|ts|yml|yaml|sh|txt|toml|env|example))$/;
for (const file of files) {
  if (!textExtensions.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  for (const [label, re] of secretRules) {
    if (re.test(source)) issues.push(`${file}: possible ${label}`);
  }
  // Public samples must use reserved example domains, not a real person's email.
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi.test(source)) {
    for (const match of source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
      if (!/\.(?:example|invalid|test)$/i.test(match[0].split('@')[1])) {
        issues.push(`${file}: email address requires review`);
        break;
      }
    }
  }
}
if (issues.length) {
  console.error('Public distribution scan failed:\n'+issues.join('\n'));
  process.exitCode = 1;
} else console.log(`Public distribution scan passed (${files.length} tracked files checked)`);

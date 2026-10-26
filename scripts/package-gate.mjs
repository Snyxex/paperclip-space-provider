import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import manifest from '../src/manifest.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function assertPackageLayout({pkg,lock,manifest,packedFiles,sourceFiles,sourceMatchesDist}) {
  const fail=(message)=>{throw new Error('npm package gate: '+message);};
  if (!pkg || !lock || !manifest || !Array.isArray(packedFiles) || !Array.isArray(sourceFiles))
    fail('invalid metadata input');
  if (typeof pkg.version!=='string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version))
    fail('invalid semver version');
  if (pkg.version!==manifest.version || pkg.version!==lock.version || pkg.version!==lock.packages?.['']?.version)
    fail('package, lockfile and plugin manifest versions differ');
  if (pkg.name!==lock.name || pkg.name!==lock.packages?.['']?.name)
    fail('package and lockfile names differ');
  if (pkg.license!=='Apache-2.0' || pkg.type!=='module')
    fail('license or module format is unexpected');
  if (pkg.private!==true && pkg.private!==false) fail('private must be an explicit boolean');
  if (pkg.private===false && !/^@[a-z0-9][a-z0-9._-]*\/paperclip-space-provider$/.test(pkg.name))
    fail('publishable package must have an approved scoped name');
  if (pkg.main!=='./dist/index.js' || pkg.exports?.['.']!=='./dist/index.js' ||
    pkg.paperclipPlugin?.manifest!=='./dist/manifest.js' || pkg.paperclipPlugin?.worker!=='./dist/worker.js')
    fail('broken plugin entrypoints');
  if (!Array.isArray(pkg.files) || pkg.files.length!==3 ||
    !['dist/','README.md','LICENSE'].every(x=>pkg.files.includes(x)))
    fail('unexpected npm files allowlist');
  if (pkg.engines?.node!=='>=24.11.0') fail('unexpected Node.js support claim');
  if (pkg.dependencies?.['@paperclipai/plugin-sdk']!==lock.packages?.['']?.dependencies?.['@paperclipai/plugin-sdk'] ||
    pkg.dependencies['@paperclipai/plugin-sdk']!==lock.packages?.['node_modules/@paperclipai/plugin-sdk']?.version)
    fail('plugin SDK dependency is not pinned consistently');
  if (!Array.isArray(manifest.environmentDrivers) || !manifest.environmentDrivers.some(d=>d.driverKey==='space'))
    fail('SPACE driver missing from the plugin manifest');
  if (manifest.entrypoints?.worker!=='./dist/worker.js') fail('manifest worker entrypoint mismatch');

  const expected=new Set(['package.json','README.md','LICENSE',...sourceFiles.map(f=>'dist/'+f)]);
  const actual=new Set(packedFiles);
  if (actual.size!==packedFiles.length) fail('duplicate paths in package listing');
  for (const name of expected) if (!actual.has(name)) fail('required file missing: '+name);
  for (const name of actual) {
    if (!expected.has(name) || name.startsWith('/') || name.includes('..'))
      fail('unexpected file in npm tarball: '+name);
  }
  if (sourceMatchesDist!==true) fail('compiled distribution differs from reviewed source');
  return {files:actual.size,version:pkg.version,publishable:pkg.private===false};
}

async function main(){
  const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));
  const sourceFiles=readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js')).sort();
  const sourceMatchesDist=sourceFiles.every(f=>
    readFileSync(path.join(root,'src',f)).equals(readFileSync(path.join(root,'dist',f))));
  const report=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{
    cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,
    env:{...process.env,NPM_CONFIG_USERCONFIG:'/dev/null'},
  }));
  if (!Array.isArray(report) || report.length!==1 || !Array.isArray(report[0].files))
    throw new Error('npm pack returned invalid file metadata');
  const result=assertPackageLayout({
    pkg,lock,manifest,sourceFiles,sourceMatchesDist,
    packedFiles:report[0].files.map(f=>f.path),
  });
  console.log(`npm package gate PASS: ${result.files} reviewed files, ${result.version}, ${result.publishable?'publishable':'publication intentionally blocked'}`);
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.message);process.exitCode=1;});

import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPackageLayout} from '../scripts/package-gate.mjs';
const fixture=()=>{
 const pkg={
  name:'paperclip-space-provider',version:'0.1.0-alpha.1',license:'Apache-2.0',type:'module',private:true,
  main:'./dist/index.js',exports:{'.':'./dist/index.js'},
  paperclipPlugin:{manifest:'./dist/manifest.js',worker:'./dist/worker.js'},
  files:['dist/','README.md','LICENSE'],engines:{node:'>=24.11.0'},
  dependencies:{'@paperclipai/plugin-sdk':'2026.1012.0'},
 };
 const lock={name:pkg.name,version:pkg.version,packages:{
  '':{name:pkg.name,version:pkg.version,dependencies:{...pkg.dependencies}},
  'node_modules/@paperclipai/plugin-sdk':{version:'2026.1012.0'},
 }};
 const manifest={version:pkg.version,entrypoints:{worker:'./dist/worker.js'},environmentDrivers:[{driverKey:'space'}]};
 const sourceFiles=['plugin.js','manifest.js','worker.js','index.js'];
 return {pkg,lock,manifest,sourceFiles,sourceMatchesDist:true,
  packedFiles:['package.json','README.md','LICENSE',...sourceFiles.map(f=>'dist/'+f)]};
};
test('intentionally private prerelease can be built and checked without publishing',()=>{
 assert.deepEqual(assertPackageLayout(fixture()),{files:7,version:'0.1.0-alpha.1',publishable:false});
});
test('block unscoped publication but allow approved scoped metadata shape',()=>{
 const value=fixture();value.pkg.private=false;
 assert.throws(()=>assertPackageLayout(value),/approved scoped name/);
 value.pkg.name='@example/paperclip-space-provider';value.lock.name=value.pkg.name;value.lock.packages[''].name=value.pkg.name;
 assert.equal(assertPackageLayout(value).publishable,true);
});
test('block stale lock and manifest versions',()=>{
 const a=fixture();a.manifest.version='0.1.0-alpha.2';
 assert.throws(()=>assertPackageLayout(a),/versions differ/);
 const b=fixture();b.lock.packages[''].version='0.1.0-alpha.2';
 assert.throws(()=>assertPackageLayout(b),/versions differ/);
});
test('block accidental source, credential and unexpected files in tarball',()=>{
 for(const extra of ['src/config.js','.npmrc','dist/token.env','docs/private.txt','node_modules/test/index.js']) {
  const v=fixture();v.packedFiles.push(extra);
  assert.throws(()=>assertPackageLayout(v),/unexpected file/);
 }
});
test('block broken entrypoints and a stale dist build',()=>{
 const a=fixture();a.pkg.paperclipPlugin.worker='./dist/nonexistent.js';
 assert.throws(()=>assertPackageLayout(a),/broken plugin entrypoints/);
 const b=fixture();b.sourceMatchesDist=false;
 assert.throws(()=>assertPackageLayout(b),/differs from reviewed source/);
});
test('block unpinned SDK dependency changes',()=>{
 const value=fixture();value.pkg.dependencies['@paperclipai/plugin-sdk']='^2026.1012.0';
 assert.throws(()=>assertPackageLayout(value),/not pinned consistently/);
});

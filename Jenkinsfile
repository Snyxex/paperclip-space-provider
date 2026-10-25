// Untrusted branch and PR CI only. NEVER bind npm credentials in this pipeline.
pipeline {
  agent { label 'npm-ci' }
  // Jenkins NodeJS plugin: Manage Jenkins > Tools > NodeJS installation 'NodeJS-24'.
  // Auto-installs Node on the actual build agent and exposes node/npm on PATH.
  tools { nodejs 'NodeJS-24' }
  options {
    disableConcurrentBuilds()
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    skipDefaultCheckout()
  }
  environment {
    CI = 'true'
    NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/'
  }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Toolchain and package metadata') {
      steps { sh '''
        set -eu
        node --version
        npm --version
        node -e 'const [major, minor]=process.versions.node.split(".").map(Number); if(major<24||(major===24&&minor<11)) process.exit(1)'
        node -e 'const p=require("./package.json"); if(p.name!=="paperclip-space-provider"||p.private!==true) throw new Error("Unexpected development package metadata")'
      ''' }
    }
    stage('Install locked dependencies') {
      steps { sh '''
        set -eu
        test -f package-lock.json
        npm ci --ignore-scripts --no-audit --fund=false
      ''' }
    }
    stage('Public source hygiene') { steps { sh 'npm run check:public' } }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Protocol tests') { steps { sh 'npm test' } }
    stage('Plugin SDK smoke test') {
      steps { sh '''
        set -eu
        node --input-type=module - <<'NODE'
const [{default: plugin}, {default: manifest}] = await Promise.all([
  import('./dist/plugin.js'),
  import('./dist/manifest.js')
]);
if (typeof plugin !== 'object' || plugin === null) throw new Error('Plugin export missing');
if (typeof manifest !== 'object' || manifest === null) throw new Error('Manifest export missing');
if (!Array.isArray(manifest.environmentDrivers)) throw new Error('Environment drivers missing');
NODE
      ''' }
    }
    stage('Paperclip host package preflight (offline)') {
      steps { sh 'npm run check:paperclip-host' }
    }
    stage('Rootless Podman isolation tests (trusted main only)') {
      when { branch 'main' }
      // Reuse the pipeline's current npm-ci executor. Nested agents would
      // deadlock on a one-executor worker carrying both labels.
      steps {
        sh 'bash ci/docker-test.sh'
      }
    }
    stage('Dependency audit') {
      steps { sh 'npm audit --omit=dev --audit-level=high' }
    }
    stage('Package inspection') {
      steps { sh '''
        set -eu
        npm pack --dry-run --json > npm-pack-report.json
        node - <<'NODE'
const fs = require('node:fs');
const info = JSON.parse(fs.readFileSync('npm-pack-report.json','utf8'))[0];
const files = new Set(info.files.map(x=>x.path));
for (const name of ['dist/manifest.js','dist/worker.js','dist/plugin.js'])
  if (!files.has(name)) throw new Error('Missing package entry '+name);
for (const name of files)
  if (name.includes('.env') || name==='.npmrc' || name.startsWith('tests/'))
    throw new Error('Unexpected private/test file in npm package: '+name);
NODE
      ''' }
    }
  }
  post { always {
    archiveArtifacts artifacts: 'npm-pack-report.json', allowEmptyArchive: true
    deleteDir()
  } }
}

// Untrusted branch and PR CI only. NEVER bind npm credentials in this pipeline.
pipeline {
  agent { label 'npm-ci' }
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
    stage('Toolchain and ownership') {
      steps { sh '''
        set -eu
        node --version
        npm --version
        node -e 'const [major, minor]=process.versions.node.split(".").map(Number); if(major<24||(major===24&&minor<11)) process.exit(1)'
        node -e 'const p=require("./package.json"); if(p.name!=="@snyxex/paperclip-space-provider") throw new Error("Unexpected npm scope")'
      ''' }
    }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Protocol tests') { steps { sh 'npm test' } }
    stage('Dependency lock and audit') {
      steps { script {
        if (fileExists('package-lock.json')) {
          sh 'npm ci --ignore-scripts --no-audit --fund=false'
          sh 'npm audit --omit=dev --audit-level=high'
        } else {
          unstable('package-lock.json not committed: full dependency audit incomplete; npm release blocked')
        }
      } }
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

// PR and branch CI. No secrets are used here.
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
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Toolchain') {
      steps {
        sh '''
          set -eu
          node --version
          npm --version
          node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 11)) process.exit(1)'
          test -f package.json
          test -f package-lock.json
        '''
      }
    }

    stage('Dependencies') {
      steps {
        sh 'npm ci --ignore-scripts --no-audit --fund=false'
      }
    }

    stage('Tests') {
      steps {
        sh 'npm test'
      }
    }

    stage('Security audit') {
      steps {
        sh 'npm audit --omit=dev --audit-level=high'
      }
    }

    stage('Package inspection') {
      steps {
        sh '''
          set -eu
          npm pack --dry-run --json > npm-pack-report.json
          node -e 'const x=require("./npm-pack-report.json")[0]; if(!x.files.some(f=>f.path==="dist/manifest.js") || !x.files.some(f=>f.path==="dist/worker.js")) process.exit(1)'
        '''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'npm-pack-report.json', allowEmptyArchive: true
      deleteDir()
    }
  }
}

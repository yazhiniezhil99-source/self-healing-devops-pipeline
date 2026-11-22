pipeline {
  agent any
  environment { VERSION = "v1.${BUILD_NUMBER}.0"; DASH = 'http://localhost:3000' }
  triggers { pollSCM('H/2 * * * *') }       // or GitHub webhook
  stages {
    stage('Checkout')     { steps { checkout scm } }
    stage('Build')        { steps { sh 'npm ci' } }
    stage('Test')         { steps { sh 'npm test' } }
    stage('Docker Build') { steps { sh 'docker build -t shop-app:$VERSION -t shop-app:latest .' } }
    stage('Deploy')       { steps { sh 'docker tag shop-app:latest shop-app:previous || true; docker compose up -d --build' } }
    stage('Health Verify') {
      steps { retry(5) { sleep 4; sh 'curl -fs $DASH/healthz' } }
    }
  }
  post {
    failure {   // self-healing: roll back to previous image
      sh '''docker tag shop-app:previous shop-app:latest || true
            docker compose up -d --no-build || true'''
    }
    always {
      sh '''curl -s -X POST $DASH/api/webhook/jenkins -H "Content-Type: application/json" \
        -d "{\\"build\\":\\"$BUILD_NUMBER\\",\\"version\\":\\"$VERSION\\",\\"commit\\":\\"$GIT_COMMIT\\",\\"status\\":\\"${currentBuild.currentResult}\\"}" || true'''
    }
  }
}

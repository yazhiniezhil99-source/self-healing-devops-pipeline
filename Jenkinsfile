
pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
    }

    environment {
        PATH+NODE22 = 'D:\\tools\\node-v22.23.5-win-x64'
        VERSION = "v1.${BUILD_NUMBER}.0"
        DASH = 'http://localhost:3000'
    }

    triggers {
        pollSCM('H/2 * * * *')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                bat 'node --version'
                bat 'npm --version'
                bat 'npm ci'
            }
        }

        stage('Test') {
            steps {
                bat 'npm test'
            }
        }

        stage('Docker Build') {
            steps {
                bat '''
                docker image inspect shop-app:latest >nul 2>&1
                if not errorlevel 1 (
                    docker tag shop-app:latest shop-app:previous
                )
                docker build -t shop-app:%VERSION% -t shop-app:latest .
                '''
            }
        }

        stage('Deploy') {
            steps {
                bat 'docker compose up -d --no-build'
            }
        }

        stage('Health Verify') {
            steps {
                retry(5) {
                    sleep time: 4, unit: 'SECONDS'
                    bat 'node -e "fetch(process.env.DASH + \'/healthz\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'
                }
            }
        }
    }

    post {
        failure {
            bat '''
            docker image inspect shop-app:previous >nul 2>&1
            if errorlevel 1 (
                echo No previous image available; rollback skipped.
            ) else (
                echo Restoring previous application image...
                set "VERSION=previous"
                docker compose up -d --no-build
            )
            '''
        }

        always {
            script {
                env.BUILD_RESULT = currentBuild.currentResult

                writeFile file: 'jenkins-webhook.js', text: '''
const payload = {
    build: process.env.BUILD_NUMBER,
    version: process.env.VERSION,
    commit: process.env.GIT_COMMIT || '',
    status: process.env.BUILD_RESULT
};

fetch(process.env.DASH + '/api/webhook/jenkins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
})
.then(async response => {
    console.log('Dashboard webhook HTTP:', response.status);
    if (!response.ok) console.log(await response.text());
})
.catch(error => {
    console.log('Dashboard webhook error:', error.message);
});
'''

                bat 'node jenkins-webhook.js'
            }
        }
    }
}

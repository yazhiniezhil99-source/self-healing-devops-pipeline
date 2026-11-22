
pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
    }

    environment {
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
                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"
                where node
                node --version
                where npm
                npm --version
                npm ci
                '''
            }
        }

        stage('Test') {
            steps {
                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"
                node --version
                npm test
                '''
            }
        }

        stage('Docker Build') {
            steps {
                bat '''
                set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;D:\\tools\\node-v22.23.5-win-x64;%PATH%"

                docker --version

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
                bat '''
                set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;%PATH%"
                docker compose up -d --no-build
                '''
            }
        }

        stage('Health Verify') {
            steps {
                retry(5) {
                    sleep time: 4, unit: 'SECONDS'

                    bat '''
                    set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"
                    node -e "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
                    '''
                }
            }
        }
    }

    post {
        failure {
            bat '''
            set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;%PATH%"

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

                bat '"D:\\tools\\node-v22.23.5-win-x64\\node.exe" jenkins-webhook.js'
            }
        }
    }
}


pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
    }

    environment {
        VERSION = "v1.${BUILD_NUMBER}.0"
        DASH = 'http://localhost:3000'

        CHECKOUT_STATUS = 'waiting'
        BUILD_STATUS = 'waiting'
        TEST_STATUS = 'waiting'
        DOCKER_STATUS = 'waiting'
        DEPLOY_STATUS = 'waiting'
        HEALTH_STATUS = 'waiting'
    }

    triggers {
        pollSCM('H/2 * * * *')
    }

    stages {

        stage('Checkout') {
            steps {
                script {
                    def checkoutInfo = checkout scm
                    env.GIT_COMMIT = checkoutInfo.GIT_COMMIT ?: ''
                    env.CHECKOUT_STATUS = 'success'
                }
            }
        }

        stage('Build') {
            steps {
                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"
                node --version
                call npm.cmd ci
                if errorlevel 1 exit /b 1
                '''

                script {
                    env.BUILD_STATUS = 'success'
                }
            }
        }

        stage('Test') {
            steps {
                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"
                call npm.cmd test
                if errorlevel 1 exit /b 1
                '''

                script {
                    env.TEST_STATUS = 'success'
                }
            }
        }

        stage('Docker Build') {
            steps {
                bat '''
                set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;%PATH%"

                docker image inspect shop-app:latest >nul 2>&1
                if not errorlevel 1 (
                    docker tag shop-app:latest shop-app:previous
                    if errorlevel 1 exit /b 1
                )

                docker build -t shop-app:%VERSION% -t shop-app:latest .
                if errorlevel 1 exit /b 1
                '''

                script {
                    env.DOCKER_STATUS = 'success'
                }
            }
        }

        stage('Deploy') {
            steps {
                bat '''
                "C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker-compose.exe" -p self-healing-pipeline up -d --no-build

                if errorlevel 1 exit /b 1
                '''

                script {
                    env.DEPLOY_STATUS = 'success'
                }
            }
        }

        stage('Health Verify') {
            steps {
                retry(5) {
                    sleep time: 4, unit: 'SECONDS'

                    bat '''
                    set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"

                    node -e "fetch('http://localhost:3000/healthz').then(r => {console.log('HTTP Status:',r.status);process.exit(r.ok?0:1)}).catch(e => {console.error(e.message);process.exit(1)})"

                    if errorlevel 1 exit /b 1
                    '''
                }

                script {
                    env.HEALTH_STATUS = 'success'
                }
            }
        }
    }

    post {

        failure {
            script {
                if (env.CHECKOUT_STATUS == 'waiting')
                    env.CHECKOUT_STATUS = 'failed'
                else if (env.BUILD_STATUS == 'waiting')
                    env.BUILD_STATUS = 'failed'
                else if (env.TEST_STATUS == 'waiting')
                    env.TEST_STATUS = 'failed'
                else if (env.DOCKER_STATUS == 'waiting')
                    env.DOCKER_STATUS = 'failed'
                else if (env.DEPLOY_STATUS == 'waiting')
                    env.DEPLOY_STATUS = 'failed'
                else if (env.HEALTH_STATUS == 'waiting')
                    env.HEALTH_STATUS = 'failed'
            }

            bat '''
            set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;%PATH%"

            docker image inspect shop-app:previous >nul 2>&1

            if not errorlevel 1 (
                set "VERSION=previous"
                docker-compose.exe -p self-healing-pipeline up -d --no-build
            ) else (
                echo No previous image available for rollback.
            )

            exit /b 0
            '''
        }

        always {
            script {
                env.BUILD_RESULT = currentBuild.currentResult

                writeFile file: 'jenkins-payload.json', text: """{
                    "build": "${env.BUILD_NUMBER}",
                    "version": "${env.VERSION}",
                    "commit": "${env.GIT_COMMIT ?: ''}",
                    "status": "${env.BUILD_RESULT}",
                    "stages": [
                        {
                            "name": "Checkout",
                            "status": "${env.CHECKOUT_STATUS}",
                            "detail": "GitHub source checkout from main",
                            "ms": 0
                        },
                        {
                            "name": "Build",
                            "status": "${env.BUILD_STATUS}",
                            "detail": "npm ci",
                            "ms": 0
                        },
                        {
                            "name": "Test",
                            "status": "${env.TEST_STATUS}",
                            "detail": "npm test",
                            "ms": 0
                        },
                        {
                            "name": "Docker Build",
                            "status": "${env.DOCKER_STATUS}",
                            "detail": "Docker image build and tagging",
                            "ms": 0
                        },
                        {
                            "name": "Deploy",
                            "status": "${env.DEPLOY_STATUS}",
                            "detail": "Docker Compose deployment",
                            "ms": 0
                        },
                        {
                            "name": "Health Verify",
                            "status": "${env.HEALTH_STATUS}",
                            "detail": "GET /healthz HTTP health verification",
                            "ms": 0
                        }
                    ]
                }"""

                writeFile file: 'jenkins-webhook.js', text: '''
const fs = require('fs');

const payload = JSON.parse(
    fs.readFileSync('jenkins-payload.json', 'utf8')
);

fetch(process.env.DASH + '/api/webhook/jenkins', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
})
.then(async response => {
    console.log('Dashboard webhook HTTP:', response.status);

    if (!response.ok) {
        console.log(await response.text());
        process.exitCode = 1;
    }
})
.catch(error => {
    console.error('Dashboard webhook error:', error.message);
    process.exitCode = 1;
});
'''

                bat '"D:\\tools\\node-v22.23.5-win-x64\\node.exe" jenkins-webhook.js'
            }
        }
    }
}

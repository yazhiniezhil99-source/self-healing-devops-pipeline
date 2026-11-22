
def stageResults = [
    'Checkout': [
        status: 'waiting',
        detail: 'GitHub source checkout from main',
        ms: 0
    ],
    'Build': [
        status: 'waiting',
        detail: 'npm ci',
        ms: 0
    ],
    'Test': [
        status: 'waiting',
        detail: 'npm test',
        ms: 0
    ],
    'Docker Build': [
        status: 'waiting',
        detail: 'Docker image build and tagging',
        ms: 0
    ],
    'Deploy': [
        status: 'waiting',
        detail: 'Docker Compose deployment',
        ms: 0
    ],
    'Health Verify': [
        status: 'waiting',
        detail: 'GET /healthz HTTP health verification',
        ms: 0
    ]
]

def stageStarted = [:]

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
                script {
                    stageStarted['Checkout'] = System.currentTimeMillis()

                    def checkoutInfo = checkout scm

                    env.GIT_COMMIT = checkoutInfo.GIT_COMMIT ?: ''

                    stageResults['Checkout'].status = 'success'
                    stageResults['Checkout'].ms =
                        (System.currentTimeMillis() - stageStarted['Checkout']) as Integer
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    stageStarted['Build'] = System.currentTimeMillis()
                }

                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"

                node --version
                call npm.cmd ci

                if errorlevel 1 exit /b 1
                '''

                script {
                    stageResults['Build'].status = 'success'
                    stageResults['Build'].ms =
                        (System.currentTimeMillis() - stageStarted['Build']) as Integer
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    stageStarted['Test'] = System.currentTimeMillis()
                }

                bat '''
                set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"

                call npm.cmd test

                if errorlevel 1 exit /b 1
                '''

                script {
                    stageResults['Test'].status = 'success'
                    stageResults['Test'].ms =
                        (System.currentTimeMillis() - stageStarted['Test']) as Integer
                }
            }
        }

        stage('Docker Build') {
            steps {
                script {
                    stageStarted['Docker Build'] = System.currentTimeMillis()
                }

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
                    stageResults['Docker Build'].status = 'success'
                    stageResults['Docker Build'].ms =
                        (System.currentTimeMillis() - stageStarted['Docker Build']) as Integer
                }
            }
        }

        stage('Deploy') {
            steps {
                script {
                    stageStarted['Deploy'] = System.currentTimeMillis()
                }

                bat '''
                "C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker-compose.exe" -p self-healing-pipeline up -d --no-build

                if errorlevel 1 exit /b 1
                '''

                script {
                    stageResults['Deploy'].status = 'success'
                    stageResults['Deploy'].ms =
                        (System.currentTimeMillis() - stageStarted['Deploy']) as Integer
                }
            }
        }

        stage('Health Verify') {
            steps {
                script {
                    stageStarted['Health Verify'] = System.currentTimeMillis()
                }

                retry(5) {
                    sleep time: 4, unit: 'SECONDS'

                    bat '''
                    set "PATH=D:\\tools\\node-v22.23.5-win-x64;%PATH%"

                    node -e "fetch('http://localhost:3000/healthz').then(r => {console.log('HTTP Status:',r.status);process.exit(r.ok?0:1)}).catch(e => {console.error(e.message);process.exit(1)})"

                    if errorlevel 1 exit /b 1
                    '''
                }

                script {
                    stageResults['Health Verify'].status = 'success'
                    stageResults['Health Verify'].ms =
                        (System.currentTimeMillis() - stageStarted['Health Verify']) as Integer
                }
            }
        }
    }

    post {

        failure {
            script {
                def pending = stageResults.find {
                    name, result -> result.status == 'waiting'
                }

                if (pending != null) {
                    pending.value.status = 'failed'
                }
            }

            bat '''
            set "PATH=C:\\Users\\manib\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;%PATH%"

            docker image inspect shop-app:previous >nul 2>&1

            if not errorlevel 1 (
                echo Attempting rollback...

                docker-compose.exe -p self-healing-pipeline up -d --no-build
            ) else (
                echo No previous image available for rollback.
            )

            exit /b 0
            '''
        }

        always {
            script {
                def payload = [
                    build: env.BUILD_NUMBER,
                    version: env.VERSION,
                    commit: env.GIT_COMMIT ?: '',
                    status: currentBuild.currentResult,
                    stages: stageResults.collect { name, result ->
                        [
                            name: name,
                            status: result.status,
                            detail: result.detail,
                            ms: result.ms
                        ]
                    }
                ]

                writeFile(
                    file: 'jenkins-payload.json',
                    text: groovy.json.JsonOutput.toJson(payload)
                )

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

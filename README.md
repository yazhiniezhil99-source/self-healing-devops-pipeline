# Self-Healing DevOps Pipeline
Failure detection, automated recovery and monitoring. Stack: Node/Express, SQLite, vanilla JS dashboard, Docker, Jenkins.

## Run
    npm install && npm start        # http://localhost:3000
    docker compose up -d --build    # containerised
    npm test

## Jenkins
Create a Pipeline job from SCM pointing at your GitHub repo (uses `Jenkinsfile`). Add a GitHub webhook to `<jenkins>/github-webhook/`.
Each build posts its result to `/api/webhook/jenkins`; failures roll back to the `shop-app:previous` image.

## Mapping to the requirements
| Requirement | Where |
|---|---|
| GitHub repo | push this folder; Jenkins checks out via `checkout scm` |
| Jenkins config / automated execution | `Jenkinsfile` (poll SCM or webhook) |
| Build & test results | Test stage, `npm test`, Pipeline Runs table |
| Docker deployment | `Dockerfile`, `docker-compose.yml` |
| Failure detection | probe loop in `server.js` every 3s, HEALTHCHECK |
| Self-healing recovery | restart / rollback with 3 retries, then escalate |
| Health verification | Health Verify stage and post-recovery check |
| Monitoring dashboard | `public/index.html` |

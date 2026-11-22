
// Self-Healing DevOps Pipeline
// Backend: Express + SQLite

const express = require('express');
const Database = require('better-sqlite3');

const db = new Database(process.env.DB || 'data.db');

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT,
    commit_sha TEXT,
    status TEXT,
    source TEXT,
    started TEXT,
    finished TEXT
);

CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INT,
    name TEXT,
    status TEXT,
    detail TEXT,
    ms INT
);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    detected TEXT,
    recovered TEXT,
    action TEXT,
    status TEXT,
    attempts INT DEFAULT 0,
    mttr_s REAL
);

CREATE TABLE IF NOT EXISTS health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    status TEXT,
    latency INT
);
`);

const app = express();

app.use(express.json());
app.use(express.static('public'));

const now = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = () => Math.random().toString(16).slice(2, 9);

// Dashboard deployment state.
// Jenkins webhook updates this after successful deployment.
const target = {
    status: 'up',
    version: 'v1.0.0',
    lastGood: 'v1.0.0',
    fault: null,
    container: 'shop-app',
    restarts: 0
};

let building = false;
let buildNo = 0;

const STAGES = [
    'Checkout',
    'Build',
    'Test',
    'Docker Build',
    'Deploy',
    'Health Verify'
];

const DETAIL = {
    Checkout: 'GitHub source checkout, branch main',
    Build: 'npm ci',
    Test: 'npm test (unit and integration)',
    'Docker Build': 'docker build -t shop-app',
    Deploy: 'Docker Compose deployment',
    'Health Verify': 'GET /healthz must return HTTP 200'
};

// Application health endpoint
app.get('/healthz', (_, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime()
    });
});

// Simulated pipeline execution
app.post('/api/pipeline/run', (req, res) => {
    if (building) {
        return res.status(409).json({
            error: 'A pipeline run is already in progress'
        });
    }

    const fail = req.body.fail || null;
    const version = `v1.${++buildNo}.0`;

    const run = db.prepare(
        'INSERT INTO runs(version,commit_sha,status,source,started) VALUES(?,?,?,?,?)'
    ).run(
        version,
        sha(),
        'running',
        'simulated',
        now()
    ).lastInsertRowid;

    res.status(202).json({
        id: run,
        version
    });

    executeRun(run, version, fail).catch(error => {
        console.error('Simulated pipeline error:', error);
        building = false;
    });
});

async function executeRun(run, version, fail) {
    building = true;
    let ok = true;

    const insertStage = db.prepare(
        'INSERT INTO stages(run_id,name,status,detail,ms) VALUES(?,?,?,?,?)'
    );

    for (const stage of STAGES) {
        const stageId = insertStage.run(
            run,
            stage,
            'running',
            DETAIL[stage],
            0
        ).lastInsertRowid;

        const started = Date.now();

        await sleep(900 + Math.random() * 600);

        let status = 'success';
        let detail = DETAIL[stage];

        if (fail === stage) {
            status = 'failed';
            detail = `${stage} failed: simulated error`;
        }

        if (stage === 'Deploy' && status === 'success') {
            target.version = version;
            target.status = 'up';
            target.fault = fail === 'bad-release'
                ? 'bad-release'
                : null;
        }

        if (
            stage === 'Health Verify' &&
            target.fault === 'bad-release'
        ) {
            status = 'failed';
            detail = 'Health check returned 500 after deploy';
        }

        db.prepare(
            'UPDATE stages SET status=?,detail=?,ms=? WHERE id=?'
        ).run(
            status,
            detail,
            Date.now() - started,
            stageId
        );

        if (status === 'failed') {
            ok = false;

            if (stage === 'Health Verify') {
                target.status = 'down';
            }

            break;
        }
    }

    if (ok) {
        target.lastGood = version;
    }

    db.prepare(
        'UPDATE runs SET status=?,finished=? WHERE id=?'
    ).run(
        ok ? 'success' : 'failed',
        now(),
        run
    );

    building = false;
}

// Jenkins webhook: receive actual pipeline execution results
app.post('/api/webhook/jenkins', (req, res) => {
    const {
        build,
        status,
        version,
        commit,
        stages = []
    } = req.body;

    const successful =
        String(status).toUpperCase() === 'SUCCESS';

    const run = db.prepare(`
        INSERT INTO runs
        (version,commit_sha,status,source,started,finished)
        VALUES(?,?,?,?,?,?)
    `).run(
        version || `jenkins#${build}`,
        commit || '-',
        successful ? 'success' : 'failed',
        'jenkins',
        now(),
        now()
    );

    const runId = run.lastInsertRowid;

    // Save actual stage information when supplied by Jenkins.
    if (Array.isArray(stages)) {
        const insertStage = db.prepare(`
            INSERT INTO stages
            (run_id,name,status,detail,ms)
            VALUES(?,?,?,?,?)
        `);

        stages.forEach(stage => {
            insertStage.run(
                runId,
                stage.name,
                stage.status,
                stage.detail || '',
                stage.ms || 0
            );
        });
    }

    // Synchronize dashboard state after successful Jenkins deployment.
    if (successful && version) {
        target.status = 'up';
        target.version = version;
        target.lastGood = version;
        target.fault = null;
    }

    console.log(
        `Jenkins build ${build}: ${status}, version ${version}, commit ${commit || '-'}`
    );

    res.json({
        ok: true,
        id: runId,
        target
    });
});

// Fault injection for dashboard demonstrations
app.post('/api/inject', (req, res) => {
    const type = req.body.type || 'container-crash';

    target.status = 'down';
    target.fault = type;

    res.json({
        injected: type
    });
});

// Recovery actions used by the dashboard simulation
const RECOVERY = {
    'container-crash': {
        action: 'Restart container',
        fixes: () => {
            target.restarts++;
        }
    },

    'memory-leak': {
        action: 'Restart container with fresh memory',
        fixes: () => {
            target.restarts++;
        }
    },

    'bad-release': {
        action: 'Roll back to last good version',
        fixes: () => {
            target.version = target.lastGood;
        }
    }
};

let healing = false;

// Failure detection and dashboard recovery simulation
async function probe() {
    const up = target.status === 'up' && !target.fault;

    db.prepare(
        'INSERT INTO health(ts,status,latency) VALUES(?,?,?)'
    ).run(
        now(),
        up ? 'up' : 'down',
        up ? 20 + Math.floor(Math.random() * 40) : 0
    );

    if (up || healing || building) {
        return;
    }

    healing = true;

    try {
        const fault = target.fault || 'container-crash';

        const incident = db.prepare(`
            INSERT INTO incidents(type,detected,action,status)
            VALUES(?,?,?,?)
        `).run(
            fault,
            now(),
            'Detected: probe failed',
            'recovering'
        ).lastInsertRowid;

        const start = Date.now();

        for (let attempt = 1; attempt <= 3; attempt++) {
            const plan =
                RECOVERY[fault] || RECOVERY['container-crash'];

            db.prepare(`
                UPDATE incidents
                SET action=?,attempts=?
                WHERE id=?
            `).run(
                plan.action,
                attempt,
                incident
            );

            await sleep(2500);

            plan.fixes();

            target.fault = null;
            target.status = 'up';

            await sleep(800);

            if (target.status === 'up' && !target.fault) {
                db.prepare(`
                    UPDATE incidents
                    SET status=?,recovered=?,mttr_s=?
                    WHERE id=?
                `).run(
                    'recovered',
                    now(),
                    (Date.now() - start) / 1000,
                    incident
                );

                return;
            }
        }

        db.prepare(
            'UPDATE incidents SET status=? WHERE id=?'
        ).run(
            'escalated',
            incident
        );

    } catch (error) {
        console.error('Recovery monitoring error:', error);
    } finally {
        healing = false;
    }
}

setInterval(probe, 3000).unref();

// Dashboard status and monitoring metrics
app.get('/api/status', (_, res) => {
    const health = db.prepare(`
        SELECT status FROM (
            SELECT * FROM health
            ORDER BY id DESC LIMIT 100
        )
    `).all();

    const runs = db.prepare(`
        SELECT
            COUNT(*) AS n,
            SUM(status='success') AS ok
        FROM runs
    `).get();

    const mttr = db.prepare(`
        SELECT AVG(mttr_s) AS v
        FROM incidents
        WHERE status='recovered'
    `).get().v;

    res.json({
        target,
        building,
        healing,

        uptime: health.length
            ? +(
                100 * health.filter(x => x.status === 'up').length /
                health.length
              ).toFixed(1)
            : 100,

        runs: runs.n,

        successRate: runs.n
            ? Math.round(100 * runs.ok / runs.n)
            : 0,

        incidents: db.prepare(
            'SELECT COUNT(*) AS n FROM incidents'
        ).get().n,

        mttr: mttr
            ? +mttr.toFixed(1)
            : null,

        health: db.prepare(`
            SELECT ts,status,latency
            FROM health
            ORDER BY id DESC
            LIMIT 40
        `).all().reverse()
    });
});

// Build and testing history
app.get('/api/runs', (_, res) => {
    const runs = db.prepare(`
        SELECT *
        FROM runs
        ORDER BY id DESC
        LIMIT 10
    `).all();

    runs.forEach(run => {
        run.stages = db.prepare(`
            SELECT name,status,detail,ms
            FROM stages
            WHERE run_id=?
            ORDER BY id
        `).all(run.id);
    });

    res.json(runs);
});

// Incident history
app.get('/api/incidents', (_, res) => {
    res.json(
        db.prepare(`
            SELECT *
            FROM incidents
            ORDER BY id DESC
            LIMIT 15
        `).all()
    );
});

// Start application server
if (require.main === module) {
    const port = process.env.PORT || 3000;

    app.listen(port, () => {
        console.log('Dashboard on :' + port);
    });
}

module.exports = {
    app,
    db
};

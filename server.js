// Self-Healing DevOps Pipeline: backend (Express + SQLite)
const express = require('express');
const Database = require('better-sqlite3');
const db = new Database(process.env.DB || 'data.db');
db.exec(`
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT,version TEXT,commit_sha TEXT,status TEXT,source TEXT,started TEXT,finished TEXT);
CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INT,name TEXT,status TEXT,detail TEXT,ms INT);
CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,detected TEXT,recovered TEXT,action TEXT,status TEXT,attempts INT DEFAULT 0,mttr_s REAL);
CREATE TABLE IF NOT EXISTS health(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT,status TEXT,latency INT);`);

const app = express();
app.use(express.json());
app.use(express.static('public'));
const now = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = () => Math.random().toString(16).slice(2, 9);

// Simulated deployed container (the "target app" the pipeline manages)
const target = { status: 'up', version: 'v1.0.0', lastGood: 'v1.0.0', fault: null, container: 'shop-app', restarts: 0 };
let building = false, buildNo = 0;

const STAGES = ['Checkout', 'Build', 'Test', 'Docker Build', 'Deploy', 'Health Verify'];
const DETAIL = {
  Checkout: 'git clone from GitHub, branch main', Build: 'npm ci && npm run build',
  Test: 'npm test (unit + integration)', 'Docker Build': 'docker build -t shop-app',
  Deploy: 'docker compose up -d shop-app', 'Health Verify': 'GET /healthz must return 200'
};

app.get('/healthz', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Run pipeline. body.fail = 'Test' | 'Build' | 'bad-release' | undefined
app.post('/api/pipeline/run', (req, res) => {
  if (building) return res.status(409).json({ error: 'A pipeline run is already in progress' });
  const fail = req.body.fail || null;
  const version = `v1.${++buildNo}.0`;
  const run = db.prepare('INSERT INTO runs(version,commit_sha,status,source,started) VALUES(?,?,?,?,?)')
    .run(version, sha(), 'running', 'simulated', now()).lastInsertRowid;
  res.status(202).json({ id: run, version });
  executeRun(run, version, fail);
});

async function executeRun(run, version, fail) {
  building = true;
  let ok = true;
  const ins = db.prepare('INSERT INTO stages(run_id,name,status,detail,ms) VALUES(?,?,?,?,?)');
  for (const s of STAGES) {
    const id = ins.run(run, s, 'running', DETAIL[s], 0).lastInsertRowid;
    const t = Date.now(); await sleep(900 + Math.random() * 600);
    let status = 'success', detail = DETAIL[s];
    if (fail === s) { status = 'failed'; detail = `${s} failed: simulated error`; }
    if (s === 'Deploy' && status === 'success') { target.version = version; target.status = 'up'; target.fault = fail === 'bad-release' ? 'bad-release' : null; }
    if (s === 'Health Verify' && target.fault === 'bad-release') { status = 'failed'; detail = 'Health check returned 500 after deploy'; }
    db.prepare('UPDATE stages SET status=?,detail=?,ms=? WHERE id=?').run(status, detail, Date.now() - t, id);
    if (status === 'failed') { ok = false; if (s === 'Health Verify') target.status = 'down'; break; }
  }
  if (ok) target.lastGood = version;
  db.prepare('UPDATE runs SET status=?,finished=? WHERE id=?').run(ok ? 'success' : 'failed', now(), run);
  building = false; // monitor loop will detect a bad release and self-heal
}

// Jenkins webhook: real pipeline results posted from the Jenkinsfile
app.post('/api/webhook/jenkins', (req, res) => {
  const { build, status, version, commit, stages = [] } = req.body;
  const id = db.prepare('INSERT INTO runs(version,commit_sha,status,source,started,finished) VALUES(?,?,?,?,?,?)')
    .run(version || `jenkins#${build}`, commit || '-', status === 'SUCCESS' ? 'success' : 'failed', 'jenkins', now(), now()).lastInsertRowid;
  stages.forEach(s => db.prepare('INSERT INTO stages(run_id,name,status,detail,ms) VALUES(?,?,?,?,?)').run(id, s.name, s.status, s.detail || '', s.ms || 0));
  res.json({ ok: true, id });
});

// Fault injection (to demonstrate detection and recovery)
app.post('/api/inject', (req, res) => {
  const type = req.body.type || 'container-crash';
  target.status = 'down'; target.fault = type;
  res.json({ injected: type });
});

// Failure detection + self-healing loop
const RECOVERY = {
  'container-crash': { action: 'Restart container', fixes: () => { target.restarts++; } },
  'memory-leak': { action: 'Restart container with fresh memory', fixes: () => { target.restarts++; } },
  'bad-release': { action: `Roll back to last good version`, fixes: () => { target.version = target.lastGood; } },
};
let healing = false;
async function probe() {
  const t = Date.now();
  const up = target.status === 'up' && !target.fault;
  db.prepare('INSERT INTO health(ts,status,latency) VALUES(?,?,?)').run(now(), up ? 'up' : 'down', up ? 20 + Math.floor(Math.random() * 40) : 0);
  if (up || healing || building) return;
  healing = true;
  const fault = target.fault || 'container-crash';
  const inc = db.prepare('INSERT INTO incidents(type,detected,action,status) VALUES(?,?,?,?)').run(fault, now(), 'Detected: probe failed', 'recovering').lastInsertRowid;
  const start = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const plan = RECOVERY[fault] || RECOVERY['container-crash'];
    db.prepare('UPDATE incidents SET action=?,attempts=? WHERE id=?').run(plan.action, attempt, inc);
    await sleep(2500);
    plan.fixes(); target.fault = null; target.status = 'up';   // recovery executed
    await sleep(800);                                          // verify health
    if (target.status === 'up' && !target.fault) {
      db.prepare('UPDATE incidents SET status=?,recovered=?,mttr_s=? WHERE id=?').run('recovered', now(), (Date.now() - start) / 1000, inc);
      healing = false; return;
    }
  }
  db.prepare('UPDATE incidents SET status=? WHERE id=?').run('escalated', inc);
  healing = false;
}
setInterval(probe, 3000).unref();

app.get('/api/status', (_, res) => {
  const h = db.prepare('SELECT status FROM (SELECT * FROM health ORDER BY id DESC LIMIT 100)').all();
  const runs = db.prepare("SELECT COUNT(*) n, SUM(status='success') ok FROM runs").get();
  const mttr = db.prepare("SELECT AVG(mttr_s) v FROM incidents WHERE status='recovered'").get().v;
  res.json({
    target, building, healing,
    uptime: h.length ? +(100 * h.filter(x => x.status === 'up').length / h.length).toFixed(1) : 100,
    runs: runs.n, successRate: runs.n ? Math.round(100 * runs.ok / runs.n) : 0,
    incidents: db.prepare('SELECT COUNT(*) n FROM incidents').get().n, mttr: mttr ? +mttr.toFixed(1) : null,
    health: db.prepare('SELECT ts,status,latency FROM health ORDER BY id DESC LIMIT 40').all().reverse(),
  });
});
app.get('/api/runs', (_, res) => {
  const runs = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 10').all();
  runs.forEach(r => r.stages = db.prepare('SELECT name,status,detail,ms FROM stages WHERE run_id=? ORDER BY id').all(r.id));
  res.json(runs);
});
app.get('/api/incidents', (_, res) => res.json(db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT 15').all()));

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Dashboard on :' + (process.env.PORT || 3000)));
module.exports = { app, db };

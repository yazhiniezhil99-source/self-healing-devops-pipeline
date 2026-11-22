process.env.DB = ':memory:';
const test = require('node:test'), assert = require('node:assert');
const { app } = require('../server');
let srv, base;
test.before(() => new Promise(r => { srv = app.listen(0, () => { base = `http://localhost:${srv.address().port}`; r(); }); }));
test.after(() => srv.close());
test('healthz returns ok', async () => assert.equal((await (await fetch(base + '/healthz')).json()).status, 'ok'));
test('status exposes target app', async () => assert.equal((await (await fetch(base + '/api/status')).json()).target.status, 'up'));
test('inject marks target down', async () => {
  await fetch(base + '/api/inject', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await (await fetch(base + '/api/status')).json()).target.status, 'down');
});

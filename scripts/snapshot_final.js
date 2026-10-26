// One-off, after the count is final: save everything the page shows as data/final.json, so the published site
// can be frozen and stop calling TSE. Usage: node scripts/snapshot_final.js
const fs = require('fs');
const path = require('path');
const { createCore } = require('../lib/core');

const root = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));

(async () => {
  const core = createCore({
    base: read('base2022.json'),
    baseR1: read('base2026r1.json'),
    forceRound: 2,
    subConcurrency: 4,
    log: console.log,
  });
  await core.poll(); // round 2 now, and round 1 once
  await core.pollSub(Object.fromEntries(Object.entries(read('states_mun.json')).filter(([uf]) => ['sp', 'mg'].includes(uf))));
  const p = core.payload();
  const pres = p.rounds[2].races.president;
  if (!pres?.total.final) throw new Error('runoff count is not marked final yet');
  if (p.errors.length || p.sub?.errors.length) throw new Error(`fetch errors: ${[...p.errors, ...(p.sub?.errors || [])].slice(0, 5)}`);
  p.final = { at: new Date().toISOString(), counted: pres.total.counted };
  p.nextPollAt = null;
  fs.writeFileSync(path.join(root, 'data', 'final.json'), JSON.stringify(p));
  const r1 = p.rounds[1].races;
  console.log('saved; runoff', pres.total.counted, pres.total.cands.map((c) => `${c.name} ${c.pct.toFixed(2)} ${c.elected ? 'elected' : ''}`).join(' | '));
  console.log('RJ governor R1', r1.governor.total.counted, r1.governor.total.cands.slice(0, 3).map((c) => `${c.name} ${c.pct.toFixed(2)} ${c.status} ${c.result} ${c.elected ? 'elected' : ''}`).join(' | '));
  console.log('governor R2', p.rounds[2].races.governor, '| sub', p.sub && Object.fromEntries(Object.entries(p.sub.states).map(([k, v]) => [k, v.length])));
  console.log('size', (fs.statSync(path.join(root, 'data', 'final.json')).size / 1e6).toFixed(2), 'MB');
})();

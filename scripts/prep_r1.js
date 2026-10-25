// One-off, after the first round is final: 2026 first-round PL and PT votes by state (two-way baseline)
// and the two-way count curve from Urna Aberta's history. Usage: node scripts/prep_r1.js
const fs = require('fs');
const path = require('path');
const { fetchRace, fetchUrnaAbertaHistory } = require('../lib/tse');

(async () => {
  const race = await fetchRace('president', 1);
  if (!race || race.errors.length) throw new Error(`first round fetch failed: ${race?.errors}`);
  const votes = (u, n) => u.cands.find((c) => c.n === n)?.votes || 0;
  const row = (u) => ({ pt: votes(u, '13'), pl: votes(u, '22'), valid: votes(u, '13') + votes(u, '22') });
  const byUf = Object.fromEntries(race.units.map((u) => [u.code, row(u)]));
  const total = row(race.total);

  const bySq = Object.fromEntries(race.total.cands.map((c) => [c.sq, c.n]));
  const sq = (n) => Object.keys(bySq).find((k) => bySq[k] === n);
  const curve = (await fetchUrnaAbertaHistory(race.ele))
    .map((p) => ({ pct: p.p, pt: p.v[sq('13')], pl: p.v[sq('22')] }))
    .filter((p) => p.pt != null && p.pl != null)
    .map((p) => ({ pct: p.pct, lula: +((100 * p.pt) / (p.pt + p.pl)).toFixed(3), bolsonaro: +((100 * p.pl) / (p.pt + p.pl)).toFixed(3) }));
  // End the curve at the final count.
  curve.push({ pct: 100, lula: +((100 * total.pt) / total.valid).toFixed(3), bolsonaro: +((100 * total.pl) / total.valid).toFixed(3) });

  const out = path.join(__dirname, '..', 'data');
  fs.writeFileSync(path.join(out, 'base2026r1.json'), JSON.stringify({ final: race.total.final, sectionsPct: race.total.sectionsPct, total, byUf }));
  fs.writeFileSync(path.join(out, 'pres2026r1_curve.json'), JSON.stringify(curve));
  console.log('final', race.total.final, race.total.sectionsPct, 'states', Object.keys(byUf).length, 'two-way', total,
    'PT %', ((100 * total.pt) / total.valid).toFixed(2), 'curve points', curve.length, curve[0], curve.at(-2));
})();

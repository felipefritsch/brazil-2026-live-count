// Compare each area's 2026 result so far with an earlier result in the same area.
// President: change in the PL-minus-PT margin, against the 2022 result of the same round and,
// in the runoff, against the 2026 first round taken as a two-way PL vs PT race.
// RJ governor: change in the PL candidate's share (2022 was decided in the first round).
const share = (u, n) => u.cands.find((c) => c.n === n)?.pct ?? 0;
const titleCase = (t) => t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Shared loop: per-area swing (now minus then) and a like-for-like average weighted by the baseline's size.
function swingLoop(race, units, lookup, measure, fields) {
  let wSum = 0;
  let wSwing = 0;
  let thenAll = 0;
  let validAll = 0;
  for (const u of units) {
    const b = lookup(u);
    if (!b || !b.valid) continue;
    const m = measure(u, b);
    u[fields.base] = +m.then.toFixed(3);
    if (!u.zone) {
      thenAll += m.then * b.valid;
      validAll += b.valid;
    }
    if (!u.votesValid) continue;
    u[fields.swing] = +(m.now - m.then).toFixed(3);
    if (!u.zone) {
      wSum += b.valid;
      wSwing += u[fields.swing] * b.valid;
    }
  }
  if (!wSum) return null;
  const avg = wSwing / wSum;
  const then = thenAll / validAll;
  return { avg, then, implied: then + avg, coverage: (wSum / validAll) * 100 };
}

// rows: { [uf]: { pt, pl, valid } } for the baseline. Writes u[fields.swing], u[fields.base], u[fields.vs]
// and race[fields.summary] (with .votes: projected final votes against the baseline's votes).
function presidentComparison(race, rows, fields, labels) {
  const has = (n) => race.total.cands.some((c) => c.n === n);
  if (!rows || !has('13') || !has('22')) return;
  const name = (n) => titleCase(race.total.cands.find((c) => c.n === n)?.name || '');
  const lookup = (u) => rows[u.code];
  const measure = (u, b) => ({ then: ((b.pl - b.pt) / b.valid) * 100, now: share(u, '22') - share(u, '13') });
  const s = swingLoop(race, race.units, lookup, measure, fields);
  if (!s) return;
  race[fields.summary] = {
    kind: 'margin',
    pos: `toward ${name('22')}`,
    neg: `toward ${name('13')}`,
    ...labels,
    ...s,
  };
  // Projected final votes per state against the baseline, for PT, PL and all valid votes.
  // net = PT's change minus PL's change, i.e. how far the PT-minus-PL vote gap moved.
  if (!race.projection) return;
  const sum = { pt22: 0, pt: 0, pl22: 0, pl: 0, valid22: 0, valid: 0 };
  for (const u of race.units) {
    const b = lookup(u);
    if (!b) continue;
    const proj = race.projection.perUnit[u.code] || { left: 0, gains: {} };
    const final = (n) => Math.round((u.cands.find((c) => c.n === n)?.votes || 0) + (proj.gains[n] || 0));
    const v = { pt22: b.pt, pt: final('13'), pl22: b.pl, pl: final('22'), valid22: b.valid, valid: Math.round(u.votesValid + proj.left) };
    u[fields.vs] = { ...v, ptDelta: v.pt - v.pt22, plDelta: v.pl - v.pl22, validDelta: v.valid - v.valid22, net: v.pt - v.pt22 - (v.pl - v.pl22) };
    for (const k of Object.keys(sum)) sum[k] += v[k];
  }
  race[fields.summary].votes = {
    ...sum,
    ptDelta: sum.pt - sum.pt22,
    plDelta: sum.pl - sum.pl22,
    validDelta: sum.valid - sum.valid22,
    net: sum.pt - sum.pt22 - (sum.pl - sum.pl22),
    ptName: name('13'),
    plName: name('22'),
  };
}

function addSwing(race, round, base) {
  if (!base) return;
  if (race.key === 'president') {
    const rnd = round === 2 ? 'second' : 'first';
    presidentComparison(race, base.president[String(round)] || base.president['1'],
      { swing: 'swing', base: 'base', vs: 'vs22', summary: 'swing' },
      {
        what: `Change in the PL-minus-PT lead compared with the final 2022 ${rnd}-round result in the same state`,
        thenLabel: 'Jair Bolsonaro minus Lula, 2022',
        ptThen: 'Lula 2022',
        plThen: 'J. Bolsonaro 2022',
        baseline: `the 2022 ${rnd} round`,
      });
    // Keep the original field name the page reads for the 2022 vote comparison.
    if (race.swing?.votes) race.swing.vs22 = race.swing.votes;
    return;
  }
  const has = (n) => race.total.cands.some((c) => c.n === n);
  if (!has('22')) return;
  const name = (n) => titleCase(race.total.cands.find((c) => c.n === n)?.name || '');
  const lookup = (u) => (u.zone ? base.governor.zone[u.zone] : base.governor.mun[u.code]);
  const measure = (u, b) => ({ then: ((b.cands['22'] || 0) / b.valid) * 100, now: share(u, '22') });
  const s = swingLoop(race, [...race.units, ...(race.zones || [])], lookup, measure, { swing: 'swing', base: 'base' });
  if (!s) return;
  race.swing = {
    kind: 'share',
    pos: 'PL share up on 2022',
    neg: 'PL share down on 2022',
    what: `Change in the PL candidate's share: ${name('22')} now against Cláudio Castro's final 2022 share in the same area`,
    thenLabel: 'Cláudio Castro (PL), 2022',
    nowLabel: `${name('22')} (PL), 2026`,
    ...s,
  };
}

// Runoff only: compare with the 2026 first round, counting only PL and PT votes (a hypothetical two-way race).
function addFirstRoundSwing(race, round, baseR1) {
  if (race.key !== 'president' || round !== 2 || !baseR1) return;
  presidentComparison(race, baseR1.byUf, { swing: 'swingR1', base: 'baseR1', vs: 'vsR1', summary: 'swingR1' }, {
    what: 'Change in the PL-minus-PT lead compared with the 2026 first round in the same state, counting only PL and PT votes',
    thenLabel: 'Flávio Bolsonaro minus Lula, first round (two-way)',
    ptThen: 'Lula, 1st round',
    plThen: 'F. Bolsonaro, 1st round',
    baseline: 'the first round (PL and PT votes only)',
  });
}

module.exports = { addSwing, addFirstRoundSwing };

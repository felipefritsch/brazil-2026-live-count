// Compare each area's 2026 result so far with its final 2022 result.
// President: change in the PL-minus-PT margin (same round of 2022).
// RJ governor: change in the PL candidate's share (2022 was decided in the first round).
const share = (u, n) => u.cands.find((c) => c.n === n)?.pct ?? 0;

function addSwing(race, round, base) {
  if (!base) return;
  const has = (n) => race.total.cands.some((c) => c.n === n);
  const titleCase = (t) => t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const name = (n) => titleCase(race.total.cands.find((c) => c.n === n)?.name || '');
  let info;
  let measure; // (unit, base row) -> { then, now }
  let lookup;

  if (race.key === 'president') {
    if (!has('13') || !has('22')) return;
    const b22 = base.president[String(round)] || base.president['1'];
    lookup = (u) => b22[u.code];
    measure = (u, b) => ({ then: ((b.pl - b.pt) / b.valid) * 100, now: share(u, '22') - share(u, '13') });
    info = {
      kind: 'margin',
      pos: `toward ${name('22')}`,
      neg: `toward ${name('13')}`,
      what: `Change in the PL-minus-PT lead compared with the final 2022 ${round === 2 ? 'second' : 'first'}-round result in the same state`,
      thenLabel: 'Jair Bolsonaro minus Lula, 2022',
      nowLabel: `${name('22')} minus ${name('13')}, 2026`,
    };
  } else {
    if (!has('22')) return;
    lookup = (u) => (u.zone ? base.governor.zone[u.zone] : base.governor.mun[u.code]);
    measure = (u, b) => ({ then: ((b.cands['22'] || 0) / b.valid) * 100, now: share(u, '22') });
    info = {
      kind: 'share',
      pos: 'PL share up on 2022',
      neg: 'PL share down on 2022',
      what: `Change in the PL candidate's share: ${name('22')} now against Cláudio Castro's final 2022 share in the same area`,
      thenLabel: 'Cláudio Castro (PL), 2022',
      nowLabel: `${name('22')} (PL), 2026`,
    };
  }

  let wSum = 0;
  let wSwing = 0;
  let thenAll = 0;
  let validAll = 0;
  for (const u of [...race.units, ...(race.zones || [])]) {
    const b = lookup(u);
    if (!b || !b.valid) continue;
    const m = measure(u, b);
    u.base = +m.then.toFixed(3);
    if (!u.zone) {
      thenAll += m.then * b.valid;
      validAll += b.valid;
    }
    if (!u.votesValid) continue;
    u.swing = +(m.now - m.then).toFixed(3);
    if (!u.zone) {
      wSum += b.valid;
      wSwing += u.swing * b.valid;
    }
  }
  if (!wSum) return;
  const avg = wSwing / wSum;
  const then = thenAll / validAll;
  // Like-for-like: weight each area's swing by its 2022 size, then apply it to the 2022 final figure.
  race.swing = { ...info, avg, then, implied: then + avg, coverage: (wSum / validAll) * 100 };

  // President only: PT's projected final votes in each state against its 2022 votes there.
  if (race.key === 'president' && race.projection) {
    const sum = { votes22: 0, projected: 0 };
    for (const u of race.units) {
      const b = lookup(u);
      if (!b) continue;
      const now = u.cands.find((c) => c.n === '13')?.votes || 0;
      u.ptVotes22 = b.pt;
      u.ptProjected = Math.round(now + (race.projection.perUnit[u.code]?.gains['13'] || 0));
      u.ptDelta = u.ptProjected - b.pt;
      sum.votes22 += b.pt;
      sum.projected += u.ptProjected;
    }
    race.swing.pt = { ...sum, delta: sum.projected - sum.votes22, name: name('13') };
  }
}

module.exports = { addSwing };

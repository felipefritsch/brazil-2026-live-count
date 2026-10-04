// Remaining-vote projection: assume each unit's uncounted voters behave like
// that unit's counted voters (same valid-vote rate, same candidate split).

function project(race, units, shift = null) {
  const top = race.total;
  const fallbackRate = top.electorateCounted ? top.votesValid / top.electorateCounted : 0;
  const fallbackShare = Object.fromEntries(top.cands.map((c) => [c.n, c.pct / 100]));

  const added = Object.fromEntries(top.cands.map((c) => [c.n, 0]));
  const perUnit = {};
  let remainingValid = 0;

  for (const u of units) {
    // Nothing counted here yet: borrow the pattern of the enclosing area if given, else the whole race.
    const src = u.votesValid ? u : u.fallback?.votesValid ? u.fallback : null;
    const rate = src ? src.votesValid / src.electorateCounted : fallbackRate;
    const left = u.electorateLeft * rate;
    const share = src ? Object.fromEntries(src.cands.map((c) => [c.n, c.votes / src.votesValid])) : { ...fallbackShare };
    if (shift) {
      // Move `pts` of the remaining vote from one candidate to another.
      const move = Math.min(shift.pts, share[shift.from] || 0);
      share[shift.from] = (share[shift.from] || 0) - move;
      share[shift.to] = (share[shift.to] || 0) + move;
    }
    const gains = {};
    for (const n of Object.keys(added)) {
      gains[n] = left * (share[n] || 0);
      added[n] += gains[n];
    }
    remainingValid += left;
    perUnit[u.code] = { left, gains };
    // Sub-units (Rio's zones) also roll up into their parent area for the table.
    if (u.parent) {
      const p = (perUnit[u.parent] ||= { left: 0, gains: {} });
      p.left += left;
      for (const n of Object.keys(gains)) p.gains[n] = (p.gains[n] || 0) + gains[n];
    }
  }

  const finalTotal = top.votesValid + remainingValid;
  const cands = top.cands.map((c) => {
    const votes = c.votes + added[c.n];
    return { n: c.n, votes, pct: finalTotal ? (votes / finalTotal) * 100 : 0, added: added[c.n] };
  });
  return { remainingValid, finalTotal, cands, perUnit };
}

// `units` defaults to the race's areas; pass a finer split to sharpen the estimate.
function buildProjection(race, units = race.units) {
  const base = project(race, units);
  const [a, b] = race.total.cands;
  let band = null;
  let twoWay = null;
  if (a && b) {
    const favA = project(race, units, { from: b.n, to: a.n, pts: 0.03 });
    const favB = project(race, units, { from: a.n, to: b.n, pts: 0.03 });
    band = {};
    for (const c of [a, b]) {
      const x = favA.cands.find((k) => k.n === c.n).pct;
      const y = favB.cands.find((k) => k.n === c.n).pct;
      band[c.n] = [Math.min(x, y), Math.max(x, y)];
    }
    // Of the remaining votes going to the top two, what share does the
    // runner-up need to draw level, and what share is it on course for?
    const addA = base.cands.find((k) => k.n === a.n).added;
    const addB = base.cands.find((k) => k.n === b.n).added;
    const pool = addA + addB;
    const lead = a.votes - b.votes;
    twoWay = {
      leader: a.n,
      trailer: b.n,
      lead,
      pool,
      trailerNeedsPct: pool > 0 ? ((pool + lead) / 2 / pool) * 100 : null,
      trailerExpectedPct: pool > 0 ? (addB / pool) * 100 : null,
    };
  }
  const leader = [...base.cands].sort((x, y) => y.pct - x.pct)[0];
  return {
    remainingValid: base.remainingValid,
    cands: base.cands,
    band,
    perUnit: base.perUnit,
    runoff: leader ? leader.pct <= 50 : null,
    twoWay,
  };
}

module.exports = { buildProjection };

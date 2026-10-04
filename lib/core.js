// Environment-neutral core: polling, projection, swing and history.
// Runs inside the Node server and, unchanged, in the browser for the static site.
const { fetchRace, fetchMunicipalityNames, fetchUrnaAbertaHistory, ROUNDS, RIO_CITY } = require('./tse');
const { buildProjection } = require('./projection');
const { addSwing } = require('./swing');

const POLL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000; // a manual refresh cannot hit TSE more often than this

const UF_NAMES = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul',
  mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná',
  rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
  sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', zz: 'Abroad',
};
const UF_IBGE = {
  ro: '11', ac: '12', am: '13', rr: '14', pa: '15', ap: '16', to: '17', ma: '21', pi: '22', ce: '23', rn: '24',
  pb: '25', pe: '26', al: '27', se: '28', ba: '29', mg: '31', es: '32', rj: '33', sp: '35', pr: '41', sc: '42',
  rs: '43', ms: '50', mt: '51', go: '52', df: '53',
};
const KEYS = ['president', 'governor'];

// opts: { base, snapshots: [...], saveSnapshot(snap), forceRound, log }
function createCore(opts = {}) {
  const snapshots = (opts.snapshots || []).map((s) => ({ round: 1, ...s }));
  const log = opts.log || (() => {});
  let state = { rounds: { 1: { races: {} }, 2: { races: {} } }, fetchedAt: null, stale: false, errors: [] };
  let munNames = null;
  let inflight = null;
  let lastAttempt = 0;
  let nextPollAt = Date.now() + POLL_MS;
  const remoteHistory = {};
  const historySource = {};

  // The second round goes live on its election day unless a round is forced.
  function activeRound() {
    if (opts.forceRound) return Number(opts.forceRound);
    return Date.now() >= Date.parse(`${ROUNDS[2].date}T08:00:00-03:00`) ? 2 : 1;
  }

  function recordSnapshot(key, round, race) {
    const prev = [...snapshots].reverse().find((s) => s.race === key && s.round === round);
    if (prev && prev.pct === race.total.sectionsPct) return;
    const snap = {
      race: key,
      round,
      pct: race.total.sectionsPct,
      h: race.total.counted.slice(11, 16),
      shares: Object.fromEntries(race.total.cands.map((c) => [c.n, +c.pct.toFixed(3)])),
    };
    snapshots.push(snap);
    opts.saveSnapshot?.(snap, snapshots);
  }

  // Urna Aberta keys its history by TSE candidate sequence id; convert to ballot number.
  async function loadRemoteHistory(key, round, race) {
    const bySq = Object.fromEntries(race.total.cands.map((c) => [c.sq, c.n]));
    const pts = await fetchUrnaAbertaHistory(race.ele);
    remoteHistory[`${key}${round}`] = pts.map((p) => ({
      pct: p.p,
      h: p.h,
      shares: Object.fromEntries(Object.entries(p.v).filter(([sq]) => bySq[sq]).map(([sq, v]) => [bySq[sq], v])),
    }));
    historySource[`${key}${round}`] = 'urnaaberta';
  }

  function historyFor(key, round) {
    const seen = new Map();
    const own = snapshots.filter((s) => s.race === key && s.round === round);
    for (const p of [...(remoteHistory[`${key}${round}`] || []), ...own]) seen.set(p.pct, p);
    return [...seen.values()].sort((a, b) => a.pct - b.pct);
  }

  function decorate(key, round, race) {
    for (const u of race.units) {
      if (key === 'president') {
        u.name = UF_NAMES[u.code] || u.code.toUpperCase();
        u.geo = UF_IBGE[u.code] || null;
        u.label = u.code === 'zz' ? 'Abroad' : u.code.toUpperCase();
      } else {
        const m = munNames?.[u.code];
        u.name = m ? m.name : u.code;
        u.geo = m ? m.ibge : null;
        u.label = u.name;
      }
    }
    for (const z of race.zones) {
      z.code = `z${z.zone}`;
      z.parent = RIO_CITY;
      z.label = `Zone ${Number(z.zone)}`;
      z.name = `Rio de Janeiro · zone ${Number(z.zone)}`;
    }
    // Project Rio city zone by zone when every zone loaded; otherwise as one block.
    const rio = race.units.find((u) => u.code === RIO_CITY);
    const zonesComplete = rio && race.zones.length && race.zones.length === (munNames?.[RIO_CITY]?.zones.length || -1);
    const projUnits = zonesComplete
      ? [...race.units.filter((u) => u !== rio), ...race.zones.map((z) => ({ ...z, fallback: rio }))]
      : race.units;
    race.projection = buildProjection(race, projUnits);
    race.projection.usesZones = Boolean(zonesComplete);
    addSwing(race, round, opts.base);
  }

  async function pollRound(round, errors) {
    const races = { ...state.rounds[round].races };
    let anyFail = false;
    for (const key of KEYS) {
      try {
        const zones = key === 'governor' ? munNames?.[RIO_CITY]?.zones || [] : [];
        const race = await fetchRace(key, round, zones);
        if (!race) {
          races[key] = null; // not published by TSE (round not started, or no runoff for this race)
          continue;
        }
        decorate(key, round, race);
        if (race.errors.length) anyFail = true;
        errors.push(...race.errors.map((e) => `${key}: ${e}`));
        races[key] = race;
        recordSnapshot(key, round, race);
      } catch (e) {
        anyFail = true;
        errors.push(`${key} (round ${round}): ${e.message}`);
      }
    }
    // Only the presidential race has a server-side history at Urna Aberta.
    if (races.president) {
      try {
        await loadRemoteHistory('president', round, races.president);
      } catch (e) {
        if (!String(e.message).includes('400')) errors.push(`history: ${e.message}`);
      }
    }
    return { races, anyFail };
  }

  function poll() {
    if (inflight) return inflight;
    lastAttempt = Date.now();
    nextPollAt = Date.now() + POLL_MS;
    inflight = (async () => {
      const errors = [];
      if (!munNames) {
        try {
          munNames = await fetchMunicipalityNames();
        } catch (e) {
          errors.push(`municipality names: ${e.message}`);
        }
      }
      const active = activeRound();
      const rounds = { ...state.rounds };
      let anyFail = false;
      // Always poll the active round; load the other one until we have it (round 1 stays for reference).
      for (const round of [1, 2]) {
        const have = Object.keys(rounds[round].races).length > 0;
        if (round !== active && (have || round > active)) continue;
        const r = await pollRound(round, errors);
        rounds[round] = { races: r.races };
        anyFail ||= r.anyFail;
      }
      if (active === 1 && !Object.keys(rounds[2].races).length) rounds[2] = { races: { president: null, governor: null } };
      state = { rounds, fetchedAt: anyFail ? state.fetchedAt : new Date().toISOString(), stale: anyFail, errors };
      log(new Date().toISOString(), `poll round ${active}`, anyFail ? 'FAILED' : 'ok', errors.length ? errors : '');
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  // Manual refresh: returns true when skipped because TSE was checked moments ago.
  async function refresh() {
    const throttled = Date.now() - lastAttempt < MIN_GAP_MS && !inflight;
    if (!throttled) await poll();
    return throttled;
  }

  function payload() {
    const rounds = {};
    for (const round of [1, 2]) {
      rounds[round] = {
        races: state.rounds[round].races,
        date: ROUNDS[round].date,
        history: Object.fromEntries(KEYS.map((k) => [k, historyFor(k, round)])),
        historySource: Object.fromEntries(KEYS.map((k) => [k, historySource[`${k}${round}`] || 'local'])),
      };
    }
    return {
      rounds,
      activeRound: activeRound(),
      fetchedAt: state.fetchedAt,
      stale: state.stale,
      errors: state.errors,
      nextPollAt: new Date(nextPollAt).toISOString(),
    };
  }

  return { poll, refresh, payload, POLL_MS };
}

module.exports = { createCore, POLL_MS };

// Fetch and normalise files from the TSE results feed.
const BASE = 'https://resultados.tse.jus.br/oficial/ele2026';

const num = (s) => {
  if (s === undefined || s === null || s === '') return 0;
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

async function getJson(path, timeoutMs = 20000) {
  const res = await fetch(`${BASE}/${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: typeof window === 'undefined' ? { 'user-agent': 'election-dashboard/1.0 (personal use)' } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

// Run tasks with a concurrency cap; failures are returned, not thrown.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx]) };
      } catch (err) {
        out[idx] = { ok: false, error: String(err.message || err), item: items[idx] };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Flatten a "-u.json" results file into plain numbers.
function parseResult(d) {
  const cands = [];
  for (const agr of d.carg?.[0]?.agr || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        cands.push({
          n: c.n,
          sq: c.sqcand,
          name: c.nmu,
          party: par.sg,
          votes: num(c.vap),
          status: c.dvt,
          result: c.st || '',
          elected: c.e === 's',
        });
      }
    }
  }
  cands.sort((a, b) => b.votes - a.votes);
  const total = cands.reduce((s, c) => s + c.votes, 0);
  for (const c of cands) c.pct = total ? (c.votes / total) * 100 : 0;
  return {
    code: d.cdabr,
    generated: `${d.dg} ${d.hg}`,
    counted: `${d.dt} ${d.ht}`,
    final: d.tf === 's',
    decided: d.md === 's',
    sectionsPct: num(d.s?.pstn),
    sectionsTotal: num(d.s?.ts),
    sectionsCounted: num(d.s?.st),
    electorate: num(d.e?.te),
    electorateCounted: num(d.e?.est),
    electorateLeft: num(d.e?.esnt),
    turnoutPct: num(d.e?.pcn),
    votesTotal: num(d.v?.tv),
    votesValid: total,
    votesBlank: num(d.v?.vb),
    votesNull: num(d.v?.tvn),
    cands,
  };
}

// Election codes per round (from TSE's ele-c.json): federal = president, state = governor.
const ROUNDS = {
  1: { fed: '6257', est: '6259', date: '2026-10-04' },
  2: { fed: '6258', est: '6260', date: '2026-10-25' },
};
const RIO_CITY = '60011';

function raceConfig(key, round) {
  const r = ROUNDS[round];
  if (key === 'president') {
    const e = r.fed;
    return {
      title: 'President',
      ele: e,
      topPath: `${e}/dados/br/br-c0001-e00${e}-u.json`,
      abFile: `${e}/dados/br/br-e00${e}-ab.json`,
      unitType: 'uf',
      unitPath: (cd) => `${e}/dados/${cd}/${cd}-c0001-e00${e}-u.json`,
    };
  }
  const e = r.est;
  return {
    title: 'Rio de Janeiro Governor',
    ele: e,
    topPath: `${e}/dados/rj/rj-c0003-e00${e}-u.json`,
    abFile: `${e}/dados/rj/rj-e00${e}-ab.json`,
    unitType: 'mun',
    unitPath: (cd) => `${e}/dados/rj/rj${cd}-c0003-e00${e}-u.json`,
    zonePath: (zone) => `${e}/dados/rj/rj${RIO_CITY}-z${zone}-c0003-e00${e}-u.json`,
  };
}

// Returns null when TSE has not published this race for this round (404 on the top file).
async function fetchRace(key, round, rioZones = []) {
  const r = raceConfig(key, round);
  let top;
  try {
    top = await getJson(r.topPath);
  } catch (e) {
    if (String(e.message).startsWith('404')) return null;
    throw e;
  }
  const ab = await getJson(r.abFile);
  const unitCodes = ab.abr.filter((a) => a.tpabr === r.unitType).map((a) => a.cdabr);
  const results = await pool(unitCodes, 8, async (cd) => parseResult(await getJson(r.unitPath(cd))));
  const units = [];
  const errors = [];
  for (const res of results) {
    if (res.ok) units.push(res.value);
    else errors.push(res.error);
  }
  // Rio city split by electoral zone (governor only).
  const zones = [];
  if (r.zonePath && rioZones.length) {
    const zr = await pool(rioZones, 8, async (z) => ({ ...parseResult(await getJson(r.zonePath(z))), zone: z }));
    for (const res of zr) {
      if (res.ok) zones.push(res.value);
      else errors.push(res.error);
    }
  }
  return { key, round, ele: r.ele, title: r.title, total: parseResult(top), units, zones, errors };
}

async function fetchMunicipalityNames() {
  const d = await getJson('6259/config/mun-e006259-cm.json', 40000);
  const rj = d.abr.find((a) => a.cd.toLowerCase() === 'rj');
  const map = {};
  for (const m of rj.mu) map[m.cd] = { name: m.nm, ibge: m.cdi, zones: m.z || [] };
  return map;
}

// Full 2026 count history for president, as collected server-side by urnaaberta.com.br
// (third-party, unofficial; this is the public key their own page ships to browsers).
const UA_URL = 'https://yagyudxwcarczzwpazip.supabase.co/functions/v1/apuracao-historico';
const UA_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhZ3l1ZHh3Y2FyY3p6d3BhemlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTIxNjYsImV4cCI6MjA5MjY4ODE2Nn0.5GBfNkkrVXCZKMraeQ9CHCsuGSXcc0B6ymmcIIbGDv0';

async function fetchUrnaAbertaHistory(ele) {
  const res = await fetch(`${UA_URL}?ele=${ele}`, {
    signal: AbortSignal.timeout(10000),
    headers: { apikey: UA_KEY, Authorization: `Bearer ${UA_KEY}` },
  });
  if (!res.ok) throw new Error(`urnaaberta history ${res.status}`);
  return (await res.json()).pontos || [];
}

module.exports = {
  fetchUrnaAbertaHistory, fetchRace, fetchMunicipalityNames, parseResult, num, ROUNDS, RIO_CITY };

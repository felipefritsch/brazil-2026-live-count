// Collect first- and second-round presidential results for every municipality (and the abroad total).
// Polite to TSE: 6 requests at a time, retries with backoff on 429/5xx, and a resumable cache.
// Output: analysis/muni.json. Usage: node analysis/collect.js
const fs = require('fs');
const path = require('path');
const { getJson, pool, parseResult } = require('../lib/tse');

const R1 = '6257';
const R2 = '6258';
const CACHE = path.join(__dirname, 'cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  for (let i = 0; ; i++) {
    try {
      return await getJson(p);
    } catch (e) {
      const code = Number(String(e.message).slice(0, 3));
      if (i >= 6 || !(code === 429 || code >= 500 || Number.isNaN(code))) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
}

const pick = (r) => {
  const v = (n) => r.cands.find((c) => c.n === n)?.votes || 0;
  return {
    el: r.electorate, turnout: r.votesTotal, valid: r.votesValid, blank: r.votesBlank, null: r.votesNull,
    pt: v('13'), pl: v('22'), cury: v('70'), renan: v('14'), caiado: v('55'), pct: r.sectionsPct,
  };
};

(async () => {
  const cm = await get(`${R1}/config/mun-e00${R1}-cm.json`);
  const items = cm.abr.flatMap((a) => a.mu.map((m) => ({ uf: a.cd.toLowerCase(), cd: m.cd, ibge: m.cdi, name: m.nm })));
  const todo = items.filter((m) => !cache[`${m.uf}${m.cd}`]);
  console.log('to fetch', todo.length, 'cached', items.length - todo.length);
  let done = 0;
  const res = await pool(todo, 4, async (m) => {
    const a = await get(`${R1}/dados/${m.uf}/${m.uf}${m.cd}-c0001-e00${R1}-u.json`);
    const b = await get(`${R2}/dados/${m.uf}/${m.uf}${m.cd}-c0001-e00${R2}-u.json`);
    cache[`${m.uf}${m.cd}`] = { ...m, r1: pick(parseResult(a)), r2: pick(parseResult(b)) };
    if (++done % 250 === 0) {
      console.log(done, '/', todo.length);
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
  });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const bad = res.filter((r) => !r.ok);
  const zz = [];
  for (const e of [R1, R2]) zz.push(await get(`${e}/dados/zz/zz-c0001-e00${e}-u.json`));
  const abroad = { uf: 'zz', cd: 'zz', name: 'Abroad', r1: pick(parseResult(zz[0])), r2: pick(parseResult(zz[1])) };
  const munis = items.map((m) => cache[`${m.uf}${m.cd}`]).filter(Boolean);
  fs.writeFileSync(path.join(__dirname, 'muni.json'), JSON.stringify({ at: new Date().toISOString(), munis, abroad, failed: bad.map((b) => b.error) }));
  console.log('municipalities', munis.length, 'of', items.length, 'failed', bad.length, bad.slice(0, 3).map((b) => b.error));
})();

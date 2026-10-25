// One-off: municipal baselines and map shapes for the states shown municipality by municipality.
// Writes data/states_mun.json ({ uf: { mun: { name, ibge, r1: { pt, pl, valid } } } }) and public/geo/<uf>-mun.json.
// 2022 rows are added afterwards by scripts/prep_states_2022.py. Usage: node scripts/prep_states.js
const fs = require('fs');
const path = require('path');
const { getJson, pool, parseResult } = require('../lib/tse');

const STATES = { sp: '35', mg: '31' };
const root = path.join(__dirname, '..');

(async () => {
  const cm = await getJson('6257/config/mun-e006257-cm.json', 60000);
  const out = {};
  for (const [uf, ibge] of Object.entries(STATES)) {
    const muns = cm.abr.find((a) => a.cd.toLowerCase() === uf).mu;
    const rows = await pool(muns, 16, async (m) => {
      const r = parseResult(await getJson(`6257/dados/${uf}/${uf}${m.cd}-c0001-e006257-u.json`));
      const v = (n) => r.cands.find((c) => c.n === n)?.votes || 0;
      return { cd: m.cd, name: m.nm, ibge: m.cdi, r1: { pt: v('13'), pl: v('22'), valid: v('13') + v('22') } };
    });
    const bad = rows.filter((x) => !x.ok);
    if (bad.length) throw new Error(`${uf}: ${bad.length} first-round files failed, e.g. ${bad[0].error}`);
    out[uf] = Object.fromEntries(rows.map(({ value: x }) => [x.cd, { name: x.name, ibge: x.ibge, r1: x.r1 }]));
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${ibge}?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade=minima`);
    if (!res.ok) throw new Error(`IBGE ${uf} ${res.status}`);
    fs.writeFileSync(path.join(root, 'public', 'geo', `${uf}-mun.json`), await res.text());
    const tot = Object.values(out[uf]).reduce((s, x) => ({ pt: s.pt + x.r1.pt, pl: s.pl + x.r1.pl }), { pt: 0, pl: 0 });
    console.log(uf, Object.keys(out[uf]).length, 'municipalities; first round PT', tot.pt, 'PL', tot.pl);
  }
  fs.writeFileSync(path.join(root, 'data', 'states_mun.json'), JSON.stringify(out));
})();

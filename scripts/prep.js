// One-off data prep: 2022 count-history curve and map shapes.
// Usage: node scripts/prep.js <2022-round-1-history.csv> <2022-round-2-history.csv>
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.mkdirSync(path.join(root, 'public', 'geo'), { recursive: true });

function curve2022(csvPath) {
  const lines = fs.readFileSync(csvPath, 'latin1').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(';').map((s) => s.trim());
  const col = (name) => head.indexOf(name);
  const iPct = col('PE_SECOES_TOT_ACUMULADO');
  const iLula = col('LULA_PE_VOTOS_TOT_ACUMULADO');
  const iBolso = col('JAIR_BOLSONARO_PE_VOTOS_TOT_ACUMULADO');
  const f = (s) => parseFloat(s.trim().replace(',', '.')) * 100;
  const out = [];
  let lastBin = -1;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    const pct = f(c[iPct]);
    const bin = Math.floor(pct * 4); // one point every 0.25% of sections
    if (bin === lastBin && i !== lines.length - 1) continue;
    lastBin = bin;
    out.push({ pct: +pct.toFixed(3), lula: +f(c[iLula]).toFixed(3), bolsonaro: +f(c[iBolso]).toFixed(3) });
  }
  console.log('2022 curve points:', out.length, 'last:', out[out.length - 1]);
  return out;
}

async function prepGeo() {
  const q = 'formato=application/vnd.geo%2Bjson&qualidade=minima';
  const files = {
    'br-uf.json': `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&${q}`,
    'rj-mun.json': `https://servicodados.ibge.gov.br/api/v3/malhas/estados/33?intrarregiao=municipio&${q}`,
  };
  for (const [name, url] of Object.entries(files)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const text = await res.text();
    JSON.parse(text);
    fs.writeFileSync(path.join(root, 'public', 'geo', name), text);
    console.log(name, text.length, 'bytes');
  }
}

(async () => {
  if (process.argv[2]) {
    const curves = { 1: curve2022(process.argv[2]), 2: process.argv[3] ? curve2022(process.argv[3]) : [] };
    fs.writeFileSync(path.join(root, 'data', 'pres2022_curve.json'), JSON.stringify(curves));
  }
  await prepGeo();
})();

"""One-off: build data/base2022.json (2022 final results) from TSE open data.

Reads only the two CSVs it needs out of the 640 MB archive via HTTP range requests.
Usage: python3 scripts/prep_base2022.py
"""
import csv, io, json, os, collections
from rangezip import open_zip

URL = 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2022.zip'
ROOT = os.path.join(os.path.dirname(__file__), '..')

def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='latin1'), delimiter=';')

z = open_zip(URL)
out = {'president': {'1': {}, '2': {}}, 'governor': {'mun': {}, 'zone': {}}}

# President by state, both rounds: Lula (13), Bolsonaro (22), all valid nominal votes.
for r in rows(z, 'votacao_candidato_munzona_2022_BR.csv'):
    if r['DS_CARGO'].strip().lower() != 'presidente':
        continue
    d = out['president'][r['NR_TURNO']].setdefault(r['SG_UF'].lower(), {'pt': 0, 'pl': 0, 'valid': 0})
    v = int(r['QT_VOTOS_NOMINAIS'])
    d['valid'] += v
    if r['NR_CANDIDATO'] == '13': d['pt'] += v
    if r['NR_CANDIDATO'] == '22': d['pl'] += v

# RJ governor, first round (there was no runoff): by municipality, and by zone inside Rio city.
names = {}
def add(bucket, key, r):
    d = bucket.setdefault(key, {'valid': 0, 'cands': collections.Counter()})
    v = int(r['QT_VOTOS_NOMINAIS'])
    d['valid'] += v
    d['cands'][r['NR_CANDIDATO']] += v
for r in rows(z, 'votacao_candidato_munzona_2022_RJ.csv'):
    if r['DS_CARGO'].strip().lower() != 'governador' or r['NR_TURNO'] != '1':
        continue
    names[r['NR_CANDIDATO']] = {'name': r['NM_URNA_CANDIDATO'], 'party': r['SG_PARTIDO']}
    add(out['governor']['mun'], r['CD_MUNICIPIO'].zfill(5), r)
    if r['CD_MUNICIPIO'].zfill(5) == '60011':
        add(out['governor']['zone'], r['NR_ZONA'].zfill(4), r)
out['governor']['names'] = names

json.dump(out, open(os.path.join(ROOT, 'data', 'base2022.json'), 'w'))
p = out['president']
for t in '12':
    tot = {k: sum(s[k] for s in p[t].values()) for k in ('pt', 'pl', 'valid')}
    print('president round', t, 'states', len(p[t]), 'Lula %.2f Bolsonaro %.2f' % (100 * tot['pt'] / tot['valid'], 100 * tot['pl'] / tot['valid']))
g = out['governor']
tot = collections.Counter(); valid = 0
for m in g['mun'].values(): tot.update(m['cands']); valid += m['valid']
print('governor RJ muns', len(g['mun']), 'Rio zones', len(g['zone']), [(names[n]['name'], names[n]['party'], round(100 * v / valid, 2)) for n, v in tot.most_common(3)])

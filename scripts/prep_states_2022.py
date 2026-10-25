"""Add 2022 presidential results by municipality (both rounds) to data/states_mun.json.

Reads only the BR file out of the 640 MB TSE archive via HTTP range requests.
Usage: python3 scripts/prep_states_2022.py  (after scripts/prep_states.js)
"""
import csv, io, json, os
from rangezip import open_zip

URL = 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2022.zip'
PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'states_mun.json')

data = json.load(open(PATH))
rows = {}
z = open_zip(URL)
with z.open('votacao_candidato_munzona_2022_BR.csv') as f:
    for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1'), delimiter=';'):
        uf = r['SG_UF'].lower()
        if uf not in data or r['DS_CARGO'].strip().lower() != 'presidente':
            continue
        d = rows.setdefault((uf, r['CD_MUNICIPIO'].zfill(5), r['NR_TURNO']), {'pt': 0, 'pl': 0, 'valid': 0})
        v = int(r['QT_VOTOS_NOMINAIS'])
        d['valid'] += v
        if r['NR_CANDIDATO'] == '13': d['pt'] += v
        if r['NR_CANDIDATO'] == '22': d['pl'] += v

missing = 0
for uf, muns in data.items():
    for cd, m in muns.items():
        for t in ('1', '2'):
            row = rows.get((uf, cd, t))
            if row: m[f'y22r{t}'] = row
            else: missing += 1
    tot = {t: sum(m.get(f'y22r{t}', {}).get('pt', 0) for m in muns.values()) for t in '12'}
    print(uf, 'Lula 2022 votes by round', tot)
print('municipality-round rows missing:', missing)
json.dump(data, open(PATH, 'w'))

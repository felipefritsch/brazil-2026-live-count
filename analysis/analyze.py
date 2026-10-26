"""Runoff comeback analysis: national, regional, state and municipal shifts from the 2026 first round
to the runoff, plus an ecological estimate of where each first-round group's voters went.

Input: analysis/muni.json (analysis/collect.js), data/base2022.json.
Output: analysis/out/*.json (row arrays, one file per dashboard dataset).
Run with the vault's Python (numpy): python analysis/analyze.py
"""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
raw = json.load(open(os.path.join(HERE, 'muni.json')))
base22 = json.load(open(os.path.join(HERE, '..', 'data', 'base2022.json')))['president']['2']

REGION = {**{u: 'North' for u in 'ac am ap pa ro rr to'.split()},
          **{u: 'Northeast' for u in 'al ba ce ma pb pe pi rn se'.split()},
          **{u: 'Centre-West' for u in 'df go ms mt'.split()},
          **{u: 'Southeast' for u in 'es mg rj sp'.split()},
          **{u: 'South' for u in 'pr rs sc'.split()}, 'zz': 'Abroad'}
UF_NAME = {'ac': 'Acre', 'al': 'Alagoas', 'am': 'Amazonas', 'ap': 'Amapá', 'ba': 'Bahia', 'ce': 'Ceará',
           'df': 'Distrito Federal', 'es': 'Espírito Santo', 'go': 'Goiás', 'ma': 'Maranhão', 'mg': 'Minas Gerais',
           'ms': 'Mato Grosso do Sul', 'mt': 'Mato Grosso', 'pa': 'Pará', 'pb': 'Paraíba', 'pe': 'Pernambuco',
           'pi': 'Piauí', 'pr': 'Paraná', 'rj': 'Rio de Janeiro', 'rn': 'Rio Grande do Norte', 'ro': 'Rondônia',
           'rr': 'Roraima', 'rs': 'Rio Grande do Sul', 'sc': 'Santa Catarina', 'se': 'Sergipe', 'sp': 'São Paulo',
           'to': 'Tocantins', 'zz': 'Abroad'}
UF_IBGE = {'ro': '11', 'ac': '12', 'am': '13', 'rr': '14', 'pa': '15', 'ap': '16', 'to': '17', 'ma': '21', 'pi': '22',
           'ce': '23', 'rn': '24', 'pb': '25', 'pe': '26', 'al': '27', 'se': '28', 'ba': '29', 'mg': '31', 'es': '32',
           'rj': '33', 'sp': '35', 'pr': '41', 'sc': '42', 'rs': '43', 'ms': '50', 'mt': '51', 'go': '52', 'df': '53'}

# The municipality list already includes polling places abroad (uf 'zz'); the separate abroad total is only a check.
units = raw['munis']


def pools(u):
    a, b = u['r1'], u['r2']
    oth = a['valid'] - a['pt'] - a['pl']
    src = dict(pt=a['pt'], pl=a['pl'], cury=a['cury'], renan=a['renan'], caiado=a['caiado'],
               rest=oth - a['cury'] - a['renan'] - a['caiado'], bn=a['blank'] + a['null'], abst=a['el'] - a['turnout'])
    dst = dict(pt=b['pt'], pl=b['pl'], bn=b['blank'] + b['null'], abst=b['el'] - b['turnout'])
    return src, dst


SRC = ['pt', 'pl', 'cury', 'renan', 'caiado', 'rest', 'bn', 'abst']
DST = ['pt', 'pl', 'bn', 'abst']
S = np.array([[pools(u)[0][k] for k in SRC] for u in units], float)
D = np.array([[pools(u)[1][k] for k in DST] for u in units], float)
EL1 = S.sum(1)
EL2 = D.sum(1)


def project_rows(F):
    """Project each row onto the probability simplex (Duchi et al. 2008)."""
    out = np.empty_like(F)
    for i, v in enumerate(F):
        u = np.sort(v)[::-1]
        css = np.cumsum(u)
        rho = np.nonzero(u * np.arange(1, len(v) + 1) > (css - 1))[0][-1]
        out[i] = np.maximum(v - (css[rho] - 1) / (rho + 1), 0)
    return out


def fit_transfers(S, D, iters=6000):
    """Goodman-style ecological regression: second-round shares of the electorate as row-stochastic mixtures of
    first-round shares, weighted by electorate. Projected gradient with Nesterov momentum."""
    w = S.sum(1)
    X = S / w[:, None]
    Y = D / D.sum(1)[:, None]
    W = w / w.sum()
    A = (X * W[:, None]).T @ X
    B = (X * W[:, None]).T @ Y
    L = np.linalg.eigvalsh(A).max()
    F = np.full((X.shape[1], Y.shape[1]), 1 / Y.shape[1])
    Z = F.copy()
    t = 1.0
    for _ in range(iters):
        G = A @ Z - B
        Fn = project_rows(Z - G / L)
        tn = (1 + np.sqrt(1 + 4 * t * t)) / 2
        Z = Fn + (t - 1) / tn * (Fn - F)
        F, t = Fn, tn
    resid = Y - X @ F
    r2 = 1 - (W[:, None] * resid ** 2).sum() / (W[:, None] * (Y - (W[:, None] * Y).sum(0)) ** 2).sum()
    return F, r2


# Five first-round groups. Separate candidates (Cury, Renan, Caiado) were not stable across fits, so they are pooled.
S5 = np.c_[S[:, :2], S[:, 2:6].sum(1), S[:, 6:]]
G5 = ['pt', 'pl', 'others', 'bn', 'abst']
ufs = np.array([u['uf'] for u in units])


def flows_for(groups):
    """Fit within each group of municipalities and add up the implied flows (voters, first-round group x runoff choice).
    A group with fewer than 8 municipalities (the Federal District is one) borrows the fit of its region."""
    flows = np.zeros((5, 4))
    r2s = []
    for m in groups:
        fit_mask = m
        if m.sum() < 8:
            reg = REGION[ufs[m][0]]
            fit_mask = np.array([REGION[u] == reg for u in ufs])
        F, r2 = fit_transfers(S5[fit_mask], D[fit_mask], iters=3000)
        flows += S5[m].sum(0)[:, None] * F
        r2s.append((r2, m.sum()))
    return flows, r2s


specs = {
    'state': [ufs == u for u in sorted(set(ufs))],
    'region': [np.array([REGION[u] == r for u in ufs]) for r in sorted(set(REGION.values()))],
    'national': [np.ones(len(units), bool)],
}
FLOWS = {}
for k, groups in specs.items():
    FLOWS[k], r2s = flows_for(groups)
    print(k, 'weighted R^2', round(sum(r * n for r, n in r2s) / sum(n for _, n in r2s), 3))
main = FLOWS['state']
tot5 = S5.sum(0)

LABEL = {'pt': 'Lula voters, 1st round', 'pl': 'Flávio Bolsonaro voters, 1st round',
         'others': 'Other candidates’ voters', 'bn': 'Blank or null, 1st round', 'abst': 'Did not vote, 1st round'}
transfers = []
for i, k in enumerate(G5):
    shares = {s: FLOWS[s][i] / tot5[i] for s in FLOWS}
    row = {'group': LABEL[k], 'key': k, 'voters': int(tot5[i])}
    for c, d in enumerate(DST):
        vals = [shares[s][c] for s in FLOWS]
        row[f'to_{d}'] = round(float(shares['state'][c]), 4)
        row[f'to_{d}_lo'] = round(float(min(vals)), 4)
        row[f'to_{d}_hi'] = round(float(max(vals)), 4)
    two = [shares[s][0] / (shares[s][0] + shares[s][1]) for s in FLOWS if shares[s][0] + shares[s][1] > 0]
    row['lula_of_two'] = round(float(shares['state'][0] / (shares['state'][0] + shares['state'][1])), 4)
    row['lula_of_two_lo'] = round(float(min(two)), 4)
    row['lula_of_two_hi'] = round(float(max(two)), 4)
    row['net_lula'] = int(round(main[i, 0] - main[i, 1]))
    nets = [FLOWS[s][i, 0] - FLOWS[s][i, 1] for s in FLOWS]
    row['net_lula_lo'] = int(round(min(nets)))
    row['net_lula_hi'] = int(round(max(nets)))
    transfers.append(row)

# Bridge: from the first-round Lula-minus-Flávio gap to the runoff gap, by first-round group (state-by-state fit).
gap1 = float(S5[:, 0].sum() - S5[:, 1].sum())
gap2 = float(D[:, 0].sum() - D[:, 1].sum())
net = main[:, 0] - main[:, 1]
steps = [
    ('First-round gap', gap1, 'start'),
    ('Lula voters', net[0] - tot5[0], 'step'),
    ('Flávio Bolsonaro voters', net[1] + tot5[1], 'step'),
    ('Other candidates’ voters', net[2], 'step'),
    ('First-round blank or null', net[3], 'step'),
    ('First-round non-voters', net[4], 'step'),
    ('Not explained by the model', gap2 - net.sum(), 'step'),
    ('Runoff gap', gap2, 'end'),
]
bridge = [{'order': i, 'step': s_, 'votes': int(round(v)), 'kind': kind} for i, (s_, v, kind) in enumerate(steps)]
print('bridge check', round(gap1 + sum(b['votes'] for b in bridge if b['kind'] == 'step')), 'vs', gap2)
r2 = None


def summarise(name, mask, extra=None):
    s, d = S[mask].sum(0), D[mask].sum(0)
    p = dict(zip(SRC, s)); q = dict(zip(DST, d))
    el1, el2 = s.sum(), d.sum()
    oth = p['cury'] + p['renan'] + p['caiado'] + p['rest']
    valid1 = p['pt'] + p['pl'] + oth
    r = {
        'name': name,
        'electorate': int(el2),
        'pt1': int(p['pt']), 'pl1': int(p['pl']), 'others1': int(oth), 'valid1': int(valid1),
        'pt2': int(q['pt']), 'pl2': int(q['pl']), 'valid2': int(q['pt'] + q['pl']),
        'lula_2way_1': round(100 * p['pt'] / (p['pt'] + p['pl']), 3),
        'lula_2': round(100 * q['pt'] / (q['pt'] + q['pl']), 3),
        'turnout1': round(100 * (el1 - p['abst']) / el1, 3), 'turnout2': round(100 * (el2 - q['abst']) / el2, 3),
        'others_share1': round(100 * oth / valid1, 3),
        'bn1': int(p['bn']), 'bn2': int(q['bn']),
    }
    r['shift'] = round(r['lula_2'] - r['lula_2way_1'], 3)
    r['lula_gain'] = r['pt2'] - r['pt1']
    r['flavio_gain'] = r['pl2'] - r['pl1']
    r['net_lula'] = r['lula_gain'] - r['flavio_gain']
    r['turnout_change'] = round(r['turnout2'] - r['turnout1'], 3)
    r['gap1'] = r['pt1'] - r['pl1']
    r['gap2'] = r['pt2'] - r['pl2']
    if extra: r.update(extra)
    return r


regions = []
for reg in ['North', 'Northeast', 'Centre-West', 'Southeast', 'South', 'Abroad']:
    mask = np.array([REGION[u] == reg for u in ufs])
    # Others' choice within the region, from the state-by-state fits of its states.
    f = sum(flows_for([ufs == u])[0] for u in sorted(set(ufs[mask])))
    extra = {'others_to_lula': round(float(f[2, 0] / (f[2, 0] + f[2, 1])), 4),
             'municipalities': int(mask.sum()) if reg != 'Abroad' else 0}
    regions.append(summarise(reg, mask, extra))
national = [summarise('Brazil', np.ones(len(units), bool))]

states = []
for uf in sorted(set(ufs)):
    mask = ufs == uf
    r = summarise(UF_NAME[uf], mask, {'uf': uf, 'ibge': UF_IBGE.get(uf), 'region': REGION[uf]})
    b = base22.get(uf)
    if b:
        r['lula_2022'] = round(100 * b['pt'] / (b['pt'] + b['pl']), 3)
        r['vs_2022'] = round(r['lula_2'] - r['lula_2022'], 3)
    states.append(r)

munis = []
for u, s, d in zip(units, S, D):
    if u['uf'] == 'zz':
        continue
    p = dict(zip(SRC, s)); q = dict(zip(DST, d))
    if p['pt'] + p['pl'] == 0 or q['pt'] + q['pl'] == 0:
        continue
    oth = p['cury'] + p['renan'] + p['caiado'] + p['rest']
    valid1 = p['pt'] + p['pl'] + oth
    l1 = 100 * p['pt'] / (p['pt'] + p['pl'])
    l2 = 100 * q['pt'] / (q['pt'] + q['pl'])
    munis.append({'ibge': u['ibge'], 'name': u['name'], 'uf': u['uf'].upper(), 'region': REGION[u['uf']],
                  'electorate': int(s.sum()), 'others_share1': round(100 * oth / valid1, 2),
                  'lula_2way_1': round(l1, 2), 'lula_2': round(l2, 2), 'shift': round(l2 - l1, 2),
                  'turnout_change': round(100 * ((d.sum() - q['abst']) / d.sum() - (s.sum() - p['abst']) / s.sum()), 2)})

# 2022 runoff, national, for the headline comparison.
national_munis = {'munis_n': len(munis), 'munis_toward_lula': sum(1 for m in munis if m['shift'] > 0),
                  'munis_flipped': sum(1 for m in munis if m['lula_2way_1'] < 50 <= m['lula_2'])}
t22 = {k: sum(v[k] for v in base22.values()) for k in ('pt', 'pl')}
national[0]['lula_2022'] = round(100 * t22['pt'] / (t22['pt'] + t22['pl']), 3)
# Share of runoff sections counted, electorate-weighted across municipalities and abroad.
national[0]['counted2'] = round(sum(u['r2']['el'] * u['r2']['pct'] for u in units) / sum(u['r2']['el'] for u in units), 2)
national[0]['municipalities'] = len(raw['munis'])
national[0].update(national_munis)
national[0]['turnaround'] = national[0]['gap2'] - national[0]['gap1']
# Other first-round candidates' voters (Cury, Renan, Caiado, the rest) who picked a runoff candidate: share picking Lula.
oth = next(t for t in transfers if t['key'] == 'others')
national[0]['others_to_lula'] = oth['lula_of_two']
national[0]['others_to_lula_lo'] = oth['lula_of_two_lo']
national[0]['others_to_lula_hi'] = oth['lula_of_two_hi']
national[0]['others_voters'] = oth['voters']
national[0]['others_net_lula'] = oth['net_lula']
bn = next(t for t in transfers if t['key'] == 'bn')
ab = next(t for t in transfers if t['key'] == 'abst')
national[0]['bn_net_lula'] = bn['net_lula']
national[0]['abst_net_lula'] = ab['net_lula']
national[0]['new_net_lula'] = bn['net_lula'] + ab['net_lula']
national[0]['new_net_lula_lo'] = bn['net_lula_lo'] + ab['net_lula_lo']
national[0]['new_net_lula_hi'] = bn['net_lula_hi'] + ab['net_lula_hi']
# Exact accounting (no model): runoff votes for the two came from 1st-round others plus net new valid votes.
national[0]['pool'] = national[0]['lula_gain'] + national[0]['flavio_gain']
national[0]['lula_share_pool'] = round(national[0]['lula_gain'] / national[0]['pool'], 4)
national[0]['bn_drop'] = national[0]['bn1'] - national[0]['bn2']
national[0]['extra_voters'] = int(round(national[0]['electorate'] * (national[0]['turnout2'] - national[0]['turnout1']) / 100))
national[0]['collected_at'] = raw['at']

for name, rows in [('national', national), ('regions', regions), ('states', states), ('municipalities', munis),
                   ('transfers', transfers), ('bridge', bridge)]:
    json.dump(rows, open(os.path.join(OUT, f'{name}.json'), 'w'), ensure_ascii=False)
    print(name, len(rows), 'rows')
print(json.dumps(national[0], indent=1))
for r in regions: print(r['name'], r['lula_2way_1'], '->', r['lula_2'], 'shift', r['shift'], 'net', r['net_lula'], 'turnout', r['turnout_change'], 'others->lula', r['others_to_lula'])
for b in bridge: print(f"{b['step']:40s} {b['votes']:>12,}")

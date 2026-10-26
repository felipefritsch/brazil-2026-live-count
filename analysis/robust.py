"""Stability check for the transfer estimates: fit within each state (and each region) and add up contributions."""
import json, os, sys
import numpy as np
sys.argv = ['x']
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'analyze.py')).read()
# Reuse definitions (pools, fit) without writing outputs.
ns = {'__file__': os.path.join(here, 'analyze.py')}
exec(src.split("F, r2 = fit_transfers(S, D)")[0], ns)
S, D, units, fit, REGION = ns['S'], ns['D'], ns['units'], ns['fit_transfers'], ns['REGION']
S5 = np.c_[S[:, :2], S[:, 2:6].sum(1), S[:, 6:]]
names = ['pt', 'pl', 'others', 'bn', 'abst']
ufs = np.array([u['uf'] for u in units])

def contrib(groups):
    tot = np.zeros(5); flows = np.zeros((5, 4)); r2s = []
    for g in groups:
        m = g
        if m.sum() < 8:  # too few municipalities: use the pooled national fit for this group
            F = Fnat
        else:
            F, r2 = fit(S5[m], D[m], iters=3000); r2s.append(r2)
        flows += S5[m].sum(0)[:, None] * F
    return flows, r2s

Fnat, r2n = fit(S5, D, iters=4000)
variants = {'national': [np.ones(len(units), bool)],
            'by region': [np.array([REGION[u] == r for u in ufs]) for r in sorted(set(REGION.values()))],
            'by state': [ufs == u for u in sorted(set(ufs))]}
for name, groups in variants.items():
    flows, r2s = contrib(groups)
    net = flows[:, 0] - flows[:, 1]
    tot = S5.sum(0)
    print(f'== {name}')
    for i, k in enumerate(names):
        f = flows[i] / tot[i]
        print(f'  {k:7s} N={tot[i]/1e6:6.2f}M  ->Lula {f[0]:.2f} Flavio {f[1]:.2f} blank/null {f[2]:.2f} abst {f[3]:.2f}  net for Lula {net[i]/1e6:+.2f}M')
    print('  predicted gap', round((net.sum())/1e6, 2), 'M; actual', round((D[:,0].sum()-D[:,1].sum())/1e6, 2))

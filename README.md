# Brazil 2026 live count

Live dashboard for the 2026 Brazilian presidential count and the Rio de Janeiro governor count.

- Results come straight from the TSE feed (`resultados.tse.jus.br`), refreshed every 5 minutes or on demand.
- The site in `docs/` is fully static: each visitor's browser reads TSE directly.
- `node server.js` runs the same logic as a local server that also keeps count history on disk.
- `node scripts/build-static.js` rebuilds `docs/` from `public/`, `lib/` and `data/`.

Projections are simple arithmetic on the uncounted electorate, not a forecast model.
Unofficial; not affiliated with TSE.

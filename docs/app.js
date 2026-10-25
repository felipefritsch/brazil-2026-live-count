/* global d3 */
const $ = (s) => document.querySelector(s);
const tip = $('#tip');
const SLOTS = 7;

let state = null;
let curves2022 = {};
let pres2022 = [];
let round = null;
let subJudice = 'in';
let vsMetric = 'net';
const geo = {};
// Optional page config (set before the scripts load): { races: ['president'], round: 2 }.
const DASH = window.DASH || {};
let raceKey = DASH.races?.[0] || 'president';
let mapMode = 'leader';
let trendZoom = 'full';
let sortCol = 'left';
let sortDir = -1;
let loading = false;

// ---------- formatting ----------
const nf = new Intl.NumberFormat('en-US');
const pct = (v, d = 2) => `${v.toFixed(d)}%`;
const big = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`);
const title = (s) =>
  s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(D[aeo]s?)\b/g, (m) => m.toLowerCase());
const short = (name) => {
  const p = title(name).split(' ');
  return p.length > 2 ? p.slice(-2).join(' ') : p.join(' ');
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- colour follows the candidate, fixed on first sight ----------
function colorMap(race) {
  const key = `colors-${race.key}`;
  let map = {};
  try { map = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* storage unavailable */ }
  let used = Object.keys(map).length;
  for (const c of race.total.cands) {
    if (map[c.n] === undefined && used < SLOTS) map[c.n] = ++used;
  }
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
  return (n) => (map[n] ? `var(--s${map[n]})` : 'var(--other)');
}

// ---------- tooltip ----------
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + 14;
  let y = evt.clientY + 14;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.hidden = true; };

function unitTip(u, race, color) {
  const proj = race.projection.perUnit[u.code];
  const rows = u.cands.slice(0, 4).map((c) =>
    `<div class="row"><span><i style="background:${color(c.n)}"></i>${short(c.name)}</span><b>${pct(c.pct, 1)}</b></div>`).join('');
  return `<b>${title(u.name)}</b><div>${pct(u.sectionsPct, 1)} of sections counted</div>${rows}
    ${u.swing != null && race.swing ? `<div style="margin-top:4px">Swing vs 2022: <b>${Math.abs(u.swing).toFixed(1)} pts</b> ${u.swing >= 0 ? race.swing.pos : race.swing.neg}</div>` : ''}
    <div style="margin-top:4px">${nf.format(u.electorateLeft)} voters in uncounted sections${proj ? ` · about ${big(proj.left)} valid votes to come` : ''}</div>`;
}

// ---------- data ----------
async function load(manual = false) {
  if (loading) return;
  loading = true;
  const btn = $('#refresh');
  btn.disabled = true;
  btn.textContent = manual ? 'Updating…' : 'Update now';
  try {
    let data;
    if (window.Backend) {
      // Static site: this browser talks to TSE itself.
      const throttled = manual ? await Backend.refresh() : (await Backend.poll(), false);
      data = { ...Backend.payload(), throttled };
    } else {
      const res = await fetch(manual ? '/api/refresh' : '/api/state', { method: manual ? 'POST' : 'GET' });
      data = await res.json();
    }
    state = data;
    if (round === null) setRound(DASH.round || data.activeRound);
    state.clientError = null;
    state.throttledAt = data.throttled ? Date.now() : 0;
  } catch (e) {
    if (state) state.clientError = 'Could not load new data';
  } finally {
    loading = false;
    btn.disabled = false;
    btn.textContent = 'Update now';
    if (state) render();
    // Server still on its first poll: try again shortly.
    if (state && !state.fetchedAt && !state.stale && !window.Backend) setTimeout(() => load(), 4000);
  }
}

// ---------- render ----------
function setRound(r) {
  round = Number(r);
  document.querySelectorAll('#round button').forEach((x) => x.setAttribute('aria-pressed', Number(x.dataset.round) === round));
}
// With the switch on "annulled", swap in the server's variant without sub judice candidates.
const currentRace = () => {
  const race = state?.rounds?.[round]?.races?.[raceKey] || null;
  return race && race.alt && subJudice === 'out' ? { ...race, ...race.alt } : race;
};
const signed = (v) => `${v >= 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(v)))}`;
const signedBig = (v) => `${v >= 0 ? '+' : '−'}${big(Math.abs(v))}`;

function render() {
  const race = currentRace();
  pres2022 = curves2022[round] || [];
  $('#fifty-label').textContent = round === 2 ? '50% (wins the runoff)' : '50% (first-round win)';
  // Feed published but nothing counted yet (before polls close).
  const waiting = race && race.total.sectionsPct === 0 && !race.total.final;
  $('#empty').hidden = Boolean(race) && !waiting;
  $('#content').hidden = !race || waiting;
  if (waiting) {
    $('#empty-title').textContent = 'Counting has not started yet';
    $('#empty-text').textContent = `${race.total.cands.map((c) => title(c.name)).join(' vs ')}. Polls close at 17:00 Brasília time and TSE starts publishing the count shortly after. This page checks every 5 minutes, or press Update now.`;
    $('#st-counted').textContent = '0% of sections counted';
    $('#st-times').textContent = '';
    $('#progress-fill').style.width = '0';
    return;
  }
  if (!race) {
    const what = raceKey === 'president' ? 'presidential' : 'Rio de Janeiro governor';
    if (round === 2) {
      const started = state.activeRound === 2;
      $('#empty-title').textContent = started ? `No second-round results for the ${what} race` : 'The second round is on 25 October';
      $('#empty-text').textContent = started
        ? 'TSE has not published a second-round count for this race. Either counting has not begun or the race was settled in the first round.'
        : `If no candidate passes 50% of valid votes, the ${what} runoff is held on 25 October. This view switches on by itself when TSE starts publishing that count.`;
    } else {
      $('#empty-title').textContent = 'No data yet';
      $('#empty-text').textContent = 'TSE could not be reached. The dashboard keeps trying every 5 minutes.';
    }
    $('#st-counted').textContent = '–';
    $('#st-times').textContent = '';
    $('#progress-fill').style.width = '0';
    return;
  }
  const color = colorMap(state.rounds[round].races[raceKey]);
  const sj = race.subJudice || [];
  $('#subjudice').hidden = !sj.length;
  if (sj.length) {
    const who = sj.map((c) => title(c.name)).join(', ');
    $('#subjudice-text').textContent = `${who}: TSE lists these votes as annulled pending a court ruling. Show the race with them`;
  }
  renderStatus(race);
  renderCands(race, color);
  renderTiles(race);
  renderMap(race, color);
  renderLeft(race, color);
  renderZones(race, color);
  renderTrend(race, color);
  renderPtMap(race);
  renderTable(race, color);
}

function renderStatus(race) {
  const t = race.total;
  $('#st-counted').textContent = `${pct(t.sectionsPct)} of sections counted`;
  $('#progress-fill').style.width = `${t.sectionsPct}%`;
  const fetched = state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
  $('#st-times').textContent = `TSE data as of ${t.counted.slice(11, 16)} Brasília · fetched ${fetched}`;
  const badge = $('#st-badge');
  let msg = '';
  if (state.clientError) msg = state.clientError;
  else if (state.stale) msg = 'Last update partly failed — showing the most recent good data';
  else if (state.throttledAt && Date.now() - state.throttledAt < 8000) msg = 'TSE was checked under a minute ago — nothing newer yet';
  else if (t.final) msg = 'Count complete';
  badge.hidden = !msg;
  badge.textContent = msg;
  document.title = `${t.sectionsPct.toFixed(1)}% counted · ${race.title}`;
}

function renderCands(race, color) {
  const t = race.total;
  const [a, b] = t.cands;
  const proj = Object.fromEntries(race.projection.cands.map((c) => [c.n, c]));
  const band = race.projection.band || {};
  $('#headline').textContent = b
    ? `${short(a.name)} leads ${short(b.name)} by ${(a.pct - b.pct).toFixed(2)} points (${nf.format(a.votes - b.votes)} votes)`
    : race.title;
  const shown = t.cands.filter((c, i) => i < 6 || c.pct >= 1);
  const rest = t.cands.filter((c) => !shown.includes(c));
  const max = Math.max(55, ...t.cands.map((c) => c.pct), ...Object.values(band).map((x) => x[1])) + 3;
  const x = (v) => `${(v / max) * 100}%`;
  const row = (c, isOther) => {
    const p = proj[c.n];
    const bd = band[c.n];
    return `<div class="cand">
      <div class="who"><span class="sw" style="background:${isOther ? 'var(--other)' : color(c.n)}"></span><b>${isOther ? c.name : title(c.name)}</b><small>${c.party || ''}</small></div>
      <div class="track">
        <div class="bar" style="width:${x(c.pct)};background:${isOther ? 'var(--other)' : color(c.n)}"></div>
        <div class="fifty" style="left:${x(50)}"></div>
        ${bd ? `<div class="band" style="left:${x(bd[0])};width:${x(bd[1] - bd[0])}"></div>` : ''}
        ${p && !isOther && c.pct >= 1 ? `<div class="proj" style="left:calc(${x(p.pct)} - 1px)" title="Projected final ${pct(p.pct)}"></div>` : ''}
      </div>
      <div class="val"><b>${pct(c.pct)}</b><small>${nf.format(c.votes)}</small></div>
    </div>`;
  };
  let html = shown.map((c) => row(c, false)).join('');
  if (rest.length) {
    html += row({ n: 'x', name: `${rest.length} others`, party: '', pct: d3.sum(rest, (c) => c.pct), votes: d3.sum(rest, (c) => c.votes) }, true);
  }
  $('#cands').innerHTML = html;
}

function at2022(p) {
  if (!pres2022.length) return null;
  const i = d3.bisector((d) => d.pct).left(pres2022, p);
  return pres2022[Math.min(i, pres2022.length - 1)];
}

function renderTiles(race) {
  const t = race.total;
  const pr = race.projection;
  const [a, b] = t.cands;
  const proj = Object.fromEntries(pr.cands.map((c) => [c.n, c]));
  const tiles = [];
  if (a && b) {
    const pa = proj[a.n];
    const pb = proj[b.n];
    const ba = pr.band?.[a.n];
    const bb = pr.band?.[b.n];
    tiles.push({
      k: 'Projected final share',
      v: `${pa.pct.toFixed(1)}% – ${pb.pct.toFixed(1)}%`,
      d: `${short(a.name)} ${ba ? `${ba[0].toFixed(1)}–${ba[1].toFixed(1)}` : ''} · ${short(b.name)} ${bb ? `${bb[0].toFixed(1)}–${bb[1].toFixed(1)}` : ''}`,
    });
    const lead = [...pr.cands].sort((x, y) => y.pct - x.pct)[0];
    const leadName = short(t.cands.find((c) => c.n === lead.n).name);
    const lb = pr.band?.[lead.n] || [lead.pct, lead.pct];
    if (round === 2) {
      // Two candidates: the leader is always at or above 50%, so the question is whether the range clears it.
      const verdict = lb[0] > 50 ? `${leadName} on course to win` : 'Too close to call';
      tiles.push({ k: 'Who wins', v: verdict, d: `${leadName} projected at ${pct(lead.pct, 1)}, ${pct(lb[0], 1)} if the remaining vote shifts 3 points against them` });
    } else {
      let verdict = 'Too close to 50% to call';
      if (lb[0] > 50) verdict = 'First-round win on course';
      else if (lb[1] < 50) verdict = 'Runoff on course';
      tiles.push({ k: 'First round or runoff', v: verdict, d: `${leadName} projected at ${pct(lead.pct, 1)}; 50% of valid votes wins outright` });
    }
    tiles.push({
      k: 'Lead now vs. votes still out',
      v: `${big(a.votes - b.votes)} vs ${big(pr.remainingValid)}`,
      d: `${short(a.name)}'s lead in votes, against the estimated valid votes not yet counted`,
    });
    if (pr.twoWay?.trailerNeedsPct != null) {
      const need = pr.twoWay.trailerNeedsPct;
      tiles.push({
        k: `What ${short(b.name)} needs to catch up`,
        v: need > 100 ? 'Out of reach' : `${need.toFixed(1)}% of the rest`,
        d: `Share of the remaining ${short(a.name)}/${short(b.name)} votes needed to draw level. On current patterns: ${pr.twoWay.trailerExpectedPct.toFixed(1)}%`,
      });
    }
  }
  let note = `Projection method: each area's uncounted voters are assumed to turn out and vote like the voters already counted in that same area (${raceKey === 'president' ? 'state by state' : 'municipality by municipality'}). It is weakest when the uncounted sections inside an area differ from the counted ones, for example capital versus interior.`;
  if (raceKey === 'president') {
    const pt = t.cands.find((c) => c.n === '13');
    const pl = t.cands.find((c) => c.n === '22');
    const then = at2022(t.sectionsPct);
    const fin = pres2022[pres2022.length - 1];
    if (pt && pl && then && fin) {
      const dL = fin.lula - then.lula;
      const dB = fin.bolsonaro - then.bolsonaro;
      tiles.push({
        k: `If the rest moves as it did in 2022`,
        v: `${(pl.pct + dB).toFixed(1)}% – ${(pt.pct + dL).toFixed(1)}%`,
        d: `${short(pl.name)} – ${short(pt.name)}. From ${t.sectionsPct.toFixed(0)}% counted to the end in 2022, PT moved ${dL >= 0 ? '+' : ''}${dL.toFixed(2)} and PL ${dB >= 0 ? '+' : ''}${dB.toFixed(2)} points`,
      });
    }
  }
  if (race.swing) {
    const sw = race.swing;
    const sign = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
    tiles.push(sw.kind === 'margin'
      ? {
        k: 'If every area keeps its swing from 2022',
        v: `${sw.implied >= 0 ? 'PL' : 'PT'} ahead by ${Math.abs(sw.implied).toFixed(1)} pts`,
        d: `Average swing so far is ${sign(sw.avg)} points ${sw.avg >= 0 ? sw.pos : sw.neg}, weighting each state by its 2022 size. The 2022 lead was ${sign(sw.then)} for PL`,
      }
      : {
        k: 'If every area keeps its swing from 2022',
        v: `PL at ${sw.implied.toFixed(1)}%`,
        d: `${short(race.total.cands.find((c) => c.n === '22')?.name || 'PL')} is running ${sign(sw.avg)} points against Cláudio Castro's 2022 share (${sw.then.toFixed(1)}%), weighting each municipality by its 2022 size`,
      });
  }
  if (race.projection.usesZones) note += ' Rio de Janeiro city is projected zone by zone rather than as one block.';
  $('#tiles').innerHTML = tiles.map((x) => `<div class="tile"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`).join('');
  $('#heading-note').textContent = note;
}

function renderMap(race, color) {
  const fc = geo[raceKey];
  $('#map-title').textContent = raceKey === 'president' ? 'Brazil by state' : 'Rio de Janeiro by municipality';
  if (!fc) return;
  const box = $('#map');
  const w = Math.max(280, box.clientWidth);
  const h = raceKey === 'president' ? Math.min(w, 480) : Math.min(w * 0.62, 380);
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitSize([w, h], fc));
  const byGeo = Object.fromEntries(race.units.filter((u) => u.geo).map((u) => [u.geo, u]));
  const seq = d3.interpolateRgb(css('--seq-lo'), css('--seq-hi'));
  const maxLeft = d3.max(race.units, (u) => u.electorateLeft) || 1;
  // Colour scale tops out near the 90th percentile of swings so a few outliers do not wash out the map.
  const swings = race.units.filter((u) => u.swing != null).map((u) => Math.abs(u.swing)).sort(d3.ascending);
  const SWING_MAX = Math.max(10, Math.ceil((d3.quantile(swings, 0.9) || 10) / 5) * 5);
  const div = d3.scaleLinear([-SWING_MAX, 0, SWING_MAX], [css('--div-neg'), css('--div-mid'), css('--div-pos')]).clamp(true);
  const swingBtn = document.querySelector('#map-mode [data-mode="swing"]');
  swingBtn.hidden = !race.swing;
  if (!race.swing && mapMode === 'swing') { mapMode = 'leader'; document.querySelectorAll('#map-mode button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === 'leader')); }

  const fill = (u) => {
    if (!u) return { f: 'var(--neutral)', o: 1 };
    if (mapMode === 'counted') return { f: seq(u.sectionsPct / 100), o: 1 };
    if (mapMode === 'swing') return u.swing == null ? { f: 'var(--neutral)', o: 1 } : { f: div(u.swing), o: 1 };
    if (mapMode === 'left') return u.electorateLeft ? { f: seq(Math.sqrt(u.electorateLeft / maxLeft)), o: 1 } : { f: 'var(--neutral)', o: 1 };
    if (!u.votesValid) return { f: 'var(--neutral)', o: 1 };
    const m = u.cands[0].pct - (u.cands[1]?.pct || 0);
    return { f: color(u.cands[0].n), o: 0.3 + 0.7 * Math.min(m / 30, 1) };
  };

  const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', $('#map-title').textContent);
  svg.selectAll('path').data(fc.features).join('path')
    .attr('class', 'unit')
    .attr('d', path)
    .each(function (d) {
      const u = byGeo[d.properties.codarea];
      const s = fill(u);
      d3.select(this).style('fill', s.f).style('fill-opacity', s.o);
    })
    .on('mousemove', (evt, d) => {
      const u = byGeo[d.properties.codarea];
      if (u) showTip(evt, unitTip(u, race, color));
    })
    .on('mouseleave', hideTip);
  if (raceKey === 'president') {
    svg.selectAll('text').data(fc.features).join('text')
      .attr('transform', (d) => `translate(${path.centroid(d)})`)
      .attr('text-anchor', 'middle').attr('dy', '0.35em').attr('class', 'lbl')
      .style('font-size', '10px').style('pointer-events', 'none')
      .style('paint-order', 'stroke').style('stroke', 'var(--surface)').style('stroke-width', '2.5px')
      .text((d) => (path.area(d) > 900 ? byGeo[d.properties.codarea]?.label || '' : ''));
  }
  box.replaceChildren(svg.node());

  const lg = $('#map-legend');
  if (mapMode === 'leader') {
    const leaders = [...new Set(race.units.filter((u) => u.votesValid).map((u) => u.cands[0].n))];
    lg.innerHTML = leaders.map((n) => {
      const c = race.total.cands.find((k) => k.n === n);
      return `<span><i class="sq" style="background:${color(n)}"></i>${short(c.name)} leads</span>`;
    }).join('') + '<span>Stronger colour = wider lead (full at 30 points)</span>';
  } else if (mapMode === 'swing') {
    const sw = race.swing;
    lg.innerHTML = `<span>${sw.neg} <i class="ramp" style="background:linear-gradient(90deg,${css('--div-neg')},${css('--div-mid')},${css('--div-pos')})"></i> ${sw.pos}</span><span>Full colour at ${SWING_MAX} points. ${sw.what}. Areas still counting can move.</span>`;
  } else {
    const label = mapMode === 'counted' ? ['0% counted', '100%'] : ['few voters left', `${big(maxLeft)} left`];
    lg.innerHTML = `<span>${label[0]} <i class="ramp" style="background:linear-gradient(90deg,${css('--seq-lo')},${css('--seq-hi')})"></i> ${label[1]}</span>`;
  }
  if (raceKey === 'president') {
    const zz = race.units.find((u) => u.code === 'zz');
    if (zz) lg.innerHTML += `<span>Abroad (not on map): ${pct(zz.sectionsPct, 0)} counted</span>`;
  }
}

function renderLeft(race, color) {
  const rows = race.units.filter((u) => u.electorateLeft > 0).sort((x, y) => y.electorateLeft - x.electorateLeft).slice(0, 14);
  leftBars($('#left'), rows, race, color, raceKey === 'president' ? 54 : null);
}

function renderZones(race, color) {
  const card = $('#zones-card');
  const zones = race.zones || [];
  card.hidden = !zones.length;
  if (!zones.length) return;
  const rio = race.units.find((u) => u.code === '60011');
  const open = zones.filter((z) => z.electorateLeft > 0);
  $('#zones-sub').textContent = `${rio ? `The city is ${pct(rio.sectionsPct, 1)} counted. ` : ''}${open.length} of ${zones.length} zones still have uncounted sections; bars show voters not yet counted in each, coloured by who leads there now. Zones are TSE's numbering; the feed carries no neighbourhood names.`;
  leftBars($('#zones'), open.sort((x, y) => y.electorateLeft - x.electorateLeft), race, color, 70, true);
}

function leftBars(box, rows, race, color, labelW, twoCol = false, maxVal = null) {
  if (!rows.length) { box.innerHTML = '<p class="sub">Every section has been counted.</p>'; return; }
  if (twoCol && box.clientWidth > 760 && rows.length > 12) {
    const half = Math.ceil(rows.length / 2);
    const max = rows[0].electorateLeft;
    box.innerHTML = '<div class="cols2"><div></div><div></div></div>';
    const [c1, c2] = box.querySelectorAll('.cols2 > div');
    leftBars(c1, rows.slice(0, half), race, color, labelW, false, max);
    leftBars(c2, rows.slice(half), race, color, labelW, false, max);
    return;
  }
  const w = Math.max(280, box.clientWidth);
  const rh = 26;
  const lw = labelW || Math.min(150, w * 0.34);
  const rw = 170;
  const h = rows.length * rh;
  const x = d3.scaleLinear([0, maxVal || rows[0].electorateLeft], [0, Math.max(20, w - lw - rw)]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', 'Voters in uncounted sections by area');
  const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rh})`);
  g.append('rect').attr('width', w).attr('height', rh).attr('fill', 'transparent')
    .on('mousemove', (evt, d) => showTip(evt, unitTip(d, race, color))).on('mouseleave', hideTip);
  g.append('text').attr('x', lw - 8).attr('y', rh / 2).attr('dy', '0.35em').attr('text-anchor', 'end').attr('class', 'lbl')
    .text((d) => { const s = raceKey === 'president' || d.zone ? d.label : title(d.label); return s.length > 20 ? `${s.slice(0, 19)}…` : s; });
  g.append('path').style('pointer-events', 'none')
    .attr('d', (d) => { const bw = Math.max(2, x(d.electorateLeft)); const r = Math.min(4, bw); return `M${lw},5h${bw - r}a${r},${r} 0 0 1 ${r},${r}v${rh - 10 - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(bw - r)}z`; })
    .style('fill', (d) => (d.votesValid ? color(d.cands[0].n) : 'var(--neutral)'));
  g.append('text').style('pointer-events', 'none').attr('x', (d) => lw + Math.max(2, x(d.electorateLeft)) + 6).attr('y', rh / 2).attr('dy', '0.35em')
    .text((d) => {
      const lead = d.votesValid ? `${short(d.cands[0].name).split(' ').pop()} +${(d.cands[0].pct - (d.cands[1]?.pct || 0)).toFixed(1)}` : 'none counted yet';
      return `${big(d.electorateLeft)} · ${lead}`;
    });
  box.replaceChildren(svg.node());
}

function renderTrend(race, color) {
  const box = $('#trend');
  const dropped = subJudice === 'out' ? (race.subJudice || []).map((c) => c.n) : [];
  const hist = (state.rounds[round].history?.[raceKey] || []).filter((p) => p.pct > 0).map((p) => {
    if (!dropped.length) return p;
    const rest = 100 - d3.sum(dropped, (n) => p.shares[n] || 0);
    return { ...p, shares: Object.fromEntries(Object.entries(p.shares).filter(([n]) => !dropped.includes(n)).map(([n, v]) => [n, (v / rest) * 100])) };
  });
  const top = race.total.cands.slice(0, 3);
  const isPres = raceKey === 'president';
  const src = state.rounds[round].historySource?.[raceKey];
  $('#trend-title').textContent = isPres ? 'How the count has moved, against 2022 at the same point' : 'How the count has moved';
  $('#trend-sub').textContent = isPres
    ? `Share of valid votes as sections were counted. Dashed lines are the 2022 ${round === 2 ? 'second' : 'first'} round (Lula and Jair Bolsonaro) at the same percentage counted.`
    : `Share of valid votes as sections were counted. There is no earlier record for this race, so the line starts when this dashboard first ran (${hist.length ? pct(hist[0].pct, 1) : 'now'} counted) and grows with every update. TSE published no 2022 count history for governor races.`;

  // The governor line only exists from this dashboard's first poll, so zoom to that stretch.
  const x0 = isPres ? (trendZoom === 'late' ? 60 : 0) : Math.max(0, Math.floor((hist[0]?.pct ?? 80) - 1));
  $('#trend-zoom').hidden = !isPres;
  const series = top.map((c) => ({
    id: c.n, name: `${short(c.name)} 2026`, color: color(c.n), dash: false,
    pts: hist.filter((p) => p.shares[c.n] != null && p.pct >= x0).map((p) => [p.pct, p.shares[c.n], p.h]),
  }));
  if (isPres && pres2022.length) {
    const ref = pres2022.filter((p) => p.pct >= Math.max(x0, 1));
    const has = (n) => race.total.cands.some((c) => c.n === n);
    series.push({ id: 'l22', name: 'Lula 2022', color: has('13') ? color('13') : 'var(--other)', dash: true, pts: ref.map((p) => [p.pct, p.lula]) });
    series.push({ id: 'b22', name: 'Jair Bolsonaro 2022', color: has('22') ? color('22') : 'var(--other)', dash: true, pts: ref.map((p) => [p.pct, p.bolsonaro]) });
  }
  $('#trend-legend').innerHTML = series.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="${s.dash ? `border-color:${s.color}` : `background:${s.color}`}"></i>${s.name}</span>`).join('');

  const w = Math.max(300, box.clientWidth);
  const h = Math.min(380, Math.max(260, w * 0.42));
  const m = { t: 12, r: 96, b: 30, l: 40 };
  const main = series.filter((s) => s.dash || top.slice(0, 2).some((c) => c.n === s.id));
  const vals = main.flatMap((s) => s.pts.map((p) => p[1]));
  let [lo, hi] = vals.length ? d3.extent(vals) : [40, 50];
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const x = d3.scaleLinear([x0, 100], [m.l, w - m.r]);
  const y = d3.scaleLinear([lo, hi], [h - m.b, m.t]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', 'Share of valid votes by percentage of sections counted');

  for (const v of y.ticks(6)) {
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(v)).attr('y2', y(v)).style('stroke', 'var(--grid)');
    svg.append('text').attr('x', m.l - 6).attr('y', y(v)).attr('dy', '0.35em').attr('text-anchor', 'end').text(`${v}%`);
  }
  for (const v of x.ticks(w < 520 ? 5 : 10)) {
    svg.append('text').attr('x', x(v)).attr('y', h - 8).attr('text-anchor', 'middle').text(`${v}%`);
  }
  if (lo < 50 && hi > 50) {
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(50)).attr('y2', y(50)).style('stroke', 'var(--ink2)').style('stroke-dasharray', '2 3');
  }
  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
  const inRange = (s) => s.pts.filter((p) => p[1] >= lo && p[1] <= hi);
  for (const s of series) {
    const pts = inRange(s);
    if (!pts.length) continue;
    svg.append('path').attr('d', line(pts)).style('fill', 'none').style('stroke', s.color)
      .style('stroke-width', s.dash ? 1.5 : 2).style('stroke-dasharray', s.dash ? '5 4' : null).style('opacity', s.dash ? 0.75 : 1);
  }
  // end markers + direct labels for the 2026 lines, nudged apart
  const ends = series.filter((s) => !s.dash).map((s) => ({ s, p: inRange(s).at(-1) })).filter((e) => e.p)
    .map((e) => ({ ...e, ly: y(e.p[1]) })).sort((p, q) => p.ly - q.ly);
  for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 15) ends[i].ly = ends[i - 1].ly + 15;
  for (const e of ends) {
    svg.append('circle').attr('cx', x(e.p[0])).attr('cy', y(e.p[1])).attr('r', 4.5).style('fill', e.s.color).style('stroke', 'var(--surface)').style('stroke-width', 2);
    svg.append('text').attr('class', 'lbl').attr('x', x(e.p[0]) + 9).attr('y', e.ly).attr('dy', '0.35em')
      .text(`${e.s.name.replace(' 2026', '').split(' ').pop()} ${e.p[1].toFixed(1)}%`);
  }
  // crosshair
  const cross = svg.append('line').attr('y1', m.t).attr('y2', h - m.b).style('stroke', 'var(--axis)').style('display', 'none');
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
    .on('mousemove', (evt) => {
      const [px] = d3.pointer(evt);
      const p = Math.max(x0, Math.min(100, x.invert(px)));
      cross.attr('x1', x(p)).attr('x2', x(p)).style('display', null);
      const rows = series.map((s) => {
        if (!s.pts.length) return '';
        const near = s.pts.reduce((best, q) => (Math.abs(q[0] - p) < Math.abs(best[0] - p) ? q : best));
        if (Math.abs(near[0] - p) > 3) return '';
        return `<div class="row"><span><i style="background:${s.color}"></i>${s.name}</span><b>${near[1].toFixed(2)}%</b></div>`;
      }).join('');
      showTip(evt, `<b>${p.toFixed(1)}% counted</b>${rows || '<div>No data at this point</div>'}`);
    })
    .on('mouseleave', () => { cross.style('display', 'none'); hideTip(); });
  box.replaceChildren(svg.node());
  if (src === 'urnaaberta' && isPres) $('#trend-sub').textContent += ' 2026 history before this dashboard started comes from urnaaberta.com.br.';
}

// President: projected final votes per state against 2022 — PT, PL, all valid votes, and the net of PT minus PL.
function renderPtMap(race) {
  const t = race.swing?.vs22;
  const fc = geo.president;
  const card = $('#pt-card');
  card.hidden = !(t && fc && raceKey === 'president');
  if (card.hidden) return;
  const pt = short(t.ptName);
  const pl = short(t.plName);
  const rnd = round === 2 ? 'second' : 'first';
  const moved = (v) => `${v < 0 ? 'down' : 'up'} ${big(Math.abs(v))}`;
  $('#pt-title').textContent = `Against 2022, ${pt} is ${moved(t.ptDelta)} votes and PL is ${moved(t.plDelta)}: a ${big(Math.abs(t.net))}-vote move toward ${t.net < 0 ? 'PL' : 'PT'}`;
  const meta = {
    net: { label: `Net for ${pt}`, lo: 'gap moved toward PL', hi: 'gap moved toward PT', text: `${pt}'s change in votes minus the PL candidate's change. A state where ${pt} gained votes still shows a loss here if PL gained more.` },
    ptDelta: { label: `${pt} votes`, lo: 'fewer votes than Lula in 2022', hi: 'more votes', text: `${pt}'s projected votes minus Lula's 2022 votes. Read it next to "All valid votes": more people voting lifts every candidate.` },
    plDelta: { label: `${pl} votes`, lo: 'fewer votes than Jair Bolsonaro in 2022', hi: 'more votes', text: `${pl}'s projected votes minus Jair Bolsonaro's 2022 votes.` },
    validDelta: { label: 'All valid votes', lo: 'fewer valid votes than 2022', hi: 'more valid votes', text: 'Projected valid votes for all candidates minus the 2022 total. This is the turnout backdrop for the other three views.' },
  }[vsMetric];
  $('#pt-sub').textContent = `${meta.text} Projected finals are votes counted so far plus the projection for uncounted sections; 2022 figures are the final ${rnd}-round results. Nationally: ${pt} ${signed(t.ptDelta)}, ${pl} ${signed(t.plDelta)}, all valid votes ${signed(t.validDelta)}.`;
  const box = $('#pt-map');
  const w = Math.max(280, Math.min(720, box.clientWidth));
  const h = Math.min(w, 560);
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitSize([w, h], fc));
  const byGeo = Object.fromEntries(race.units.filter((u) => u.geo && u.vs22).map((u) => [u.geo, u]));
  const val = (u) => u.vs22[vsMetric];
  const mags = Object.values(byGeo).map((u) => Math.abs(val(u))).sort(d3.ascending);
  const top = d3.quantile(mags, 0.9) || 1;
  const div = d3.scaleLinear([-top, 0, top], [css('--div-neg'), css('--div-mid'), css('--div-pos')]).clamp(true);
  const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
  const chg = (now, then) => `${signed(now - then)} (${(100 * (now - then) / then).toFixed(1)}%)`;
  const tipFor = (u) => `<b>${u.name}</b>
    ${row(`${pt} vs Lula 2022`, chg(u.vs22.pt, u.vs22.pt22))}
    ${row(`${pl} vs J. Bolsonaro 2022`, chg(u.vs22.pl, u.vs22.pl22))}
    ${row('All valid votes', chg(u.vs22.valid, u.vs22.valid22))}
    ${row(`Net for ${pt}`, signed(u.vs22.net))}
    <div style="margin-top:4px">PT share ${(100 * u.vs22.pt22 / u.vs22.valid22).toFixed(1)}% → ${(100 * u.vs22.pt / u.vs22.valid).toFixed(1)}% · PL share ${(100 * u.vs22.pl22 / u.vs22.valid22).toFixed(1)}% → ${(100 * u.vs22.pl / u.vs22.valid).toFixed(1)}%</div>
    <div>${pct(u.sectionsPct, 1)} of sections counted</div>`;
  const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', `${meta.label} against 2022 by state`).style('max-width', `${w}px`).style('margin', '0 auto');
  svg.selectAll('path').data(fc.features).join('path').attr('class', 'unit').attr('d', path)
    .style('fill', (d) => (byGeo[d.properties.codarea] ? div(val(byGeo[d.properties.codarea])) : 'var(--neutral)'))
    .on('mousemove', (evt, d) => { const u = byGeo[d.properties.codarea]; if (u) showTip(evt, tipFor(u)); })
    .on('mouseleave', hideTip);
  const lab = svg.selectAll('g').data(fc.features.filter((d) => byGeo[d.properties.codarea] && path.area(d) > 700)).join('g')
    .attr('transform', (d) => `translate(${path.centroid(d)})`).style('pointer-events', 'none');
  const halo = (sel) => sel.attr('text-anchor', 'middle').attr('class', 'lbl').style('paint-order', 'stroke').style('stroke', 'var(--surface)').style('stroke-width', '2.5px');
  halo(lab.append('text')).attr('dy', '-0.2em').style('font-size', '10px').text((d) => byGeo[d.properties.codarea].label);
  halo(lab.append('text')).attr('dy', '0.95em').style('font-size', '10.5px').style('font-weight', 600).text((d) => signedBig(val(byGeo[d.properties.codarea])));
  box.replaceChildren(svg.node());
  const zz = race.units.find((u) => u.code === 'zz');
  $('#pt-legend').innerHTML = `<span>${meta.lo} <i class="ramp" style="background:linear-gradient(90deg,${css('--div-neg')},${css('--div-mid')},${css('--div-pos')})"></i> ${meta.hi}</span><span>Full colour at ${big(top)} votes</span>${zz?.vs22 ? `<span>Abroad (not on map): ${signed(val(zz))}</span>` : ''}<span>Small states are unlabelled; hover, or see the table below.</span>`;
}

function renderTable(race, color) {
  const [a, b] = race.total.cands;
  $('#table-title').textContent = raceKey === 'president' ? 'All states' : 'All municipalities';
  const rows = race.units.map((u) => {
    const sh = Object.fromEntries(u.cands.map((c) => [c.n, c.pct]));
    const g = race.projection.perUnit[u.code]?.gains || {};
    return {
      u, name: title(u.name), counted: u.sectionsPct, leader: u.votesValid ? u.cands[0] : null,
      margin: u.votesValid ? u.cands[0].pct - (u.cands[1]?.pct || 0) : 0,
      a: sh[a.n] || 0, b: sh[b?.n] || 0, swing: u.swing ?? null, ptDelta: u.vs22?.ptDelta ?? null, plDelta: u.vs22?.plDelta ?? null, net22: u.vs22?.net ?? null, left: u.electorateLeft, net: (g[a.n] || 0) - (g[b?.n] || 0),
    };
  });
  const cols = [
    ['name', 'Area', 'l'], ['counted', '% counted'], ['leader', 'Leading', 'l'], ['margin', 'Lead (pts)'],
    ['a', short(a.name)], ['b', b ? short(b.name) : ''], ...(race.swing ? [['swing', 'Swing vs 2022']] : []), ...(race.swing?.vs22 ? [['ptDelta', `${short(race.swing.vs22.ptName)} votes vs 2022`], ['plDelta', `${short(race.swing.vs22.plName).split(' ').pop()} votes vs 2022`], ['net22', `Net for ${short(race.swing.vs22.ptName)}`]] : []), ['left', 'Voters left'], ['net', `Projected net for ${short(a.name).split(' ').pop()}`],
  ];
  const val = (r) => (sortCol === 'leader' ? r.leader?.name || '' : r[sortCol] ?? -Infinity);
  rows.sort((p, q) => (val(p) > val(q) ? 1 : val(p) < val(q) ? -1 : 0) * sortDir);
  const head = `<thead><tr>${cols.map(([k, t, cl]) => `<th data-col="${k}" class="${cl || ''}">${t}${sortCol === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>`;
  const body = rows.map((r) => `<tr>
    <td>${r.name}</td><td>${pct(r.counted, 1)}</td>
    <td class="l">${r.leader ? `<span class="sw" style="background:${color(r.leader.n)}"></span>${short(r.leader.name)}` : '–'}</td>
    <td>${r.leader ? r.margin.toFixed(1) : '–'}</td><td>${pct(r.a, 1)}</td><td>${pct(r.b, 1)}</td>${race.swing ? `<td>${r.swing == null ? '–' : `${r.swing >= 0 ? '+' : '−'}${Math.abs(r.swing).toFixed(1)}`}</td>` : ''}${race.swing?.vs22 ? ['ptDelta', 'plDelta', 'net22'].map((k) => `<td>${r[k] == null ? '–' : signed(r[k])}</td>`).join('') : ''}
    <td>${nf.format(r.left)}</td><td>${r.left ? `${r.net >= 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(r.net)))}` : '–'}</td></tr>`).join('');
  $('#units').innerHTML = `${head}<tbody>${body}</tbody>`;
}

// ---------- events ----------
document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
  raceKey = btn.dataset.race;
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === btn));
  if (state) render();
}));
const seg = (id, attr, set) => document.querySelectorAll(`${id} button`).forEach((btn) => btn.addEventListener('click', () => {
  set(btn.dataset[attr]);
  document.querySelectorAll(`${id} button`).forEach((x) => x.setAttribute('aria-pressed', x === btn));
  if (state) render();
}));
seg('#map-mode', 'mode', (v) => { mapMode = v; });
seg('#round', 'round', (v) => { round = Number(v); });
seg('#subjudice-mode', 'sj', (v) => { subJudice = v; });
seg('#pt-mode', 'metric', (v) => { vsMetric = v; });
seg('#trend-zoom', 'zoom', (v) => { trendZoom = v; });
$('#units').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  if (sortCol === th.dataset.col) sortDir *= -1; else { sortCol = th.dataset.col; sortDir = sortCol === 'name' || sortCol === 'leader' ? 1 : -1; }
  const r = state && currentRace();
  if (r) renderTable(r, colorMap(r));
});
$('#refresh').addEventListener('click', () => load(true));
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => state && render(), 150); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state && render());

// countdown to the server's next poll; reload shortly after it runs
setInterval(() => {
  if (!state?.nextPollAt) return;
  const ms = new Date(state.nextPollAt).getTime() - Date.now();
  if (ms > 0) {
    const s = Math.ceil(ms / 1000);
    $('#st-next').textContent = `Next automatic update in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  } else {
    $('#st-next').textContent = 'Updating…';
    if (ms < (window.Backend ? 0 : -12000)) load();
  }
}, 1000);

// Single-race / fixed-round pages hide the switches they do not need.
if (DASH.races?.length === 1) $('.tabs').hidden = true;
if (DASH.round) { $('#round').hidden = true; setRound(DASH.round); }

(async () => {
  const [g1, g2, c22] = await Promise.all([
    fetch('geo/br-uf.json').then((r) => r.json()).catch(() => null),
    fetch('geo/rj-mun.json').then((r) => r.json()).catch(() => null),
    fetch('data/pres2022_curve.json').then((r) => r.json()).catch(() => ({})),
  ]);
  geo.president = g1;
  geo.governor = g2;
  curves2022 = c22 || {};
  load();
})();

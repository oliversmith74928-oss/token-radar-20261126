// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own inputs and the protocol's farm plan, and
// a top-ten chart. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', watchlistOnly: false, sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. radar-2: base x
  // category x growth x maturity x breadth x confidence.
  var CAT = {
    Dexs: 1.15, Derivatives: 1.15, Perpetual: 1.15, Lending: 1.1, CDP: 1.1,
    'Basis Trading': 1.1, Restaking: 1.1, RWA: 1.2, Yield: 1.05,
    'Yield Aggregator': 1.05, 'Risk Curators': 1.05, 'Onchain Capital Allocator': 1.05,
    'Prediction Market': 1.0, CeDeFi: 0.95, Insurance: 0.9, 'Staking Pool': 0.85,
    Bridge: 0.7, 'Canonical Bridge': 0.7, 'Liquid Staking': 0.7, 'Liquid Restaking': 0.7,
    'Restaked BTC': 0.7, CEX: 0.7
  };
  function maturityOf(age) {
    if (age < 90) return 0.75 + (age / 90) * 0.15;
    if (age <= 730) return 0.9 + ((age - 90) / 640) * 0.2;
    return Math.max(0.95, 1.1 - ((age - 730) / 1095) * 0.15);
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = maturityOf(age);
    var cat = CAT[row.category || ''] || 1.0;
    var breadth = Math.min(model.breadth_cap, 1 + Math.max(0, (row.chains || []).length - 1) * model.breadth_per_chain);
    var conf = (row.age_days !== null && row.age_days !== undefined && row.change_7d !== null && row.change_7d !== undefined) ? 1.0
      : ((row.age_days !== null && row.age_days !== undefined) || (row.change_7d !== null && row.change_7d !== undefined) ? 0.95 : 0.9);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * cat * growthMult * maturity * breadth * conf));
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $6 of gas';
    if (c === 'solana' || c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'monad') return 'under $1 of gas';
    return 'about $2 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open, borrowing a small amount against it once a week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee cycle.';
    if (c.indexOf('yield') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares for the whole qualifying window.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app instead of bridging straight back.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, closing it before the funding window ends.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then leave the position to settle instead of trading in and out.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the same wallet.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it, collecting its distributions in the same wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the whole qualifying window.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis position on " + chain + ' and keep it open through one funding cycle.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open, using the app once a week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a screenshot or a chat.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep each one small.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Join the protocol's own community channel and read its points or rewards page, so you know what activity it counts.", cost: 'nothing', time: '15 minutes' },
      { text: "Before you withdraw, open the points page from the protocol's own site and claim only from the link it publishes, never from a link in a direct message.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it safely.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watchlist')) state.watchlistOnly = params.get('watchlist') === '1';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'pertvl') { av = a.implied_per_tvl; bv = b.implied_per_tvl; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function drawChart() {
    var cv = document.getElementById('chart');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var top = DATA.rows.slice(0, 10);
    var W = cv.width, H = cv.height, padL = 150, padB = 28, padT = 14, padR = 20;
    ctx.clearRect(0, 0, W, H);
    var maxV = Math.max.apply(null, top.map(function (r) { return r.implied_value_usd; }));
    var barH = (H - padT - padB) / top.length - 8;
    ctx.font = '12px sans-serif';
    top.forEach(function (r, i) {
      var y = padT + i * (barH + 8);
      ctx.fillStyle = '#9fb0c9';
      ctx.textAlign = 'right';
      ctx.fillText(r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name, padL - 8, y + barH / 2 + 4);
      var w = Math.max(4, (r.implied_value_usd / maxV) * (W - padL - padR - 90));
      ctx.fillStyle = i === 0 ? '#fbbf24' : '#2dd4bf';
      ctx.fillRect(padL, y, w, barH);
      ctx.fillStyle = '#e8eef7';
      ctx.textAlign = 'left';
      ctx.fillText(fmtUsd(r.implied_value_usd), padL + w + 8, y + barH / 2 + 4);
    });
    var legend = document.getElementById('chart-legend');
    if (legend) {
      legend.textContent = '';
      legend.appendChild(el('span', null, el('i', { style: 'background:#fbbf24' }), 'Rank 1'));
      legend.appendChild(el('span', null, el('i', { style: 'background:#2dd4bf' }), 'Ranks 2–10'));
      legend.appendChild(el('span', { text: 'Bars are implied value; TVL is shown in the board below.' }));
    }
  }

  var dialog = document.getElementById('detail');
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'on an unknown date') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — model radar-2' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: String(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth × maturity × breadth' }), el('b', { class: 'num', text: row.growth_multiplier + ' × ' + row.maturity_multiplier + ' × ' + row.breadth_multiplier })),
        el('div', null, el('span', { text: 'Confidence' }), el('b', { class: 'num', text: String(row.confidence) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Implied per $1 of TVL' }), el('b', { class: 'num', text: '$' + row.implied_per_tvl.toFixed(2) })),
        el('div', null, el('span', { text: 'Recomputed in this page' }), el('b', { class: 'num', text: fmtUsd(recomputed) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and it never claims the protocol will launch a token.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function renderTable() {
    var tbody = document.getElementById('tbody');
    var count = document.getElementById('count');
    var caption = document.querySelector('#board-table caption');
    tbody.textContent = '';
    if (state.tab === 'live') {
      if (caption) caption.textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
      DATA.live.forEach(function (r) {
        tbody.appendChild(el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: '—' }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: '—' }),
          el('td', null, el('span', { class: 'status live', text: 'already trades' }))
        ));
      });
      if (count) count.textContent = DATA.live.length + ' live-token protocols';
      return;
    }
    if (caption) caption.textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.';
    var list = sortedRows(filteredRows());
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    if (list.length === 0) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '8' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; writeHash(); render(); } })
      ))));
      return;
    }
    var max = list[0].implied_value_usd || 1;
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WATCH[r.slug] ? ' · watchlist' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.implied_per_tvl.toFixed(2) }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
  }

  function fillControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var catSel = document.getElementById('category');
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    var chainSel = document.getElementById('chain');
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    document.getElementById('snap-date').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('model-ver').textContent = DATA.model_version + ' model';
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('lede-text').textContent = 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more rankable pre-token protocols below that floor. Implied value is a model, not a promise — and never a claim that a token will launch.';
    var facts = document.getElementById('facts');
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)]
    ].forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] })));
    });
    var m = DATA.model;
    document.getElementById('formula').textContent =
      'implied = round( tvl_usd × ' + m.base_multiple + ' × category_multiple × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × maturity(age) × breadth(chains) × confidence )\n' +
      'maturity: 0.75 at day 0 → 0.90 at day 90 → 1.10 at day 730 → easing to 0.95 · breadth: +3% per extra chain, capped at 1.08 · confidence: 1.00, 0.95 or 0.90 where age or growth is unknown';
    document.querySelectorAll('#board-table th button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        renderTable();
      });
    });
  }

  function bindControls() {
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderTable(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderTable(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); renderTable(); });
    document.getElementById('min-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); writeHash(); renderTable(); });
    document.getElementById('watchlist-only').checked = state.watchlistOnly;
    document.getElementById('watchlist-only').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; writeHash(); renderTable(); });
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    function setTab(t) { state.tab = t; pre.setAttribute('aria-pressed', t === 'pre-token' ? 'true' : 'false'); live.setAttribute('aria-pressed', t === 'live' ? 'true' : 'false'); writeHash(); renderTable(); }
    pre.addEventListener('click', function () { setTab('pre-token'); });
    live.addEventListener('click', function () { setTab('live'); });
    setTab(state.tab);
    var sbBase = document.getElementById('sb-base');
    var sbGrowth = document.getElementById('sb-growth');
    var sbCat = document.getElementById('sb-cat');
    var sbNote = document.getElementById('sb-note');
    function sandbox() {
      var base = Number(sbBase.value);
      var gw = Number(sbGrowth.value);
      var cat = Number(sbCat.value);
      document.getElementById('sb-base-v').textContent = base.toFixed(2);
      document.getElementById('sb-growth-v').textContent = gw.toFixed(2);
      var top = DATA.rows[0];
      var model = Object.assign({}, DATA.model, { base_multiple: base, growth_weight: gw });
      var row = Object.assign({}, top, { category_multiple: cat });
      var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
      var gm = 1 + (growth / 100) * gw;
      var age = row.age_days === null ? model.unknown_age_days : row.age_days;
      var mm = maturityOf(age);
      var bm = Math.min(model.breadth_cap, 1 + Math.max(0, (row.chains || []).length - 1) * model.breadth_per_chain);
      var conf = row.confidence;
      var v = Math.max(1, Math.round(row.tvl_usd * base * cat * gm * mm * bm * conf));
      sbNote.textContent = 'Sandbox: ' + top.name + ' (rank 1) recomputes to ' + fmtUsd(v) + ' with these settings, against ' + fmtUsd(top.implied_value_usd) + ' under radar-2. The board itself always uses radar-2 as published.';
    }
    sbBase.addEventListener('input', sandbox);
    sbGrowth.addEventListener('input', sandbox);
    sbCat.addEventListener('change', sandbox);
    document.getElementById('sb-reset').addEventListener('click', function () {
      sbBase.value = DATA.model.base_multiple;
      sbGrowth.value = DATA.model.growth_weight;
      sbCat.value = '1';
      sandbox();
    });
    sandbox();
  }

  function render() {
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  fillControls();
  bindControls();
  drawChart();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

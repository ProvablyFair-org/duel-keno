// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

if (window._kenokill) window._kenokill();

(function () {
  'use strict';

  var INSTANCE = Date.now();
  window._kenokill = function () { INSTANCE = -1; };

  // ── Keno config ──────────────────────────────────────────────────────────
  var GRID_SIZE = 40;
  var RISK_TO_DIFFICULTY = { classic: 1, low: 2, medium: 3, high: 4 };
  var RISK_NAMES = ['classic', 'low', 'medium', 'high'];

  function randomPositions(count) {
    var positions = [];
    var pool = []; for (var i = 1; i <= GRID_SIZE; i++) pool.push(i);
    for (var j = 0; j < count; j++) {
      var idx = Math.floor(Math.random() * pool.length);
      positions.push(pool.splice(idx, 1)[0]);
    }
    return positions.sort(function (a, b) { return a - b; });
  }

  function randomRisk() { return RISK_NAMES[Math.floor(Math.random() * RISK_NAMES.length)]; }

  var PHASES = [
    { key: 'A', name: 'Picks 2-9 random', total: 3000, amount: '0.01',
      picksFn: function () { return Math.floor(Math.random() * 8) + 2; }, riskFn: randomRisk },
    { key: 'B', name: '1 pick random',    total: 1000, amount: '0.01',
      picksFn: function () { return 1; }, riskFn: randomRisk },
    { key: 'C', name: '10 picks random',  total: 1000, amount: '0.01',
      picksFn: function () { return 10; }, riskFn: randomRisk },
    { key: 'D', name: '10p medium $10',   total: 100,  amount: '10',
      picksFn: function () { return 10; }, riskFn: function () { return 'medium'; } },
  ];

  var BETS_PER_EPOCH = 50;
  var BET_DELAY = 500;
  var MAX_ERRORS = 8;
  var DB_NAME = 'keno_capture_v3';

  // ── IndexedDB ────────────────────────────────────────────────────────────
  var db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('bets')) d.createObjectStore('bets', { autoIncrement: true });
        if (!d.objectStoreNames.contains('seeds')) d.createObjectStore('seeds', { autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(store, value, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      var req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).add(value);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGetAll(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGet(store, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbClear(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbCount(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).count();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ── State ────────────────────────────────────────────────────────────────
  var meta = {};
  var paused = false;
  var betCount = 0;
  var seedCount = 0;

  function freshMeta() {
    return {
      phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
      token: null, tokenAt: 0, errors: 0, running: false,
      lastNextHash: null, createdAt: new Date().toISOString(),
      lastTxId: null,
      phaseBetCounts: { A: 0, B: 0, C: 0, D: 0 },
    };
  }

  function saveMeta() { return dbPut('meta', meta, 'state'); }

  // ── Logging ──────────────────────────────────────────────────────────────
  function log(msg) { console.log('%c[keno] ' + msg, 'color:#ce93d8'); }
  function warn(msg) { console.warn('%c[keno] ' + msg, 'color:#ffb74d'); }
  function good(msg) { console.log('%c[keno] ' + msg, 'color:#81c784'); }

  // ── Visual Panel ─────────────────────────────────────────────────────────
  function buildPanel() {
    var old = document.getElementById('cap-panel');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'cap-panel';
    Object.assign(d.style, {
      position:'fixed', bottom:'16px', right:'16px', zIndex:'99999',
      background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'8px',
      padding:'12px 16px', fontFamily:'monospace', fontSize:'11px',
      color:'#b8cfe0', minWidth:'280px', boxShadow:'0 4px 24px rgba(0,0,0,.7)',
      cursor:'move', userSelect:'none',
    });

    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop;
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px';
      d.style.right = 'auto'; d.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    var title = document.createElement('div');
    title.textContent = 'KENO CAPTURE';
    Object.assign(title.style, { color:'#ce93d8', fontWeight:'700', fontSize:'13px' });
    d.appendChild(title);

    var st = document.createElement('div');
    st.id = 'cap-status';
    Object.assign(st.style, { margin:'6px 0', color:'#4d6880', fontSize:'10px' });
    d.appendChild(st);

    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });

      var lbl = document.createElement('span');
      lbl.textContent = ph.key;
      Object.assign(lbl.style, { width:'14px', color:'#4d6880', fontWeight:'700' });

      var barOuter = document.createElement('div');
      Object.assign(barOuter.style, { flex:'1', height:'8px', background:'#161e28', borderRadius:'4px', overflow:'hidden' });
      var fill = document.createElement('div');
      fill.id = 'cap-bar-' + ph.key;
      Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'4px', transition:'width .3s' });
      barOuter.appendChild(fill);

      var ct = document.createElement('span');
      ct.id = 'cap-ct-' + ph.key;
      ct.textContent = '0/' + ph.total;
      Object.assign(ct.style, { width:'70px', textAlign:'right', fontSize:'9px', color:'#4d6880' });

      row.appendChild(lbl); row.appendChild(barOuter); row.appendChild(ct);
      d.appendChild(row);
    }

    var seedLine = document.createElement('div');
    seedLine.id = 'cap-seeds';
    Object.assign(seedLine.style, { margin:'6px 0 4px', fontSize:'10px', color:'#4d6880' });
    d.appendChild(seedLine);

    var btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display:'flex', gap:'4px', marginTop:'8px' });

    function mkBtn(text, color, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        flex:'1', padding:'5px 0', background:'#161e28', border:'1px solid #1e2d3d',
        color: color, borderRadius:'3px', cursor:'pointer', fontFamily:'monospace',
        fontSize:'10px', fontWeight:'700',
      });
      b.addEventListener('click', fn);
      return b;
    }

    btnRow.appendChild(mkBtn('GO', '#2dff82', function () { pub.go(); }));
    btnRow.appendChild(mkBtn('PAUSE', '#ffcc44', function () { pub.pause(); }));
    btnRow.appendChild(mkBtn('SAVE', '#33ccff', function () { pub.save(); }));
    d.appendChild(btnRow);

    document.body.appendChild(d);
  }

  function updatePanel() {
    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var n = meta.phaseBetCounts ? (meta.phaseBetCounts[ph.key] || 0) : 0;
      var bar = document.getElementById('cap-bar-' + ph.key);
      var ct = document.getElementById('cap-ct-' + ph.key);
      if (bar) {
        bar.style.width = Math.min(100, n / ph.total * 100) + '%';
        bar.style.background = n >= ph.total ? '#33ccff' : '#2dff82';
      }
      if (ct) ct.textContent = n + '/' + ph.total;
    }
    var st = document.getElementById('cap-status');
    if (st) {
      var state = paused ? 'paused' : (meta.running ? 'running' : 'idle');
      var errStr = meta.errors > 0 ? '  err:' + meta.errors : '';
      st.textContent = state + '  |  bets: ' + betCount + '  |  seeds: ' + seedCount + errStr;
      st.style.color = meta.running && !paused ? '#2dff82' : '#4d6880';
    }
    var sl = document.getElementById('cap-seeds');
    if (sl) sl.textContent = 'seeds: ' + seedCount + '  |  epoch: ' + meta.epochBets + '/' + BETS_PER_EPOCH;
  }

  // ── API ──────────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var opts = {
      method: method, credentials: 'include',
      headers: {
        'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
        'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
        'x-env-class': localStorage.getItem('env_class') || 'blue',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.success === false) {
          var errDetail = JSON.stringify(j).slice(0, 400);
          log('API ' + method + ' ' + path + ' ' + res.status + ': ' + errDetail);
          throw new Error((j.error || j.message || errDetail).slice(0, 200));
        }
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    return api('POST', '/api/v2/user/security/token', {
      uuid: localStorage.getItem('security:uuid'), code: '0000', type: 'standard',
    }).then(function (r) { meta.token = r.token || r; meta.tokenAt = Date.now(); return meta.token; });
  }

  function ensureToken() {
    return (Date.now() - meta.tokenAt > 300000) ? refreshToken() : Promise.resolve(meta.token);
  }

  function getActiveSeed() { return api('GET', '/api/v2/client-seed'); }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function rotateSeed(customSeed) {
    var clientSeed = customSeed || generateClientSeed();
    return ensureToken().then(function (token) {
      log('rotate: clientSeed=' + clientSeed.slice(0, 8) + '... token=' + (token ? String(token).slice(0, 16) + '...' : 'NULL'));
      function tryRotate(attempt) {
        return api('POST', '/api/v2/client-seed/rotate', { client_seed: clientSeed, security_token: token }).catch(function (e) {
          if (/complete.*round|rotating/i.test(e.message) && attempt < 4) {
            return new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); }).then(function () { return tryRotate(attempt + 1); });
          }
          throw e;
        });
      }
      return tryRotate(0);
    });
  }

  function getTransaction(txId) { return api('GET', '/api/v2/user/transactions/' + txId); }

  function placeBet(amount, picks, risk) {
    var positions = randomPositions(picks);
    return ensureToken().then(function (token) {
      return api('POST', '/api/v2/keno/bet', {
        amount: String(amount), currency: 105, difficulty: RISK_TO_DIFFICULTY[risk],
        selected_positions: positions, security_token: token,
      }).then(function (r) { r._reqPositions = positions; r._reqPicks = picks; r._reqRisk = risk; return r; });
    });
  }

  // ── Seed rotation ────────────────────────────────────────────────────────
  function doRotation(phase, customSeed) {
    return Promise.resolve().then(function () {
      if (!meta.lastNextHash) {
        return getActiveSeed().then(function (s) {
          meta.lastNextHash = s.next_server_seed_hash;
          log('initial next_hash: ' + meta.lastNextHash.slice(0, 24) + '...');
        });
      }
    }).then(function () {
      return rotateSeed(customSeed);
    }).then(function (rot) {
      var entry = {
        at: new Date().toISOString(), context: 'rotate-phase-' + phase, phase: phase,
        seed: { clientSeed: rot.client_seed, serverSeedHashed: rot.server_seed_hashed,
                nextServerSeedHash: rot.next_server_seed_hash, serverSeed: null },
        nonce: 0,
      };
      var promoted = rot.server_seed_hashed === meta.lastNextHash;
      entry.nextSeedPromotion = {
        previousNextHash: meta.lastNextHash, newActiveHash: rot.server_seed_hashed,
        newNextHash: rot.next_server_seed_hash, match: promoted,
      };
      if (promoted) good('promoted: ' + meta.lastNextHash.slice(0, 16) + ' -> ' + rot.server_seed_hashed.slice(0, 16));
      else warn('MISMATCH!');
      meta.lastNextHash = rot.next_server_seed_hash;
      meta.activeServerSeedHashed = rot.server_seed_hashed;
      meta.activeClientSeed = rot.client_seed;

      if (meta.lastTxId) {
        return getTransaction(meta.lastTxId).then(function (tx) {
          entry.seed.serverSeed = tx.server_seed || null;
          entry.revealedFrom = { transactionId: meta.lastTxId };
          good('revealed: ' + (entry.seed.serverSeed || 'PENDING').slice(0, 16) + '...');
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        }).catch(function () {
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        });
      }
      return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
    });
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  function runLoop() {
    if (INSTANCE === -1 || paused) { log('paused'); meta.running = false; saveMeta(); updatePanel(); return; }
    var phaseIdx = meta.phaseIdx;
    if (phaseIdx >= PHASES.length) {
      good('ALL PHASES COMPLETE - ' + betCount + ' bets, ' + seedCount + ' seeds. Run keno.save()');
      meta.running = false; saveMeta(); updatePanel();
      return;
    }
    var cfg = PHASES[phaseIdx];

    if (!meta.phaseStarted) {
      meta.phaseStarted = true; saveMeta();
      log('Phase ' + cfg.key + ': ' + cfg.name + ' - ' + cfg.total + ' @ $' + cfg.amount);
      var cs = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, cs).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('rotation failed: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors - pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    if (meta.phaseBets >= cfg.total) {
      doRotation(cfg.key, null).then(function () {
        good('Phase ' + cfg.key + ' done');
        meta.phaseIdx++; meta.phaseBets = 0; meta.epochBets = 0; meta.phaseStarted = false; saveMeta();
        updatePanel(); setTimeout(runLoop, BET_DELAY);
      }).catch(function (e) { warn('end rotation failed: ' + e.message); setTimeout(runLoop, 3000); });
      return;
    }

    if (meta.epochBets >= BETS_PER_EPOCH) {
      var ds = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, ds).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('epoch rotation: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors - pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    var picks = cfg.picksFn();
    var risk = cfg.riskFn();
    placeBet(cfg.amount, picks, risk).then(function (bet) {
      // Get actual nonce from server — never trust client-side counter
      return getActiveSeed().then(function (seedState) {
        // nonce in seedState is the NEXT nonce (post-bet), so the bet's nonce is one less
        var actualNonce = (seedState.nonce || 1) - 1;
        var rec = {
          at: new Date().toISOString(), phase: cfg.key,
          request: { amount: cfg.amount, picks: bet._reqPicks, risk: bet._reqRisk,
                     difficulty: RISK_TO_DIFFICULTY[bet._reqRisk], selected_positions: bet._reqPositions },
          response: {
            id: bet.id, status: bet.status, amount_currency: bet.amount_currency,
            amount_won: bet.amount_won, multiplier: bet.multiplier,
            difficulty: bet.difficulty || bet.difficulty_level,
            selected_positions: bet.selected_positions,
            drawn_numbers: bet.drawn_numbers, transaction_id: bet.transaction_id,
            effective_edge: bet.effective_edge,
          },
          seed: {
            serverSeedHashed: meta.activeServerSeedHashed,
            clientSeed: meta.activeClientSeed,
            nonce: actualNonce,
          },
        };
        meta.lastTxId = bet.transaction_id;
        meta.phaseBets++; meta.epochBets = seedState.nonce || (meta.epochBets + 1); meta.errors = 0;
        if (!meta.phaseBetCounts) meta.phaseBetCounts = { A:0, B:0, C:0, D:0 };
        meta.phaseBetCounts[cfg.key]++;
        betCount++;
        return dbPut('bets', rec).then(function () { return saveMeta(); }).then(function () {
          if (betCount % 100 === 0) log('Phase ' + cfg.key + ': ' + meta.phaseBets + '/' + cfg.total + ' | total: ' + betCount);
          updatePanel();
        });
      });
    }).then(function () {
      setTimeout(runLoop, BET_DELAY);
    }).catch(function (e) {
      warn('bet failed: ' + e.message); meta.errors++;
      if (meta.errors >= MAX_ERRORS) { warn('too many errors - pausing'); paused = true; }
      saveMeta(); updatePanel(); setTimeout(runLoop, 2000);
    });
  }

  });

console.log('[keno] reference record loaded — see data/ for the captured dataset');

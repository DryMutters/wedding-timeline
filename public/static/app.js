(function () {
  'use strict';
  var C = TimelineCore;
  // Where this page is running: the builder (/admin/w/<id>), a couple's link (/t/<token>), or a local demo.
  var path = location.pathname.split('/').filter(Boolean);
  var MODE = path[0] === 'admin' && path[1] === 'w' ? 'admin' : path[0] === 't' ? 'viewer' : 'local';
  var REF = MODE === 'admin' ? path[2] : MODE === 'viewer' ? path[1] : null;
  var HAS_BUILDER = MODE !== 'viewer';
  var FEEDBACK = MODE === 'local'; // couple approval and change requests are phase 2
  var served = null, shareUrl = '', ready = false, saveTimer = null;

  /* ---------- Data ---------- */
  // Stand-in for geocoding the ceremony address, which the hosted app will do.
  var PLACES = {
    tampa: { label: 'Tampa', lat: 27.9506, lon: -82.4572, tz: 'America/New_York' },
    stpete: { label: 'St. Petersburg and Clearwater', lat: 27.7676, lon: -82.6403, tz: 'America/New_York' },
    sarasota: { label: 'Sarasota', lat: 27.3364, lon: -82.5307, tz: 'America/New_York' },
    lakeland: { label: 'Lakeland', lat: 28.0395, lon: -81.9498, tz: 'America/New_York' },
    shenandoah: { label: 'Shenandoah Valley, Virginia', lat: 38.3565, lon: -78.9414, tz: 'America/New_York' }
  };
  function defaults() {
    var a = { couple: 'Emily & James', date: '2027-03-20', planner: '', cerVenue: 'Sample Venue, Tampa, Florida', place: 'tampa',
      recSame: true, recVenue: '', brideSame: true, bridePrep: '', groomSame: true, groomPrep: '', driveCer: 15, driveRec: 15,
      robes: 'no', dad: 'no', look: 'firstlook', cerStart: '16:30', cerLen: 30, recEnd: '21:00', exit: '', notes: '' };
    var m = { hours: 8, cocktail: 30, sunsetPortraits: 'yes' };
    if (MODE === 'admin') { a.couple = ''; a.date = ''; a.cerVenue = ''; }
    return { a: a, m: m, items: C.generateItems(a, m), versions: [], approval: null, requests: [], seq: 1, showChanges: true };
  }
  var SCALE = { mode: 'clamped', pxPerMin: 3, min: 40, max: 280 };
  var GOLDEN_MIN = 60, SUNSET_PORTRAIT_LEAD = 30, KEY = 'ma-timeline-draft-v1';

  var state = defaults();
  var view = { blocks: [], sunset: null, cov: null, changes: { byId: {}, lines: [] }, openId: null, dirty: true, shownN: 1, as: 'edit' };

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.a && s.items ? s : null; } catch (e) { return null; }
  }
  function setSaveState(text) { var el = $('save-state'); if (el) el.textContent = text; }
  function save() {
    if (!ready) return;
    if (MODE === 'local') { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage is a convenience only */ } return; }
    if (MODE !== 'admin') return;
    setSaveState('Saving\u2026');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      fetch('/admin/api/weddings/' + REF, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: state.a, m: state.m, items: state.items, seq: state.seq }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); setSaveState('All changes saved'); })
        .catch(function () { setSaveState('Not saved. Check your connection, reload to sign in again, and redo the last change.'); });
    }, 700);
  }
  function lastN() { return state.versions.length ? state.versions[state.versions.length - 1].n : 0; }

  /* ---------- Helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'value') el.value = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  }
  function sunIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('class', 'sun-ico'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
      '<path d="M4.2 11a3.8 3.8 0 0 1 7.6 0"/><path d="M1 11h14M8 3.2v1.6M2.9 5.6l1.1 1.1M13.1 5.6 12 6.7M4.5 13.6h7"/></g>';
    return svg;
  }
  function hm(str) { var p = /^(\d{1,2}):(\d{2})$/.exec(str || ''); return p ? +p[1] * 60 + +p[2] : null; }
  function dateParts() { var p = (state.a.date || '2027-01-01').split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function longDate() {
    if (!state.a.date) return 'Date to come';
    var p = dateParts();
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
  }
  function dn(b) { return b.name || b.second || 'Untitled'; }
  function second(b) { return b.name && b.second ? b.second : ''; }
  function range(b) { return C.fmtTime(b.start) + ' to ' + C.fmtTime(b.end); }
  function changesVisible() { return state.showChanges && view.status !== 'approved'; }
  function snapshot() { return view.blocks.map(function (b) { return { id: b.id, name: b.name, second: b.second, start: b.start, duration: b.duration }; }); }

  /* ---------- Derive ---------- */
  function derive() {
    var a = state.a, recEnd = hm(a.recEnd);
    view.blocks = C.buildTimeline({
      ceremonyStart: hm(a.cerStart) === null ? 16 * 60 + 30 : hm(a.cerStart), ceremonyDuration: C.cleanDuration(a.cerLen || 30),
      ceremonyName: 'Wedding Ceremony',
      items: state.items.map(function (it, i) { return Object.assign({}, it, { order: i, endAt: it.type === 'handoff' ? recEnd : null }); })
    });
    var p = dateParts(), pl = PLACES[a.place] || PLACES.tampa;
    view.sunset = a.date ? C.sunsetLocalMinutes(p.y, p.m, p.d, pl.lat, pl.lon, pl.tz) : null;
    view.cov = C.coverage(view.blocks);
    var last = state.versions.length ? state.versions[state.versions.length - 1] : null, lastN = last ? last.n : 0;
    var diff = last ? C.computeChanges(last.blocks, snapshot()) : { byId: {}, lines: [] };
    view.dirty = !last || diff.lines.length > 0;
    view.shownN = view.dirty ? lastN + 1 : lastN;
    view.changes = view.dirty ? diff : (last.changes || diff);
    var ap = state.approval;
    view.status = ap && ap.n === view.shownN ? 'approved' : ap ? 'updated' : 'draft';
    if (MODE === 'viewer' && served) { view.dirty = false; view.shownN = served.n; view.changes = served.snapshot.changes || { byId: {}, lines: [] }; view.status = 'draft'; }
  }

  /* ---------- Couple's page ---------- */
  function renderHero() {
    $('couple').textContent = state.a.couple || 'Couple’s names';
    $('when').textContent = longDate() + (state.a.cerVenue ? ' · ' + state.a.cerVenue : '');
  }

  function renderStatus() {
    var el = $('status'); el.textContent = ''; el.dataset.state = view.status;
    var titles = { draft: 'Draft for review', approved: 'Approved', updated: 'Updated since your approval' };
    var head = h('div', { class: 'status-head' }, [h('span', { class: 'status-title', text: 'Version ' + view.shownN + ' · ' + titles[view.status] })]);
    el.appendChild(head);
    if (view.status === 'approved') {
      el.appendChild(h('p', { text: 'Approved by ' + state.approval.name + ' on ' + state.approval.at + '. This is the plan we will both work from.' }));
      return;
    }
    var lines = view.changes.lines;
    if (view.shownN === 1 || !lines.length) {
      el.appendChild(h('p', { text: view.status === 'updated' ? 'Mary Anna updated the timeline after you approved. Please review and approve again.' : (FEEDBACK ? 'Please review, then approve or request a change.' : 'Please review, and reply to Mary\u2019s email with anything you would like changed.') }));
      return;
    }
    var toggle = h('button', { class: 'link', type: 'button', text: state.showChanges ? 'Hide changes' : 'Show changes' });
    toggle.addEventListener('click', function () { state.showChanges = !state.showChanges; renderPage(); });
    head.appendChild(toggle);
    el.appendChild(h('p', {
      text: (view.status === 'updated' ? 'Mary Anna updated the timeline after you approved. ' : '') +
        lines.length + (lines.length === 1 ? ' change' : ' changes') + ' since Version ' + (view.shownN - 1) + '.'
    }));
    if (state.showChanges) el.appendChild(h('ul', {}, lines.map(function (t) { return h('li', { text: t }); })));
  }

  function renderFacts() {
    var el = $('facts'); el.textContent = '';
    var fact = function (dt, dd) { return h('div', {}, [h('dt', { text: dt }), h('dd', { text: dd })]); };
    var cer = view.blocks.filter(function (b) { return b.id === 'ceremony'; })[0];
    el.appendChild(fact('Photos begin', C.fmtTime(view.cov.start)));
    el.appendChild(fact('Ceremony', C.fmtTime(cer.start)));
    el.appendChild(fact('Sunset', view.sunset === null ? 'None' : C.fmtTime(view.sunset)));
  }

  function renderLegend() {
    var el = $('legend'); el.textContent = '';
    var note = $('sun-note'); note.hidden = true;
    var s = view.sunset, cov = view.cov;
    if (s === null) { note.textContent = state.a.date ? 'The sun does not set at this venue on this date.' : 'Sunset appears once the wedding date is set.'; note.hidden = false; return; }
    var g = s - GOLDEN_MIN;
    if (s > cov.end || s < cov.start) {
      note.textContent = 'Sunset is at ' + C.fmtTime(s) + (s > cov.end ? ', after the reception ends.' : ', before photos begin.');
      note.hidden = false;
    }
    if (g >= cov.start && g <= cov.end) el.appendChild(h('li', {}, [h('span', { class: 'sw sw-line dash' }), 'Golden hour begins ' + C.fmtTime(g)]));
    if (s >= cov.start && s <= cov.end) el.appendChild(h('li', {}, [h('span', { class: 'sw sw-line' }), 'Sunset ' + C.fmtTime(s)]));
  }

  function blockNote(b) {
    var note = b.note || '', s = view.sunset;
    if (b.type === 'handoff') {
      note = 'From here the evening follows your DJ’s or planner’s timeline, and we photograph all of it.' + (note ? ' ' + note : '');
      if (state.m.sunsetPortraits === 'yes' && s !== null) {
        var at = Math.round((s - SUNSET_PORTRAIT_LEAD) / 5) * 5;
        if (at > b.start && at < b.end) note += ' For sunset portraits, we will slip out with you for about 10 minutes around ' + C.fmtTime(at) + '.';
      }
      if (state.a.exit) note += ' Exit: ' + state.a.exit + '.';
    }
    return note;
  }

  function renderRows() {
    var ol = $('rows'); ol.textContent = '';
    view.blocks.forEach(function (b) {
      var ht = C.blockHeight(Math.max(b.duration, 0), SCALE);
      var cls = 'blk ' + (b.type === 'anchor' ? 'anchor' : b.type === 'buffer' ? 'buffer' : 'std');
      var change = changesVisible() ? view.changes.byId[b.id] : null;
      if (change) cls += ' changed';
      var nm = h('span', { class: 'nm', text: dn(b) });
      if (change) nm.appendChild(h('span', { class: 'chip', text: change.kind }));
      var nReq = state.requests.filter(function (r) { return r.itemId === b.id; }).length;
      if (nReq) nm.appendChild(h('span', { class: 'chip req', text: nReq === 1 ? 'Change requested' : nReq + ' requests' }));
      var note = blockNote(b);
      var btn = h('button', {
        class: cls, type: 'button', 'data-id': b.id, style: 'min-height:' + ht.height + 'px',
        'aria-label': dn(b) + ', ' + range(b) + ', ' + C.fmtDuration(b.duration)
      }, [
        nm,
        second(b) ? h('span', { class: 'blk-sub', text: second(b) }) : null,
        note && (ht.height >= 110 || b.type !== 'handoff') ? h('span', { class: 'blk-note', text: note }) : null,
        ht.compressed ? h('span', { class: 'brk', 'aria-hidden': 'true' }) : null,
        ht.compressed ? h('span', { class: 'brk-label', text: 'Continues' }) : null
      ]);
      btn.addEventListener('click', function () { openItem(b.id); });
      ol.appendChild(h('li', { class: 'row' }, [
        h('div', { class: 't' }, [h('span', { class: 't-time', text: C.fmtTime(b.start) }), h('span', { class: 't-dur', text: C.fmtDuration(b.duration) })]),
        btn
      ]));
    });
  }

  // Golden hour is two gold lines: dashed where it begins, solid at sunset. Each is placed
  // from measured block positions, interpolating inside the block that contains that time.
  function layoutOverlays() {
    var tl = $('tl'), base = tl.getBoundingClientRect().top;
    var btns = Array.prototype.slice.call(tl.querySelectorAll('.blk'));
    if (btns.length !== view.blocks.length) return;
    var rows = view.blocks.map(function (b, i) {
      var r = btns[i].getBoundingClientRect();
      return { start: b.start, end: b.end, top: r.top - base, height: r.height };
    });
    ['ov-gold', 'ov-line', 'gold-lab', 'sun-lab'].forEach(function (id) { $(id).hidden = true; });
    var s = view.sunset, cov = view.cov;
    if (s === null || !rows.length) return;
    var mark = function (minute, lineId, labId, icon, what) {
      if (minute < cov.start || minute > cov.end) return;
      var y = C.yForTime(minute, rows);
      if (y === null) return;
      var line = $(lineId); line.style.top = (y - 0.75) + 'px'; line.hidden = false;
      // The left column holds each block's start time and duration (top+7 to top+35);
      // move this label just above or below them when it would land on top of them.
      var labY = y;
      rows.forEach(function (r) {
        if (y >= r.top - 9 && y < r.top + 7) labY = r.top - 9;
        else if (y >= r.top + 7 && y < r.top + 44) labY = r.top + 44;
      });
      var lab = $(labId); lab.textContent = '';
      lab.appendChild(icon); lab.appendChild(document.createTextNode(C.fmtTime(minute).replace(/ [AP]M$/, '')));
      lab.setAttribute('aria-label', what + ' ' + C.fmtTime(minute));
      lab.style.top = (labY - 7) + 'px'; lab.hidden = false;
    };
    mark(s - GOLDEN_MIN, 'ov-gold', 'gold-lab', h('span', { class: 'ring' }), 'Golden hour begins');
    mark(s, 'ov-line', 'sun-lab', sunIcon(), 'Sunset');
  }

  function renderApprove() {
    var el = $('approve-sec'); el.textContent = '';
    if (view.status === 'approved') {
      el.appendChild(h('h2', { id: 'approve-h', text: 'Approved' }));
      el.appendChild(h('p', { class: 'stamp', text: 'Version ' + view.shownN + ' approved by ' + state.approval.name + ' on ' + state.approval.at + '. If anything changes, this page will ask for your approval again.' }));
      return;
    }
    el.appendChild(h('h2', { id: 'approve-h', text: 'Does this look right?' }));
    el.appendChild(h('p', { text: 'Approving tells Mary Anna this is the plan for the day. If something needs to move, tap that part of the day and request a change instead.' }));
    var btn = h('button', { class: 'btn', type: 'button', id: 'approve-btn', text: 'Approve this timeline' });
    btn.addEventListener('click', function () {
      var cer = view.blocks.filter(function (b) { return b.id === 'ceremony'; })[0];
      $('approve-dlg-p').textContent = 'You are approving Version ' + view.shownN + ' for ' + longDate() + ', ceremony at ' + C.fmtTime(cer.start) + '.';
      $('approve-dlg').showModal();
    });
    el.appendChild(btn);
  }

  function renderRequests() {
    var ul = $('reqs'); ul.textContent = '';
    if (!state.requests.length) { ul.appendChild(h('li', {}, [h('small', { text: 'No change requests yet.' })])); return; }
    state.requests.forEach(function (r) {
      ul.appendChild(h('li', {}, [h('span', { class: 'label', text: r.itemName }), h('q', { text: r.text }),
        h('small', { text: 'Sent on Version ' + r.version + '. Waiting on Mary Anna.' })]));
    });
  }

  function renderPage() {
    renderHero(); renderStatus(); renderFacts(); renderLegend();
    if (HAS_BUILDER && view.as !== 'couple') renderRowsEdit(); else renderRows();
    renderApprove(); renderRequests();
    layoutOverlays();
  }

  /* ---------- Builder (Mary's side) ---------- */
  // Low-input start: three fields and two taps make a day; everything after that is done on the timeline itself.
  var FIELDS = { // input id -> [bucket, key, kind]
    'q-couple': ['a', 'couple', 'text'], 'q-date': ['a', 'date', 'text'], 'q-cer-start': ['a', 'cerStart', 'text'],
    'q-cer-len': ['a', 'cerLen', 'num'], 'q-rec-end': ['a', 'recEnd', 'text'], 'm-hours': ['m', 'hours', 'num'],
    'q-planner': ['a', 'planner', 'text'], 'q-cer-venue': ['a', 'cerVenue', 'text'], 'q-place': ['a', 'place', 'text'],
    'q-rec-venue': ['a', 'recVenue', 'text'], 'q-bride-prep': ['a', 'bridePrep', 'text'], 'q-groom-prep': ['a', 'groomPrep', 'text'],
    'q-exit': ['a', 'exit', 'text'], 'q-notes': ['a', 'notes', 'text']
  };
  var undoStack = [];
  function snap() { return JSON.stringify({ a: state.a, m: state.m, items: state.items }); }
  function remember(s) { undoStack.push(s || snap()); if (undoStack.length > 40) undoStack.shift(); }
  function undo() {
    var s = undoStack.pop(); if (!s) return;
    s = JSON.parse(s); state.a = s.a; state.m = s.m; state.items = s.items; fillInputs(); refresh();
  }
  function isMulti() { var a = state.a; return a.multi === undefined ? (!a.brideSame || !a.recSame) : a.multi; }
  function itemById(id) { return state.items.filter(function (x) { return x.id === id; })[0]; }

  function fillInputs() {
    Object.keys(FIELDS).forEach(function (id) {
      var f = FIELDS[id], v = state[f[0]][f[1]];
      $(id).value = v === null || v === undefined ? '' : v;
    });
  }

  // Rebuild rows from the answers but keep wording, notes and durations changed by hand, and any added rows.
  function regenerate() {
    var old = {}; state.items.forEach(function (it) { old[it.id] = it; });
    var fresh = C.generateItems(state.a, state.m);
    var custom = state.items.filter(function (it) { return /^x\d+$/.test(it.id); });
    state.items = fresh.map(function (it) {
      var o = old[it.id];
      if (!o) return it;
      return Object.assign({}, it, { note: o.note, duration: o.durEdited ? o.duration : it.duration, durEdited: !!o.durEdited, edited: !!o.edited,
        name: o.edited ? o.name : it.name, second: o.edited ? o.second : it.second });
    });
    custom.forEach(function (it) {
      var at = it.side === 'before' ? state.items.filter(function (x) { return x.side === 'before'; }).length : state.items.length - 1;
      state.items.splice(at, 0, it);
    });
    refresh();
  }

  function seg(id, options, current, onPick) {
    var box = $(id); box.textContent = '';
    options.forEach(function (o) {
      var b = h('button', { class: 'segbtn', type: 'button', 'aria-pressed': String(o[0]) === String(current) ? 'true' : 'false', text: o[1] });
      b.addEventListener('click', function () { if (String(o[0]) !== String(current)) onPick(o[0]); });
      box.appendChild(b);
    });
  }
  function renderBasics() {
    var a = state.a, m = state.m;
    seg('seg-look', [['firstlook', 'First look'], ['contact', 'First contact'], ['neither', 'Neither']], a.look, function (v) {
      remember(); a.look = v;
      // A first look frees the couple to join cocktail hour; without one, photos usually take that time.
      if (!m.cocktailEdited) m.cocktail = v === 'firstlook' ? 30 : 0;
      regenerate();
    });
    seg('seg-loc', [['one', 'One location'], ['several', 'Several']], isMulti() ? 'several' : 'one', function (v) {
      remember(); a.multi = v === 'several'; a.brideSame = !a.multi; a.recSame = !a.multi; regenerate();
    });
    seg('seg-len', [[30, '30 min'], [45, '45'], [60, '60']], +a.cerLen, function (v) { remember(); a.cerLen = v; $('q-cer-len').value = v; refresh(); });

    var box = $('chips'); box.textContent = '';
    var chip = function (label, on, set) {
      var b = h('button', { class: 'chipbtn', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: label });
      b.addEventListener('click', function () { remember(); set(!on); regenerate(); });
      box.appendChild(b);
    };
    chip('First look with dad', a.dad === 'yes', function (v) { a.dad = v ? 'yes' : 'no'; });
    chip('Robe photos', a.robes === 'yes', function (v) { a.robes = v ? 'yes' : 'no'; });
    chip('Cocktail hour', m.cocktail > 0, function (v) { m.cocktail = v ? 30 : 0; m.cocktailEdited = true; });
    chip('Sunset portraits', m.sunsetPortraits === 'yes', function (v) { m.sunsetPortraits = v ? 'yes' : 'no'; });
    chip('Exit', !!a.exit, function (v) { a.exit = v ? 'Sparklers' : ''; $('q-exit').value = a.exit; });
    if (isMulti()) {
      chip('Drive to ceremony', !a.brideSame, function (v) { a.brideSame = !v; });
      chip('Drive to reception', !a.recSame, function (v) { a.recSame = !v; });
    }
    chip('Groom gets ready elsewhere', !a.groomSame, function (v) { a.groomSame = !v; });
  }

  function renderStrip() {
    var cov = view.cov, cer = view.blocks.filter(function (b) { return b.id === 'ceremony'; })[0];
    var booked = (+state.m.hours || 0) * 60, over = cov.minutes - booked;
    var el = $('anchors'); el.textContent = '';
    var add = function (k, v, cls) { el.appendChild(h('span', { class: 'anc' + (cls ? ' ' + cls : '') }, [h('span', { class: 'anc-k', text: k }), h('span', { class: 'anc-v', text: v })])); };
    add('Photos begin', C.fmtTime(cov.start));
    add('Ceremony', C.fmtTime(cer.start));
    add('Sunset', view.sunset === null ? 'Set the date' : C.fmtTime(view.sunset));
    add('Reception ends', C.fmtTime(cov.end));
    add('Coverage', C.fmtDuration(cov.minutes) + ' of ' + C.fmtDuration(booked) + ' booked' + (over > 0 ? ', ' + C.fmtDuration(over) + ' over' : ''), over > 0 ? 'warn' : 'ok');
    $('undo-btn').disabled = !undoStack.length;
    $('view-btn').textContent = view.as === 'couple' ? 'Back to editing' : 'View as couple';
    $('view-btn').setAttribute('aria-pressed', view.as === 'couple' ? 'true' : 'false');
    document.body.dataset.viewas = view.as === 'couple' ? 'couple' : 'edit';
  }

  function clearDrop() { Array.prototype.forEach.call(document.querySelectorAll('.drop-before, .drop-after'), function (x) { x.classList.remove('drop-before', 'drop-after'); }); }
  // Reordering by dragging the grip. Done with pointer events so text fields in the rows keep working normally.
  function wireDrag(li, handle, it) {
    li.dataset.item = it.id;
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var target = null, after = false;
      li.classList.add('dragging'); document.body.style.cursor = 'grabbing';
      var move = function (ev) {
        clearDrop(); target = null;
        Array.prototype.forEach.call(document.querySelectorAll('#rows .row[data-item]'), function (row) {
          var other = itemById(row.dataset.item), r = row.getBoundingClientRect();
          if (!other || other.id === it.id || other.side !== it.side || ev.clientY < r.top || ev.clientY > r.bottom) return;
          target = other; after = ev.clientY > r.top + r.height / 2;
          row.classList.add(after ? 'drop-after' : 'drop-before');
        });
      };
      var up = function () {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        li.classList.remove('dragging'); document.body.style.cursor = ''; clearDrop();
        if (!target) return;
        remember();
        state.items.splice(state.items.indexOf(it), 1);
        state.items.splice(state.items.indexOf(target) + (after ? 1 : 0), 0, it);
        refresh();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  }

  // The timeline itself is the editor: same blocks and heights the couple sees, with the text editable in place.
  function renderRowsEdit() {
    var ol = $('rows'); ol.textContent = '';
    var addBar = function (side) {
      var sel = h('select', { class: 'addsel', 'aria-label': 'Add a row ' + (side === 'before' ? 'before' : 'after') + ' the ceremony' },
        [h('option', { value: '', text: '+ Add a row ' + (side === 'before' ? 'before' : 'after') + ' the ceremony' })]
          .concat(C.LIBRARY.map(function (l) { return h('option', { value: l.key, text: l.name || 'Blank row' }); })));
      sel.addEventListener('change', function () {
        var lib = C.LIBRARY.filter(function (l) { return l.key === sel.value; })[0]; if (!lib) return;
        remember();
        var it = { id: 'x' + (state.seq++), side: side, name: lib.name, second: lib.second, duration: lib.duration, type: lib.type || 'std', note: '' };
        var at = side === 'before' ? state.items.filter(function (x) { return x.side === 'before'; }).length : state.items.length - 1;
        state.items.splice(at, 0, it);
        refresh();
      });
      ol.appendChild(h('li', { class: 'addbar' }, [h('span'), sel]));
    };
    view.blocks.forEach(function (b) {
      var it = itemById(b.id), handoff = it && it.type === 'handoff';
      if (b.id === 'ceremony') addBar('before');
      if (handoff) addBar('after');
      var ht = C.blockHeight(Math.max(b.duration, 0), SCALE);
      var kids = [];
      if (!it) {
        kids.push(h('span', { class: 'nm', text: b.name }), h('span', { class: 'blk-sub', text: 'Time and length are set at the top' }));
      } else {
        var field = function (cls, key, ph) {
          var inp = h('input', { class: cls + (it[key] ? ' has' : ''), type: 'text', placeholder: ph, 'aria-label': ph, value: it[key] || '' }), before = null;
          inp.addEventListener('focus', function () { before = snap(); });
          inp.addEventListener('input', function () {
            if (before) { remember(before); before = null; }
            it[key] = inp.value; if (key !== 'note') it.edited = true;
            inp.classList.toggle('has', !!inp.value);
            light();
          });
          return inp;
        };
        kids.push(field('e-name', 'name', 'What Mary is photographing'));
        if (!handoff) kids.push(field('e-second', 'second', 'Ben, at the same time'));
        kids.push(field('e-note', 'note', handoff ? 'Extra note for the couple' : 'Note for the couple (anything under 10 minutes goes here)'));
        if (handoff) kids.push(h('span', { class: 'blk-note', text: blockNote(Object.assign({}, b, { note: '' })) }));
      }
      var blk = h('div', { class: 'blk edit ' + (b.type === 'anchor' ? 'anchor' : b.type === 'buffer' ? 'buffer' : 'std'), 'data-id': b.id, style: 'min-height:' + ht.height + 'px' }, kids);
      var li = h('li', { class: 'row' }, [
        h('div', { class: 't' }, [h('span', { class: 't-time', text: C.fmtTime(b.start) }), h('span', { class: 't-dur', text: C.fmtDuration(b.duration) })]), blk
      ]);
      if (it && !handoff) {
        var i = state.items.indexOf(it);
        var act = function (label, title, fn, off) {
          var bt = h('button', { class: 'ebtn', type: 'button', title: title, 'aria-label': title + ': ' + dn(it), text: label });
          if (off) bt.disabled = true;
          bt.addEventListener('click', function () { remember(); fn(); refresh(); });
          return bt;
        };
        var same = function (j) { return state.items[j] && state.items[j].side === it.side && state.items[j].type !== 'handoff'; };
        var swap = function (j) { state.items[i] = state.items[j]; state.items[j] = it; };
        var handle = h('span', { class: 'ebtn grip', title: 'Drag to reorder', 'aria-hidden': 'true', text: '☰' });
        blk.appendChild(h('span', { class: 'e-ctl' }, [
          handle,
          act('−', 'Shorten by 5 minutes', function () { it.duration = Math.max(C.MIN_DURATION, it.duration - 5); it.durEdited = true; }, it.duration <= C.MIN_DURATION),
          act('+', 'Lengthen by 5 minutes', function () { it.duration += 5; it.durEdited = true; }),
          act('↑', 'Move earlier', function () { swap(i - 1); }, !same(i - 1)),
          act('↓', 'Move later', function () { swap(i + 1); }, !same(i + 1)),
          act('×', 'Remove this row', function () { state.items.splice(i, 1); })
        ]));
        wireDrag(li, handle, it);
      }
      ol.appendChild(li);
    });
  }

  function renderChecks() {
    var ul = $('checks'); ul.textContent = '';
    var cov = view.cov, s = view.sunset, a = state.a, booked = (+state.m.hours || 0) * 60;
    var add = function (kind, text) { ul.appendChild(h('li', { class: 'chk chk-' + kind }, [h('span', { class: 'chk-tag', text: kind === 'ok' ? 'OK' : kind === 'warn' ? 'Check' : 'Note' }), text])); };
    var rec = view.blocks[view.blocks.length - 1];
    if (hm(a.recEnd) === null) add('warn', 'No reception end time yet, so the reception is shown as ' + C.fmtDuration(rec.duration) + '.');
    else if (rec.duration < C.MIN_DURATION) add('warn', 'The reception end time is earlier than the time the reception starts on this timeline.');
    var need = cov.minutes;
    add(need > booked ? 'warn' : 'ok', 'This day runs ' + C.fmtTime(cov.start) + ' to ' + C.fmtTime(cov.end) + ', ' + C.fmtDuration(need) + ' of photography. Booked: ' +
      C.fmtDuration(booked) + '. ' + (need > booked ? 'That is ' + C.fmtDuration(need - booked) + ' over. Booked coverage would end at ' + C.fmtTime(cov.start + booked) + '.' : 'That fits, with ' + C.fmtDuration(booked - need) + ' to spare.'));
    if (a.exit) add('note', 'Exit planned (' + a.exit + '). Coverage has to reach the end of the reception to photograph it.');
    if (s !== null) {
      var blk = view.blocks.filter(function (b) { return s >= b.start && s < b.end; })[0];
      add('note', 'Sunset is ' + C.fmtTime(s) + (blk ? ', during "' + dn(blk) + '".' : s >= cov.end ? ', after the reception ends.' : ', before photos begin.') +
        (state.m.sunsetPortraits === 'yes' && blk && blk.type !== 'handoff' ? ' Sunset portraits would need their own row here.' : ''));
    }
    if (a.planner) add('note', 'Planner or coordinator: ' + a.planner + '.');
    if (a.notes) add('note', 'From "Is there anything else?": ' + a.notes);
    $('pub-btn').textContent = 'Publish Version ' + (lastN() + 1);
    $('pub-btn').disabled = !view.dirty;
    var showLink = MODE === 'admin' && lastN() > 0;
    if ($('link-row')) { $('link-row').hidden = !showLink; $('link-help').hidden = !showLink; $('pub-link').value = shareUrl; }
    $('pub-state').textContent = !lastN() ? 'Nothing published yet.' :
      view.dirty ? 'Version ' + lastN() + ' is published. This draft has ' + view.changes.lines.length + ' unpublished change' + (view.changes.lines.length === 1 ? '' : 's') + '.' :
      'Version ' + lastN() + ' is published and matches this draft.';
  }

  function refresh() { derive(); if (HAS_BUILDER) { renderBasics(); renderStrip(); renderChecks(); } renderPage(); save(); }
  // After typing in a row: update everything except the rows, so the cursor stays where it is.
  function light() { derive(); renderStrip(); renderChecks(); renderHero(); renderStatus(); renderFacts(); renderLegend(); layoutOverlays(); save(); }

  /* ---------- Item sheet (couple's side) ---------- */
  function openItem(id) {
    var b = view.blocks.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    view.openId = id;
    $('item-when').textContent = range(b) + ' · ' + C.fmtDuration(b.duration);
    $('item-name').textContent = dn(b);
    $('item-second').textContent = second(b) ? 'At the same time: ' + second(b) : ''; $('item-second').hidden = !second(b);
    var note = blockNote(b);
    $('item-note').textContent = note; $('item-note').hidden = !note;
    var ch = changesVisible() ? view.changes.byId[b.id] : null;
    $('item-change').textContent = ch ? 'Changed in Version ' + view.shownN + ': ' + ch.text + '.' : '';
    $('item-change').hidden = !ch;
    $('item-text').value = '';
    $('item-dlg').showModal();
  }
  function addRequest(itemId, itemName, text) { state.requests.push({ itemId: itemId, itemName: itemName, text: text, version: view.shownN }); }

  /* ---------- Events ---------- */
  if (HAS_BUILDER) {
  Object.keys(FIELDS).forEach(function (id) {
    var f = FIELDS[id], el = $(id), before = null;
    el.addEventListener('focus', function () { before = snap(); });
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
      if (before) { remember(before); before = null; }
      state[f[0]][f[1]] = f[2] === 'num' ? (el.value === '' ? '' : +el.value) : el.value;
      refresh();
    });
  });
  $('undo-btn').addEventListener('click', undo);
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  });
  $('view-btn').addEventListener('click', function () { view.as = view.as === 'couple' ? 'edit' : 'couple'; refresh(); });
  $('regen-btn').addEventListener('click', function () { remember(); state.items = C.generateItems(state.a, state.m); refresh(); });
  if ($('reset-btn')) $('reset-btn').addEventListener('click', function () { remember(); var d = defaults(); state.a = d.a; state.m = d.m; state.items = d.items; fillInputs(); refresh(); });
  $('pub-btn').addEventListener('click', function () {
    var snapBlocks = snapshot(), changes = view.changes;
    var done = function (n) {
      state.versions.push({ n: n, blocks: snapBlocks, changes: changes, at: new Date().toISOString() });
      state.showChanges = true; refresh();
    };
    if (MODE !== 'admin') { done(lastN() + 1); return; }
    $('pub-btn').disabled = true;
    fetch('/admin/api/weddings/' + REF + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: state.a, m: state.m, items: state.items, blocks: snapBlocks, changes: changes }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { done(j.n); setSaveState('Version ' + j.n + ' published'); })
      .catch(function () { setSaveState('Could not publish. Nothing changed for the couple. Reload and try again.'); renderChecks(); });
  });
  if ($('copy-btn')) $('copy-btn').addEventListener('click', function () {
    var ok = function () { $('copy-btn').textContent = 'Copied'; setTimeout(function () { $('copy-btn').textContent = 'Copy link'; }, 1500); };
    try { navigator.clipboard.writeText(shareUrl).then(ok, function () { $('pub-link').select(); }); } catch (e) { $('pub-link').select(); }
  });
  } // end builder events

  $('item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('item-text').value.trim();
    if (!text) { $('item-text').focus(); return; }
    var b = view.blocks.filter(function (x) { return x.id === view.openId; })[0];
    addRequest(b.id, dn(b) + ', ' + C.fmtTime(b.start), text);
    $('item-dlg').close(); refresh();
  });
  $('item-close').addEventListener('click', function () { $('item-dlg').close(); });
  $('general-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('general-text').value.trim();
    if (!text) { $('general-text').focus(); return; }
    addRequest(null, 'General comment', text);
    $('general-text').value = ''; refresh();
  });
  $('approve-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('approve-name').value.trim();
    if (!name) { $('approve-name').focus(); return; }
    var now = new Date();
    state.approval = { name: name, n: view.shownN,
      at: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(now) + ' at ' +
          new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(now) };
    $('approve-dlg').close(); refresh();
  });
  $('approve-close').addEventListener('click', function () { $('approve-dlg').close(); });
  ['item-dlg', 'approve-dlg'].forEach(function (id) {
    $(id).addEventListener('click', function (e) { if (e.target === $(id)) $(id).close(); });
  });

  /* ---------- Start ---------- */
  function start() {
    document.body.dataset.feedback = FEEDBACK ? 'on' : 'off';
    document.body.dataset.mode = MODE;
    if (HAS_BUILDER) {
      Object.keys(PLACES).forEach(function (k) { $('q-place').appendChild(h('option', { value: k, text: PLACES[k].label })); });
      fillInputs();
    }
    if ($('pagecol')) $('pagecol').hidden = false;
    refresh();
    ready = true;
    if (window.ResizeObserver) new ResizeObserver(function () { layoutOverlays(); }).observe($('tl'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutOverlays);
  }
  function fail() { var el = $('load-msg'); if (el) el.hidden = false; var app = document.querySelector('.app'); if (app) app.hidden = true; }
  function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  if (MODE === 'local') { state = load() || defaults(); start(); }
  else if (MODE === 'admin') {
    getJson('/admin/api/weddings/' + REF).then(function (j) {
      var d = defaults(), draft = j.draft || {};
      d.a = Object.assign(d.a, draft.a || {}); d.m = Object.assign(d.m, draft.m || {});
      if (draft.items && draft.items.length) d.items = draft.items;
      d.seq = draft.seq || 1; d.versions = j.versions || [];
      state = d; shareUrl = location.origin + '/t/' + j.token;
      start(); setSaveState('All changes saved');
    }).catch(fail);
  } else {
    getJson('/api/t/' + REF).then(function (j) {
      served = j;
      var d = defaults();
      d.a = Object.assign(d.a, j.snapshot.a || {}); d.m = Object.assign(d.m, j.snapshot.m || {}); d.items = j.snapshot.items || [];
      state = d; document.title = (d.a.couple ? d.a.couple + ' \u00b7 ' : '') + 'Wedding Day Timeline';
      start();
    }).catch(fail);
  }
})();

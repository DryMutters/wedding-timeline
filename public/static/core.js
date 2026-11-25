/* Timeline core: time chaining, block heights, sunset.
   Pure functions, no DOM. Shared by the builder and the published page.
   All clock arithmetic is in whole minutes from midnight, venue local time. */
var TimelineCore = (function () {
  'use strict';

  /* ---------- Time chaining ---------- */

  // wedding: { ceremonyStart (min from midnight), ceremonyDuration, items: [{id, side, order, duration, ...}] }
  // Returns ordered blocks with derived start and end. Minutes may fall below 0 or
  // above 1440 when a day crosses midnight; format with fmtTime at the edge.
  function buildTimeline(wedding) {
    var bySide = function (side) {
      return wedding.items
        .filter(function (i) { return i.side === side; })
        .sort(function (a, b) { return a.order - b.order; });
    };
    var before = bySide('before');
    var after = bySide('after');
    var blocks = [];

    // Chain backward: the item closest to the ceremony ends when the ceremony starts.
    var t = wedding.ceremonyStart;
    var rev = [];
    for (var i = before.length - 1; i >= 0; i--) {
      var end = t;
      t = t - before[i].duration;
      rev.push(Object.assign({}, before[i], { start: t, end: end }));
    }
    blocks = rev.reverse();

    var cEnd = wedding.ceremonyStart + wedding.ceremonyDuration;
    blocks.push({
      id: 'ceremony', name: wedding.ceremonyName || 'Ceremony', type: 'anchor',
      duration: wedding.ceremonyDuration, start: wedding.ceremonyStart, end: cEnd,
      location: wedding.ceremonyLocation || '', note: wedding.ceremonyNote || ''
    });

    // Chain forward: the first item starts when the ceremony ends.
    // An item with endAt (the reception) runs to that clock time instead of a typed
    // duration. endAt at or before the ceremony start means it is past midnight.
    t = cEnd;
    for (var j = 0; j < after.length; j++) {
      var d = after[j].duration, derived = false;
      if (after[j].endAt !== null && after[j].endAt !== undefined) {
        var endAt = after[j].endAt;
        while (endAt <= wedding.ceremonyStart) endAt += 1440;
        d = endAt - t; derived = true;
      }
      blocks.push(Object.assign({}, after[j], { start: t, end: t + d, duration: d, derived: derived }));
      t += d;
    }
    return blocks;
  }

  function coverage(blocks) {
    var start = blocks[0].start, end = blocks[blocks.length - 1].end;
    return { start: start, end: end, minutes: end - start };
  }

  /* ---------- Starting timeline from the questionnaire ---------- */

  var MIN_DURATION = 10; // anything shorter is a note on a neighbouring item, not a row

  function cleanDuration(minutes) {
    var m = Math.round((+minutes || 0) / 5) * 5;
    return Math.max(MIN_DURATION, m);
  }

  // a: questionnaire answers. m: what the photographer adds.
  // a.look: 'firstlook' | 'contact' | 'neither'. a.recSame: reception at the ceremony venue.
  // a.brideSame: bride gets ready at the ceremony venue. a.groomSame: groom gets ready where the bride does.
  // Item ids are stable per kind, so regenerating keeps version-to-version changes meaningful.
  function generateItems(a, m) {
    var first = a.look === 'firstlook', contact = a.look === 'contact', dad = a.dad === 'yes';
    var out = [];
    var add = function (id, side, name, second, duration, type) {
      out.push({ id: id, side: side, name: name, second: second || '', duration: cleanDuration(duration), type: type || 'std', note: '' });
    };
    var driveToCeremony = function () { add('drive_cer', 'before', 'Drive to Ceremony', '', a.driveCer || 15, 'travel'); };

    add('details', 'before', 'Mary Photographs Bride\u2019s Details',
      // Ben's first job is always the dress shot. Then he goes to the groom, wherever the groom is getting ready.
      !a.groomSame ? 'Ben Photographs the Dress, then Drives to the Groom' : (a.recSame ? 'Ben Photographs the Dress, then Sets Up Reception Lights' : 'Ben Photographs the Dress, then Joins the Groom'), 45);
    if (a.robes === 'yes') add('robes', 'before', 'Getting Ready & Robe Photos', '', 20);
    add('dress', 'before', 'Mary Photographs Bride Getting Into Dress', 'Ben Photographs Groom & Groomsmen Getting on Ties & Coats', 20); // 20 by default; a hard getting-ready location is Mary's call
    if (dad) add('dad', 'before', 'First Look with Dad', first ? '' : 'Groom with Groomsmen', 10);
    if (first) {
      if (a.brideSame) add('walk', 'before', 'Walk to First Look', '', 15); else driveToCeremony();
      add('firstlook', 'before', 'First Look', '', 15);
      add('portraits', 'before', 'Bride & Groom Portraits', 'Bride & Groom Individuals', 30);
      add('party', 'before', 'Full Bridal Party', '', 15);
      add('maids', 'before', 'Bride with Bridesmaids', 'Groom with Groomsmen', 15);
      if (a.recSame) add('decor', 'before', '', 'Capture Reception & Ceremony Decor', 20);
      add('family_pre', 'before', 'Immediate Family Photos', '', 20);
    } else {
      add('maids', 'before', 'Bride with Bridesmaids', dad ? 'Groom with Immediate Family' : 'Groom with Groomsmen', 15);
      if (!a.brideSame) driveToCeremony();
    }
    add('hide', 'before', contact ? 'Bride & Groom Hide, First Contact' : 'Bride & Groom Hide, Rest & Retouch',
      'Mary & Ben Photograph Ceremony Decor', first ? 20 : 30, 'buffer');

    add('family', 'after', 'Family Photos', '', 20);
    if (!first) add('party', 'after', 'Full Bridal Party', '', 15);
    add('couple', 'after', 'Bride and Groom Photos', '', first ? 10 : 20);
    if (!a.recSame) add('drive_rec', 'after', 'Drive to Reception', '', a.driveRec || 15, 'travel');
    if (m && m.cocktail > 0) add('cocktail', 'after', 'Bride & Groom Join Cocktail Hour', '', m.cocktail);
    add('reception', 'after', 'Everyone at Reception', '', 180, 'handoff');
    return out;
  }

  // Extra rows the photographer can add by hand.
  var LIBRARY = [
    { key: 'robes', name: 'Getting Ready & Robe Photos', second: '', duration: 20 },
    { key: 'dad', name: 'First Look with Dad', second: '', duration: 10 },
    { key: 'firstlook', name: 'First Look', second: '', duration: 15 },
    { key: 'bridal', name: 'Bridal Portraits', second: 'Groom Individuals', duration: 20 },
    { key: 'portraits', name: 'Bride & Groom Portraits', second: 'Bride & Groom Individuals', duration: 30 },
    { key: 'party', name: 'Full Bridal Party', second: '', duration: 15 },
    { key: 'maids', name: 'Bride with Bridesmaids', second: 'Groom with Groomsmen', duration: 15 },
    { key: 'family', name: 'Family Photos', second: '', duration: 20 },
    { key: 'couple', name: 'Bride and Groom Photos', second: '', duration: 20 },
    { key: 'drive', name: 'Drive', second: '', duration: 15, type: 'travel' },
    { key: 'cocktail', name: 'Bride & Groom Join Cocktail Hour', second: '', duration: 30 },
    { key: 'sunset', name: 'Sunset Portraits', second: '', duration: 10 },
    { key: 'exit', name: 'Exit', second: '', duration: 10 },
    { key: 'custom', name: '', second: '', duration: 15 }
  ];

  /* ---------- What changed between two versions ---------- */

  // prev, cur: arrays of blocks ({id, name, second, start, duration}). Returns
  // { byId: {id: {kind, text}}, lines: [text] } for highlights and the banner list.
  function computeChanges(prev, cur) {
    var label = function (b) { return b.name || b.second || 'Item'; };
    var byId = {}, lines = [], pmap = {}, cmap = {};
    prev.forEach(function (b) { pmap[b.id] = b; });
    cur.forEach(function (b) { cmap[b.id] = b; });
    var pc = pmap.ceremony, cc = cmap.ceremony;
    if (pc && cc && pc.start !== cc.start) lines.push('Ceremony moved from ' + fmtTime(pc.start) + ' to ' + fmtTime(cc.start) + ', so every time shifted');
    prev.forEach(function (b) { if (!cmap[b.id]) lines.push(label(b) + ' removed'); });
    // Items outside the longest common subsequence of the two orders have moved.
    var A = prev.filter(function (b) { return cmap[b.id]; }).map(function (b) { return b.id; });
    var B = cur.filter(function (b) { return pmap[b.id]; }).map(function (b) { return b.id; });
    var n = A.length, L = [], i, j;
    for (i = 0; i <= n; i++) { L.push([]); for (j = 0; j <= n; j++) L[i].push(0); }
    for (i = n - 1; i >= 0; i--) for (j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var kept = {}; i = 0; j = 0;
    while (i < n && j < n) { if (A[i] === B[j]) { kept[A[i]] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    cur.forEach(function (b) {
      var p = pmap[b.id], c = null;
      if (!p) c = { kind: 'New', text: label(b) + ' added' };
      else if (p.duration !== b.duration) c = { kind: 'Retimed', text: label(b) + ' changed from ' + fmtDuration(p.duration) + ' to ' + fmtDuration(b.duration) };
      else if (!kept[b.id]) c = { kind: 'Moved', text: label(b) + ' moved' };
      if (c) { byId[b.id] = c; lines.push(c.text); }
    });
    return { byId: byId, lines: lines };
  }

  /* ---------- Block heights ---------- */

  // scale: { mode: 'clamped' | 'strict', pxPerMin, min, max }
  function blockHeight(duration, scale) {
    var h = duration * scale.pxPerMin;
    if (scale.mode === 'strict') return { height: h, compressed: false };
    var clamped = Math.max(scale.min, Math.min(scale.max, h));
    return { height: clamped, compressed: h > scale.max };
  }

  // Position of a clock time on the page, given each block's measured top and height.
  // Interpolates inside whichever block contains the time, so it stays honest when
  // heights are clamped. rows: [{start, end, top, height}] in page order.
  function yForTime(minute, rows) {
    if (!rows.length) return null;
    if (minute < rows[0].start || minute > rows[rows.length - 1].end) return null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (minute >= r.start && minute <= r.end) {
        var frac = r.end === r.start ? 0 : (minute - r.start) / (r.end - r.start);
        return r.top + frac * r.height;
      }
      // Falls in the visual gap between two blocks (same clock minute, different pixels).
      if (i + 1 < rows.length && minute > r.end && minute < rows[i + 1].start) {
        return r.top + r.height;
      }
    }
    return null;
  }

  /* ---------- Formatting (display edge only) ---------- */

  function fmtTime(minute) {
    var m = ((Math.round(minute) % 1440) + 1440) % 1440;
    var h24 = Math.floor(m / 60), mm = m % 60;
    var h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h24 < 12 ? 'AM' : 'PM');
  }

  function fmtDuration(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' hr' + (m ? ' ' + m + ' min' : '');
  }

  /* ---------- Sunset (NOAA solar position equations) ---------- */

  var RAD = Math.PI / 180;

  function julianDay(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }

  function solar(T) {
    var L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
            Math.sin(3 * M * RAD) * 0.000289;
    var omega = 125.04 - 1934.136 * T;
    var lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    var y = Math.pow(Math.tan(eps * RAD / 2), 2);
    var eqTime = 4 / RAD * (
      y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    return { decl: decl, eqTime: eqTime };
  }

  // Sunset as minutes after 00:00 UTC on the given calendar date (can exceed 1440).
  // Returns null where the sun does not set that day.
  function sunsetUtcMinutes(year, month, day, lat, lon) {
    var jd0 = julianDay(year, month, day);
    var minutes = 720 - 4 * lon; // first guess: solar noon
    for (var pass = 0; pass < 3; pass++) {
      var T = (jd0 + minutes / 1440 - 2451545) / 36525;
      var s = solar(T);
      var cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(s.decl * RAD)) -
                 Math.tan(lat * RAD) * Math.tan(s.decl * RAD);
      if (cosH < -1 || cosH > 1) return null;
      var H = Math.acos(cosH) / RAD;
      minutes = 720 - 4 * lon - s.eqTime + 4 * H;
    }
    return minutes;
  }

  // Offset of a time zone from UTC, in minutes, at a given instant.
  function tzOffsetMinutes(date, timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    }).formatToParts(date);
    var p = {};
    parts.forEach(function (x) { p[x.type] = parseInt(x.value, 10); });
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  // Sunset in the venue's own time zone, as whole minutes from local midnight.
  function sunsetLocalMinutes(year, month, day, lat, lon, timeZone) {
    var utc = sunsetUtcMinutes(year, month, day, lat, lon);
    if (utc === null) return null;
    var instant = new Date(Date.UTC(year, month - 1, day) + utc * 60000);
    var local = utc + tzOffsetMinutes(instant, timeZone);
    // A western venue's sunset is past midnight UTC; keep it on the local wedding date.
    while (local >= 1440) local -= 1440;
    while (local < 0) local += 1440;
    return Math.round(local);
  }

  return {
    buildTimeline: buildTimeline, coverage: coverage,
    generateItems: generateItems, LIBRARY: LIBRARY, MIN_DURATION: MIN_DURATION, cleanDuration: cleanDuration,
    computeChanges: computeChanges,
    blockHeight: blockHeight, yForTime: yForTime,
    fmtTime: fmtTime, fmtDuration: fmtDuration,
    sunsetUtcMinutes: sunsetUtcMinutes, sunsetLocalMinutes: sunsetLocalMinutes,
    tzOffsetMinutes: tzOffsetMinutes
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TimelineCore;

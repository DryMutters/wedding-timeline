const C = require('../public/static/core.js');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
};
const near = (name, got, want, tol) => {
  const ok = got !== null && Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + `  got ${C.fmtTime(got)} want ${C.fmtTime(want)} (tolerance ${tol} min)`);
};
const hm = (h, m) => h * 60 + m;

const wedding = {
  ceremonyStart: hm(17, 0), ceremonyDuration: 30,
  items: [
    { id: 'a', side: 'before', order: 1, duration: 30 },
    { id: 'b', side: 'before', order: 2, duration: 45 },
    { id: 'c', side: 'before', order: 3, duration: 10 },
    { id: 'd', side: 'after', order: 1, duration: 60 },
    { id: 'e', side: 'after', order: 2, duration: 150 },
  ],
};
const t = C.buildTimeline(wedding);
const times = (tl) => Object.fromEntries(tl.map((b) => [b.id, [b.start, b.end]]));

// Chaining
eq('last before-item ends at ceremony start', times(t).c, [hm(16, 50), hm(17, 0)]);
eq('before-items chain backward', times(t).a, [hm(15, 35), hm(16, 5)]);
eq('first after-item starts at ceremony end', times(t).d, [hm(17, 30), hm(18, 30)]);
eq('after-items chain forward', times(t).e, [hm(18, 30), hm(21, 0)]);
eq('coverage', C.coverage(t), { start: hm(15, 35), end: hm(21, 0), minutes: 325 });

// Acceptance 2: moving the ceremony 30 minutes moves every item 30 minutes
const t2 = C.buildTimeline({ ...wedding, ceremonyStart: hm(17, 30) });
eq('ceremony +30 shifts every item +30', t2.map((b, i) => b.start - t[i].start), [30, 30, 30, 30, 30, 30]);

// Acceptance 3: a duration change shifts only items on the far side from the anchor
const w3 = { ...wedding, items: wedding.items.map((i) => (i.id === 'b' ? { ...i, duration: 60 } : i)) };
const t3 = C.buildTimeline(w3);
eq('longer before-item moves only earlier items', t3.map((b, i) => b.start - t[i].start), [-15, -15, 0, 0, 0, 0]);
const w4 = { ...wedding, items: wedding.items.map((i) => (i.id === 'd' ? { ...i, duration: 75 } : i)) };
const t4 = C.buildTimeline(w4);
eq('longer after-item moves only later items', t4.map((b, i) => b.end - t[i].end), [0, 0, 0, 0, 15, 15]);

// Midnight crossing and formatting
eq('format noon', C.fmtTime(720), '12:00 PM');
eq('format midnight', C.fmtTime(1440), '12:00 AM');
eq('format past midnight', C.fmtTime(1440 + 45), '12:45 AM');
eq('format morning', C.fmtTime(hm(9, 5)), '9:05 AM');
eq('duration', [C.fmtDuration(10), C.fmtDuration(60), C.fmtDuration(150)], ['10 min', '1 hr', '2 hr 30 min']);

// Heights
const clamp = { mode: 'clamped', pxPerMin: 2, min: 40, max: 280 };
eq('10 min clamps up to minimum', C.blockHeight(10, clamp), { height: 40, compressed: false });
eq('30 min is proportional', C.blockHeight(30, clamp), { height: 60, compressed: false });
eq('180 min clamps down and is flagged', C.blockHeight(180, clamp), { height: 280, compressed: true });
eq('strict mode is never clamped', C.blockHeight(180, { ...clamp, mode: 'strict', pxPerMin: 4 }), { height: 720, compressed: false });

// Sunset position interpolates inside the containing block
const rows = [{ start: 600, end: 660, top: 0, height: 120 }, { start: 660, end: 840, top: 126, height: 280 }];
eq('y at block midpoint', C.yForTime(630, rows), 60);
eq('y inside a compressed block', C.yForTime(750, rows), 126 + 140);
eq('y outside coverage is null', C.yForTime(900, rows), null);

// Sunset vs published times for Tampa, FL (sunrisesunset.io 2027 calendar)
const TPA = [27.9506, -82.4572, 'America/New_York'];
near('Tampa 2027-02-27 (EST)', C.sunsetLocalMinutes(2027, 2, 27, ...TPA), hm(18, 29), 2);
near('Tampa 2027-03-29 (EDT)', C.sunsetLocalMinutes(2027, 3, 29, ...TPA), hm(19, 46), 2);
near('Tampa 2027-03-31 (EDT)', C.sunsetLocalMinutes(2027, 3, 31, ...TPA), hm(19, 47), 2);
near('Tampa 2027-12-01 (earliest of year)', C.sunsetLocalMinutes(2027, 12, 1, ...TPA), hm(17, 34), 2);
// Venue time zone, not the viewer's: a western venue whose sunset is after 00:00 UTC
const la = C.sunsetLocalMinutes(2027, 6, 21, 34.0522, -118.2437, 'America/Los_Angeles');
near('Los Angeles 2027-06-21 stays on the local date', la, hm(20, 8), 3);
eq('polar summer returns null', C.sunsetLocalMinutes(2027, 6, 21, 78.22, 15.65, 'Arctic/Longyearbyen'), null);


// Starting timeline from questionnaire answers
const base = { look: 'firstlook', dad: 'no', robes: 'no', recSame: true, brideSame: true, groomSame: true, driveCer: 15, driveRec: 15 };
const gen = (a, m) => C.generateItems({ ...base, ...a }, { cocktail: 30, ...(m || {}) });
const day = (items, cerStart, cerLen, recEnd) => C.buildTimeline({ ceremonyStart: cerStart, ceremonyDuration: cerLen,
  items: items.map((it, i) => ({ ...it, order: i, endAt: it.type === 'handoff' ? recEnd : null })) });
const master = day(gen({}), hm(16, 30), 30, hm(21, 0));
eq('default answers reproduce the master template durations', master.map((b) => b.duration), [45, 20, 15, 15, 30, 15, 15, 20, 20, 20, 30, 20, 10, 30, 180]);
eq('master template starts at 12:55 PM with the 20 minute dress row', C.fmtTime(master[0].start), '12:55 PM');
eq('reception runs to the couple\'s reception end', [C.fmtTime(master[14].start), C.fmtTime(master[14].end)], ['6:00 PM', '9:00 PM']);
const late = day(gen({}), hm(18, 0), 30, hm(0, 30));
eq('reception end after midnight', [late[14].duration, C.fmtTime(late[14].end)], [300, '12:30 AM']);
const church = gen({ look: 'neither', dad: 'yes', robes: 'yes', recSame: false, brideSame: false, driveCer: 25, driveRec: 5 }, { cocktail: 0 });
eq('no first look, separate locations: rows', church.map((i) => i.id), ['details', 'robes', 'dress', 'dad', 'maids', 'drive_cer', 'hide', 'family', 'party', 'couple', 'drive_rec', 'reception']);
eq('drive minutes come from the answers; under 10 is raised to the minimum', [church[5].duration, church[10].duration], [25, 10]);
eq('first contact renames the hide row', gen({ look: 'contact' }).find((i) => i.id === 'hide').name, 'Bride & Groom Hide, First Contact');
eq('first look away from the venue drives before the first look', gen({ brideSame: false }).map((i) => i.id).slice(2, 4), ['drive_cer', 'firstlook']);
// Changes between versions
const v1 = master, items2 = gen({}); items2[4].duration = 20; const moved = items2.splice(8, 1)[0]; items2.splice(10, 0, moved); items2.splice(2, 1);
const v2 = day(items2, hm(16, 30), 30, hm(21, 0));
const ch = C.computeChanges(v1, v2);
eq('changes: retimed, moved, removed', [ch.byId.portraits.kind, ch.byId.family_pre.kind, ch.lines.includes('Walk to First Look removed')], ['Retimed', 'Moved', true]);
eq('no changes when nothing changed', C.computeChanges(v1, day(gen({}), hm(16, 30), 30, hm(21, 0))).lines, []);

console.log('Sample wedding sunset, Tampa 2027-03-20:', C.fmtTime(C.sunsetLocalMinutes(2027, 3, 20, ...TPA)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

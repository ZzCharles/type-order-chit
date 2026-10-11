/* The Pass — roster engine (v3.10.0, October 2026)

   Layer 1 of building the roster by voice (pluto-roster-spec.md, with the
   owner's decisions of 11 Oct in the box at its top). Plain code: no AI, no
   storage, no speech. It takes a week's roster and one change, checks it,
   and gives back the new week, exactly what changed and any warnings. It
   never changes the week it was given.

   The voice brain (layer 2) only turns words into these changes and says
   back what comes out of here; the page saves it and reads it back (commit).
   So what Pluto says is always what's stored, never what it thinks it did.

   A week is the app's own shape:
     { wed: { <staff id>: { start: 'HH:MM', end: '' | 'HH:MM', station: '' } }, thu: …, sun: … }
   - Times are 24-hour "HH:MM". end '' = until the work's done: finishes are
     only set when someone leaves early (owner, 11 Oct).
   - One shift per person per day: the shape can't hold two.
   - Wednesday to Sunday only; Monday and Tuesday the kitchen is closed.

   Also here, because they're rules rather than words: which week is being
   built, what a bare hour means, and the voice session (which day is done,
   skipped or next). Undo records come from apply(); the brain keeps them in
   The Pass's own undo list, so one Undo covers orders and the roster.

   Loaded by the page as window.RosterEngine, by Node with require(). */
(function(root, make){
  var api = make();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.RosterEngine = api;
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

var DAYS = ['wed', 'thu', 'fri', 'sat', 'sun'];
var CLOSE = '22:00';      // owner, 11 Oct: the kitchen closes at 10
var STATUSES = { pending: 1, done: 1, skipped: 1, closed: 1 };

/* ================= times ================= */

function isTime(t){ return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
function toMin(t){ return isTime(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : null; }
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function toTime(min){ return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }

/* A finish before the start is only allowed as an after-midnight one. */
var AFTER_MIDNIGHT = 5 * 60;
function endOk(start, end){
  if(!end) return true;
  var s = toMin(start), e = toMin(end);
  return e !== s && (e > s || e < AFTER_MIDNIGHT);
}

/* What a bare hour means ("Anil at 4"), owner, 11 Oct: "only Wednesday I
   start in the am, the rest is pm". For him on a Wednesday 6 to 11 is the
   morning; for everyone else, every day, it's the afternoon or evening. 12
   is always noon. One that lands at or after close is asked about, never
   guessed. who = { owner: true|false, day: 'wed' }.
   Returns { time: 'HH:MM' } or { ask: true }. */
function bareTime(hour, minute, who){
  hour = +hour; minute = +(minute || 0);
  if(!(hour >= 1 && hour <= 12) || !(minute >= 0 && minute <= 59)) return { ask: true };
  who = who || {};
  var h;
  if(hour === 12) h = 12;
  else if(who.owner && who.day === 'wed' && hour >= 6) h = hour;
  else h = hour + 12;
  var t = toTime(h * 60 + minute);
  return toMin(t) >= toMin(CLOSE) ? { ask: true, pm: t, am: toTime((hour % 12) * 60 + minute) } : { time: t };
}

/* ================= dates ================= */

function keyDate(k){ var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
function dateKey(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function addDays(k, n){ var d = keyDate(k); d.setDate(d.getDate() + n); return dateKey(d); }
function mondayOf(k){ var d = keyDate(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dateKey(d); }
var OFFSET = { wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
function dateOf(mon, day){ return addDays(mon, OFFSET[day]); }

/* The week "next week's roster" means, as its Monday. On Monday or Tuesday
   (closed) the coming Wednesday's week hasn't started, so it's that one;
   Wednesday to Sunday it's the week after. `today` is the service day. */
function buildWeekFor(today){
  var mon = mondayOf(today), dow = keyDate(today).getDay();
  return dow === 1 || dow === 2 ? mon : addDays(mon, 7);
}

/* ================= a week ================= */

function cleanShift(e){
  var out = {}, k;
  for(k in e) if(Object.prototype.hasOwnProperty.call(e, k)) out[k] = e[k];
  out.start = String(e.start || '');
  out.end = String(e.end || '');
  out.station = String(e.station || '');
  return out;
}
/* A copy of one day, people with a start only (the screen's "on"). */
function cloneDay(src){
  var out = {};
  src = src || {};
  Object.keys(src).forEach(function(id){ if(src[id] && src[id].start) out[id] = cleanShift(src[id]); });
  return out;
}
function cloneWeek(w){
  var out = {};
  DAYS.forEach(function(d){ out[d] = cloneDay(w && w[d]); });
  return out;
}
/* A day as a list, earliest start first. */
function dayList(w, day){
  var e = (w && w[day]) || {};
  return Object.keys(e).filter(function(id){ return e[id] && e[id].start; })
    .map(function(id){ return { id: id, start: e[id].start, end: e[id].end || '', station: e[id].station || '' }; })
    .sort(function(a, b){ return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
}
/* Same people at the same times. Stations rotate and are placeholders
   (owner, 11 Oct), so they only count when asked (undo checks them). */
function sameDay(a, b, withStation){
  var x = dayList({ d: a }, 'd'), y = dayList({ d: b }, 'd');
  if(x.length !== y.length) return false;
  for(var i = 0; i < x.length; i++){
    if(x[i].id !== y[i].id || x[i].start !== y[i].start || x[i].end !== y[i].end) return false;
    if(withStation && x[i].station !== y[i].station) return false;
  }
  return true;
}
/* Who was added, taken off or changed between two copies of a day. */
function diffDay(day, a, b){
  var out = [], ids = {};
  a = a || {}; b = b || {};
  Object.keys(a).concat(Object.keys(b)).forEach(function(id){ ids[id] = 1; });
  Object.keys(ids).sort().forEach(function(id){
    var x = a[id] && a[id].start ? a[id] : null, y = b[id] && b[id].start ? b[id] : null;
    if(!x && !y) return;
    if(!x) out.push({ day: day, id: id, kind: 'added', after: cleanShift(y) });
    else if(!y) out.push({ day: day, id: id, kind: 'removed', before: cleanShift(x) });
    else if(x.start !== y.start || (x.end || '') !== (y.end || '') || (x.station || '') !== (y.station || ''))
      out.push({ day: day, id: id, kind: 'changed', before: cleanShift(x), after: cleanShift(y) });
  });
  return out;
}
/* The days a person is on, in week order. */
function daysOn(w, id){ return DAYS.filter(function(d){ return !!(w && w[d] && w[d][id] && w[d][id].start); }); }

/* ================= changes ================= */

function fail(error, o){ var r = { ok: false, error: error }; for(var k in o || {}) r[k] = o[k]; return r; }
function staffOf(ctx, id){ return ((ctx && ctx.staff) || []).filter(function(s){ return s.id === id; })[0] || null; }

/* One change on a working copy. Returns null when it worked, or a failure.
   touched collects the days it changed. */
function step(w, op, ctx, touched){
  var day = op.day, d = DAYS.indexOf(day) > -1 ? w[day] : null;
  function needDay(){ return d ? null : fail('badDay', { day: day }); }
  function needStaff(id){ return staffOf(ctx, id) ? null : fail('noStaff', { id: id }); }
  function on(id){ return !!(d && d[id] && d[id].start); }
  var bad;
  switch(op.op){
    case 'add':
      if((bad = needDay() || needStaff(op.id))) return bad;
      if(on(op.id)) return fail('alreadyOn', { day: day, id: op.id, shift: cleanShift(d[op.id]) });
      if(!isTime(op.start) || (op.end && !isTime(op.end))) return fail('badTime', { day: day, id: op.id });
      if(!endOk(op.start, op.end)) return fail('endBeforeStart', { day: day, id: op.id });
      d[op.id] = { start: op.start, end: op.end || '', station: op.station || '' };
      touched[day] = 1; return null;
    case 'remove':
      if((bad = needDay())) return bad;
      if(!on(op.id)) return fail('notOn', { day: day, id: op.id });
      delete d[op.id];
      touched[day] = 1; return null;
    case 'replace':   // keeps the time, finish and station, unless a start is given
      if((bad = needDay() || needStaff(op.to))) return bad;
      if(op.from === op.to) return fail('sameStaff', { day: day, id: op.to });
      if(!on(op.from)) return fail('notOn', { day: day, id: op.from });
      if(on(op.to)) return fail('alreadyOn', { day: day, id: op.to, shift: cleanShift(d[op.to]) });
      if(op.start != null && !isTime(op.start)) return fail('badTime', { day: day, id: op.to });
      var moved = cleanShift(d[op.from]);
      if(op.start != null) moved.start = op.start;
      if(!endOk(moved.start, moved.end)) return fail('endBeforeStart', { day: day, id: op.to });
      delete d[op.from];
      d[op.to] = moved;
      touched[day] = 1; return null;
    case 'setTime':   // end '' = until the work's done
      if((bad = needDay())) return bad;
      if(!on(op.id)) return fail('notOn', { day: day, id: op.id });
      var s = cleanShift(d[op.id]);
      if(op.start != null){ if(!isTime(op.start)) return fail('badTime', { day: day, id: op.id }); s.start = op.start; }
      if(op.end != null){ if(op.end !== '' && !isTime(op.end)) return fail('badTime', { day: day, id: op.id }); s.end = op.end; }
      if(!endOk(s.start, s.end)) return fail('endBeforeStart', { day: day, id: op.id });
      d[op.id] = s;
      touched[day] = 1; return null;
    case 'station':
      if((bad = needDay())) return bad;
      if(!on(op.id)) return fail('notOn', { day: day, id: op.id });
      d[op.id] = cleanShift(d[op.id]); d[op.id].station = String(op.station || '');
      touched[day] = 1; return null;
    case 'shift':     // "everyone an hour later": a set finish moves too, unless part says otherwise
      var days = op.days || [day], who = op.id || 'all', mins = +op.minutes, part = op.part || 'both', any = false;
      if(!mins || mins % 1) return fail('badTime', {});
      if(who !== 'all' && (bad = needStaff(who))) return bad;
      for(var i = 0; i < days.length; i++){
        var dd = DAYS.indexOf(days[i]) > -1 ? w[days[i]] : null;
        if(!dd) return fail('badDay', { day: days[i] });
        var ids = who === 'all' ? Object.keys(dd) : (dd[who] ? [who] : []);
        for(var j = 0; j < ids.length; j++){
          var x = dd[ids[j]];
          if(!x || !x.start) continue;
          var y = cleanShift(x);
          if(part !== 'end'){
            var ns = toMin(y.start) + mins;
            if(ns < 0 || ns >= 24 * 60) return fail('outOfDay', { day: days[i], id: ids[j] });
            y.start = toTime(ns);
          }
          if(y.end && part !== 'start'){
            var ne = (toMin(y.end) + mins + 24 * 60) % (24 * 60);
            y.end = toTime(ne);
          }
          if(part === 'end' && !x.end) continue;   // nothing to move
          if(!endOk(y.start, y.end)) return fail('endBeforeStart', { day: days[i], id: ids[j] });
          dd[ids[j]] = y; touched[days[i]] = 1; any = true;
        }
      }
      if(!any) return who === 'all' ? fail('empty', { days: days }) : fail('notOn', { day: days.length === 1 ? days[0] : null, days: days, id: who });
      return null;
    case 'copy':      // the day becomes exactly op.from (last week's, or another day's)
      if((bad = needDay())) return bad;
      var src = cloneDay(op.from), gone = [];
      Object.keys(src).forEach(function(id){
        if(!staffOf(ctx, id)){ gone.push(id); delete src[id]; return; }
        if(!isTime(src[id].start) || (src[id].end && !isTime(src[id].end))) delete src[id];
      });
      w[day] = src;
      if(gone.length) (touched._gone = touched._gone || []).push({ day: day, ids: gone });
      touched[day] = 1; return null;
    case 'clear':
      if((bad = needDay())) return bad;
      w[day] = {};
      touched[day] = 1; return null;
    default:
      return fail('badOp', { op: op.op });
  }
}

/* Applies one change, or a { op: 'batch', ops: [...] } of several as one:
   all of it or none of it. The week given is never changed.
   ctx = { staff: [{ id, name, avail }], close: 'HH:MM' }.
   Success: { ok, week, days, changes, warnings, undo }. Nothing to do is
   still ok, with no changes and no undo. */
function apply(week, op, ctx){
  var w = cloneWeek(week), before = cloneWeek(week), touched = {};
  var ops = op && op.op === 'batch' ? (op.ops || []) : [op];
  if(!ops.length || !op) return fail('badOp', {});
  for(var i = 0; i < ops.length; i++){
    var bad = step(w, ops[i] || {}, ctx, touched);
    if(bad){ bad.at = i; return bad; }
  }
  var days = DAYS.filter(function(d){ return touched[d]; }), changes = [], undo = { days: {} };
  days.forEach(function(d){
    var ch = diffDay(d, before[d], w[d]);
    changes = changes.concat(ch);
    if(ch.length) undo.days[d] = { before: cloneDay(before[d]), after: cloneDay(w[d]) };
  });
  days = days.filter(function(d){ return undo.days[d]; });
  return { ok: true, week: w, days: days, changes: changes,
           warnings: warningsFor(w, changes, ctx, touched._gone),
           undo: days.length ? undo : null };
}

/* Tell, don't block (spec §5): a start at or after close, a day left with
   nobody on, someone on a day they don't usually work (a cover: it won't
   carry into the week after), and people from last week who aren't on the
   staff list any more. */
function warningsFor(w, changes, ctx, gone){
  var out = [], close = toMin((ctx && ctx.close) || CLOSE), emptied = {};
  changes.forEach(function(c){
    if(c.kind === 'removed' && !Object.keys(w[c.day]).length) emptied[c.day] = 1;
    if(c.kind === 'removed') return;
    if((c.kind === 'added' || c.before.start !== c.after.start) && toMin(c.after.start) >= close) out.push({ code: 'afterClose', day: c.day, id: c.id, start: c.after.start });
    var st = staffOf(ctx, c.id);
    if(c.kind === 'added' && st && st.avail && !st.avail[c.day]) out.push({ code: 'cover', day: c.day, id: c.id });
  });
  Object.keys(emptied).forEach(function(d){ out.push({ code: 'empty', day: d }); });
  (gone || []).forEach(function(g){ out.push({ code: 'gone', day: g.day, ids: g.ids }); });
  return out;
}

/* What "take X off all week" would touch, so it can be asked about first. */
function affects(week, op){
  if(op.op === 'removeAll') return daysOn(week, op.id);
  if(op.op === 'shift') return (op.days || []).filter(function(d){ return dayList(week, d).some(function(x){ return !op.id || op.id === 'all' || x.id === op.id; }); });
  return op.day ? [op.day] : [];
}
/* "take X off all week" as one change over every day X is on. */
function removeAll(week, id){
  return { op: 'batch', ops: daysOn(week, id).map(function(d){ return { op: 'remove', day: d, id: id }; }) };
}

/* Puts an undo record's days back, but only if they're still exactly as
   that change left them (another change, or the screen, may have moved on). */
function undo(week, rec){
  if(!rec || !rec.days || !Object.keys(rec.days).length) return fail('nothingToUndo', {});
  var w = cloneWeek(week), days = DAYS.filter(function(d){ return rec.days[d]; });
  var moved = days.filter(function(d){ return !sameDay(w[d], rec.days[d].after, true); });
  if(moved.length) return fail('changedSince', { days: moved });
  var changes = [];
  days.forEach(function(d){
    changes = changes.concat(diffDay(d, w[d], rec.days[d].before));
    w[d] = cloneDay(rec.days[d].before);
  });
  return { ok: true, week: w, days: days, changes: changes, warnings: [], undo: null };
}

/* ================= saving ================= */

/* Applies a change and has the page save it. save(days) gets only the
   changed days ({ thu: {...} }) and must return { ok, days } with those
   days as they now are in storage. Anything less, or a stored day that
   isn't what was meant, is a failure: Pluto must never say "done" for
   something that didn't happen (spec §3, test 14). */
function commit(week, op, ctx, save){
  var r = op && op.op === 'undo' ? undo(week, op.rec) : apply(week, op, ctx);
  if(!r.ok || !r.days.length) return r;
  var put = {};
  r.days.forEach(function(d){ put[d] = cloneDay(r.week[d]); });
  var back = null;
  try{ back = save(put); }catch(e){ back = null; }
  var stored = back && back.ok && back.days;
  if(!stored || r.days.some(function(d){ return !sameDay(stored[d], r.week[d], true); }))
    return fail('notSaved', { days: r.days, stored: stored ? cloneWeek(stored) : null });
  return r;
}

/* ================= the voice session =================
   Which week is being built, how, and where it's got to. It's kept in
   storage by the brain, so closing the app loses nothing ("let's continue
   the roster" picks it up). These all return a new session. */

function copyOf(s){ return JSON.parse(JSON.stringify(s)); }
function newSession(mon, mode, now){
  var days = {};
  DAYS.forEach(function(d){ days[d] = 'pending'; });
  return { v: 1, week: mon, mode: mode === 'copy' ? 'copy' : 'day', days: days, focus: 'wed', back: null,
           last: null, started: now || 0, at: now || 0, finished: false };
}
function setStatus(s, day, status){
  if(DAYS.indexOf(day) < 0 || !STATUSES[status]) return s;
  var o = copyOf(s); o.days[day] = status; return o;
}
/* The next day to do after `after`: a pending one later in the week, then
   one earlier that's still pending, then the skipped ones (they come back
   at the end). null when every day is done or closed. */
function nextDay(s, after){
  var i = DAYS.indexOf(after), order = DAYS.slice(i + 1).concat(DAYS.slice(0, i + 1));
  var p = order.filter(function(d){ return s.days[d] === 'pending'; })[0];
  if(p) return p;
  return DAYS.filter(function(d){ return s.days[d] === 'skipped'; })[0] || null;
}
function firstUnfinished(s){
  return DAYS.filter(function(d){ return s.days[d] === 'pending'; })[0] || DAYS.filter(function(d){ return s.days[d] === 'skipped'; })[0] || null;
}
/* Going to another day: remembers where it was, so it can offer to go back. */
function focusOn(s, day){
  var o = copyOf(s);
  if(DAYS.indexOf(day) < 0) return o;
  if(day !== o.focus) o.back = o.days[o.focus] === 'pending' || o.days[o.focus] === 'skipped' ? o.focus : null;
  o.focus = day;
  return o;
}

return {
  DAYS: DAYS, CLOSE: CLOSE,
  isTime: isTime, toMin: toMin, toTime: toTime, bareTime: bareTime,
  addDays: addDays, mondayOf: mondayOf, dateOf: dateOf, buildWeekFor: buildWeekFor,
  cloneDay: cloneDay, cloneWeek: cloneWeek, dayList: dayList, sameDay: sameDay, diffDay: diffDay, daysOn: daysOn,
  apply: apply, affects: affects, removeAll: removeAll, undo: undo, commit: commit,
  newSession: newSession, setStatus: setStatus, nextDay: nextDay, firstUnfinished: firstUnfinished,
  focusOn: focusOn
};
});

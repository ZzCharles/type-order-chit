/* The Pass — voice (v3.9.0, 9 October 2026)

   The mic, the small card, and the wiring between the brain
   (voice-brain.js) and the app — through the same functions the buttons
   use, so voice and taps can never disagree.

   Owner's choices (9 October 2026):
   - the mic sits bottom right on every screen except where you type
   - answers are spoken, and shown in one small card above the mic
     (Siri-like): what it heard in faint text, the answer, Undo, and tap
     buttons for any question
   - after an answer it listens 5 more seconds for a follow-up; "thank you"
     closes with "No worries."
   - a heard log (last 50 tries, Copy) for finding mishearings

   v3.9.1 (10 October 2026): a Voice screen, from Home or the card's
   "Heard log" link (owner's choices, from mock-ups): the on/off switch,
   how long it keeps listening after an answer, the words it has learned
   (forget, or teach one by hand: type it or say it), and the heard log
   with Copy, Share, Clear and a Teach button on each line.

   No AI. Chrome turns speech into words (Google hears it; the first tap
   says so). Everything after that happens on this phone. Only one-shot
   timers. If this file or the brain fails to load, The Pass works exactly
   as it did. */
(function(){
'use strict';
if(typeof window === 'undefined' || typeof AlmoVoice === 'undefined' || typeof state === 'undefined') return;

var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
var K_SEEN = 'order-chit-voice-seen', K_LOG = 'order-chit-voice-log', K_SET = 'order-chit-voice-set';
var ANSWER_MS = 8000, HIDE_MS = 10000, LOG_MAX = 50;
var FOLLOW_CHOICES = [0, 3, 5, 8];        // seconds it keeps listening after an answer
var NO_MIC = EDIT_VIEWS.concat(['prepAdd', 'ticket']);

/* ---------- the host: the brain's only way into the app ---------- */
function readJSON(k){ try{ var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
function writeJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
/* the Voice screen's settings: on unless switched off, 5 s follow-up */
function settings(){
  var s = readJSON(K_SET) || {};
  return { on: s.on !== false, follow: FOLLOW_CHOICES.indexOf(s.follow) > -1 ? s.follow : 5 };
}
function saveSettings(ch){ writeJSON(K_SET, Object.assign(settings(), ch)); }
/* Another tab may have changed the orders: storage is the truth (contract 8).
   v3.9.2: through the page's own reader, so its save check knows this list
   is the latest (otherwise a voice change could be refused as stale). */
function freshSuppliers(){
  if(typeof refreshSuppliersFromStorage === 'function'){ refreshSuppliersFromStorage(); return; }
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw && raw !== JSON.stringify(state.suppliers)) state.suppliers = JSON.parse(raw);
  }catch(e){}
}
var host = {
  version: APP_VERSION,
  me: 'Rabindra',
  now: function(){ return Date.now(); },
  data: function(){
    return { suppliers: state.suppliers, prepCatalogue: buildPrepCatalogue(), prepLines: state.prepLines || [], prepSections: state.recipeSections || [] };
  },
  refresh: async function(){ freshSuppliers(); await fetchPublished(); },
  setQty: function(list){
    list.forEach(function(c){ var hit = lookupProduct(c.pid); if(hit) hit.product.qty = c.qty; });
    saveData(); bgRender();
  },
  lastOrder: function(sid){ return getLastOrder(sid); },
  sentToday: function(sid){ return sentToday(sid); },
  addPrep: async function(lines){
    var before = (state.prepLines || []).length;
    var ok = await addPrepLines(lines);
    if(!ok) return { ok: false };
    bgRender();
    return { ok: true, ids: state.prepLines.slice(before).map(function(l){ return l.id; }) };
  },
  removePrep: async function(id){
    await removePrepLine(id);
    return !(state.prepLines || []).some(function(l){ return l.id === id; });
  },
  tickPrep: async function(id, done){
    await tickPrepLine(id, done);
    var l = (state.prepLines || []).find(function(x){ return x.id === id; });
    return !!l && l.done === done;
  },
  clearDonePrep: async function(ids){ return clearDonePrepLines(ids); },
  /* v3.9.6: his timesheet, and this week's rostered start times, read fresh
     from storage first (another copy of The Pass may have changed them) */
  timesheet: function(){
    if(typeof refreshTimesheetFromStorage === 'function') refreshTimesheetFromStorage();
    if(typeof refreshRosterFromStorage === 'function') refreshRosterFromStorage();
    var rid = rabindraId(), days = {}, rostered = {};
    ROSTER_DAY_KEYS.forEach(function(d){
      var e = (state.timesheet && state.timesheet[d]) || {};
      days[d] = { start: e.start || '', end: e.end || '', date: e.date || '' };
      var r = rid && state.roster && state.roster[d] && state.roster[d][rid];
      if(r && r.start) rostered[d] = r.start;
    });
    return { days: days, rostered: rostered, week: weekStartKey() };
  },
  setTimesheetDay: function(day, v){
    if(ROSTER_DAY_KEYS.indexOf(day) < 0) return false;
    if(typeof refreshTimesheetFromStorage === 'function') refreshTimesheetFromStorage();
    setTsDay(day, { start: v.start || '', end: v.end || '', date: v.date || '' });
    bgRender();
    var e = state.timesheet[day] || {};
    return e.start === (v.start || '') && e.end === (v.end || '');
  },
  open: function(v){
    if(!v || isEditing()) return;
    if(v.view === 'supplier') goto({ name: 'supplier', id: v.id });
    else if(v.view === 'ticket') goto({ name: 'ticket', id: v.id });
    else if(v.view === 'prep') goto({ name: 'prep' });
    else if(v.view === 'list') goto({ name: 'list' });
    else if(v.view === 'timesheet') goto({ name: 'timesheet' });
  },
  get: readJSON,
  set: writeJSON,
  wordsChanged: function(){ if(state.view.name === 'voice') bgRender(); }
};
var room = AlmoVoice.createRoom(host);

/* ---------- speech: the swap point ----------
   Every bit of speech, in and out, goes through these few functions (the
   RK Trips pattern), so the Pluto app can later put its own ears and mouth
   behind them without touching the rest. */
var voices = [], ttsJob = 0, ttsBusy = false, srNow = null;
function loadVoices(){ try{ voices = speechSynthesis.getVoices() || []; }catch(e){ voices = []; } }
if(hasTTS){ loadVoices(); try{ speechSynthesis.addEventListener('voiceschanged', loadVoices); }catch(e){} }
function pickVoice(){
  var by = function(l){ return voices.filter(function(v){ return String(v.lang || '').replace('_', '-').toLowerCase() === l; })[0]; };
  return by('en-au') || by('en-gb') || null;
}
/* how the words should sound, not how they look */
function toSpeech(t){
  return String(t || '').replace(/&/g, ' and ').replace(/·/g, ',')
    .replace(/\b0\.5 kilos\b/g, 'half a kilo').replace(/\b0\.5 litres\b/g, 'half a litre')
    .replace(/\bkg\b/g, 'kilos');
}
function speak(list, done){
  stopSpeaking();
  list = (list || []).filter(Boolean);
  if(!hasTTS || !list.length){ if(done) done(); return; }
  var job = ttsJob, i = 0;
  ttsBusy = true;
  function next(){
    if(job !== ttsJob) return;
    if(i >= list.length){ ttsBusy = false; if(done) done(); return; }
    var text = list[i++], fin = false;
    var u = new SpeechSynthesisUtterance(toSpeech(text));
    var v = pickVoice(); if(v){ u.voice = v; u.lang = v.lang; } else u.lang = 'en-AU';
    // Android doesn't always say when it has finished: a one-shot watchdog
    var wd = setTimeout(function(){ if(!fin){ fin = true; next(); } }, text.length * 75 + 3000);
    u.onend = u.onerror = function(){ if(fin) return; fin = true; clearTimeout(wd); next(); };
    try{ speechSynthesis.speak(u); }catch(e){ fin = true; clearTimeout(wd); next(); }
  }
  next();
}
function stopSpeaking(){ ttsJob++; ttsBusy = false; if(hasTTS){ try{ speechSynthesis.cancel(); }catch(e){} } }
function speakingNow(){ return !!(hasTTS && (ttsBusy || speechSynthesis.speaking)); }
/* Opens the mic once. on.words(text) while talking; on.end(alts, err)
   when it closes: alts is the listener's guesses, best first, or null. */
function listen(on){
  if(!SR) return 'not-supported';
  if(srNow) return 'busy';
  var r;
  try{ r = new SR(); }catch(e){ return 'start-failed'; }
  r.lang = 'en-AU'; r.interimResults = true; r.maxAlternatives = 5; r.continuous = false;
  var alts = null, err = '';
  r.onspeechstart = function(){ if(on.speech) on.speech(); };
  r.onresult = function(e){
    if(on.speech) on.speech();
    for(var i = e.resultIndex; i < e.results.length; i++){
      var res = e.results[i];
      if(res.isFinal){ alts = []; for(var j = 0; j < res.length; j++) alts.push({ s: res[j].transcript, c: res[j].confidence }); }
      else if(on.words) on.words(res[0].transcript);
    }
  };
  r.onerror = function(e){ err = e.error || 'error'; };
  r.onend = function(){
    if(srNow === r) srNow = null;
    on.end(alts && alts.some(function(a){ return String(a.s || '').trim(); }) ? alts : null, err);
  };
  srNow = r;
  try{ r.start(); }catch(e){ srNow = null; return 'start-failed'; }
  return '';
}
function stopListening(){ if(srNow){ try{ srNow.stop(); }catch(e){} } }
function cancelListening(){ if(srNow){ try{ srNow.abort(); }catch(e){} } }
function listeningNow(){ return !!srNow; }

/* ---------- the conversation ---------- */
var open = false, phase = '', purposeNow = '', view = 'talk';
var cur = null;                 // what the card shows
var waitAsk = null, waitConfirm = null, confirmTries = 0;
var lid = 0, hideT = 0, live = '';
var ERRS = { 'not-allowed': 'The mic is blocked for this site. Allow it in Chrome’s settings.', 'service-not-allowed': 'The mic is blocked for this site.',
  network: 'No connection, so I can’t listen right now.', 'audio-capture': 'No microphone found.', 'start-failed': 'The mic didn’t start. Tap it again.',
  'not-supported': 'This browser can’t listen. Use Chrome.' };

function micTap(){
  if(!open){ openCard(); if(!readJSON(K_SEEN)){ view = 'notice'; paint(); return; } vListen(waitAsk || waitConfirm ? 'answer' : 'ask'); return; }
  if(view === 'notice'){ gotIt(); return; }
  view = 'talk';
  if(listeningNow()){ stopListening(); return; }
  if(speakingNow()) stopSpeaking();
  vListen(waitAsk || waitConfirm ? 'answer' : 'ask');
}
function gotIt(){ writeJSON(K_SEEN, 1); view = 'talk'; vListen('ask'); }
function openCard(){ open = true; clearTimeout(hideT); paint(); }
/* keepTalking: a screen change hides the card but lets the last sentence finish */
function closeCard(keepTalking){
  open = false; lid++; clearTimeout(hideT);
  cancelListening(); if(keepTalking !== true) stopSpeaking();
  waitAsk = null; waitConfirm = null; cur = null; phase = ''; view = 'talk';
  room.reset();                 // the conversation is over: forget "it"
  paint();
}
function scheduleHide(){
  clearTimeout(hideT);
  if(waitAsk || waitConfirm || view !== 'talk') return;
  hideT = setTimeout(function(){ if(!listeningNow() && !speakingNow() && !waitAsk && !waitConfirm && view === 'talk') closeCard(); }, HIDE_MS);
}

function vListen(purpose){
  if(!open || listeningNow()) return;
  stopSpeaking(); clearTimeout(hideT);
  var my = ++lid, heardAny = false, t = 0;
  var wait = purpose === 'follow' ? settings().follow * 1000 : purpose === 'answer' ? ANSWER_MS : 0;
  var why = listen({
    speech: function(){ if(!heardAny){ heardAny = true; clearTimeout(t); } },
    words: function(w){ if(my === lid){ live = w; paint(); } },
    end: function(alts, err){
      if(my !== lid) return;
      clearTimeout(t); phase = ''; live = '';
      if(alts){ heard(alts, purpose); return; }
      if(purpose === 'ask' && err !== 'aborted') cur = { note: ERRS[err] || 'I didn’t hear anything. Tap the mic to try again.' };
      else if(purpose === 'answer' && err && ERRS[err]) cur = Object.assign({}, cur, { note: ERRS[err] });
      paint(); scheduleHide();
    }
  });
  if(why){ phase = ''; cur = { note: ERRS[why] || 'The mic didn’t start.' }; paint(); return; }
  phase = 'listening'; purposeNow = purpose; live = '';
  // nobody starts talking in time: the mic closes (a one-shot)
  if(wait) t = setTimeout(function(){ if(!heardAny && my === lid) cancelListening(); }, wait);
  paint();
}

var STOP_WORDS = /^(cancel|never mind|nevermind|forget it|stop|no|nah|leave it)$/;
async function heard(alts, purpose){
  var text = String(alts[0].s || '').trim();
  var others = alts.slice(1).map(function(a){ return a.s; });
  var entry = { at: Date.now(), heard: text, alts: others, via: purpose };
  // a confirmation waiting: only a plain yes counts (Pluto's yes rules)
  if(waitConfirm){
    var yn = AlmoVoice.yesNo(text);
    if(yn === 'yes') return doConfirm(true, entry);
    if(yn === 'no' || AlmoVoice.isClose(text)) return doConfirm(false, entry);
    if(!confirmTries){
      confirmTries++; logIt(entry, { status: 'asked again', say: ['Sorry, was that a yes?'] });
      cur = Object.assign({}, cur, { heard: text, note: 'Sorry, was that a yes?' }); paint();
      speak(['Sorry, was that a yes?'], function(){ vListen('answer'); });
      return;
    }
    return doConfirm(false, entry);
  }
  if(waitAsk && STOP_WORDS.test(AlmoVoice.clean(text)) && !waitAsk.options.some(function(o){ return o.value === 'no' || o.value === 'none'; })){
    waitAsk = null; room.reset(); logIt(entry, { status: 'cancelled' });
    return present({ status: 'answer', say: ['Cancelled.'] }, text, true);
  }
  if(!waitAsk && AlmoVoice.isClose(text)){
    logIt(entry, { status: 'close', say: ['No worries.'] });
    cur = { heard: text, say: ['No worries.'] }; paint();
    speak(['No worries.'], closeCard);
    return;
  }
  await ask({ v: 1, id: 'r-' + Date.now(), text: text, alts: others, followUp: purpose === 'follow', reply: waitAsk ? { to: waitAsk.id } : null,
              woke: false, locked: false, now: Date.now(), mode: 'tab' }, entry, true);
}
async function ask(req, entry, byVoice){
  var before = cur;
  phase = 'thinking'; cur = { heard: entry.heard }; waitAsk = null; paint();
  var a;
  try{ a = await room.handle(req); }catch(e){ a = { status: 'error', say: ['I couldn’t check the list.'] }; }
  /* v3.9.3: talk while it listens for a follow-up isn't for The Pass (the
     brain says "chatter"): kept in the heard log, the answer stays on the
     card, nothing is said, and it listens again, as RK Trips does */
  if(a && a.status === 'notmine' && a.log === 'chatter'){
    logIt(entry, { status: 'ignored', say: [], log: 'chatter, while listening for a follow-up' });
    phase = ''; cur = before; paint();
    if(open) vListen('follow'); else scheduleHide();
    return;
  }
  logIt(entry, a);
  present(a, entry.heard, byVoice);
}
async function doConfirm(yes, entry){
  var c = waitConfirm; waitConfirm = null;
  if(!c) return;
  phase = 'thinking'; paint();
  var a = await room.confirm(c.token, yes);
  if(!yes || (a.status === 'answer' && !(a.say || []).length)) a = { status: 'answer', say: ['Cancelled.'] };
  logIt(entry, a);
  present(a, entry.heard, entry.via !== 'tap');
}
function present(a, heardText, byVoice){
  phase = '';
  waitAsk = a.status === 'ask' ? a.ask : null;
  waitConfirm = a.status === 'confirm' ? a.confirm : null;
  confirmTries = 0;
  var say = (a.say || []).slice();
  if(a.status === 'notmine') say = ['Sorry, I can only help with orders, the prep list and your timesheet.'];
  if(a.status === 'confirm') say = a.confirm.readBack.concat([a.confirm.question]);
  cur = { heard: heardText, say: say, show: a.show || null, action: a.action && a.action.undo ? a.action : null,
          ask: waitAsk, confirm: waitConfirm, status: a.status };
  paint();
  var spoken = say.slice();
  if(a.status === 'confirm') spoken.push('Yes or no?');
  speak(spoken, function(){
    if(!open) return;
    if(waitAsk || waitConfirm){ vListen('answer'); return; }
    if(byVoice && a.status !== 'error' && settings().follow) vListen('follow');
    else scheduleHide();
  });
  scheduleHide();
}
async function tapOption(value, label){
  if(!waitAsk) return;
  cancelListening(); stopSpeaking();
  var id = waitAsk.id;
  await ask({ v: 1, id: 'r-' + Date.now(), text: '', alts: [], followUp: true, reply: { to: id, choice: value }, now: Date.now(), mode: 'tab' },
            { at: Date.now(), heard: label, alts: [], via: 'tap' }, false);
}
async function tapUndo(){
  if(!cur || !cur.action) return;
  cancelListening(); stopSpeaking();
  var id = cur.action.id;
  cur.action = null; phase = 'thinking'; paint();
  var a = await room.undo(id);
  logIt({ at: Date.now(), heard: 'Undo', alts: [], via: 'tap' }, a);
  present(a, 'Undo', false);
}

/* ---------- the heard log: how mishearings get found ---------- */
function logIt(entry, a){
  var l = readJSON(K_LOG);
  if(!Array.isArray(l)) l = [];
  l.push({ at: entry.at, heard: entry.heard, alts: (entry.alts || []).slice(0, 4), via: entry.via,
           status: a.status, said: (a.say || []).concat(a.confirm ? a.confirm.readBack : []).join(' ').slice(0, 300), log: a.log || '' });
  writeJSON(K_LOG, l.slice(-LOG_MAX));
}
function logList(){ var l = readJSON(K_LOG); return Array.isArray(l) ? l : []; }
function logText(){
  var s = settings();
  var words = room.words();
  return 'The Pass ' + APP_VERSION + ' heard log\n'
    + 'Voice ' + (s.on ? 'on' : 'off') + ' · keeps listening ' + (s.follow ? s.follow + ' s' : 'off') + ' after an answer\n'
    + logList().map(function(x){
      return new Date(x.at).toLocaleString('en-AU') + ' | ' + (x.via || '') + ' | "' + x.heard + '"'
        + (x.alts && x.alts.length ? ' (or ' + x.alts.map(function(s){ return '"' + s + '"'; }).join(', ') + ')' : '')
        + ' -> ' + x.status + (x.said ? ': ' + x.said : '') + (x.log ? ' [' + x.log + ']' : '');
    }).join('\n')
    + (words.length ? '\n\nLearned words:\n' + words.map(function(w){
      return '  "' + w.said + '" (' + w.key + ') = ' + (w.name ? w.name + ' · ' + w.where : 'gone from the lists') + ' [' + w.id + ']';
    }).join('\n') : '');
}
/* done(true) when it reached the clipboard */
function copyText(text, done){
  function fallback(){
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try{ ok = document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta); done(ok);
  }
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ done(true); }, fallback);
  else fallback();
}

/* ---------- the card and the mic ---------- */
var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>';
var css = ''
  + '.vmic{position:fixed;right:max(16px,calc(50vw - 214px));bottom:calc(18px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:50%;border:none;background:var(--ink);color:#fff;box-shadow:0 6px 18px rgba(38,35,25,.25);display:flex;align-items:center;justify-content:center;z-index:60;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent;}'
  + '.vmic svg{width:24px;height:24px;}'
  + '.vmic[hidden]{display:none;}'
  + '.vmic.listening{background:var(--stamp);animation:vpulse 1.4s ease-in-out infinite;}'
  + '.vmic.thinking{opacity:.75;}'
  + '@keyframes vpulse{0%,100%{box-shadow:0 0 0 0 rgba(165,55,47,.45);}50%{box-shadow:0 0 0 12px rgba(165,55,47,0);}}'
  + '@media (prefers-reduced-motion: reduce){.vmic.listening{animation:none;}}'
  + 'body.vmic-on #app{padding-bottom:96px;}'
  + '.vcard{position:fixed;left:max(16px,calc(50vw - 214px));right:max(16px,calc(50vw - 214px));bottom:calc(86px + env(safe-area-inset-bottom));background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(38,35,25,.06),0 12px 32px rgba(38,35,25,.16);padding:12px 14px;z-index:59;max-height:62vh;overflow:auto;font-size:14px;line-height:1.4;color:var(--ink);}'
  + '.vcard[hidden]{display:none;}'
  + '.vc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px;}'
  + '.vc-status{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);}'
  + '.vc-status.on{color:var(--stamp);}'
  + '.vc-x{background:none;border:none;color:var(--muted);font-size:20px;line-height:1;padding:0 2px;cursor:pointer;font-family:inherit;}'
  + '.vc-heard{color:var(--muted);font-size:13px;margin-top:2px;}'
  + '.vc-say{font-size:15px;font-weight:600;margin-top:4px;}'
  + '.vc-say p{margin:0 0 4px;}'
  + '.vc-note{color:var(--muted);font-size:13px;margin-top:6px;}'
  + '.vc-lines{margin-top:8px;border-top:1px solid var(--line);padding-top:8px;display:flex;align-items:flex-start;gap:10px;}'
  + '.vc-lines ul{list-style:none;margin:0;padding:0;flex:1;min-width:0;font-size:13px;}'
  + '.vc-lines li{padding:1px 0;}'
  + '.vc-lines li.muted{color:var(--muted);text-decoration:line-through;}'
  + '.vc-btn{border:none;border-radius:999px;background:#EDEBDF;color:var(--ink);font-family:inherit;font-weight:700;font-size:12px;padding:8px 14px;cursor:pointer;}'
  + '.vc-btn:active{background:#E3E0D2;}'
  + '.vc-btn.dark{background:var(--ink);color:#fff;}'
  + '.vc-btn.yes{background:var(--ink);color:#fff;min-width:88px;font-size:14px;padding:11px 18px;}'
  + '.vc-btn.no{min-width:88px;font-size:14px;padding:11px 18px;}'
  + '.vc-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}'
  + '.vc-foot{display:flex;justify-content:flex-end;margin-top:8px;}'
  + '.vc-link{background:none;border:none;color:var(--muted);font-family:inherit;font-size:11px;text-decoration:underline;cursor:pointer;padding:2px 0;}'
  /* the Voice screen (v3.9.1) */
  + '.vs-box{margin-bottom:12px;}'
  + '.vs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}'
  + '.vs-title{font-size:16px;font-weight:800;color:var(--ink);}'
  + '.vs-note{font-size:12.5px;color:var(--muted);line-height:1.45;margin:6px 0 0;}'
  + '.vs-good{font-size:13px;color:var(--ink);font-weight:600;line-height:1.45;margin:8px 0 0;}'
  + '.vs-sub{font-size:12.5px;font-weight:700;color:var(--ink);margin-top:16px;}'
  + '.vs-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
  + '.vs-list{margin-top:6px;}'
  + '.vs-word{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:1.35;}'
  + '.vs-word b{font-weight:700;}'
  + '.vs-where{color:var(--muted);font-size:12px;white-space:nowrap;}'
  + '.vs-x{background:none;border:none;color:var(--muted);font-size:17px;line-height:1;padding:6px 4px 6px 10px;cursor:pointer;font-family:inherit;flex:0 0 auto;}'
  + '.vs-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}'
  + '.vs-log{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);}'
  + '.vs-log:last-child{border-bottom:none;}'
  + '.vs-log-main{flex:1;min-width:0;}'
  + '.vs-when{font-size:11px;color:var(--muted);}'
  + '.vs-heard{font-size:14px;font-weight:700;color:var(--ink);margin-top:1px;overflow-wrap:anywhere;}'
  + '.vs-said{font-size:12.5px;color:var(--ink-soft);margin-top:2px;overflow-wrap:anywhere;line-height:1.4;}'
  + '.vs-more{background:none;border:none;color:var(--stamp);font-family:inherit;font-size:12.5px;font-weight:700;padding:10px 0 0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}'
  + '.vt-say{display:flex;align-items:center;gap:8px;}'
  + '.vt-say input{flex:1;min-width:0;}'
  + '.vt-mic{width:42px;height:42px;border-radius:50%;border:none;background:var(--ink);color:#fff;flex:0 0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}'
  + '.vt-mic svg{width:19px;height:19px;}'
  + '.vt-mic.on{background:var(--stamp);animation:vpulse 1.4s ease-in-out infinite;}'
  + '@media (prefers-reduced-motion: reduce){.vt-mic.on{animation:none;}}'
  + '.vt-list{margin-top:6px;}'
  + '.vt-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--line);padding:11px 2px;font-family:inherit;font-size:14px;color:var(--ink);cursor:pointer;}'
  + '.vt-item span.vt-name{flex:1;min-width:0;}'
  + '.vt-dot{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--muted);flex:0 0 auto;box-sizing:border-box;}'
  + '.vt-item.on .vt-dot{border:5px solid var(--stamp);}'
  + '.vt-item.on .vt-name{font-weight:700;}'
  + '.vt-msg{font-size:13px;line-height:1.45;margin-top:12px;color:var(--ink);}'
  + '.vt-msg.warn{color:var(--stamp);}'
  + '.vt-msg:empty{display:none;}'
  + '#vt-save:disabled{opacity:.4;cursor:default;}';

var micEl, cardEl;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function build(){
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  cardEl = document.createElement('div'); cardEl.className = 'vcard'; cardEl.hidden = true;
  cardEl.setAttribute('role', 'status'); cardEl.setAttribute('aria-live', 'polite');
  micEl = document.createElement('button'); micEl.className = 'vmic'; micEl.type = 'button'; micEl.innerHTML = MIC; micEl.hidden = true;
  micEl.setAttribute('aria-label', 'Talk to The Pass');
  micEl.addEventListener('click', micTap);
  cardEl.addEventListener('click', onCardClick);
  document.body.appendChild(cardEl); document.body.appendChild(micEl);
}
function onCardClick(e){
  var b = e.target.closest('[data-v]'); if(!b) return;
  var v = b.getAttribute('data-v');
  if(v === 'close') closeCard(false);
  else if(v === 'gotit') gotIt();
  else if(v === 'opt') tapOption(b.getAttribute('data-val'), b.textContent);
  else if(v === 'yes' || v === 'no'){ cancelListening(); stopSpeaking(); doConfirm(v === 'yes', { at: Date.now(), heard: v === 'yes' ? 'Yes' : 'No', alts: [], via: 'tap' }); }
  else if(v === 'undo') tapUndo();
  // v3.9.1: the log and the learned words live on the Voice screen now
  else if(v === 'log'){ closeCard(false); if(state.view.name !== 'voice') goto({ name: 'voice' }); }
}
function statusText(){
  if(phase === 'listening') return purposeNow === 'follow' ? 'Anything else?' : purposeNow === 'answer' ? 'Listening for your answer…' : 'Listening…';
  if(phase === 'thinking') return 'Checking the list…';
  return '';
}
function paint(){
  if(!micEl) return;
  micEl.className = 'vmic' + (phase === 'listening' ? ' listening' : phase === 'thinking' ? ' thinking' : '');
  micEl.setAttribute('aria-label', phase === 'listening' ? 'Stop listening' : 'Talk to The Pass');
  cardEl.hidden = !open;
  if(!open) return;
  var h = '<div class="vc-top"><span class="vc-status' + (phase === 'listening' ? ' on' : '') + '">' + esc(statusText()) + '</span>'
    + '<button class="vc-x" data-v="close" aria-label="Close">&times;</button></div>';
  if(view === 'notice'){
    h += '<div class="vc-say"><p>Talk to The Pass</p></div>'
      + '<div class="vc-note">Tap the mic and say things like “add 2 kilos of mozzarella”, “take the speck off”, “pizza sauce is done” or “what’s on the Aziz order”. Say “thank you” to finish.</div>'
      + '<div class="vc-note">Chrome turns your voice into words, so Google hears it. Everything else happens on this phone. Sending always stops at the Review Order screen for you to tap.</div>'
      + '<div class="vc-opts"><button class="vc-btn dark" data-v="gotit">Got it, start listening</button></div>';
    cardEl.innerHTML = h; return;
  }
  var c = cur || {};
  var heardLine = phase === 'listening' ? live : c.heard;
  if(heardLine) h += '<div class="vc-heard">“' + esc(heardLine) + '”</div>';
  if(c.say && c.say.length) h += '<div class="vc-say">' + c.say.map(function(s){ return '<p>' + esc(s) + '</p>'; }).join('') + '</div>';
  if(c.note) h += '<div class="vc-note">' + esc(c.note) + '</div>';
  if(!c.say && !c.note && !heardLine && phase !== 'thinking') h += '<div class="vc-note">Say something like “add 2 kilos of mozzarella”.</div>';
  var lines = c.show && c.show.lines && c.show.lines.length && (c.status === 'done' || c.status === 'answer') ? c.show.lines : [];
  if(lines.length || c.action){
    h += '<div class="vc-lines"><ul>' + lines.map(function(x){ return '<li' + (x.tone === 'muted' ? ' class="muted"' : '') + '>' + esc(x.text) + '</li>'; }).join('') + '</ul>'
      + (c.action ? '<button class="vc-btn" data-v="undo">Undo</button>' : '') + '</div>';
  }
  if(c.ask && c.ask.options && c.ask.options.length){
    h += '<div class="vc-opts">' + c.ask.options.map(function(o){ return '<button class="vc-btn' + (o.value === 'none' || o.value === 'no' ? '' : ' dark') + '" data-v="opt" data-val="' + esc(o.value) + '">' + esc(o.label) + '</button>'; }).join('') + '</div>';
  }
  if(c.confirm) h += '<div class="vc-opts"><button class="vc-btn yes" data-v="yes">Yes</button><button class="vc-btn no" data-v="no">No</button></div>';
  h += '<div class="vc-foot"><button class="vc-link" data-v="log">Heard log</button></div>';
  cardEl.innerHTML = h;
}

/* ---------- the Voice screen (v3.9.1) ----------
   Two of the app's screens, drawn here so a fault in voice can never stop
   The Pass: "voice" (from Home, or the card's "Heard log" link) and
   "voiceTeach" (a typing screen: it's in EDIT_VIEWS, so a background
   refresh never redraws it under his fingers). */
var STATUS_WORDS = { done: 'Done', answer: 'Answered', ask: 'Asked', confirm: 'Asked for a yes', cant: 'Couldn’t', notmine: 'Not for The Pass',
  close: 'Closed', error: 'Went wrong', cancelled: 'Cancelled', 'asked again': 'Asked again' };
var LOG_FEW = 5;
var vsAll = false, vsClearArm = false, vsMsg = '', vsGood = '';
var draft = { word: '', find: '', pick: '', note: '' }, teachPushed = false, teachEar = 0, teachHearing = false, choiceCache = null;
var lastView = '';

function when(at){
  var d = new Date(at), t = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + t;
}
function vsNote(t){ return '<p class="vs-note">' + t + '</p>'; }
function quote(s){ return '“' + s + '”'; }

function voicePage(){
  var s = settings(), h = '<div class="crumb"><button data-goto="home">&larr; Home</button> / Voice</div>';
  // the switch, and how long it keeps listening
  h += '<div class="form-card vs-box"><div class="vs-row"><div class="vs-title">Talk to The Pass</div>';
  if(SR) h += '<label class="switch"><input type="checkbox" data-vs-on' + (s.on ? ' checked' : '') + '><span class="switch-track"><span class="switch-knob"></span></span>'
    + '<span class="switch-label">' + (s.on ? 'On' : 'Off') + '</span></label>';
  h += '</div>';
  if(!SR) h += vsNote('This browser can’t listen, so there’s no mic. Chrome on Android can.');
  else if(!s.on) h += vsNote('Off: the mic is hidden. Switch it on to talk to The Pass.');
  else {
    h += vsNote('The mic is in the bottom corner. Tap it and say things like “add 2 kilos of mozzarella”. Chrome turns your voice into words, so Google hears it. Everything else stays on this phone.')
      + '<div class="vs-sub">Keep listening after an answer</div><div class="vs-chips">'
      + FOLLOW_CHOICES.map(function(n){ return '<button class="filter-chip' + (s.follow === n ? ' on' : '') + '" data-vs="follow" data-n="' + n + '">' + (n ? n + ' s' : 'Off') + '</button>'; }).join('')
      + '</div>' + vsNote('So you can say the next thing without tapping the mic.');
  }
  h += '</div>';
  // the words it has learned
  var words = room.words();
  h += '<div class="form-card vs-box"><div class="vs-title">Words it has learned</div>';
  if(vsGood) h += '<p class="vs-good">' + esc(vsGood) + '</p>';
  h += words.length ? '<div class="vs-list">' + words.map(function(w){
      return '<div class="vs-word"><span><b>' + esc(quote(w.said)) + '</b> &rarr; '
        + (w.name ? esc(w.name) + ' <span class="vs-where">· ' + esc(w.where) + '</span>' : '<span class="vs-where">gone from the lists</span>') + '</span>'
        + '<button class="vs-x" data-vs="forget" data-key="' + esc(w.key) + '" data-said="' + esc(w.said) + '" aria-label="Forget ' + esc(w.said) + '">&#x2715;</button></div>';
    }).join('') + '</div>'
    : vsNote('None yet. Teach one here, or answer “Did you mean…?” when it asks, and it learns the word.');
  h += '<div class="vs-btns"><button class="btn small" data-vs="teach">+ Teach a word</button></div>' + vsNote('Kept on this phone only.') + '</div>';
  // the heard log, newest first
  var l = logList().slice().reverse(), n = l.length;
  h += '<div class="form-card vs-box"><div class="vs-title">Heard log</div>'
    + vsNote(esc(vsMsg || (n ? n + (n === 1 ? ' try' : ' tries') + ', kept on this phone. When voice gets something wrong, Copy and send it to Claude.'
      : 'Nothing yet. The last 50 tries are kept here, on this phone only.')));
  if(n){
    h += '<div class="vs-btns"><button class="btn small" data-vs="copy">Copy</button>'
      + (navigator.share ? '<button class="btn btn-ghost small" data-vs="share">Share</button>' : '')
      + '<button class="btn btn-ghost small" data-vs="clear">' + (vsClearArm ? 'Tap again to clear' : 'Clear') + '</button></div>'
      + '<div class="vs-list">' + (vsAll ? l : l.slice(0, LOG_FEW)).map(function(x){
        return '<div class="vs-log"><div class="vs-log-main"><div class="vs-when">' + esc(when(x.at)) + '</div>'
          + '<div class="vs-heard">' + esc(quote(x.heard)) + '</div>'
          + '<div class="vs-said">' + esc(STATUS_WORDS[x.status] || x.status) + (x.said ? ': ' + esc(x.said) : '') + '</div></div>'
          + (x.via !== 'tap' && x.heard ? '<button class="btn btn-ghost small" data-vs="teachlog" data-at="' + esc(x.at) + '">Teach</button>' : '') + '</div>';
      }).join('') + '</div>'
      + (n > LOG_FEW ? '<button class="vs-more" data-vs="all">' + (vsAll ? 'Show fewer' : 'Show all ' + n) + '</button>' : '');
  }
  return h + '</div>';
}

function teachPage(){
  return '<div class="crumb"><button data-vs="cancel">&larr; Voice</button> / Teach a word</div>'
    + '<div class="form-card"><div class="vs-title">Teach a word</div>'
    + '<label for="vt-word">When I say</label>'
    + '<div class="vt-say"><input id="vt-word" value="' + esc(draft.word) + '" placeholder="like “mots”" autocomplete="off" autocapitalize="off" spellcheck="false">'
    + (SR ? '<button class="vt-mic' + (teachHearing ? ' on' : '') + '" id="vt-mic" type="button" data-vs="saymic" aria-label="Say it">' + MIC + '</button>' : '') + '</div>'
    + '<p class="vs-note" id="vt-heard">' + esc(draft.note || (SR ? 'Or tap the mic and say it: it saves what Google hears.' : '')) + '</p>'
    + '<label for="vt-find">I mean</label>'
    + '<input id="vt-find" type="search" value="' + esc(draft.find) + '" placeholder="Search the orders and prep list" autocomplete="off">'
    + '<div class="vt-list" id="vt-list">' + teachList() + '</div>'
    + '<div class="vt-msg" id="vt-msg"></div>'
    + '<div class="form-actions"><button class="btn btn-ghost" data-vs="cancel">Cancel</button><button class="btn" data-vs="save" id="vt-save" disabled>Save</button></div>'
    + '</div>';
}
function choicesNow(){ return choiceCache || (choiceCache = room.choices()); }
/* every word typed is the start of a word in the name or an alias */
function teachList(){
  var all = choicesNow(), q = AlmoVoice.clean(draft.find), out = [];
  if(q){
    var qs = q.split(' ');
    out = all.filter(function(c){ return qs.every(function(w){ return c.find.some(function(f){ return f.indexOf(w) === 0; }); }); });
    var first = function(c){ return AlmoVoice.clean(c.name).indexOf(q) === 0 ? 0 : 1; };
    out.sort(function(a, b){ return first(a) - first(b) || a.name.localeCompare(b.name); });
    out = out.slice(0, 8);
  }
  var picked = draft.pick && all.filter(function(c){ return c.id === draft.pick; })[0];
  if(picked && out.indexOf(picked) < 0) out.unshift(picked);
  if(!out.length) return vsNote(q ? 'Nothing called that. Try fewer letters.' : 'Type a few letters of the item.');
  return out.map(function(c){
    return '<button class="vt-item' + (c.id === draft.pick ? ' on' : '') + '" type="button" data-vs="pick" data-id="' + esc(c.id) + '">'
      + '<span class="vt-dot"></span><span class="vt-name">' + esc(c.name) + '</span><span class="vs-where">' + esc(c.where) + '</span></button>';
  }).join('');
}
/* What Save would do, read back in words; Save only when it would teach something */
function teachCheck(){
  var msg = document.getElementById('vt-msg'), save = document.getElementById('vt-save');
  if(!msg || !save) return;
  var t = '', warn = false, can = false;
  var c = draft.word.trim() ? room.checkWord(draft.word) : null;
  var pick = draft.pick ? choicesNow().filter(function(x){ return x.id === draft.pick; })[0] : null;
  if(c && !c.ok){
    warn = true;
    t = c.why === 'two' ? 'That’s two items (' + c.words.map(quote).join(' and ') + '). Teach one at a time.'
      : 'The Pass reads part of that as a command, an amount, a list or a supplier, so it can’t learn it. Type only the word it gets wrong, like “mots”.';
  } else if(c && pick){
    var same = c.means.filter(function(m){ return m.id === pick.id; })[0];
    var names = c.means.filter(function(m){ return m.id !== pick.id && m.how !== 'taught'; });
    var was = c.means.filter(function(m){ return m.id !== pick.id && m.how === 'taught'; })[0];
    if(same) t = 'It already knows ' + quote(c.said) + ' means ' + pick.name + '.';
    else {
      can = true;
      t = 'When you say ' + quote(c.said) + ', it will mean ' + pick.name + ' (' + pick.where + ').';
      if(was) t += ' Before, it meant ' + was.name + '.';
      if(names.length){ warn = true; t += ' ' + quote(c.said) + ' is already a name for ' + names.map(function(m){ return m.name; }).join(' and ') + ', so it will ask you which one each time.'; }
    }
  }
  msg.textContent = t; msg.className = 'vt-msg' + (warn ? ' warn' : '');
  save.disabled = !can;
}
function startTeach(word, note){
  draft = { word: word || '', find: '', pick: '', note: note || '' };
  choiceCache = null; vsGood = ''; vsClearArm = false;
  teachPushed = true;
  goto({ name: 'voiceTeach' });
}
function leaveTeach(){
  stopTeachEar();
  draft = { word: '', find: '', pick: '', note: '' };
  if(teachPushed){ teachPushed = false; history.back(); }
  else goto({ name: 'voice' });
}
function teachSave(){
  var r = room.teachWord(draft.word, draft.pick);
  if(!r.ok){ teachCheck(); return; }
  vsGood = 'Learned: when you say ' + quote(r.said) + ', it means ' + r.name + '.';
  leaveTeach();
}
/* "Say it": the same one-shot listener as the mic; keeps what Google wrote */
function setHeard(t){ var el = document.getElementById('vt-heard'); if(el) el.textContent = t; }
function earOn(on){ teachHearing = on; var b = document.getElementById('vt-mic'); if(b) b.classList.toggle('on', on); }
function stopTeachEar(){ if(teachHearing){ teachEar++; earOn(false); cancelListening(); } }
function teachSay(){
  if(teachHearing){ stopListening(); return; }
  stopSpeaking();
  var my = ++teachEar;
  var why = listen({
    words: function(w){ if(my === teachEar) setHeard(quote(w)); },
    end: function(alts, err){
      if(my !== teachEar) return;
      earOn(false);
      if(!alts){ setHeard(err && err !== 'aborted' && ERRS[err] ? ERRS[err] : 'I didn’t hear anything. Tap the mic to try again.'); return; }
      var heardText = String(alts[0].s || '').trim();
      var w = room.guessWord(heardText) || heardText;
      draft.word = w;
      draft.note = 'Heard ' + quote(heardText) + (w !== heardText ? '. Kept ' + quote(w) + '.' : '.');
      var inp = document.getElementById('vt-word'); if(inp) inp.value = w;
      setHeard(draft.note); teachCheck();
    }
  });
  if(why){ setHeard(ERRS[why] || 'The mic didn’t start.'); return; }
  earOn(true); setHeard('Listening… say just the word.');
}

function onPageClick(e){
  var b = e.target.closest ? e.target.closest('[data-vs]') : null;
  if(!b) return;
  var v = b.getAttribute('data-vs');
  if(v !== 'clear') vsClearArm = false;
  if(v === 'follow'){ saveSettings({ follow: +b.getAttribute('data-n') }); render(); }
  else if(v === 'teach') startTeach('', '');
  else if(v === 'teachlog'){
    var at = +b.getAttribute('data-at'), x = logList().filter(function(y){ return y.at === at; })[0];
    if(!x) return;
    var w = room.guessWord(x.heard) || x.heard;
    startTeach(w, 'From the log: ' + quote(x.heard) + (w === x.heard ? '. Cut it down to the word it got wrong.' : '.'));
  }
  else if(v === 'forget'){
    if(room.forgetWord(b.getAttribute('data-key'))) vsGood = 'Forgot ' + quote(b.getAttribute('data-said')) + '.';
    render();
  }
  else if(v === 'copy') copyText(logText(), function(ok){ vsMsg = ok ? 'Copied. Paste it into the chat with Claude.' : 'This phone wouldn’t copy. Try Share.'; render(); });
  else if(v === 'share'){ try{ navigator.share({ title: 'The Pass heard log', text: logText() }).catch(function(){}); }catch(err){} }
  else if(v === 'clear'){
    if(!vsClearArm){ vsClearArm = true; render(); return; }
    writeJSON(K_LOG, []); vsClearArm = false; vsAll = false; vsMsg = 'Cleared.'; render();
  }
  else if(v === 'all'){ vsAll = !vsAll; render(); }
  else if(v === 'pick'){
    draft.pick = b.getAttribute('data-id');
    var list = document.getElementById('vt-list'); if(list) list.innerHTML = teachList();
    teachCheck();
  }
  else if(v === 'saymic') teachSay();
  else if(v === 'save') teachSave();
  else if(v === 'cancel') leaveTeach();
}
function onPageInput(e){
  var t = e.target;
  if(t.id === 'vt-word'){ draft.word = t.value; teachCheck(); }
  else if(t.id === 'vt-find'){
    draft.find = t.value;
    var list = document.getElementById('vt-list'); if(list) list.innerHTML = teachList();
    teachCheck();
  }
}
function onPageChange(e){
  var t = e.target;
  if(t.hasAttribute && t.hasAttribute('data-vs-on')){ saveSettings({ on: t.checked }); render(); }
}
/* render() puts this in the page for the two Voice screens */
function renderVoice(name){
  try{ return name === 'voiceTeach' ? teachPage() : voicePage(); }
  catch(e){ return '<div class="crumb"><button data-goto="home">&larr; Home</button> / Voice</div><div class="empty">Voice couldn’t draw this screen.</div>'; }
}

/* Called by render() on every screen change: no mic where you type */
function voiceScreen(){
  if(!micEl) return;
  var name = state.view.name;
  var show = !!SR && settings().on && NO_MIC.indexOf(name) < 0;
  micEl.hidden = !show;
  document.body.classList.toggle('vmic-on', show);
  if(!show && open) closeCard(true);
  if(name !== 'voiceTeach'){ stopTeachEar(); teachPushed = false; }
  if(name !== 'voice' && name !== 'voiceTeach'){ vsAll = false; vsClearArm = false; vsMsg = ''; vsGood = ''; }
  if(name === 'voiceTeach') teachCheck();
  // the app keeps the scroll between screens: Teach opens at its top, and
  // after it the Voice screen shows the "Learned…" line, not the log below
  if(name === 'voiceTeach' && lastView !== 'voiceTeach') window.scrollTo(0, 0);
  if(name === 'voice' && lastView === 'voiceTeach' && vsGood){
    setTimeout(function(){ var g = document.querySelector('.vs-good'); if(g) g.scrollIntoView({ block: 'center' }); }, 0);
  }
  lastView = name;
}

build();
var appEl = document.getElementById('app');
if(appEl){
  appEl.addEventListener('click', onPageClick);
  appEl.addEventListener('input', onPageInput);
  appEl.addEventListener('change', onPageChange);
}
window.voiceScreen = voiceScreen;
window.renderVoice = renderVoice;
/* The first paint came before this file loaded: Home again, for its Voice card */
if(state.view.name === 'home' || state.view.name === 'voice') render();
else voiceScreen();
/* For testing in a browser without a microphone: the same path as speech */
window.almoVoiceTry = function(text, alts, purpose){   // v3.9.3: purpose 'follow' tries the follow-up window
  if(!open) openCard();
  view = 'talk';
  return heard([{ s: text }].concat((alts || []).map(function(a){ return { s: a }; })), purpose || (waitAsk || waitConfirm ? 'answer' : 'ask'));
};
})();

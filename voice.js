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

   No AI. Chrome turns speech into words (Google hears it; the first tap
   says so). Everything after that happens on this phone. Only one-shot
   timers. If this file or the brain fails to load, The Pass works exactly
   as it did. */
(function(){
'use strict';
if(typeof window === 'undefined' || typeof AlmoVoice === 'undefined' || typeof state === 'undefined') return;

var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
var K_SEEN = 'order-chit-voice-seen', K_LOG = 'order-chit-voice-log', K_WORDS = 'order-chit-voice-words';
var FOLLOW_MS = 5000, ANSWER_MS = 8000, HIDE_MS = 10000, LOG_MAX = 50;
var NO_MIC = EDIT_VIEWS.concat(['prepAdd', 'ticket']);

/* ---------- the host: the brain's only way into the app ---------- */
function readJSON(k){ try{ var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
function writeJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
/* Another tab may have changed the orders: storage is the truth (contract 8) */
function freshSuppliers(){
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
  open: function(v){
    if(!v || isEditing()) return;
    if(v.view === 'supplier') goto({ name: 'supplier', id: v.id });
    else if(v.view === 'ticket') goto({ name: 'ticket', id: v.id });
    else if(v.view === 'prep') goto({ name: 'prep' });
    else if(v.view === 'list') goto({ name: 'list' });
  },
  get: readJSON,
  set: writeJSON,
  wordsChanged: function(){ if(view === 'log') paint(); }
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
  var wait = purpose === 'follow' ? FOLLOW_MS : purpose === 'answer' ? ANSWER_MS : 0;
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
  phase = 'thinking'; cur = { heard: entry.heard }; waitAsk = null; paint();
  var a;
  try{ a = await room.handle(req); }catch(e){ a = { status: 'error', say: ['I couldn’t check the list.'] }; }
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
  if(a.status === 'notmine') say = ['Sorry, I can only help with orders and the prep list.'];
  if(a.status === 'confirm') say = a.confirm.readBack.concat([a.confirm.question]);
  cur = { heard: heardText, say: say, show: a.show || null, action: a.action && a.action.undo ? a.action : null,
          ask: waitAsk, confirm: waitConfirm, status: a.status };
  paint();
  var spoken = say.slice();
  if(a.status === 'confirm') spoken.push('Yes or no?');
  speak(spoken, function(){
    if(!open) return;
    if(waitAsk || waitConfirm){ vListen('answer'); return; }
    if(byVoice && a.status !== 'error') vListen('follow');
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
function logText(){
  var l = readJSON(K_LOG) || [];
  return 'The Pass ' + APP_VERSION + ' heard log\n' + l.map(function(x){
    return new Date(x.at).toLocaleString('en-AU') + ' | ' + (x.via || '') + ' | "' + x.heard + '"'
      + (x.alts && x.alts.length ? ' (or ' + x.alts.map(function(s){ return '"' + s + '"'; }).join(', ') + ')' : '')
      + ' -> ' + x.status + (x.said ? ': ' + x.said : '') + (x.log ? ' [' + x.log + ']' : '');
  }).join('\n');
}
async function copyLog(btn){
  var text = logText();
  try{ await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch(e){
    var ta = document.createElement('textarea'); ta.value = text; ta.className = 'vc-copy'; btn.after(ta); ta.select();
    try{ document.execCommand('copy'); btn.textContent = 'Copied'; }catch(x){ btn.textContent = 'Select and copy'; }
  }
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
  + '.vc-log{margin:6px 0 0;padding:0;list-style:none;font-size:12px;}'
  + '.vc-log li{padding:5px 0;border-bottom:1px dashed var(--line);}'
  + '.vc-log b{font-weight:600;}'
  + '.vc-words li{display:flex;justify-content:space-between;align-items:center;}'
  + '.vc-copy{width:100%;height:80px;margin-top:6px;font-size:11px;}'
  + '.vc-h{font-size:12px;font-weight:700;margin-top:10px;}';

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
  else if(v === 'log'){ cancelListening(); stopSpeaking(); clearTimeout(hideT); view = 'log'; paint(); }
  else if(v === 'back'){ view = 'talk'; paint(); scheduleHide(); }
  else if(v === 'copy') copyLog(b);
  else if(v === 'forget'){ var w = readJSON(K_WORDS) || {}; delete w[b.getAttribute('data-word')]; writeJSON(K_WORDS, w); paint(); }
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
  if(view === 'log'){
    var l = (readJSON(K_LOG) || []).slice().reverse();
    var words = readJSON(K_WORDS) || {};
    var wk = Object.keys(words);
    h += '<div class="vc-say"><p>Heard log</p></div>'
      + '<div class="vc-opts"><button class="vc-btn dark" data-v="copy">Copy</button><button class="vc-btn" data-v="back">Back</button></div>'
      + (l.length ? '<ul class="vc-log">' + l.map(function(x){
          return '<li>' + esc(new Date(x.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })) + ' <b>“' + esc(x.heard) + '”</b><br>'
            + esc(x.status) + (x.said ? ': ' + esc(x.said) : '') + '</li>';
        }).join('') + '</ul>' : '<div class="vc-note">Nothing yet.</div>')
      + '<div class="vc-h">Words it has learned</div>'
      + (wk.length ? '<ul class="vc-log vc-words">' + wk.map(function(k){
          return '<li><span>“' + esc(k) + '”</span><button class="vc-x" data-v="forget" data-word="' + esc(k) + '" aria-label="Forget">&times;</button></li>';
        }).join('') + '</ul>' : '<div class="vc-note">None yet. When you pick an answer to “Did you mean…?”, it learns the word.</div>');
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

/* Called by render() on every screen change: no mic where you type */
function voiceScreen(){
  if(!micEl) return;
  var show = !!SR && NO_MIC.indexOf(state.view.name) < 0;
  micEl.hidden = !show;
  document.body.classList.toggle('vmic-on', show);
  if(!show && open) closeCard(true);
}

build();
window.voiceScreen = voiceScreen;
voiceScreen();
/* For testing in a browser without a microphone: the same path as speech */
window.almoVoiceTry = function(text, alts){
  if(!open) openCard();
  view = 'talk';
  return heard([{ s: text }].concat((alts || []).map(function(a){ return { s: a }; })), waitAsk || waitConfirm ? 'answer' : 'ask');
};
})();

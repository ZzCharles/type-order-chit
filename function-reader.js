/* New function from management's doc (his order's step 2, 23 Oct 2026).
   Reads the text of management's function doc (copied in Google Docs and
   pasted into The Pass) by its labels: "Date:", "Time:", "Guests:", "Host:",
   the "$49pp Package" line, the dishes under "Included:", the "Important
   Notes" bullets. No AI: a label it can't find is said ("couldn't find"),
   never guessed, and anything it isn't sure of is marked "check".
   A client's phone number and email are never kept: a line holding either is
   dropped everywhere, notes included, and only its kind is reported.
   Plain rules like move-data.js: no storage, clock, network or page.
   index.html hands it the pasted text, today's date and the menu tiers, shows
   the check list (his pick 3A), and fills the New Function form from draft().

   His picks (23 Oct): a range ("60-70 pax") starts on the higher number; the
   name is the host's full name; "Complimentary tiramisu" turns the Tiramisu
   add-on on at 1 (one batch, about 45 portions); no finish time. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.FunctionReader = factory();
})(this, function(){
  var MAX_TEXT = 30000, MAX_NOTES = 15, MAX_DIET = 8;
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var TBC = /\b(tbc|tba|to be confirmed|tentative|provisional)\b/i;

  /* Labels, by what they mean. The first of a kind wins. */
  var LABELS = {
    date: ['date', 'event date', 'function date', 'day'],
    time: ['time', 'times', 'event time', 'function time', 'start time', 'start', 'timing'],
    guests: ['guests', 'guest numbers', 'numbers', 'pax', 'guest count', 'number of guests', 'head count', 'headcount', 'attendees', 'people'],
    style: ['style', 'event style', 'function style', 'format'],
    location: ['location', 'venue', 'area', 'room'],
    host: ['host', 'host name', 'client', 'client name', 'contact name', 'name', 'booked by', 'organiser', 'organizer', 'contact'],
    occasion: ['occasion', 'event', 'celebration', 'purpose', 'event type', 'type'],
    contact: ['phone', 'mobile', 'mob', 'ph', 'tel', 'telephone', 'email', 'e-mail', 'email address', 'phone number', 'mobile number',
      'contact number', 'contact no', 'contact phone', 'contact email', 'contact details', 'address'],
    dietary: ['dietary', 'dietary requirements', 'dietary requirement', 'dietaries', 'dietary needs', 'allergies', 'dietary/allergies', 'dietary & allergies'],
    package: ['package', 'menu', 'food package', 'menu package', 'price'],
    included: ['included', 'includes', 'menu items', 'dishes', 'food']
  };
  var KIND = {};
  Object.keys(LABELS).forEach(function(k){ LABELS[k].forEach(function(w){ KIND[w] = k; }); });

  /* Headings (a whole line, no colon): which part of the doc follows.
     'other' parts (drinks, the run sheet, the closing lists) aren't read. */
  var HEADINGS = {
    client: ['client details', 'client information', 'client info', 'contact details', 'host details', 'booking details', 'client'],
    notes: ['important notes', 'notes', 'special notes', 'key notes', 'special requests', 'kitchen notes', 'notes for kitchen'],
    food: ['food', 'menu', 'food menu', 'catering', 'food package', 'food and package'],
    foodSub: ['package', 'packages', 'the package', 'included', 'includes', 'canapes', 'canapés', 'mains', 'entrees', 'entrées'],
    dessert: ['dessert', 'desserts', 'sweets'],
    other: ['beverages', 'beverage', 'drinks', 'bar', 'arrival', 'run sheet', 'runsheet', 'run-sheet', 'running order', 'timeline', 'event timeline',
      'event flow', 'schedule', 'order of events', 'timings', 'to be confirmed', 'to confirm', 'tbc', 'final notes', 'staff notes', 'other notes',
      'additional notes', 'setup', 'set up', 'set-up', 'equipment', 'styling', 'decorations', 'entertainment', 'music', 'payment', 'deposit',
      'terms', 'terms and conditions', 'invoice', 'billing']
  };
  var HEAD = {};
  Object.keys(HEADINGS).forEach(function(k){ HEADINGS[k].forEach(function(w){ HEAD[w] = k; }); });

  var EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
  function phones(s){
    var out = [], re = /\+?\d[\d\s().-]{6,}\d/g, m;
    while((m = re.exec(s))){
      if(/^\d{4}-\d{2}-\d{2}$/.test(m[0])) continue;
      if(m[0].replace(/\D/g, '').length >= 8) out.push(m[0]);
    }
    return out;
  }
  /* The kinds of contact detail a line holds: [] when none. */
  function contactKinds(s){
    var k = [];
    if(EMAIL.test(s)) k.push('email');
    if(phones(s).length) k.push('phone');
    return k;
  }
  function scrub(s){
    var out = String(s).replace(new RegExp(EMAIL.source, 'gi'), ' ');
    phones(out).forEach(function(p){ out = out.split(p).join(' '); });
    return out.replace(/\s+/g, ' ').replace(/^[\s,;:\/|–—-]+|[\s,;:\/|–—-]+$/g, '').trim();
  }

  function cap(s, n){ s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }
  function norm(s){ return String(s).toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').replace(/[\s:.]+$/, '').trim(); }

  /* The pasted text, as lines: { t: the text, b: a bullet }. Google Docs puts
     zero-width spaces after its bullets and at some line ends. */
  function lines(text){
    var s = String(text == null ? '' : text).slice(0, MAX_TEXT)
      .replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g, '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    var out = [];
    s.split('\n').forEach(function(raw){
      var t = raw.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
      if(!t) return;
      var m = /^(?:[●•◦▪■▫‣⁃∙·*]|[-–—](?=\s)|\d{1,2}[.)](?=\s))\s*(.*)$/.exec(t);
      if(m && m[1]) out.push({ t: m[1].trim(), b: true });
      else if(!m) out.push({ t: t, b: false });
    });
    return out;
  }

  function label(t){
    var m = /^([A-Za-z][A-Za-z '’&\/()-]{0,34}?)\s*:\s*(.*)$/.exec(t);
    if(!m || /\d/.test(m[1])) return null;
    var key = norm(m[1]);
    return { key: key, kind: KIND[key] || '', v: m[2].trim() };
  }
  function heading(L){
    if(L.b || /:\s*\S/.test(L.t) || L.t.length > 40) return null;
    var key = norm(L.t.replace(/:$/, ''));
    return HEAD[key] ? { sec: HEAD[key], key: key, name: L.t.replace(/:$/, '').trim() } : null;
  }

  /* ---------- the date ---------- */
  function ymd(y, m, d){ return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-' + (d < 10 ? '0' : '') + d; }
  function utc(y, m, d){ return new Date(Date.UTC(y, m, d)); }
  function monthOf(w){ var i = MONTHS.indexOf(String(w).toLowerCase().slice(0, 3)); return i; }
  function niceDate(key){ var d = new Date(key + 'T00:00:00Z'); return DAY[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }

  function readDate(v, today){
    var tbc = TBC.test(v), s = v.replace(/\([^)]*\)/g, ' ');
    var wd = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i.exec(s), want = wd ? DAYS.indexOf(wd[1].toLowerCase()) : -1;
    var d, m, y, x;
    if((x = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s))){ y = +x[1]; m = +x[2] - 1; d = +x[3]; }
    else if((x = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]{3,})\.?,?(?:\s+(\d{4}))?/.exec(s)) && monthOf(x[2]) >= 0){ d = +x[1]; m = monthOf(x[2]); y = x[3] ? +x[3] : 0; }
    else if((x = /\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?/.exec(s)) && monthOf(x[1]) >= 0){ d = +x[2]; m = monthOf(x[1]); y = x[3] ? +x[3] : 0; }
    else if((x = /\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/.exec(s))){ d = +x[1]; m = +x[2] - 1; y = x[3] ? (+x[3] < 100 ? 2000 + +x[3] : +x[3]) : 0; }
    else return { status: 'missing', why: "Couldn't read the date in the doc's Date line." };
    if(m < 0 || m > 11 || d < 1 || d > 31) return { status: 'missing', why: "Couldn't read the date in the doc's Date line." };
    var t = new Date(today + 'T00:00:00Z'), cands = [];
    if(y) cands = [y];
    else { var ty = t.getUTCFullYear(); cands = [ty - 1, ty, ty + 1]; }
    cands = cands.filter(function(cy){ return utc(cy, m, d).getUTCMonth() === m; });
    if(!cands.length) return { status: 'missing', why: "The doc's date doesn't exist (" + d + ' ' + MON[m] + ')' + '.' };
    var floor = t.getTime() - 31 * 864e5;
    if(!y) cands = cands.filter(function(cy){ return utc(cy, m, d).getTime() >= floor; });
    var pick = cands[0], dayMatch = want < 0;
    for(var i = 0; i < cands.length && want >= 0; i++) if(utc(cands[i], m, d).getUTCDay() === want){ pick = cands[i]; dayMatch = true; break; }
    var key = ymd(pick, m, d), out = { value: key, tbc: tbc, status: 'ok', why: '' };
    if(!dayMatch){
      out.status = 'check';
      out.why = 'The doc says ' + DAY[want] + ', but ' + d + ' ' + MON[m] + ' ' + pick + ' is a ' + DAY[utc(pick, m, d).getUTCDay()] + '.';
    }
    if(tbc){ out.status = 'check'; out.why = (out.why ? out.why + ' ' : '') + 'The doc says TBC: "Date TBC" goes in the notes.'; }
    return out;
  }

  /* ---------- the start time ("5:30 pm - 11:00 pm" -> "5:30pm"; no finish time: his word) ---------- */
  function readTime(v){
    var re = /(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b\.?/gi, m = re.exec(v);
    var h, mi, ap;
    if(m){
      var before = v.slice(0, m.index), lone = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|to|until|till|til)\s*$/i.exec(before);
      if(lone && +lone[1] <= +m[1] && +lone[1] >= 1 && +lone[1] <= 12){ h = +lone[1]; mi = lone[2] ? +lone[2] : 0; ap = m[3].toLowerCase(); }
      else { h = +m[1]; mi = m[2] ? +m[2] : 0; ap = m[3].toLowerCase(); }
      if(h < 1 || h > 12 || mi > 59) return { status: 'missing', why: "Couldn't read the start time in the doc's Time line." };
    } else if((m = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(v))){
      var H = +m[1]; mi = +m[2]; ap = H >= 12 ? 'p' : 'a'; h = H % 12 || 12;
    } else return { status: 'missing', why: "Couldn't read the start time in the doc's Time line." };
    return { value: h + (mi ? ':' + (mi < 10 ? '0' : '') + mi : '') + ap + 'm', status: 'ok', why: '' };
  }

  /* ---------- the head count ---------- */
  function readPax(v, fromTitle){
    var approx = /\b(approx|approximately|about|around|roughly|circa|est|estimated)\b|~|ish\b/i.test(v);
    var r = /(\d{1,4})\s*(?:-|–|—|to)\s*(\d{1,4})/.exec(v), n, out;
    if(r && +r[2] > +r[1]){
      var lo = +r[1], hi = +r[2], mid = Math.round((lo + hi) / 10) * 5, opts = [lo];
      if(mid > lo && mid < hi) opts.push(mid);
      opts.push(hi);
      out = { value: hi, options: opts, status: 'check', why: 'Pick one: the plates are worked out from it.', said: (approx ? 'Approximately ' : '') + lo + '–' + hi };
    } else {
      var all = (v.match(/\d{1,4}/g) || []).map(Number);
      if(!all.length) return { status: 'missing', why: "Couldn't find a number in the doc's Guests line." };
      if(all.length > 1 && /adult/i.test(v) && /child|kid/i.test(v)){
        n = all.reduce(function(a, b){ return a + b; }, 0);
        out = { value: n, options: [], status: 'check', why: 'Adults and children added up (' + all.join(' + ') + ').', said: String(n) };
      } else {
        n = all[0];
        out = { value: n, options: [], status: 'ok', why: approx ? 'The doc says approximately.' : '', said: (approx ? 'Approximately ' : '') + n };
      }
    }
    if(out.value < 1 || out.value > 2000){ out.status = 'check'; out.why = 'That head count looks wrong: check it.'; }
    if(fromTitle){ out.status = 'check'; out.why = 'No Guests line: taken from the heading. ' + out.why; }
    return out;
  }

  /* ---------- dishes against a tier ---------- */
  var FILLER = { shared: 1, unlimited: 1, mixed: 1, assorted: 1, selection: 1, of: 1, the: 1, a: 1, house: 1, homemade: 1, fresh: 1, our: 1,
    and: 1, with: 1, served: 1, share: 1, sharing: 1, style: 1, pp: 1 };
  function dishWords(s){
    var w = String(s).toLowerCase().replace(/&/g, ' and ').replace(/\bfries\b/g, 'chips').replace(/[^a-z\s]/g, ' ').split(/\s+/);
    return w.filter(Boolean).map(function(t){ return t.length > 3 && /s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t; })
      .filter(function(t){ return !FILLER[t]; });
  }
  function within(a, b){ return a.length && a.every(function(w){ return b.indexOf(w) >= 0; }); }
  function sameDish(doc, tier){ var d = dishWords(doc), t = dishWords(tier); return within(t, d) || within(d, t); }

  function compare(docDishes, dessertText, items){
    var left = items.slice(), matched = [], docOnly = [];
    docDishes.forEach(function(dd){
      for(var i = 0; i < left.length; i++) if(String(left[i].course) !== 'Dessert' && sameDish(dd, left[i].label)){ matched.push([dd, left[i].label]); left.splice(i, 1); return; }
      docOnly.push(dd);
    });
    left = left.filter(function(it){
      if(String(it.course) !== 'Dessert') return true;
      var hit = dessertText.some(function(t){ return within(dishWords(it.label).filter(function(w){ return w !== 'grand'; }), dishWords(t)); });
      if(hit) matched.push([it.label, it.label]);
      return !hit;
    });
    return { matched: matched, docOnly: docOnly, tierOnly: left.map(function(it){ return it.label; }) };
  }
  function priceOf(tr){ var n = parseInt(String(tr.label || tr.id || '').replace(/[^\d]/g, ''), 10); return isNaN(n) ? -1 : n; }

  /* ---------- the doc ---------- */
  function read(text, opts){
    opts = opts || {};
    var today = /^\d{4}-\d{2}-\d{2}$/.test(opts.today || '') ? opts.today : '2026-01-01';
    var tiers = Array.isArray(opts.tiers) ? opts.tiers : [];
    var L = lines(text), sec = 'top', seen = {}, title = '', got = {}, host = '', hostScrubbed = false;
    var notes = [], food = [], dessert = [], diet = [], notRead = [], left = [], extraLines = [];
    function leave(kinds){ kinds.forEach(function(k){ if(left.indexOf(k) < 0) left.push(k); }); }

    for(var i = 0; i < L.length; i++){
      var ln = L[i], lab = label(ln.t);
      if(lab && lab.kind === 'contact'){ leave(contactKinds(ln.t).length ? contactKinds(ln.t) : [/mail/.test(lab.key) ? 'email' : /address/.test(lab.key) ? 'address' : 'phone']); continue; }
      if(lab && lab.kind === 'host' && sec !== 'other' && !host){
        var hk = contactKinds(lab.v);
        if(hk.length){ leave(hk); hostScrubbed = true; }
        host = cap(scrub(lab.v), 60);
        continue;
      }
      var ck = contactKinds(ln.t);
      if(ck.length){ leave(ck); continue; }
      var h = heading(ln);
      if(h){
        if(h.key === 'included' || h.key === 'includes'){
          if(sec === 'other') continue;
          food.push({ t: '', b: false, mark: 'included' });
          if(sec !== 'food' && !seen.food){ sec = 'food'; seen.food = true; }
          continue;
        }
        if(h.sec === 'foodSub'){ if(sec === 'food') continue; h.sec = 'food'; }
        if(h.sec === 'other' || seen[h.sec]){ sec = 'other'; if(notRead.indexOf(h.name) < 0) notRead.push(h.name); }
        else { sec = h.sec; seen[h.sec] = true; }
        continue;
      }
      if(sec === 'other') continue;
      if(!title && sec === 'top' && !lab && !ln.b){ title = cap(ln.t, 120); continue; }
      if(lab && lab.kind && lab.kind !== 'host'){
        if(lab.kind === 'dietary'){
          if(lab.v) diet.push(lab.v);
          else { while(i + 1 < L.length && L[i + 1].b && !label(L[i + 1].t)){ i++; if(!contactKinds(L[i].t).length) diet.push(L[i].t); } }
          continue;
        }
        if(lab.kind === 'included'){
          (lab.v ? lab.v.split(/[,;]/) : []).forEach(function(x){ if(x.trim()) food.push({ t: x.trim(), b: true, inc: true }); });
          food.push({ t: '', b: false, mark: 'included' });
          if(sec !== 'food' && !seen.food){ sec = 'food'; seen.food = true; }
          continue;
        }
        if(lab.kind === 'package'){ food.push({ t: lab.v, b: false, pkg: true }); continue; }
        if(!got[lab.kind]) got[lab.kind] = lab.v;
        continue;
      }
      var dl = /^(dietary(?: requirements?| needs)?|dietaries|allergies)\b[\s:-]*(.*)$/i.exec(ln.t);
      if(dl && sec !== 'food'){ diet.push(dl[2] || ''); continue; }
      if(sec === 'notes') notes.push(ln.t);
      else if(sec === 'food') food.push(ln);
      else if(sec === 'dessert') dessert.push(ln);
      else extraLines.push(ln.t);
    }

    var f = {};

    /* name: the host's full name (his pick); the heading's two readings one tap away */
    var lead = title.split(/\s+[-–—]\s+|\s*\(|:/)[0].replace(/\b(function|event|booking)?\s*(run\s*sheet|runsheet)\b.*$/i, '').trim();
    var whole = title.replace(/\b(function\s+)?(run\s*sheet|runsheet)\b/i, '').replace(/\s+/g, ' ').trim();
    var names = [];
    [host, lead, whole].forEach(function(n){ n = cap(n, 60); if(n && names.indexOf(n) < 0 && n.length <= 60) names.push(n); });
    if(host) f.name = { value: host, options: names, status: 'ok', why: 'From "Host:".' + (hostScrubbed ? ' Their phone and email are left out.' : '') };
    else if(lead) f.name = { value: cap(lead, 60), options: names, status: 'check', why: 'No "Host:" line: taken from the heading.' };
    else f.name = { value: '', options: [], status: 'missing', why: "Couldn't find a name." };

    f.date = got.date ? readDate(got.date, today) : { status: 'missing', why: "Couldn't find a \"Date:\" line." };
    f.startTime = got.time ? readTime(got.time) : { status: 'missing', why: "Couldn't find a \"Time:\" line." };

    var paxTitle = /(\d{1,4}(?:\s*(?:-|–|to)\s*\d{1,4})?)\s*(?:pax|guests|people)\b/i.exec(title);
    f.pax = got.guests ? readPax(got.guests, false) : paxTitle ? readPax(paxTitle[0], true) : { status: 'missing', why: "Couldn't find a \"Guests:\" line." };

    /* the package's price -> the tier with that price; its dishes compared */
    var priceLine = null;
    food.concat(extraLines.map(function(t){ return { t: t }; })).some(function(x){
      if(/\$\s?\d{2,3}/.test(x.t) && (x.pkg || /\d\s*(pp|p\.p\.)(?![a-z])|\b(pp|p\.p\.|per\s+(person|head|guest)|package|menu|pax)\b|\/\s*(person|head|pp)\b/i.test(x.t))){ priceLine = x; return true; }
      return false;
    });
    var complimentary = /complimentary[^.]*tiramisu|tiramisu[^.]*(complimentary|on the house)/i;
    var docDishes = [];
    /* the dishes: every line after "Included:"; with no such line, the bullets (or every line, when the paste lost its bullets) */
    var afterIncluded = food.some(function(x){ return x.mark === 'included'; }), passedInc = false;
    var bullets = food.some(function(x){ return x.b && !x.inc; });
    food.forEach(function(x){
      if(x.mark === 'included'){ passedInc = true; return; }
      if(x === priceLine || x.pkg || !x.t || /^\(/.test(x.t) || complimentary.test(x.t) || /mezze/i.test(x.t) || /\$\s?\d/.test(x.t)) return;
      if(x.inc || (afterIncluded ? passedInc : (x.b || !bullets))) docDishes.push(cap(x.t, 60));
    });
    if(priceLine){
      var price = +/\$\s?(\d{2,3})/.exec(priceLine.t)[1], tier = null;
      tiers.forEach(function(tr){ if(!tier && priceOf(tr) === price) tier = tr; });
      if(!tier) f.tier = { value: '', price: price, said: cap(priceLine.t, 60), status: 'check', why: 'The Pass has no $' + price + ' tier: pick one, or none.', dishes: { matched: [], docOnly: docDishes, tierOnly: [] } };
      else {
        var cmp = compare(docDishes, dessert.map(function(x){ return x.t; }), Array.isArray(tier.items) ? tier.items : []);
        var tl = tier.label || ('$' + price), good = !cmp.docOnly.length && !cmp.tierOnly.length;
        var said = cmp.matched.map(function(p){ return norm(p[0]) === norm(p[1]) ? p[1] : p[0] + ' = ' + p[1]; });
        var why = good ? (cmp.matched.length ? 'All ' + cmp.matched.length + ' dishes match the ' + tl + ' tier: ' + said.join(', ') + '.' : 'The doc lists no dishes: the ' + tl + ' tier\'s are used.')
          : (cmp.docOnly.length ? 'Not in the ' + tl + ' tier: ' + cmp.docOnly.join(', ') + '. ' : '') + (cmp.tierOnly.length ? 'In the tier but not in the doc: ' + cmp.tierOnly.join(', ') + '.' : '');
        f.tier = { value: String(tier.id), price: price, said: cap(priceLine.t, 60), status: good || !docDishes.length ? 'ok' : 'check', why: why.trim(), dishes: cmp };
      }
    } else f.tier = { value: '', status: 'missing', why: "Couldn't find the package price (\"$49pp Package\").", dishes: { matched: [], docOnly: docDishes, tierOnly: [] } };

    /* dietary: "2 GF, 1 vegan (TBC)"; "Dietary requirements TBC" has none yet */
    var dItems = [], dTbc = false, dNone = false;
    diet.forEach(function(v){
      if(TBC.test(v)) dTbc = true;
      var s = v.replace(/\([^)]*\)/g, ' ').replace(TBC, ' ').replace(/\b(are|is|to be)\b/gi, ' ');
      if(/^\W*(none|nil|n\/a|no)\W*$/i.test(s.trim())){ dNone = true; return; }
      s.split(/[,;+\n]|\band\b(?=\s*\d)/i).forEach(function(x){ x = x.replace(/\s+/g, ' ').replace(/^[\s.:-]+|[\s.:-]+$/g, '').trim(); if(x && dItems.length < MAX_DIET) dItems.push(cap(x, 60)); });
    });
    if(dItems.length) f.dietary = { value: dItems.map(function(x){ return dTbc ? x + ' (TBC)' : x; }), status: 'ok', why: dTbc ? 'Marked TBC in the doc: kept as "' + dItems[0] + ' (TBC)"' + (dItems.length > 1 ? ' and so on' : '') + '.' : '' };
    else if(dTbc) f.dietary = { value: [], tbc: true, status: 'check', why: 'Dietary requirements are TBC in the doc: "Dietary TBC" goes in the notes.' };
    else if(dNone) f.dietary = { value: [], status: 'ok', why: 'None.' };
    else f.dietary = { value: [], status: 'missing', why: 'No dietary line in the doc.' };

    /* add-ons: complimentary tiramisu -> 1 batch (his rule); a mezze board -> 1, to check */
    var all = notes.concat(food.map(function(x){ return x.t; }), dessert.map(function(x){ return x.t; }), extraLines);
    var tira = all.some(function(t){ return complimentary.test(t); }) ? 1 : 0;
    var mezzeLine = null;
    all.some(function(t){ if(/mezze\s*boards?|mezze\b/i.test(t)){ mezzeLine = t; return true; } return false; });
    var mezze = 0;
    if(mezzeLine){
      var NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1, an: 1 };
      var mm = /(\d{1,2})\s*x?\s*(?:[a-z]+\s+){0,2}mezze/i.exec(mezzeLine) || /\b(one|two|three|four|five)\b\s+(?:[a-z]+\s+){0,2}mezze/i.exec(mezzeLine);
      mezze = mm ? (+mm[1] || NUM[mm[1].toLowerCase()] || 1) : 1;
    }
    var addWhy = [];
    if(tira) addWhy.push('"Complimentary tiramisu": Tiramisu 1 (one batch).');
    if(mezze) addWhy.push('The doc mentions a mezze board: Mezze boards ' + mezze + '.');
    f.addons = { value: { tiramisu: tira, mezze: mezze }, status: mezze ? 'check' : 'ok', why: addWhy.join(' ') || 'None in the doc.' };

    /* notes: occasion, style, the Important Notes bullets (each can be left out), TBCs */
    var nv = [];
    function note(s){ s = cap(String(s).replace(/[.\s]+$/, ''), 200); if(s && nv.length < MAX_NOTES && nv.indexOf(s) < 0) nv.push(s); }
    if(got.occasion) note(scrub(got.occasion));
    if(got.style) note(scrub(got.style));
    if(got.location && !/almo/i.test(got.location)) note('Location: ' + scrub(got.location));
    notes.forEach(function(t){ if(!complimentary.test(t) && !/mezze/i.test(t)) note(t); });
    if(f.date.tbc) note('Date TBC');
    if(f.dietary.tbc) note('Dietary TBC');
    f.notes = { value: nv, status: 'ok', why: nv.length ? '' : 'Nothing to note.' };

    var keys = ['name', 'date', 'startTime', 'pax', 'tier', 'dietary', 'notes', 'addons'], counts = { ok: 0, check: 0, missing: 0 };
    keys.forEach(function(k){ counts[f[k].status]++; });
    var looks = !!(got.date || got.time || got.guests || priceLine);
    return { ok: looks, why: looks ? '' : "This doesn't look like a function doc: there's no Date, Time, Guests or package line.",
      fields: f, left: left, notRead: notRead, counts: counts, title: title };
  }

  /* The New Function form's fields from a read, with his taps on the check list:
     picks = { name, pax, tier, date, startTime, notesOff: [index…], mezze, tiramisu } (all optional).
     Courses aren't filled here: the page fills them from the tier, as picking a tier does. */
  function draft(r, picks){
    picks = picks || {};
    var f = r && r.fields || {};
    function v(k, d){ return picks[k] != null ? picks[k] : (f[k] && f[k].value != null ? f[k].value : d); }
    var off = Array.isArray(picks.notesOff) ? picks.notesOff : [];
    var nv = ((f.notes && f.notes.value) || []).filter(function(_, i){ return off.indexOf(i) < 0; });
    var add = (f.addons && f.addons.value) || {};
    return {
      id: '', date: v('date', ''), name: String(v('name', '')), pax: Math.max(0, parseInt(v('pax', 0), 10) || 0), tier: String(v('tier', '')),
      startTime: String(v('startTime', '')), dietary: ((f.dietary && f.dietary.value) || []).slice(),
      notes: nv.length ? nv.join('. ') + '.' : '',
      mezze: Math.max(0, parseInt(picks.mezze != null ? picks.mezze : add.mezze, 10) || 0),
      tiramisu: Math.max(0, parseInt(picks.tiramisu != null ? picks.tiramisu : add.tiramisu, 10) || 0),
      extras: [], courses: []
    };
  }

  return { read: read, draft: draft, lines: lines, contactKinds: contactKinds, scrub: scrub, sameDish: sameDish, niceDate: niceDate,
    readDate: readDate, readTime: readTime, readPax: readPax };
});

/* The Pass — voice brain (v3.9.0, 9 October 2026; learned words v3.9.1, 10 October;
   v3.9.3, 11 October: fixes from his heard log, see HANDOFF "Heard log, Sat 10 Oct")

   Turns a spoken sentence into a change on a supplier order or the prep
   list. No AI and no network of its own: a keyword brain over the app's own
   names, as agreed in almo-voice-brain.md (option A, keyword matching) and
   the Pluto room contract v1 (../Pluto/Pluto-Room-Contract.md).

   Two layers, neither touches the page or the screen:
     understanding   words -> numbers, units, items, what to do
     the room        handle / confirm / undo / reset / menu / hello, answering
                     in the contract's shapes, and acting only through the
                     `host` object it is given (voice.js in the page, a fake
                     in test-voice.mjs).

   The brain proposes, the code decides. What needs a "yes" is fixed here,
   never guessed, and anything it can't pin down it asks about. Nothing is
   ever sent: sending stops at the Review Order screen, where the owner taps.

   Loaded by the page as window.AlmoVoice, by Node with require(). */
(function(root, make){
  var node = typeof module === 'object' && module.exports;
  // v3.10.0: the roster engine (roster-engine.js), loaded before this file in the page
  var api = make(node ? require('./roster-engine.js') : (root.RosterEngine || null));
  if(node) module.exports = api;
  else root.AlmoVoice = api;
})(typeof self !== 'undefined' ? self : this, function(RE){
'use strict';

/* ================= words ================= */

/* Lower case, "&" -> "and", apostrophes dropped ("michael's" -> "michaels",
   "what's" -> "whats"), digits split from letters ("2kg" -> "2 kg"), and
   only the dots and slashes that sit inside numbers kept ("2.5", "1/2"). */
function clean(s){
  return String(s == null ? '' : s).toLowerCase()
    // v3.11.9 (his test, 14 Oct): Google wrote Bechamel with an accented e, and the accented letter was thrown away ("B chamel isn't a prep item")
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1\u0002$2')
    .replace(/'s\b/g, 's').replace(/'/g, '')
    .replace(/[^a-z0-9\u0001\u0002 ]+/g, ' ')
    .replace(/(\d)(?=[a-z])/g, '$1 ').replace(/([a-z])(?=\d)/g, '$1 ')
    .replace(/\u0001/g, '.').replace(/\u0002/g, '/')
    .replace(/\s+/g, ' ').trim();
}

/* Plurals folded so "tomatoes", "boxes" and "punnets" meet their names.
   Used the same way on both sides, so a rough fold is enough. */
var IRREG = { tomatoes: 'tomato', potatoes: 'potato', leaves: 'leaf', halves: 'half', loaves: 'loaf',
  /* v3.11.17 (his check, 17 Oct: "add marinated chicken to the prep list" asked
     "Marinated Peppers or Marinated Olives?" for Chicken Thigh Marination; "veg
     stock" asked "Prawn Stock or Vegetable Stock?"): one root each */
  marinated: 'marinate', marinade: 'marinate', marinades: 'marinate', marination: 'marinate', marinations: 'marinate', marinating: 'marinate',
  veg: 'vegetable', veggie: 'vegetable', veggies: 'vegetable', vegies: 'vegetable' };
/* v3.10.2: kitchen words Google writes as everyday ones (his log, 12 Oct:
   "config garlic cream" for Confit Garlic Cream) */
var HEARD_AS = { config: 'confit', configs: 'confit',
  // v3.11.1 (his log, 13 Oct): "barbecue sauce" is BBQ Sauce (it asked "Did you mean …?" every time)
  barbecue: 'bbq', barbeque: 'bbq', barbecues: 'bbq', barbeques: 'bbq' };
/* v3.11.10 (his test through Pluto, 15 Oct: "add sliced spec to the list", twice): Google's words fixed in a
   one-off's name ("Sliced speck"). Speck itself is found from "spec" already (a name's start, like "mozz") */
var SHOWN_FIX = { spec: 'speck', specs: 'speck', config: 'confit', configs: 'confit' };
/* v3.11.10 (his test, 15 Oct: "chopped parsley", "sliced speck"): how a thing
   is prepped, said before its name. When the whole sentence's words don't
   name an item, the same words without these are tried, so "chop parsley",
   "cut parsley" and "parsley" all find Parsley. A name that has the word
   ("Sliced Pepperoni") still matches first, as said. */
var PREP_TRIM = { chop: 1, chopped: 1, cut: 1, slice: 1, sliced: 1, dice: 1, diced: 1, pick: 1, picked: 1,
  peel: 1, peeled: 1, grate: 1, grated: 1, shred: 1, shredded: 1, crush: 1, crushed: 1, julienne: 1, julienned: 1,
  wash: 1, washed: 1 };
/* v3.11.1 (his log, 13 Oct): words Google hears for his, fixed before
   anything reads the sentence. Each only where it can't mean the everyday
   word: "beef means" (mince), "cran ski" (Kransky), "speak" opening an item
   or after an add (Speck, not "speak to"), and "roasted" asked about people
   or a day (rostered; "roasted red peppers" stays). */
var DAY_WORDS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow';
var READ_START = /^\s*(?:(?:and|so|ok|okay|also)[\s,]+)*(?:(?:can|could|would|will) you (?:please |also )?|please )?(?:what|whats|what's|what is|read|tell me|check|go through|is there|are there|anything)\b/i;   // v3.11.16
function heardFix(text){
  return String(text == null ? '' : text)
    /* v3.11.16 (his test, 17 Oct, 1 am): a misheard "Hey Pluto" left at the
       start ("hey Bluetooth can you please add pizza door to the ordering"
       asked to add "Bluetooth Add Pizza Door" as a new product) */
    .replace(/^\s*(?:hey|hi|ok|okay)[\s,]+(?:pluto|plutos|pluto's|bluetooth|blue tooth|plato|pluta|blue too)\b[\s,.!]*/i, '')
    /* … and, on a question or a read ("what's remaining on my prep list now",
       "read me the prep list one more time"), a tail that changes nothing
       (never on a timesheet answer: "about now" is when he finished) */
    .replace(/^([\s\S]*\S)[\s,]+(?:right now|now|again|one more time|once more|for me)(?:[\s,]+please)?[\s.!?]*$/i, function(all, head){ return READ_START.test(head) ? head : all; })
    .replace(/\bpizza (?:doors?|doe|dote)\b/gi, 'pizza dough')
    // "and how about can you mark …" is a request, not a "how" question
    .replace(/^\s*(?:(?:and|so|ok|okay)[\s,]+)*(?:how|what) about[\s,]+(?=(?:can|could|would|will) you\b|please\b|(?:add|put|mark|tick|remove|take|order|get|make|change)\b)/i, '')
    .replace(/\b(beef|pork|lamb|veal|chicken|turkey) means\b/gi, '$1 mince')
    .replace(/\b(?:cran|kran|crans|krans) ?(?:ski|skis|skies|key|keys)\b/gi, 'kransky')
    // v3.11.10 (his test, 15 Oct): Google's ways of hearing "the prep list" ("to the purpose", "from the process", "the prayer list")
    .replace(/\b(to|on|onto|in|into|from|off|of|for) (?:the|my|our) (?:purpose|process|prayer list|prayer lists|breath list|breathless|press list)\b/gi, '$1 the prep list')
    // v3.11.10 (his test, 15 Oct: "can you check mushroom off from the prep list" was taken as "can you …?")
    .replace(/\bcheck\s+off\b/gi, 'tick off')
    .replace(/\bcheck\s+((?:the\s+)?[a-z][a-z' ]{1,40}?)\s+off\b/gi, 'tick $1 off')
    .replace(/(^|\b(?:add|order|and|get|need|plus|also|some|of|the|following|a|an|one|two|three|four|five|six|\d+)\s+|,\s*)speak\b(?!\s+(?:to|with|up|louder|slower|english|more|again|clearly|properly)\b)/gi, '$1speck')
    .replace(/\b(person|people|persons|staff|who|whos|who's|anyone|everyone|many)((?: is| are| was| were| be)?) roasted\b/gi, '$1$2 rostered')
    .replace(new RegExp('\\broasted ((?:on|for) (?:' + DAY_WORDS + ')s?)\\b', 'gi'), 'rostered $1')
    // v3.11.2 (his log, 13 Oct: "how many hours am I roasted for this week")
    .replace(/\b(am i|are we|are they|is he|is she|i am|im|i'm|will i be|ill be|i'll be)\s+roasted\b/gi, '$1 rostered')
    .replace(/\broasted(?=\s+(?:on|for|in|this|next)\s+(?:this\s+|next\s+|the\s+)?(?:week|weeks|weekend|weekends)\b)/gi, 'rostered');
}
function stem(w){
  if(IRREG[w]) return IRREG[w];   // v3.11.17: before the short-word rule, for "veg"
  if(w.length <= 3 || /\d/.test(w)) return w;
  if(HEARD_AS[w]) return HEARD_AS[w];
  if(IRREG[w]) return IRREG[w];
  if(/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if(/(ches|shes|xes|sses|oes)$/.test(w)) return w.slice(0, -2);
  if(/(ss|us|is)$/.test(w)) return w;
  if(/s$/.test(w)) return w.slice(0, -1);
  return w;
}
/* keepCommas: a spoken sentence keeps its commas as a joiner ("add mozz,
   take the speck off"); names and keys never do. */
function toks(s, keepCommas){
  var c = clean(keepCommas ? String(s == null ? '' : s).replace(/(\D),|,(\D)/g, '$1 qqcomma $2') : s);
  return c ? c.split(' ').map(function(r){ return r === 'qqcomma' ? { r: ',', s: ',' } : { r: r, s: stem(r) }; }) : [];
}
function keyOf(s){ return toks(s).map(function(t){ return t.s; }).join(' '); }
/* Words that don't tell names apart ("Mac & Cheese" = "mac cheese") */
var NAME_FILLER = { of: 1, and: 1, the: 1, a: 1, an: 1, n: 1, with: 1, style: 1, di: 1, de: 1, la: 1, in: 1, on: 1 };
function contentSet(list){
  var out = [];
  list.forEach(function(s){ if(!NAME_FILLER[s] && out.indexOf(s) < 0) out.push(s); });
  return out;
}
function uniq(a){ var out = []; a.forEach(function(x){ if(out.indexOf(x) < 0) out.push(x); }); return out; }
function cap(s){ s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function fmt(n){ return String(Math.round(n * 100) / 100); }
function joinAnd(list){
  if(list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
function joinOr(list){
  if(list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];
}

/* ================= numbers and units ================= */

var SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
var VAGUE = { couple: 1, few: 1, some: 1, bit: 1, little: 1, handful: 1, lot: 1, lots: 1, heap: 1, heaps: 1, bunch_of: 1 };
var WORD_OF = {};
Object.keys(SMALL).forEach(function(k){ WORD_OF[SMALL[k]] = k; });
Object.keys(TENS).forEach(function(k){ if(k !== 'fourty') WORD_OF[TENS[k]] = k; });

var UNIT_WORDS = {
  kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg', kg: 'kg', kgs: 'kg', k: 'kg', kilogramme: 'kg',
  gram: 'g', grams: 'g', g: 'g', gs: 'g', gm: 'g', gms: 'g', gramme: 'g', grammes: 'g',
  litre: 'L', litres: 'L', liter: 'L', liters: 'L', l: 'L', lt: 'L', ltr: 'L', ltrs: 'L',
  ml: 'ml', mls: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  box: 'box', boxes: 'box',
  bag: 'bag', bags: 'bag', sack: 'bag', sacks: 'bag',
  tin: 'tin', tins: 'tin', can: 'tin', cans: 'tin',
  packet: 'pkt', packets: 'pkt', pack: 'pkt', packs: 'pkt', pkt: 'pkt', pkts: 'pkt',
  bunch: 'bunch', bunches: 'bunch',
  punnet: 'punnet', punnets: 'punnet',
  carton: 'ctn', cartons: 'ctn', ctn: 'ctn', ctns: 'ctn',
  jar: 'jar', jars: 'jar',
  tub: 'tub', tubs: 'tub',
  bottle: 'bottle', bottles: 'bottle',
  // v3.11.12 (his lists, 16 Oct: Parmesan in "Blocks", and a tray and a log): "two blocks of parmesan" asked "Did you mean Parmesan?"
  block: 'block', blocks: 'block', tray: 'tray', trays: 'tray', log: 'log', logs: 'log',
  each: 'each', piece: 'each', pieces: 'each'
};
var UNIT_SAY = { kg: ['kilo', 'kilos'], g: ['gram', 'grams'], L: ['litre', 'litres'], ml: ['ml', 'ml'],
  box: ['box', 'boxes'], bag: ['bag', 'bags'], tin: ['tin', 'tins'], pkt: ['packet', 'packets'],
  bunch: ['bunch', 'bunches'], punnet: ['punnet', 'punnets'], ctn: ['carton', 'cartons'], jar: ['jar', 'jars'],
  tub: ['tub', 'tubs'], bottle: ['bottle', 'bottles'], block: ['block', 'blocks'], tray: ['tray', 'trays'], log: ['log', 'logs'], each: ['', ''] };

/* A product's own unit, as one of the keys above where it is one.
   v3.11.12: what's in brackets is set aside ("can (4kg)" is a can). */
function unitWord(u){ return clean(String(u == null ? '' : u).replace(/\([^)]*\)/g, ' ')); }
function canonUnit(u){
  var c = unitWord(u);
  if(!c) return '';
  if(/^market bunch/.test(c)) return 'bunch';
  return UNIT_WORDS[c] || c;
}
function unitSay(u){
  var c = unitWord(u);
  if(/^market bunch/.test(c)) return ['market bunch', 'market bunches'];
  var k = UNIT_WORDS[c];
  if(k) return UNIT_SAY[k];
  if(!c) return ['', ''];
  // v3.11.12: one of a unit it doesn't know is said without the s ("1 blocks")
  return [/[^s]s$/.test(c) ? c.slice(0, -1) : c, /s$/.test(c) ? c : c + 's'];
}
/* "4 kilos", "1 box", "2" for things counted one by one */
function amount(n, unit){
  var u = unitSay(unit), q = fmt(n);
  if(!u[0]) return q;
  return q + ' ' + (n === 1 ? u[0] : u[1]);
}
/* "2 kilos of Mozzarella", "2 Pineapple" */
function amountOf(n, unit, name){
  var u = unitSay(unit);
  return u[0] ? amount(n, unit) + ' of ' + name : fmt(n) + ' ' + name;
}
/* grams to kilos and ml to litres are safe; nothing else is ever converted */
function convert(n, from, to){
  if(!from || from === to) return n;
  if(from === 'g' && to === 'kg') return n / 1000;
  if(from === 'kg' && to === 'g') return n * 1000;
  if(from === 'ml' && to === 'L') return n / 1000;
  if(from === 'L' && to === 'ml') return n * 1000;
  if(from === 'bunch' && to === 'bunch') return n;
  return null;
}

function unitAt(t, i){
  var w = t[i] && t[i].r;
  if(!w) return null;
  if(w === 'market' && t[i + 1] && /^bunch/.test(t[i + 1].r)) return { u: 'bunch', end: i + 2 };
  if(UNIT_WORDS[w]) return { u: UNIT_WORDS[w], end: i + 1 };
  return null;
}
function wordInt(t, i){
  var w = t[i] && t[i].r, n, end;
  if(w == null) return null;
  if(SMALL[w] != null){ n = SMALL[w]; end = i + 1; }
  else if(TENS[w] != null){
    n = TENS[w]; end = i + 1;
    var nx = t[end] && SMALL[t[end].r];
    if(nx != null && nx > 0 && nx < 10){ n += nx; end++; }
  }
  else if(w === 'hundred'){ n = 100; end = i + 1; }
  else return null;
  if(t[end] && t[end].r === 'hundred' && w !== 'hundred'){ n *= 100; end++; }
  return { n: n, end: end };
}
/* A number at t[i]: digits, words, "half a", "one and a half", "two point
   five", "a dozen", or "a" before a unit ("a box"). Vague words ("a couple",
   "some") come back as { vague: true }: the room asks "How many?". */
function readNumber(t, i){
  var w = t[i] && t[i].r;
  if(!w) return null;
  var n = null, end = i;
  if(/^\d+(\.\d+)?$/.test(w)){ n = parseFloat(w); end = i + 1; }
  else if(/^\d+\/\d+$/.test(w)){ var f = w.split('/'); n = +f[1] ? +f[0] / +f[1] : null; end = i + 1; if(n == null) return null; }
  else if(w === 'half' || w === 'quarter'){
    n = w === 'half' ? 0.5 : 0.25; end = i + 1;
    if(t[end] && t[end].r === 'of') end++;
    if(t[end] && (t[end].r === 'a' || t[end].r === 'an')) end++;
  }
  else if(w === 'a' || w === 'an'){
    var nx = t[i + 1] && t[i + 1].r;
    if(nx === 'half' || nx === 'quarter'){
      n = nx === 'half' ? 0.5 : 0.25; end = i + 2;
      if(t[end] && t[end].r === 'of') end++;
      if(t[end] && (t[end].r === 'a' || t[end].r === 'an')) end++;
    }
    else if(nx === 'dozen'){ n = 12; end = i + 2; }
    else if(nx && VAGUE[nx]){ return { vague: true, start: i, end: i + 2 }; }
    else if(unitAt(t, i + 1)){ n = 1; end = i + 1; }
    else return null;
  }
  else if(VAGUE[w]){ return { vague: true, start: i, end: i + 1 }; }
  else {
    var wi = wordInt(t, i);
    if(!wi) return null;
    n = wi.n; end = wi.end;
  }
  // "two point five"
  if(t[end] && t[end].r === 'point' && t[end + 1] && SMALL[t[end + 1].r] != null && SMALL[t[end + 1].r] < 10){
    var digits = '';
    end++;
    while(t[end] && SMALL[t[end].r] != null && SMALL[t[end].r] < 10){ digits += SMALL[t[end].r]; end++; }
    n = parseFloat(Math.floor(n) + '.' + digits);
  }
  // "1 1/2"
  if(t[end] && /^\d+\/\d+$/.test(t[end].r)){ var g = t[end].r.split('/'); if(+g[1]){ n += +g[0] / +g[1]; end++; } }
  // "one and a half"
  if(t[end] && t[end].r === 'and' && t[end + 1] && t[end + 1].r === 'a' && t[end + 2] && (t[end + 2].r === 'half' || t[end + 2].r === 'quarter')){
    n += t[end + 2].r === 'half' ? 0.5 : 0.25; end += 3;
  }
  if(t[end] && t[end].r === 'dozen'){ n *= 12; end++; }
  return { n: n, start: i, end: end };
}
/* number + unit, plus "a kilo and a half" */
function readQty(t, i){
  var num = readNumber(t, i);
  if(!num) return null;
  var q = { n: num.n, vague: !!num.vague, unit: '', start: i, end: num.end };
  var u = unitAt(t, q.end);
  if(u){
    q.unit = u.u; q.end = u.end;
    if(!q.vague && t[q.end] && t[q.end].r === 'and' && t[q.end + 1] && t[q.end + 1].r === 'a' && t[q.end + 2] && t[q.end + 2].r === 'half'){
      q.n += 0.5; q.end += 3;
    }
  }
  return q;
}
/* the first clear amount said, with its unit (v3.9.3: answers to "How many …?") */
function firstQty(text){
  var t = toks(text);
  for(var i = 0; i < t.length; i++){ var q = readQty(t, i); if(q && !q.vague && q.n != null) return q; }
  return null;
}
/* every number said, in order: for the fifteen / fifty check */
function numbersIn(text){
  var t = toks(text), out = [], i = 0;
  while(i < t.length){
    var q = readNumber(t, i);
    if(q && !q.vague){ out.push(q.n); i = q.end; } else i++;
  }
  return out;
}
var TEEN_TEN = { 13: 30, 14: 40, 15: 50, 16: 60, 17: 70, 18: 80, 19: 90, 30: 13, 40: 14, 50: 15, 60: 16, 70: 17, 80: 18, 90: 19 };
/* The top words say 15 and another guess says 50 (or the other way round). */
function teenTen(text, alts){
  var mine = numbersIn(text);
  for(var a = 0; a < (alts || []).length; a++){
    var theirs = numbersIn(alts[a]);
    for(var j = 0; j < mine.length; j++){
      var pair = TEEN_TEN[mine[j]];
      if(pair != null && theirs.indexOf(pair) > -1 && theirs.indexOf(mine[j]) < 0) return { heard: mine[j], other: pair };
    }
  }
  return null;
}

/* ================= the words the brain listens for ================= */

/* [words, meaning, where]: 0 = only at the start, 1 = anywhere */
var VERBS = [
  [['undo', 'that'], 'undo', 0], [['undo', 'it'], 'undo', 0], [['undo'], 'undo', 0], [['scrap', 'that'], 'undo', 0], [['scratch', 'that'], 'undo', 0], [['take', 'that', 'back'], 'undo', 0],
  [['repeat', 'the', 'last', 'order'], 'repeat', 0], [['repeat', 'last', 'order'], 'repeat', 0], [['repeat', 'my', 'last', 'order'], 'repeat', 0],
  [['repeat', 'last'], 'repeat', 0], [['same', 'as', 'last', 'time'], 'repeat', 0], [['same', 'as', 'last', 'week'], 'repeat', 0],
  [['load', 'the', 'last', 'order'], 'repeat', 0], [['load', 'last', 'order'], 'repeat', 0], [['last', 'order', 'again'], 'repeat', 0],
  [['repeat'], 'repeat', 0], [['reorder'], 'repeat', 0],
  [['what', 'can', 'you', 'do'], 'help', 0], [['help'], 'help', 0],
  [['what', 'did', 'you', 'just', 'do'], 'last', 0], [['what', 'did', 'you', 'do'], 'last', 0], [['what', 'was', 'that'], 'last', 0],
  [['what', 'am', 'i', 'ordering'], 'read', 0], [['what', 'are', 'we', 'ordering'], 'read', 0], [['what', 'have', 'i', 'ordered'], 'read', 0],
  [['whats', 'left', 'on'], 'read', 0], [['whats', 'left'], 'read', 0], [['what', 'is', 'left'], 'read', 0],
  [['whats', 'on'], 'read', 0], [['what', 'is', 'on'], 'read', 0], [['whats', 'in'], 'read', 0], [['what', 'is', 'in'], 'read', 0],
  [['what', 'have', 'we', 'got'], 'read', 0], [['what', 'have', 'i', 'got'], 'read', 0], [['what', 'do', 'we', 'have'], 'read', 0], [['what', 'do', 'i', 'have'], 'read', 0],
  [['what', 'do', 'we', 'need'], 'read', 0], [['what', 'needs', 'doing'], 'read', 0],
  [['read', 'me'], 'read', 0], [['read', 'out'], 'read', 0], [['read', 'back'], 'read', 0], [['read'], 'read', 0],
  [['how', 'much'], 'read', 0], [['how', 'many'], 'read', 0], [['tell', 'me', 'whats', 'on'], 'read', 0],
  [['get', 'rid', 'of'], 'remove', 0], [['take', 'off'], 'remove', 0], [['take', 'away'], 'remove', 0], [['take', 'out'], 'remove', 0],
  [['knock', 'off'], 'remove', 0], [['remove'], 'remove', 0], [['scrap'], 'remove', 0], [['drop'], 'remove', 0], [['delete'], 'remove', 0],
  [['cancel'], 'remove', 0], [['no', 'more'], 'remove', 0], [['we', 'dont', 'need'], 'remove', 0], [['dont', 'need'], 'remove', 0],
  [['minus'], 'remove', 0], [['less'], 'remove', 0], [['ditch'], 'remove', 0], [['lose'], 'remove', 0], [['no'], 'remove', 0], [['take'], 'remove', 0],
  [['tick', 'off'], 'tick', 0], [['tick'], 'tick', 0], [['cross', 'off'], 'tick', 0], [['mark', 'as', 'done'], 'tick', 0], [['mark', 'done'], 'tick', 0],
  [['is', 'done'], 'tick', 1], [['are', 'done'], 'tick', 1], [['is', 'finished'], 'tick', 1], [['are', 'finished'], 'tick', 1],
  [['is', 'ready'], 'tick', 1], [['are', 'ready'], 'tick', 1], [['is', 'complete'], 'tick', 1], [['done'], 'tick', 1], [['finished'], 'tick', 1],
  [['completed'], 'tick', 1], [['ticked', 'off'], 'tick', 1], [['ticked'], 'tick', 1],
  /* v3.11.1 (his log, 13 Oct): "mark barbecue sauce as completed", "can I have the
     barbeque sauce marked as completed" (it learned "barbeque sauce marked" as a name) */
  [['marked', 'as', 'completed'], 'tick', 1], [['marked', 'as', 'complete'], 'tick', 1], [['marked', 'as', 'done'], 'tick', 1],
  [['marked', 'as', 'finished'], 'tick', 1], [['marked', 'done'], 'tick', 1], [['marked', 'off'], 'tick', 1],
  [['as', 'completed'], 'tick', 1], [['as', 'complete'], 'tick', 1], [['as', 'done'], 'tick', 1], [['as', 'finished'], 'tick', 1],
  [['mark', 'off'], 'tick', 0], [['mark'], 'tick', 0],
  [['untick'], 'untick', 0], [['un', 'tick'], 'untick', 0], [['uncheck'], 'untick', 0], [['isnt', 'done'], 'untick', 1], [['arent', 'done'], 'untick', 1],
  [['is', 'not', 'done'], 'untick', 1], [['not', 'done'], 'untick', 1], [['not', 'finished'], 'untick', 1],
  [['make', 'it'], 'set', 0], [['make', 'that'], 'set', 0], [['make', 'them'], 'set', 0], [['make'], 'set', 0], [['set'], 'set', 0],
  // v3.9.3: a correction ("no I meant 6 kilo"): sets the thing just talked about
  [['i', 'meant'], 'set', 0], [['i', 'mean'], 'set', 0], [['meant'], 'set', 0],
  [['change'], 'set', 0], [['update'], 'set', 0], [['should', 'be'], 'set', 1], [['only', 'need'], 'set', 0],
  [['get', 'ready', 'to', 'send'], 'send', 0], [['ready', 'to', 'send'], 'send', 0], [['send'], 'send', 0], [['text'], 'send', 0], [['submit'], 'send', 0],
  [['show', 'me'], 'open', 0], [['show'], 'open', 0], [['open', 'up'], 'open', 0], [['open'], 'open', 0], [['go', 'to'], 'open', 0],
  [['bring', 'up'], 'open', 0], [['pull', 'up'], 'open', 0], [['take', 'me', 'to'], 'open', 0], [['review'], 'open', 0],
  [['clear', 'out'], 'clear', 0], [['clear'], 'clear', 0], [['empty'], 'clear', 0], [['wipe'], 'clear', 0], [['reset'], 'clear', 0],
  [['chuck', 'in'], 'add', 0], [['chuck', 'on'], 'add', 0], [['chuck'], 'add', 0], [['throw', 'in'], 'add', 0], [['throw', 'on'], 'add', 0],
  [['bung', 'in'], 'add', 0], [['add', 'on'], 'add', 0], [['add'], 'add', 0], [['we', 'need'], 'add', 0], [['i', 'need'], 'add', 0],
  [['need'], 'add', 0], [['we', 'want'], 'add', 0], [['put', 'on'], 'add', 0], [['put', 'in'], 'add', 0], [['put'], 'add', 0],
  [['get', 'me'], 'add', 0], [['get', 'us'], 'add', 0], [['get'], 'add', 0], [['grab'], 'add', 0], [['order', 'more'], 'add', 0], [['order', 'some'], 'add', 0],
  [['order'], 'add', 0], [['top', 'up'], 'add', 0], [['another'], 'add', 0], [['more'], 'add', 0], [['plus'], 'add', 0], [['include'], 'add', 0]
].map(function(v){ return { w: v[0], verb: v[1], any: !!v[2] }; }).sort(function(a, b){ return b.w.length - a.w.length; });

/* "order" and "order more" mean the supplier list; "make" without a number means prep */
var ORDER_VERBS = { 'order': 1, 'order more': 1, 'order some': 1 };

var LISTS = [
  [['prep', 'list'], 'prep'], [['prep', 'lists'], 'prep'], [['prep', 'sheet'], 'prep'], [['to', 'do', 'list'], 'prep'],
  // v3.10.2: Google's "trip list" for "prep list" (his log, 12 Oct); "trip" alone is still nothing
  [['trip', 'list'], 'prep'], [['trip', 'lists'], 'prep'],
  // v3.11.1 (his log, 13 Oct): "what's on my purpose", "what's on my playlist"; "purple list" (12 Oct)
  [['purpose'], 'prep'], [['playlist'], 'prep'], [['play', 'list'], 'prep'], [['purple', 'list'], 'prep'],
  [['prep'], 'prep'], [['preps'], 'prep'], [['prepping'], 'prep'], [['prepped'], 'prep'], [['list'], 'list'], [['lists'], 'list'],
  [['orders'], 'order'], [['order'], 'order'], [['suppliers'], 'order'], [['supplier'], 'order'], [['ordering'], 'order']
].map(function(v){ return { w: v[0], list: v[1] }; });

var FILLERS = [
  ['hey', 'pluto'], ['hi', 'pluto'], ['ok', 'pluto'], ['okay', 'pluto'], ['pluto'], ['hey'], ['hi'], ['ok'], ['okay'], ['um'], ['uh'], ['er'], ['erm'],
  ['so'], ['right'], ['alright'], ['oh'], ['yeah'], ['well'], ['also'], ['now'], ['just'], ['actually'], ['and'], ['oi'],
  ['can', 'you', 'please'], ['could', 'you', 'please'], ['can', 'you'], ['could', 'you'], ['would', 'you'], ['will', 'you'], ['can', 'we'], ['could', 'we'],
  ['can', 'i', 'get'], ['could', 'i', 'get'], ['please'], ['i', 'want', 'to'], ['i', 'wanna'], ['i', 'would', 'like', 'to'], ['id', 'like', 'to'],
  ['i', 'need', 'you', 'to'], ['lets'], ['let', 'us'], ['mate'], ['chef'], ['bro'], ['go', 'ahead', 'and'], ['quickly']
];
var TRAIL = [['please'], ['thanks'], ['mate'], ['bro'], ['for', 'me'], ['for', 'us'], ['cheers'], ['as', 'well'], ['too'], ['thank', 'you'], ['now'], ['again'],
  // v3.9.3: a sentence cut off as he carried on ("… royal blue potatoes add some")
  ['add', 'some'], ['and', 'add'], ['add']];

/* v3.11.16 (his test, 17 Oct): words that never belong in a new item's name
   (a command, or a misheard "Hey Pluto"): no "Add it as a new product?" for them */
var NOT_A_NAME = { add: 1, remove: 1, put: 1, order: 1, ordering: 1, tick: 1, take: 1, can: 1, could: 1, would: 1, you: 1, please: 1,
  hey: 1, bluetooth: 1, pluto: 1, plutos: 1 };
function notAName(shown){ return clean(shown).split(' ').some(function(x){ return NOT_A_NAME[x]; }); }
var STOP = {
  the: 1, a: 1, an: 1, of: 1, to: 1, on: 1, onto: 1, in: 1, into: 1, for: 1, from: 1, off: 1, my: 1, our: 1, me: 1, us: 1,
  please: 1, with: 1, at: 1, just: 1, also: 1, too: 1, as: 1, well: 1, now: 1, today: 1, tonight: 1, tomorrow: 1, tomorrows: 1,
  yeah: 1, ok: 1, okay: 1, oh: 1, um: 1, uh: 1, mate: 1, bro: 1, chef: 1, pluto: 1, then: 1, actually: 1, instead: 1,
  again: 1, is: 1, are: 1, be: 1, was: 1, there: 1, theres: 1, we: 1, i: 1, you: 1, got: 1, have: 1, has: 1, some_more: 1,
  extra: 1, fresh: 0, usual: 1, normal: 1, regular: 1, total: 1, altogether: 1, all: 1, up: 1, back: 1, out: 1, over: 1,
  by: 1, this: 1, week: 1, next: 1, order: 0, am: 1, pm: 1, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1,
  saturday: 1, sunday: 1, ones: 1, one: 0, lot: 1, item: 1, items: 1, thing: 1, things: 1, stuff: 1, more: 1, another: 1,
  only: 1, about: 1, around: 1, roughly: 1, like: 1, maybe: 1, will: 1, can: 1, need: 1, want: 1, thanks: 1, cheers: 1,
  following: 1, below: 1   // v3.9.3: "add the following to the orders …"
};
var REFS = { it: 1, that: 1, them: 1, those: 1, these: 1, same: 1, thats: 1, its: 1 };
var CONJ = { and: 1, plus: 1, also: 1, then: 1, ',': 1 };
var QWORDS = { how: 1, what: 1, whats: 1, who: 1, whos: 1, why: 1, when: 1, whens: 1, where: 1, wheres: 1, which: 1,
  is: 1, are: 1, do: 1, does: 1, did: 1, tell: 1, was: 1, will: 1, should: 1, could: 1, can: 1 };
var TICK_WORDS = { done: 1, finished: 1, completed: 1, complete: 1, ticked: 1, ready: 1 };

/* Close words belong to Pluto (or to the panel in Chrome), never to the room */
var CLOSE = ['thank you', 'thank you very much', 'thanks', 'thanks mate', 'thanks a lot', 'cheers', 'cheers mate', 'thats all', 'thats it',
  'thats all thanks', 'thats it thanks', 'bye', 'goodbye', 'no worries', 'all good', 'nothing else', 'im done', 'all done', 'done',
  'stop', 'finished', 'never mind', 'nevermind', 'forget it', 'no thanks', 'nah thats it', 'nah thats all', 'thank you pluto', 'thanks pluto'];
function isClose(text){ return CLOSE.indexOf(clean(text)) > -1; }

/* Pluto's yes / no rules (master spec 8.2): top words only, four words or fewer */
var YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'correct', 'do it', 'send it', 'go ahead', 'yes please', 'yes do it', 'yeah do it',
  'yep do it', 'ok', 'okay', 'confirm', 'thats right', 'thats correct', 'right', 'yes thats right', 'yeah go ahead', 'go for it', 'please do'];
var NO = ['no', 'nope', 'nah', 'cancel', 'never mind', 'nevermind', 'stop', 'dont', 'no thanks', 'leave it', 'no dont', 'not now',
  'no cancel', 'nah leave it', 'cancel it', 'cancel that', 'forget it', 'wrong', 'thats wrong', 'no thats wrong'];
function yesNo(text){
  var c = clean(text).replace(/^(pluto|hey pluto) /, '').replace(/ (pluto|please|mate|thanks)$/, '');
  if(!c || c.split(' ').length > 4) return null;
  if(YES.indexOf(c) > -1) return 'yes';
  if(NO.indexOf(c) > -1) return 'no';
  return null;
}

/* ================= the timesheet: days and times (v3.9.6) =================
   His own hours only (almo-voice-brain.md section 5). Times are rounded to
   the nearest quarter hour, halfway up, and the read-back says the rounded
   time. A shift belongs to its service day: before 5 am counts as the night
   before. Dates are built from local date parts, never toISOString (UTC
   would put a Sydney morning on the day before). */
var TS_DAYS = ['wed', 'thu', 'fri', 'sat', 'sun'];
var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var DAY_FULL = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function dateKey(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function keyDate(k){ var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
function serviceDate(ms){
  var d = new Date(ms), s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  if(d.getHours() < 5) s.setDate(s.getDate() - 1);
  return dateKey(s);
}
function dayOf(k){ return DAY_KEYS[keyDate(k).getDay()]; }
function mondayOf(k){ var d = keyDate(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dateKey(d); }
/* the latest date that falls on that weekday, on or before the given date */
function lastDayOn(day, k){ var d = keyDate(k); d.setDate(d.getDate() - (d.getDay() - DAY_KEYS.indexOf(day) + 7) % 7); return dateKey(d); }
function dateSay(k){ var d = keyDate(k); return DAY_FULL[DAY_KEYS[d.getDay()]] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function toMin(hhmm){ var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; }
function toHHMM(min){ min = ((min % 1440) + 1440) % 1440; return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
function quarter(min){ return Math.round(min / 15) * 15; }   // halfway rounds up
function timeSay(hhmm){
  var m = toMin(hhmm);
  if(m == null) return '';
  if(m === 0) return 'midnight';
  if(m === 720) return '12 noon';
  var h = Math.floor(m / 60), mm = m % 60;
  return (h % 12 || 12) + (mm ? ':' + pad2(mm) : '') + (h < 12 ? ' am' : ' pm');
}
function hoursOf(start, end){
  var a = toMin(start), b = toMin(end);
  if(a == null || b == null) return 0;
  return ((b - a + 1440) % 1440) / 60;
}
/* "6 and three quarter hours"; anything not in quarters is said as digits,
   as the screen shows it */
function hoursSay(h){
  if(Math.abs(h * 4 - Math.round(h * 4)) > 1e-6) return fmt(h) + ' hours';
  var whole = Math.floor(h + 1e-9), part = Math.round((h - whole) * 4);
  if(!whole && part) return ['', 'a quarter of an hour', 'half an hour', 'three quarters of an hour'][part];
  return whole + (part ? ' ' + ['', 'and a quarter', 'and a half', 'and three quarter'][part] : '') + (whole === 1 && !part ? ' hour' : ' hours');
}

/* A time as he says it, the way Google writes it down: "10:15", "10.15",
   "10 15", "10 p.m.", "half past ten", "half ten", "quarter to 11",
   "twenty past 10", "ten fifteen", "midnight", "just now". Returns
   { h, m, mer: 'am' | 'pm' | 'abs' | null } or { now: true }, or null. */
var HOUR_W = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
var MIN_W = { five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, 'thirty five': 35, forty: 40, 'forty five': 45,
  fifty: 50, 'fifty five': 55, 'oh five': 5, 'o five': 5 };
function hourNum(w){ return /^\d{1,2}$/.test(w) ? +w : (HOUR_W[w] || null); }
function parseClock(text){
  var s = ' ' + String(text || '').toLowerCase().replace(/o\s*['’]?\s*clock/g, ' ')
    .replace(/[^a-z0-9:. ]+/g, ' ').replace(/(\d)\.(?!\d)/g, '$1 ').replace(/(\d)(?=[a-z])/g, '$1 ').replace(/\s+/g, ' ') + ' ';
  var H = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  var MW = '(5|10|20|25|five|ten|twenty|twenty five)';   // v3.9.10: "3 to 10" is a shift, not 9:57
  var MINS = '(fifteen|thirty|forty five|forty|fifty five|fifty|twenty five|twenty|thirty five|oh five|o five|ten|five)';
  var found = null, m;
  function at(re, fn){ if(found) return; m = re.exec(s); if(m){ var r = fn(m); if(r){ r.end = m.index + m[0].length; found = r; } } }
  at(new RegExp(' half past ' + H + ' '), function(x){ return { h: hourNum(x[1]), m: 30 }; });
  at(new RegExp(' quarter past ' + H + ' '), function(x){ return { h: hourNum(x[1]), m: 15 }; });
  at(new RegExp(' quarter to ' + H + ' '), function(x){ var h = hourNum(x[1]); return { h: h === 1 ? 12 : h - 1, m: 45 }; });
  at(new RegExp(' ' + MW + ' (?:minutes )?past ' + H + ' '), function(x){ var n = MIN_W[x[1]] || +x[1]; return n < 60 ? { h: hourNum(x[2]), m: n } : null; });
  at(new RegExp(' ' + MW + ' (?:minutes )?to ' + H + ' '), function(x){ var n = MIN_W[x[1]] || +x[1], h = hourNum(x[2]); return n < 60 ? { h: h === 1 ? 12 : h - 1, m: 60 - n } : null; });
  at(new RegExp(' half ' + H + ' '), function(x){ return { h: hourNum(x[1]), m: 30 }; });                        // "half ten"
  at(/ (\d{1,2})[:.](\d{2}) /, function(x){ return +x[2] < 60 ? { h: +x[1], m: +x[2] } : null; });
  at(/ (\d{1,2}) (\d{2}) /, function(x){ return +x[2] < 60 && +x[2] >= 10 ? { h: +x[1], m: +x[2] } : null; });   // "10 15"
  at(/ (\d)(\d{2}) /, function(x){ return +x[2] < 60 ? { h: +x[1], m: +x[2] } : null; });                        // "915"
  at(/ (1\d|2[0-3])(\d{2}) /, function(x){ return +x[2] < 60 ? { h: +x[1], m: +x[2] } : null; });               // "1015", "2230"
  at(new RegExp(' ' + H + ' ' + MINS + ' '), function(x){ return { h: hourNum(x[1]), m: MIN_W[x[2]] }; });     // "ten fifteen"
  at(/ midnight /, function(){ return { h: 0, m: 0, mer: 'abs' }; });
  at(/ (noon|midday) /, function(){ return { h: 12, m: 0, mer: 'abs' }; });
  at(new RegExp(' ' + H + ' '), function(x){ return { h: hourNum(x[1]), m: 0 }; });
  if(!found){
    if(/ (now|just now|right now|just then|this minute|just finished|just started) /.test(s)) return { now: true };
    return null;
  }
  if(found.h == null || found.h > 24 || found.m > 59) return null;
  if(!found.mer){
    var after = s.slice(found.end - 1);
    if(found.h > 12 || found.h === 0 || found.h === 24) found.mer = 'abs';
    else if(/^ ?(a\s*\.?\s*m\b|in the morning)/.test(after)) found.mer = 'am';
    else if(/^ ?(p\s*\.?\s*m\b|in the (afternoon|evening)|at night|tonight)/.test(after)) found.mer = 'pm';
    else found.mer = null;
  }
  return { h: found.h, m: found.m, mer: found.mer };
}
/* Minutes after midnight, rounded to a quarter. A finish is the first time
   after the start ("10" after a 3:30 start is 10 pm, "12:30" is half past
   midnight); a start without am or pm is the one nearest the rostered time,
   or with no roster, 5 to 11 is morning and 12 to 4 is afternoon. */
function clockMin(p, near, after){
  var h12 = p.h % 12;
  if(p.mer === 'abs') return quarter((p.h % 24) * 60 + p.m) % 1440;
  if(p.mer === 'am') return quarter(h12 * 60 + p.m) % 1440;
  if(p.mer === 'pm') return quarter((h12 + 12) * 60 + p.m) % 1440;
  var c = [quarter(h12 * 60 + p.m) % 1440, quarter((h12 + 12) * 60 + p.m) % 1440];
  if(after != null){
    var fwd = function(x){ return ((x - after + 1440) % 1440) || 1440; };
    return fwd(c[0]) <= fwd(c[1]) ? c[0] : c[1];
  }
  if(near != null){
    var dist = function(x){ var d = Math.abs(x - near) % 1440; return Math.min(d, 1440 - d); };
    return dist(c[0]) <= dist(c[1]) ? c[0] : c[1];
  }
  return p.h >= 5 && p.h <= 11 ? c[0] : c[1];
}
/* "add today's timesheet", "do my timesheet", "add my hours": add.
   v3.9.7: only a clear add / do / fill in / put in writes. A question, or
   anything else ("whats my timesheet this week", his log of 11 Oct, which
   v3.9.6 took as add), only reads: when unsure, read, never write. */
function tsIntent(text){
  var c = clean(text).replace(/^(hey pluto|ok pluto|pluto) /, '');
  if(!/\b(time ?sheets?|my hours|how many hours|hours (this weeks?|last weeks?|so far))\b/.test(c)) return null;
  if(/\b(send|submit|share|email)\b/.test(c)) return 'send';
  if(/^(whats|what|how|hows|show|tell|read|check|is|are|was|were|did|do i|have i|any|when|which|whens|give me|can you (tell|read|check|show)|could you (tell|read|check|show))\b/.test(c)) return 'read';
  if(TS_EDIT.test(c) || (TS_SE.test(c) && parseClock(text))) return 'edit';   // v3.9.10
  if(/\b(add|do|fill|put|log|enter|update|record|save|write|input|punch|clock)\b/.test(c)) return 'add';
  return 'read';
}
/* v3.9.10: editing a day ("remove the Sunday", "change Wednesday's finish to
   10:30", "I'm off Sunday"), his heard log of 11 Oct */
var TS_CLEAR = /\b(remove|clear|delete|wipe|scrap|erase|take off|cancel|day off)\b|\b(im|i am|i was|was) off\b/;
var TS_EDIT = /\b(remove|clear|delete|wipe|scrap|erase|take off|cancel|day off|change|set|edit|correct|fix|move)\b|\b(im|i am|i was|was) off\b/;
var TS_SE = /\b(start|started|starting|finish|finished|finishing|end|ended)\b/;
var TS_DAYWORD = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b(today|todays|tonight|tonights|yesterday|yesterdays|last night)\b/;
/* Right after a timesheet answer, a short follow-up with a day in it is
   about the timesheet too ("remove the Sunday", "and Saturday?"); the room
   checks first that it names no order or prep item. */
function tsFollow(text){
  var c = clean(text);
  if(!TS_DAYWORD.test(c) && !TS_SE.test(c)) return null;
  if(TS_EDIT.test(c) || (TS_SE.test(c) && parseClock(text))) return 'edit';
  if(TS_DAYWORD.test(c) && c.split(' ').length <= 5) return 'read';
  return null;
}
/* two times in one breath: "3:30 to 10:15", "from 4 till 10" (not "quarter to 11") */
function twoClocks(text){
  var s = String(text || ''), re = /\s(?:to|till|til|until|-)\s/gi, m, MINS_TO = /\b(quarter|half|five|ten|twenty|twenty five|5|10|20|25)\s*$/i;
  while((m = re.exec(s))){
    var left = s.slice(0, m.index), right = s.slice(m.index + m[0].length);
    // "quarter to 11", "ten to 11": one time, unless a time already came before it
    if(MINS_TO.test(left) && !parseClock(left.replace(MINS_TO, ''))) continue;
    var a = parseClock(left), b = parseClock(right);
    if(a && b && !a.now && !b.now) return [a, b];
  }
  return null;
}
/* the day a sentence names: today / tonight, yesterday / last night, or a
   weekday (the latest one, on or before today) */
function tsDayIn(text, today){
  var c = clean(text);
  if(/\b(yesterday|yesterdays|last night)\b/.test(c)){ var d = keyDate(today); d.setDate(d.getDate() - 1); return dateKey(d); }
  if(/\b(today|todays|tonight|tonights)\b/.test(c)) return today;   // v3.9.10
  for(var i = 0; i < DAY_KEYS.length; i++){
    var w = DAY_FULL[DAY_KEYS[i]].toLowerCase();
    if(new RegExp('\\b' + w + 's?\\b').test(c)) return lastDayOn(DAY_KEYS[i], today);
  }
  return null;
}

/* ================= the roster, read only (v3.9.11) =================
   His questions (11 Oct): "what was last week's roster?" → "Which day, or
   the whole week?" → "Wednesday: Suraj on pasta at 4 pm, …"; "how many
   worked on Wednesday?"; "who was on pasta last week?"; this week's and next
   week's too. It only reads: nothing here changes the roster. */
function addDays(k, n){ var d = keyDate(k); d.setDate(d.getDate() + n); return dateKey(d); }
var RO_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
var RO_STATION_SAY = { KH: 'kitchen hand' };
var RO_PIZZA = ['Oven', 'Dough', 'Toppings', 'Finisher'];   // v3.9.12: the pizza section (owner)
/* names: the staff names, lower case, so "is Anil on" and "when is Nathan
   working" count; an item ("is mozz on the order") doesn't */
function rosterIntent(text, names){
  var c = clean(text).replace(/^(hey pluto|ok pluto|pluto) /, '');
  if(/\brosters?\b|\brostered\b/.test(c)) return true;
  if(/\bwho(s| is| was| were| are| will be)? (on|working|in|rostered|starting|starts|finishing)\b|\bwho (worked|works|is working|was working)\b/.test(c)) return true;
  if(/\bwho else\b/.test(c)) return true;   // v3.10.1 (his log): "who else is working on Wednesday"
  if(/\bhow many (people |staff |of us |chefs |cooks )?(worked|working|are on|were on|on|rostered|in)\b/.test(c)) return true;
  if(/\b(am i|do i) (on|working|rostered|work)\b|\b(when|what days) (am i|do i)\b/.test(c)) return true;
  var who = (names || []).filter(function(n){ return n && new RegExp('\\b' + n + '\\b').test(c); });
  for(var i = 0; i < who.length; i++){
    var n = who[i];
    if(new RegExp('\\b(is|was|does|did) ' + n + ' (on|working|rostered|work)\\b|\\b(when|what days) (is|was|does|did) ' + n + '\\b|\\b' + n + 's (shifts?|days|roster)\\b').test(c)) return true;
    // v3.11.1 (his log, 13 Oct): "what date is he off" (he = Anil), and his request: someone's hours
    if(new RegExp('\\b(is|was|are) ' + n + ' off\\b|\\b' + n + 's? (days? )?off\\b|\\bhours? (is|does|did|has|will|for) ' + n + '\\b|\\b' + n + 's hours\\b').test(c)) return true;
  }
  return false;
}
/* v3.9.13 (his log, 11 Oct): "add me on roster for Friday", "add rabindra on
   Wednesday starting at 9", "create new roster" were answered as questions
   ("You're not on the roster on Friday"), which reads as if it tried. Until
   he describes building the roster by voice, changing it gets an honest
   "not yet". A change is a change word with the roster, or with a staff name
   and a day, a time or a station. */
var RO_WRITE = /\b(add|put|set|change|move|swap|remove|take off|drop|create|make|build|schedule|book|fill|start a|new)\b/;
var RO_WHEN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b(today|tomorrow|tonight|start|starting|finish|finishing|shift|shifts)\b|\b(on|in) (pasta|oven|dough|toppings|finisher|kh|pizza)\b|\bat \d/;
function rosterWrite(text, names){
  var c = clean(text).replace(/^(hey pluto|ok pluto|pluto) /, '');
  if(/^(whats|what|how|hows|who|whos|when|is|are|was|were|did|do i|have i|any|which|show|tell|read|check)\b/.test(c)) return false;
  if(!RO_WRITE.test(c)) return false;
  if(/\brosters?\b|\brostered\b/.test(c)) return true;
  return (names || []).some(function(n){ return n && new RegExp('\\b' + n + '\\b').test(c); }) && RO_WHEN.test(c);
}

/* v3.9.13 (owner, 11 Oct: "when I ask what can you do, or can you do XYZ, it
   should be able to tell what it can or cannot"): "can you …" with nothing
   to act on is a question about The Pass itself, answered honestly. A real
   command said politely ("can you add 2 kilos of mozz") still just runs. */
var HELP_SAY = 'I can add, change and take things off your orders and the prep list, tick prep off, read them back, get an order ready to send, fill in and read your timesheet, and read and build the roster.';
var HELP_TRY = "Try 'add 2 kilos of mozzarella', 'add today's timesheet' or 'let's do next week's roster'.";
/* v3.11.6 (his log, 14 Oct: "show me the recipe for polenta" asked "Did you
   mean …?" across every list, then opened the prep list, and learned "recipe
   polenta" as a name): a sentence with "recipe" in it is about his recipe
   book. These words around the name are dropped; what's left is the name. */
var RECIPE_FILL = {};
('show me the a an recipe recipes for of open up pull bring read get give see let lets look at find can could you please i want to need ' +
 'what whats is my our how do make it out go we have got on screen that this just hey pluto ok whole full its not showing shows needs need opened there here all').split(' ').forEach(function(w){ RECIPE_FILL[w] = 1; });
function recipeWords(text){
  var c = clean(text);
  if(!/\brecipes?\b/.test(c)) return null;
  return c.split(' ').filter(function(w){ return w && !RECIPE_FILL[w]; });
}
function canTopic(text){
  var c = clean(text).replace(/^(hey pluto|ok pluto|pluto) /, '');
  if(!/^(can you|could you|are you able to|do you know how to|will you be able to|is it possible to)\b/.test(c)) return null;
  if(/\brosters?\b|\brostered\b|\bshifts?\b/.test(c)) return RO_WRITE.test(c) && !/\b(read|tell|check|show|say)\b/.test(c) ? 'roster-write' : 'roster-read';
  if(/\btime ?sheets?\b|\bmy hours\b/.test(c)) return 'timesheet';
  if(/\b(send|email|text|message|call|ring)\b/.test(c)) return 'send';
  if(/\brecipes?\b|\bhow (do|to) (i )?(make|cook)\b/.test(c)) return 'recipe';
  if(/\btrains?\b|\bbus(es)?\b/.test(c)) return 'trains';
  if(/\b(remember|note|notes|remind|reminder|alarm|timer|calendar)\b/.test(c)) return 'notyet';
  if(/\bprep\b/.test(c)) return 'prep';
  if(/\b(order|orders|ordering|supplier|suppliers)\b/.test(c)) return 'orders';
  return 'other';
}
var CAN_SAY = {
  'roster-write': "Yes. Say 'let's do next week's roster', or a change like 'swap Nathan for Axel on Thursday'.",
  'roster-read': "Yes. Ask me 'who's on tonight?', 'how many worked on Wednesday?' or 'what was last week's roster?'.",
  'timesheet': "Yes. Say 'add today's timesheet', change a day, or ask 'how many hours this week?'. Sending it to accounts is still you, on the Timesheet screen.",
  'send': "I can get an order ready to send, but you tap Send yourself. I can't send messages for you.",
  'recipe': "Yes, I can open one. Say 'show me the pizza sauce recipe'.",   // v3.11.6
  'trains': "Not here. RK Trips does the trains.",
  'notyet': "Not yet. Reminders and notes are coming with Pluto.",
  'prep': "Yes. Say 'add pizza sauce to the prep list', or 'pizza sauce is done'.",
  'orders': "Yes. Say what to add, change or take off, like 'add 2 kilos of mozzarella to the Aziz order'.",
  'other': "I'm not sure I can. I can help with orders, the prep list, your timesheet and the roster."
};

/* ================= building the roster by voice: the words (v3.10.0) =================
   His spec of 11 Oct (pluto-roster-spec.md; his decisions are in the box at
   its top). roster-engine.js holds the rules and makes every change; these
   only find, in what he said, the people, days, times and kind of change.
   No AI: what can't be pinned down is asked about, never guessed. */
var RB_KEY = 'order-chit-roster-voice';         // the session: which week, which days are done
var RB_NAMES_KEY = 'order-chit-roster-names';   // a misheard name he picked: heard word -> staff id
var RB_LIVE_MS = 10 * 60 * 1000;                // how long a bare "same" or "next" still means the roster
var RB_OWNER_SAID = ['ravindra', 'robindra', 'rubindra'];   // his own name as Google heard it (log, 11 Oct)
var RB_DAY = { wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun', monday: 'mon', tuesday: 'tue' };
var RB_STATION = { oven: 'Oven', dough: 'Dough', pasta: 'Pasta', toppings: 'Toppings', topping: 'Toppings', finisher: 'Finisher', kh: 'KH' };
var RB_PRON = { him: 1, her: 1, them: 1, he: 1, she: 1, they: 1, hes: 1, shes: 1, theyre: 1 };
/* words that are never a person's name, so whatever is left over in a
   sentence about the roster is a name it doesn't know ("put Sam on") */
var RB_WORDS = {};
('a about actually add after afternoon again all also am an and another any anyone anybody are arent around as at away back be been bin bit both bring but by '
 + 'can cant change chuck clear close closed come coming copy could cover covering covers cut day days did didnt do does doesnt done dont down drop '
 + 'each early earlier end ends evening every everybody everyone everything finish finished finishes finishing first for forward from get gets go goes going gone '
 + 'got had half hand has have he hell her here hers hes hey hi him his home hour hours how i id if ill im in instead into is isnt it its just keep kitchen knock '
 + 'last later late leave leaves leaving lets like lot make me midday midnight min mins minute minutes more morning move my myself need needs new next night '
 + 'no nobody none noon not now oclock of off ok okay on one only onto or our out over past people person please plus pop pull push put quarter rather really '
 + 'remove replace replacing right roster rostered rosters same say scratch see set she shift shifts should sick sir so some someone somebody start started '
 + 'starting starts staff stay stays stick sub substitute swap switch take team than thanks that thats the them then there they theyre this those though till '
 + 'til time times to today tomorrow tonight too until up us want was way we week weekend weeks well were what whats when where which who whos whole why will '
 + 'with without wont work worked working works would yeah yep yes yesterday you youre your mate chef bro pluto oh um uh er so trade swop instead place '
 + 'two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty ninety sixty pm am ready sorry nah nope yup ah also '
 + 'station stations pizza shift ok cool great good fine perfect thank cheers going doing does day same again wed thu fri sat sun cross strike bump kick lose '
 + 'ditch delete cancel scrap wipe clear skip later leave pause stop continue resume carry finish save publish send share read show open week give book '
 + 'schedule throw have their there these other another else anything nothing something next previous before goes went off out let us '
 + 'prep preps list lists order orders ordering supplier suppliers timesheet timesheets recipe recipes item items stuff thing things menu '
 // v3.11.19 (his log, 18 Oct: "remove the next roster entirely and will build it again" was "I don't have Entirely")
 + 'entirely completely totally fully altogether build rebuild redo restart afresh').split(' ')
  .concat(Object.keys(RB_DAY), Object.keys(RB_STATION), Object.keys(STOP), Object.keys(UNIT_WORDS)).forEach(function(w){ if(w) RB_WORDS[w] = 1; });

/* Times keep their colon as a dot ("9:00" -> "9.00"), which parseClock reads */
function rbClean(s){ return clean(String(s == null ? '' : s).replace(/(\d):(\d)/g, '$1.$2')).replace(/^(hey pluto|ok pluto|okay pluto|hi pluto|pluto) /, ''); }
function rbDayOf(w){ return RB_DAY[w] || (/s$/.test(w) ? RB_DAY[w.slice(0, -1)] : null) || null; }
function rbNth(n){ var t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')); }
/* "Wednesday the 14th" */
function rbDateSay(k){ var d = keyDate(k); return DAY_FULL[DAY_KEYS[d.getDay()]] + ' the ' + rbNth(d.getDate()); }
/* A roster time, said the way he says it: "4", "half 5", "quarter past 6";
   mornings and late nights keep their am or pm ("9 am", "10 pm"). */
function rbTime(t){
  var m = toMin(t);
  if(m == null) return '';
  var h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12;
  if(h < 12 || h >= 22) return timeSay(t);
  if(h === 12) return mm === 0 ? '12 noon' : mm === 30 ? 'half 12' : timeSay(t);
  if(mm === 0) return String(h12);
  if(mm === 30) return 'half ' + h12;
  if(mm === 15) return 'quarter past ' + h12;
  if(mm === 45) return 'quarter to ' + (h12 + 1);
  return h12 + ':' + pad2(mm);
}
/* "an hour later", "half an hour earlier", "push him back an hour" */
var RB_REL = [
  [/\b(an|one|a) hour and a half\b|\b(90|ninety) (minutes|mins)\b/, 90], [/\bhalf an hour\b|\bhalf hour\b|\b(30|thirty) (minutes|mins)\b/, 30],
  [/\b(a )?quarter of an hour\b|\b(15|fifteen) (minutes|mins)\b/, 15], [/\b(45|forty five) (minutes|mins)\b/, 45],
  [/\b(2|two) hours\b/, 120], [/\b(3|three) hours\b/, 180], [/\b(an|one|a) hour\b|\b(60|sixty) (minutes|mins)\b/, 60],
  [/\b(20|twenty) (minutes|mins)\b/, 20], [/\b(10|ten) (minutes|mins)\b/, 10], [/\b(5|five) (minutes|mins)\b/, 5]
];
function rbRel(c){
  var dir = /\b(later|back|after)\b/.test(c) ? 1 : /\b(earlier|forward|forwards|sooner|before)\b/.test(c) ? -1 : 0;
  if(!dir) return null;
  for(var i = 0; i < RB_REL.length; i++){
    var m = RB_REL[i][0].exec(c);
    if(m) return { minutes: dir * RB_REL[i][1], cut: (c.slice(0, m.index) + ' ' + c.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
  }
  return null;
}
/* A spoken start as "HH:MM". am / pm / a 24-hour time said aloud wins;
   a bare hour follows his rule (roster-engine bareTime), which may ask. */
function rbStartOf(p, who, E){
  if(!p || p.now) return null;
  var h = p.h, m = p.m || 0;
  if(p.mer === 'abs') return { time: toHHMM((h % 24) * 60 + m) };
  if(p.mer === 'am') return { time: toHHMM((h % 12) * 60 + m) };
  if(p.mer === 'pm') return { time: toHHMM((h % 12 + 12) * 60 + m) };
  return E.bareTime(h, m, who);
}
/* A finish is the first such time after the start ("till 1" is 1 am) */
function rbEndOf(p, start){
  if(!p || p.now) return null;
  var h = p.h, m = p.m || 0;
  if(p.mer === 'abs') return toHHMM((h % 24) * 60 + m);
  if(p.mer === 'am') return toHHMM((h % 12) * 60 + m);
  if(p.mer === 'pm') return toHHMM((h % 12 + 12) * 60 + m);
  var s = toMin(start) || 0, c = [(h % 12) * 60 + m, (h % 12 + 12) * 60 + m];
  var fwd = function(x){ return ((x - s + 1440) % 1440) || 1440; };
  return toHHMM(fwd(c[0]) <= fwd(c[1]) ? c[0] : c[1]);
}
var RB_END = /\b(finish|finishes|finishing|finished|leave|leaves|leaving|knock off|knocks off|knocking off|off at|until|till|til|go home|goes home|going home|end|ends|ending|done at|done by|out at|out by)\b/;
var RB_ENDCLEAR = /\b(no (early )?finish|(till|until|til) (close|closing|the end|late|its done|the work is done|the jobs done|everythings done)|stays? (on|till|until|late)|full shift|when (its|it is|the work is|works|all the job is|the jobs|everythings) done)\b/;
/* The times in one clause: a start, a finish, or "3 till 9" */
function rbTimes(c){
  var out = {};
  if(RB_ENDCLEAR.test(c)){ out.endClear = true; c = c.replace(RB_ENDCLEAR, ' '); }
  var two = twoClocks(c);
  if(two){ out.start = two[0]; out.end = two[1]; return out; }
  var em = RB_END.exec(c);
  if(em){
    var a = parseClock(c.slice(0, em.index)), b = parseClock(c.slice(em.index));
    if(a && !a.now) out.start = a;
    if(b && !b.now) out.end = b;
    return out;
  }
  var p = parseClock(c);
  if(p && !p.now) out.start = p;
  return out;
}
/* Which staff a word is. Exact (name, first name, a name he picked before,
   his own name as misheard) is sure; a sound-alike is sure only when it's
   close and alone, otherwise it's asked about. */
function rbIndex(staff, me){
  return (staff || []).map(function(s){
    var full = clean(s.name), keys = [full, full.split(' ')[0]];
    if(s.id === me) keys = keys.concat(RB_OWNER_SAID);
    return { id: s.id, name: s.name, keys: uniq(keys.filter(Boolean)) };
  });
}
function rbMatch(w, idx, learned){
  if(!w || /^\d/.test(w)) return null;
  var base = w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : null;   // "anils"
  var hit = idx.filter(function(p){ return p.keys.indexOf(w) > -1 || (base && p.keys.indexOf(base) > -1); });
  if(hit.length) return { ids: uniq(hit.map(function(p){ return p.id; })), sure: true };
  if(learned && learned[w] && idx.some(function(p){ return p.id === learned[w]; })) return { ids: [learned[w]], sure: true };
  if(RB_WORDS[w] || w.length < 3) return null;
  var scored = idx.map(function(p){
    return { id: p.id, s: Math.max.apply(null, p.keys.map(function(k){ return k.indexOf(' ') < 0 ? wordLike(w, k) : 0; })) };
  }).filter(function(x){ return x.s >= 0.7; }).sort(function(a, b){ return b.s - a.s; });
  if(!scored.length) return null;
  var close = scored.filter(function(x){ return scored[0].s - x.s < 0.1; });
  if(close.length > 1) return { ids: close.map(function(x){ return x.id; }), sure: false, word: w };
  return { ids: [scored[0].id], sure: scored[0].s >= 0.75, word: w };
}
var RB_CLAUSE_VERB = /^(put|add|have|get|bring|stick|pop|chuck|throw|book|schedule|swap|switch|sub|replace|change|make|move|push|pull|take|remove|drop|cut|ditch|scratch|knock|start|starts|finish|finishes|leave|leaves|give|set|shift|go|goes|skip|clear|wipe|copy|keep|go|back|bump|kick|lose)$/;
/* One sentence as clauses: "swap Z for W and make him start at 3" is two,
   "Y and Z at 5" is one, "X at 4 and Y at 5" is two. find(word) is rbMatch. */
function rbClauses(text, find){
  var c = rbClean(String(text || '').replace(/,/g, ' qqc ')).replace(/\bkitchen hand\b/g, 'kh').replace(/\b\d{1,2} (st|nd|rd|th)\b/g, ' ')
    .replace(/\b(tell|give|show|read|send) me\b/g, '$1');   // v3.10.1: "tell me …" isn't "put me on"
  var raw = [], cur = [];
  c.split(' ').forEach(function(w){
    if(w === 'qqc' || w === 'and' || w === 'then' || w === 'also' || w === 'plus' || w === 'but'){ raw.push(cur); cur = []; }
    else if(w) cur.push(w);
  });
  raw.push(cur);
  raw = raw.filter(function(x){ return x.length; });
  var personIn = function(ws){ return ws.some(function(w, i){ return RB_PRON[w] || w === 'me' || w === 'myself' || (find(w) && !RB_WORDS[w]) || ((w === 'i' || w === 'im') && i === 0); }); };
  var timeIn = function(ws){ var s = ws.join(' '); return !!(rbRel(s) || parseClock(s)); };
  var out = [];
  raw.forEach(function(ws){
    var prev = out[out.length - 1];
    // a new clause starts at a verb, or at a person after a clause that already had its time
    if(!prev || RB_CLAUSE_VERB.test(ws[0]) || (ws[0] === 'go' || ws[0] === 'actually') || (timeIn(prev) && personIn(ws))) out.push(ws.slice());
    else out[out.length - 1] = prev.concat(['and'], ws);
  });
  return out.map(function(ws){ return ws.join(' '); });
}
/* the words that may be a name nobody has told it about: in a command of
   12 words or fewer, written with a capital when the words have capitals */
function rbNewNames(text, itemWords){
  var raw = String(text || ''), words = raw.split(/\s+/).filter(Boolean);
  if(words.length > 12) return {};
  /* v3.10.1 (his log, 12 Oct: "add chop parsley", "add pictures of to the
     prep list", "add roasted red peppers to the purple list" asked to add
     Chop, Pictures, Purple to the staff): a sentence with a list word or a
     product or prep word is about the orders or the prep list, so nothing in
     it is a new name. Stations ("on pasta") don't count. */
  var said = words.map(function(w){ return clean(w); }).filter(Boolean);
  if(said.some(function(k2){ return /^(list|lists|prep|order|orders)$/.test(k2)
      || (itemWords && !RB_STATION[k2] && !RB_STATION[k2.replace(/s$/, '')] && k2 !== 'pizza' && (itemWords[stem(k2)] || itemWords[k2])); })) return {};
  var caps = /[A-Z]/.test(raw.replace(/^\W*\w/, '').replace(/\bI\b|\bI'/g, '')), out = {};
  words.forEach(function(w){
    var k = clean(w).replace(/s$/, ''), k2 = clean(w);
    if(itemWords && (itemWords[stem(k2)] || itemWords[k2])) return;   // a word from a product or prep item ("cream", "garlic")
    if(!caps || /^[A-Z]/.test(w)){ if(k2) out[k2] = 1; if(k) out[k] = 1; }
  });
  return out;
}
/* What one clause says: the people (in order), days, times, a station,
   "an hour later", everyone, all week; rbKind then reads the kind of change. */
function rbClause(c, find, maybeNew){
  var o = { text: c, people: [], unknown: [], days: [], last: false, allWeek: false, station: null, rel: null, everyone: false };
  var rel = rbRel(c);
  if(rel){ o.rel = rel.minutes; c = rel.cut; }
  if(/\b(all week|every day|everyday|each day|the whole week|whole week|all the days|every shift|all days|the week)\b/.test(c)) o.allWeek = true;
  if(/\b(everyone|everybody|all of them|the lot|the whole team|all the staff|the team|all of us)\b/.test(c)) o.everyone = true;
  var tk = c.split(' ').filter(Boolean), shape = [];
  tk.forEach(function(w, i){
    var dk = rbDayOf(w);
    if(dk){ o.days.push(dk); if(tk[i - 1] === 'last') o.last = true; shape.push('D'); return; }
    if(RB_STATION[w] && /^(on|in|doing|at|for|the)$/.test(tk[i - 1] || '')){ o.station = RB_STATION[w]; shape.push('S'); return; }
    if(w === 'me' || w === 'myself' || ((w === 'i' || w === 'im' || w === 'ill') && /^(on|in|off|at|start|starting|finish|finishing|work|working|leave|leaving|out|be|am|will)$/.test(tk[i + 1] || ''))){
      o.people.push({ me: true, at: i }); shape.push('P'); return;
    }
    if(RB_PRON[w]){ o.people.push({ pron: true, at: i, word: w }); shape.push('P'); return; }
    var m = find(w);
    if(m && !(RB_WORDS[w] && !m.sure)){ o.people.push({ ids: m.ids, sure: m.sure, word: w, at: i }); shape.push('P'); return; }
    if(!RB_WORDS[w] && !/^\d/.test(w) && w.length > 1 && !/^(st|nd|rd|th)$/.test(w) && (!maybeNew || maybeNew[w])){ o.unknown.push({ word: w, at: i }); shape.push('U'); return; }
    shape.push(w);
  });
  o.tk = tk;
  o.ty = shape.map(function(x){ return /^[PUDS]$/.test(x) ? x : ''; });
  o.shape = ' ' + shape.join(' ') + ' ';
  var t = rbTimes(c);
  o.start = t.start || null; o.end = t.end || null; o.endClear = !!t.endClear;
  return o;
}

/* ================= aliases: how the kitchen says the names =================
   From almo-voice-brain.md section 7 (lines marked "check" there are still
   guesses). Products are keyed by their id, which survives renames; prep
   items by the words in their name. Taught words (from "Did you mean…")
   are added on top, per phone. */
var PRODUCT_ALIASES = {
  p35: ['fior di latte', 'fiordilatte', 'fior', 'fiore', 'fdl', 'fear the latte', 'fior de latte', 'fiore di latte', 'for de latte', 'fear de latte', 'fior di late'],
  az01: ['mozz', 'mozza', 'mozzarella', 'mozarella', 'mozzerella', 'moz', 'mots', 'mozzarella cheese'],
  az02: ['parm', 'parmo', 'parmigiano', 'parmesan cheese', 'parmesan'],
  az03: ['ricotta cheese'],
  az05: ['mascarpone', 'marscapone', 'mascapone', 'mask a pony', 'mascarpone cheese'],
  az06: ['cream'],
  az07: ['milk'],
  az08: ['butter'],
  az15: ['savoiardi', 'sav fingers', 'lady fingers', 'ladyfingers', 'sponge fingers', 'biscotti', 'biscotti fingers'],
  az17: ['caramel', 'top n fill', 'top and fill', 'nestle caramel', 'top in fill'],
  p3: ['squid', 'loligo', 'lolly squid', 'calamari', 'lolligo', 'loli squid', 'loligo squid'],
  p39: ['calamarata'],
  p7: ['kransky', 'cransky', 'kranski', 'kransky sausages'],
  p4: ['speck', 'spec', 'speak'],
  p9: ['sausage mix', 'italian sausage', 'italian sausage mix', 'thick sausage mix'],
  p2: ['prawns', 'shrimp', 'king prawns', 'raw prawns', 'frozen prawns', 'prawn'],
  p37: ['gnocchi', 'nokey', 'nyocki', 'nocchi', 'nyoki', 'yoki'],
  p11: ['pork belly'],
  az21: ['pomace', 'pumice oil', 'pomace oil', 'pumice'],
  az20: ['olive oil', 'evoo'],
  az31: ['calabrian chilli', 'chilli paste', 'muraca', 'calabrian chili', 'chili paste', 'calabrian'],
  az36: ['pickled peppers', 'durra', 'pickled pepper'],
  az28: ['ketchup', 'tomato sauce'],
  az48: ['dough balls', 'dough ball', 'buvetti', 'frozen dough', 'dough'],
  p36: ['lasagne sheets', 'lasagna sheets', 'lasagne', 'lasagna'],
  az32: ['pizza sauce base', 'pizza base sauce', 'mutti'],
  az33: ['tinned tomatoes', 'tinned tomato', 'canned tomatoes'],
  az42: ['paprika'],
  az43: ['oregano'],
  az47: ['chilli flakes', 'chili flakes'],
  az46: ['black pepper', 'pepper'],
  p40: ['pep', 'pepperoni', 'peperoni', 'pepperonis', 'pepperoncini'],
  p1: ['chicken', 'thigh', 'chicken thigh', 'thighs', 'chicken thighs'],
  p25: ['cucumber', 'lebanese cucumber', 'lebs', 'leb cucumber', 'cucumbers', 'lebanese cucumbers'],
  p27: ['burnet', 'salad burnet', 'burnette'],
  p17: ['potatoes', 'royal blues', 'royal blue', 'potato', 'spuds'],
  p28: ['red onion', 'red onions', 'spanish onion'],
  p18: ['white onion', 'white onions', 'peeled onion', 'peeled onions'],
  p22: ['cherry toms', 'cherry tomatoes', 'cherry tomato'],
  p23: ['vine toms', 'vine tomatoes', 'vine tomato'],
  p13: ['flats', 'flat mushrooms', 'flat mushroom', 'flat whites'],
  p12: ['sliced mushrooms', 'button mushrooms', 'sliced mushroom', 'button mushroom'],
  p14: ['capsicum', 'green capsicum', 'green caps', 'caps'],
  p19: ['lemons'],
  p15: ['pineapples']
};
/* [words that must all be in the prep item's name, what he says] */
var PREP_ALIASES = [
  [['cafe', 'paris'], ['cdp', 'cafe de paris', 'cafe de paris butter', 'cafe paris']],
  [['confit', 'garlic', 'cream'], ['garlic cream']],
  [['confit', 'garlic'], ['confit', 'conf garlic']],
  [['ganache'], ['ganache', 'gnash', 'choc ganache', 'chocolate ganache']],
  [['mac', 'cheese'], ['mac', 'mac and cheese', 'mac n cheese', 'mac balls', 'macaroni cheese']],
  [['tiramisu'], ['tira', 'tiramisu']],
  [['pesto'], ['pesto', 'basil pesto']],
  [['slurry'], ['slurry', 'flour slurry']],
  [['caramel', 'cream'], ['caramel cream', 'donut cream', 'doughnut cream']],
  [['brisket'], ['brisket']],
  [['chicken', 'marinade'], ['chicken marinade', 'marinated chicken']],
  [['marinated', 'chicken'], ['chicken marinade', 'marinated chicken']],
  [['bbq'], ['bbq', 'bbq sauce', 'barbecue sauce', 'barbecue']],
  [['barbecue'], ['bbq', 'bbq sauce', 'barbecue sauce', 'barbecue']],
  [['marinated', 'olive'], ['olives', 'marinated olives']],
  [['toum'], ['toum']],
  [['ranch'], ['ranch', 'ranch dressing']],
  [['hot', 'honey'], ['hot honey']],
  [['onion', 'jam'], ['onion jam']]
];

/* ================= the catalogue: everything that can be named =================
   Built fresh from the app's live lists on every request (contract 8: the
   tab may have changed them). */
function nameKeys(name){
  var out = [];
  function add(s){ var k = keyOf(s); if(k && out.indexOf(k) < 0) out.push(k); }
  var n = String(name || '');
  add(n);
  var noParen = n.replace(/\([^)]*\)/g, ' ');
  add(noParen);
  noParen.split('/').forEach(add);
  add(noParen.replace(/\b\d+\s*(g|kg|ml|l)\b/ig, ' '));
  return out;
}
function supKeys(name){
  var out = [];
  function add(s){ var k = keyOf(s); if(k && out.indexOf(k) < 0) out.push(k); }
  var n = String(name || '');
  add(n);
  var core = n.replace(/\b(supplier|suppliers|pty|ltd|limited|co|company|the|foods?|wholesale|distributors?)\b/ig, ' ');
  add(core);
  var first = clean(core).split(' ')[0];
  if(first && first.length > 2) add(first);
  return out;
}
/* "Aziz Supplier" -> "Aziz"; everything else as it is on screen */
function supSay(name){ return String(name || '').replace(/\s+(supplier|suppliers)$/i, '').trim() || String(name || ''); }
/* "Tomato Sauce / Ketchup" -> "Tomato Sauce"; "Pork Belly (Boneless)" -> "Pork Belly";
   "Dough Balls 350g Buvetti" -> "Dough Balls Buvetti" (a pack size is noise when spoken) */
function itemSay(name){
  return String(name || '').split(' / ')[0].replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b\d+(\.\d+)?\s?(g|kg|ml|l)\b/gi, ' ').replace(/\s+/g, ' ').trim() || String(name || '');
}

function catalogue(data, taught){
  var entries = [], index = Object.create(null), sup = Object.create(null);
  function addKey(e, k, how){
    if(!k) return;
    if(!e.keys.some(function(x){ return x.k === k; })) e.keys.push({ k: k, set: contentSet(k.split(' ')), how: how });
    var l = index[k] || (index[k] = []);
    if(l.indexOf(e) < 0) l.push(e);
  }
  (data.suppliers || []).forEach(function(s){
    supKeys(s.name).forEach(function(k){ (sup[k] = sup[k] || []).indexOf(s.id) < 0 && sup[k].push(s.id); });
    (s.products || []).forEach(function(p){
      var e = { kind: 'order', id: 'p:' + p.id, pid: p.id, sid: s.id, sname: s.name, name: p.name, unit: p.unit || '',
                inc: +p.inc > 0 ? +p.inc : 1, qty: +p.qty || 0, keys: [] };
      entries.push(e);
      nameKeys(p.name).forEach(function(k){ addKey(e, k, 'name'); });
      (PRODUCT_ALIASES[p.id] || []).forEach(function(a){ addKey(e, keyOf(a), 'alias'); });
    });
  });
  var prepByName = Object.create(null);
  (data.prepCatalogue || []).forEach(function(c){
    var e = { kind: 'prep', id: 'c:' + c.id, cid: c.id, name: c.name, section: c.section || '', recipe: c.recipe || '', keys: [] };
    entries.push(e);
    prepByName[clean(c.name)] = e;
    nameKeys(c.name).forEach(function(k){ addKey(e, k, 'name'); });
    var have = keyOf(c.name).split(' ');
    PREP_ALIASES.forEach(function(pa){
      if(pa[0].every(function(w){ return have.indexOf(w) > -1; })) pa[1].forEach(function(a){ addKey(e, keyOf(a), 'alias'); });
    });
  });
  /* lines on the shared prep list, for ticking and taking off */
  (data.prepLines || []).forEach(function(l){
    var e = { kind: 'line', id: 'l:' + l.id, lineId: l.id, name: l.text, done: !!l.done, by: l.by || '', section: l.section || '',
              recipe: l.recipe || '', at: l.at || 0, keys: [] };
    entries.push(e);
    nameKeys(l.text).forEach(function(k){ addKey(e, k, 'name'); });
    var c = prepByName[clean(l.text)];
    if(c) c.keys.forEach(function(x){ addKey(e, x.k, x.how); });
  });
  /* taught words point at a product or a prep item by id */
  Object.keys(taught || {}).forEach(function(heard){
    var to = taught[heard];
    entries.forEach(function(e){
      var match = (e.kind === 'order' && to === e.id) || (e.kind === 'prep' && to === e.id);
      if(!match && e.kind === 'line' && /^c:/.test(to)){
        var c = entries.filter(function(x){ return x.id === to; })[0];
        match = !!(c && clean(c.name) === clean(e.name));
      }
      if(match) addKey(e, heard, 'taught');
    });
  });
  return { entries: entries, index: index, sup: sup, suppliers: data.suppliers || [] };
}
function entryById(cat, id){ return cat.entries.filter(function(e){ return e.id === id; })[0] || null; }

/* ================= understanding a sentence ================= */

function phraseAt(t, i, words, field){
  for(var j = 0; j < words.length; j++){ if(!t[i + j] || t[i + j][field || 'r'] !== words[j]) return false; }
  return true;
}
function longestKey(t, i, map, max){
  for(var len = Math.min(max, t.length - i); len >= 1; len--){
    var k = t.slice(i, i + len).map(function(x){ return x.s; }).join(' ');
    if(map[k]) return { val: map[k], key: k, end: i + len };
  }
  return null;
}
function stripEdges(t){
  var lead = false, changed = true;
  while(changed && t.length){
    changed = false;
    for(var f = 0; f < FILLERS.length; f++){
      var w = FILLERS[f];
      if(w.length < t.length && phraseAt(t, 0, w)){
        if(w.length === 1 && w[0] === 'and') lead = true;
        t = t.slice(w.length); changed = true; break;
      }
    }
  }
  changed = true;
  while(changed && t.length > 1){
    changed = false;
    for(var r = 0; r < TRAIL.length; r++){
      var tw = TRAIL[r];
      if(tw.length < t.length && phraseAt(t, t.length - tw.length, tw)){ t = t.slice(0, t.length - tw.length); changed = true; break; }
    }
  }
  return { t: t, and: lead };
}

/* Reads the sentence once, left to right, into pieces: verb, list ("prep",
   "order"), supplier, item, number, joiner, "it". Each piece knows which
   clause it is in; "and" and commas start a new clause, so "add 2 mozz and
   take the speck off" is two jobs. */
var SPLIT = { take: 'remove', knock: 'remove', tick: 'tick', cross: 'tick', mark: 'tick' };
/* v3.9.3 (his heard log, 10 Oct: "after that could you add 6 kilo of spec"
   added 1 packet, with "I couldn't find after. I couldn't find could add."):
   soft words before a clause's verb are lead-in, not items, and the verb
   still counts after them ("need to add", "I think we need"). */
var SOFT = { after: 1, that: 1, then: 1, could: 1, can: 1, would: 1, will: 1, should: 1, you: 1, please: 1, also: 1, just: 1,
  to: 1, want: 1, wanna: 1, i: 1, im: 1, we: 1, me: 1, us: 1, gonna: 1, going: 1, lets: 1, maybe: 1, now: 1, so: 1, ok: 1,
  okay: 1, um: 1, uh: 1, actually: 1, mate: 1, chef: 1, quickly: 1, yeah: 1, right: 1, well: 1, oh: 1, next: 1, first: 1,
  firstly: 1, finally: 1, sorry: 1, oops: 1, think: 1, guess: 1, do: 1 };
function scan(t, cat){
  var segs = [], i = 0, clause = 0, start = 0, splitOff = -1, lead = true, hadVerb = false;
  function verbAt(i){
    // split verbs: "take the speck off", "tick pizza sauce off"
    if(i === start && SPLIT[t[i].r] && !(t[i + 1] && t[i + 1].r === 'off')){
      for(var j = i + 1; j < t.length && !CONJ[t[j].r]; j++){
        if(t[j].r === 'off' || (SPLIT[t[i].r] === 'remove' && (t[j].r === 'out' || t[j].r === 'away'))){
          splitOff = j;
          return { verb: SPLIT[t[i].r], end: i + 1, words: t[i].r + ' off' };
        }
      }
    }
    for(var v = 0; v < VERBS.length; v++){
      var V = VERBS[v];
      if(!phraseAt(t, i, V.w)) continue;
      /* v3.9.3: after soft lead-in words a verb still counts; after a verb,
         only a "to" verb does ("need to add"), so "read me the order list"
         keeps "order" as the list */
      var prev = segs[segs.length - 1];
      if(!V.any && i !== start && !(lead && (!hadVerb || (prev && prev.type === 'stop' && prev.w === 'to')))) continue;
      // "no" on its own is an answer; "no speck" is a removal
      if(V.w.join(' ') === 'no' && t.length < 2) continue;
      return { verb: V.verb, end: i + V.w.length, words: V.w.join(' ') };
    }
    return null;
  }
  function listAt(i){
    for(var l = 0; l < LISTS.length; l++) if(phraseAt(t, i, LISTS[l].w)) return { list: LISTS[l].list, end: i + LISTS[l].w.length };
    return null;
  }
  function push(g){ g.c = clause; segs.push(g); if(g.type === 'verb') hadVerb = true; else if(g.type !== 'stop') lead = false; }
  while(i < t.length){
    if(i === splitOff){ push({ type: 'stop', w: t[i].r, i: i, end: i + 1 }); i++; continue; }
    var w = t[i].r;
    if(CONJ[w] && !(w === 'plus' && i === start)){
      push({ type: 'conj', i: i, end: i + 1 });
      clause++; start = i + 1; i++; lead = true; hadVerb = false;
      continue;
    }
    var opts = [];
    var v = verbAt(i); if(v) opts.push({ type: 'verb', verb: v.verb, words: v.words, i: i, end: v.end, rank: 3 });
    var s = longestKey(t, i, cat.sup, 3); if(s) opts.push({ type: 'sup', sids: s.val, i: i, end: s.end, rank: 4 });
    var it = longestKey(t, i, cat.index, 8); if(it) opts.push({ type: 'item', entries: it.val, key: it.key, i: i, end: it.end, rank: 2 });
    var l = listAt(i); if(l) opts.push({ type: 'list', list: l.list, i: i, end: l.end, rank: 1 });
    var q = readQty(t, i); if(q) opts.push({ type: 'qty', q: q, i: i, end: q.end, rank: 0 });
    var best = null;
    opts.forEach(function(o){ if(!best || o.end > best.end || (o.end === best.end && o.rank > best.rank)) best = o; });
    if(best){ push(best); i = best.end; continue; }
    // v3.9.3: lead-in, not an item ("that" after the verb is still "it": "remove all of that")
    if(lead && SOFT[w] && !(hadVerb && REFS[w])){ push({ type: 'stop', w: w, i: i, end: i + 1 }); i++; continue; }
    if(REFS[w]) push({ type: 'ref', i: i, end: i + 1 });
    else if(STOP[w] === 1 || w === 'away') push({ type: 'stop', w: w, i: i, end: i + 1 });
    else push({ type: 'word', w: w, s: t[i].s, i: i, end: i + 1 });
    // a small word at the start of a clause ("and then just add…") keeps the verb's place open
    if(i === start && STOP[w] === 1) start = i + 1;
    i++;
  }
  return segs;
}

/* The pieces become a command: for each item, what to do, on which list,
   and how much. */
function parse(text, cat){
  var se = stripEdges(toks(text, true)), t = se.t;
  while(t.length && t[0].r === ',') t = t.slice(1);
  while(t.length && t[t.length - 1].r === ',') t = t.slice(0, -1);
  /* v3.9.3: "no, make that one kilo", "no I meant 6 kilo" are corrections, not
     "take it off" ("no speck" still is) */
  if(t.length > 1 && /^(no|nah|nope|sorry|oops)$/.test(t[0].r) && /^(make|set|change|i|meant|mean|its|it|actually)$/.test(t[1].r)) t = t.slice(1);
  var cmd = { text: String(text || ''), verb: null, verbWords: '', list: null, sids: [], items: [], refs: false,
              looseQty: null, and: se.and, question: false, tickWords: false, empty: !t.length, nTok: t.length, nHit: 0,
              moreWord: t.some(function(x){ return x.r === 'another' || x.r === 'more'; }) };
  if(!t.length) return cmd;
  cmd.question = !!QWORDS[t[0].r];
  var segs = scan(t, cat);
  // how much of the sentence is items and amounts: long talk with little of either is chatter (v3.9.3)
  segs.forEach(function(g){ if(g.type === 'item' || g.type === 'qty' || g.type === 'sup') cmd.nHit += g.end - g.i; });
  var nC = segs.length ? segs[segs.length - 1].c + 1 : 1, clauses = [];
  for(var c = 0; c < nC; c++) clauses.push({ verb: null, words: '', list: null, sids: [], setTo: false });
  segs.forEach(function(g, gi){
    var C = clauses[g.c];
    if(g.type === 'verb'){
      if(!C.verb){ C.verb = g.verb; C.words = g.words; }
      else if(g.verb === 'tick' && C.verb === 'clear') cmd.tickWords = true;
    }
    else if(g.type === 'list'){ if(!C.list || C.list === 'list') C.list = g.list; }
    else if(g.type === 'sup') g.sids.forEach(function(id){ if(C.sids.indexOf(id) < 0) C.sids.push(id); });
    else if(g.type === 'ref') cmd.refs = true;
    // "pepperoni to 3", "change mozz to 2"
    else if(g.type === 'stop' && g.w === 'to' && segs[gi + 1] && segs[gi + 1].type === 'qty' && segs[gi + 1].c === g.c && gi > 0) C.setTo = true;
  });
  clauses.forEach(function(C){ if(!C.verb && C.setTo){ C.verb = 'set'; C.words = 'to'; } });
  if(t.some(function(x){ return TICK_WORDS[x.r]; }) && clauses[0].verb === 'clear') cmd.tickWords = true;
  // a clause with no verb borrows the one before it, else the next one ("pizza sauce and hot honey are done")
  var lastV = null;
  clauses.forEach(function(C){ if(C.verb) lastV = C; else if(lastV){ C.verb = lastV.verb; C.words = lastV.words; C.borrowed = true; } });
  for(var b = clauses.length - 1, nextV = null; b >= 0; b--){
    if(clauses[b].verb && !clauses[b].borrowed) nextV = clauses[b];
    else if(!clauses[b].verb && nextV){ clauses[b].verb = nextV.verb; clauses[b].words = nextV.words; }
  }
  cmd.verb = clauses[0].verb; cmd.verbWords = clauses[0].words;
  clauses.forEach(function(C){
    if(C.list && (!cmd.list || cmd.list === 'list')) cmd.list = C.list;
    C.sids.forEach(function(id){ if(cmd.sids.indexOf(id) < 0) cmd.sids.push(id); });
  });

  /* Items: runs of item names and unknown words between the other pieces.
     A name followed straight on by another name is two items ("mozz
     pepperoni"); a stray word joins the name next to it ("fresh mozz"). */
  var runs = [], cur = null;
  segs.forEach(function(g, gi){
    if(g.type === 'item' || g.type === 'word'){
      if(!cur){ cur = { parts: [], at: gi }; runs.push(cur); }
      cur.parts.push(g);
    } else if(g.type !== 'stop') cur = null;
  });
  var items = [];
  function mk(o, seg){
    var C = clauses[seg.c];
    o.c = seg.c; o.verb = C.verb; o.verbWords = C.words; o.list = C.list; o.sids = C.sids.slice();
    return o;
  }
  runs.forEach(function(run){
    var named = run.parts.filter(function(p){ return p.type === 'item'; });
    if(!named.length){
      items.push(mk({ segAt: run.parts[0], words: run.parts.map(function(p){ return p.w; }), stems: run.parts.map(function(p){ return p.s; }), exact: null }, run.parts[0]));
      return;
    }
    /* v3.10.2 (his log, 12 Oct: "add the following to the prep list mushroom
       paste confit garlic cream" added Confit Garlic Cream and lost the
       mushroom paste without a word): loose words join the name next to them
       when, said together, they still mean something that name could be, and
       that thing uses them ("fresh mozz", "blue royal potatoes"). Two or more
       in a row that don't, and that name something on their own, are an item
       ("paste mushroom truffle mayo" was Truffle Mushroom Paste alone). */
    var loose = [], block = [];
    run.parts.concat([null]).forEach(function(p){
      if(p && p.type === 'word'){ block.push(p); return; }
      if(block.length) loose.push(block);
      block = [];
    });
    var KINDS = ['order', 'prep', 'line'];
    var topOf = function(f){ return f.list.slice(0, f.top || f.list.length); };
    var apart = loose.filter(function(b){
      var stems = b.map(function(x){ return x.s; }), said = contentSet(stems);
      if(said.length < 2) return false;
      var next = named.filter(function(n){ return n.i > b[0].i; })[0] || named.filter(function(n){ return n.i < b[0].i; }).pop();
      var joined = findItems({ stems: next.i > b[0].i ? stems.concat(next.key.split(' ')) : next.key.split(' ').concat(stems), exact: null }, cat, KINDS);
      if(topOf(joined).some(function(e){
        return next.entries.indexOf(e) > -1 && e.keys.some(function(x){ return said.some(function(w){ return x.set.indexOf(w) > -1; }); });
      })) return false;
      var own = findItems({ stems: stems, exact: null }, cat, KINDS);
      return own.how === 'exact' || own.how === 'superset' || own.how === 'subset';
    });
    apart.forEach(function(b){ items.push(mk({ segAt: b[0], words: b.map(function(x){ return x.w; }), stems: b.map(function(x){ return x.s; }), exact: null }, b[0])); });
    /* v3.10.2: the same thing named twice in a row is one item ("add 5 kilos
       of potatoes royal blue" added 5 kilos, then 1 more: both names mean
       Royal Blue Potatoes); the second name joins the first as extra words */
    var heads = [];
    named.forEach(function(p){
      var h = heads[heads.length - 1];
      if(!(h && h.entries.some(function(e){ return p.entries.indexOf(e) > -1; }))) heads.push(p);
    });
    var groups = heads.map(function(p){ return { item: p, extra: [] }; });
    var g = 0;
    run.parts.forEach(function(p){
      if(heads.indexOf(p) > -1){ g = heads.indexOf(p); return; }
      if(p.type === 'item'){ groups[g].extra.push(p); return; }
      if(apart.some(function(b){ return b.indexOf(p) > -1; })) return;
      var k = heads.filter(function(n){ return n.i > p.i; })[0];
      (k ? groups[heads.indexOf(k)] : groups[g]).extra.push(p);
    });
    var wordsOf = function(x){ return x.type === 'item' ? t.slice(x.i, x.end).map(function(y){ return y.r; }) : [x.w]; };
    var stemsOf = function(x){ return x.type === 'item' ? x.key.split(' ') : [x.s]; };
    var flat = function(list, f){ return list.reduce(function(a, x){ return a.concat(f(x)); }, []); };
    groups.forEach(function(gr){
      var p = gr.item, before = gr.extra.filter(function(x){ return x.i < p.i; }), after = gr.extra.filter(function(x){ return x.i > p.i; });
      var words = flat(before, wordsOf).concat(wordsOf(p)).concat(flat(after, wordsOf));
      var stems = flat(before, stemsOf).concat(stemsOf(p)).concat(flat(after, stemsOf));
      items.push(mk({ segAt: p, words: words, stems: stems, exact: gr.extra.length ? null : p.entries }, p));
    });
  });
  items.sort(function(a, b){ return a.segAt.i - b.segAt.i; });

  /* Amounts: one said before a name belongs to it ("2 kilos of mozz"); one
     said after a name with nothing in between belongs to that name ("mozz
     2", "pepperoni to 3"). */
  var pending = null, last = null, joined = false;
  /* v3.9.3: "… 6 kilo of spec": an amount followed by "of" and a name is
     that name's, whatever came before it */
  function ofNext(gi){
    var sawOf = false;
    for(var k = gi + 1; k < segs.length; k++){
      if(segs[k].type === 'stop'){ if(segs[k].w === 'of') sawOf = true; continue; }
      return sawOf && (segs[k].type === 'item' || segs[k].type === 'word');
    }
    return false;
  }
  segs.forEach(function(g, gi){
    if(g.type === 'qty'){
      if(last && !last.qty && !joined && !ofNext(gi)){ last.qty = g.q; return; }
      pending = g.q; return;
    }
    if(g.type === 'conj'){ joined = true; return; }
    var it = items.filter(function(x){ return x.segAt === g; })[0];
    if(it){
      if(pending){ it.qty = pending; pending = null; }
      last = it; joined = false;
    }
  });
  cmd.looseQty = pending;
  cmd.items = items;
  return cmd;
}

/* ================= finding the item meant ================= */

function lev(a, b){
  if(a === b) return 0;
  var m = a.length, n = b.length, d = [], i, j;
  for(i = 0; i <= m; i++){ d[i] = [i]; }
  for(j = 1; j <= n; j++) d[0][j] = j;
  for(i = 1; i <= m; i++) for(j = 1; j <= n; j++){
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
/* a rough "sounds like" key: time ~ thyme, spec ~ speck */
function sound(w){
  return String(w || '').replace(/^kn/, 'n').replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/z/g, 's').replace(/x/g, 'ks')
    .replace(/(.)[aeiouyhw]+/g, '$1').replace(/(.)\1+/g, '$1');
}
/* letter pairs in common: breaks a sound-alike tie (time is nearer thyme than toum) */
function pairs(w){ var out = []; for(var i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); return out; }
function dice(a, b){
  var pa = pairs(a), pb = pairs(b), n = 0;
  pa.forEach(function(x){ var k = pb.indexOf(x); if(k > -1){ n++; pb.splice(k, 1); } });
  return pa.length + pairs(b).length ? 2 * n / (pa.length + pairs(b).length) : 0;
}
function wordLike(a, b){
  if(a === b) return 1;
  if(a.length < 3 || b.length < 3) return 0;
  if(sound(a) === sound(b)) return 0.7 + 0.25 * dice(a, b);
  var r = 1 - lev(a, b) / Math.max(a.length, b.length);
  return r >= 0.75 ? 0.6 + 0.2 * r : 0;
}
var QUALITY = { exact: 4, superset: 3, subset: 2, fuzzy: 1 };
/* Everything the words could mean, best kind of match first:
   exact     the name, an alias or a taught word, as said
   superset  every word said is in the name ("garlic" -> three garlics)
   subset    a whole name is in what was said ("fresh mozzarella")
   fuzzy     sounds like it ("time" -> thyme): always asked about */
var WORD_OF_N = Object.assign({}, SMALL, TENS);   // number words ("one", "twenty")
/* every word any item's name or alias has (v3.9.13), kept on the catalogue */
function catWords(cat){
  if(cat._words) return cat._words;
  var w = {};
  cat.entries.forEach(function(e){ e.keys.forEach(function(x){ x.set.forEach(function(y){ w[y] = 1; }); }); });
  cat._words = w;
  return w;
}
function findItems(item, cat, kinds){
  var ok = function(e){ return kinds.indexOf(e.kind) > -1; };
  var said = contentSet(item.stems);
  var key = item.stems.join(' ');
  var exact = (cat.index[key] || []).filter(ok);
  if(!exact.length && item.exact) exact = item.exact.filter(ok);
  if(exact.length) return { how: 'exact', list: exact };
  // v3.11.10: the same words without how it's prepped ("chopped parsley" -> Parsley, "sliced speck" -> Speck)
  var trim = item.stems.filter(function(w){ return !PREP_TRIM[w]; });
  if(trim.length && trim.length < item.stems.length){
    var exTrim = (cat.index[trim.join(' ')] || []).filter(ok);
    if(exTrim.length) return { how: 'exact', list: exTrim, trimmed: true };
  }
  if(!said.length) return { how: 'none', list: [] };
  var sup = [], sub = [];
  cat.entries.forEach(function(e){
    if(!ok(e)) return;
    var bestSup = null, bestSub = null;
    e.keys.forEach(function(x){
      if(!x.set.length) return;
      if(said.every(function(w){ return x.set.indexOf(w) > -1; })){ var extra = x.set.length - said.length; if(bestSup == null || extra < bestSup) bestSup = extra; }
      if(x.set.every(function(w){ return said.indexOf(w) > -1; })){ if(bestSub == null || x.set.length > bestSub) bestSub = x.set.length; }
    });
    if(bestSup != null) sup.push({ e: e, n: bestSup });
    if(bestSub != null) sub.push({ e: e, n: bestSub });
  });
  if(sup.length){
    var least = Math.min.apply(null, sup.map(function(x){ return x.n; }));
    return { how: 'superset', list: sup.filter(function(x){ return x.n === least; }).map(function(x){ return x.e; }).concat(
      sup.filter(function(x){ return x.n !== least; }).map(function(x){ return x.e; })), top: sup.filter(function(x){ return x.n === least; }).length };
  }
  if(sub.length){
    var most = Math.max.apply(null, sub.map(function(x){ return x.n; }));
    var top = sub.filter(function(x){ return x.n === most; }).map(function(x){ return x.e; });
    /* v3.9.13 (his log, 11 Oct: "add 5 L of thickened cream" added Pure Cream,
       whose name "cream" sits inside it): a word said that no item has at all
       makes it a guess, so it asks "Did you mean …?" (and learns on a pick) */
    var known = catWords(cat);   // units and numbers ("one more box of pepperoni") are never odd
    if(said.some(function(w){ return !known[w] && !UNIT_WORDS[w] && !/^[0-9]/.test(w) && !STOP[w] && !WORD_OF_N[w]; })) return { how: 'fuzzy', list: top, top: top.length, odd: true };
    return { how: 'subset', list: top, top: top.length };
  }
  var fz = [];
  cat.entries.forEach(function(e){
    if(!ok(e)) return;
    var best = 0, anchor = false;
    e.keys.forEach(function(x){
      if(!x.set.length) return;
      var sum = 0, sure = false;
      said.forEach(function(w){ var b = 0; x.set.forEach(function(y){ b = Math.max(b, wordLike(w, y)); if(w === y && w.length >= 4) sure = true; }); sum += b; });
      var s = sum / Math.max(said.length, x.set.length);
      if(s > best){ best = s; anchor = sure; } else if(s === best && sure) anchor = true;
    });
    /* v3.9.3: half a name, said exactly ("pearly garlic", "pils garlic" for
       Peeled Garlic in his log), is enough to ask "Did you mean…" (and learn
       the word on a yes); it never acts without asking */
    if(best >= 0.6 || (best >= 0.5 && anchor)) fz.push({ e: e, n: best });
  });
  fz.sort(function(a, b){ return b.n - a.n; });
  if(fz.length){
    var hi = fz[0].n;
    // only the near-best: a clear winner is asked about alone
    return { how: 'fuzzy', list: fz.filter(function(x){ return x.n >= hi - 0.05; }).map(function(x){ return x.e; }) };
  }
  return { how: 'none', list: [] };
}
/* The same product can sit with two suppliers; lines can repeat. */
function dedupe(list){
  var seen = {}, out = [];
  list.forEach(function(e){ if(!seen[e.id]){ seen[e.id] = 1; out.push(e); } });
  return out;
}

/* ================= the room ================= */

var UNDO_KEY = 'order-chit-voice-undo';
var WORDS_KEY = 'order-chit-voice-words';
var SAID_KEY = 'order-chit-voice-words-said';
var USUAL_KEY = 'order-chit-voice-usual';
var UNDO_MS = 10 * 60 * 1000;
var CONFIRM_MS = 60 * 1000;
var CTX_MS = 2 * 60 * 1000;
var SPOKEN_MAX = 6;

function createRoom(host){
  var askN = 0, tokN = 0, actN = 0;
  var pending = null;            // the question this room asked last
  var confirms = {};             // token -> waiting high-stakes action
  var ctx = null;                // the last items talked about, for "make it 3"
  var lastDone = null;           // v3.11.10: the last add, for a correction ("no, I meant the order")
  var lastUndone = null;         // v3.11.10: the last add taken back by undo, for "put it back"
  var goAhead = null;            // v3.11.10: "add the following to the order" through Pluto: that list, for the names that follow

  function now(){ return host.now ? host.now() : Date.now(); }
  function get(k, d){ try{ var v = host.get(k); return v == null ? d : v; }catch(e){ return d; } }
  function put(k, v){ try{ host.set(k, v); }catch(e){} }
  function taught(){ var w = get(WORDS_KEY, {}); return w && typeof w === 'object' ? w : {}; }
  /* v3.9.1: the words as they were said ("mots"), next to the folded key
     the brain looks up ("mot"), so the Voice screen shows what he said */
  function saidWords(){ var s = get(SAID_KEY, {}); return s && typeof s === 'object' ? s : {}; }
  function wordsChanged(){ if(host.wordsChanged) try{ host.wordsChanged(); }catch(e){} }
  function teach(heard, id, said){
    if(!heard || !id) return;
    var w = taught(); w[heard] = id; put(WORDS_KEY, w);
    var s = saidWords();
    if(said) s[heard] = said; else delete s[heard];
    put(SAID_KEY, s);
    wordsChanged();
  }
  /* A tick or take-off question offers today's lines ("l:…"), which come
     and go. Learn the prep item behind the line instead, so the word still
     works tomorrow; a line typed by hand has none, so nothing is learned.
     (v3.9.0 saved the line itself, which never matched again.) */
  function lastingId(cat, id){
    if(!/^l:/.test(String(id || ''))) return id;
    var line = entryById(cat, id);
    if(!line) return null;
    var c = cat.entries.filter(function(e){ return e.kind === 'prep' && clean(e.name) === clean(line.name); })[0];
    return c ? c.id : null;
  }

  /* ---------- answers, in the contract's shape ---------- */
  function ans(status, o){
    var a = { v: 1, status: status, say: [], more: [], keep: status !== 'notmine' && status !== 'error' };
    Object.keys(o || {}).forEach(function(k){ a[k] = o[k]; });
    if(a.say.length > 3){ a.more = a.say.slice(3).concat(a.more); a.say = a.say.slice(0, 3); }
    return a;
  }
  function notmine(log){ return { v: 1, status: 'notmine', keep: false, log: log || 'notmine' }; }
  function cant(text, log){ return ans('cant', { say: [text], log: log || 'cant' }); }
  function asking(kind, say, options, data, expect){
    askN++;
    pending = Object.assign({ id: 'ask-' + askN, kind: kind, options: options || [], say: say }, data || {});
    var o = (options || []).slice(0, 4);
    return ans('ask', { say: [say], ask: { id: pending.id, expect: expect || 'choice', options: o }, log: 'ask ' + kind });
  }
  function confirming(kind, readBack, question, data, log){
    tokN++;
    var token = 'c-' + tokN + '-' + now().toString(36);
    confirms[token] = Object.assign({ kind: kind, expires: now() + CONFIRM_MS }, data || {});
    return ans('confirm', { confirm: { token: token, readBack: readBack, question: question, expiresMs: CONFIRM_MS }, log: log });
  }

  /* ---------- v3.11.6: a recipe asked for (his log, 14 Oct) ----------
     Only the recipes in his book are looked at (prep items that have a
     recipe). One that fits opens it; a few ask "Which recipe?" with only
     recipes as options, and a pick opens it and teaches nothing; none says
     so (through Pluto, "not mine": not his recipe, so maybe a question for
     the Ask room). Through Pluto the room can't show a screen, so it says
     where the recipe is and gives the card the way to open it. A sentence
     that changes a list ("add the pizza sauce recipe to the prep list") is
     left to the lists. */
  function recipeCat(cat){
    var rec = cat.entries.filter(function(e){ return e.kind === 'prep' && e.recipe; });
    var idx = {};
    Object.keys(cat.index).forEach(function(k){ var l = cat.index[k].filter(function(e){ return rec.indexOf(e) > -1; }); if(l.length) idx[k] = l; });
    return { entries: rec, index: idx };
  }
  function openRecipe(e, mode){
    var view = { view: 'recipe', rid: e.recipe };
    if(mode !== 'pluto' && host.open) host.open(view);
    return ans('answer', { say: [mode === 'pluto' ? 'The ' + e.name + ' recipe is on The Pass tab.' : 'Here’s the ' + e.name + ' recipe.'],
      show: { title: e.name, lines: [], open: view, go: true }, log: 'recipe ' + e.name });   // v3.11.9: go, Pluto opens it (contract 6.5)
  }
  function recipeAsk(text, cat, mode, cmd){
    var words = recipeWords(text);
    if(!words) return null;
    if(cmd && cmd.verb && ['open', 'read'].indexOf(cmd.verb) < 0) return null;
    if(!words.length){
      if(canTopic(text) === 'recipe') return null;      // "can you do recipes?" is about The Pass itself
      var all = { view: 'recipes' };
      if(mode !== 'pluto' && host.open) host.open(all);
      return ans('answer', { say: [mode === 'pluto' ? 'Your recipes are on The Pass tab.' : 'Here are your recipes.'], show: { title: 'Recipes', lines: [], open: all, go: true }, log: 'recipes' });
    }
    var tk = toks(words.join(' ')).filter(function(t){ return !STOP[t.r]; });
    var rc = recipeCat(cat);
    var hit = tk.length ? findItems({ stems: tk.map(function(t){ return t.s; }) }, rc, ['prep']) : { how: 'none', list: [] };
    var list = dedupe(hit.list || []);
    if(!list.length){
      if(mode === 'pluto') return notmine('recipe none');
      // a few words are a name to say back; more is a sentence about something else (his log: "it's not showing me the recipe…")
      return cant(words.length <= 3 ? "I couldn't find a recipe for " + words.join(' ') + ' in your book.' : "Which recipe? Say its name, like 'show me the pizza sauce recipe'.", 'recipe none');
    }
    var top = hit.top ? list.slice(0, hit.top) : list;
    if(top.length === 1) return openRecipe(top[0], mode);
    var opts = top.slice(0, 3).map(function(e){ return { label: e.name, value: e.cid }; }).concat([{ label: 'None of these', value: 'none' }]);
    var names = top.slice(0, 3).map(function(e){ return e.name; });
    return asking('recipe', 'Which recipe: ' + names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] + '?', opts, {}, 'item');
  }

  /* ---------- undo, kept in storage (contract 7) ---------- */
  function undoList(){
    var l = get(UNDO_KEY, []);
    if(!Array.isArray(l)) l = [];
    var cutoff = now() - UNDO_MS;
    return l.filter(function(u){ return u && u.at >= cutoff; });
  }
  function remember(label, ops){
    actN++;
    var id = 'a-' + now().toString(36) + '-' + actN;
    var l = undoList();
    l.push({ id: id, at: now(), label: label, ops: ops });
    put(UNDO_KEY, l.slice(-10));
    return id;
  }

  /* ---------- fresh data ---------- */
  /* v3.11.11 (his log, 15 Oct: the first answer after a wake took about 5 s,
     and at 8:02 am "Nothing on the prep list" with 10 on it). The phone's own
     lists are re-read from storage at every look (host.reload). The shared
     prep list is downloaded at most once at a time and not again for 20 s,
     with one wait of up to 2.5 s (it waited up to 2.5 s at every look, often
     twice an answer). A prep list that has never come in is unknown, never
     empty: prepBlind. */
  var FRESH_FOR = 20000, FRESH_WAIT = 2500, RETRY_AFTER = 5000, STUCK_AFTER = 15000, PREP_OLD = 5 * 60 * 1000;
  var net = { p: null, ok: -Infinity, tried: -Infinity, waited: false }, prepBlind = false;
  async function netFresh(){
    if(now() - net.ok < FRESH_FOR) return;
    if(net.p && now() - net.tried > STUCK_AFTER) net.p = null;   // a download that never ended is given up
    if(!net.p && now() - net.tried >= RETRY_AFTER){   // one that just failed isn't tried again at once
      net.tried = now();
      net.waited = false;
      var p = Promise.resolve().then(function(){ return host.refresh(); })
        .then(function(ok){ if(ok !== false) net.ok = now(); }, function(){})
        .then(function(){ if(net.p === p) net.p = null; });
      net.p = p;
    }
    if(!net.p || net.waited) return;     // nothing coming, or waited once for this one already: answer with what's here
    net.waited = true;
    await Promise.race([net.p, new Promise(function(r){ setTimeout(r, FRESH_WAIT); })]);
  }
  async function fresh(){
    if(host.reload){ try{ host.reload(); }catch(e){} }
    if(host.refresh) await netFresh();
    var d = host.data();
    prepBlind = d.prepKnown === false;
    return { data: d, cat: catalogue(d, taught()) };
  }
  var PREP_BLIND = "I can't reach the prep list right now. Try again in a moment.";
  function notOnPrep(name){ return prepBlind ? PREP_BLIND : itemSay(name) + " isn't on the prep list."; }
  /* "This is from 8:02 am." when the prep list couldn't be checked for a while
     ("yesterday at 8:02 am", "Tuesday at 8:02 am", "9 October" when older) */
  function prepOld(d){
    if(!d || !d.prepAsOf || now() - d.prepAsOf <= PREP_OLD) return '';
    var t = new Date(d.prepAsOf), n = new Date(now());
    var days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    var at = timeSay(pad2(t.getHours()) + ':' + pad2(t.getMinutes()));
    var when = days <= 0 ? at : days === 1 ? 'yesterday at ' + at : days < 7 ? DAY_FULL[DAY_KEYS[t.getDay()]] + ' at ' + at : t.getDate() + ' ' + MONTHS[t.getMonth()];
    return "I couldn't check the prep list just now. This is from " + when + '.';
  }
  function supplier(cat, id){ return cat.suppliers.filter(function(s){ return s.id === id; })[0] || null; }
  function onOrder(s){ return (s.products || []).filter(function(p){ return +p.qty > 0; }); }
  function lineOf(p){ return amount(+p.qty, p.unit) + ' ' + itemSay(p.name); }
  function usual(e){
    var hist = get(USUAL_KEY, {}) || {};
    var last = host.lastOrder ? (host.lastOrder(e.sid) || {}) : {};
    return Math.max(+last[e.pid] || 0, +hist[e.pid] || 0);
  }
  function noteUsual(e, n){
    var hist = get(USUAL_KEY, {}) || {};
    if(!(+hist[e.pid] >= n)){ hist[e.pid] = n; put(USUAL_KEY, hist); }
  }
  function tooMuch(e, n){
    var u = usual(e);
    var limit = u > 0 ? u * 2 : e.inc * 10;
    return n > limit;
  }

  /* ---------- the timesheet (v3.9.6): "add today's timesheet" ----------
     His words (11 Oct): "Did you start at your rostered time of 3:30 today?"
     → "What time did you finish?" → read back → a plain yes (it's pay).
     Only his own hours; nothing goes to accounts until he submits it from
     the Timesheet screen himself. */
  function tsSheet(){ try{ return host.timesheet ? host.timesheet() : null; }catch(e){ return null; } }
  function tsToday(){ return serviceDate(now()); }
  /* v3.9.10: the last timesheet answer (and its day), so a follow-up like
     "remove the Sunday" or "change the finish to 10" stays on the timesheet */
  var tsLast = null, TS_FOLLOW_MS = 2 * 60 * 1000;
  function tsNote(date){ tsLast = { at: now(), date: date || null }; }
  function tsRecent(){ return tsLast && now() - tsLast.at < TS_FOLLOW_MS; }
  /* after the start: the finish, unless an edit already knows it */
  function tsNext(t){ return t.end ? tsConfirm(t) : asking('tsEnd', 'What time did you finish?', [], { ts: t }, 'time'); }
  function tsAfterStart(t){
    if(t.endClock){ t.end = toHHMM(clockMin(t.endClock, null, toMin(t.start))); delete t.endClock; }
    return tsNext(t);
  }
  function tsNowMin(){ var d = new Date(now()); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  /* "remove the Sunday", "I'm off Sunday", "change Wednesday's finish to
     10:30", "Thursday 3:30 to 10", "change Wednesday" (asks it again) */
  function tsEdit(text, date){
    var sheet = tsSheet();
    if(!sheet) return cant("I can't reach the timesheet.", 'ts none');
    var c = clean(text), today = tsToday();
    date = date || tsDayIn(text, today) || (tsRecent() && tsLast.date) || null;
    if(!date){
      var onSheet = TS_DAYS.indexOf(dayOf(today)) > -1;
      return asking('tsEditDay', 'Which day?', (onSheet ? [{ label: 'Today', value: dayOf(today) }] : []).concat(
        TS_DAYS.filter(function(d){ return d !== dayOf(today); }).slice(0, onSheet ? 3 : 4).map(function(d){ return { label: DAY_FULL[d], value: d }; })),
        { text: text }, 'choice');
    }
    var day = dayOf(date);
    if(TS_DAYS.indexOf(day) < 0) return cant("The timesheet's only Wednesday to Sunday.", 'ts not on sheet');
    var row = (sheet.days || {})[day] || {}, r = tsRow(sheet, date), mine = !r.empty && !r.other ? r : null;
    if(TS_CLEAR.test(c)){
      if(r.empty) return ans('answer', { say: ['Nothing on ' + dateSay(date) + ' to clear.'], log: 'ts clear empty' });
      return confirming('timesheet', ['Clear ' + dateSay(date) + '?', 'It has ' + timeSay(row.start) + (row.end ? ' to ' + timeSay(row.end) : '')
        + (r.other && row.date ? ', from ' + dateSay(row.date) : '') + '.'], 'Clear it?', { ts: { day: day, date: date, start: '', end: '', clear: true } }, 'ts confirm clear ' + day);
    }
    var t = { day: day, date: date, rostered: mondayOf(date) === sheet.week ? (sheet.rostered || {})[day] || '' : '' };
    var two = twoClocks(text);
    if(two){
      t.start = toHHMM(clockMin(two[0], toMin(t.rostered) != null ? toMin(t.rostered) : (mine ? toMin(mine.start) : null), null));
      t.end = toHHMM(clockMin(two[1], null, toMin(t.start)));
      return tsConfirm(t);
    }
    var one = parseClock(text);
    var isStart = /\b(start|started|starting)\b/.test(c), isEnd = /\b(finish|finished|finishing|end|ended)\b/.test(c);
    if(one){
      var at = one.now ? toHHMM(quarter(tsNowMin())) : null;
      if(isStart){
        t.start = at || toHHMM(clockMin(one, toMin(t.rostered) != null ? toMin(t.rostered) : (mine ? toMin(mine.start) : null), null));
        t.end = mine && mine.end || '';
        return tsNext(t);
      }
      if(isEnd || (mine && mine.start)){
        if(!mine || !mine.start){   // a finish with no start that day: ask the start, then work the finish out after it
          if(one.now) t.end = at; else t.endClock = one;
          return asking('tsStart', 'What time did you start on ' + DAY_FULL[day] + '?', [], { ts: t }, 'time');
        }
        t.start = mine.start;
        t.end = at || toHHMM(clockMin(one, null, toMin(t.start)));
        return tsConfirm(t);
      }
    }
    // no time said: go through the day again
    return tsAskStart(t, sheet);
  }
  function tsWhen(t){ return t.date === tsToday() ? 'today' : 'on ' + DAY_FULL[t.day]; }
  function tsBegin(text){
    var sheet = tsSheet();
    if(!sheet) return cant("I can't reach the timesheet.", 'ts none');
    var today = tsToday(), date = tsDayIn(text, today);
    if(!date){
      if(TS_DAYS.indexOf(dayOf(today)) < 0){
        return asking('tsDay', "The timesheet's only Wednesday to Sunday. Which day is it for?",
          TS_DAYS.map(function(d){ return { label: DAY_FULL[d], value: d }; }), {}, 'choice');
      }
      date = today;
    }
    if(TS_DAYS.indexOf(dayOf(date)) < 0) return cant("The timesheet's only Wednesday to Sunday.", 'ts not on sheet');
    return tsAskStart({ day: dayOf(date), date: date }, sheet);
  }
  function tsAskStart(t, sheet){
    // the roster only knows this week, so an earlier week has no rostered time
    t.rostered = mondayOf(t.date) === sheet.week ? (sheet.rostered || {})[t.day] || '' : '';
    if(t.rostered){
      return asking('tsStartYes', 'Did you start at your rostered time of ' + timeSay(t.rostered) + ' ' + tsWhen(t) + '?',
        [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], { ts: t }, 'choice');
    }
    return asking('tsStart', 'What time did you start ' + tsWhen(t) + '?', [], { ts: t }, 'time');
  }
  function tsConfirm(t){
    var sheet = tsSheet() || { days: {} }, row = (sheet.days || {})[t.day] || {}, h = hoursOf(t.start, t.end);
    var rb = [dateSay(t.date) + ': ' + timeSay(t.start) + ' to ' + timeSay(t.end) + '.'];
    rb.push("That's " + hoursSay(h) + (h > 14 ? ', which is a long one.' : h < 1 ? ', which is a short one.' : '.'));
    if(row.start && (row.start !== t.start || (row.end || '') !== t.end)){
      rb.push('Was ' + timeSay(row.start) + (row.end ? ' to ' + timeSay(row.end) : '') + (row.date && row.date !== t.date ? ', from ' + dateSay(row.date) : '') + '.');
    }
    return confirming('timesheet', rb, 'Save it?', { ts: t }, 'ts confirm ' + t.day);
  }
  /* not an answer: a new command starts over; one miss asks again, a second leaves it */
  async function tsMiss(p, text, req, mode){
    var maybe = parse(text, (await fresh()).cat);
    if(maybe.verb && maybe.items.some(function(it){ return it.exact && it.exact.length; })) return run(maybe, req, mode);
    if(!p.again && clean(text)){
      var q = p.kind === 'tsDay' ? 'Which day is it for?' : p.kind === 'tsRead' ? 'Which day, or the whole week?' : p.kind === 'tsEditDay' ? 'Which day?'
        : p.kind === 'tsStartYes' ? 'Did you start at ' + timeSay(p.ts.rostered) + '?'
        : p.kind === 'tsEnd' ? 'What time did you finish?' : 'What time did you start?';
      return asking(p.kind, "Sorry, I didn't catch that. " + q, p.options, { ts: p.ts, text: p.text, again: true }, /^ts(Day|Read|EditDay|StartYes)$/.test(p.kind) ? 'choice' : 'time');
    }
    return ans('answer', { say: [p.kind === 'tsRead' ? 'Left it.' : 'Left it. Timesheet unchanged.'], log: 'ts dropped' });
  }
  function tsClock(p, text, t, kind){
    var c = parseClock(text);
    if(!c) return null;
    if(c.now) return toHHMM(quarter((function(d){ return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; })(new Date(now()))));
    return toHHMM(kind === 'end' ? clockMin(c, null, toMin(t.start)) : clockMin(c, toMin(t.rostered), null));
  }
  async function tsAnswer(p, req, mode){
    var text = String(req.text || ''), choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null;
    var t = Object.assign({}, p.ts || {});
    pending = null;
    if(p.kind === 'tsEditDay'){   // v3.9.10: "Which day?" for an edit
      var ed = choice && TS_DAYS.indexOf(choice) > -1 ? lastDayOn(choice, tsToday()) : tsDayIn(text, tsToday());
      if(!ed) return tsMiss(p, text, req, mode);
      return tsEdit(p.text || '', ed);
    }
    // v3.9.10: "I haven't started today" (his log) isn't a time, and isn't a miss either
    if(/^ts(Start|StartYes|End)$/.test(p.kind) && /\b(havent|have not|not yet|not started|didnt start|did not start|still (working|here|going|on)|not finished|havent finished|not done)\b/.test(clean(text))){
      return ans('answer', { say: ["No worries. Add it when you've finished."], log: 'ts not yet' });
    }
    if(p.kind === 'tsRead'){   // v3.9.7: "Which day, or the whole week?"
      var rc = clean(text), today = tsToday();
      if(choice === 'week' || (!choice && /\b(week|whole|all|total|everything)\b/.test(rc))) return tsReadWeek(/\blast\b/.test(rc));
      if(choice === 'today' || (!choice && /\b(today|tonight)\b/.test(rc))) return tsReadDay(today);
      var rd = choice && TS_DAYS.indexOf(choice) > -1 ? lastDayOn(choice, today) : tsDayIn(text, today);
      if(rd) return tsReadDay(rd);
      return tsMiss(p, text, req, mode);
    }
    if(p.kind === 'tsDay'){
      var d = choice || matchOption(text, p.options);
      if(!d){ var named = tsDayIn(text, tsToday()); if(named) d = dayOf(named); }
      if(!d || TS_DAYS.indexOf(d) < 0) return tsMiss(p, text, req, mode);
      var sheet = tsSheet();
      if(!sheet) return cant("I can't reach the timesheet.", 'ts none');
      return tsAskStart({ day: d, date: lastDayOn(d, tsToday()) }, sheet);
    }
    // an order said instead ("add 2 kilos of mozz") is an order, not a finish at 2
    if(choice == null && clean(text)){
      var other = parse(text, (await fresh()).cat);
      if(other.verb && other.items.some(function(it){ return it.exact && it.exact.length; })) return run(other, req, mode);
    }
    var said = choice == null ? tsClock(p, text, t, p.kind === 'tsEnd' ? 'end' : 'start') : null;
    if(p.kind === 'tsStartYes'){
      if(said){ t.start = said; return tsAfterStart(t); }
      var c = clean(text), yn = choice || yesNo(text)
        || (/^(yes|yeah|yep|yup|yes i did|yeah i did|i did|on time|correct|right|sure)\b/.test(c) ? 'yes' : /^(no|nope|nah|i didnt|not quite)\b/.test(c) ? 'no' : null);
      if(yn === 'yes'){ t.start = t.rostered; return tsAfterStart(t); }
      if(yn === 'no') return asking('tsStart', 'What time did you start?', [], { ts: t }, 'time');
      return tsMiss(p, text, req, mode);
    }
    if(!said) return tsMiss(p, text, req, mode);
    if(p.kind === 'tsStart'){ t.start = said; return tsAfterStart(t); }
    t.end = said;
    return tsConfirm(t);
  }
  /* ---------- reading the timesheet (v3.9.7, his design of 11 Oct) ----------
     "whats my timesheet" → "Which day, or the whole week?"; a day → its start
     and finish; the week (Wed to Sun) → "This week so far: …", or on Monday
     and Tuesday the week just finished. The sheet is one page written over
     each week, so a day only counts when its row is that date's: dated rows
     by their date, undated ones (from before v3.9.6) as the latest such day. */
  function tsRow(sheet, date){
    var day = dayOf(date), r = (sheet.days || {})[day] || {};
    if(!r.start && !r.end) return { empty: true };
    if(r.date ? r.date === date : date === lastDayOn(day, tsToday())) return r;
    return { other: r.date || 'unknown' };
  }
  function tsReadDay(date){
    var sheet = tsSheet();
    if(!sheet) return cant("I can't reach the timesheet.", 'ts none');
    var r = tsRow(sheet, date), when = dateSay(date);
    tsNote(date);
    if(r.other) return ans('answer', { say: ["I don't have " + when + ' any more. That day has newer times on it now.'], log: 'ts read gone' });
    if(r.empty) return ans('answer', { say: ['Nothing on ' + when + '.'], log: 'ts read empty day' });
    if(!r.end) return ans('answer', { say: [when + ': started ' + timeSay(r.start) + ', no finish yet.'], log: 'ts read day' });
    return ans('answer', { say: [when + ': ' + timeSay(r.start) + ' to ' + timeSay(r.end) + ', ' + hoursSay(hoursOf(r.start, r.end)) + '.'], log: 'ts read day' });
  }
  function daysSay(list){
    var idx = list.map(function(d){ return TS_DAYS.indexOf(d); });
    var run = list.length >= 3 && idx.every(function(x, i){ return !i || x === idx[i - 1] + 1; });
    return run ? DAY_FULL[list[0]] + ' to ' + DAY_FULL[list[list.length - 1]] : joinAnd(list.map(function(d){ return DAY_FULL[d]; }));
  }
  /* v3.11.2 (owner, 13 Oct: "it needs to understand the difference between
     this week and last week and up until now"; his rule, from Claude's
     proposal): "this week" is this week, on a Monday or Tuesday too (it meant
     the week just finished there). Before any of it is on the timesheet it
     says so, with his first rostered shift still to come and last week's
     total. "How many hours am I doing / rostered" is the roster (handle). */
  function tsReadWeek(last){
    var sheet = tsSheet();
    if(!sheet) return cant("I can't reach the timesheet.", 'ts none');
    var today = tsToday(), mon = keyDate(mondayOf(today));
    if(last) mon.setDate(mon.getDate() - 7);
    var isLast = !!last;
    tsNote(null);
    var sum = tsWeekSum(sheet, mon, today), total = sum.total, done = sum.done, gone = sum.gone, later = sum.later;
    var name = isLast ? 'Last week' : 'This week so far';
    var say;
    if(done.length) say = [name + ': ' + hoursSay(total) + ', ' + daysSay(done) + '.'];
    else if(isLast) say = ['Nothing for last week on the timesheet.'];
    else {
      var wed = addDays(mondayOf(today), RO_OFFSET.wed), lm = keyDate(mondayOf(today));
      lm.setDate(lm.getDate() - 7);
      var prev = tsWeekSum(sheet, lm, today), first = roFirstShift(today);
      say = [today < wed ? 'None yet this week.' : 'Nothing on the timesheet for this week yet.'];
      if(first) say.push(first);
      if(prev.done.length) say.push('Last week you did ' + hoursSay(prev.total) + '.');
    }
    if(later) say.push("Today's " + timeSay(later.start) + ' to ' + timeSay(later.end) + " isn't counted yet.");
    if(gone.length) say.push("I don't have " + (isLast ? "last week's " : '') + joinAnd(gone.map(function(d){ return DAY_FULL[d]; })) + ' any more: newer times are on ' + (gone.length === 1 ? 'it' : 'them') + '.');
    return ans('answer', { say: say, log: 'ts read week ' + (isLast ? 'last' : 'this') + ' ' + fmt(total) });
  }
  /* his first shift still to come this week, from the roster: "Your first shift is Wednesday at 3:30 pm." */
  function roFirstShift(today){
    var d = roData();
    if(!d || !d.me) return '';
    var mon = mondayOf(today), w = roWeek(d, mon);
    if(w.missing) return '';
    for(var i = 0; i < TS_DAYS.length; i++){
      var day = TS_DAYS[i], date = addDays(mon, RO_OFFSET[day]);
      if(date < today) continue;
      var x = roEntries(d, w, day).filter(function(y){ return y.id === d.me; })[0];
      if(x && date === today && toMin(x.s.start) <= tsNowMin()) return '';   // today's has started: it isn't still to come
      if(x) return 'Your first shift is ' + (date === today ? 'today' : DAY_FULL[day]) + ' at ' + timeSay(x.s.start) + '.';
    }
    return '';
  }
  /* one week of the timesheet up to today: hours, the days done, days whose row holds a newer date, today's shift still on */
  function tsWeekSum(sheet, mon, today){
    var total = 0, done = [], gone = [], later = null;
    TS_DAYS.forEach(function(d, i){
      var dt = new Date(mon); dt.setDate(mon.getDate() + 2 + i);   // Wed is Monday + 2
      var date = dateKey(dt);
      if(date > today) return;
      var r = tsRow(sheet, date);
      /* v3.11.2: a row still holding an older date isn't filled in yet this week
         (it said "newer times are on it" of last week's Wednesday); only a newer one is gone */
      if(r.other && r.other !== 'unknown' && r.other < date) return;
      if(r.other){ gone.push(d); return; }
      if(!(r.start && r.end)) return;
      /* v3.9.10: today counts once its finish has passed (his log: at 8:58 am
         "so far" counted the Sunday shift he hadn't worked yet) */
      if(date === today){
        var s0 = toMin(r.start), e0 = toMin(r.end), n0 = tsNowMin();
        if(e0 <= s0) e0 += 1440;          // finishes after midnight
        if(n0 < 5 * 60) n0 += 1440;       // it's still last night
        if(n0 < e0){ later = r; return; }
      }
      total += hoursOf(r.start, r.end); done.push(d);
    });
    return { total: total, done: done, gone: gone, later: later };
  }
  function tsReadBegin(text){
    var c = clean(text);
    if(/\blast weeks?\b/.test(c)) return tsReadWeek(true);   // "last week's" is "last weeks" once cleaned
    var date = tsDayIn(text, tsToday());
    if(date) return tsReadDay(date);
    if(/\b(week|weeks|weekly|total|so far|how many hours|all)\b/.test(c)) return tsReadWeek(false);
    var today = tsToday(), onSheet = TS_DAYS.indexOf(dayOf(today)) > -1;
    return asking('tsRead', 'Which day, or the whole week?',
      [{ label: 'Whole week', value: 'week' }, onSheet ? { label: 'Today', value: 'today' } : { label: 'Sunday', value: 'sun' }], {}, 'choice');
  }
  function tsHandle(kind, text){
    if(kind === 'read') return tsReadBegin(text);
    if(kind === 'edit') return tsEdit(text);
    if(kind === 'send'){
      if(host.open) host.open({ view: 'timesheet' });
      return ans('answer', { say: ["I can't send it by voice. It's on screen: check it, then tap Submit Timesheet."], keep: false, log: 'ts send' });
    }
    return tsBegin(text);
  }

  /* ---------- the roster, read only (v3.9.11) ---------- */
  function roData(){ try{ return host.roster ? host.roster() : null; }catch(e){ return null; } }
  function roNames(d){ return Object.keys((d && d.names) || {}).map(function(k){ return clean(d.names[k]); }).filter(Boolean); }
  /* the roster for the week that starts on that Monday: last, this or next */
  function roWeek(d, mon){
    if(mon === d.week) return { roster: d.thisWeek || {}, names: d.names, label: 'This week' };
    if(mon === addDays(d.week, 7)) return { roster: d.nextWeek || {}, names: d.names, label: 'Next week' };
    if(mon === addDays(d.week, -7)){
      if(d.lastWeek && d.lastWeek.week === mon) return { roster: d.lastWeek.roster || {}, names: Object.assign({}, d.names, d.lastWeek.names || {}), label: 'Last week' };
      return { missing: true, label: 'Last week' };
    }
    return { missing: true, label: 'That week', far: true };
  }
  function roWho(d, w, id){ return id === d.me ? 'you' : (w.names[id] || 'someone'); }
  function roStation(s){ return s ? (RO_STATION_SAY[s] || String(s).toLowerCase()) : ''; }
  function roEntries(d, w, day){
    var e = (w.roster || {})[day] || {}, order = d.stations || [];
    return Object.keys(e).filter(function(id){ return e[id] && e[id].start; }).map(function(id){ return { id: id, s: e[id] }; }).sort(function(a, b){
      var ra = order.indexOf(a.s.station), rb = order.indexOf(b.s.station);
      ra = ra < 0 ? 99 : ra; rb = rb < 0 ? 99 : rb;
      return ra - rb || String(a.s.start).localeCompare(String(b.s.start));
    });
  }
  function roTimes(x){ return 'at ' + timeSay(x.s.start) + (x.s.end ? ' to ' + timeSay(x.s.end) : ''); }
  function roShift(x){ return (x.s.station ? 'on ' + roStation(x.s.station) + ' ' : '') + roTimes(x); }       // "on pasta at 4 pm"
  function roShiftT(x){ return roTimes(x) + (x.s.station ? ' on ' + roStation(x.s.station) : ''); }         // "at 4 pm on pasta"
  function roMissing(w, d){
    if(w.far) return cant('I only know last week, this week and next week.', 'roster far');
    var since = d.lastWeek && d.lastWeek.week ? ' The last one I kept is the week of ' + dateSay(d.lastWeek.week).replace(/^\w+ /, '') + '.' : ' The Pass keeps it from the 12 October changeover on.';
    return ans('answer', { say: ["I don't have last week's roster." + since], log: 'roster no last week' });
  }
  /* which day a question means, and which week: "last week", "next week",
     "tomorrow", a day name. A day already gone this week, asked about in the
     present tense ("who's on Wednesday" on a Sunday), means the coming one. */
  function roWhen(text, d, sess){
    var c = clean(text), today = tsToday(), date = null, mon = d.week;
    var past = /\b(was|were|worked|did)\b/.test(c);
    if(sess){   // v3.10.0: building a roster: "Thursday" is that week's, "last Thursday" the week before
      mon = /\blast\b/.test(c) ? sess.ref : sess.build;
      for(var si = 0; si < DAY_KEYS.length; si++){
        if(new RegExp('\\b' + DAY_FULL[DAY_KEYS[si]].toLowerCase() + 's?\\b').test(c)){ date = addDays(mon, RO_OFFSET[DAY_KEYS[si]]); break; }
      }
      return { date: date, mon: mon };
    }
    if(/\blast weeks?\b/.test(c)) mon = addDays(d.week, -7);   // "last week's" is "last weeks" once cleaned
    else if(/\bnext weeks?\b/.test(c)) mon = addDays(d.week, 7);
    if(/\btomorrow(s)?\b/.test(c)) date = addDays(today, 1);
    else if(/\b(today|todays|tonight|tonights)\b/.test(c)) date = today;
    else if(/\b(yesterday|yesterdays|last night)\b/.test(c)) date = addDays(today, -1);
    else {
      for(var i = 0; i < DAY_KEYS.length; i++){
        var dk = DAY_KEYS[i];
        if(!new RegExp('\\b' + DAY_FULL[dk].toLowerCase() + 's?\\b').test(c)) continue;
        if(new RegExp('\\blast ' + DAY_FULL[dk].toLowerCase()).test(c)) mon = addDays(d.week, -7);
        else if(new RegExp('\\bnext ' + DAY_FULL[dk].toLowerCase()).test(c)) mon = addDays(d.week, 7);
        date = addDays(mon, RO_OFFSET[dk]);
        if(!/\b(last|next|this) weeks?\b|\b(last|next) \w+day\b/.test(c) && date < today && !past) date = addDays(date, 7);
        break;
      }
    }
    if(date) mon = mondayOf(date);
    return { date: date, mon: mon };
  }
  /* v3.10.1 (owner, 12 Oct: "if I ask for more details, something along the
     lines of which section they are working, I would love to hear that"):
     asked for detail, the answer says each person's station; "more details"
     right after a roster answer asks that same question again, in detail */
  var RO_DETAIL = /\b(more details?|in detail|full details?|the details|tell me more|more info|which (sections?|stations?)|what (sections?|stations?)|whos on what|who is on what|whos doing what|sections|stations)\b/;
  var roLast = null, roSeq = 0;   // roSeq: which came last, a roster answer or a change (the clock can tie)
  /* v3.11.1: roLast also keeps the day asked about and the one person named,
     for "and Friday", "remove Sanjay as well" and "what date is he off" */
  var RO_FOLLOW_MS = 2 * 60 * 1000;
  var RO_END = '21:00';   // owner, 13 Oct: the finish isn't set, "generally assumed to be 9pm"
  function rosterAnswer(text, forceWeek, sess){
    var a = rosterAnswer1(text, forceWeek, sess);
    if(a && a.status === 'answer'){
      var d = roData(), w = d ? roWhen(text, d, sess) : null;
      roLast = { text: String(text || ''), sess: sess || null, at: now(), seq: ++roSeq, date: w && w.date || null, who: d ? roPersonIn(text, d) : null };
    }
    return a;
  }
  function roPersonIn(text, d){
    var c = clean(text), ids = Object.keys(d.names || {}).filter(function(id){ var n = clean(d.names[id]); return n && new RegExp('\\b' + n + 's?\\b').test(c); });
    return ids.length === 1 ? ids[0] : null;
  }
  function roRecent(){ return roLast && !roLast.sess && now() - roLast.at <= RO_FOLLOW_MS ? roLast : null; }
  /* "and Friday", "check Saturday as well", "what about Sunday" right after a
     roster answer about one day: the same question, about that day. Only when
     the roster answered last (not the timesheet or a list read since). */
  var RO_DAY_RE = new RegExp('\\b(?:(?:on|for) )?(?:(?:this|next|last) )?(?:' + DAY_WORDS + ')s?\\b', 'g');
  function roFollowDay(text, lastR){
    var r = roRecent();
    if(!r || (tsLast && tsLast.at > r.at) || lastR) return null;   // lastR: a list was read just now
    // v3.11.2 (his log, 13 Oct): "for this weekend" after a question about the week
    var cw = clean(text), we = cw.match(/^(?:(?:and|so|ok|okay|for|what about|how about|on|over|the|just|only) )*((?:this |next )?weekend)$/);
    if(we){
      var bw = clean(r.text).replace(RO_DAY_RE, ' ').replace(/\b(?:for |over |on )?(?:the )?(?:this |next |last )?(?:whole )?weeks?(?:ends?)?\b/g, ' ').replace(/\s+/g, ' ').trim();
      return rosterAnswer(bw + ' ' + (/^(this|next) /.test(we[1]) ? we[1] : 'this ' + we[1]), false, null);
    }
    if(!r.date) return null;
    var c = clean(text), days = c.match(RO_DAY_RE);
    if(!days || days.length !== 1) return null;
    var rest = c.replace(RO_DAY_RE, ' ').replace(/\b(and|also|so|ok|okay|now|then|check|what|whats|how|hows|about|same|for|with|on|the|please|as|well|too|again|one|day|is|it)\b/g, ' ').trim();
    if(rest) return null;
    var base = clean(r.text).replace(RO_DAY_RE, ' ').replace(/\s+/g, ' ').trim();
    return rosterAnswer(base + ' ' + days[0].trim(), false, null);
  }
  /* "what date is he off", "how many hours is she doing": he/she is the one
     person the last roster answer named (2 minutes) */
  function roPronoun(text){
    var r = roRecent(), d = r && r.who ? roData() : null;
    if(!d || !d.names[r.who] || roPersonIn(text, d)) return text;
    var c = clean(text);
    if(!/\b(he|she|him|her|his|hes|shes|they|them|their)\b/.test(c)) return text;
    var n = d.names[r.who];
    return c.replace(/\b(his|her|their)\b/g, n + 's').replace(/\b(hes|shes)\b/g, n + ' is').replace(/\b(he|she|him|they|them)\b/g, n);
  }
  function rosterAnswer1(text, forceWeek, sess){
    var d = roData();
    if(!d) return cant("I can't reach the roster.", 'roster none');
    var c = clean(text), when = roWhen(text, d, sess), detail = RO_DETAIL.test(c);
    /* v3.11.2 (his log, 13 Oct: "for this weekend"): the weekend is Saturday and Sunday */
    var weekend = !when.date && /\bweekends?\b/.test(c);
    if(weekend && !sess) when = { date: null, mon: /\bnext weekends?\b/.test(c) ? addDays(d.week, 7) : /\blast weekends?\b/.test(c) ? addDays(d.week, -7) : d.week };
    var w = roWeek(d, when.mon);
    if(w.missing) return roMissing(w, d);
    // who it's about: a station, a person (or "I"), or how many
    var station = (d.stations || []).filter(function(s){ return new RegExp('\\b' + clean(roStation(s)) + '\\b|\\b' + clean(s) + '\\b').test(c); })[0] || null;
    /* v3.9.12 (owner, 11 Oct): "pizza" is a section: Oven, Dough, Toppings and
       Finisher. Pasta is its own section; KH isn't pizza. "Who's on pizza?"
       says each person with their station. */
    var pizza = /\bpizzas?\b/.test(c) ? RO_PIZZA.filter(function(s){ return (d.stations || []).indexOf(s) > -1; }) : [];
    var section = pizza.length ? { name: 'pizza', set: pizza, group: true } : station ? { name: roStation(station), set: [station], group: false } : null;
    // v3.10.1 (his log): "can you tell me Wednesday's roster" is about Wednesday, not about him
    var me = /\b(am i|do i|my|me|i work|i on)\b/.test(c.replace(/\b(tell|give|show|read|send) me\b/g, ' ')) && !/\bwho\b/.test(c);
    var person = me ? d.me : Object.keys(d.names || {}).filter(function(id){ var n = clean(d.names[id]); return n && new RegExp('\\b' + n + 's?\\b').test(c); })[0] || null;
    var count = /\bhow many\b/.test(c);
    var off = /\b(off|days? off|not working|not on)\b/.test(c) && !/\b(take|took|taking|put|get) \w+( \w+)? off\b/.test(c), hours = /\bhours?\b/.test(c);
    var days = when.date ? [dayOf(when.date)] : weekend ? ['sat', 'sun'] : TS_DAYS.slice();
    if(when.date && TS_DAYS.indexOf(days[0]) < 0) return ans('answer', { say: ["The kitchen's closed on " + DAY_FULL[days[0]] + 's.'], log: 'roster closed day' });
    var dateOf = function(day){ return addDays(when.mon, RO_OFFSET[day]); };
    var lab = weekend ? w.label + 'end' : w.label, wk = lab.toLowerCase();   // "This weekend"
    if(!when.date && !section && !person && !count && !forceWeek && !weekend && !/\b(week|whole|all)\b/.test(c)){
      // last or next week: say the day; this week: today and tomorrow are a tap away
      return asking('roDay', 'Which day, or the whole week?', [{ label: 'Whole week', value: 'week' }].concat(when.mon === d.week
        ? [{ label: 'Today', value: 'today' }, { label: 'Tomorrow', value: 'tomorrow' }] : []), { text: text, sess: sess || null }, 'choice');
    }
    if(person){
      var pn = person === d.me ? 'You' : (w.names[person] || 'They');
      var shifts = days.map(function(day){ var x = roEntries(d, w, day).filter(function(y){ return y.id === person; })[0]; return x ? { day: day, x: x } : null; }).filter(Boolean);
      var where = when.date ? 'on ' + dateSay(when.date) : wk;
      var you = person === d.me, list = joinAnd(shifts.map(function(s){ return (when.date ? '' : DAY_FULL[s.day] + ' ') + roShiftT(s.x); }));
      // v3.11.1 (his log, 13 Oct: "what date is he off"): the open days without a shift
      if(off && when.date) return ans('answer', { say: [shifts.length ? 'No, ' + (you ? "you're on " : pn + "'s on ") + dateSay(when.date) + ' ' + roTimes(shifts[0].x) + '.' : 'Yes, ' + (you ? "you're off " : pn + "'s off ") + dateSay(when.date) + '.'], log: 'roster off day' });
      if(!shifts.length) return ans('answer', { say: [(you ? "You're not" : pn + " isn't") + ' on the roster ' + where + '.'], log: 'roster person none' });
      if(off){
        var offDays = days.filter(function(day){ return !shifts.some(function(x){ return x.day === day; }); });
        if(!offDays.length) return ans('answer', { say: [(you ? "You're on" : pn + "'s on") + ' every day ' + where + '.'], log: 'roster off none' });
        return ans('answer', { say: [(you ? "You're off " : pn + "'s off ") + joinAnd(offDays.map(function(day){ return dateSay(dateOf(day)); })) + '.'], log: 'roster off ' + offDays.length });
      }
      /* v3.11.1 (owner, 13 Oct): "how many hours is someone doing that week or
         that day". A shift with no finish is counted to 9 pm, and said so. */
      if(hours){
        var tot = 0, guessed = 0;
        shifts.forEach(function(x){ if(!x.x.s.end) guessed++; tot += hoursOf(x.x.s.start, x.x.s.end || RO_END); });
        var hrs = (you ? "You're on " : pn + "'s on ") + (guessed ? 'about ' : '') + hoursSay(tot);
        if(when.date){
          var x0 = shifts[0].x.s;
          return ans('answer', { say: [hrs + ' on ' + dateSay(when.date) + ': ' + (x0.end ? timeSay(x0.start) + ' to ' + timeSay(x0.end) : 'from ' + timeSay(x0.start) + ', counted to ' + timeSay(RO_END)) + '.'], log: 'roster hours day' });
        }
        var nS = shifts.length;
        return ans('answer', { say: [hrs + ' ' + wk + ': ' + nS + (nS === 1 ? ' shift' : ' shifts') + (guessed ? (guessed === nS ? ', counted to ' + timeSay(RO_END) : ', ' + guessed + ' of them counted to ' + timeSay(RO_END)) : '') + '.'], log: 'roster hours ' + nS });
      }
      // v3.11.1 (his log): "how many days is Anil working this week" says the number first
      if(count && !when.date) return ans('answer', { say: [(you ? "You're working " : pn + "'s working ") + shifts.length + (shifts.length === 1 ? ' day ' : ' days ') + where + ': ' + list + '.'], log: 'roster person ' + shifts.length });
      return ans('answer', { say: [pn + ' ' + where + ': ' + list + '.'], log: 'roster person ' + shifts.length });
    }
    if(section){
      var on = days.map(function(day){ return { day: day, xs: roEntries(d, w, day).filter(function(y){ return section.set.indexOf(y.s.station) > -1; }) }; }).filter(function(o){ return o.xs.length; });
      var sn = cap(section.name);
      // a section of several stations says each person's station too
      var who2 = function(y, time){ return roWho(d, w, y.id) + (section.group ? ' on ' + roStation(y.s.station) : '') + (time ? ' at ' + timeSay(y.s.start) : ''); };
      if(!on.length) return ans('answer', { say: ['Nobody on ' + section.name + ' ' + (when.date ? 'on ' + dateSay(when.date) : wk) + '.'], log: 'roster station none' });
      if(when.date) return ans('answer', { say: [sn + ' on ' + dateSay(when.date) + ': ' + joinAnd(on[0].xs.map(function(y){ return who2(y, true); })) + '.'], log: 'roster station day' });
      if(section.group) return ans('answer', { say: [sn + ' ' + wk + '. ' + on.map(function(o){ return DAY_FULL[o.day] + ': ' + joinAnd(o.xs.map(function(y){ return who2(y, false); })) + '.'; }).join(' ')], log: 'roster section week' });
      return ans('answer', { say: [sn + ' ' + wk + ': ' + joinAnd(on.map(function(o){ return DAY_FULL[o.day] + ' ' + joinAnd(o.xs.map(function(y){ return roWho(d, w, y.id); })); })) + '.'], log: 'roster station week' });
    }
    if(count){
      if(when.date){
        var xs = roEntries(d, w, days[0]);
        if(!xs.length) return ans('answer', { say: ['Nobody on ' + dateSay(when.date) + '.'], log: 'roster count 0' });
        return ans('answer', { say: [xs.length + (xs.length === 1 ? ' person' : ' people') + ' on ' + dateSay(when.date) + ': ' + joinAnd(xs.map(function(y){ return roWho(d, w, y.id); })) + '.'], log: 'roster count ' + xs.length });
      }
      return ans('answer', { say: [lab + ': ' + days.map(function(day){ return DAY_FULL[day] + ' ' + roEntries(d, w, day).length; }).join(', ') + '.'], log: 'roster count week' });
    }
    if(when.date){
      var es = roEntries(d, w, days[0]);
      if(!es.length) return ans('answer', { say: ["Nobody's rostered on " + dateSay(when.date) + '.'], log: 'roster day empty' });
      return ans('answer', { say: [dateSay(when.date) + ': ' + joinAnd(es.map(function(y){ return roWho(d, w, y.id) + ' ' + roShift(y); })) + '.'],
        show: { title: 'Roster · ' + dateSay(when.date), lines: es.map(function(y){ return { text: [cap(roWho(d, w, y.id)), y.s.station || '', timeSay(y.s.start) + (y.s.end ? ' – ' + timeSay(y.s.end) : '')].filter(Boolean).join(' · '), tone: 'ok' }; }) }, log: 'roster day ' + es.length });
    }
    // the whole week: names spoken, times on the card
    var lines = days.map(function(day){ var es2 = roEntries(d, w, day); return DAY_FULL[day] + ': ' + (es2.length ? joinAnd(es2.map(function(y){ return roWho(d, w, y.id) + (detail ? ' ' + roShift(y) : ''); })) : 'nobody') + '.'; });
    return ans('answer', { say: [lab + '. ' + lines.join(' ')],
      show: { title: lab + "'s roster", lines: days.map(function(day){ var es3 = roEntries(d, w, day); return { text: DAY_FULL[day].slice(0, 3) + ' · ' + (es3.length ? es3.map(function(y){ return cap(roWho(d, w, y.id)) + ' ' + timeSay(y.s.start); }).join(', ') : '—'), tone: 'ok' }; }) },
      log: 'roster week' + (detail ? ' detail' : '') });
  }
  /* "more details" / "which section?" just after a roster answer (2 minutes) */
  function roDetailAgain(text){
    if(!roLast || now() - roLast.at > 120000 || !RO_DETAIL.test(clean(text))) return null;
    if(rosterIntent(text, roNames(roData())) && roWhen(text, roData(), roLast.sess).date) return null;   // a new question with its own day
    return rosterAnswer(roLast.text + ' in detail', false, roLast.sess);
  }
  function rosterReply(p, req, mode){
    var text = String(req.text || ''), choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null, c = clean(text);
    pending = null;
    if(choice === 'week' || (!choice && /\b(week|whole|all|everyone|everything)\b/.test(c))) return rosterAnswer(p.text + ' ' + (/\blast\b/.test(c) ? 'last week' : ''), true, p.sess);
    if(choice === 'today' || choice === 'tomorrow') return rosterAnswer(p.text + ' ' + choice);
    if(/\b(today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/.test(c)) return rosterAnswer(p.text + ' ' + text, false, p.sess);
    return ans('answer', { say: ['Left it.'], log: 'roster ask dropped' });
  }

  /* ---------- building the roster by voice (v3.10.0) ----------
     Layer 2 of his spec. Every change goes through roster-engine (RE) and
     the page's host.setRosterDays, and every read-back is built from what
     was stored after it, never from what was meant. The session (which
     week, which days are done, the day in focus, the question last asked)
     is kept in storage, so closing the card or the app loses nothing. */
  var rbOther = true;   // something other than the roster answered last, so a bare "yes" isn't the roster's
  var RB_YES = /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|sounds good|perfect|good|great|lovely|cool|fine|go ahead|do it|yes please)\b/;
  var RB_NO = /^(no|nah|nope|not really|negative)\b/;
  var RB_NEXT = /^(next|move on|next day|go on|onwards|keep going|thats it|thats all|nothing else|nothing|done|all done|were done|im done|finished|no more|thats everything)\b|\b(move on|next day|nothing else|thats it|thats all|next one|thats everything)$/;
  var RB_SAME = /\bsame\b|\bas last week\b|\bcopy (it|that|last weeks?|the last one)\b/;
  var RB_KEEP = /\b(keep (it|that|them|as is)|leave it( as is)?|thats (fine|good|right|correct)|as is|looks good|all good|its fine|its good|that works)\b/;
  var RB_SKIP = /\b(skip|come back to (it|that)|do it later|leave it for now|not sure yet|dont know yet|park it)\b/;
  var RB_CLOSED = /\b(closed|shut|nobody|no one|noone|none)\b/;
  /* v3.11.19 (his log, 18 Oct): a day left with nobody on it ("no one working", "leave
     that empty", "leave the shift blank" (heard "blend"), "no rosters that day", "clear Wednesday") */
  var RB_DAYW = '(?:wednesday|thursday|friday|saturday|sunday)s?';
  var RB_EMPTY_LEAD = '^(?:(?:no|nah|just|ok|okay|so|then|um|uh)\\s+)*(?:(?:can you |could you |please |lets )*(?:';
  var RB_EMPTY_SAID = [
    '(?:leave|keep|make)\\s+(?:it|that|this|the day|the shift|the shifts|' + RB_DAYW + ')\\s+(?:empty|blank|blend|bland|clear|free)',
    'no\\s+(?:rosters?|shifts?|staff)(?:\\s+(?:that day|on that day|for that day|then|on it|today))?',
    '(?:clear|empty|wipe)\\s+(?:out\\s+)?(?:it|that|this|the day|the shift|' + RB_DAYW + ')(?:\\s+roster)?'
  ];
  var RB_NOBODY = '(?:no ?one|nobody|noone)(?:\\s+(?:on|working|at all|rostered|is working|is on|that day|on that day|then))*';
  var RB_EMPTY = new RegExp(RB_EMPTY_LEAD + RB_EMPTY_SAID.concat([RB_NOBODY]).join('|') + '))$');
  // the same, without a bare "nobody" ("Anything else?" → "nobody" is no one else, not an empty day)
  var RB_EMPTY_STRONG = new RegExp(RB_EMPTY_LEAD + RB_EMPTY_SAID.join('|') + '))$');
  var RB_CHANGE = /^(?:(?:i want to |id like to |lets |let me |can we |we need to |i need to |i wanna )?(?:make )?(?:a |some |a few )?(?:change|changes|change it|change that|change something)|different|its different)$/;
  var RB_GOOD_DAY = new RegExp('^' + RB_DAYW + '\\s+(?:is\\s+)?(?:good|fine|done|set|sorted|all good|perfect)\\b');
  /* v3.11.19 (his log, 18 Oct: "can you remove the next roster entirely and will build it
     again" was "I don't have Entirely on the staff list"): the whole week, read back first */
  var RB_CLEAR_WEEK = /^(?:(?:can you|could you|would you|please|lets|just|so|ok|okay|i want to|i need to) )*(?:clear|remove|delete|wipe|scrap|empty|reset|erase)\s+(?:out\s+)?(?:(?:the|this|next|my|our|whole|entire|this weeks|next weeks)\s+)*(?:roster|week)(?:\s+roster)?(?:\s+(?:entirely|completely|altogether|fully|for (?:this|next) week))?(?:\s+(?:and|so)\b.*)?$/;
  /* v3.11.19 (his log, 18 Oct: "let's build Friday's roster" in the middle of the roster) */
  var RB_GO_DAY = new RegExp('^(?:(?:ok|okay|so|now|and|right) )*(?:lets |can we |can you |could you )?(?:build|do|make|start|go to|go back to|jump to|move on to|move to|skip to|work on)\\s+(?:(?:the|next weeks|this weeks)\\s+)?(' + RB_DAYW + ')(?:\\s+(?:roster|shifts?|next))?$');
  var RB_UNDO = /^(undo|undo that|undo it|scratch that|scrap that|take that back)$/;
  function rbData(){
    var d = roData();
    if(!d) return null;
    if(!d.staff) d.staff = Object.keys(d.names || {}).map(function(id){ return { id: id, name: d.names[id] }; });
    return d;
  }
  function rbNextMon(d){ return addDays(d.week, 7); }
  function rbEditable(d, mon){ return mon === d.week || mon === rbNextMon(d); }
  function rbWeekOf(d, mon){ return RE.cloneWeek(mon === d.week ? d.thisWeek : mon === rbNextMon(d) ? d.nextWeek : null); }
  /* "last week" for the week being built: the one before it, as kept */
  function rbRefOf(d, mon){
    var r = addDays(mon, -7);
    if(r === d.week) return { roster: RE.cloneWeek(d.thisWeek), names: d.names || {} };
    if(d.lastWeek && d.lastWeek.week === r) return { roster: RE.cloneWeek(d.lastWeek.roster), names: Object.assign({}, d.names || {}, d.lastWeek.names || {}) };
    return null;
  }
  function rbCtx(d){ return { staff: d.staff, close: RE.CLOSE }; }
  function rbSaver(mon){ return function(days){ return host.setRosterDays ? host.setRosterDays(mon, days) : null; }; }
  function rbWho(d, id, names){ return id === d.me ? 'you' : (names || {})[id] || (d.names || {})[id] || 'someone'; }
  function rbIs(n){ return n === 'you' ? "you're" : n + "'s"; }
  function rbStaffName(d, id){ var s = (d.staff || []).filter(function(x){ return x.id === id; })[0]; return s ? s.name : rbWho(d, id); }
  /* a day, earliest first, the same times together: "Anil at 3, Nathan and you at 4" */
  function rbDaySay(d, entries, names){
    var list = RE.dayList({ x: entries || {} }, 'x');
    if(!list.length) return 'nobody';
    var groups = [];
    list.forEach(function(x){
      var g = groups[groups.length - 1];
      if(g && g.start === x.start && g.end === x.end) g.ids.push(x.id); else groups.push({ start: x.start, end: x.end, ids: [x.id] });
    });
    return groups.map(function(g){
      var nm = g.ids.map(function(id){ return rbWho(d, id, names); }).sort(function(a, b){ return a === 'you' ? 1 : b === 'you' ? -1 : a < b ? -1 : a > b ? 1 : 0; });
      return joinAnd(nm) + ' at ' + rbTime(g.start) + (g.end ? ' till ' + rbTime(g.end) : '');
    }).join(', ');
  }
  function rbSession(){ var s = get(RB_KEY, null); return s && s.v === 1 && s.week && s.days ? s : null; }
  function rbKeep(s){ s.at = now(); put(RB_KEY, s); rbOther = false; return s; }
  function rbLive(s, d){ return !!(s && !s.finished && !s.paused && now() - (s.at || 0) < RB_LIVE_MS && d && rbEditable(d, s.week)); }
  function rbLearned(){ var w = get(RB_NAMES_KEY, {}); return w && typeof w === 'object' ? w : {}; }
  function rbLearn(word, id){ if(!word || !id) return; var w = rbLearned(); w[word] = id; put(RB_NAMES_KEY, w); }
  function rbFinder(d, fix){
    var idx = rbIndex(d.staff, d.me), learned = rbLearned(), ids = (fix && fix.ids) || {};
    return function(w){ return ids[w] ? { ids: [ids[w]], sure: true } : rbMatch(w, idx, learned); };
  }
  function rbWeekWord(d, mon){ return mon === d.week ? 'This week' : 'Next week'; }
  function rbSay(status, lines, log, extra){
    rbOther = false;
    var ax = Object.assign({}, extra || {}), pre = ax.logPre;
    delete ax.logPre;
    return ans(status, Object.assign({ say: (lines || []).filter(Boolean), log: (pre ? pre + ' | ' : '') + log }, ax));
  }
  /* a question in the roster: kept in the session too, so "yes" still
     answers it after the card has closed (it closes 10 s after quiet) */
  function rbAsk(kind, lines, q, options, data, s, log, extra){
    askN++;
    pending = Object.assign({ id: 'ask-' + askN, kind: kind, options: options || [], say: q }, data || {});
    if(s){ s.asked = Object.assign({ kind: kind, q: q, options: options || [] }, data || {}); rbKeep(s); }
    rbOther = false;
    var say = (lines || []).filter(Boolean), ax = Object.assign({}, (extra && extra.ans) || {}), pre = ax.logPre;
    delete ax.logPre;
    say = say.length >= 3 ? say.slice(0, 2).concat([say.slice(2).join(' ') + ' ' + q]) : say.concat([q]);
    return ans('ask', Object.assign({ say: say, ask: { id: pending.id, expect: (extra && extra.expect) || 'choice', options: (options || []).slice(0, 4) },
      log: (pre ? pre + ' | ' : '') + (log || 'rb ask ' + kind) }, ax));
  }
  /* the session's question again, after an answer to something else
     (v3.11.19: its short form, when it has one) */
  var RB_MODE_SHORT = 'Day by day, or copy last week?';
  function rbReask(s, lines, log, extra){
    if(s && s.asked && s.asked.kind){
      var a = s.asked, data = {};
      Object.keys(a).forEach(function(k){ if(k !== 'kind' && k !== 'q' && k !== 'options') data[k] = a[k]; });
      return rbAsk(a.kind, lines, a.short || a.q, a.options, data, s, log, extra);
    }
    return rbSay('answer', lines, log, extra ? extra.ans : null);
  }
  function rbWarn(ws, d, mon){
    var ref = rbRefOf(d, mon), out = [];
    (ws || []).forEach(function(w){
      var n = w.id ? rbWho(d, w.id) : '', you = w.id === d.me;
      if(w.code === 'afterClose') out.push(cap(n) + (you ? ' start' : ' starts') + ' at ' + rbTime(w.start) + ', after close.');
      else if(w.code === 'empty') out.push("Nobody's on " + DAY_FULL[w.day] + ' now.');
      else if(w.code === 'cover') out.push(cap(n) + (you ? " don't" : " doesn't") + ' usually work ' + DAY_FULL[w.day] + "s, so it's a cover.");
      else if(w.code === 'gone') out.push(cap(joinAnd(w.ids.map(function(id){ return (ref && ref.names[id]) || 'someone'; }))) + (w.ids.length === 1 ? " isn't" : " aren't")   // v3.11.19: "Someone" at the start
        + ' on the staff list any more, so I left ' + (w.ids.length === 1 ? 'them' : 'them') + ' out.');
    });
    return out.join(' ');
  }
  function rbOpLog(o){
    if(o.op === 'add') return 'add ' + o.day + ' ' + o.id + ' ' + o.start + (o.end ? '-' + o.end : '') + (o.station ? '/' + o.station : '');
    if(o.op === 'remove') return 'remove ' + o.day + ' ' + o.id;
    if(o.op === 'replace') return 'replace ' + o.day + ' ' + o.from + '>' + o.to + (o.start ? ' ' + o.start : '');
    if(o.op === 'setTime') return 'time ' + o.day + ' ' + o.id + (o.start != null ? ' s' + o.start : '') + (o.end != null ? ' e' + (o.end || 'none') : '');
    if(o.op === 'shift') return 'shift ' + (o.days || []).join(',') + ' ' + o.id + ' ' + (o.minutes > 0 ? '+' : '') + o.minutes + (o.part && o.part !== 'both' ? ' ' + o.part : '');
    if(o.op === 'station') return 'station ' + o.day + ' ' + o.id + ' ' + o.station;
    if(o.op === 'copy') return 'copy ' + o.day;
    if(o.op === 'clear') return 'clear ' + o.day;
    return o.op;
  }

  /* ---- his sentence as engine changes ----
     env: { mon, day (in focus, or null), base ('ref': last week's day is
     copied in first, because that's what was read out), session, last
     ({ id, day, field }: what "make that 4" means), fix (answers to earlier
     questions: ids, ampm, times, day) }. Returns { ops, days, did, issue }. */
  var RB_SWAP = ['swap', 'switch', 'sub', 'substitute', 'replace', 'trade', 'swop', 'change'];
  var RB_COVER = ['instead', 'replacing', 'covering', 'cover', 'place'];
  var RB_TAKE = ['take', 'get', 'knock', 'pull', 'bump', 'kick', 'scratch', 'cross', 'strike'];
  var RB_REMOVE = ['remove', 'cut', 'ditch', 'lose', 'scrap', 'delete', 'cancel', 'bin', 'drop'];
  var RB_ADD = ['put', 'add', 'have', 'get', 'bring', 'stick', 'pop', 'chuck', 'throw', 'book', 'schedule', 'need', 'roster', 'give', 'on'];
  function rbKind(cl){
    var tk = cl.tk, ty = cl.ty, i, j;
    var PU = function(x){ return ty[x] === 'P' || ty[x] === 'U'; };
    var nextPU = function(x){ for(; x < tk.length; x++) if(PU(x)) return x; return -1; };
    // replace: "swap Z for W", "replace Z with W", "change Z to W"
    for(i = 0; i < tk.length; i++){
      if(RB_SWAP.indexOf(tk[i]) < 0) continue;
      var a = nextPU(i + 1);
      if(a < 0) break;
      // "swap Nathan and Anil", "switch Nathan with Anil" when both are on: an exchange (the plan decides)
      if((tk[a + 1] === 'and' || tk[a + 1] === 'around') && PU(a + 2) && ['swap', 'switch', 'swop', 'trade'].indexOf(tk[i]) > -1) return { kind: 'exchange', a: a, b: a + 2 };
      for(j = a + 1; j < tk.length; j++){
        if(['for', 'with', 'by'].indexOf(tk[j]) > -1 || (tk[j] === 'to' && tk[i] !== 'switch')){
          var b = nextPU(j + 1);
          if(b > -1 && b - j <= 3) return { kind: 'replace', from: a, to: b };
        }
      }
    }
    // "W in for Z", "W instead of Z", "W covering Z", "put W on for Z"
    for(i = 0; i < tk.length; i++){
      if(!PU(i)) continue;
      for(j = i + 1; j < Math.min(tk.length, i + 6); j++){
        if(PU(j)) break;
        if(tk[j] === 'for' || RB_COVER.indexOf(tk[j]) > -1){
          var b2 = nextPU(j + 1);
          if(b2 > -1 && b2 - j <= 3) return { kind: 'replace', from: b2, to: i };
        }
      }
    }
    // "Z out, W in"
    for(i = 0; i < tk.length - 3; i++){
      if(PU(i) && tk[i + 1] === 'out'){ var c2 = nextPU(i + 2); if(c2 > -1 && tk[c2 + 1] === 'in') return { kind: 'replace', from: i, to: c2 }; }
    }
    var hasTime = !!(cl.start || cl.end), offAt = /\boff (at|by|around)\b/.test(cl.text);
    // remove: "take Y off", "remove Y", "Y's off", "Y can't make it", "no Y"
    var people = []; for(i = 0; i < tk.length; i++) if(PU(i)) people.push(i);
    if(people.length && !offAt && !cl.rel){
      var takeAt = -1; for(i = 0; i < tk.length; i++) if(RB_TAKE.indexOf(tk[i]) > -1){ takeAt = i; break; }
      if(takeAt > -1 && tk.indexOf('off', takeAt) > -1 && !hasTime) return { kind: 'remove', who: people };
      for(i = 0; i < tk.length; i++) if(RB_REMOVE.indexOf(tk[i]) > -1 && nextPU(i + 1) > -1 && !hasTime) return { kind: 'remove', who: people };
      if(/ P( and P)* (is |are |s )?(off|out|sick|away|not working|not on|not in|isnt working|isnt on|isnt in|cant make it|cant work|cant come|wont be in|wont be on|not coming|has the day off|day off|taking the day off)\b/.test(cl.shape) && !hasTime) return { kind: 'remove', who: people };
      if(/^ (no|without) P\b/.test(cl.shape) && !hasTime) return { kind: 'remove', who: people };
    }
    if(cl.rel) return { kind: 'shift', who: people };
    if(hasTime || cl.endClear) return { kind: people.length || cl.everyone ? 'time' : 'correct', who: people };
    if(cl.station && people.length) return { kind: 'station', who: people };
    if(people.length && (tk.some(function(w){ return RB_ADD.indexOf(w) > -1; }) || cl.days.length)) return { kind: 'add', who: people };
    return null;
  }
  function rbPlan(text, env){
    var d = env.d, fix = env.fix || {}, find = rbFinder(d, fix), mon = env.mon;
    var res = { mon: mon, ops: [], days: [], did: [], issue: null, last: null, pre: [], any: false };
    var itemWords = null;
    try{ itemWords = catWords(catalogue(host.data(), taught())); }catch(e){ itemWords = null; }
    var maybeNew = rbNewNames(text, itemWords);
    var clauses = rbClauses(text, find).map(function(c){ return rbClause(c, find, maybeNew); });
    // the week to change: the draft, with last week's day copied in first when that's what was read out
    var week = rbWeekOf(d, mon);
    if(env.day && env.base === 'ref'){
      var ref = rbRefOf(d, mon), Rd = ref && ref.roster[env.day];
      if(Rd && RE.dayList({ x: Rd }, 'x').length && !RE.sameDay(week[env.day], Rd)) res.pre.push({ op: 'copy', day: env.day, from: Rd });
    }
    if(res.pre.length){ var pr = RE.apply(week, { op: 'batch', ops: res.pre }, rbCtx(d)); if(pr.ok) week = pr.week; else res.pre = []; }
    var ops = [], lastP = null, carryDays = null, carryPeople = [], touched = {}, draft = rbWeekOf(d, mon);
    var dayTxt = function(x){ return x === env.day ? '' : env.session ? DAY_FULL[x] : rbDateSay(RE.dateOf(mon, x)); };
    var on = function(x, id){ return !!(week[x] && week[x][id] && week[x][id].start); };
    var startFor = function(cl, id, x){
      var st = rbStartOf(cl.start, { owner: id === d.me, day: x }, RE);
      if(st && st.ask){
        if(fix.ampm) return { time: fix.ampm === 'am' ? st.am : st.pm };
        return { issue: { ampm: true, h: cl.start.h, m: cl.start.m || 0, am: st.am, pm: st.pm } };
      }
      return st;
    };
    for(var ci = 0; ci < clauses.length && !res.issue; ci++){
      var cl = clauses[ci];
      if(/^(go back to|back to|go to|lets do|lets go to|now|what about|how about|onto|on to|actually go back to)\b/.test(cl.text) && cl.days.length && !cl.people.length){
        carryDays = cl.days.filter(function(x){ return RE.DAYS.indexOf(x) > -1; }); res.goto = carryDays[0]; continue;
      }
      // the next clause sees the week as this sentence has changed it so far ("put W on, make him start at 4")
      if(ci > 0 && ops.length){ var cur = RE.apply(draft, { op: 'batch', ops: res.pre.concat(ops) }, rbCtx(d)); if(cur.ok) week = cur.week; }
      var k = rbKind(cl);
      // "Who's on?" with no roster to go by: nothing but names ("Anil and Nathan", "me and Anil") puts them on
      var onlyNames = cl.tk.length && cl.tk.every(function(w, i){ return cl.ty[i] === 'P' || cl.ty[i] === 'U' || /^(and|just|only|also|too|plus|um|uh|er|oh|yeah|ok|okay|so|then|maybe)$/.test(w); });
      if(!k && env.addBare && onlyNames && (cl.people.length || cl.unknown.length)) k = { kind: 'add', who: cl.tk.map(function(w, i){ return i; }).filter(function(i){ return cl.ty[i] === 'P' || cl.ty[i] === 'U'; }) };
      if(!k) continue;
      res.any = true;
      // which days
      var days = cl.allWeek ? RE.DAYS.slice() : cl.days.filter(function(x){ return RE.DAYS.indexOf(x) > -1; });
      var shut = cl.days.filter(function(x){ return x === 'mon' || x === 'tue'; })[0];
      if(shut && !days.length){ res.issue = { closed: shut }; break; }
      if(cl.last){ res.issue = { lastWeek: true }; break; }
      if(!days.length) days = carryDays || (env.day ? [env.day] : fix.day ? [fix.day] : []);
      if(cl.days.length || cl.allWeek) carryDays = days;
      // the people, in the order said; "him" is the last one named
      var byTok = {}, unknownAt = {};
      for(var pj = 0; pj < cl.people.length && !res.issue; pj++){
        var pp = cl.people[pj];
        if(pp.me) byTok[pp.at] = d.me;
        else if(pp.pron){ var hw = lastP || (env.last && env.last.id); if(hw) byTok[pp.at] = hw; else res.issue = { who: true }; }
        else if(pp.ids.length > 1 || !pp.sure) res.issue = { pick: true, ids: pp.ids, word: pp.word };
        else byTok[pp.at] = pp.ids[0];
        if(byTok[pp.at]) lastP = byTok[pp.at];
      }
      if(res.issue) break;
      cl.unknown.forEach(function(u){ unknownAt[u.at] = u.word; });
      var idAt = function(t){ if(byTok[t]) return byTok[t]; if(unknownAt[t]){ res.issue = res.issue || { unknown: unknownAt[t] }; } return null; };
      var who = (k.who || []).map(idAt).filter(Boolean);
      if(res.issue && res.issue.unknown && ['remove', 'shift', 'exchange'].indexOf(k.kind) > -1) res.issue.noAdd = true;
      if(res.issue) break;
      if(!who.length && ci > 0 && (k.kind === 'time' || k.kind === 'shift' || k.kind === 'correct') && carryPeople.length && !cl.everyone){ who = carryPeople.slice(); if(k.kind === 'correct') k.kind = 'time'; }
      if(who.length) carryPeople = who;
      if(k.kind === 'correct'){
        if(!env.last || !env.last.id){ res.issue = { who: true }; break; }
        who = [env.last.id]; days = [env.last.day]; k.kind = 'time';
        if(env.last.field === 'end' && cl.start && !cl.end){ cl.end = cl.start; cl.start = null; }
      }
      if(!days.length){ res.issue = { needDay: true }; break; }
      if(k.kind === 'exchange'){
        var xa = idAt(k.a), xb = idAt(k.b);
        if(res.issue){ res.issue.noAdd = true; break; }
        for(var xi = 0; xi < days.length; xi++){
          var xd = days[xi], aOn = on(xd, xa), bOn = on(xd, xb), xt = dayTxt(xd);
          if(aOn && bOn && week[xd][xa].start === week[xd][xb].start && (week[xd][xa].end || '') === (week[xd][xb].end || '')){
            res.did.push(rbWho(d, xa) + ' and ' + rbWho(d, xb) + ' are both at ' + rbTime(week[xd][xa].start) + (xt ? ' on ' + xt : '') + ' already');
            continue;
          }
          if(aOn && bOn){
            var sa = week[xd][xa], sb = week[xd][xb];
            ops.push({ op: 'setTime', day: xd, id: xa, start: sb.start, end: sb.end || '' }, { op: 'station', day: xd, id: xa, station: sb.station || '' },
                     { op: 'setTime', day: xd, id: xb, start: sa.start, end: sa.end || '' }, { op: 'station', day: xd, id: xb, station: sa.station || '' });
            res.did.push(rbWho(d, xa) + ' and ' + rbWho(d, xb) + ' have swapped' + (xt ? ' on ' + xt : '') + ': ' + rbWho(d, xa) + ' at ' + rbTime(sb.start) + ', ' + rbWho(d, xb) + ' at ' + rbTime(sa.start));
          }
          else if(aOn || bOn){
            var fr = aOn ? xa : xb, tt = aOn ? xb : xa;
            ops.push({ op: 'replace', day: xd, from: fr, to: tt });
            res.did.push(rbIs(rbWho(d, tt)) + ' in for ' + rbWho(d, fr) + (xt ? ' on ' + xt : ''));
          }
          else { res.issue = { neitherOn: [xa, xb], day: xd }; break; }
          touched[xd] = 1;
        }
      }
      else if(k.kind === 'replace'){
        var from = idAt(k.from), to = idAt(k.to);
        if(res.issue && res.issue.unknown && !from) res.issue.noAdd = true;
        if(res.issue) break;
        for(var di = 0; di < days.length; di++){
          var op = { op: 'replace', day: days[di], from: from, to: to };
          if(cl.start){ var st0 = startFor(cl, to, days[di]) || {}; if(st0.issue){ res.issue = st0.issue; break; } if(st0.time) op.start = st0.time; }
          ops.push(op); touched[days[di]] = 1;
          res.did.push(rbIs(rbWho(d, to)) + ' in for ' + rbWho(d, from) + (dayTxt(days[di]) ? ' on ' + dayTxt(days[di]) : '') + (op.start ? ', starting at ' + rbTime(op.start) : ''));
        }
        res.last = { id: to, day: days[days.length - 1], field: 'start' };
      }
      else if(k.kind === 'remove'){
        if(res.issue) break;
        who.forEach(function(id){
          var ds = cl.allWeek ? RE.daysOn(week, id) : days;
          if(cl.allWeek && !ds.length){ res.issue = res.issue || { notOnWeek: id }; return; }
          ds.forEach(function(x){ ops.push({ op: 'remove', day: x, id: id }); touched[x] = 1; });
          var dt = cl.allWeek ? daysSay(ds) : ds.map(dayTxt).filter(Boolean).join(' and ');
          res.did.push(rbIs(rbWho(d, id)) + ' off' + (dt ? ' ' + dt : ''));
          res.removeAll = cl.allWeek ? (res.removeAll || []).concat([{ id: id, days: ds }]) : res.removeAll;
        });
      }
      else if(k.kind === 'shift'){
        var part = /\bstart/.test(cl.text) && !RB_END.test(cl.text) ? 'start' : RB_END.test(cl.text) && !/\bstart/.test(cl.text) ? 'end' : 'both';
        var targets = cl.everyone || !who.length ? ['all'] : who;
        var amt = Math.abs(cl.rel) === 30 ? 'half an hour' : Math.abs(cl.rel) === 60 ? 'an hour' : Math.abs(cl.rel) === 90 ? 'an hour and a half'
          : Math.abs(cl.rel) % 60 === 0 ? Math.abs(cl.rel) / 60 + ' hours' : Math.abs(cl.rel) + ' minutes';
        targets.forEach(function(id){
          ops.push({ op: 'shift', days: days.slice(), id: id, minutes: cl.rel, part: part });
          days.forEach(function(x){ touched[x] = 1; });
          var nm = id === 'all' ? 'everyone' : rbWho(d, id);
          var dt = days.map(dayTxt).filter(Boolean);
          res.did.push((nm === 'you' ? "you're " : nm === 'everyone' ? "everyone's " : nm + "'s ") + amt + (cl.rel > 0 ? ' later' : ' earlier') + (dt.length ? ' on ' + joinAnd(dt) : ''));
        });
      }
      else if(k.kind === 'time' || k.kind === 'station' || k.kind === 'add'){
        var ids = cl.everyone && !who.length ? null : who, didFrom = res.did.length;
        for(var dj = 0; dj < days.length && !res.issue; dj++){
          var x = days[dj];
          var list = ids || RE.dayList(week, x).map(function(e){ return e.id; });
          if(!list.length && cl.everyone){ res.issue = { emptyDay: x }; break; }
          for(var li = 0; li < list.length && !res.issue; li++){
            var id = list[li], nm = rbWho(d, id), dt = dayTxt(x), isOn = on(x, id), o2 = null;
            var start = null, end = null;
            if(cl.start){ var st1 = startFor(cl, id, x) || {}; if(st1.issue){ res.issue = st1.issue; break; } start = st1.time || null; }
            if(!start && !isOn && fix.times && fix.times[id + '@' + x]) start = fix.times[id + '@' + x];
            var from0 = start || (isOn ? week[x][id].start : null);
            if(cl.end) end = rbEndOf(cl.end, from0);
            else if(cl.endClear) end = '';
            if(isOn){
              if(start != null || end != null){
                o2 = { op: 'setTime', day: x, id: id };
                if(start != null) o2.start = start;
                if(end != null) o2.end = end;
                ops.push(o2);
                res.did.push(start != null ? (nm === 'you' ? 'you start' : nm + ' starts') + ' at ' + rbTime(start) + (dt ? ' on ' + dt : '') + (end ? ', finishing at ' + rbTime(end) : '')
                  : end ? (nm === 'you' ? 'you finish' : nm + ' finishes') + ' at ' + rbTime(end) + (dt ? ' on ' + dt : '')
                  : 'no early finish for ' + nm + (dt ? ' on ' + dt : ''));
                res.last = { id: id, day: x, field: start != null ? 'start' : 'end' };
              }
              if(cl.station){ ops.push({ op: 'station', day: x, id: id, station: cl.station }); res.did.push(rbIs(nm) + ' on ' + roStation(cl.station) + (dt ? ' on ' + dt : '')); }
              if(!o2 && !cl.station) res.did.push(rbIs(nm) + ' already on ' + (dt || DAY_FULL[x]) + ' at ' + rbTime(week[x][id].start));
              else touched[x] = 1;
            } else {
              if(!start){ res.issue = { needTime: id, day: x }; break; }
              ops.push({ op: 'add', day: x, id: id, start: start, end: end || '', station: cl.station || '' });
              touched[x] = 1;
              res.did.push(rbIs(nm) + ' on' + (dt ? ' ' + dt : '') + ' at ' + rbTime(start) + (end ? ' till ' + rbTime(end) : '') + (cl.station ? ' on ' + roStation(cl.station) : ''));
              res.last = { id: id, day: x, field: 'start' };
            }
          }
        }
        if(!ids && cl.start && !res.issue && res.did.length > didFrom){
          var allAt = /at (.+?)( on |,|$)/.exec(res.did[didFrom]);
          res.did.splice(didFrom, res.did.length - didFrom, 'everyone starts at ' + (allAt ? allAt[1] : 'that time') + (days.length === 1 && dayTxt(days[0]) ? ' on ' + dayTxt(days[0]) : ''));
        }
      }
    }
    res.ops = res.pre.concat(ops);
    res.days = RE.DAYS.filter(function(x){ return touched[x]; });
    // folded: "W's in for Z" then "W starts at 3" is one change, said once
    var folded = [];
    res.did.forEach(function(t){
      var prev = folded[folded.length - 1], m = /^(\w+) starts at (.+)$/.exec(t) || /^(you) start at (.+)$/.exec(t);
      if(prev && m && prev.indexOf((m[1] === 'you' ? "you're" : m[1] + "'s") + ' in for ') === 0 && prev.indexOf(', starting at') < 0) folded[folded.length - 1] = prev + ', starting at ' + m[2];
      else folded.push(t);
    });
    var joined = [];
    folded.forEach(function(t){
      var m = /^(.+?)(?:'s|'re) on( .+)$/.exec(t), prev = joined[joined.length - 1];
      if(m && prev && prev.tail === m[2]){ prev.names.push(m[1]); return; }
      joined.push(m ? { names: [m[1]], tail: m[2] } : { text: t });
    });
    res.did = joined.map(function(j){
      if(j.text) return j.text;
      return j.names.length > 1 ? joinAnd(j.names) + ' are on' + j.tail : rbIs(j.names[0]) + ' on' + j.tail;
    });
    return res;
  }
  /* the week a change outside a session means: the coming one of that day
     (today included), "next Friday" the week after, or today / tomorrow */
  function rbWhen(c, d){
    var today = tsToday(), date = null;
    if(/\b(today|tonight|todays|tonights)\b/.test(c)) date = today;
    else if(/\btomorrows?\b/.test(c)) date = addDays(today, 1);
    else {
      var tk = c.split(' ');
      for(var i = 0; i < tk.length && !date; i++){
        var dk = rbDayOf(tk[i]);
        if(!dk || dk === 'mon' || dk === 'tue' || tk[i - 1] === 'last') continue;
        date = today;
        while(dayOf(date) !== dk) date = addDays(date, 1);
        if(tk[i - 1] === 'next' && mondayOf(date) === mondayOf(today)) date = addDays(date, 7);
        else if(date === today && tk[i - 1] !== 'this') return { mon: mondayOf(date), day: dk, todayOrNext: true, next: mondayOf(addDays(date, 7)) };
      }
    }
    return date ? { mon: mondayOf(date), day: dayOf(date) } : null;
  }
  /* a change: understood, asked about, confirmed, or done */
  function rbEdit(text, env, lead){
    var d = rbData();
    if(!d || !RE) return null;
    text = rbSomeoneSaid(text, env, d);   // v3.11.19
    var s = env.session ? rbSession() : null;
    if(!rbEditable(d, env.mon)) return rbSay('cant', ["I can only change this week's and next week's roster."], 'rb week out');
    var plan = rbPlan(text, Object.assign({}, env, { d: d }));
    if(plan.issue) return rbIssue(plan, text, env, s, d, lead || []);
    var edits = plan.ops.length - plan.pre.length;
    if(!edits && !plan.did.length){
      if(plan.goto && s) return rbGoTo(s, d, plan.goto, lead);
      return null;
    }
    if(!edits) return s ? rbReask(s, (lead || []).concat([cap(plan.did.join('. ')) + '.']), 'rb nothing to do') : rbSay('answer', (lead || []).concat([cap(plan.did.join('. ')) + '.']), 'rb nothing to do');
    if(plan.days.length > 1){
      var rb = plan.removeAll && plan.removeAll.length === 1 && plan.did.length === 1
        ? 'That takes ' + rbWho(d, plan.removeAll[0].id) + ' off ' + daysSay(plan.removeAll[0].days) + '.'
        : 'That changes ' + daysSay(plan.days) + ': ' + plan.did.join('; ') + '.';
      return confirming('roster', [rb], 'Go ahead?', { plan: plan, env: env }, 'rb confirm ' + plan.ops.map(rbOpLog).join('; '));
    }
    return rbDo(plan, env, s, lead || []);
  }
  function rbIssue(plan, text, env, s, d, lead){
    // v3.10.1: the roster's question before this one, so "no" goes back to it (it asked "Add them?" again and again)
    var is = plan.issue, keep = { text: text, env: env, prev: s && s.asked && !/^rb(New|Pick)$/.test(s.asked.kind) ? s.asked : null };
    if(is.pick){
      var names = is.ids.map(function(id){ return rbStaffName(d, id); });
      var opts = is.ids.slice(0, 3).map(function(id, i){ return { label: names[i], value: id }; }).concat([{ label: 'Neither', value: 'none' }]);
      return rbAsk('rbPick', lead, is.ids.length === 1 ? 'Did you mean ' + names[0] + '?' : joinOr(names.slice(0, 3)) + '?', opts, Object.assign({ ids: is.ids, word: is.word }, keep), s, 'rb pick ' + is.word);
    }
    if(is.unknown){
      var nm = cap(is.unknown);
      if(is.noAdd) return rbReaskOrSay(s, lead.concat(["I don't have " + nm + ' on the staff list. Nothing changed.']), 'rb unknown ' + is.unknown);
      return rbAsk('rbNew', lead, "I don't have " + nm + ' on the staff list. Add them?', [{ label: 'Yes, add ' + nm, value: 'yes' }, { label: 'No', value: 'no' }],
        Object.assign({ name: nm }, keep), s, 'rb unknown ' + is.unknown);
    }
    if(is.who) return s ? rbReask(s, lead.concat(['Who do you mean?']), 'rb who') : rbSay('cant', lead.concat(['Who do you mean? Say their name.']), 'rb who');
    if(is.needDay){
      var cd = env && env.ctxDay;
      var opts2 = (cd ? [cd] : []).concat(RE.DAYS.filter(function(x){ return x !== cd; })).map(function(x){ return { label: DAY_FULL[x], value: x }; }).slice(0, 4);
      if(cd) return rbAsk('rbWhichDay', lead, 'On ' + rbDateSay(RE.dateOf(env.mon, cd)) + '?', opts2, keep, s, 'rb which day ' + cd + '?', { expect: 'choice' });
      return rbAsk('rbWhichDay', lead, 'Which day?', opts2, keep, s, 'rb which day', { expect: 'choice' });
    }
    if(is.ampm){
      var hs = is.h + (is.m ? ':' + pad2(is.m) : '');
      return rbAsk('rbAmPm', lead, hs + ' in the morning, or ' + hs + ' at night?', [{ label: 'Morning', value: 'am' }, { label: 'Night', value: 'pm' }], keep, s, 'rb am or pm');
    }
    if(is.needTime) return rbAsk('rbTime', lead, 'What time for ' + rbWho(d, is.needTime) + ' on ' + DAY_FULL[is.day] + '?', [], Object.assign({ id: is.needTime, day: is.day }, keep), s, 'rb need time', { expect: 'time' });
    if(is.closed) return rbSay('cant', lead.concat(["The kitchen's closed on " + DAY_FULL[is.closed] + 's, so the roster has no ' + DAY_FULL[is.closed] + '.']), 'rb closed day');
    if(is.lastWeek) return rbSay('cant', lead.concat(["I can't change last week's roster, only this week's and next week's."]), 'rb last week');
    if(is.notOnWeek) return rbSay('cant', lead.concat([cap(rbWho(d, is.notOnWeek)) + (is.notOnWeek === d.me ? " aren't" : " isn't") + ' on any day that week.']), 'rb not on week');
    if(is.neitherOn) return rbReaskOrSay(s, lead.concat(['Neither ' + rbWho(d, is.neitherOn[0]) + ' nor ' + rbWho(d, is.neitherOn[1]) + ' is on ' + DAY_FULL[is.day] + '. Nothing changed.']), 'rb neither on');
    if(is.emptyDay) return rbSay('cant', lead.concat(["Nobody's on " + DAY_FULL[is.emptyDay] + ' yet.']), 'rb empty day');
    return rbSay('cant', lead.concat(["I didn't catch that for the roster."]), 'rb issue');
  }
  /* v3.11.1 (his log, 13 Oct): "remove Sanjay as well" right after Saturday's
     roster or a change on Saturday went to the orders ("couldn't find sanjay"):
     a change needed a day said. The day the conversation is on (2 minutes)
     now counts, and is asked back first ("On Saturday the 17th?"): his choice
     of "check first" was left to Claude, and a wrong-day change is silent. */
  var rbLastEdit = null;
  function rbCtxDay(d){
    var c = [], r = roRecent();
    if(r && r.date) c.push({ seq: r.seq, date: r.date });
    if(rbLastEdit && now() - rbLastEdit.at <= RO_FOLLOW_MS) c.push(rbLastEdit);
    if(!c.length) return null;
    c.sort(function(a, b){ return b.seq - a.seq; });
    var mon = mondayOf(c[0].date);
    return rbEditable(d, mon) ? { mon: mon, day: dayOf(c[0].date) } : null;
  }
  /* saves it, then says what's stored */
  function rbDo(plan, env, s, lead){
    var d = rbData();
    if(!d || !rbEditable(d, plan.mon)) return rbSay('cant', ["I can only change this week's and next week's roster."], 'rb week out');
    var r = RE.commit(rbWeekOf(d, plan.mon), { op: 'batch', ops: plan.ops }, rbCtx(d), rbSaver(plan.mon));
    var log = 'rb ' + plan.mon + ' ' + plan.ops.map(rbOpLog).join('; ');
    if(!r.ok) return rbRefused(r, plan, s, lead, log);
    log += ' saved';
    var lab = 'Roster: ' + plan.did.join('; ');
    var aid = r.undo ? remember(lab, [{ k: 'ro', mon: plan.mon, rec: r.undo }]) : null;
    var extra = aid ? { action: { id: aid, label: lab, undo: true } } : {};
    var one = plan.days.length === 1 ? plan.days[0] : null;
    var focus = s ? s.focus : null;
    var line1 = (one && s && one === focus ? 'Done. ' : '') + cap(plan.did.join('. ')) + '.';
    var w = rbWarn(r.warnings, d, plan.mon);
    if(w) line1 += ' ' + w;
    var line2 = one ? (s ? DAY_FULL[one] : rbDateSay(RE.dateOf(plan.mon, one))) + ' is now ' + rbDaySay(d, r.week[one]) + '.' : '';
    if(!s){
      rbLastEdit = one ? { at: now(), seq: ++roSeq, date: RE.dateOf(plan.mon, one) } : null;
      if(one) extra.show = { title: 'Roster · ' + rbDateSay(RE.dateOf(plan.mon, one)), lines: RE.dayList(r.week, one).map(function(x){ return { text: cap(rbWho(d, x.id)) + ' · ' + rbTime(x.start) + (x.end ? ' – ' + rbTime(x.end) : ''), tone: 'ok' }; }) };
      return rbSay('done', lead.concat([line1, line2]), log, extra);
    }
    if(plan.last) s.last = plan.last;
    if(one && one !== focus){
      var back = focus && (s.days[focus] === 'pending' || s.days[focus] === 'skipped') ? focus : null;
      s.focus = one; s.back = back;
      if(back) return rbAsk('rbBack', lead.concat([line1, line2]), 'Back to ' + DAY_FULL[back] + '?', [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], { day: one, back: back }, s, log, { ans: extra });
    }
    var fd = one || s.focus;
    if(fd) return rbAsk('rbElse', lead.concat([line1, line2]), 'Anything else for ' + DAY_FULL[fd] + '?', [{ label: 'No, next day', value: 'no' }], { day: fd }, s, log, { ans: extra });
    return rbAsk('rbChanges', lead.concat([line1, line2]), 'Anything else?', [{ label: "No, that's it", value: 'no' }], {}, s, log, { ans: extra });
  }
  function rbRefused(r, plan, s, lead, log){
    var d = rbData() || { names: {}, staff: [] }, op = plan.ops[r.at] || {}, day = r.day || op.day;
    var n = r.id ? rbWho(d, r.id) : '', you = r.id === d.me, msg;
    if(r.error === 'notSaved'){
      var still = plan.days.length === 1 && rbEditable(d, plan.mon) ? ' ' + DAY_FULL[plan.days[0]] + ' is still ' + rbDaySay(d, rbWeekOf(d, plan.mon)[plan.days[0]]) + '.' : '';
      msg = "I couldn't save that, so nothing changed." + still;
    }
    else if(r.error === 'notOn') msg = cap(n) + (you ? " aren't" : " isn't") + ' on ' + (day ? DAY_FULL[day] : 'those days') + '. Nothing changed.';
    else if(r.error === 'alreadyOn') msg = cap(rbIs(n)) + ' already on ' + DAY_FULL[day] + ' at ' + rbTime(r.shift.start) + '. Nothing changed.';
    else if(r.error === 'sameStaff') msg = "That's the same person. Nothing changed.";
    else if(r.error === 'endBeforeStart') msg = 'That finish is before ' + n + (you ? ' start' : ' starts') + '. Nothing changed.';
    else if(r.error === 'outOfDay') msg = 'That would go past midnight. Nothing changed.';
    else if(r.error === 'empty') msg = "Nobody's on " + (r.days ? daysSay(r.days) : 'that day') + ' yet.';
    else if(r.error === 'noStaff') msg = "I don't have that person on the staff list. Nothing changed.";
    else msg = "I couldn't do that. Nothing changed.";
    log += (r.error === 'notSaved' ? ' NOT SAVED' : ' refused ' + r.error);
    return s ? rbReask(s, lead.concat([msg]), log) : rbSay(r.error === 'notSaved' ? 'error' : 'cant', lead.concat([msg]), log);
  }

  /* ---- the walk through the week ---- */
  function rbPresent(s, d, day, lead, extra){
    d = rbData() || d;   // as stored now
    var draft = rbWeekOf(d, s.week), ref = rbRefOf(d, s.week);
    var D = draft[day] || {}, R = ref ? ref.roster[day] || {} : null;
    var name = DAY_FULL[day], dl = RE.dayList({ x: D }, 'x'), rl = R ? RE.dayList({ x: R }, 'x') : [];
    var data = { day: day }, line, q, opts, kind = 'rbDay';
    s.focus = day; s.back = null;
    if(rl.length){
      if(!dl.length || RE.sameDay(D, R)){
        line = name + '. Last week: ' + rbDaySay(d, R, ref.names) + '.'; q = 'Same again?'; data.base = 'ref';
        opts = [{ label: 'Same again', value: 'same' }, { label: 'Changes', value: 'no' }, { label: 'Skip for now', value: 'skip' }];
      } else {
        line = name + '. Last week: ' + rbDaySay(d, R, ref.names) + ". It's set to " + rbDaySay(d, D) + '.'; q = 'Keep that, or same as last week?'; data.base = 'draft';
        opts = [{ label: 'Keep it', value: 'keep' }, { label: 'Same as last week', value: 'same' }, { label: 'Changes', value: 'no' }, { label: 'Skip for now', value: 'skip' }];
      }
    } else {
      line = name + '. ' + (ref ? 'Nobody was on last ' + name + '.' : "There's no roster saved for last " + name + '.');
      data.base = 'draft';
      if(dl.length){
        line += " It's set to " + rbDaySay(d, D) + '.'; q = 'Keep it?';
        opts = [{ label: 'Keep it', value: 'keep' }, { label: 'Changes', value: 'no' }, { label: 'Skip for now', value: 'skip' }];
      } else {
        q = "Who's on?"; kind = 'rbWho';
        opts = [{ label: 'Nobody, closed', value: 'none' }, { label: 'Skip for now', value: 'skip' }];
      }
    }
    return rbAsk(kind, (lead || []).concat([line]), q, opts, data, s, 'rb day ' + day, { expect: kind === 'rbWho' ? 'item' : 'choice', ans: extra });
  }
  function rbOnward(s, d, lead, extra){
    var nx = RE.nextDay(s, s.focus);
    if(nx) return rbPresent(s, d, nx, lead, extra);
    return rbWeekDone(s, d, lead, extra);
  }
  function rbGoTo(s, d, day, lead){
    d = rbData() || d;
    var back = s.focus && s.focus !== day && (s.days[s.focus] === 'pending' || s.days[s.focus] === 'skipped') ? s.focus : null;
    if(s.days[day] === 'done' || s.days[day] === 'closed'){
      s.focus = day; s.back = back;
      return rbAsk('rbElse', (lead || []).concat([DAY_FULL[day] + ' is ' + rbDaySay(d, rbWeekOf(d, s.week)[day]) + '.']), 'What should change?',
        [{ label: back ? 'Nothing, back to ' + DAY_FULL[back] : 'Nothing', value: 'no' }], { day: day }, s, 'rb go to ' + day);
    }
    var a = rbPresent(s, d, day, lead);
    s.back = back; rbKeep(s);
    return a;
  }
  /* the day's done: "Wednesday's set." and on to the next one */
  function rbDayDone(s, d, day, lead, extra){
    s.days[day] = 'done';
    var back = s.back;
    if(back && back !== day && (s.days[back] === 'pending' || s.days[back] === 'skipped')){ s.back = null; return rbPresent(s, d, back, (lead || []).concat([DAY_FULL[day] + "'s set."]), extra); }
    s.focus = day;
    return rbOnward(s, d, (lead || []).concat([DAY_FULL[day] + "'s set."]), extra);
  }
  /* "same": last week's day, copied in and saved, then the day's done */
  function rbSame(s, d, day, lead){
    var ref = rbRefOf(d, s.week), R = ref && ref.roster[day];
    if(!R || !RE.dayList({ x: R }, 'x').length) return rbReask(s, (lead || []).concat(['There was nobody on last ' + DAY_FULL[day] + ' to copy.']), 'rb same none');
    var week = rbWeekOf(d, s.week);
    if(RE.sameDay(week[day], R)) return rbDayDone(s, d, day, lead);
    var plan = { mon: s.week, ops: [{ op: 'copy', day: day, from: R }], days: [day], did: ['same as last ' + DAY_FULL[day]], pre: [] };
    var r = RE.commit(week, plan.ops[0], rbCtx(d), rbSaver(s.week));
    var log = 'rb ' + s.week + ' copy ' + day + ' from last week';
    if(!r.ok) return rbRefused(r, plan, s, lead || [], log);
    var lab = 'Roster: ' + DAY_FULL[day] + ' same as last week';
    var aid = r.undo ? remember(lab, [{ k: 'ro', mon: s.week, rec: r.undo }]) : null;
    var w = rbWarn(r.warnings, d, s.week);
    return rbDayDone(s, d, day, (lead || []).concat(w ? [w] : []), aid ? { action: { id: aid, label: lab, undo: true }, logPre: log + ' saved' } : { logPre: log + ' saved' });
  }
  function rbClosed(s, d, day, lead){
    d = rbData() || d;
    var week = rbWeekOf(d, s.week);
    if(RE.dayList(week, day).length){
      return confirming('roster', ['That clears ' + DAY_FULL[day] + ': ' + rbDaySay(d, week[day]) + '.'], 'Clear it and mark it closed?',
        { plan: { mon: s.week, ops: [{ op: 'clear', day: day }], days: [day], did: [DAY_FULL[day] + ' cleared'], pre: [], closed: day }, env: { mon: s.week, session: true } }, 'rb confirm clear ' + day);
    }
    s.days[day] = 'closed'; s.focus = day;
    return rbOnward(s, d, (lead || []).concat([DAY_FULL[day] + "'s closed, so nobody's on."]));
  }
  /* v3.11.19 (his log, 18 Oct): "leave that empty": nobody on that day (not closed),
     read back first when people are on it; then on, or back to the day being asked */
  function rbEmpty(s, d, day){
    d = rbData() || d;
    var week = rbWeekOf(d, s.week), back = s.focus && s.focus !== day ? s.focus : null;
    if(RE.dayList(week, day).length){
      return confirming('roster', ['That clears ' + DAY_FULL[day] + ': ' + rbDaySay(d, week[day]) + '.'], 'Clear it?',
        { plan: { mon: s.week, ops: [{ op: 'clear', day: day }], days: [day], did: [DAY_FULL[day] + ' cleared'], pre: [], emptied: day, back: back }, env: { mon: s.week, session: true } }, 'rb confirm clear ' + day);
    }
    return rbEmptied(s, d, day, back, DAY_FULL[day] + "'s empty: nobody's on.", null);
  }
  function rbEmptied(s, d, day, back, line, extra){
    s.days[day] = 'done';
    if(back && (s.days[back] === 'pending' || s.days[back] === 'skipped')) return rbReask(s, [line], 'rb emptied ' + day, extra ? { ans: extra } : null);
    s.focus = day;
    return rbOnward(s, d, [line], extra);
  }
  /* v3.11.19 (his log, 18 Oct: "can you remove the next roster entirely and will build it
     again"): the whole week, read back, a yes; then built again from the start */
  function rbClearWeek(c, d, sess){
    var mon = /\bthis weeks?\b/.test(c) ? d.week : /\bnext weeks?\b/.test(c) ? rbNextMon(d) : sess ? sess.week : RE.buildWeekFor(tsToday());
    if(!rbEditable(d, mon)) mon = rbNextMon(d);
    var week = rbWeekOf(d, mon), days = RE.DAYS.filter(function(x){ return RE.dayList(week, x).length; }), wk = rbWeekWord(d, mon);
    if(!days.length) return rbSay('answer', [wk + "'s roster is already empty."], 'rb clear week empty');
    return confirming('roster', ['That clears ' + wk.toLowerCase() + "'s roster: everyone off " + daysSay(days) + '.'], 'Clear it?',
      { plan: { mon: mon, ops: days.map(function(x){ return { op: 'clear', day: x }; }), days: days, did: [wk + "'s roster cleared"], pre: [], clearWeek: true }, env: { mon: mon, session: true } }, 'rb confirm clear week');
  }
  /* v3.11.19 (his log, 18 Oct: "replace someone with Morgan", "add Morgan instead of
     someone"): "someone" is the one person on last week's day who has left the staff
     (the read-out calls them that); their place is taken at their start time */
  function rbSomeoneSaid(text, env, d){
    var c = rbClean(text);
    if(!/\bsomeone\b/.test(c) || !env || !d) return text;
    var day = rbDayIn(c) || (env.fix && env.fix.day) || env.day;
    var ref = day ? rbRefOf(d, env.mon) : null, R = ref && ref.roster[day];
    if(!R) return text;
    var known = {};
    (d.staff || []).forEach(function(x){ known[x.id] = 1; });
    var gone = Object.keys(R).filter(function(id){ return R[id] && R[id].start && !known[id]; });
    if(gone.length !== 1) return text;
    var t = R[gone[0]].start, hh = +t.slice(0, 2), mm = t.slice(3, 5);
    var at = (hh % 12 || 12) + (mm && mm !== '00' ? ':' + mm : '') + (hh < 12 ? ' am' : ' pm');
    var out = c.replace(/\b(?:replace|swap|sub|switch|substitute|change) someone (?:with|for|to) ([a-z]+)\b/, 'add $1 at ' + at)
      .replace(/\b(?:add|put|get|have|bring) ([a-z]+) (?:on )?(?:instead of|in for|in place of|for) someone\b/, 'add $1 at ' + at)
      .replace(/^([a-z]+) (?:in for|instead of|in place of) someone\b/, 'add $1 at ' + at);
    return out === c ? text : out;
  }
  function rbVerify(d0, mon){
    var d = rbData();   // read now: a copy from before the last change would write it away
    if(!d || !rbEditable(d, mon)) return false;
    var week = rbWeekOf(d, mon), put = {}, back = null;
    RE.DAYS.forEach(function(x){ put[x] = week[x]; });
    try{ back = host.setRosterDays ? host.setRosterDays(mon, put) : null; }catch(e){ back = null; }
    return !!(back && back.ok && back.days) && RE.DAYS.every(function(x){ return RE.sameDay(back.days[x], week[x], true); });
  }
  var RB_SAVE_FAILED = "I couldn't save it: the phone wouldn't store the roster. The changes I confirmed earlier were saved at the time. Try 'save it' again in a moment.";
  function rbWeekDone(s, d, lead, extra){
    if(!rbVerify(d, s.week)){ rbKeep(s); return rbSay('error', (lead || []).concat([RB_SAVE_FAILED]), 'rb verify NOT SAVED', extra); }
    s.focus = null;
    return rbAsk('rbEnd', (lead || []).concat(["That's the week, sir. It's all saved."]), 'Want me to read it out, or show it on screen?',
      [{ label: 'Read it out', value: 'read' }, { label: 'Show it', value: 'show' }, { label: 'No thanks', value: 'no' }], {}, s, 'rb week done', { ans: extra });
  }
  function rbWeekRead(s, d, lead, log){
    d = rbData() || d;
    var week = rbWeekOf(d, s.week), title = rbWeekWord(d, s.week) + "'s roster";
    return rbSay('answer', (lead || []).concat([RE.DAYS.map(function(x){ return DAY_FULL[x] + ': ' + rbDaySay(d, week[x]) + '.'; }).join(' ')]), log || 'rb read week',
      { show: { title: title, lines: RE.DAYS.map(function(x){ return { text: DAY_FULL[x].slice(0, 3) + ' · ' + rbDaySay(d, week[x]), tone: 'ok' }; }) } });
  }
  function rbOpen(s, d){ if(host.open) host.open({ view: 'rosterBuild', week: s.week === d.week ? 'this' : 'next' }); }
  function rbFinish(s){ s.finished = true; s.asked = null; rbKeep(s); }
  /* "that's it, save it": checked in storage before it's called saved */
  function rbSaveIt(s, d){
    if(!rbVerify(d, s.week)){ rbKeep(s); return rbSay('error', [RB_SAVE_FAILED], 'rb save NOT SAVED'); }
    var left = RE.DAYS.filter(function(x){ return s.days[x] === 'pending' || s.days[x] === 'skipped'; });
    rbFinish(s);
    return rbSay('done', ['Saved, sir. ' + rbWeekWord(d, s.week) + "'s roster is on the phone.",
      left.length ? "We didn't go through " + daysSay(left) + ': ' + (left.length === 1 ? "it's" : "they're") + ' as ' + (left.length === 1 ? 'it was' : 'they were') + '.' : '',
      'To send it to the staff, tap Publish on Build Roster.'], 'rb saved');
  }
  function rbStart(text, d){
    var c = rbClean(text);
    var mon = /\bthis weeks?\b/.test(c) ? d.week : RE.buildWeekFor(tsToday());
    if(!rbEditable(d, mon)) mon = rbNextMon(d);
    var range = rbDateSay(addDays(mon, 2)) + ' to ' + rbDateSay(addDays(mon, 6));
    var s = rbSession();
    if(s && s.week === mon && !s.finished && RE.DAYS.some(function(x){ return s.days[x] !== 'pending'; })){
      if(rbDayIn(c)){ s.paused = false; return rbGoTo(s, d, rbDayIn(c), []); }   // v3.11.19: "… for Thursday"
      var at = RE.firstUnfinished(s), done = RE.DAYS.filter(function(x){ return s.days[x] === 'done'; });
      if(!at) return rbWeekDone(s, d, ["You've done every day of " + range + '.']);
      return rbAsk('rbResume', [], "You've started " + range + (done.length ? ', with ' + daysSay(done) + ' done' : '') + '. Carry on from ' + DAY_FULL[at] + ', or start again?',
        [{ label: 'Carry on', value: 'carry' }, { label: 'Start again', value: 'again' }], {}, s, 'rb resume ' + mon);
    }
    s = RE.newSession(mon, 'day', now());
    if(!rbRefOf(d, mon)) return rbPresent(s, d, 'wed', ['Sure, sir. ' + range + ". I don't have last week's roster, so let's go day by day."]);
    // v3.11.19 (his log, 18 Oct: "let's make next week's roster for Thursday"): a day said goes straight to it
    var dayAsk = rbDayIn(c);
    if(dayAsk) return rbPresent(s, d, dayAsk, ['Sure, sir. ' + range + '.']);
    // v3.11.19 (his log: "stop saying that on every command"): the dates once; asked again, the short question (RB_MODE_SHORT)
    return rbAsk('rbMode', ['Sure, sir. ' + range + '.'], 'Day by day, or copy last week and just tell me the changes?',
      [{ label: 'Day by day', value: 'day' }, { label: 'Copy last week', value: 'copy' }], { short: RB_MODE_SHORT }, s, 'rb start ' + mon);
  }
  function rbContinue(text, d){
    var s = rbSession();
    if(!s || s.finished || !rbEditable(d, s.week)) return rbStart(text, d);
    s.paused = false;
    var at = RE.firstUnfinished(s);
    if(!at) return rbWeekDone(s, d, []);
    return rbPresent(s, d, at, ['Carrying on.']);
  }
  /* copy and change: every day that had people last week becomes last
     week's (asked first: it touches several days), then just the changes */
  function rbCopyMode(s, d){
    s.mode = 'copy';
    var draft = rbWeekOf(d, s.week), ref = rbRefOf(d, s.week), ops = [], differ = [];
    RE.DAYS.forEach(function(x){
      var R = ref.roster[x] || {};
      if(RE.dayList({ x: R }, 'x').length && !RE.sameDay(draft[x], R)){ differ.push(x); ops.push({ op: 'copy', day: x, from: R }); }
    });
    if(!ops.length){ rbKeep(s); return rbCopied(s, d, [rbWeekWord(d, s.week) + ' already matches last week.']); }
    rbKeep(s);
    return confirming('roster', ['That sets ' + daysSay(differ) + " to last week's roster."], 'Go ahead?',
      { plan: { mon: s.week, ops: ops, days: differ, did: ['copied last week'], pre: [], copyAll: true }, env: { mon: s.week, session: true } }, 'rb confirm copy week');
  }
  function rbCopied(s, d, lead, extra){
    var ref = rbRefOf(d, s.week), week = rbWeekOf(d, s.week), open = [];
    s.focus = null; s.back = null;
    RE.DAYS.forEach(function(x){
      var had = ref && RE.dayList({ x: ref.roster[x] || {} }, 'x').length;
      if(had || RE.dayList(week, x).length) s.days[x] = 'done'; else open.push(x);
    });
    var note = open.length ? daysSay(open) + (open.length === 1 ? ' had' : ' had') + ' nobody last week, so ' + (open.length === 1 ? "it's" : "they're") + ' empty.' : '';
    return rbAsk('rbChanges', lead.concat([note]), "What's different?", [{ label: "Nothing, that's it", value: 'no' }], {}, s, 'rb copied', { expect: 'any', ans: extra });
  }
  /* "Who worked last Friday?" in a session: last week is the one before
     the week being built. Read only; then the question again. */
  function rbRead(text, s, d){
    var c = rbClean(text);
    if(/\b(read (it|me|the week|the roster|back|it out|it back)|whats the (week|roster) (look like|now)|how does (it|the week) look)\b/.test(c) && !/\blast\b/.test(c)) return rbWeekRead(s, d, [], 'rb read week');
    var a = rosterAnswer(text, false, { build: s.week, ref: addDays(s.week, -7) });
    if(a.status !== 'answer') return a;
    return rbReask(s, a.say, a.log + ' (in a roster session)', a.show ? { ans: { show: a.show } } : null);
  }
  function rbIsStart(c){
    if(/^(whats|what|how|hows|who|whos|when|is|are|was|were|did|do i|do we|does|am i|have i|any|which|show|tell|read|check)\b/.test(c)) return false;
    return /\b(do|build|make|create|start|set up|plan|sort out|work on|write|new|draft|prepare|organise|organize|begin|lets do)( (a|an|the|my|our|this|next|new|weeks|next weeks|this weeks|a new|the new|up))* rosters?\b/.test(c)
      && !/\b(add|put|swap|remove|take|change|move)\b/.test(c);
  }
  function rbIsContinue(c){ return /\b(continue|resume|carry on|keep going|get back to|go back to|back to|pick up|finish off|finish)\b.*\brosters?\b/.test(c) && !/\blater\b/.test(c); }
  function rbIsPause(c){
    return (/\b(pause|finish (it |this |the roster )?later|do (the rest|it|this) later|stop (here|there|for now|the roster)|lets stop|thats enough for now|ill come back( to it)?|come back to (it|the roster) later)\b/.test(c) || /^(later|maybe later|later on)$/.test(c))
      && !RB_SKIP.test(c.replace(/\blater\b/, '')) && !rbDayIn(c) && !rbRel(c);   // "an hour later" is a change
  }
  function rbIsSave(c){ return /\b(save (it|the roster|that|this)|thats it save|finish (it|the roster) (now|off)|thats the roster done|lock it in|thats it for the roster)\b/.test(c); }
  function rbIsPublish(c){ return /\b(publish|send (it|the roster|it out|it to the staff|it to everyone)|share (it|the roster)|show (it|me it|me the roster|the roster|me the week|the week)( on (the )?screen)?|open (it|the roster|build roster))\b/.test(c) && !/\b(prep|order|orders|list|timesheet)\b/.test(c); }
  function rbDayIn(c){ return c.split(' ').map(rbDayOf).filter(function(x){ return x && RE.DAYS.indexOf(x) > -1; })[0] || null; }
  /* Everything the roster might be said to: a session's own words first,
     then a change, else null (not the roster's: orders carry on as before).
     p is the roster question just asked (from memory, or from the session
     when the card has closed since). */
  async function rbRoute(req, mode, p, otherBefore){
    if(!RE || !host.setRosterDays) return null;   // a page without it can only read the roster
    var text = String(req.text || ''), c = rbClean(text), choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null;
    if(!c && choice == null) return null;
    var d = rbData();
    if(!d) return null;
    if(RB_UNDO.test(c)) return null;   // undo is the last change, roster or not
    if(c && rbIsStart(c)) return rbStart(text, d);
    if(c && rbIsContinue(c)) return rbContinue(text, d);
    var s = rbSession(), sess = s && !s.finished && rbEditable(d, s.week) ? s : null;
    var live = !!(sess && (p || rbLive(sess, d)));
    var asked = p || (live && !otherBefore && sess.asked) || null;
    // v3.11.19 (his log, 18 Oct): the whole week, read back first; never a day or a person
    if(c && choice == null && RB_CLEAR_WEEK.test(c) && /\brosters?\b/.test(c) && !rbDayIn(c) && !rbAboutRosterName(c, d) && !/\b(lists?|prep|orders?|timesheets?)\b/.test(c)) return rbClearWeek(c, d, sess);
    // v3.11.19 (his log, 18 Oct: "let's build Friday's roster" in the middle of it): that day next
    var goDay = live && c && choice == null ? RB_GO_DAY.exec(c) : null;
    if(goDay && rbDayOf(goDay[1].replace(/s$/, '')) && RE.DAYS.indexOf(rbDayOf(goDay[1].replace(/s$/, ''))) > -1) return rbGoTo(sess, d, rbDayOf(goDay[1].replace(/s$/, '')), []);
    /* talk, not a command (his note to Claude, 11 Oct, was 40 words): in the
       middle of the roster it's ignored, as orders ignore chatter, and the
       roster's question stays open */
    var nw = c ? c.split(' ').length : 0;
    /* v3.10.1 (his log, 12 Oct: "can you read the prep list back to me", "add
       roasted red peppers to the prep list" were ignored as chatter): a
       sentence shaped like a command or a question is never chatter */
    var shaped = /^(so |and |ok |okay |now |also |then |um |uh )*(can you |could you |would you |will you |please |can i |i want to |i need to |lets )*(add|put|take|remove|drop|make|change|read|tell|show|give|whats|what|who|whos|when|how|which|is|are|order|get|cancel|undo|tick|swap|set|move|copy|clear|check)\b/.test(c)
      || /\b(prep list|the list|on the order|to the order|orders?)\b/.test(c);
    if((live || p) && choice == null && (nw > 16 || (nw >= 8 && !shaped && req.followUp && !rbAboutRoster(c, d)))){
      if(p) pending = p;
      rbOther = false;
      return notmine('chatter');
    }
    /* v3.10.1 (replaying his log): no longer ignored as chatter, "can you tell
       me what's on my prep list" and "read the prep list back to me" were
       taken as the roster ("me", "read"). About the prep list or the orders,
       and naming nobody on the staff for sure, it's theirs. */
    if((live || p) && choice == null && c && /\b(lists?|prep|orders?)\b/.test(c) && !rbAboutRoster(c, d)) return null;
    if(live){
      if(choice == null && !(asked && asked.kind === 'rbEnd')){
        if(rbIsSave(c)) return rbSaveIt(sess, d);
        if(rbIsPause(c)){ sess.paused = true; sess.asked = null; rbKeep(sess); return rbSay('answer', ["No worries. Everything so far is saved. Say 'let's continue the roster' when you're ready."], 'rb paused'); }
        if(rbIsPublish(c)){ rbOpen(sess, d); return rbSay('answer', ["It's on screen. Tap Publish when you're ready to send it to the staff."], 'rb show'); }
        /* v3.10.1 (his log, 12 Oct): "can you tell me Wednesday's roster" was
           read as "put me on Wednesday"; a polite start is still a question */
        var cq = c.replace(/^((so|and|ok|okay|now|um|uh) )*((can|could|would|will) you |please )*/, '');
        if(/^(who|whos|what|whats|how|when|is|was|did|does|do|are|were|which|tell me|read|give me)\b/.test(cq) && (rosterIntent(cq, roNames(d)) || /\bread\b/.test(cq))) return rbRead(text, sess, d);
        // v3.11.19 (his log, 18 Oct: "check Saturday's roster", twice, was not understood)
        if(/^(check|look at|go over|show me)\b/.test(cq) && rbDayIn(cq) && /\b(rosters?|shifts?|whos on|who is on|working)\b/.test(cq)) return rbRead(cq.replace(/^(check|look at|go over|show me)\b/, 'who is on'), sess, d);
        // v3.10.1 (owner): "more details" / "which section?" says the day being built, with stations
        if(RO_DETAIL.test(cq) && !rbDayIn(cq) && sess.focus){
          var fd = rbWeekOf(d, sess.week)[sess.focus] || {};
          var fdEmpty = !Object.keys(fd).some(function(id){ return fd[id] && fd[id].start; });   // still empty: what was read out was last week's
          return rbRead((fdEmpty ? 'last ' : '') + DAY_FULL[sess.focus] + ' roster in detail', sess, d);
        }
      }
      /* v3.11.19 (his log, 18 Oct: "how many hours am I doing that week" right after the
         week was done was counted on this week): a roster question then is about the week built */
      if(choice == null && asked && asked.kind === 'rbEnd' && c && !/\b(read|show|screen|open|publish)\b/.test(c)){
        var cq2 = c.replace(/^((so|and|ok|okay|now|um|uh) )*((can|could|would|will) you |please )*/, '');
        if(/^(who|whos|what|whats|how|when|is|was|did|does|do|are|were|which|tell me|give me|check)\b/.test(cq2) && (rosterIntent(cq2, roNames(d)) || /\bhours?\b/.test(cq2))) return rbRead(text, sess, d);
      }
    }
    if(asked){ var a = await rbAnswer(asked, req, sess, d); if(a) return a; }
    if(live){
      if(c){
        var dIn = rbDayIn(c);
        var order = rbOrderSaid(text, d);
        var e = order ? null : rbEdit(text, { mon: sess.week, day: dIn && dIn !== sess.focus ? null : sess.focus, base: 'draft', session: true, last: sess.last || null });
        if(e) return e;
        if(!order && rbAboutRoster(c, d)) return rbReask(sess, ["Sorry, I didn't catch that for the roster."], 'rb not understood (session)');
      }
      if(p) return null;
    }
    // outside a session: a change that clearly names someone
    if(!c || choice != null) return null;
    var find = rbFinder(d), sure = false, any = false;
    c.split(' ').forEach(function(w){ var m = find(w); if(m){ any = true; if(m.sure && !RB_WORDS[w]) sure = true; } });
    var me = /\b(me|myself)\b|^(i|im) (on|in|off|start|starting|finish|finishing|working)\b/.test(c);
    var marker = !!(rbDayIn(c) || /\b(today|tonight|tomorrow)\b/.test(c) || parseClock(c) || rbRel(c) || /\brosters?\b|\brostered\b|\bshifts?\b/.test(c));
    var verb = RO_WRITE.test(c) || /\b(swap|replace|instead of|in for|off|starts|finishes)\b/.test(c);
    if(/^(whats|what|how|hows|who|whos|when|is|are|was|were|did|do i|have i|any|which|show|tell|read|check)\b/.test(c)) return null;
    /* v3.11.1: no day said ("remove Sanjay as well", "remove Sanjay for now"), a
       clear change to someone on the staff takes the day the conversation is on,
       asked back first. Only a sure name and a change word ("cuts me off" isn't one). */
    var noDay = !rbDayIn(c) && !/\b(today|tonight|tomorrow)\b|\b(this|next|last) weeks?\b/.test(c) && !rbRel(c);
    var ctxDay = noDay && sure && RO_WRITE.test(c) ? rbCtxDay(d) : null;
    if(!(((sure || me) && marker && verb) || ((sure || me || any) && /\brosters?\b/.test(c) && verb) || (/\brosters?\b/.test(c) && RO_WRITE.test(c)) || ctxDay)) return null;
    // an order sentence that happens to sound like a name stays an order
    var cat = catalogue(host.data(), taught());
    if(!sure && !me && parse(text, cat).items.some(function(it){ return it.exact && it.exact.length; })) return null;
    if(ctxDay && !/\brosters?\b/.test(c)){
      var ec = rbEdit(text, { mon: ctxDay.mon, day: null, base: 'draft', session: false, last: null, fix: {}, ctxDay: ctxDay.day });
      return ec || rbSay('cant', ["I didn't catch that for the roster. Try 'put Anil on Thursday at 4', or 'let's do next week's roster'."], 'rb not understood');
    }
    var when = rbWhen(c, d);
    if(when && when.todayOrNext){
      return rbAsk('rbToday', [], 'Today, or next ' + DAY_FULL[when.day] + '?', [{ label: 'Today', value: 'today' }, { label: 'Next ' + DAY_FULL[when.day], value: 'next' }],
        { text: text, env: { mon: when.mon, day: null, base: 'draft', session: false, last: null, fix: { day: when.day } }, next: when.next }, null, 'rb today or next');
    }
    var e2 = rbEdit(text, { mon: when ? when.mon : rbNextMon(d), day: null, base: 'draft', session: false, last: null, fix: when ? { day: when.day } : {} });
    return e2 || rbSay('cant', ["I didn't catch that for the roster. Try 'put Anil on Thursday at 4', or 'let's do next week's roster'."], 'rb not understood');
  }
  /* his answer to a roster question; null when it isn't one */
  async function rbAnswer(p, req, s, d){
    var text = String(req.text || ''), choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null, c = rbClean(text);
    pending = null;
    var n = c.split(' ').length;
    var yes = choice === 'yes' || (choice == null && (yesNo(text) === 'yes' || (RB_YES.test(c) && n <= 4 && !RB_SAME.test(c) && !RB_NO.test(c))));
    var no = choice === 'no' || (choice == null && (yesNo(text) === 'no' || (RB_NO.test(c) && n <= 4)));
    var reEnv = function(extraFix){ var e = Object.assign({}, p.env); e.fix = Object.assign({}, e.fix || {}, extraFix); return e; };
    var day = p.day;
    if(p.kind === 'rbMode'){
      var m = choice || (/\bcopy\b|\bchanges\b|\bjust the changes\b/.test(c) ? 'copy' : /\bday by day\b|\bday\b|\bone at a time\b|\beach day\b/.test(c) ? 'day' : null);
      if(m === 'copy') return rbCopyMode(s, d);
      if(m === 'day') return rbPresent(s, d, RE.firstUnfinished(s) || 'wed', []);
      return null;
    }
    if(p.kind === 'rbResume'){
      var rm = choice || (/\b(start again|start over|from scratch|restart|again)\b/.test(c) ? 'again' : /\b(carry on|continue|keep going|yes|yeah|yep)\b/.test(c) ? 'carry' : null);
      if(rm === 'carry') return rbPresent(s, d, RE.firstUnfinished(s) || 'wed', ['Carrying on.']);
      if(rm === 'again'){
        var s2 = RE.newSession(s.week, 'day', now());
        if(!rbRefOf(d, s.week)) return rbPresent(s2, d, 'wed', ["Starting again from Wednesday. The roster keeps what's on it."]);
        return rbAsk('rbMode', ["Starting again. The roster keeps what's on it."], 'Day by day, or copy last week and just tell me the changes?',
          [{ label: 'Day by day', value: 'day' }, { label: 'Copy last week', value: 'copy' }], { short: RB_MODE_SHORT }, s2, 'rb start again');
      }
      return null;
    }
    if(p.kind === 'rbEnd'){
      var em = choice || (/\bread\b|\bsay it\b|\btell me\b/.test(c) ? 'read' : /\bshow\b|\bscreen\b|\bopen\b/.test(c) ? 'show' : no || RB_NEXT.test(c) ? 'no' : null);
      if(em === 'read'){ rbFinish(s); var rd = rbWeekRead(s, d, [], 'rb read week'); rd.say.push('To send it to the staff, tap Publish on Build Roster.'); return rd; }
      if(em === 'show'){ rbFinish(s); rbOpen(s, d); return rbSay('answer', ["It's on screen. Tap Publish when you're ready to send it to the staff."], 'rb show'); }
      if(em === 'no'){ rbFinish(s); return rbSay('answer', ["No worries. It's saved. Tap Publish on Build Roster when you want to send it."], 'rb end'); }
      // v3.11.19 (his log, 18 Oct: "can we change next week's roster" was asked "read it out, or show it?" three times)
      if(choice == null && /\b(change|changes|fix|edit|redo|tweak|alter|swap)\b/.test(c) && !rbAboutRosterName(c, d)){
        s.focus = null;
        return rbAsk('rbChanges', [], 'Sure. What should change?', [{ label: "Nothing, that's it", value: 'no' }], {}, s, 'rb end change', { expect: 'any' });
      }
      return null;
    }
    if(p.kind === 'rbPick'){
      var pick = choice;
      if(!pick && c){
        var full = p.ids.filter(function(id){ return (' ' + c + ' ').indexOf(' ' + clean(rbStaffName(d, id)) + ' ') > -1; });
        if(full.length === 1) pick = full[0];
      }
      if(!pick && c){
        var idx = rbIndex(d.staff.filter(function(x){ return p.ids.indexOf(x.id) > -1; }), d.me);
        var hit = c.split(' ').map(function(w){ return rbMatch(w, idx, {}); }).filter(function(x){ return x && x.sure && x.ids.length === 1; })[0];
        if(hit) pick = hit.ids[0];
        else if(p.ids.length === 1 && yes) pick = p.ids[0];
        else if(/^(the )?first( one)?$/.test(c)) pick = p.ids[0];
        else if(/^(the )?second( one)?$/.test(c)) pick = p.ids[1];
        else if(no || /^(neither|none|nobody)\b/.test(c)) pick = 'none';
      }
      if(!pick) return null;
      if(pick === 'none'){ rbBack(s, p); return rbReaskOrSay(s, ['Left it. Nothing changed. Say the name again.'], 'rb pick none'); }
      if(!rbIndex(d.staff, d.me).some(function(x){ return x.keys.indexOf(p.word) > -1; })) rbLearn(p.word, pick);   // a misheard name, learned
      var ids = {}; ids[p.word] = pick;
      return rbEdit(p.text, reEnv({ ids: ids }));
    }
    if(p.kind === 'rbNew'){
      if(!yes && !no && !/\b(add (them|him|her)|yes add)\b/.test(c)) return null;
      if(no){ rbBack(s, p); return rbReaskOrSay(s, ['Left it. Nothing changed.'], 'rb new staff no'); }
      var added = null;
      try{ added = host.addStaff ? host.addStaff(p.name) : null; }catch(e){ added = null; }
      if(!added || !added.ok) return rbReaskOrSay(s, ["I couldn't add " + p.name + ' to the staff list. Nothing changed.'], 'rb new staff failed');
      return rbEdit(p.text, reEnv({}), ['Added ' + p.name + ' to the staff list.']) || rbSay('answer', ['Added ' + p.name + ' to the staff list.'], 'rb new staff');
    }
    if(p.kind === 'rbAmPm'){
      var ap = choice || (/\b(morning|am|a m|breakfast|day)\b/.test(c) ? 'am' : /\b(night|evening|pm|p m|afternoon|tonight)\b/.test(c) ? 'pm' : null);
      if(!ap) return null;
      return rbEdit(p.text, reEnv({ ampm: ap }));
    }
    if(p.kind === 'rbTime'){
      var pc = parseClock(c);
      if(!pc || pc.now) return null;
      var st = rbStartOf(pc, { owner: p.id === d.me, day: p.day }, RE);
      var t = st && st.time ? st.time : null;
      if(!t){ return rbAsk('rbAmPm', [], pc.h + (pc.m ? ':' + pad2(pc.m) : '') + ' in the morning, or at night?', [{ label: 'Morning', value: 'am' }, { label: 'Night', value: 'pm' }],
        { text: p.text + ' at ' + pc.h + (pc.m ? ':' + pad2(pc.m) : ''), env: p.env }, s, 'rb am or pm'); }
      var times = {}; times[p.id + '@' + p.day] = t;
      return rbEdit(p.text, reEnv({ times: times }));
    }
    if(p.kind === 'rbToday'){
      var tn = choice || (/\b(today|tonight|this one)\b/.test(c) ? 'today' : /\bnext\b/.test(c) ? 'next' : null);
      if(!tn) return null;
      var e3 = Object.assign({}, p.env);
      if(tn === 'next') e3.mon = p.next;
      return rbEdit(p.text, e3);
    }
    if(p.kind === 'rbWhichDay'){
      var cd = p.env && p.env.ctxDay, wd = choice || rbDayIn(c), byCtx = !!cd && wd === cd;
      if(!wd && cd && choice == null && (yesNo(text) === 'yes' || (RB_YES.test(c) && n <= 4))){ wd = cd; byCtx = true; }
      if(!wd && cd && choice == null && (yesNo(text) === 'no' || (RB_NO.test(c) && n <= 3))){
        var e0 = Object.assign({}, p.env, { ctxDay: null });
        return rbAsk('rbWhichDay', [], 'Which day, then?', RE.DAYS.map(function(x){ return { label: DAY_FULL[x], value: x }; }).slice(0, 4),
          { text: p.text, env: e0, prev: p.prev || null }, s, 'rb which day', { expect: 'choice' });
      }
      /* v3.11.1 (his log, 13 Oct: "all four days", then "on Wednesday Thursday Friday
         Saturday Sunday"): several days answer it too, as one change over those days,
         which is read back before anything is done. "All" means that person's days. */
      var several = uniq(c.split(' ').map(rbDayOf).filter(Boolean));
      if(choice == null && (several.length > 1 || /\b(all|every|each|both)\b/.test(c))){
        var mon0 = p.env.mon;
        if(several.length < 2){
          var pid = roPersonIn(p.text, d), wkm = (rbCtxDay(d) || {}).mon || d.week, wkr = rbWeekOf(d, wkm);
          several = pid ? RE.DAYS.filter(function(x){ return wkr[x] && wkr[x][pid] && wkr[x][pid].start; }) : [];
          mon0 = wkm;
          if(several.length < 2) return rbAsk('rbWhichDay', [], 'Which days? Say them, like Wednesday and Friday.', RE.DAYS.map(function(x){ return { label: DAY_FULL[x], value: x }; }).slice(0, 4),
            { text: p.text, env: Object.assign({}, p.env, { ctxDay: null }), prev: p.prev || null }, s, 'rb which days', { expect: 'choice' });
        } else if(!p.env.session){ var w3 = rbWhen(DAY_FULL[several[0]].toLowerCase(), d); if(w3) mon0 = w3.mon; }
        return rbEdit(p.text + ' on ' + joinAnd(several.map(function(x){ return DAY_FULL[x]; })), Object.assign({}, p.env, { ctxDay: null, mon: mon0 }));
      }
      if(!wd) return null;
      var e2 = Object.assign({}, p.env, { ctxDay: null });
      if(!e2.session && !byCtx){ var w2 = rbWhen(DAY_FULL[wd].toLowerCase(), d); if(w2) e2.mon = w2.mon; }
      e2.fix = Object.assign({}, e2.fix || {}, { day: wd });
      return rbEdit(p.text, e2);
    }
    // the walk through the week: rbDay, rbWho, rbElse, rbBack, rbChanges
    if(!s) return null;
    if(choice == null && rbOrderSaid(text, d)) return null;
    var dIn = rbDayIn(c);
    var same = choice === 'same' || (choice == null && RB_SAME.test(c));
    var keep = choice === 'keep' || (choice == null && RB_KEEP.test(c));
    var skip = choice === 'skip' || (choice == null && RB_SKIP.test(c));
    var fday = day || s.focus;
    var plainEnv = function(base){ return { mon: s.week, day: dIn && dIn !== fday ? null : fday, base: base, session: true, last: s.last || null }; };
    if(skip && !/\b(put|add|swap|take|remove)\b/.test(c)){
      var sd = dIn || day || s.focus;
      if(!sd) return null;
      s.days[sd] = 'skipped';
      var lead = [DAY_FULL[sd] + "'s skipped for now. We'll come back to it."];
      if(sd !== s.focus && s.focus) return rbReask(s, lead, 'rb skip ' + sd);
      s.focus = sd;
      return rbOnward(s, d, lead);
    }
    // v3.11.19 (his log, 18 Oct: "no one working", "leave that empty", "clear Wednesday"): nobody on that day
    if(choice == null && p.kind !== 'rbWho' && (p.kind === 'rbDay' || p.kind === 'rbChange' ? RB_EMPTY : RB_EMPTY_STRONG).test(c) && (dIn || day || s.focus)) return rbEmpty(s, d, dIn || day || s.focus);
    if(p.kind === 'rbDay' || p.kind === 'rbChange'){
      // "same as Wednesday": that day of this week
      var fromDay = /\bsame as\b/.test(c) && dIn && dIn !== day ? dIn : null;
      if(fromDay && !/\blast\b/.test(c)){
        var wk = rbWeekOf(d, s.week);
        return rbDoCopy(s, d, day, wk[fromDay], 'same as ' + DAY_FULL[fromDay]);
      }
      var base = same && rbRefOf(d, s.week) ? 'ref' : (p.base || 'draft');
      var ed = c && !(same && n <= 5 && !/\b(but|except|and)\b/.test(c)) ? rbEdit(text, plainEnv(base)) : null;
      if(ed) return ed;
      if(same || (yes && p.base === 'ref')) return rbSame(s, d, day);
      if(keep || yes) return rbDayDone(s, d, day);
      // v3.11.19 (his log, 18 Oct): "change" (one) to "Keep that, or same as last week?" was not understood
      if(no || /^(changes|some changes|a few changes|not quite)\b/.test(c) || RB_CHANGE.test(c)){
        if(p.kind === 'rbChange') return rbDayDone(s, d, day);
        return rbAsk('rbChange', [], "What's different on " + DAY_FULL[day] + '?', [{ label: 'Nothing', value: 'keep' }], { day: day, base: p.base }, s, 'rb what changes', { expect: 'any' });
      }
      if(p.kind === 'rbChange' && /^(nothing|never mind|no changes|all good)\b/.test(c)) return p.base === 'ref' ? rbSame(s, d, day) : rbDayDone(s, d, day);
      return null;
    }
    if(p.kind === 'rbWho'){
      if(choice === 'none' || (choice == null && RB_CLOSED.test(c) && !/\b(put|add)\b/.test(c)) || no) return rbClosed(s, d, day);
      return c ? rbEdit(text, Object.assign(plainEnv('draft'), { addBare: true })) : null;
    }
    if(p.kind === 'rbElse' || p.kind === 'rbChanges'){
      /* v3.11.19 (his log, 18 Oct: "that's good", "Thursday's good next Friday" to "Anything
         else for Thursday?"): the day's fine as it is; a later day said goes there next */
      var good = choice == null && (RB_KEEP.test(c) || RB_GOOD_DAY.test(c)) && !rbAboutRoster(c, d);
      if(good || ((no || (choice == null && RB_NEXT.test(c))) && p.kind === 'rbElse')){
        var said = c.split(' ').map(rbDayOf).filter(function(x){ return x && RE.DAYS.indexOf(x) > -1 && x !== day; });
        if(said.length && day && p.kind === 'rbElse'){ s.days[day] = 'done'; return rbGoTo(s, d, said[said.length - 1], [DAY_FULL[day] + "'s set."]); }
      }
      if(good && p.kind === 'rbElse' && day) return rbDayDone(s, d, day);
      if(no || (choice == null && RB_NEXT.test(c))){
        if(p.kind === 'rbChanges' || !day) return rbOnwardOrDone(s, d);
        return rbDayDone(s, d, day);
      }
      if(yes) return rbAsk(p.kind, [], 'What else?', p.kind === 'rbElse' ? [{ label: 'No, next day', value: 'no' }] : [{ label: "No, that's it", value: 'no' }], { day: day }, s, 'rb what else', { expect: 'any' });
      // v3.11.19: a day on its own ("Thursday", to "What should change?") is that day
      var only = choice == null ? /^(?:(?:on|for|the|um|uh|so|ok|okay)\s+)*([a-z]+)(?:\s+(?:please|then))?$/.exec(c) : null, oday = only && rbDayOf(only[1]);
      if(oday && RE.DAYS.indexOf(oday) > -1 && oday !== day) return rbGoTo(s, d, oday, []);
      return c ? rbEdit(text, plainEnv('draft')) : null;
    }
    if(p.kind === 'rbBack'){
      if(yes) return rbPresent(s, d, p.back, []);
      if(no) return rbAsk('rbElse', [], 'Anything else for ' + DAY_FULL[day] + '?', [{ label: 'No, next day', value: 'no' }], { day: day }, s, 'rb stay ' + day);
      return c ? rbEdit(text, plainEnv('draft')) : null;
    }
    return null;
  }
  /* "add 2 kilos of mozzarella" in the middle of the roster: an item on the
     orders or the prep list, and no staff name for sure, is the orders' */
  function rbOrderSaid(text, d){
    var find = rbFinder(d), named = rbClean(text).split(' ').some(function(w){ var m = find(w); return m && m.sure && !RB_WORDS[w]; });
    if(named || /\b(me|myself)\b/.test(rbClean(text))) return false;
    try{ return parse(text, catalogue(host.data(), taught())).items.some(function(it){ return it.exact && it.exact.length; }); }catch(e){ return false; }
  }
  /* v3.11.19: names someone on the staff for sure */
  function rbAboutRosterName(c, d){
    var find = rbFinder(d);
    return c.split(' ').some(function(w){ var m = find(w); return m && m.sure && !RB_WORDS[w]; });
  }
  /* names someone on the staff for sure, or says the roster's own words */
  function rbAboutRoster(c, d){
    var find = rbFinder(d);
    return c.split(' ').some(function(w){ var m = find(w); return m && m.sure && !RB_WORDS[w]; })
      || /\brosters?\b|\bshifts?\b/.test(c);
  }
  function rbReaskOrSay(s, lines, log){ return s && !s.finished ? rbReask(s, lines, log) : rbSay('answer', lines, log); }
  /* v3.10.1 (his log, 12 Oct: "no" to "Add them?" asked it again, three
     times): after "no" to a name question, the session's question is the
     one before it, or none */
  function rbBack(s, p){
    if(!s || !s.asked || !/^rb(New|Pick)$/.test(s.asked.kind)) return;
    s.asked = (p && p.prev) || s.asked.prev || null;
    rbKeep(s);
  }
  function rbOnwardOrDone(s, d){
    var at = RE.firstUnfinished(s);
    if(at) return rbPresent(s, d, at, []);
    return rbWeekDone(s, d, []);
  }
  function rbDoCopy(s, d, day, from, what){
    var plan = { mon: s.week, ops: [{ op: 'copy', day: day, from: from }], days: [day], did: [what], pre: [] };
    var week = rbWeekOf(d, s.week);
    if(RE.sameDay(week[day], from)) return rbDayDone(s, d, day);
    var r = RE.commit(week, plan.ops[0], rbCtx(d), rbSaver(s.week));
    var log = 'rb ' + s.week + ' copy ' + day + ' ' + what;
    if(!r.ok) return rbRefused(r, plan, s, [], log);
    var lab = 'Roster: ' + DAY_FULL[day] + ' ' + what;
    var aid = r.undo ? remember(lab, [{ k: 'ro', mon: s.week, rec: r.undo }]) : null;
    return rbDayDone(s, d, day, [], aid ? { action: { id: aid, label: lab, undo: true }, logPre: log + ' saved' } : { logPre: log + ' saved' });
  }
  /* after a yes to a multi-day change, a copy of the week, or clearing a day */
  function rbConfirmed(c){
    var d = rbData();
    if(!d || !RE) return cant("I can't reach the roster.", 'rb none');
    var s = c.env && c.env.session ? rbSession() : null;
    if(s && (s.finished || s.week !== c.plan.mon)) s = null;
    if(c.plan.copyAll || c.plan.closed || c.plan.emptied || c.plan.clearWeek){
      var r = RE.commit(rbWeekOf(d, c.plan.mon), { op: 'batch', ops: c.plan.ops }, rbCtx(d), rbSaver(c.plan.mon));
      var log = 'rb ' + c.plan.mon + ' ' + c.plan.ops.map(rbOpLog).join('; ');
      if(!r.ok) return rbRefused(r, c.plan, s, [], log);
      var lab = 'Roster: ' + (c.plan.copyAll ? 'copied last week' : c.plan.did.join('; '));
      var aid = r.undo ? remember(lab, [{ k: 'ro', mon: c.plan.mon, rec: r.undo }]) : null;
      var extra = aid ? { action: { id: aid, label: lab, undo: true }, logPre: log + ' saved' } : { logPre: log + ' saved' };
      // v3.11.19: the whole week cleared, then built again from the start (his "and will build it again")
      if(c.plan.clearWeek){
        var wk = rbWeekWord(d, c.plan.mon), s3 = RE.newSession(c.plan.mon, 'day', now()), d3 = rbData();
        if(!rbRefOf(d3, c.plan.mon)) return rbPresent(s3, d3, 'wed', ['Cleared. ' + wk + "'s roster is empty. Let's go day by day."], extra);
        return rbAsk('rbMode', ['Cleared. ' + wk + "'s roster is empty."], 'Day by day, or copy last week and just tell me the changes?',
          [{ label: 'Day by day', value: 'day' }, { label: 'Copy last week', value: 'copy' }], { short: RB_MODE_SHORT }, s3, 'rb cleared week', { ans: extra });
      }
      if(!s) return rbSay('done', [cap(c.plan.did.join('. ')) + '.'], 'rb confirmed', extra);
      if(c.plan.copyAll) return rbCopied(s, rbData(), ["Done: it's last week's roster now."], extra);
      if(c.plan.emptied) return rbEmptied(s, rbData(), c.plan.emptied, c.plan.back, DAY_FULL[c.plan.emptied] + "'s cleared: nobody's on.", extra);
      s.days[c.plan.closed] = 'closed'; s.focus = c.plan.closed;
      return rbOnward(s, rbData(), [DAY_FULL[c.plan.closed] + "'s cleared and closed."], extra);
    }
    return rbDo(c.plan, c.env, s, []);
  }
  /* "Undid that: Y's back on Thursday." from what the undo put back */
  function rbUndoSay(d, changes){
    return changes.map(function(ch){
      var n = rbWho(d, ch.id), day = DAY_FULL[ch.day];
      if(ch.kind === 'added') return rbIs(n) + ' back on ' + day;
      if(ch.kind === 'removed') return rbIs(n) + ' off ' + day + ' again';
      return rbIs(n) + ' back to ' + rbTime(ch.after.start) + ' on ' + day;
    });
  }

  /* ---------- the doorway ---------- */
  function hello(){ return { room: 'almo', label: 'Almo', contract: 1, version: host.version || '' }; }

  /* Single item names that are everyday words go in cues, not strong
     (contract 4): another room may use them. */
  var EVERYDAY = { time: 1, date: 1, dates: 1, base: 1, rocket: 1, honey: 1, jam: 1, salt: 1, pepper: 1, cream: 1, butter: 1, milk: 1,
    oil: 1, sugar: 1, chips: 1, mint: 1, sage: 1, ranch: 1, order: 1, list: 1, lemon: 1, celery: 1, carrots: 1, flats: 1, mac: 1,
    caps: 1, pep: 1, dough: 1, chicken: 1, thigh: 1, cucumber: 1, squid: 1, speck: 0, spec: 1, speak: 1, tom: 1, tomb: 1, toum: 0,
    fior: 1, fiore: 1, confit: 0, tira: 1, moz: 1, mots: 1, caramel: 1, olives: 1, potatoes: 1, potato: 1, spuds: 1, parm: 1,
    milk_: 1, paprika: 1, oregano: 1, pumice: 1, burnet: 1, durra: 1, k: 1 };
  /* v3.11.12 (his log, 15 Oct: "add three boxes of pizza dough" got Pluto's
     "I can't do that yet": the menu had only "buvetti pizza dough balls"):
     the runs of two or more words inside a long name ("pizza dough", "dough
     balls"), none starting or ending on a small word */
  var PIECE_EDGE = { of: 1, the: 1, and: 1, with: 1, in: 1, a: 1, an: 1, for: 1, on: 1, to: 1, n: 1 };
  function namePieces(name){
    var w = clean(name).split(' ').filter(Boolean), out = [];
    if(w.length < 3) return out;
    for(var len = 2; len < w.length; len++) for(var i = 0; i + len <= w.length; i++){
      var part = w.slice(i, i + len);
      if(PIECE_EDGE[part[0]] || PIECE_EDGE[part[part.length - 1]] || part.some(function(x){ return /^[0-9]/.test(x); })) continue;
      out.push(part.join(' '));
    }
    return out;
  }
  /* v3.11.14 (his 15 Oct log, "can you add three boxes of pizza dough"): since
     3.11.12 Pluto's router sends it here by the piece, but in Pluto a name
     that isn't whole was "not mine", so Pluto still said "I can't do that
     yet". A whole piece of one product's long name, the same pieces the menu
     gives Pluto, now counts as its name. */
  function wholePiece(it, f){
    if(!f || f.how !== 'superset' || f.top !== 1 || !f.list.length || !it.stems || it.stems.length < 2) return false;
    var said = it.stems.join(' ');
    return namePieces(itemSay(f.list[0].name)).some(function(p){ return p.split(' ').map(stem).join(' ') === said; });
  }
  function menu(){
    var d = host.data(), cat = catalogue(d, taught());
    var strong = [], cues = ['prep', 'order', 'orders', 'supplier', 'how much', 'whats on the', 'prep list', 'the list', 'made', 'done', 'ticked off'];
    function put2(w){
      w = clean(w);
      if(!w) return;
      if(w.indexOf(' ') < 0 && (EVERYDAY[w] || w.length < 4)){ if(cues.indexOf(w) < 0) cues.push(w); return; }
      if(strong.indexOf(w) < 0) strong.push(w);
    }
    (d.suppliers || []).forEach(function(s){ put2(s.name); put2(supSay(s.name)); (s.products || []).forEach(function(p){ put2(itemSay(p.name)); namePieces(itemSay(p.name)).forEach(put2); (PRODUCT_ALIASES[p.id] || []).forEach(put2); }); });
    (d.prepCatalogue || []).forEach(function(c){ put2(c.name); });
    Object.keys(taught()).forEach(function(k){ put2(k); });
    put2('prep list');
    ['trip list', 'purple list'].forEach(put2);              // v3.11.8: Google's "prep list" (LISTS), so Pluto's router sends them here
    ['timesheet', 'time sheet', 'my hours'].forEach(put2);   // v3.9.6
    ['roster', 'rostered'].forEach(put2);                    // v3.9.11
    cues = cues.filter(function(c){ return strong.indexOf(c) < 0; });
    return { room: 'almo', label: 'Almo', contract: 1, help: 'your prep list, orders and timesheet', busy: 'Checking the list\u2026',
      strong: strong, cues: cues,
      verbs: ['add', 'chuck in', 'we need', 'put', 'get', 'order', 'remove', 'take off', 'scrap', 'drop', 'change', 'make it', 'read', 'whats on', 'send', 'tick off', 'clear'],
      examples: ['add salad dressing to the prep list', 'chuck in 2 kilos of mozzarella', 'whats on the aziz order', 'take the speck off', 'pizza sauce is done', 'send the aziz order', 'add todays timesheet'] };
  }
  function reset(){ ctx = null; pending = null; tsLast = null; dict = null; lastDone = null; lastUndone = null; goAhead = null; }

  /* ---------- reading ---------- */
  /* v3.11.1 (owner, 13 Oct): the prep list says five on the first go; "is
     there more?" says the rest, and "the whole list" / "read them all" says
     every one ("read them all" read the orders instead). An order still says
     six, and has the rest and the whole too. lastRead is the list just read,
     kept only until the next answer. */
  var PREP_SPOKEN = 5, lastRead = null, READ_FOLLOW_MS = 2 * 60 * 1000;
  function spoken(head, names, first, how){
    if(how === 'rest'){
      var rest = names.slice(first);
      return rest.length ? 'The rest: ' + joinAnd(rest) + '.' : "That's all of them.";
    }
    if(how === 'all' || names.length <= first) return head + joinAnd(names) + '.';
    return head + names.slice(0, first).join(', ') + ', and ' + (names.length - first) + ' more.';
  }
  function readPrep(cat, d, how){
    if(prepBlind) return cant(PREP_BLIND, 'read prep unknown');     // v3.11.11: never "Nothing" when it never came in
    var old = prepOld(d);
    var lines = (d.prepLines || []).filter(function(l){ return !l.done; });
    var done = (d.prepLines || []).length - lines.length;
    var sec = d.prepSections || [];
    lines.sort(function(a, b){
      var ia = sec.indexOf(a.section), ib = sec.indexOf(b.section);
      ia = ia < 0 ? 999 : ia; ib = ib < 0 ? 999 : ib;
      if(ia !== ib) return ia - ib;
      return String(a.text).localeCompare(String(b.text));
    });
    var shown = how === 'all' ? lines : how === 'rest' ? lines.slice(PREP_SPOKEN) : lines.slice(0, 6);
    var show = { title: how === 'rest' && lines.length > PREP_SPOKEN ? 'Prep list \u00b7 the rest' : 'Prep list', lines: shown.map(function(l){ return { text: l.text, tone: 'ok' }; }), open: { view: 'prep' } };
    lastRead = { kind: 'prep', at: now() };
    if(!lines.length){
      return ans('answer', { say: [old, done ? 'Everything on the prep list is done.' : 'Nothing on the prep list.'].filter(Boolean), show: show, log: 'read prep 0' + (old ? ' old' : '') });
    }
    var names = lines.map(function(l){ return l.text; });
    var say = spoken('Prep list, ' + lines.length + ' to do: ', names, PREP_SPOKEN, how);
    var more = !how && names.length > PREP_SPOKEN ? [spoken('', names, PREP_SPOKEN, 'rest')] : [];
    return ans('answer', { say: [old, say].filter(Boolean), more: more, show: show, log: 'read prep ' + (how ? how + ' ' : '') + lines.length + (old ? ' old' : '') });
  }
  function readOrder(s, how){
    var items = onOrder(s), name = supSay(s.name);
    var shown = how === 'all' ? items : how === 'rest' ? items.slice(SPOKEN_MAX) : items.slice(0, 6);
    var show = { title: name + ' order', lines: shown.map(function(p){ return { text: itemSay(p.name) + ' \u00b7 ' + fmt(+p.qty) + ' ' + p.unit, tone: 'ok' }; }), open: { view: 'supplier', id: s.id } };
    lastRead = { kind: 'order', sid: s.id, at: now() };
    if(!items.length) return ans('answer', { say: ['Nothing on the ' + name + ' order yet.'], show: show, log: 'read order ' + name + ' 0' });
    var lines = items.map(lineOf);
    var say = spoken(name + ' order, ' + items.length + (items.length === 1 ? ' item: ' : ' items: '), lines, SPOKEN_MAX, how);
    var more = !how && lines.length > SPOKEN_MAX ? [spoken('', lines, SPOKEN_MAX, 'rest')] : [];
    return ans('answer', { say: [say], more: more, show: show, log: 'read order ' + name + ' ' + (how ? how + ' ' : '') + items.length });
  }
  /* "is there more?", "what else", "the whole list", "read them all": about the
     list just read (or the one named in it). Anything else is left alone. */
  /* v3.11.9 (his test, 14 Oct: "what else is in the prep list" said "I can't
     do that yet"): "in" as well as "on", and the list or order by name */
  /* v3.11.12 (his log, 15 Oct: "can you tell me the rest", "can you read me
     the rest of the list" and "can you continue what's on my prep list" were
     taken as chatter or "not mine"): asked politely, "tell me the rest",
     "continue", "carry on", "keep going", and "of the list" / "my list" */
  var RD_REST = /^(?:(?:and|so|ok|okay|um|uh|yeah|yes|right|alright) )*(?:(?:can|could|would|will) you (?:please )?|please )?(?:is there (?:any )?more|are there (?:any )?more|any more|anymore|more|more please|what else|whats else|what else is (?:there|(?:on|in) (?:it|there|the (?:prep )?list|the (?:[a-z]+ ){1,3}order))|anything else|and the rest|the rest|whats the rest|what are the (?:rest|others)|the others|tell me more|(?:read|tell|give|say)(?: me)? the (?:rest|others)|read the others|(?:continue|carry on|keep going|go on)(?: with)?(?: (?:it|the rest|the list|the prep list|(?:whats|what is) (?:on|in) (?:the|my) (?:prep )?list))?|(?:is that|was that|thats) (?:all|it|everything))(?: please| (?:on|in|of) (?:it|there|them|(?:the|my) (?:prep )?list|the (?:[a-z]+ ){1,3}order))?(?: please)?$/;
  var RD_ALL = /\b(?:(?:whole|full|entire|complete) (?:list|prep list|order|thing|lot)|(?:read|tell|say|give|show)(?: me)?(?: them| it| the lot)? all|all of (?:them|it)|everything|every item|all the (?:items|prep|prep items|things|names)|the lot)\b/;
  /* v3.11.12 (his log, 15 Oct: "can you check my prep list please" got the
     how-to line; "what's remaining on the list" was "not mine"): asked to
     check, read or go through the list, or what's left on it, it reads it
     ("show me" still opens the screen) */
  var RD_ASK = /^(?:(?:and|so|ok|okay|um|uh|yeah|right|alright) )*(?:(?:can|could|would|will) you (?:please )?)?(?:(?:check|read|read out|tell me|go through|run through)(?: me)? (?:my|the|our) (?:prep )?list|(?:whats|what is|whats still|what is still) (?:remaining|left|to do|outstanding)(?: (?:on|in) (?:the|my|our) (?:prep )?list)?)(?: please)?$/;
  // v3.11.16: a sentence that asks for a list first ("what's on my prep list …", "read me the Aziz order …")
  var READ_LIST_FIRST = /^(?:(?:and|so|ok|okay|um|uh|yeah|right|alright|also) )*(?:(?:can|could|would|will) you (?:please |also )?|please )?(?:(?:tell me|read|read me|read out|check|go through) (?:(?:whats|what is) (?:on|in) )?|(?:whats|what is|whats still) (?:on|in) )(?:the|my|our) /;
  var REMAIN_FRAG = /^(?:(?:and|so|ok|okay) )*(?:(?:whats|what is) )?(?:still )?(?:remaining|left|left to do|still to do)(?: (?:now|then|on (?:it|there|the list)))?(?: please)?$/;   // v3.11.17
  async function readMore(text, last){
    var c = clean(text), rest = RD_REST.test(c), all = !rest && RD_ALL.test(c), ask = !rest && !all && RD_ASK.test(c);
    // v3.11.17 (his check, 17 Oct: "remaining now", Google's "what's" lost): right after a read, the list again
    if(!rest && !all && !ask && last && now() - last.at <= READ_FOLLOW_MS && REMAIN_FRAG.test(c)) ask = true;
    if(ask){
      var fa = await fresh();
      // "what's left" with no list said: the list just read, else the prep list
      if(!/\blist\b/.test(c) && last && last.kind === 'order' && now() - last.at <= READ_FOLLOW_MS){ var so = supplier(fa.cat, last.sid); if(so) return readOrder(so); }
      return readPrep(fa.cat, fa.data);
    }
    if(!rest && !all) return null;
    var f = await fresh(), cm = parse(text, f.cat);
    if(all && cm.verb && cm.verb !== 'read' && cm.verb !== 'open') return null;   // "clear everything", "add the lot"
    if(cm.items.some(function(it){ return it.exact && it.exact.length; })) return null;
    var target = cm.list === 'prep' ? { kind: 'prep' } : (cm.sids || []).length === 1 ? { kind: 'order', sid: cm.sids[0] }
      : (!cm.list || cm.list === 'list') && last && now() - last.at <= READ_FOLLOW_MS ? last   // "the whole list": the one just read
      : cm.list === 'list' && all ? { kind: 'prep' } : null;                                   // else "the list" is the prep list, as when reading
    if(!target) return null;
    if(target.kind === 'prep') return readPrep(f.cat, f.data, rest ? 'rest' : 'all');
    var sp = supplier(f.cat, target.sid);
    return sp ? readOrder(sp, rest ? 'rest' : 'all') : null;
  }
  function readAll(cat){
    var parts = cat.suppliers.map(function(s){ var n = onOrder(s).length; return n ? supSay(s.name) + ' ' + n + (n === 1 ? ' item' : ' items') : ''; }).filter(Boolean);
    if(!parts.length) return ans('answer', { say: ['Nothing on any order yet.'], log: 'read orders 0' });
    return ans('answer', { say: ['Orders so far: ' + joinAnd(parts) + '.'], show: { title: 'Orders', lines: parts.slice(0, 6).map(function(p){ return { text: p, tone: 'ok' }; }), open: { view: 'list' } }, log: 'read orders ' + parts.length });
  }

  /* ---------- which list, which item ---------- */
  function verbOf(cmd, it){ return it.verb || cmd.verb || 'add'; }
  /* Which lists an item may be on. A list or supplier said in the item's
     own clause is firm; one said elsewhere in the sentence is only tried
     first ("add pizza sauce and hot honey to prep"). */
  function kindsFor(cmd, it){
    var v = verbOf(cmd, it);
    var all = v === 'tick' || v === 'untick' ? ['line'] : v === 'remove' ? ['order', 'line'] : v === 'read' || v === 'open' ? ['order', 'line', 'prep'] : ['order', 'prep'];
    if(it.oneoff) return { strict: ['prep'], all: all, sids: [] };   // v3.11.10: a yes to "… for today": the prep list
    function by(list, sids, words){
      var prep = list === 'prep' || list === 'list', order = list === 'order' || (sids && sids.length > 0) || !!ORDER_VERBS[words];
      if(v === 'tick' || v === 'untick') return ['line'];
      if(v === 'remove') return prep ? ['line'] : order ? ['order'] : null;
      if(v === 'read' || v === 'open') return prep ? ['line', 'prep'] : order ? ['order'] : null;
      return prep ? ['prep'] : order ? ['order'] : null;
    }
    if(it.kind) return { strict: it.kind === 'prep' ? (v === 'remove' ? ['line'] : v === 'tick' || v === 'untick' ? ['line'] : ['prep']) : ['order'], all: all, sids: [] };
    var own = by(it.list, it.sids, it.verbWords);
    if(own) return { strict: own, all: all, sids: it.sids || [] };
    var whole = by(cmd.list, cmd.sids, cmd.verbWords);
    if(whole) return { prefer: whole, all: all, sids: cmd.sids };
    /* v3.11.10 (his test, 15 Oct: "could you also add chopped parsley"): how
       it's prepped, said with no list, points at the prep list; when it isn't
       a prep item, resolve() says what it is and asks (never guesses an order) */
    // (an amount means an order; and nothing found as prep falls back to every list, as "prefer" does: "cuts me off I guess" stays not found)
    if((v === 'add' || v === 'set') && !(it.exact && it.exact.length) && !(it.qty && !it.qty.vague) && (it.stems || []).some(function(w){ return PREP_TRIM[w]; })) return { prefer: ['prep'], all: all, sids: [], prepWords: true };
    if(it.makePrep) return { prefer: ['prep'], all: all, sids: [] };
    return { all: all, sids: [] };
  }
  function label(e){ return itemSay(e.name); }
  function lineLabel(e){ return e.by ? 'Added by ' + e.by : itemSay(e.name); }
  function look(it, cat, kinds, v){
    var found = {};
    kinds.forEach(function(k){ found[k] = findItems(it, cat, [k]); });
    if(found.line && found.line.list.length){
      var want = v === 'untick' ? true : (v === 'tick' || v === 'remove') ? false : null;
      if(want != null){
        var right = found.line.list.filter(function(e){ return e.done === want; });
        if(!right.length && v === 'tick') found.stop = cant(itemSay(found.line.list[0].name) + ' is already ticked off.', 'tick already');
        else if(!right.length && v === 'untick') found.stop = cant(itemSay(found.line.list[0].name) + " isn't ticked off.", 'untick not done');
        found.line.list = right;
      }
    }
    return found;
  }
  function anyFound(found){ return Object.keys(found).some(function(k){ return k !== 'stop' && found[k].list.length; }); }
  /* a prep item named for ticking or taking off means its line on the list */
  function lineFor(cat, e, v){
    var lines = cat.entries.filter(function(x){ return x.kind === 'line' && clean(x.name) === clean(e.name); });
    var want = v === 'untick' ? true : false;
    return lines.filter(function(x){ return x.done === want; })[0] || lines[0] || null;
  }

  /* v3.11.10 (his ask, 15 Oct: "check the closest item first"): not a prep
     item, but an order item by that name: say so, and offer it for today on
     the prep list, or to order it ("Order it" / "the ordering list") */
  function orderTwinAsk(cmd, i, it, oe){
    var shown = it.words.map(function(w){ return SHOWN_FIX[clean(w)] || w; }).join(' ');
    if(cmd.newPrep && canNewPrep()) return askSection(titled(shown));   // v3.11.13: "add parsley as a permanent prep item"
    // v3.11.13: and "New prep item", where the page can make one (the contract's four buttons)
    var opts = [{ label: 'Prep list, today', value: 'yes' }].concat(canNewPrep() ? [{ label: 'New prep item', value: 'newprep' }] : [])
      .concat([{ label: 'Order it', value: 'order' }, { label: 'No', value: 'no' }]);
    return asking('oneoff', label(oe) + " isn't on the prep list; it's on the " + supSay(oe.sname) + ' order list. Add ' + cap(shown) + ' to the prep list for today, or order it?',
      opts, { cmd: cmd, item: i, orderPick: oe.id, name: titled(shown) });
  }

  /* ---------- v3.11.13: new permanent items by voice ----------
     His ask (15 Oct); his wording, OK'd 16 Oct ("If I don't like the feel when
     using, we can change it"). A prep item: "… isn't a prep item yet. Add it
     for today only, or as a new prep item?" → "Which section?" → read back →
     yes. A product (on no list, an order clearly meant): "… isn't on any
     order list. Add it as a new product?" → which supplier → what it comes in
     (each skipped when said) → read back → yes. It writes the shared
     catalogue (his staff see it), so it's always read back and needs a plain
     yes; undo takes it back. Only where the page can make them (host). */
  var NEW_PREP_RE = /\b(permanent|permanently|for good|new item|new prep item|as a prep item)\b/;
  var NEW_PREP_SAID = /\b(?:as an? (?:new |permanent )+(?:prep )?item|as an? (?:new )?prep item|permanently|for good)\b/;
  function canNewPrep(){ return typeof host.newPrepItem === 'function'; }
  function canNewProd(){ return typeof host.newProduct === 'function'; }
  function titled(words){
    return String(words || '').split(' ').filter(Boolean).map(function(w){ return /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' ');
  }
  /* his prep sections, the fullest first (a section with no items yet still counts) */
  function prepSecsOf(d){
    var count = {};
    (d.prepCatalogue || []).forEach(function(c){ var s = c.section || ''; if(s) count[s] = (count[s] || 0) + 1; });
    (d.prepSections || []).forEach(function(s){ if(s && !count[s]) count[s] = 0; });
    return Object.keys(count).filter(function(s){ return s !== 'Other'; }).sort(function(a, b){ return count[b] - count[a] || a.localeCompare(b); });
  }
  /* "sauces", "bases and pastes", or one word of it ("dessert" for Desserts & Sweet Components).
     Replaying his 15 Oct log: "it should be able to add a new prep item…" picked "Batch prep" by
     "prep". The kitchen's own words never pick one, and a long sentence only by a whole name. */
  var SEC_SKIP = { prep: 1, list: 1, lists: 1, item: 1, items: 1, section: 1, sections: 1, new: 1, add: 1, today: 1, permanent: 1, good: 1, thing: 1, things: 1, able: 1, should: 1, would: 1, could: 1 };
  function pickSection(text, secs){
    var c = clean(text);
    if(!c) return null;
    var whole = secs.filter(function(s){ return c.indexOf(clean(s)) > -1; });
    if(whole.length === 1) return whole[0];
    if(c.split(' ').length > 6) return null;
    var said = c.split(' ').filter(function(w){ return w.length > 3 && !STOP[w] && !SEC_SKIP[w]; }).map(stem);
    var hits = secs.filter(function(s){ return clean(s).split(' ').map(stem).some(function(w){ return said.indexOf(w) > -1; }); });
    return hits.length === 1 ? hits[0] : null;
  }
  function askSection(name, again){
    var secs = prepSecsOf(host.data()), ex = secs.slice(0, 3);
    if(!secs.length) return confirmNewPrep(name, 'Other');
    return asking('newsec', (again ? 'Which section? Say one of yours, like ' : 'Which section? Like ') + joinOr(ex) + '.',
      ex.map(function(s){ return { label: s, value: s }; }), { name: name, secs: secs, again: !!again }, 'choice');
  }
  function confirmNewPrep(name, section){
    return confirming('newprep', ['New prep item: ' + name + ', in ' + section + '. Your staff will see it too.'], 'Add it?', { name: name, section: section }, 'newprep ' + section);
  }
  /* an order item on no list: offered as a new product only when an order is
     clearly meant ("to the order", a supplier, "order …", or an amount with
     its unit), and the name is a few real words (never a misheard jumble) */
  function newProdAsk(cmd, it, kinds, v, K, shown){
    if(!canNewProd() || (v !== 'add' && v !== 'set') || kinds.indexOf('order') < 0) return null;
    var one = function(l){ return l && l.length === 1 && l[0] === 'order'; };
    var meant = one(K.strict) || one(K.prefer) || (K.sids && K.sids.length === 1) || (it.qty && !it.qty.vague && it.qty.unit);
    var w = clean(shown).split(' ').filter(Boolean);
    if(!meant || !w.length || w.length > 5 || w.some(function(x){ return /^[0-9]/.test(x); }) || w.every(function(x){ return STOP[x]; }) || notAName(shown)) return null;
    var name = titled(shown);
    return asking('newprod', name + " isn't on any order list. Add it as a new product?", [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
      { np: { name: name, sid: K.sids && K.sids.length === 1 ? K.sids[0] : null,
        qty: it.qty && !it.qty.vague && it.qty.n != null ? it.qty.n : 0, unit: it.qty && !it.qty.vague && it.qty.unit ? it.qty.unit : null } });
  }
  function nextProdStep(np, cat){
    var s = np.sid ? supplier(cat, np.sid) : null;
    if(!s) return askSupplier(np, cat, false);
    if(!np.unit) return askUnit(np, false);
    var us = unitSay(np.unit)[1] || np.unit;
    return confirming('newprod', ['New product: ' + np.name + ', from ' + supSay(s.name) + ', in ' + us + '. Your staff will see it too.'],
      np.qty > 0 ? 'Add it, with ' + amount(np.qty, np.unit) + ' on the ' + supSay(s.name) + ' order?' : 'Add it?',
      { name: np.name, sid: s.id, sname: s.name, unit: np.unit, qty: np.qty > 0 ? np.qty : 0 }, 'newprod ' + supSay(s.name));
  }
  function askSupplier(np, cat, again){
    var top = cat.suppliers.slice().sort(function(a, b){ return (b.products || []).length - (a.products || []).length; }).slice(0, 3);
    return asking('newsupp', again ? 'Which supplier? Say its name, like ' + joinOr(top.map(function(s){ return supSay(s.name); })) + '.' : 'Which supplier?',
      top.map(function(s){ return { label: supSay(s.name), value: s.id }; }), { np: np, again: !!again }, 'choice');
  }
  function askUnit(np, again){
    return asking('newunit', again ? 'What does it come in? Say one like kilos, bottles or boxes.' : 'What does it come in? Like kilos, bottles or boxes.', [], { np: np, again: !!again }, 'unit');
  }
  function unitIn(text){
    var c = clean(text), w = c.split(' ');
    if(/\bmarket bunch/.test(c)) return 'bunch';
    for(var i = 0; i < w.length; i++){ if(UNIT_WORDS[w[i]]) return UNIT_WORDS[w[i]]; }
    return null;
  }
  function supplierIn(text, cat){
    var c = parse(text, cat);
    if((c.sids || []).length === 1) return c.sids[0];
    var t = clean(text);
    var hit = cat.suppliers.filter(function(s){ return t.indexOf(clean(supSay(s.name))) > -1; });
    return hit.length === 1 ? hit[0].id : null;
  }
  var DROP_RE = /^(?:no|nope|nah|cancel|never mind|nevermind|forget it|leave it)\b/;
  async function newItemAnswer(p, req, mode){
    var choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null, text = String(req.text || '');
    var cat = (await fresh()).cat;
    pending = null;
    var dropped = function(k){ return ans('answer', { say: ['Left it. Nothing changed.'], log: k + ' dropped' }); };
    /* replaying his 15 Oct log: "what's on my trip list", said while "Add it as a
       new product?" waited, was "Left it". Something else asked for is done
       instead, as with The Pass's other questions */
    var other = function(){
      if(choice != null || DROP_RE.test(clean(text))) return null;
      var mb = parse(text, cat);
      return mb.verb || mb.items.some(function(x){ return x.exact && x.exact.length; }) ? mb : null;
    };
    var mb;
    if(p.kind === 'newsec'){
      var sec = choice != null && p.secs.indexOf(choice) > -1 ? choice : pickSection(choice != null ? choice : text, p.secs);
      if(sec) return confirmNewPrep(p.name, sec);
      if((mb = other())) return run(mb, req, mode);
      if(DROP_RE.test(clean(text)) || p.again) return dropped('newsec');
      return askSection(p.name, true);
    }
    if(p.kind === 'newprod'){
      var yn = choice != null ? choice : /^(?:yes|yeah|yep|yup|sure|ok|okay|please|go on|do it)\b/.test(clean(text)) && yesNo(text) !== 'no' ? 'yes' : null;
      if(yn === 'yes') return nextProdStep(p.np, cat);
      if((mb = other())) return run(mb, req, mode);
      return dropped('newprod');
    }
    if(p.kind === 'newsupp'){
      var sid = choice != null && supplier(cat, choice) ? choice : supplierIn(choice != null ? choice : text, cat);
      if(sid){ p.np.sid = sid; return nextProdStep(p.np, cat); }
      if((mb = other())) return run(mb, req, mode);
      if(DROP_RE.test(clean(text)) || p.again) return dropped('newsupp');
      return askSupplier(p.np, cat, true);
    }
    if(p.kind === 'newunit'){
      var u = unitIn(choice != null ? choice : text);
      if(u){ p.np.unit = u; return nextProdStep(p.np, cat); }
      if((mb = other())) return run(mb, req, mode);
      if(DROP_RE.test(clean(text)) || p.again) return dropped('newunit');
      return askUnit(p.np, true);
    }
    return dropped('new item');
  }

  /* The single place that works out what each item means. Returns an
     answer (a question, or why not) when something needs one, else null
     with every item's .e filled in, or .missing set. */
  function resolve(cmd, cat, mode, hasCue){
    for(var i = 0; i < cmd.items.length; i++){
      var it = cmd.items[i];
      if(it.e || it.missing) continue;
      var v = verbOf(cmd, it);
      if(it.pick){
        it.e = entryById(cat, it.pick);
        if(it.e && it.e.kind === 'prep' && (v === 'tick' || v === 'untick' || v === 'remove')){
          var ln = lineFor(cat, it.e, v);
          if(!ln) return cant(notOnPrep(it.e.name), prepBlind ? 'prep unknown' : 'not on list');
          it.e = ln;
        }
        if(it.e && it.e.kind === 'line' && v === 'tick' && it.e.done) return cant(itemSay(it.e.name) + ' is already ticked off.', 'tick already');
        if(it.e) continue;
      }
      var K = kindsFor(cmd, it), kinds = K.strict || K.prefer || K.all;
      var found = look(it, cat, kinds, v);
      /* v3.11.10: how it's prepped, no list said, and no prep item by that name:
         an order item by that name is said, and asked about (never guessed) */
      if(K.prepWords && !anyFound(found) && !found.stop){
        var tw = findItems(it, cat, ['order']);
        if(tw.how === 'exact') return orderTwinAsk(cmd, i, it, tw.list[0]);
      }
      if(K.prefer && !anyFound(found) && !found.stop){ kinds = K.all; found = look(it, cat, kinds, v); }
      if(found.stop){
        if(cmd.items.length === 1) return found.stop;
        it.skip = found.stop.say[0]; it.missing = true; continue;
      }
      // v3.11.10: a one-off is named as he meant it ("Sliced speck", not Google's "spec")
      var shown = it.words.map(function(w){ var c0 = clean(w); return SHOWN_FIX[c0] || w; }).join(' ');
      // a supplier said: that supplier's products only, and say so if it lives elsewhere
      if(found.order && found.order.list.length && K.sids && K.sids.length === 1){
        var mine = found.order.list.filter(function(e){ return e.sid === K.sids[0]; });
        if(mine.length) found.order.list = mine;
        else if(K.strict && !it.otherOk){
          var e0 = found.order.list[0], s0 = supplier(cat, K.sids[0]);
          if(found.order.how === 'exact' || dedupe(found.order.list).length === 1){
            return asking('elsewhere', label(e0) + ' is on the ' + supSay(e0.sname) + ' order, not ' + supSay(s0 ? s0.name : '') + '. Put it there?',
              [{ label: 'Yes, ' + supSay(e0.sname), value: 'yes' }, { label: 'No', value: 'no' }], { cmd: cmd, item: i, pickId: e0.id });
          }
        }
      }
      var have = kinds.filter(function(k){ return found[k] && found[k].list.length; });
      // in Pluto, a sentence with no Almo word and no exact name is not ours
      /* v3.11.10 (his test, 15 Oct: "could you also add chopped parsley" mid-
         conversation got "Sorry, I didn't catch that"): unless he's talking
         with Almo already and asked for something done; then a name that's
         only close is asked about first ("Did you mean …?"), never acted on */
      // an order item named exactly, when only the prep list was looked at ("add chopped parsley"), is his kitchen too
      var orderTwin = !have.length && kinds.length === 1 && kinds[0] === 'prep' && findItems(it, cat, ['order']).how === 'exact';
      if(mode === 'pluto' && !hasCue && !orderTwin && !wholePiece(it, found.order) && !have.some(function(k){ return found[k].how === 'exact'; })){
        // a verb he actually said: a lone name ("tomatoes") mid-conversation stays chatter, as before
        if(!(cmd.followUp && have.length && cmd.verbWords && ['add', 'set', 'remove', 'tick', 'untick'].indexOf(v) > -1)) return notmine('no cue');
        cmd.askFirst = true;
      }
      if(!have.length){
        if(kinds.length === 1 && kinds[0] === 'prep' && (v === 'add' || v === 'set') && it.words.length && !notAName(shown)){   // v3.11.16: notAName
          if(it.oneoff){ it.e = { kind: 'oneoff', name: cap(shown), id: 'oneoff' }; continue; }
          /* v3.11.10 (his ask, 15 Oct: "check the closest item first"): when it's
             an order item by that name, say so, and offer to order it instead */
          var oo = findItems(it, cat, ['order']), oe = oo.list.length && (oo.how === 'exact' || dedupe(oo.list).length === 1) && oo.how !== 'fuzzy' ? oo.list[0] : null;
          if(oe) return orderTwinAsk(cmd, i, it, oe);
          // v3.11.13: "for good" said in the first place goes straight to its section; else the choice, where the page can make one
          if(cmd.newPrep && canNewPrep()) return askSection(titled(shown));
          if(canNewPrep()){
            return asking('oneoff', cap(shown) + " isn't a prep item yet. Add it for today only, or as a new prep item?",
              [{ label: 'Today only', value: 'yes' }, { label: 'New prep item', value: 'newprep' }, { label: 'No', value: 'no' }], { cmd: cmd, item: i, name: titled(shown) });
          }
          return asking('oneoff', cap(shown) + " isn't a prep item. Add it as a one-off?", [{ label: 'Add it', value: 'yes' }, { label: 'No', value: 'no' }], { cmd: cmd, item: i });
        }
        if(kinds.indexOf('line') > -1 && !kinds.some(function(k){ return k === 'order'; })){
          var other = findItems(it, cat, ['prep', 'order']);
          if(other.list.length && (other.how === 'exact' || dedupe(other.list).length === 1)) return cant(notOnPrep(other.list[0].name), prepBlind ? 'prep unknown' : 'not on list');
        }
        // v3.11.13: an order item on no list, an order clearly meant: offered as a new product
        if(cmd.items.length === 1){ var npa = newProdAsk(cmd, it, kinds, v, K, shown); if(npa) return npa; }
        it.missing = true; continue;
      }
      var kind = have[0];
      if(have.length > 1){
        var Q = function(k){ return QUALITY[found[k].how]; };
        var bestQ = Math.max.apply(null, have.map(Q));
        var top = have.filter(function(k){ return Q(k) === bestQ; });
        // a clear gap decides (a name against a sound-alike); a small one asks (pizza sauce, chicken)
        if(top.length === 1){
          var second = Math.max.apply(null, have.filter(function(k){ return k !== top[0]; }).map(Q));
          if(bestQ - second < 2) top = have.filter(function(k){ return Q(k) >= second; });
        }
        // an amount points at an order: prep lines don't have amounts
        if(top.length > 1 && it.qty && !it.qty.vague && top.indexOf('order') > -1) top = ['order'];
        // taking off: whichever actually has it
        if(top.length > 1 && v === 'remove'){
          var onOrd = found.order ? found.order.list.filter(function(e){ return e.qty > 0; }) : [];
          var onLine = found.line ? found.line.list : [];
          if(onOrd.length && !onLine.length){ top = ['order']; found.order.list = onOrd; }
          else if(onLine.length && !onOrd.length) top = ['line'];
        }
        // "make pesto": making is prep
        if(top.length > 1 && it.makePrep && top.indexOf('prep') > -1) top = ['prep'];
        /* v3.9.3: when every list only sounds like it ("pils garlic"), one
           "Did you mean…" across them, not "Prep list or an order?" first */
        if(top.length > 1 && top.every(function(k){ return found[k].how === 'fuzzy'; })){
          var mix = [];
          top.forEach(function(k){ dedupe(found[k].list).forEach(function(e){ if(mix.indexOf(e) < 0) mix.push(e); }); });
          var ch = mix.slice(0, 3);
          return asking('item', 'Did you mean ' + joinOr(ch.map(label)) + '?',
            ch.map(function(e){ return { label: label(e) + (e.kind === 'prep' ? ' (prep)' : ''), value: e.id }; }).concat([{ label: 'None of these', value: 'none' }]),
            { cmd: cmd, item: i, teach: it.stems.join(' '), said: it.words.join(' ') }, 'item');
        }
        if(top.length > 1){
          var oe = found.order && found.order.list.length ? found.order.list[0] : null;
          var opts = [{ label: 'Prep list', value: 'prep' }, { label: oe ? supSay(oe.sname) + ' order' : 'An order', value: 'order' }];
          return asking('list', 'Prep list or an order?', opts, { cmd: cmd, item: i });
        }
        kind = top[0];
      }
      var f = found[kind], list = dedupe(f.list);
      if(kind === 'order' && list.length > 1 && v === 'remove'){
        var withQ = list.filter(function(e){ return e.qty > 0; });
        if(withQ.length) list = withQ;
      }
      if(f.how === 'fuzzy' || ((cmd.verbCue || cmd.askFirst) && f.how !== 'exact')){   // v3.11.8: see run(); v3.11.10: askFirst, above
        var choices = list.slice(0, 3);
        return asking('item', 'Did you mean ' + joinOr(choices.map(label)) + '?',
          choices.map(function(e){ return { label: label(e), value: e.id }; }).concat([{ label: 'None of these', value: 'none' }]),
          { cmd: cmd, item: i, teach: it.stems.join(' '), said: it.words.join(' ') }, 'item');
      }
      if(list.length === 1){ it.e = list[0]; continue; }
      if(kind === 'order' && list.every(function(e){ return clean(e.name) === clean(list[0].name); })){
        return asking('item', 'From ' + joinOr(list.slice(0, 3).map(function(e){ return supSay(e.sname); })) + '?',
          list.slice(0, 3).map(function(e){ return { label: supSay(e.sname), value: e.id }; }), { cmd: cmd, item: i }, 'item');
      }
      if(kind === 'line' && list.every(function(e){ return clean(e.name) === clean(list[0].name); })){
        return asking('item', 'There are ' + list.length + ' lines for ' + itemSay(list[0].name) + '. Which one?',
          list.slice(0, 3).map(function(e){ return { label: lineLabel(e), value: e.id }; }), { cmd: cmd, item: i }, 'item');
      }
      var few = list.slice(0, 3);
      return asking('item', list.length > 3 ? 'Which one? There are ' + list.length + ', like ' + joinOr(few.map(label)) + '.' : 'Which one: ' + joinOr(few.map(label)) + '?',
        few.map(function(e){ return { label: label(e), value: e.id }; }).concat([{ label: 'None of these', value: 'none' }]), { cmd: cmd, item: i }, 'item');
    }
    return null;
  }

  /* Amounts for order items: asks when vague, when the unit can't be
     converted, or when it's far more than usual. Nothing changes until
     every item is clear. */
  function amounts(cmd){
    for(var i = 0; i < cmd.items.length; i++){
      var it = cmd.items[i], e = it.e, v = verbOf(cmd, it);
      if(!e || e.kind !== 'order') continue;
      var units = unitSay(e.unit)[1];
      var q = it.qty || (cmd.items.length === 1 ? cmd.looseQty : null);
      var n = null;
      if(it.qtyFix != null) n = it.qtyFix;
      else if(q && q.vague){
        return asking('howmany', 'How many ' + (units ? units + ' of ' : '') + label(e) + '?', [], { cmd: cmd, item: i }, 'number');
      }
      else if(q){
        var conv = convert(q.n, q.unit, canonUnit(e.unit));
        if(conv == null){
          return asking('unit', label(e) + ' is ordered in ' + (units || 'ones') + '. How many ' + (units || '') + '?', [], { cmd: cmd, item: i }, 'number');
        }
        n = Math.round(conv * 1000) / 1000;
      }
      if(n == null){
        if(v === 'set') return asking('howmany', 'How many ' + (units ? units + ' of ' : '') + label(e) + '?', [], { cmd: cmd, item: i }, 'number');
        if(v === 'remove'){ it.amount = null; continue; }
        n = e.inc;
      }
      if(n < 0) n = 0;
      it.amount = n;
      if((v === 'add' || v === 'set') && n > 0 && !it.okBig && tooMuch(e, n)){
        /* v3.11.9 (his test, 14 Oct): the item asked about is the one being
           talked about, so "change this to 15" after a no is the mozzarella,
           not the BBQ sauce added before it */
        ctx = { at: now(), verb: v, items: [{ id: e.id, kind: 'order', name: e.name }], deltas: {} };
        return asking('unusual', amountOf(n, e.unit, label(e)) + "? That's a lot more than usual.",
          [{ label: 'Yes, ' + fmt(n), value: 'yes' }, { label: 'No', value: 'no' }], { cmd: cmd, item: i });
      }
    }
    return null;
  }

  /* ---------- doing it ---------- */
  function r2(n){ return Math.round(n * 100) / 100; }
  async function change(cmd, cat, d){
    var said = [], nothing = [], notes = [], labels = [], show = [], ops = [], openView = null, lastVerb = null, done = [];
    var qtyNow = {}, orderChanges = [], prepAdds = [], ticks = [], removes = [], others = [];
    var addedNow = [], prepAddedNow = [];   // v3.11.10: what this adds, for a correction or "put it back" (lastDone)
    cmd.items.forEach(function(it){
      var e = it.e, v = verbOf(cmd, it);
      if(it.skip){ nothing.push(it.skip); return; }
      if(it.missing){ notes.push("I couldn't find " + it.words.join(' ') + '.'); return; }
      if(!e) return;
      if(e.kind === 'order'){
        var before = qtyNow[e.pid] != null ? qtyNow[e.pid] : e.qty, after;
        if(v === 'remove') after = it.amount == null ? 0 : Math.max(0, r2(before - it.amount));
        else if(v === 'set') after = r2(it.amount);
        else after = r2(before + it.amount);
        qtyNow[e.pid] = after;
        orderChanges.push({ e: e, before: before, after: after, it: it, v: v });
      }
      else if(e.kind === 'prep' || e.kind === 'oneoff'){
        if(v === 'remove' || v === 'tick' || v === 'untick'){ var np = notOnPrep(e.name); if(nothing.indexOf(np) < 0) nothing.push(np); return; }
        prepAdds.push({ e: e, it: it });
      }
      else if(e.kind === 'line'){
        if(v === 'tick' || v === 'untick') ticks.push({ e: e, done: v === 'tick', it: it });
        else if(v === 'remove'){ if(e.by && host.me && e.by !== host.me && !cmd.okOthers) others.push(e); removes.push({ e: e, it: it }); }
        else prepAdds.push({ e: { kind: 'prep', name: e.name, section: e.section, recipe: e.recipe, id: e.id }, it: it });
      }
    });
    // taking off someone else's prep line asks first (almo-voice-brain.md 4)
    if(others.length){
      var who = uniq(others.map(function(e){ return e.by; }));
      return confirming('again', [joinAnd(who) + ' added ' + joinAnd(others.map(function(e){ return itemSay(e.name); })) + '.'],
        'Take ' + (others.length === 1 ? 'it' : 'them') + ' off the prep list?', { cmd: cmd, flag: 'okOthers' }, 'remove others ' + others.length);
    }
    // more than 5 changes at once asks first (almo-voice-brain.md 8)
    var count = orderChanges.length + prepAdds.length + ticks.length + removes.length;
    if(count > 5 && !cmd.okMany){
      var rb = orderChanges.map(function(c){ return itemSay(c.e.name) + ' to ' + amount(c.after, c.e.unit); })
        .concat(prepAdds.map(function(p){ return itemSay(p.e.name) + ' on prep'; }))
        .concat(ticks.map(function(t){ return itemSay(t.e.name) + (t.done ? ' ticked off' : ' unticked'); }))
        .concat(removes.map(function(r){ return itemSay(r.e.name) + ' off prep'; }));
      return confirming('again', [count + ' changes: ' + joinAnd(rb) + '.'], 'Do all of them?', { cmd: cmd, flag: 'okMany' }, 'many ' + count);
    }

    // orders: straight away, saved on the phone
    orderChanges.forEach(function(c){
      var e = c.e, sup = supSay(e.sname), nm = label(e);
      if(c.v === 'remove' && c.before <= 0){ nothing.push(nm + " isn't on the " + sup + ' order.'); return; }
      if(c.before === c.after){ nothing.push(nm + ' is already ' + amount(c.after, e.unit) + ' on the ' + sup + ' order.'); return; }
      ops.push({ k: 'qty', pid: e.pid, sid: e.sid, name: e.name, unit: e.unit, before: c.before, after: c.after });
      if(c.v === 'set'){
        said.push(nm + ' is now ' + amount(c.after, e.unit) + ' on the ' + sup + ' order' + (c.before > 0 ? ', was ' + fmt(c.before) + '.' : '.'));
        labels.push(nm + ' set to ' + amount(c.after, e.unit) + ' on ' + sup);
      } else if(c.v === 'remove'){
        if(c.after === 0 && c.it.amount != null && c.it.amount > c.before) said.push(nm + ' only had ' + amount(c.before, e.unit) + ", so it's off the " + sup + ' order.');
        else if(c.after === 0) said.push('Took ' + nm + ' off the ' + sup + ' order. It was ' + amount(c.before, e.unit) + '.');
        else said.push('Took ' + amountOf(r2(c.before - c.after), e.unit, nm) + ' off. Now ' + amount(c.after, e.unit) + ' on the ' + sup + ' order.');
        labels.push(c.after === 0 ? 'Took ' + nm + ' off ' + sup : 'Took ' + amountOf(r2(c.before - c.after), e.unit, nm) + ' off ' + sup);
      } else {
        var d1 = r2(c.after - c.before);
        addedNow.push({ words: c.it.words.join(' '), qty: { n: d1, unit: e.unit }, kind: 'order', name: e.name, sid: e.sid, sname: e.sname });
        said.push(c.before > 0
          ? 'Added ' + amountOf(d1, e.unit, nm) + '. Now ' + amount(c.after, e.unit) + ' on the ' + sup + ' order.'
          : 'Added ' + amountOf(d1, e.unit, nm) + ' to the ' + sup + ' order.');
        labels.push('Added ' + amountOf(d1, e.unit, nm) + ' to ' + sup);
      }
      show.push({ text: nm + ' · ' + fmt(c.after) + ' ' + e.unit, tone: c.after > 0 ? 'ok' : 'muted' });
      openView = openView || { view: 'supplier', id: e.sid };
      lastVerb = c.v; done.push({ id: e.id, kind: 'order', name: e.name });
      if(c.it.okBig) noteUsual(e, c.it.amount);
    });
    if(ops.length){
      try{ host.setQty(ops.map(function(o){ return { pid: o.pid, qty: o.after }; })); }
      catch(err){ return ans('error', { say: ["I couldn't save the order."], log: 'save failed' }); }
    }

    // prep: through the shared list, like the Add prep screen; no doubles of an open line
    var onList = {};
    (d.prepLines || []).forEach(function(l){ if(!l.done) onList[clean(l.text)] = true; });
    var toAdd = [], already = [];
    prepAdds.forEach(function(p){
      var text = p.e.name;
      if(onList[clean(text)]){ already.push(itemSay(text)); return; }
      onList[clean(text)] = true;
      toAdd.push({ text: text, section: p.e.kind === 'oneoff' ? 'Anything else' : (p.e.section || 'Other'), recipe: p.e.recipe || '' });
      prepAddedNow.push({ words: p.it.words.join(' '), qty: p.it.qty && !p.it.qty.vague && p.it.qty.n != null ? { n: p.it.qty.n, unit: p.it.qty.unit || '' } : null,
        kind: p.e.kind === 'oneoff' ? 'oneoff' : 'prep', name: text });
    });
    if(toAdd.length){
      var r = await host.addPrep(toAdd);
      if(!r || !r.ok){
        // orders already saved above stay saved; say exactly what happened
        var fail = 'No connection. Nothing was added to the prep list.';
        if(ops.length){ var id0 = remember(labels.length === 1 ? labels[0] : labels.length + ' changes', ops); return ans('done', { say: said.slice(0, 2).concat([fail]), action: { id: id0, label: labels.join('; '), undo: true }, log: 'prep add failed after orders' }); }
        return ans('error', { say: [fail], log: 'prep add failed' });
      }
      ops.push({ k: 'prepAdd', ids: r.ids || [], texts: toAdd.map(function(x){ return x.text; }) });
      addedNow = addedNow.concat(prepAddedNow);
      said.push('Added ' + joinAnd(toAdd.map(function(x){ return itemSay(x.text); })) + ' to the prep list.');
      labels.push('Added ' + joinAnd(toAdd.map(function(x){ return itemSay(x.text); })) + ' to prep');
      toAdd.forEach(function(x, k){ show.push({ text: x.text, tone: 'ok' }); if(r.ids && r.ids[k]) done.push({ id: 'l:' + r.ids[k], kind: 'line', name: x.text }); });
      openView = openView || { view: 'prep' };
      lastVerb = lastVerb || 'add';
      if(prepAdds.some(function(p){ return p.it.qty && !p.it.qty.vague; })) notes.push("Prep lines don't take amounts.");
    }
    if(already.length) nothing.push(joinAnd(already) + (already.length === 1 ? ' is' : ' are') + ' already on the prep list.');

    for(var t = 0; t < ticks.length; t++){
      var tk = ticks[t];
      var ok = await host.tickPrep(tk.e.lineId, tk.done);
      if(!ok){ notes.push('No connection. ' + itemSay(tk.e.name) + " wasn't " + (tk.done ? 'ticked off.' : 'changed.')); continue; }
      ops.push({ k: 'tick', id: tk.e.lineId, done: !tk.done, name: tk.e.name });
      said.push(tk.done ? 'Ticked off ' + itemSay(tk.e.name) + '.' : itemSay(tk.e.name) + ' is back on the list.');
      labels.push((tk.done ? 'Ticked off ' : 'Unticked ') + itemSay(tk.e.name));
      show.push({ text: tk.e.name, tone: tk.done ? 'muted' : 'ok' });
      openView = openView || { view: 'prep' };
      lastVerb = tk.done ? 'tick' : 'untick'; done.push({ id: tk.e.id, kind: 'line', name: tk.e.name });
    }
    for(var m = 0; m < removes.length; m++){
      var rm = removes[m].e;
      var gone = await host.removePrep(rm.lineId);
      if(!gone){ notes.push('No connection. ' + itemSay(rm.name) + ' is still on the prep list.'); continue; }
      ops.push({ k: 'prepRemove', line: { text: rm.name, section: rm.section, recipe: rm.recipe } });
      said.push('Took ' + itemSay(rm.name) + ' off the prep list.');
      labels.push('Took ' + itemSay(rm.name) + ' off prep');
      openView = openView || { view: 'prep' };
      lastVerb = 'remove';
    }

    if(!ops.length){
      var why = nothing.concat(notes);
      if(!why.length) return cant("I couldn't find that on the orders or the prep list.", 'nothing');
      return ans(already.length && why.length === 1 ? 'answer' : 'cant', { say: why, log: 'nothing changed' });
    }
    /* More than three things done: one sentence names them all */
    var talk = said.length > 3 ? ['Done: ' + joinAnd(labels) + '.'] : said;
    talk = talk.concat(nothing).concat(notes);
    var lab = labels.length === 1 ? labels[0] : joinAnd(labels);
    var id = remember(lab, ops);
    // v3.9.3: what each order item went from and to, for "remove all of that"
    var deltas = {};
    ops.forEach(function(o){ if(o.k === 'qty') deltas['p:' + o.pid] = { before: o.before, after: o.after }; });
    ctx = { at: now(), verb: lastVerb || 'add', items: done, deltas: deltas };
    // v3.11.10: only adding (nothing ticked, taken off or set): a correction can move or swap it
    var onlyAdds = addedNow.length && !ticks.length && !removes.length && orderChanges.every(function(c){ return c.v === 'add'; });
    lastDone = onlyAdds ? { id: id, at: now(), items: addedNow } : null;
    lastUndone = null;
    // v3.11.0: what was done, for a list read out ("Done. 5 added to the prep list.")
    cmd.out = { prep: toAdd.length, order: ops.filter(function(o){ return o.k === 'qty'; }).length, extra: nothing.concat(notes) };
    var title = openView && openView.view === 'prep' ? 'Prep list' : orderChanges[0] ? supSay(orderChanges[0].e.sname) + ' order' : 'Done';
    return ans('done', { say: talk, show: { title: title, lines: show.slice(0, 6), open: openView },
      action: { id: id, label: lab, undo: true }, log: ops.map(function(o){ return o.k === 'qty' ? o.name + ' ' + o.before + '>' + o.after : o.k; }).join(', ') });
  }

  async function undoNow(id){
    var l = undoList();
    var u = id ? l.filter(function(x){ return x.id === id; })[0] : l[l.length - 1];
    if(!u) return cant(id ? "That's too old to undo now." : "There's nothing to undo.", 'undo none');
    var said = [], skipped = [], roUndone = false;
    var data = host.data();
    var qtyOps = [];
    for(var i = u.ops.length - 1; i >= 0; i--){
      var o = u.ops[i];
      if(o.k === 'qty'){
        var s = (data.suppliers || []).filter(function(x){ return x.id === o.sid; })[0];
        var p = s && (s.products || []).filter(function(x){ return x.id === o.pid; })[0];
        if(!p){ skipped.push(itemSay(o.name)); continue; }
        if(Math.abs((+p.qty || 0) - o.after) > 0.001){ skipped.push(itemSay(o.name)); continue; }
        qtyOps.push({ pid: o.pid, qty: o.before });
        said.push(itemSay(o.name) + ' is back to ' + amount(o.before, o.unit) + '.');
      }
      else if(o.k === 'prepAdd'){
        for(var j = 0; j < o.ids.length; j++){ await host.removePrep(o.ids[j]); }
        said.push('Took ' + joinAnd(o.texts.map(itemSay)) + ' back off the prep list.');
      }
      else if(o.k === 'tick'){
        await host.tickPrep(o.id, o.done);
        said.push(itemSay(o.name) + (o.done ? ' is ticked off again.' : ' is back on the list.'));
      }
      else if(o.k === 'prepRemove'){
        var r = await host.addPrep([o.line]);
        if(r && r.ok) said.push(itemSay(o.line.text) + ' is back on the prep list.'); else skipped.push(itemSay(o.line.text));
      }
      else if(o.k === 'ts'){   // v3.9.6: only if nothing changed that day since
        var tsh = tsSheet(), tnow = tsh && (tsh.days || {})[o.day];
        if(!tnow || tnow.start !== o.after.start || tnow.end !== o.after.end || !host.setTimesheetDay(o.day, o.before)){ skipped.push(DAY_FULL[o.day] + "'s timesheet"); continue; }
        said.push(DAY_FULL[o.day] + "'s timesheet is back how it was.");
      }
      else if(o.k === 'ro'){   // v3.10.0: through the engine, refused if the day changed since
        var rd = rbData(), dn = Object.keys((o.rec && o.rec.days) || {}).map(function(x){ return DAY_FULL[x]; });
        var ru = rd && RE && rbEditable(rd, o.mon) ? RE.commit(rbWeekOf(rd, o.mon), { op: 'undo', rec: o.rec }, rbCtx(rd), rbSaver(o.mon)) : null;
        if(!ru || !ru.ok){ skipped.push(joinAnd(dn) + "'s roster"); continue; }
        roUndone = true;
        said.push(cap(joinAnd(rbUndoSay(rd, ru.changes))) + '. ' + ru.days.map(function(x){ return DAY_FULL[x] + ' is ' + rbDaySay(rd, ru.week[x]) + '.'; }).join(' '));
      }
      else if(o.k === 'newprep'){   // v3.11.13
        if(host.removePrepItem && host.removePrepItem(o.id)) said.push('Took ' + o.name + ' back off the prep items.'); else skipped.push(o.name);
      }
      else if(o.k === 'newprod'){   // v3.11.13: the product goes, so its amount needn't be put back
        qtyOps = qtyOps.filter(function(q){ return q.pid !== o.pid; });
        said = said.filter(function(x){ return x.indexOf(itemSay(o.name) + ' is back to') !== 0; });
        if(host.removeProduct && host.removeProduct(o.sid, o.pid)) said.push('Took ' + o.name + ' back off the ' + supSay(o.sname) + ' products.'); else skipped.push(o.name);
      }
      else if(o.k === 'restore'){
        var s2 = (data.suppliers || []).filter(function(x){ return x.id === o.sid; })[0];
        if(!s2){ skipped.push(o.sname); continue; }
        (s2.products || []).forEach(function(p2){ qtyOps.push({ pid: p2.id, qty: +o.before[p2.id] || 0 }); });
        said.push('The ' + supSay(o.sname) + ' order is back how it was.');
      }
    }
    if(qtyOps.length) host.setQty(qtyOps);
    put(UNDO_KEY, undoList().filter(function(x){ return x.id !== u.id; }));
    if(skipped.length) said.push(joinAnd(skipped) + ' changed since, so I left ' + (skipped.length === 1 ? 'it' : 'them') + '.');
    if(!said.length) return cant("I couldn't undo that.", 'undo failed');
    ctx = null;
    // v3.11.10: the add just taken back can be put back ("actually put that back"); a fix (fixLast) clears it again
    lastUndone = lastDone && lastDone.id === u.id && !skipped.length ? { items: lastDone.items, at: now() } : null;
    lastDone = null;
    // v3.10.0: in the middle of the roster, its question again
    var rs = roUndone ? rbSession() : null, rdd = roUndone ? rbData() : null;
    if(rs && rbLive(rs, rdd)) return rbReask(rs, said.slice(0, 2), 'undo ' + u.label);
    if(roUndone) rbOther = false;
    return ans('done', { say: said.slice(0, 3), more: said.slice(3), action: { id: 'undo-' + u.id, label: 'Undid: ' + u.label, undo: false }, log: 'undo ' + u.label });
  }

  /* ---------- whole-list jobs: read, clear, send, repeat, open ---------- */
  function pickSupplier(cmd, cat, kind, filter){
    if(cmd.sids.length === 1) return supplier(cat, cmd.sids[0]);
    var list = cat.suppliers.filter(filter || function(){ return true; });
    if(cmd.sids.length > 1) list = list.filter(function(s){ return cmd.sids.indexOf(s.id) > -1; });
    if(list.length === 1 && kind !== 'repeat') return list[0];
    if(!list.length) return null;
    return asking('supplier', 'Which order: ' + joinOr(list.slice(0, 4).map(function(s){ return supSay(s.name); })) + '?',
      list.slice(0, 4).map(function(s){ return { label: supSay(s.name), value: s.id }; }), { cmd: cmd, job: kind });
  }

  /* ---------- corrections (v3.11.10) ----------
     His test through Pluto (15 Oct): "add a kilo of lemon to the list" went
     on the prep list, and "no, I meant the ordering list" wasn't understood.
     Right after something was added (2 minutes), "no, I meant the order" /
     "the prep list" / "from Aziz" / "parsley" takes it back and adds it again
     with that one thing changed, and says both. "No, I meant 5" (the amount)
     was already a correction ("make it 5"), so a bare number is left to it.
     "Put it back" after an undo adds it again, by the names it found. */
  // only a short sentence that starts as a correction (replaying 10 Oct: "…what I meant…" mid-chatter undid an add)
  var FIX_WORDS = /^(?:[a-z']+\s+){0,2}(?:no|nope|nah|sorry|oops|actually|wait|wrong|not that|not the|i meant|i mean|meant|i said)\b/;   // within the first three words
  var FIX_MAX_WORDS = 10;
  var REDO = /^(?:(?:actually|no|oh|wait|ok|okay|please|sorry)\s+)*(?:(?:can|could) you\s+)?(?:put (?:it|that|them|those) (?:back|on again)(?: on| again)*(?: on (?:the )?(?:list|order|prep list))?|redo(?: that| it)?|do (?:it|that) again|add (?:it|that|them|those) (?:back|again)(?: again)?|bring (?:it|that|them|those) back)(?: please| thanks| again)*$/;
  function qtyOf(q){ return q && q.n != null ? { n: q.n, unit: q.unit || null, vague: false } : null; }
  async function addAgain(list, target, req, mode, cat){
    // one sentence per target, the names as found (so nothing is asked twice); amounts as they were
    var words = list.map(function(x){ return x.words; });
    var cm = parse('add ' + words.join(' and ') + ' to the ' + target, cat);
    if(cm.items.length !== list.length) return null;
    cm.items.forEach(function(it, k){ it.qty = qtyOf(list[k].qty); if(list[k].kind === 'oneoff' && /prep list$/.test(target)) it.oneoff = true; });
    cm.followUp = true; cm.fromFix = true;
    return await run(cm, req, mode);
  }
  function targetOf(x){ return x.kind === 'order' ? supSay(x.sname) + ' order' : 'prep list'; }
  async function fixLast(text, req, mode){
    if(!lastDone || now() - lastDone.at > CTX_MS) return null;
    var c = clean(text);
    if(!FIX_WORDS.test(c) || c.split(' ').length > FIX_MAX_WORDS) return null;
    var f = await fresh(), cm = parse(text, f.cat), items = lastDone.items;
    var sids = cm.sids || [];
    var toOrder = sids.length > 0 || /\b(order|orders|ordering|supplier)\b/.test(c);
    var toPrep = !toOrder && /\bprep\b/.test(c);
    var named = cm.items.filter(function(it){ return it.words.length; });
    var same = function(n){ var w = clean(n.words.join(' ')); return items.some(function(x){ return w === clean(x.words) || w === clean(x.name); }); };
    var list, target;
    // a different thing named ("actually add lemons to the order" after the salad dressing) is a new request, not a correction
    if((toOrder || toPrep) && named.length && !named.every(same)) return null;
    if(toOrder || toPrep){
      target = toPrep ? 'prep list' : sids.length === 1 ? supSay((supplier(f.cat, sids[0]) || {}).name || '') + ' order' : 'order';
      // already there (same list, same supplier, or any order when none was named): not a correction
      if(items.every(function(x){ return toPrep ? x.kind !== 'order' : x.kind === 'order' && (!sids.length || x.sid === sids[0]); })) return null;
      list = items.map(function(x){ return { words: x.words, qty: x.qty, kind: toPrep ? 'oneoff' : 'order' }; });
    } else if(named.length && items.length === 1 && (!cm.verb || cm.verb === 'set') && /\b(?:meant|mean|not|no|nope|nah|wrong|i said)\b/.test(c)){
      // the item was wrong: "no, I meant parsley", "not lemon, lime" (the last name said); "actually add lemons" adds, as before
      var w = named[named.length - 1].words.join(' ');
      if(clean(w) === clean(items[0].words) || clean(w) === clean(items[0].name)) return null;
      // nothing is taken back unless the new name is really one of his (not just "sounds like")
      var wk = findItems(named[named.length - 1], f.cat, items[0].kind === 'order' ? ['order'] : ['prep', 'order']);
      if(!wk.list.length || wk.how === 'fuzzy') return null;
      list = [{ words: w, qty: items[0].qty, kind: items[0].kind === 'order' ? 'order' : 'prep' }];
      target = items[0].kind === 'order' ? 'order' : 'prep list';
    } else return null;
    var fixed = lastDone;
    var u = await undoNow(fixed.id);
    lastUndone = null;
    if(u.status !== 'done') return u;
    var a = await addAgain(list, target, req, mode, f.cat);
    if(!a) return ans('done', { say: u.say.concat(['Say what to add, and where.']), log: 'fix: undone, then not understood' });
    a.say = u.say.concat(a.say || []);
    a.log = 'fix ' + (toOrder ? 'to order' : toPrep ? 'to prep' : 'item') + ' | ' + (a.log || '');
    return a;
  }
  async function redoLast(text, req, mode){
    if(!lastUndone || now() - lastUndone.at > CTX_MS || !REDO.test(clean(text))) return null;
    var back = lastUndone, f = await fresh(), say = [], last = null;
    lastUndone = null;
    var byTarget = {};
    back.items.forEach(function(x){ var t = targetOf(x); (byTarget[t] = byTarget[t] || []).push({ words: x.name, qty: x.qty, kind: x.kind }); });
    for(var t in byTarget){
      var a = await addAgain(byTarget[t], t, req, mode, f.cat);
      if(!a) continue;
      if(a.status !== 'done') return a;
      say = say.concat(a.say || []); last = a;
    }
    if(!last) return ans('answer', { say: ["I couldn't put it back. Say what to add."], log: 'redo failed' });
    last.say = say; last.log = 'redo | ' + (last.log || '');
    return last;
  }

  async function run(cmd, req, mode){
    var f = await fresh(), cat = f.cat, d = f.data;
    cmd.followUp = cmd.followUp || !!(req && req.followUp);   // v3.11.10: see resolve()'s "no cue"
    // v3.11.10: after "Go ahead." (add the following …), the names said next go on that list
    if(goAhead && now() - goAhead.at < CTX_MS && mode === 'pluto' && cmd.items.length && (!cmd.verb || cmd.verb === 'add') && !cmd.list && !cmd.sids.length){
      cmd.verb = 'add'; cmd.list = goAhead.list; cmd.sids = goAhead.sids.slice(); goAhead.at = now();
    }
    var hasCue = !!(cmd.list || cmd.sids.length || cmd.fromAsk || cmd.items.some(function(it){ return it.exact && it.exact.length; }));
    /* v3.11.8 (Pluto's router exam): "order more basil" is the kitchen's, said
       as a verb; but with "order" the only kitchen word, a name that's only
       part of an item's ("order a pizza") asks "Did you mean …?" first */
    cmd.verbCue = !hasCue && mode === 'pluto' && !!ORDER_VERBS[cmd.verbWords];
    if(cmd.verbCue) hasCue = true;
    var live = ctx && now() - ctx.at < CTX_MS;

    if(cmd.empty) return mode === 'pluto' ? notmine('empty') : cant("I didn't catch that.", 'empty');
    // questions that aren't about the lists belong to someone else
    if(cmd.question && ['read', 'help', 'last'].indexOf(cmd.verb) < 0) return mode === 'pluto' ? notmine('question') : cant('I can only help with orders, the prep list, your timesheet and the roster.', 'question');
    if(cmd.verb === 'help'){
      if(mode === 'pluto') return notmine('help');
      return ans('answer', { say: [HELP_SAY, HELP_TRY], log: 'help' });   // v3.9.13: the timesheet and the roster too
    }
    if(cmd.verb === 'last'){
      var lu = undoList();
      if(!lu.length) return ans('answer', { say: ["I haven't changed anything in the last 10 minutes."], log: 'last none' });
      return ans('answer', { say: [lu[lu.length - 1].label + '.'], log: 'last' });
    }
    if(cmd.verb === 'undo') return await undoNow(null);

    /* "make it 3", "take it off", "add another 2", "add another". v3.9.3: a
       bare "and add" (cut off as he carried on) no longer adds the last item
       again (his log, 10 Oct: "and add" → +1 kilo of pork mince); it needs
       "it", a number, or "another"/"more". */
    /* v3.11.9 (his test, 14 Oct): "actually clear that" right after a change
       means that item, not the whole order (he then said "remove the mozzarella") */
    if(cmd.verb === 'clear' && cmd.refs && !cmd.items.length && !cmd.sids.length && !cmd.list && !cmd.tickWords && live && ctx.items.length) cmd.verb = 'remove';
    if(!cmd.items.length && live && ctx.items.length && (cmd.refs || cmd.looseQty || cmd.moreWord) && ['add', 'set', 'remove', 'tick', 'untick', null].indexOf(cmd.verb) > -1){
      var lq = cmd.looseQty;
      var v0 = cmd.verb || (lq ? 'set' : ctx.verb);
      // with a number, it means the last thing named (add 2 mozz and a box of pepperoni, then add another 2)
      var refItems = lq && ctx.items.length > 1 ? ctx.items.slice(-1) : ctx.items;
      cmd.items = refItems.map(function(x){ return { words: [itemSay(x.name)], stems: keyOf(x.name).split(' '), pick: x.id, qty: refItems.length === 1 ? lq : null, verb: v0, verbWords: cmd.verbWords, list: null, sids: [] }; });
      cmd.looseQty = null; cmd.verb = v0; hasCue = true;
      /* v3.9.3: "actually remove all of that" right after adding 20 to 2 took
         all 22 off (his log). Ask: all of it, or just what was added. */
      var dl = refItems.length === 1 && ctx.deltas ? ctx.deltas[refItems[0].id] : null;
      if(v0 === 'remove' && !lq && ctx.verb === 'add' && dl && dl.before > 0){
        var ex = entryById(cat, refItems[0].id);
        if(ex && Math.abs((+ex.qty || 0) - dl.after) < 0.001){
          var added = r2(dl.after - dl.before);
          return asking('offhow', 'Take off all ' + amountOf(ex.qty, ex.unit, label(ex)) + ', or just the ' + fmt(added) + ' you added?',
            [{ label: 'All ' + fmt(ex.qty), value: 'all' }, { label: 'Just the ' + fmt(added), value: 'added' }], { cmd: cmd, item: 0, added: added });
        }
      }
    }
    if(!cmd.verb && cmd.and && live && cmd.items.length){
      cmd.verb = ctx.verb;
      cmd.items.forEach(function(it){ if(!it.verb) it.verb = ctx.verb; });
    }

    var v = cmd.verb;
    if(v === 'read'){
      if(cmd.items.length){
        var it0 = cmd.items[0];
        it0.verb = 'read';
        var stop = resolve({ verb: 'read', list: cmd.list, sids: cmd.sids, items: [it0], verbWords: '' }, cat, mode, hasCue);
        if(stop) return stop;
        if(it0.missing){
          /* v3.11.16 (his test, 17 Oct: "what's on my trip list we gotta fix this
             one"): the list asked for first, then talk that names nothing: read the list */
          if(READ_LIST_FIRST.test(clean(cmd.text || ''))){
            if(cmd.list === 'prep') return readPrep(cat, d);
            if(cmd.sids.length === 1) return readOrder(supplier(cat, cmd.sids[0]));
          }
          return mode === 'pluto' ? notmine('read missing') : cant("I couldn't find " + it0.words.join(' ') + '.', 'read missing');
        }
        var e = it0.e;
        if(e.kind === 'order') return ans('answer', { say: [e.qty > 0 ? label(e) + ': ' + amount(e.qty, e.unit) + ' on the ' + supSay(e.sname) + ' order.' : 'No ' + label(e) + ' on the ' + supSay(e.sname) + ' order yet.'], log: 'read item' });
        if(e.kind === 'line') return ans('answer', { say: [itemSay(e.name) + (e.done ? ' is done.' : ' is on the prep list, not done yet.')], log: 'read line' });
        if(prepBlind) return cant(PREP_BLIND, 'read prep item unknown');
        return ans('answer', { say: [itemSay(e.name) + " isn't on the prep list."], log: 'read prep item' });
      }
      if(cmd.list === 'prep' || cmd.list === 'list') return readPrep(cat, d);
      if(cmd.sids.length === 1) return readOrder(supplier(cat, cmd.sids[0]));
      if(cmd.list === 'order' || mode !== 'pluto') return readAll(cat);
      return notmine('read no cue');
    }
    if(v === 'clear'){
      if(mode === 'pluto' && !hasCue) return notmine('clear no cue');
      if(cmd.tickWords){
        var doneLines = (d.prepLines || []).filter(function(l){ return l.done; });
        if(!doneLines.length) return cant(prepBlind ? PREP_BLIND : 'Nothing on the prep list is ticked off.', prepBlind ? 'clear done unknown' : 'clear done 0');
        return confirming('clearDone', ['Clear ' + doneLines.length + ' finished ' + (doneLines.length === 1 ? 'line' : 'lines') + ' off the prep list, for everyone.'],
          doneLines.length === 1 ? 'Clear it?' : 'Clear them?', { ids: doneLines.map(function(l){ return l.id; }) }, 'clear done ' + doneLines.length);
      }
      if(cmd.list === 'prep' || cmd.list === 'list') return cant("I can only clear the finished prep lines. Say 'clear the done ones'.", 'clear prep');
      var sc = pickSupplier(cmd, cat, 'clear', function(s){ return onOrder(s).length > 0; });
      if(!sc) return cant(cmd.sids.length ? 'That order is already empty.' : 'Every order is already empty.', 'clear empty');
      if(sc.status) return sc;
      var items = onOrder(sc);
      if(!items.length) return cant('The ' + supSay(sc.name) + ' order is already empty.', 'clear empty');
      return confirming('clear', ['Clear the ' + supSay(sc.name) + ' order: ' + joinAnd(items.map(lineOf)) + '.'],
        'Clear ' + (items.length === 1 ? 'it' : 'all ' + items.length) + '?', { sid: sc.id }, 'clear ' + supSay(sc.name) + ' ' + items.length);
    }
    if(v === 'send'){
      if(mode === 'pluto' && !hasCue) return notmine('send no cue');
      var ss = pickSupplier(cmd, cat, 'send', function(s){ return onOrder(s).length > 0; });
      if(!ss) return cant(cmd.sids.length ? 'That order is empty.' : "There's nothing on any order yet.", 'send empty');
      if(ss.status) return ss;
      var lines = onOrder(ss);
      if(!lines.length) return cant('The ' + supSay(ss.name) + ' order is empty.', 'send empty');
      var rb = [supSay(ss.name) + ' order for tomorrow: ' + joinAnd(lines.map(lineOf)) + '.'];
      var sent = host.sentToday ? host.sentToday(ss.id) : null;
      if(sent) rb.push(supSay(ss.name) + ' was already sent an order today.');
      return confirming('send', rb, 'Open it ready to send?', { sid: ss.id }, 'send supplier=' + supSay(ss.name) + ' lines=' + lines.length);
    }
    if(v === 'repeat'){
      if(mode === 'pluto' && !hasCue) return notmine('repeat no cue');
      var sr = pickSupplier(cmd, cat, 'repeat', function(s){ var lo = host.lastOrder ? host.lastOrder(s.id) : null; return lo && Object.keys(lo).length > 0; });
      if(!sr) return cant(cmd.sids.length ? "There's no saved order for " + supSay((supplier(cat, cmd.sids[0]) || {}).name) + ' yet.' : 'There are no saved orders yet.', 'repeat none');
      if(sr.status) return sr;
      var lo2 = host.lastOrder ? host.lastOrder(sr.id) || {} : {};
      var back = (sr.products || []).filter(function(p){ return +lo2[p.id] > 0; });
      if(!back.length) return cant("There's no saved order for " + supSay(sr.name) + ' yet.', 'repeat none');
      var nowOn = onOrder(sr).length;
      return confirming('repeat', ['Load the last ' + supSay(sr.name) + ' order: ' + joinAnd(back.map(function(p){ return amount(+lo2[p.id], p.unit) + ' ' + itemSay(p.name); })) + '.']
        .concat(nowOn ? ['It replaces the ' + nowOn + (nowOn === 1 ? ' item' : ' items') + ' there now.'] : []), 'Load it?', { sid: sr.id }, 'repeat ' + supSay(sr.name));
    }
    if(v === 'open'){
      if(mode === 'pluto' && !hasCue) return notmine('open no cue');
      var view = null, said = '';
      if(cmd.sids.length === 1){ var so = supplier(cat, cmd.sids[0]); view = { view: 'supplier', id: so.id }; said = 'Here’s the ' + supSay(so.name) + ' order.'; }
      else if(cmd.list === 'prep' || cmd.list === 'list'){ view = { view: 'prep' }; said = 'Here’s the prep list.'; }
      else if(cmd.items.length){
        cmd.items[0].verb = 'open';
        var st = resolve({ verb: 'open', list: cmd.list, sids: [], items: [cmd.items[0]], verbWords: '' }, cat, mode, hasCue);
        if(st) return st;
        var eo = cmd.items[0].e;
        if(eo && eo.kind === 'order'){ view = { view: 'supplier', id: eo.sid }; said = label(eo) + ' is on the ' + supSay(eo.sname) + ' order.'; }
        else if(eo){ view = { view: 'prep' }; said = 'Here’s the prep list.'; }
      }
      else if(cmd.list === 'order'){ view = { view: 'list' }; said = 'Here are the suppliers.'; }
      if(!view) return cant('Open what? Say a supplier, or the prep list.', 'open what');
      if(host.open) host.open(view);
      return ans('answer', { say: [said], show: { title: said.replace(/^Here’s the |^Here are the /, '').replace(/\.$/, ''), lines: [], open: view, go: true }, log: 'open ' + view.view });
    }

    // add, set, remove, tick, untick, or no verb at all
    if(!cmd.items.length){
      if(!v && cmd.sids.length === 1) return readOrder(supplier(cat, cmd.sids[0]));
      if(!v && (cmd.list === 'prep' || cmd.list === 'list')) return readPrep(cat, d);
      /* v3.11.10 (his test through Pluto, 15 Oct: "can you add the following items
         to the order" got "I can't do that yet"): "Go ahead.", and the names he
         says next (2 minutes) go on that list, each added as he says it */
      if(mode === 'pluto' && v === 'add' && isFollowing(cmd.text) && (cmd.list || cmd.sids.length || ORDER_VERBS[cmd.verbWords])){
        goAhead = { list: cmd.list === 'prep' || cmd.list === 'list' ? 'prep' : 'order', sids: cmd.sids.slice(), at: now() };
        return ans('answer', { say: ['Go ahead.'], keep: true, log: 'go ahead ' + goAhead.list });
      }
      if(mode === 'pluto') return notmine('no items');
      if(cmd.refs || cmd.looseQty) return cant('Say what it is, like “make the mozzarella 3”.', 'no context');
      return cant(v === 'remove' ? 'Take off what?' : v === 'tick' || v === 'untick' ? 'Which prep item?' : v ? 'Add what?' : "I didn't catch that.", 'no items');
    }
    /* v3.9.3: just a name, no verb or amount, in the listening window after
       an answer (his log: "pepperoni" added a box; maybe the mic caught the
       end of its own answer) asks first. A name on its own when he starts
       talking still adds, as before. */
    var bare = !v && req && req.followUp && !cmd.fromAsk && cmd.items.length === 1 && !cmd.items[0].qty && !cmd.looseQty && !cmd.refs;
    if(!v) cmd.verb = 'add';
    cmd.items.forEach(function(it){
      if(!it.verb) it.verb = cmd.verb;
      // "make pesto" (no number) is prep
      if(it.verb === 'set' && /^make/.test(it.verbWords || '') && !it.qty && !cmd.looseQty && it.qtyFix == null){ it.verb = 'add'; it.makePrep = true; }
    });
    var q = resolve(cmd, cat, mode, hasCue);
    if(q) return q;
    if(mode === 'pluto' && !hasCue && cmd.items.every(function(it){ return it.missing; })) return notmine('nothing found');
    if(cmd.items.every(function(it){ return it.missing; })){
      var skips = cmd.items.filter(function(it){ return it.skip; }).map(function(it){ return it.skip; });
      if(skips.length) return cant(skips.join(' '), 'all skipped');
      var names = cmd.items.map(function(it){ return it.words.join(' '); });
      return cant("I couldn't find " + joinOr(names) + ' on the orders or the prep list.', 'missing');
    }
    if(bare && cmd.items[0].e){
      var eb = cmd.items[0].e, ub = unitSay(eb.unit)[0];
      var yn = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
      if(eb.kind === 'order') return asking('bare', 'Add ' + (+eb.qty > 0 ? 'another ' : ub ? 'a ' : '') + (ub ? ub + ' of ' : '') + label(eb) + '?', yn, { cmd: cmd, item: 0 });
      if(eb.kind === 'prep') return asking('bare', 'Put ' + label(eb) + ' on the prep list?', yn, { cmd: cmd, item: 0 });
    }
    /* v3.11.16 (his test, 17 Oct, 1 am): asked first, a yes does as asked.
       Right after ticking, "take off" may be Google's "tick off" (he said
       "tick off the barbecue sauce", heard "take off": it left the list); and
       "move X" with nowhere to move it to (Google's "remove", above) */
    if(!cmd.fromAsk && cmd.verb === 'remove'){
      var gone = cmd.items.filter(function(it){ return it.e && !it.missing; }), lns = gone.filter(function(it){ return it.e.kind === 'line'; });
      var nm = joinAnd(gone.map(function(it){ return itemSay(it.e.name); }));
      /* v3.11.17 (his check, 17 Oct: "can you take off parsley" took it off, with
         "tick off parsley" among Google's other guesses): Google unsure asks too */
      var tickAlt = (req && req.alts || []).some(function(x){ return /\btick(?:ed)?\b/.test(clean(typeof x === 'string' ? x : (x && x.s) || '')); });
      if((live && ctx.verb === 'tick' || tickAlt) && /^take\b/.test(cmd.verbWords || '') && gone.length && lns.length === gone.length && lns.every(function(it){ return !it.e.done; })){
        return asking('tickortake', 'Tick off ' + nm + ', or take ' + (gone.length === 1 ? 'it' : 'them') + ' off the prep list?',
          [{ label: 'Tick off', value: 'tick' }, { label: 'Take off', value: 'remove' }, { label: 'No', value: 'no' }], { cmd: cmd, item: 0 });
      }
      if(cmd.askRemove && gone.length){
        var sn = gone.map(function(it){ return it.e.kind === 'order' ? it.e.sname : ''; }).filter(function(x, k, all){ return all.indexOf(x) === k; });
        var where = lns.length === gone.length ? 'the prep list' : sn.length === 1 && sn[0] ? 'the ' + supSay(sn[0]) + ' order' : 'the lists';
        return asking('moveoff', 'Take ' + nm + ' off ' + where + '?', [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], { cmd: cmd, item: 0 });
      }
    }
    var a = amounts(cmd);
    if(a) return a;
    return await change(cmd, cat, d);
  }

  /* ---------- "add the following …": reading out a list (v3.11.0) ----------
     His request (12 Oct): "add the following to the list", then he reads the
     items out over several sentences, and it reads them back. His picks:
     - after each part a short "Got it."; anything it didn't catch is said
       straight away ("Say it again, or carry on");
     - "that's it" (or "no", "done", "read it back") reads back every name,
       and nothing is added before a plain yes;
     - going quiet keeps the list on the card: tap the mic and carry on;
     - the prep list and orders; an order item said without an amount is
       asked about before the read-back.
     The card's Cancel button has the value 'no', so the page passes a spoken
     "no" here (meaning "no more") instead of cancelling the list itself.
     After the yes, the list goes through run() like any spoken add, so
     doubles, Undo and the card work as they always have. */
  var DICT_MS = 10 * 60 * 1000;   // a list nobody added to for 10 minutes is dropped
  var dict = null;
  var DICT_DONE = /^(no|nope|nah|no more|nothing else|nothing more|done|im done|all done|finished|stop|stop there|thats it|thats all|that is it|that is all|thats everything|thats the lot|thats the list|end of list|end of the list|read it back|read them back|read back|read it out|read the list back|no thats it|no thats all|yes thats it|yeah thats it|thank you|thanks|cheers)( (thanks|thank you|pluto|mate|please|for now))?$/;
  var DICT_CANCEL = /^(cancel|cancel it|cancel that|cancel the list|never mind|nevermind|forget it|forget that|forget the list|scrap it|scrap that|scrap the list|leave it)( (thanks|please|pluto))?$/;
  var DICT_OPTS = [{ label: "That's it", value: 'done' }, { label: 'Cancel', value: 'no' }];
  function isFollowing(text){ return /\b(the following|following|these things)\b/.test(clean(text)); }
  function dictName(){ return dict.list === 'prep' ? 'prep list' : dict.sids.length === 1 ? 'order' : 'orders'; }
  function dictShow(){
    var lines = dict.items.map(function(x){
      return { text: itemSay(x.name) + (dict.list === 'order' ? ' · ' + (x.amount == null ? 'how many?' : fmt(x.amount) + ' ' + x.unit) : ''), tone: x.amount == null && dict.list === 'order' ? 'note' : 'ok' };
    });
    return { title: (dict.list === 'prep' ? 'Prep list' : 'Order') + ' so far (' + lines.length + ')', lines: lines.slice(-6), reading: true,
             hint: "Tap the mic to carry on, or tap That's it." };
  }
  function dictAsked(say, log){
    var a = asking('dict', say, DICT_OPTS, {}, 'items');
    a.show = dictShow(); a.log = 'dict ' + (log || 'part'); return a;
  }
  /* The amount said for an order item, in its own unit; null when there is
     none or it can't be converted (asked before the read-back). */
  function dictAmount(q, e){
    if(!q || q.vague) return null;
    var cv = convert(q.n, q.unit, canonUnit(e.unit));
    return cv == null || cv <= 0 ? null : Math.round(cv * 1000) / 1000;
  }
  /* One part he said: what it caught, and what it didn't. */
  function dictTake(cm, cat){
    var kinds = dict.list === 'prep' ? ['prep'] : ['order'], took = 0, problems = [], elsewhere = [];
    dict.offer = null;
    cm.items.forEach(function(it){
      var shown = it.words.join(' ');
      var f = findItems(it, cat, kinds), list = dedupe(f.list.slice(0, f.top || f.list.length));
      if(dict.list === 'order' && dict.sids.length === 1){
        var mine = list.filter(function(e){ return e.sid === dict.sids[0]; });
        if(mine.length) list = mine;
      }
      var e = f.how !== 'fuzzy' && f.how !== 'none' && list.length === 1 ? list[0] : null;
      if(!e && f.how !== 'fuzzy' && list.length > 1 && list.every(function(x){ return clean(x.name) === clean(list[0].name); })){
        problems.push('"' + shown + '" is on more than one order: ' + joinOr(list.slice(0, 3).map(function(x){ return supSay(x.sname); })) + '.');
        dict.left.push(shown); return;
      }
      if(!e && f.how !== 'fuzzy' && list.length > 1){
        problems.push('"' + shown + '" could be ' + joinOr(list.slice(0, 3).map(label)) + '.');
        dict.left.push(shown); return;
      }
      /* v3.11.1 (his log, 13 Oct): Aziz products read into the prep list ("speck",
         "pork mince") got "I didn't catch" or a wrong guess (Pork Ragu). Named on
         the other list, it says where it is instead, and adds nothing. */
      if(!e){
        var of = findItems(it, cat, dict.list === 'prep' ? ['order'] : ['prep']), ol = dedupe(of.list.slice(0, of.top || of.list.length));
        if(of.how !== 'fuzzy' && of.how !== 'none' && ol.length && ol.every(function(x){ return clean(x.name) === clean(ol[0].name); })){
          elsewhere.push({ name: label(ol[0]), from: dict.list === 'prep' ? joinOr(uniq(ol.map(function(x){ return supSay(x.sname); }))) : '' });
          dict.left.push(shown); return;
        }
      }
      if(!e){
        // sounds like one thing: a yes takes it; like a few: he says which
        var guess = f.how === 'fuzzy' ? dedupe(f.list).slice(0, 3) : [];
        if(guess.length === 1) dict.offer = guess[0];
        problems.push('I didn\'t catch "' + shown + '".' + (guess.length ? ' Did you mean ' + joinOr(guess.map(label)) + '?' : ''));
        dict.left.push(shown); return;
      }
      dictPut(e, dict.list === 'order' ? dictAmount(it.qty, e) : null);
      took++;
    });
    return { took: took, problems: problems, elsewhere: elsewhere };
  }
  function dictPut(e, amount){
    var had = dict.items.filter(function(x){ return x.id === e.id; })[0];
    if(had){ if(amount != null) had.amount = amount; return; }
    dict.items.push({ id: e.id, name: e.name, kind: e.kind, sid: e.sid || '', sname: e.sname || '', unit: e.unit || '', amount: amount });
  }
  function dictPartSay(r){
    var ps = r.problems.slice(), el = r.elsewhere || [];
    if(!ps.length && !el.length) return 'Got it.';
    // v3.11.1: the ones on the other list, together, by where they come from
    uniq(el.map(function(x){ return x.from; })).forEach(function(from){
      var ns = el.filter(function(x){ return x.from === from; }).map(function(x){ return x.name; }), many = ns.length > 1;
      ps.push(dict.list === 'prep' ? joinAnd(ns) + (many ? ' come from ' : ' comes from ') + from + (many ? ", they aren't on the prep list." : ", it isn't on the prep list.")
                                   : joinAnd(ns) + (many ? " are prep items, they aren't on an order." : " is a prep item, it isn't on an order."));
    });
    var p = ps.join(' '), more = !r.problems.length ? " Carry on, or say that's it."
      : r.problems.length > 1 || dict.offer ? (dict.offer ? ' Say yes, say it again, or carry on.' : ' Say them again, or carry on.') : ' Say it again, or carry on.';
    return (r.took ? 'Got it, but ' + p : p) + more;
  }

  async function dictStart(c1, cat){
    dict = { list: c1.list === 'prep' ? 'prep' : (c1.list === 'order' || (c1.sids || []).length || ORDER_VERBS[c1.verbWords]) ? 'order' : null,
             sids: (c1.sids || []).slice(), items: [], left: [], offer: null, at: now(), first: null };
    if(!dict.list){
      dict.first = c1.items.length ? c1 : null;
      var a = asking('dictlist', 'Prep list or an order?', [{ label: 'Prep list', value: 'prep' }, { label: 'An order', value: 'order' }, { label: 'Cancel', value: 'no' }], {});
      a.log = 'dict which list'; return a;
    }
    if(!c1.items.length) return dictAsked('Go ahead.', 'start ' + dict.list);
    return dictAsked(dictPartSay(dictTake(c1, cat)), 'start ' + dict.list + ' with items');
  }

  async function dictAnswer(p, req, mode){
    var choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null;
    var text = String(req.text || ''), c = clean(text);
    pending = null;
    if(!dict || now() - dict.at > DICT_MS){
      dict = null;
      if(choice != null || !text) return cant('That list timed out, so nothing was added.', 'dict expired');
      return await handle({ v: 1, id: req.id, text: text, alts: req.alts || [], followUp: false, reply: null, mode: mode });
    }
    dict.at = now();
    // the card's Cancel, or a cancel word, drops the whole list (a spoken "no" means "no more")
    if(choice === 'no' || (choice == null && (DICT_CANCEL.test(c) || (p.kind === 'dictlist' && yesNo(text) === 'no')))){
      dict = null;
      return ans('answer', { say: ['Okay. Nothing added.'], log: 'dict cancelled' });
    }
    var cat = (await fresh()).cat;
    if(p.kind === 'dictlist'){
      var cm0 = parse(text, cat);
      var lk = choice || (cm0.list === 'prep' || cm0.list === 'order' ? cm0.list : (cm0.sids || []).length ? 'order' : null);
      if(!lk){
        if(p.again){ dict = null; return ans('answer', { say: ['Okay. Nothing added.'], log: 'dict list dropped' }); }
        var a2 = asking('dictlist', 'Sorry, the prep list or an order?', p.options, { again: true }); a2.log = 'dict which list again'; return a2;
      }
      dict.list = lk;
      if((cm0.sids || []).length) dict.sids = cm0.sids.slice();
      var first = dict.first; dict.first = null;
      if(first && first.items.length) return dictAsked(dictPartSay(dictTake(first, cat)), 'list ' + lk + ' with items');
      return dictAsked('Go ahead.', 'list ' + lk);
    }
    if(p.kind === 'dictqty'){
      var x = dict.items[p.idx];
      if(choice === 'skip' || (choice == null && /^(skip|skip it|none|no|nope|leave it out|leave that out|take it out)$/.test(c))){
        if(x) dict.items.splice(p.idx, 1);
        return dictFinish(x ? 'Left ' + itemSay(x.name) + ' out.' : '');
      }
      var aq = choice == null ? firstQty(text) : null, ns = numbersIn(choice != null ? choice : text), n = null;
      if(x && aq && aq.unit){ n = dictAmount(aq, x); }
      else if(ns.length && ns[0] > 0) n = ns[0];
      if(x && n != null) x.amount = n;
      if(x && x.amount == null && !p.again){
        var us = unitSay(x.unit)[1];
        var a3 = asking('dictqty', 'Sorry, how many ' + (us ? us + ' of ' : '') + itemSay(x.name) + '? Or say skip.', p.options, { idx: p.idx, again: true }, 'number');
        a3.show = dictShow(); a3.log = 'dict amount again'; return a3;
      }
      if(x && x.amount == null) dict.items.splice(p.idx, 1);
      return dictFinish(x && x.amount == null ? 'Left ' + itemSay(x.name) + ' out.' : '');
    }
    // p.kind === 'dict': another part of the list
    if(choice === 'done' || (choice == null && DICT_DONE.test(c))) return dictFinish('');
    if(choice == null && yesNo(text) === 'yes'){
      if(dict.offer){ dictPut(dict.offer, null); dict.offer = null; return dictAsked('Got it.', 'offer taken'); }
      return dictAsked("Say the next one, or say that's it.", 'yes to nothing');
    }
    var cm = parse(text, cat);
    if(cm.question || (cm.verb && cm.verb !== 'add' && cm.verb !== 'set')){
      return dictAsked("You're still reading out the " + dictName() + ". Say that's it to hear it back, or cancel.", 'other while reading');
    }
    // "3 kilos" on its own: the last order item's amount
    if(!cm.items.length && cm.looseQty && dict.list === 'order' && dict.items.length){
      var lx = dict.items[dict.items.length - 1], la = dictAmount(cm.looseQty, lx);
      if(la != null){ lx.amount = la; return dictAsked('Got it.', 'amount for the last one'); }
    }
    if(!cm.items.length) return dictAsked("I didn't catch that. Say it again, or say that's it.", 'nothing caught');
    return dictAsked(dictPartSay(dictTake(cm, cat)), 'part');
  }

  /* "that's it": amounts still missing are asked for, then every name is read back. */
  function dictFinish(lead){
    if(!dict.items.length){
      dict = null;
      return ans('answer', { say: [(lead ? lead + ' ' : '') + 'Nothing to add, so nothing changed.'], log: 'dict empty' });
    }
    if(dict.list === 'order'){
      for(var i = 0; i < dict.items.length; i++){
        if(dict.items[i].amount != null) continue;
        var us = unitSay(dict.items[i].unit)[1];
        var a = asking('dictqty', (lead ? lead + ' ' : '') + 'How many ' + (us ? us + ' of ' : '') + itemSay(dict.items[i].name) + '?',
          [{ label: 'Skip it', value: 'skip' }, { label: 'Cancel', value: 'no' }], { idx: i }, 'number');
        a.show = dictShow(); a.log = 'dict amount'; return a;
      }
    }
    var n = dict.items.length, things = n === 1 ? 'One thing' : n + ' things', rb;
    if(dict.list === 'prep') rb = things + ' for the prep list: ' + joinAnd(dict.items.map(function(x){ return itemSay(x.name); })) + '.';
    else {
      var groups = [];
      dict.items.forEach(function(x){
        var g = groups.filter(function(y){ return y.sid === x.sid; })[0];
        if(!g) groups.push(g = { sid: x.sid, sname: x.sname, items: [] });
        g.items.push(amountOf(x.amount, x.unit, itemSay(x.name)));
      });
      rb = groups.length === 1 ? things + ' for the ' + supSay(groups[0].sname) + ' order: ' + joinAnd(groups[0].items) + '.'
        : things + ': ' + groups.map(function(g){ return 'for ' + supSay(g.sname) + ', ' + joinAnd(g.items); }).join('; ') + '.';
    }
    var readBack = (lead ? [lead] : []).concat([rb]);
    if(dict.left.length) readBack.push('I left out ' + joinAnd(uniq(dict.left).map(function(w){ return '"' + w + '"'; })) + '.');
    var data = { list: dict.list, items: dict.items.slice() };
    dict = null;
    var c = confirming('dict', readBack, n === 1 ? 'Add it?' : 'Add them?', data, 'dict read back ' + n);
    c.show = { title: (data.list === 'prep' ? 'Prep list' : 'Order') + ': ' + n + (n === 1 ? ' thing' : ' things'), reading: true, lines: data.items.slice(0, 6).map(function(x){
      return { text: itemSay(x.name) + (data.list === 'order' ? ' · ' + fmt(x.amount) + ' ' + x.unit : ''), tone: 'ok' }; }) };
    return c;
  }

  /* The yes: the list goes through run() like any spoken add. */
  async function dictAdd(c){
    var cmd = { text: '', verb: 'add', verbWords: 'add', list: c.list, sids: [], refs: false, looseQty: null, fromAsk: true, okMany: true,
      question: false, empty: false, and: false, nTok: 0, nHit: 0, moreWord: false,
      items: c.items.map(function(x){
        return { words: [itemSay(x.name)], stems: keyOf(x.name).split(' '), pick: x.id, qtyFix: c.list === 'order' ? x.amount : null,
                 verb: 'add', verbWords: 'add', list: c.list, sids: [] };
      }) };
    var a = await run(cmd, {}, 'tab');
    if(a.status !== 'done' || !cmd.out) return a;
    var n = c.list === 'prep' ? cmd.out.prep : cmd.out.order, sups = uniq(c.items.map(function(x){ return x.sname; }));
    var line = c.list === 'prep' ? 'Done. ' + n + ' added to the prep list.'
      : sups.length === 1 ? (n === 1 ? "Done. It's on the " : n === 2 ? 'Done. Both are on the ' : 'Done. All ' + n + ' are on the ') + supSay(sups[0]) + ' order.'
      : 'Done. ' + n + ' added to the orders.';
    a.say = [line].concat(cmd.out.extra);
    return a;
  }

  /* ---------- the owner answering this room's question ---------- */
  /* v3.11.19: every name word said is one of the asked item's ("add as potato",
     "add roast potatoes" to "Roast potato isn't a prep item yet…") */
  function sameItemWords(items, it){
    function stems(ws){ return contentSet(toks((ws || []).join(' ')).filter(function(t){ return !STOP[t.r] && !REFS[t.r]; }).map(function(t){ return t.s; })); }
    var asked = stems(it && it.words), said = [];
    (items || []).forEach(function(x){ said = said.concat(stems(x.words)); });
    return !!(asked.length && said.length && said.every(function(w){ return asked.indexOf(w) > -1 || asked.some(function(x){ return wordLike(w, x) >= 0.8; }); }));
  }
  /* v3.11.19: the one-off question once more, short; an unclear answer again leaves it */
  function oneoffAgain(p){
    if(p.again){ pending = null; return ans('answer', { say: ['Left it. Nothing changed.'], log: 'ask oneoff unclear again' }); }
    var vals = (p.options || []).map(function(o){ return o.value; }), np = vals.indexOf('newprep') > -1;
    var q = vals.indexOf('order') > -1 ? 'Sorry, the prep list for today' + (np ? ', a new prep item,' : ',') + ' or order it?'
      : np ? 'Sorry, today only, or a new prep item?' : 'Sorry, add it as a one-off?';
    var data = { again: true };
    Object.keys(p).forEach(function(k){ if(['id', 'kind', 'options', 'say', 'again'].indexOf(k) < 0) data[k] = p[k]; });
    var a = asking('oneoff', q, p.options, data);
    a.log = 'ask oneoff unclear';
    return a;
  }
  function matchOption(text, options){
    var c = clean(text);
    if(!c || !options || !options.length) return null;
    var yn = yesNo(text);
    if(yn && options.some(function(o){ return o.value === yn; })) return yn;
    if(yn === 'no' && options.some(function(o){ return o.value === 'none'; })) return 'none';
    /* v3.10.1 (his log, 12 Oct): "yes" to "Did you mean BBQ Sauce?" was dropped
       ("Left it"): with one suggestion, yes picks it */
    var real = options.filter(function(o){ return o.value !== 'none' && o.value !== 'no' && o.value !== 'yes'; });
    if(yn === 'yes' && real.length === 1) return real[0].value;
    if(/^(none|neither|none of (them|these|those)|nothing|no none)$/.test(c)) return options.some(function(o){ return o.value === 'none'; }) ? 'none' : null;
    var last = options.length - 1;
    var ord = { first: 0, 'the first': 0, 'first one': 0, 'the first one': 0, second: 1, 'the second': 1, 'second one': 1, 'the second one': 1,
      third: 2, 'the third': 2, 'third one': 2, 'the third one': 2, last: last, 'the last': last, 'last one': last, 'the last one': last };
    if(ord[c] != null && options[ord[c]]) return options[ord[c]].value;
    var ns = numbersIn(text);
    if(ns.length === 1){
      var hit = options.filter(function(o){ var on = numbersIn(o.label); return on.length && on[0] === ns[0]; });
      if(hit.length === 1) return hit[0].value;
    }
    var said = contentSet(toks(text).filter(function(t){ return !STOP[t.r]; }).map(function(t){ return t.s; }));
    var best = null, bestN = 0, tie = false;
    options.forEach(function(o){
      var set = contentSet(toks(o.label).map(function(t){ return t.s; }));
      var n = said.filter(function(w){ return set.indexOf(w) > -1 || set.some(function(x){ return wordLike(w, x) >= 0.7; }); }).length;
      if(n > bestN){ best = o; bestN = n; tie = false; }
      else if(n && n === bestN) tie = true;
    });
    return best && !tie ? best.value : null;
  }

  async function answerAsk(p, req, mode){
    var choice = req.reply && req.reply.choice != null ? String(req.reply.choice) : null;
    var text = String(req.text || '');
    var cmd = p.cmd;
    if(/^new(?:sec|prod|supp|unit)$/.test(p.kind)) return await newItemAnswer(p, req, mode);   // v3.11.13
    if(/^dict/.test(p.kind)) return await dictAnswer(p, req, mode);   // v3.11.0
    if(/^ts/.test(p.kind)) return await tsAnswer(p, req, mode);   // v3.9.6
    if(p.kind === 'roDay') return rosterReply(p, req, mode);      // v3.9.11
    if(p.kind === 'recipe'){                                      // v3.11.6: "Which recipe?" opens the pick; nothing is learned
      pending = null;
      var rch = choice != null ? choice : matchOption(text, p.options);
      if(rch == null || rch === 'none') return ans('answer', { say: ['Left it. Say the recipe’s full name.'], log: 'recipe ' + (rch || 'dropped') });
      var rce = recipeCat((await fresh()).cat).entries.filter(function(e){ return e.cid === rch; })[0];
      return rce ? openRecipe(rce, mode) : cant("That recipe isn't in your book now.", 'recipe gone');
    }
    if(p.kind === 'ofwhat'){                                      // v3.9.13: "5 kilos of what?"
      pending = null;
      var ow = parse(text, (await fresh()).cat);
      if(!ow.items.length) return ans('answer', { say: ['Left it. Nothing changed.'], log: 'ofwhat dropped' });
      if(!ow.verb) ow.verb = p.verb;
      if(!ow.items[0].qty) ow.items[0].qty = p.q;
      ow.fromAsk = true;
      return run(ow, req, mode);
    }
    if(p.kind === 'howmany' || p.kind === 'unit'){
      var ns = numbersIn(choice != null ? choice : text);
      if(!ns.length){
        var maybe = parse(text, (await fresh()).cat);
        pending = null;
        if(maybe.verb || maybe.items.length) return run(maybe, req, mode);
        return ans('answer', { say: ['Left it. Nothing changed.'], log: 'howmany dropped' });
      }
      /* v3.9.3: "6 kilo" to "How many packets?" isn't 6 packets: it asks
         once more; "500 grams" to "How many kilos?" is 0.5 */
      var e1 = cmd.items[p.item].e, aq = choice != null ? null : firstQty(text);
      if(e1 && e1.kind === 'order' && aq && aq.unit){
        var cv = convert(aq.n, aq.unit, canonUnit(e1.unit));
        if(cv == null){
          pending = null;
          if(p.again) return ans('answer', { say: ['Left it. Nothing changed.'], log: 'unit dropped' });
          var us = unitSay(e1.unit)[1];
          return asking('unit', label(e1) + ' is ordered in ' + (us || 'ones') + ', not ' + (UNIT_SAY[aq.unit] ? UNIT_SAY[aq.unit][1] : aq.unit) + '. How many ' + (us || '') + '?',
            [], { cmd: cmd, item: p.item, again: true }, 'number');
        }
        ns = [Math.round(cv * 1000) / 1000];
      }
      cmd.items[p.item].qtyFix = ns[0];
      cmd.fromAsk = true; pending = null;
      return run(cmd, req, mode);
    }
    /* v3.11.9 (his test, 14 Oct): "50 kilos of Mozzarella? That's a lot more
       than usual." answered "no, change it to 15" was left: a number in the
       answer is the amount he meant (checked again like any amount); the
       same number as asked ("yes 5") is a yes */
    if(p.kind === 'unusual' && choice == null){
      var uit = cmd.items[p.item], uns = numbersIn(text);
      if(uit && uns.length){
        var un = uns[uns.length - 1], uq = uns.length === 1 ? firstQty(text) : null;
        if(uq && uq.unit && uit.e && uit.e.kind === 'order'){
          var ucv = convert(uq.n, uq.unit, canonUnit(uit.e.unit));
          if(ucv != null) un = Math.round(ucv * 1000) / 1000;
        }
        pending = null; cmd.fromAsk = true;
        if(un === uit.amount) uit.okBig = true;
        else { uit.qtyFix = un; uit.okBig = false; }
        return run(cmd, req, mode);
      }
    }
    /* v3.11.10 (his test, 15 Oct): "Lemon isn't a prep item. One-off?" answered
       "can you add it to the ordering list" added it to the prep list: an
       answer that names the order puts it there instead ("Order it" too) */
    // ("not the order, the prep list" names both: that's the prep list, so it isn't switched here)
    /* v3.11.13 (his 15 Oct words: "yes add as a permanent item", "can you add
       parmesan as a permanent prep item"): "New prep item", or "permanent",
       "for good", makes it a prep item for good: its section is asked next */
    if(p.kind === 'oneoff' && canNewPrep() && (choice === 'newprep' || (choice == null && NEW_PREP_RE.test(clean(text)) && yesNo(text) !== 'no'))){
      pending = null;
      return askSection(p.name || titled(cmd.items[p.item].words.join(' ')));
    }
    if(p.kind === 'oneoff' && (choice === 'order' || (choice == null && /\b(order|orders|ordering|supplier)\b/.test(clean(text)) && !/\bprep\b/.test(clean(text))))){
      pending = null;
      var oit = cmd.items[p.item];
      oit.kind = 'order'; delete oit.oneoff; delete oit.e;
      if(p.orderPick) oit.pick = p.orderPick;
      cmd.fromAsk = true;
      return run(cmd, req, mode);
    }
    /* v3.11.10 (his test, 15 Oct: "yes, add it as a permanent item" was
       "Left it"): an answer that starts with a yes is a yes */
    if(choice == null && /^(?:yes|yeah|yep|yup|sure|ok|okay|please)\b/.test(clean(text)) && yesNo(text) !== 'no' && (p.options || []).some(function(o){ return o.value === 'yes'; })){
      choice = 'yes';
      // "for good" can't be done yet: never confidently wrong, so it says so
      if(p.kind === 'oneoff' && /\b(permanent|permanently|for good|always|every day|new item|new prep item)\b/.test(clean(text))){
        var pit = cmd.items[p.item]; pit.oneoff = true; cmd.fromAsk = true; pending = null;
        var pr = await run(cmd, req, mode);
        if(pr && pr.status === 'done') pr.say = (pr.say || []).concat(["That's for today only. I can't save new prep items for good yet."]);
        return pr;
      }
    }
    /* v3.11.10 (replaying his 15 Oct log): "could you add short parsley to the
       prep list", said while "… for today, or order it?" waited, matched the
       "Prep list" option and added the earlier item. A new add, with a name of
       its own, is a new request: the question is dropped and it's done anew */
    if(p.kind === 'oneoff' && choice == null){
      // "no, add chopped parsley": no to this one, and that one instead ("can you check mushroom off …" too)
      var nt = clean(text).replace(/^(?:no|nope|nah|not that|yes|yeah)\b[ ,]*/, '');
      var nc = parse(nt, (await fresh()).cat);
      // and an answer that points at the prep list ("not the order, the prep list") is "Prep list, today"
      var toPrep = /\bprep\b/.test(clean(text)) && !/\b(?:not|dont|do not)\s+(?:on\s+|to\s+)?(?:the\s+)?prep\b/.test(clean(text));
      if(nc.verb && nc.verbWords && nc.items.some(function(x){ return x.words.length; })){
        /* v3.11.19 (his log, 18 Oct): "add roast potato to the prep list" →
           "… today only, or as a new prep item?" → "add as potato" added 1 kilo
           of Royal Blue Potatoes to the Michael's Fresh order. An add naming
           only words of the item being asked about is an answer, not a new
           request: one that isn't clear is asked once more, never acted on */
        if(!sameItemWords(nc.items, cmd.items[p.item])){ pending = null; return run(nc, req, mode); }
        if(!toPrep) return oneoffAgain(p);
      }
      if(toPrep) choice = 'yes';
    }
    /* v3.9.13: "Did you mean Pure Cream?" answered by saying "second cream"
       again isn't a pick: nothing new was said, so it never learns from it */
    if(choice == null && p.kind === 'item' && p.teach){
      var rw = contentSet(toks(text).filter(function(t){ return !STOP[t.r]; }).map(function(t){ return t.s; }));
      var ow = String(p.teach).split(' ');
      if(rw.length && rw.every(function(w){ return ow.indexOf(w) > -1; })){
        pending = null;
        return ans('answer', { say: ["Left it. Nothing changed. Say the item's name if it's one of those."], log: 'ask repeated' });
      }
    }
    /* v3.10.1 (his log, 12 Oct): "Did you mean Royal Blue Potatoes?" answered
       "no, for the prep list, potatoes" added potatoes and chives to the order,
       because "potatoes" matched. An answer that starts with no is never a pick. */
    var noRest = choice == null && /^(no|nope|nah|not|wrong|neither)\b/.test(clean(text)) && yesNo(text) !== 'yes'
      ? clean(text).replace(/^(no|nope|nah|not that|not|wrong|neither)\b( one| of (them|these|those))?/, '').trim() : '';
    if(noRest){   // a plain "no" is answered as before, below
      pending = null;
      return ans('answer', { say: [p.kind === 'item' ? "Left it. Nothing changed. Say it again the way you want it, like 'add potatoes to the prep list'." : 'Left it. Nothing changed.'],
        log: 'ask ' + p.kind + ' no (said more: not a pick)' });
    }
    if(choice == null && p.options.length) choice = matchOption(text, p.options);
    if(choice == null){
      // not one of the options: a new sentence starts over, anything else drops the question
      var maybe2 = parse(text, (await fresh()).cat);
      pending = null;
      if(maybe2.verb || maybe2.items.some(function(it){ return it.exact && it.exact.length; })) return run(maybe2, req, mode);
      return ans('answer', { say: ['Left it. Nothing changed.'], log: 'ask dropped' });
    }
    pending = null;
    if(p.kind === 'teen') return run(parse(p.fixText(choice), (await fresh()).cat), req, mode);
    if(choice === 'no' || choice === 'none'){
      return ans('answer', { say: [p.kind === 'item' ? 'Try saying it again.' : 'Left it. Nothing changed.'], log: 'ask ' + p.kind + ' ' + choice });
    }
    cmd.fromAsk = true;
    var it = cmd.items[p.item];
    if(p.kind === 'item'){ it.pick = choice; if(p.teach) teach(p.teach, lastingId(catalogue(host.data(), {}), choice), p.said); }
    else if(p.kind === 'list'){ it.kind = choice; }
    else if(p.kind === 'unusual'){ it.okBig = true; }
    else if(p.kind === 'oneoff'){ it.oneoff = true; }
    else if(p.kind === 'elsewhere'){ it.pick = p.pickId; it.otherOk = true; it.sids = []; }
    else if(p.kind === 'supplier'){ cmd.sids = [choice]; }
    else if(p.kind === 'offhow'){ if(choice === 'added') it.qtyFix = p.added; }   // v3.9.3; "all": as said
    else if(p.kind === 'bare'){ cmd.verb = 'add'; it.verb = 'add'; }               // v3.9.3: yes, add it
    else if(p.kind === 'tickortake' && choice === 'tick'){ cmd.verb = 'tick'; cmd.items.forEach(function(x){ x.verb = 'tick'; }); }   // v3.11.16; "remove": as said; moveoff: yes, as said
    return run(cmd, req, mode);
  }

  /* ---------- the contract's functions ---------- */
  async function handle(req){
    req = req || {};
    if(req.text) req = Object.assign({}, req, { text: heardFix(req.text) });   // v3.11.1: "beef means", "cran ski"
    var mode = req.mode === 'tab' ? 'tab' : 'pluto';
    var otherBefore = rbOther;
    rbOther = true;   // until the roster answers this one itself
    var lastR = lastRead;   // v3.11.1: the list read just before, for "is there more?"
    lastRead = null;
    try{
      if(req.reply && pending && req.reply.to === pending.id){
        if(!/^rb/.test(pending.kind)) return await answerAsk(pending, req, mode);
        var rbp = pending;   // v3.10.0: a roster question; something else said instead carries on below
        pending = null;
        var rba = await rbRoute(req, mode, rbp, false);
        if(rba) return rba;
        if(!req.text) return cant('That one expired. Ask me again.', 'ask expired');
      }
      if(req.reply && req.reply.choice != null && !req.text){ pending = null; return cant('That one expired. Ask me again.', 'ask expired'); }
      pending = null;
      if(isClose(req.text || '')) return notmine('close');
      // v3.11.1 (his log, 13 Oct): "and Friday", "check Saturday as well" right after a roster answer
      var roF = roFollowDay(req.text || '', lastR);
      if(roF) return roF;
      /* v3.11.1 (owner, 13 Oct): "how many hours is Anil doing this week" is the
         roster, not his own timesheet ("how many hours" alone still is) */
      var roT = roPronoun(req.text || ''), rdH = roData(), other = rdH ? roPersonIn(roT, rdH) : null;
      if(other === (rdH && rdH.me)) other = null;
      if(/\bhours?\b/.test(clean(roT))){
        if(rdH && (other || /\b(rostered|rosters?)\b/.test(clean(roT)))) return rosterAnswer(roT);
        // v3.11.2 (his rule): hours he's doing / working / on are his rostered hours; "have I done" stays the timesheet
        if(rdH && /\b(am i|will i be|will i|i am|im|i will|ill|ill be) (doing|working|on|getting|down for|scheduled|booked)\b/.test(clean(roT))) return rosterAnswer(roT);
        // "how many hours is she doing" with nobody just asked about: never his own timesheet
        if(/\b(he|she|hes|shes|they|theyre|his|her|their|him|them)\b/.test(clean(roT))) return ans('answer', { say: ['Who do you mean? Say their name.'], log: 'hours who' });
      }
      var tsk = tsIntent(req.text || '');   // v3.9.6: his timesheet
      if(!tsk && tsRecent() && !other){     // v3.9.10: "remove the Sunday" right after a timesheet answer (v3.11.1: not "is Anil off on Sunday")
        tsk = tsFollow(req.text || '');
        if(tsk && parse(req.text || '', (await fresh()).cat).items.some(function(it){ return it.exact && it.exact.length; })) tsk = null;
      }
      if(tsk) return tsHandle(tsk, req.text || '');
      var rbr = await rbRoute(req, mode, null, otherBefore);   // v3.10.0: building the roster
      if(rbr) return rbr;
      /* v3.10.1 (replaying his log): a tap on an old card's "No", or a bare yes
         or no with no question open, said "I couldn't find no on the orders" */
      if(/^(yes|yeah|yep|yup|no|nope|nah)( please| thanks| thank you)?$/.test(clean(req.text || ''))) return ans('answer', { say: ['Okay. Nothing changed.'], log: 'yes or no to nothing' });
      var fx = await fixLast(req.text || '', req, mode);   // v3.11.10: "no, I meant the order"
      if(fx) return fx;
      var rd = await redoLast(req.text || '', req, mode);  // v3.11.10: "put that back" after an undo
      if(rd) return rd;
      var rm = await readMore(req.text || '', lastR);   // v3.11.1: "is there more?", "read them all"
      if(rm) return rm;
      var roN = roNames(roData());
      if(rosterWrite(req.text || '', roN)) return cant(RE && host.setRosterDays ? "I didn't catch that for the roster. Try 'put Anil on Thursday at 4', or 'let's do next week's roster'." : "I can't change the roster from here.", 'roster write');
      var rdA = roDetailAgain(req.text || '');   // v3.10.1: "more details" after a roster answer
      if(rdA) return rdA;
      if(rosterIntent(roT, roN)) return rosterAnswer(roT);   // v3.9.11: read only (v3.11.1: "he" is who was just asked about)
      /* v3.9.3: long talk while it listens for a follow-up, with no verb and
         few names or amounts in it, is chatter (his log: talking to Claude
         about the app made it ask "Which garlic?"). Ignored, as RK Trips
         does; a real order, even a long one, has a verb or is mostly names
         and amounts. */
      if(req.followUp && !req.reply){
        var pc = parse(req.text || '', (await fresh()).cat);
        if(!pc.verb && pc.nTok >= 8 && pc.nHit / pc.nTok < 0.4) return notmine('chatter');
      }
      // fifteen or fifty? (only when the listener's other guesses disagree)
      var tt = teenTen(req.text || '', req.alts || []);
      if(tt){
        var c0 = parse(req.text, (await fresh()).cat);
        if(c0.verb !== 'read' && (c0.items.length || c0.refs || c0.looseQty)){
          var orig = String(req.text || ''), lo = Math.min(tt.heard, tt.other), hi = Math.max(tt.heard, tt.other), heard = tt.heard;
          return asking('teen', cap(WORD_OF[lo]) + ' or ' + WORD_OF[hi] + '?',
            [{ label: String(lo), value: String(lo) }, { label: String(hi), value: String(hi) }], {
              fixText: function(choice){
                var n = +choice;
                if(n === heard) return orig;
                var out = orig.replace(new RegExp('\\b' + heard + '\\b'), String(n));
                if(out === orig) out = orig.replace(new RegExp('\\b' + WORD_OF[heard] + '\\b', 'i'), String(n));
                return out;
              } }, 'number');
        }
      }
      var f = await fresh();
      // v3.9.13: "drop it down to 9 kilos", "bring the mozz up to 10" are "make it …"
      var said = String(req.text || '').replace(/\b(?:drop|bring|cut|knock|turn|bump|move|take)\b(.{0,40}?)\b(?:down|up) to\b/i, 'make$1');
      /* v3.11.13 (his 15 Oct log: "can you add parmesan as a permanent prep
         item"): said in the first place, it's the prep list, made for good */
      var permSaid = canNewPrep() && NEW_PREP_SAID.test(clean(said));
      if(permSaid){
        said = clean(said).replace(NEW_PREP_SAID, ' ').replace(/\s+/g, ' ').trim();
        if(!/\bprep\b/.test(said)) said += ' to the prep list';
      }
      /* v3.11.16 (his test, 17 Oct: "can you move bechamel and pork ragues" was
         Google's "remove"): "move" with nowhere to move it to takes it off, after asking */
      var cm0 = clean(said), moveAsk = /^(?:(?:and|so|ok|okay|also) )*(?:(?:can|could|would|will) you (?:please |also )?|please )?move\b/.test(cm0) && !/\bmove\b.*\b(?:to|onto|into|over|up|down|across|from|back)\b/.test(cm0);
      if(moveAsk) said = String(said).replace(/\bmove\b/i, 'remove');
      var c1 = parse(said, f.cat);
      if(permSaid) c1.newPrep = true;
      if(moveAsk) c1.askRemove = true;
      /* v3.9.13 (his log): "add five kilos of" was cut off by the mic, and it
         added 5 kilos to the last item. An amount "of" nothing asks what. */
      if(/\bof( the| some)?$/.test(clean(said)) && !c1.items.length && c1.looseQty){
        return asking('ofwhat', cap(amount(c1.looseQty.n, c1.looseQty.unit)) + ' of what?', [], { verb: c1.verb || 'add', q: c1.looseQty }, 'item');
      }
      // v3.11.0: "add the following (to the prep list)": he reads the list out, then it's read back
      if(mode === 'tab' && (!c1.verb || c1.verb === 'add') && !c1.question && isFollowing(said)) return await dictStart(c1, f.cat);
      // v3.11.6 (his log, 14 Oct): "show me the recipe for polenta" opens that recipe
      var rcp = recipeAsk(said, f.cat, mode, c1);
      if(rcp) return rcp;
      // v3.9.13: "can you …?" with nothing to act on is about The Pass itself
      var topic = canTopic(said);
      if(topic){
        var target = c1.items.some(function(it){ return it.exact && it.exact.length; }) || (c1.sids || []).length || c1.looseQty || c1.refs;
        var about = ['send', 'recipe', 'trains', 'notyet', 'roster-read', 'roster-write', 'timesheet'].indexOf(topic) > -1;
        /* a verb it knows is a command, even cut off ("can you add" → "Add what?") or
           with a misheard name ("can you add pearly garlic" → "Did you mean …?") */
        if(!target && (about || !c1.verb)){
          if(mode === 'pluto' && topic === 'other') return notmine('can other');
          return ans('answer', { say: [CAN_SAY[topic]], log: 'can ' + topic });
        }
      }
      return await run(c1, req, mode);
    }catch(err){
      return ans('error', { say: ["I couldn't check the list."], log: 'error ' + String(err && err.message || err).slice(0, 80) });
    }
  }

  async function confirm(token, yes){
    var c = confirms[token];
    delete confirms[token];
    if(!c || c.expires < now()) return cant('That one expired. Ask me again.', 'confirm expired');
    if(!yes) return ans('answer', { say: [], log: 'confirm no ' + c.kind });
    try{
      var f = await fresh(), cat = f.cat;
      if(c.kind === 'send'){
        var s = supplier(cat, c.sid);
        if(!s || !onOrder(s).length) return cant('That order is empty now.', 'send empty');
        if(host.open) host.open({ view: 'ticket', id: s.id });
        return ans('done', { say: ["It's on screen. Check it and tap Send Order."], action: { id: 'a-send-' + now().toString(36), label: 'Opened the ' + supSay(s.name) + ' order to send', undo: false },
          show: { title: supSay(s.name) + ' order', lines: onOrder(s).slice(0, 6).map(function(p){ return { text: itemSay(p.name) + ' · ' + fmt(+p.qty) + ' ' + p.unit, tone: 'ok' }; }), open: { view: 'ticket', id: s.id }, go: true },
          keep: false, log: 'send ok' });
      }
      if(c.kind === 'clear' || c.kind === 'repeat'){
        var s2 = supplier(cat, c.sid);
        if(!s2) return cant('That supplier is gone.', 'gone');
        var before = {}; (s2.products || []).forEach(function(p){ before[p.id] = +p.qty || 0; });
        var lo = c.kind === 'repeat' && host.lastOrder ? host.lastOrder(s2.id) || {} : {};
        host.setQty((s2.products || []).map(function(p){ return { pid: p.id, qty: c.kind === 'repeat' ? (+lo[p.id] || 0) : 0 }; }));
        var lab = c.kind === 'repeat' ? 'Loaded the last ' + supSay(s2.name) + ' order' : 'Cleared the ' + supSay(s2.name) + ' order';
        // the quantities can come back, so these keep an undo
        var aid = remember(lab, [{ k: 'restore', sid: s2.id, sname: s2.name, before: before }]);
        if(host.open) host.open({ view: 'supplier', id: s2.id });
        return ans('done', { say: [lab + '.'], action: { id: aid, label: lab, undo: true }, log: c.kind + ' ok' });
      }
      if(c.kind === 'clearDone'){
        var r = await host.clearDonePrep(c.ids);
        if(!r || !r.ok) return ans('error', { say: ['No connection. Nothing was cleared.'], log: 'clear done failed' });
        var n = typeof r.cleared === 'number' ? r.cleared : c.ids.length;
        return ans('done', { say: ['Cleared ' + n + ' finished ' + (n === 1 ? 'line' : 'lines') + '.'], action: { id: 'a-cd-' + now().toString(36), label: 'Cleared ' + n + ' finished prep lines', undo: false }, log: 'clear done ok' });
      }
      if(c.kind === 'timesheet'){   // v3.9.6
        var t = c.ts, sh = tsSheet();
        if(!sh || !host.setTimesheetDay) return cant("I can't reach the timesheet.", 'ts none');
        var was = (sh.days || {})[t.day] || {};
        var before = { start: was.start || '', end: was.end || '', date: was.date || '' };
        if(!host.setTimesheetDay(t.day, { start: t.start, end: t.end, date: t.date })){
          return ans('error', { say: ["It didn't save. Check the Timesheet screen."], log: 'ts save failed' });
        }
        var tlab = (t.clear ? 'Cleared ' : 'Saved ') + DAY_FULL[t.day] + "'s timesheet";
        var tid = remember(tlab, [{ k: 'ts', day: t.day, before: before, after: { start: t.start, end: t.end } }]);
        tsNote(t.date);
        if(t.clear){   // v3.9.10
          return ans('done', { say: ['Cleared ' + DAY_FULL[t.day] + '.'], action: { id: tid, label: tlab, undo: true },
            show: { title: 'Timesheet', lines: [{ text: DAY_FULL[t.day] + ' · cleared', tone: 'ok' }] }, keep: false, log: 'ts cleared ' + t.day });
        }
        var th = hoursOf(t.start, t.end);
        return ans('done', { say: ['Saved. ' + DAY_FULL[t.day] + ', ' + hoursSay(th) + '.'], action: { id: tid, label: tlab, undo: true },
          show: { title: 'Timesheet', lines: [{ text: DAY_FULL[t.day] + ' · ' + timeSay(t.start) + ' – ' + timeSay(t.end) + ' · ' + fmt(th) + ' h', tone: 'ok' }] },
          keep: false, log: 'ts saved ' + t.day });
      }
      if(c.kind === 'newprep'){   // v3.11.13: a new prep item, and on today's list
        var rp = host.newPrepItem(c.name, c.section);
        if(!rp || !rp.ok) return ans('error', { say: ["I couldn't save it. Add it on the Prep items screen."], log: 'newprep failed' });
        var nops = [{ k: 'newprep', id: rp.id, name: c.name }];
        var al = await host.addPrep([{ text: c.name, section: c.section, recipe: '' }]);
        var nsay = 'Added ' + c.name + " to the prep items, and to today's prep list.";
        if(al && al.ok) nops.push({ k: 'prepAdd', ids: al.ids || [], texts: [c.name] });
        else nsay = 'Added ' + c.name + " to the prep items. No connection, so it isn't on today's list yet.";
        var nlab = 'New prep item ' + c.name;
        var nid = remember(nlab, nops);
        return ans('done', { say: [nsay], action: { id: nid, label: nlab, undo: true },
          show: { title: 'Prep list', lines: [{ text: c.name + ' · ' + c.section, tone: 'ok' }], open: { view: 'prep' } }, log: 'newprep ok ' + c.section });
      }
      if(c.kind === 'newprod'){   // v3.11.13: a new product, with the amount he said on the order
        var rq = host.newProduct(c.sid, c.name, c.unit);
        if(!rq || !rq.ok) return ans('error', { say: ["I couldn't save it. Add it on the supplier's screen."], log: 'newprod failed' });
        var pops = [{ k: 'newprod', sid: c.sid, pid: rq.pid, name: c.name, sname: c.sname }];
        var psay = 'Added ' + c.name + ' as a new ' + supSay(c.sname) + ' product';
        if(c.qty > 0){
          host.setQty([{ pid: rq.pid, qty: c.qty }]);
          pops.push({ k: 'qty', sid: c.sid, pid: rq.pid, name: c.name, unit: c.unit, before: 0, after: c.qty });
          psay += ', and ' + amount(c.qty, c.unit) + ' to the ' + supSay(c.sname) + ' order';
        }
        var plab = 'New product ' + c.name;
        var pid2 = remember(plab, pops);
        return ans('done', { say: [psay + '.'], action: { id: pid2, label: plab, undo: true },
          show: { title: supSay(c.sname) + ' order', lines: [{ text: c.name + (c.qty > 0 ? ' · ' + fmt(c.qty) + ' ' + c.unit : ''), tone: 'ok' }], open: { view: 'supplier', id: c.sid } },
          log: 'newprod ok ' + supSay(c.sname) });
      }
      if(c.kind === 'roster') return rbConfirmed(c);   // v3.10.0
      if(c.kind === 'dict') return await dictAdd(c);    // v3.11.0
      if(c.kind === 'again'){
        var cmd = c.cmd;
        cmd[c.flag] = true; cmd.fromAsk = true;
        cmd.items.forEach(function(it){ if(it.e && it.e.kind !== 'oneoff'){ it.pick = it.e.id; } it.e = it.e && it.e.kind === 'oneoff' ? it.e : null; it.missing = false; });
        return await run(cmd, {}, 'tab');
      }
    }catch(err){
      return ans('error', { say: ["I couldn't do that."], log: 'confirm error' });
    }
    return cant('That one expired. Ask me again.', 'confirm unknown');
  }

  async function undo(actionId){
    try{ return await undoNow(actionId); }
    catch(err){ return ans('error', { say: ["I couldn't undo that."], log: 'undo error' }); }
  }

  /* ---------- learned words, for the Voice screen (v3.9.1) ----------
     Not part of the room contract: only The Pass's own page uses these. */
  function nameOf(cat, id){
    var e = entryById(cat, lastingId(cat, id) || id);
    return e ? { name: e.name, where: e.kind === 'order' ? supSay(e.sname) : 'Prep list' } : { name: '', where: '' };
  }
  function words(){
    var w = taught(), s = saidWords(), cat = catalogue(host.data(), {});
    return Object.keys(w).map(function(k){
      var n = nameOf(cat, w[k]);
      return { key: k, said: s[k] || k, id: w[k], name: n.name, where: n.where };
    });
  }
  /* What the brain will hear in these words, the way it reads a spoken
     sentence: one item's name and nothing else. Commands, amounts, list and
     supplier names can't be taught: the brain reads those first. */
  function checkWord(text){
    if(!clean(text)) return { ok: false, why: 'empty' };
    var cat = catalogue(host.data(), taught()), c;
    try{ c = parse(String(text), cat); }catch(e){ return { ok: false, why: 'command' }; }
    var items = c.items || [];
    if(items.length > 1) return { ok: false, why: 'two', words: items.map(function(it){ return it.words.join(' '); }) };
    if(items.length !== 1 || c.verb || c.list || (c.sids || []).length || c.refs || c.looseQty || items[0].qty) return { ok: false, why: 'command' };
    var it = items[0], key = it.stems.join(' ');
    var means = dedupe((cat.index[key] || []).filter(function(e){ return e.kind === 'order' || e.kind === 'prep'; }));
    return { ok: true, key: key, said: it.words.join(' '), means: means.map(function(e){
      var k = e.keys.filter(function(x){ return x.k === key; })[0];
      return { id: e.id, name: e.name, where: e.kind === 'order' ? supSay(e.sname) : 'Prep list', how: k ? k.how : 'name' };
    }) };
  }
  function teachWord(text, id){
    var c = checkWord(text);
    if(!c.ok) return c;
    var cat = catalogue(host.data(), {});
    id = lastingId(cat, id);
    if(!id || !entryById(cat, id)) return { ok: false, why: 'gone' };
    teach(c.key, id, c.said);
    var n = nameOf(cat, id);
    return { ok: true, key: c.key, said: c.said, id: id, name: n.name, where: n.where };
  }
  function forgetWord(key){
    var w = taught(), s = saidWords();
    if(!Object.prototype.hasOwnProperty.call(w, key)) return false;
    delete w[key]; delete s[key];
    put(WORDS_KEY, w); put(SAID_KEY, s);
    wordsChanged();
    return true;
  }
  /* Everything a word can be taught to mean: products and prep items */
  function choices(){
    var cat = catalogue(host.data(), {});
    return dedupe(cat.entries.filter(function(e){ return e.kind === 'order' || e.kind === 'prep'; })).map(function(e){
      var find = [];
      clean(e.name).split(' ').concat(e.keys.map(function(x){ return x.k; }).join(' ').split(' ')).forEach(function(x){ if(x && find.indexOf(x) < 0) find.push(x); });
      return { id: e.id, name: e.name, where: e.kind === 'order' ? supSay(e.sname) : 'Prep list', find: find };
    });
  }
  /* From a sentence in the heard log, the words most likely misheard: an
     item it didn't know, else the first item; '' when it found none */
  function guessWord(text){
    var cat = catalogue(host.data(), taught()), c;
    try{ c = parse(String(text || ''), cat); }catch(e){ return ''; }
    var items = c.items || [];
    var odd = items.filter(function(it){ return !(cat.index[it.stems.join(' ')] || []).length && !(it.exact && it.exact.length); })[0];
    var it = odd || items[0];
    return it ? it.words.join(' ') : '';
  }

  return { hello: hello, menu: menu, handle: handle, confirm: confirm, undo: undo, reset: reset,
           pendingAsk: function(){ return pending ? { id: pending.id, kind: pending.kind, options: pending.options } : null; },
           words: words, checkWord: checkWord, teachWord: teachWord, forgetWord: forgetWord, choices: choices, guessWord: guessWord };
}

return {
  version: 'v3.11.20',
  parseClock: parseClock, clockMin: clockMin, timeSay: timeSay, hoursSay: hoursSay, serviceDate: serviceDate, tsIntent: tsIntent, rosterIntent: rosterIntent,
  rosterTime: rbTime, rosterClauses: rbClauses, heardFix: heardFix,
  clean: clean, toks: toks, stem: stem, readNumber: readNumber, readQty: readQty, numbersIn: numbersIn, teenTen: teenTen,
  parse: parse, catalogue: catalogue, findItems: findItems, isClose: isClose, yesNo: yesNo,
  amount: amount, itemSay: itemSay, supSay: supSay, sound: sound,
  createRoom: createRoom
};
});

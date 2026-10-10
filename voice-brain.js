/* The Pass — voice brain (v3.9.0, 9 October 2026; learned words v3.9.1, 10 October)

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
  var api = make();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.AlmoVoice = api;
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

/* ================= words ================= */

/* Lower case, "&" -> "and", apostrophes dropped ("michael's" -> "michaels",
   "what's" -> "whats"), digits split from letters ("2kg" -> "2 kg"), and
   only the dots and slashes that sit inside numbers kept ("2.5", "1/2"). */
function clean(s){
  return String(s == null ? '' : s).toLowerCase()
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
var IRREG = { tomatoes: 'tomato', potatoes: 'potato', leaves: 'leaf', halves: 'half', loaves: 'loaf' };
function stem(w){
  if(w.length <= 3 || /\d/.test(w)) return w;
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
  each: 'each', piece: 'each', pieces: 'each'
};
var UNIT_SAY = { kg: ['kilo', 'kilos'], g: ['gram', 'grams'], L: ['litre', 'litres'], ml: ['ml', 'ml'],
  box: ['box', 'boxes'], bag: ['bag', 'bags'], tin: ['tin', 'tins'], pkt: ['packet', 'packets'],
  bunch: ['bunch', 'bunches'], punnet: ['punnet', 'punnets'], ctn: ['carton', 'cartons'], jar: ['jar', 'jars'],
  tub: ['tub', 'tubs'], bottle: ['bottle', 'bottles'], each: ['', ''] };

/* A product's own unit, as one of the keys above where it is one */
function canonUnit(u){
  var c = clean(u);
  if(!c) return '';
  if(/^market bunch/.test(c)) return 'bunch';
  return UNIT_WORDS[c] || c;
}
function unitSay(u){
  var c = clean(u);
  if(/^market bunch/.test(c)) return ['market bunch', 'market bunches'];
  var k = UNIT_WORDS[c];
  if(k) return UNIT_SAY[k];
  if(!c) return ['', ''];
  return [c, /s$/.test(c) ? c : c + 's'];
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
  [['undo', 'that'], 'undo', 0], [['undo', 'it'], 'undo', 0], [['undo'], 'undo', 0], [['scrap', 'that'], 'undo', 0], [['take', 'that', 'back'], 'undo', 0],
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
  [['untick'], 'untick', 0], [['un', 'tick'], 'untick', 0], [['uncheck'], 'untick', 0], [['isnt', 'done'], 'untick', 1], [['arent', 'done'], 'untick', 1],
  [['is', 'not', 'done'], 'untick', 1], [['not', 'done'], 'untick', 1], [['not', 'finished'], 'untick', 1],
  [['make', 'it'], 'set', 0], [['make', 'that'], 'set', 0], [['make', 'them'], 'set', 0], [['make'], 'set', 0], [['set'], 'set', 0],
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
var TRAIL = [['please'], ['thanks'], ['mate'], ['bro'], ['for', 'me'], ['for', 'us'], ['cheers'], ['as', 'well'], ['too'], ['thank', 'you'], ['now'], ['again']];

var STOP = {
  the: 1, a: 1, an: 1, of: 1, to: 1, on: 1, onto: 1, in: 1, into: 1, for: 1, from: 1, off: 1, my: 1, our: 1, me: 1, us: 1,
  please: 1, with: 1, at: 1, just: 1, also: 1, too: 1, as: 1, well: 1, now: 1, today: 1, tonight: 1, tomorrow: 1, tomorrows: 1,
  yeah: 1, ok: 1, okay: 1, oh: 1, um: 1, uh: 1, mate: 1, bro: 1, chef: 1, pluto: 1, then: 1, actually: 1, instead: 1,
  again: 1, is: 1, are: 1, be: 1, was: 1, there: 1, theres: 1, we: 1, i: 1, you: 1, got: 1, have: 1, has: 1, some_more: 1,
  extra: 1, fresh: 0, usual: 1, normal: 1, regular: 1, total: 1, altogether: 1, all: 1, up: 1, back: 1, out: 1, over: 1,
  by: 1, this: 1, week: 1, next: 1, order: 0, am: 1, pm: 1, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1,
  saturday: 1, sunday: 1, ones: 1, one: 0, lot: 1, item: 1, items: 1, thing: 1, things: 1, stuff: 1, more: 1, another: 1,
  only: 1, about: 1, around: 1, roughly: 1, like: 1, maybe: 1, will: 1, can: 1, need: 1, want: 1, thanks: 1, cheers: 1
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
function scan(t, cat){
  var segs = [], i = 0, clause = 0, start = 0, splitOff = -1;
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
      if(!V.any && i !== start) continue;
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
  function push(g){ g.c = clause; segs.push(g); }
  while(i < t.length){
    if(i === splitOff){ push({ type: 'stop', w: t[i].r, i: i, end: i + 1 }); i++; continue; }
    var w = t[i].r;
    if(CONJ[w] && !(w === 'plus' && i === start)){
      push({ type: 'conj', i: i, end: i + 1 });
      clause++; start = i + 1; i++;
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
  var cmd = { text: String(text || ''), verb: null, verbWords: '', list: null, sids: [], items: [], refs: false,
              looseQty: null, and: se.and, question: false, tickWords: false, empty: !t.length };
  if(!t.length) return cmd;
  cmd.question = !!QWORDS[t[0].r];
  var segs = scan(t, cat);
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
    var groups = named.map(function(p){ return { item: p, extra: [] }; });
    var g = 0;
    run.parts.forEach(function(p){
      if(p.type === 'item'){ g = named.indexOf(p); return; }
      var k = named.filter(function(n){ return n.i > p.i; })[0];
      (k ? groups[named.indexOf(k)] : groups[g]).extra.push(p);
    });
    groups.forEach(function(gr){
      var p = gr.item, before = gr.extra.filter(function(x){ return x.i < p.i; }), after = gr.extra.filter(function(x){ return x.i > p.i; });
      var words = before.map(function(x){ return x.w; }).concat(t.slice(p.i, p.end).map(function(x){ return x.r; })).concat(after.map(function(x){ return x.w; }));
      var stems = before.map(function(x){ return x.s; }).concat(p.key.split(' ')).concat(after.map(function(x){ return x.s; }));
      items.push(mk({ segAt: p, words: words, stems: stems, exact: gr.extra.length ? null : p.entries }, p));
    });
  });
  items.sort(function(a, b){ return a.segAt.i - b.segAt.i; });

  /* Amounts: one said before a name belongs to it ("2 kilos of mozz"); one
     said after a name with nothing in between belongs to that name ("mozz
     2", "pepperoni to 3"). */
  var pending = null, last = null, joined = false;
  segs.forEach(function(g){
    if(g.type === 'qty'){
      if(last && !last.qty && !joined){ last.qty = g.q; return; }
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
function findItems(item, cat, kinds){
  var ok = function(e){ return kinds.indexOf(e.kind) > -1; };
  var said = contentSet(item.stems);
  var key = item.stems.join(' ');
  var exact = (cat.index[key] || []).filter(ok);
  if(!exact.length && item.exact) exact = item.exact.filter(ok);
  if(exact.length) return { how: 'exact', list: exact };
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
    return { how: 'subset', list: top, top: top.length };
  }
  var fz = [];
  cat.entries.forEach(function(e){
    if(!ok(e)) return;
    var best = 0;
    e.keys.forEach(function(x){
      if(!x.set.length) return;
      var sum = 0;
      said.forEach(function(w){ var b = 0; x.set.forEach(function(y){ b = Math.max(b, wordLike(w, y)); }); sum += b; });
      best = Math.max(best, sum / Math.max(said.length, x.set.length));
    });
    if(best >= 0.6) fz.push({ e: e, n: best });
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
  async function fresh(){
    if(host.refresh){
      try{ await Promise.race([host.refresh(), new Promise(function(r){ setTimeout(r, 2500); })]); }catch(e){}
    }
    var d = host.data();
    return { data: d, cat: catalogue(d, taught()) };
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

  /* ---------- the doorway ---------- */
  function hello(){ return { room: 'almo', label: 'Almo', contract: 1, version: host.version || '' }; }

  /* Single item names that are everyday words go in cues, not strong
     (contract 4): another room may use them. */
  var EVERYDAY = { time: 1, date: 1, dates: 1, base: 1, rocket: 1, honey: 1, jam: 1, salt: 1, pepper: 1, cream: 1, butter: 1, milk: 1,
    oil: 1, sugar: 1, chips: 1, mint: 1, sage: 1, ranch: 1, order: 1, list: 1, lemon: 1, celery: 1, carrots: 1, flats: 1, mac: 1,
    caps: 1, pep: 1, dough: 1, chicken: 1, thigh: 1, cucumber: 1, squid: 1, speck: 0, spec: 1, speak: 1, tom: 1, tomb: 1, toum: 0,
    fior: 1, fiore: 1, confit: 0, tira: 1, moz: 1, mots: 1, caramel: 1, olives: 1, potatoes: 1, potato: 1, spuds: 1, parm: 1,
    milk_: 1, paprika: 1, oregano: 1, pumice: 1, burnet: 1, durra: 1, k: 1 };
  function menu(){
    var d = host.data(), cat = catalogue(d, taught());
    var strong = [], cues = ['prep', 'order', 'orders', 'supplier', 'how much', 'whats on the', 'prep list', 'the list', 'made', 'done', 'ticked off'];
    function put2(w){
      w = clean(w);
      if(!w) return;
      if(w.indexOf(' ') < 0 && (EVERYDAY[w] || w.length < 4)){ if(cues.indexOf(w) < 0) cues.push(w); return; }
      if(strong.indexOf(w) < 0) strong.push(w);
    }
    (d.suppliers || []).forEach(function(s){ put2(s.name); put2(supSay(s.name)); (s.products || []).forEach(function(p){ put2(itemSay(p.name)); (PRODUCT_ALIASES[p.id] || []).forEach(put2); }); });
    (d.prepCatalogue || []).forEach(function(c){ put2(c.name); });
    Object.keys(taught()).forEach(function(k){ put2(k); });
    put2('prep list');
    cues = cues.filter(function(c){ return strong.indexOf(c) < 0; });
    return { room: 'almo', label: 'Almo', contract: 1, help: 'your prep list and orders', busy: 'Checking the list\u2026',
      strong: strong, cues: cues,
      verbs: ['add', 'chuck in', 'we need', 'put', 'get', 'order', 'remove', 'take off', 'scrap', 'drop', 'change', 'make it', 'read', 'whats on', 'send', 'tick off', 'clear'],
      examples: ['add salad dressing to the prep list', 'chuck in 2 kilos of mozzarella', 'whats on the aziz order', 'take the speck off', 'pizza sauce is done', 'send the aziz order'] };
  }
  function reset(){ ctx = null; pending = null; }

  /* ---------- reading ---------- */
  function readPrep(cat, d){
    var lines = (d.prepLines || []).filter(function(l){ return !l.done; });
    var done = (d.prepLines || []).length - lines.length;
    var sec = d.prepSections || [];
    lines.sort(function(a, b){
      var ia = sec.indexOf(a.section), ib = sec.indexOf(b.section);
      ia = ia < 0 ? 999 : ia; ib = ib < 0 ? 999 : ib;
      if(ia !== ib) return ia - ib;
      return String(a.text).localeCompare(String(b.text));
    });
    var show = { title: 'Prep list', lines: lines.slice(0, 6).map(function(l){ return { text: l.text, tone: 'ok' }; }), open: { view: 'prep' } };
    if(!lines.length){
      return ans('answer', { say: [done ? 'Everything on the prep list is done.' : 'Nothing on the prep list.'], show: show, log: 'read prep 0' });
    }
    var names = lines.map(function(l){ return l.text; });
    var head = 'Prep list, ' + lines.length + ' to do: ';
    var say, more = [];
    if(names.length <= SPOKEN_MAX) say = head + joinAnd(names) + '.';
    else {
      say = head + names.slice(0, SPOKEN_MAX).join(', ') + ', and ' + (names.length - SPOKEN_MAX) + ' more.';
      more = ['The rest: ' + joinAnd(names.slice(SPOKEN_MAX)) + '.'];
    }
    return ans('answer', { say: [say], more: more, show: show, log: 'read prep ' + lines.length });
  }
  function readOrder(s){
    var items = onOrder(s), name = supSay(s.name);
    var show = { title: name + ' order', lines: items.slice(0, 6).map(function(p){ return { text: itemSay(p.name) + ' \u00b7 ' + fmt(+p.qty) + ' ' + p.unit, tone: 'ok' }; }), open: { view: 'supplier', id: s.id } };
    if(!items.length) return ans('answer', { say: ['Nothing on the ' + name + ' order yet.'], show: show, log: 'read order ' + name + ' 0' });
    var lines = items.map(lineOf), more = [];
    var head = name + ' order, ' + items.length + (items.length === 1 ? ' item: ' : ' items: ');
    var say;
    if(lines.length <= SPOKEN_MAX) say = head + joinAnd(lines) + '.';
    else {
      say = head + lines.slice(0, SPOKEN_MAX).join(', ') + ', and ' + (lines.length - SPOKEN_MAX) + ' more.';
      more = ['The rest: ' + joinAnd(lines.slice(SPOKEN_MAX)) + '.'];
    }
    return ans('answer', { say: [say], more: more, show: show, log: 'read order ' + name + ' ' + items.length });
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
          if(!ln) return cant(itemSay(it.e.name) + " isn't on the prep list.", 'not on list');
          it.e = ln;
        }
        if(it.e && it.e.kind === 'line' && v === 'tick' && it.e.done) return cant(itemSay(it.e.name) + ' is already ticked off.', 'tick already');
        if(it.e) continue;
      }
      var K = kindsFor(cmd, it), kinds = K.strict || K.prefer || K.all;
      var found = look(it, cat, kinds, v);
      if(K.prefer && !anyFound(found) && !found.stop){ kinds = K.all; found = look(it, cat, kinds, v); }
      if(found.stop){
        if(cmd.items.length === 1) return found.stop;
        it.skip = found.stop.say[0]; it.missing = true; continue;
      }
      var shown = it.words.join(' ');
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
      if(mode === 'pluto' && !hasCue && !have.some(function(k){ return found[k].how === 'exact'; })) return notmine('no cue');
      if(!have.length){
        if(kinds.length === 1 && kinds[0] === 'prep' && (v === 'add' || v === 'set') && it.words.length){
          if(it.oneoff){ it.e = { kind: 'oneoff', name: cap(shown), id: 'oneoff' }; continue; }
          return asking('oneoff', cap(shown) + " isn't a prep item. Add it as a one-off?", [{ label: 'Add it', value: 'yes' }, { label: 'No', value: 'no' }], { cmd: cmd, item: i });
        }
        if(kinds.indexOf('line') > -1 && !kinds.some(function(k){ return k === 'order'; })){
          var other = findItems(it, cat, ['prep', 'order']);
          if(other.list.length && (other.how === 'exact' || dedupe(other.list).length === 1)) return cant(itemSay(other.list[0].name) + " isn't on the prep list.", 'not on list');
        }
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
      if(f.how === 'fuzzy'){
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
        if(v === 'remove' || v === 'tick' || v === 'untick'){ nothing.push(itemSay(e.name) + " isn't on the prep list."); return; }
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
    ctx = { at: now(), verb: lastVerb || 'add', items: done };
    var title = openView && openView.view === 'prep' ? 'Prep list' : orderChanges[0] ? supSay(orderChanges[0].e.sname) + ' order' : 'Done';
    return ans('done', { say: talk, show: { title: title, lines: show.slice(0, 6), open: openView },
      action: { id: id, label: lab, undo: true }, log: ops.map(function(o){ return o.k === 'qty' ? o.name + ' ' + o.before + '>' + o.after : o.k; }).join(', ') });
  }

  async function undoNow(id){
    var l = undoList();
    var u = id ? l.filter(function(x){ return x.id === id; })[0] : l[l.length - 1];
    if(!u) return cant(id ? "That's too old to undo now." : "There's nothing to undo.", 'undo none');
    var said = [], skipped = [];
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

  async function run(cmd, req, mode){
    var f = await fresh(), cat = f.cat, d = f.data;
    var hasCue = !!(cmd.list || cmd.sids.length || cmd.fromAsk || cmd.items.some(function(it){ return it.exact && it.exact.length; }));
    var live = ctx && now() - ctx.at < CTX_MS;

    if(cmd.empty) return mode === 'pluto' ? notmine('empty') : cant("I didn't catch that.", 'empty');
    // questions that aren't about the lists belong to someone else
    if(cmd.question && ['read', 'help', 'last'].indexOf(cmd.verb) < 0) return mode === 'pluto' ? notmine('question') : cant('I can only help with orders and the prep list.', 'question');
    if(cmd.verb === 'help'){
      if(mode === 'pluto') return notmine('help');
      return ans('answer', { say: ['I can add, change and take things off your orders and the prep list, tick prep off, read them back, and get an order ready to send.', "Try 'add 2 kilos of mozzarella' or 'pizza sauce is done'."], log: 'help' });
    }
    if(cmd.verb === 'last'){
      var lu = undoList();
      if(!lu.length) return ans('answer', { say: ["I haven't changed anything in the last 10 minutes."], log: 'last none' });
      return ans('answer', { say: [lu[lu.length - 1].label + '.'], log: 'last' });
    }
    if(cmd.verb === 'undo') return await undoNow(null);

    // "make it 3", "take it off", "add another 2", "and a box of pepperoni"
    if(!cmd.items.length && live && ctx.items.length && (cmd.refs || cmd.looseQty || cmd.and) && ['add', 'set', 'remove', 'tick', 'untick', null].indexOf(cmd.verb) > -1){
      var lq = cmd.looseQty;
      var v0 = cmd.verb || (lq ? 'set' : ctx.verb);
      // with a number, it means the last thing named (add 2 mozz and a box of pepperoni, then add another 2)
      var refItems = lq && ctx.items.length > 1 ? ctx.items.slice(-1) : ctx.items;
      cmd.items = refItems.map(function(x){ return { words: [itemSay(x.name)], stems: keyOf(x.name).split(' '), pick: x.id, qty: refItems.length === 1 ? lq : null, verb: v0, verbWords: cmd.verbWords, list: null, sids: [] }; });
      cmd.looseQty = null; cmd.verb = v0; hasCue = true;
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
        if(it0.missing) return mode === 'pluto' ? notmine('read missing') : cant("I couldn't find " + it0.words.join(' ') + '.', 'read missing');
        var e = it0.e;
        if(e.kind === 'order') return ans('answer', { say: [e.qty > 0 ? label(e) + ': ' + amount(e.qty, e.unit) + ' on the ' + supSay(e.sname) + ' order.' : 'No ' + label(e) + ' on the ' + supSay(e.sname) + ' order yet.'], log: 'read item' });
        if(e.kind === 'line') return ans('answer', { say: [itemSay(e.name) + (e.done ? ' is done.' : ' is on the prep list, not done yet.')], log: 'read line' });
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
        if(!doneLines.length) return cant('Nothing on the prep list is ticked off.', 'clear done 0');
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
      return ans('answer', { say: [said], show: { title: said.replace(/^Here’s the |^Here are the /, '').replace(/\.$/, ''), lines: [], open: view }, log: 'open ' + view.view });
    }

    // add, set, remove, tick, untick, or no verb at all
    if(!cmd.items.length){
      if(!v && cmd.sids.length === 1) return readOrder(supplier(cat, cmd.sids[0]));
      if(!v && (cmd.list === 'prep' || cmd.list === 'list')) return readPrep(cat, d);
      if(mode === 'pluto') return notmine('no items');
      if(cmd.refs || cmd.looseQty) return cant('Say what it is, like “make the mozzarella 3”.', 'no context');
      return cant(v === 'remove' ? 'Take off what?' : v === 'tick' || v === 'untick' ? 'Which prep item?' : v ? 'Add what?' : "I didn't catch that.", 'no items');
    }
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
    var a = amounts(cmd);
    if(a) return a;
    return await change(cmd, cat, d);
  }

  /* ---------- the owner answering this room's question ---------- */
  function matchOption(text, options){
    var c = clean(text);
    if(!c || !options || !options.length) return null;
    var yn = yesNo(text);
    if(yn && options.some(function(o){ return o.value === yn; })) return yn;
    if(yn === 'no' && options.some(function(o){ return o.value === 'none'; })) return 'none';
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
    if(p.kind === 'howmany' || p.kind === 'unit'){
      var ns = numbersIn(choice != null ? choice : text);
      if(!ns.length){
        var maybe = parse(text, (await fresh()).cat);
        pending = null;
        if(maybe.verb || maybe.items.length) return run(maybe, req, mode);
        return ans('answer', { say: ['Left it. Nothing changed.'], log: 'howmany dropped' });
      }
      cmd.items[p.item].qtyFix = ns[0];
      cmd.fromAsk = true; pending = null;
      return run(cmd, req, mode);
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
    return run(cmd, req, mode);
  }

  /* ---------- the contract's functions ---------- */
  async function handle(req){
    req = req || {};
    var mode = req.mode === 'tab' ? 'tab' : 'pluto';
    try{
      if(req.reply && pending && req.reply.to === pending.id) return await answerAsk(pending, req, mode);
      if(req.reply && req.reply.choice != null && !req.text){ pending = null; return cant('That one expired. Ask me again.', 'ask expired'); }
      pending = null;
      if(isClose(req.text || '')) return notmine('close');
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
      return await run(parse(req.text || '', f.cat), req, mode);
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
          show: { title: supSay(s.name) + ' order', lines: onOrder(s).slice(0, 6).map(function(p){ return { text: itemSay(p.name) + ' · ' + fmt(+p.qty) + ' ' + p.unit, tone: 'ok' }; }), open: { view: 'ticket', id: s.id } },
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
  version: 'v3.9.2',
  clean: clean, toks: toks, stem: stem, readNumber: readNumber, readQty: readQty, numbersIn: numbersIn, teenTen: teenTen,
  parse: parse, catalogue: catalogue, findItems: findItems, isClose: isClose, yesNo: yesNo,
  amount: amount, itemSay: itemSay, supSay: supSay, sound: sound,
  createRoom: createRoom
};
});

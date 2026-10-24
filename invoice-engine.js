/* Invoices: the rules (invoice-plan.md §3–§6; his order's step 3, 23 Oct 2026).
   An invoice comes in as lines (from his scan, or a CSV in the plan's fixed layout);
   these rules check the arithmetic, work out quantities, read pack sizes from the
   printed names, find each printed name's product (matched once), flag price
   changes, set what was invoiced against what The Pass sent, list credits to chase,
   and compare suppliers on a fair footing. The same way every time: no AI.
   Never confidently wrong: a line that doesn't add up is flagged (with the one safe
   fix the scanner proof used: a total that doesn't add up, when the quantity comes
   out clean, is net + GST), never kept quietly. Phone numbers and emails are never
   kept. Plain rules like move-data.js: no storage, clock, network or page; the page
   hands it what storage holds and keeps what it gives back. Not loaded by the page
   yet (step 2 of the plan's §10). */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoiceEngine = factory();
})(this, function(){
  var COLS = ['row', 'supplier', 'invoice_no', 'date', 'page', 'description', 'unit', 'qty_printed', 'unit_price_ex_gst', 'net_ex_gst', 'gst', 'total', 'note'];
  var DAY = 864e5;

  function cents(v){ return Math.round(Number(v) * 100); }
  function money(c){ return (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2); }
  function round(v, dp){ var f = Math.pow(10, dp); return Math.round(v * f) / f; }
  /* "1,234.50", "$12.90" -> a number; "" -> null; anything else -> NaN (unreadable) */
  function num(s){
    s = String(s == null ? '' : s).trim();
    if(!s) return null;
    var t = s.replace(/[$,\s]/g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  function day(key){ return /^\d{4}-\d{2}-\d{2}$/.test(key || '') ? Date.parse(key + 'T00:00:00Z') : NaN; }

  var EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
  function hasPhone(s){ var m = String(s).match(/\+?\d[\d\s().-]{6,}\d/g) || []; return m.some(function(x){ return !/^\d{4}-\d{2}-\d{2}$/.test(x) && x.replace(/\D/g, '').length >= 8; }); }
  function hasContact(s){ return EMAIL.test(s) || hasPhone(s); }

  /* ---------- the CSV (plan §4) ---------- */
  function csvRows(text){
    var s = String(text == null ? '' : text).replace(/^﻿/, ''), rows = [], row = [], cell = '', q = false;
    for(var i = 0; i < s.length; i++){
      var c = s[i];
      if(q){
        if(c === '"'){ if(s[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if(c === '"' && cell === '') q = true;
      else if(c === ','){ row.push(cell); cell = ''; }
      else if(c === '\n' || c === '\r'){   // a Windows "\r\n" leaves an empty row, skipped below
        row.push(cell); cell = '';
        if(row.some(function(x){ return x.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if(row.some(function(x){ return x.trim() !== ''; })) rows.push(row);
    return rows;
  }

  /* -> { invoice: { supplier, number, date, pages, net, gst, total } | null, lines: [...], prices: [...], problems: [...] }
     Words are kept exactly as printed; numbers parsed; a number that can't be read is null with unreadable: true. */
  function readCSV(text){
    var rows = csvRows(text), out = { invoice: null, lines: [], prices: [], problems: [] };
    if(rows.length && rows[0][0].trim().toLowerCase() === 'row') rows.shift();
    var contact = false;
    rows.forEach(function(r, i){
      var o = {}; COLS.forEach(function(k, j){ o[k] = (r[j] == null ? '' : String(r[j])).trim(); });
      ['description', 'note', 'supplier'].forEach(function(k){ if(hasContact(o[k])){ o[k] = ''; contact = true; } });
      var kind = o.row.toLowerCase(), bad = [];
      function n(k){ var v = num(o[k]); if(v !== v){ bad.push(k); return null; } return v; }
      if(kind === 'invoice'){
        if(out.invoice){ out.problems.push('Row ' + (i + 1) + ': a second totals row.'); return; }
        out.invoice = { supplier: o.supplier, number: o.invoice_no, date: o.date, pages: n('page'), net: n('net_ex_gst'), gst: n('gst'), total: n('total') };
      } else if(kind === 'line'){
        var l = { supplier: o.supplier, number: o.invoice_no, date: o.date, page: n('page'), description: o.description, unit: o.unit,
          qtyPrinted: n('qty_printed'), price: n('unit_price_ex_gst'), net: n('net_ex_gst'), gst: n('gst'), total: n('total'), note: o.note };
        l.unreadable = bad.length > 0 || /unreadable/i.test(o.note);
        out.lines.push(l);
      } else if(kind === 'price'){
        out.prices.push({ supplier: o.supplier, date: o.date, description: o.description, unit: o.unit, price: n('unit_price_ex_gst'), note: o.note });
      } else { out.problems.push('Row ' + (i + 1) + ': "' + o.row.slice(0, 20) + '" isn\'t invoice, line or price.'); return; }
      if(bad.length) out.problems.push('Row ' + (i + 1) + ': can\'t read ' + bad.join(', ') + '.');
      if(o.date && day(o.date) !== day(o.date)) out.problems.push('Row ' + (i + 1) + ': the date isn\'t YYYY-MM-DD.');
    });
    var keys = {};
    out.lines.forEach(function(l){ keys[(l.supplier + '|' + l.number).toLowerCase()] = 1; });
    if(out.invoice) keys[(out.invoice.supplier + '|' + out.invoice.number).toLowerCase()] = 1;
    if(Object.keys(keys).length > 1) out.problems.push('The rows are from more than one invoice.');
    if(contact) out.problems.push('A phone number or email was left out (never kept).');
    return out;
  }

  /* ---------- the checks (plan §6.1–6.3) ---------- */
  /* One line: the quantity (printed, or net ÷ price when it comes out clean: up to 3 decimals that,
     times the price and rounded to the cent, give the net; 16.06 kg × 12.90 = 207.174 -> 207.17),
     net + GST = total, GST 0 or 10%. -> { qty, qtyFrom, weighed, ok, flags, fix } */
  function checkLine(l){
    var flags = [], r = { qty: null, qtyFrom: '', weighed: false, ok: false, flags: flags, fix: null };
    var price = l.price, net = l.net, gst = l.gst, total = l.total;
    if(l.unreadable) flags.push('A number couldn\'t be read: check the invoice.');
    if(price == null || net == null || total == null){ flags.push('A number is missing.'); return r; }
    if(gst == null){ var g = (cents(total) - cents(net)) / 100; if(cents(g) === 0 || cents(g) === Math.round(cents(net) / 10)) gst = g; }
    var clean = false, q;
    if(l.qtyPrinted != null){
      q = l.qtyPrinted; clean = cents(q * price) === cents(net); r.qtyFrom = 'printed';
      if(!clean) flags.push('The quantity × the price (' + money(cents(q * price)) + ') isn\'t the net (' + money(cents(net)) + ').');
    } else if(price > 0){
      q = round(net / price, 3); clean = q > 0 && cents(price * q) === cents(net); r.qtyFrom = 'worked out';
      if(!clean) flags.push('The net ÷ the price doesn\'t give a clean quantity (' + (net / price).toFixed(4) + '): check both.');
    } else flags.push('The price is 0.');
    if(clean){ r.qty = q; r.weighed = Math.round(q) !== q; }
    if(gst != null && cents(net) + cents(gst) !== cents(total)){
      if(clean){ r.fix = { total: (cents(net) + cents(gst)) / 100 }; flags.push('The total ' + money(cents(total)) + ' doesn\'t add up: ' + money(cents(net) + cents(gst)) + '?'); }
      else flags.push('Net + GST isn\'t the total.');
    }
    if(gst != null && cents(gst) !== 0 && Math.abs(cents(gst) - Math.round(cents(net) / 10)) > 1) flags.push('The GST isn\'t 0 or 10% of the net.');
    if(gst == null) flags.push('The GST is missing.');
    r.ok = !flags.length;
    return r;
  }

  /* The whole invoice: every line checked; the lines add up to the printed totals; no page missing.
     -> { lines: [{ line, check }], sums, printed, adds: { net, gst, total }, addsWithFixes, pagesSeen, flags, ok } */
  function checkInvoice(inv){
    inv = inv || {};
    var lines = (inv.lines || []).map(function(l){ return { line: l, check: checkLine(l) }; });
    var flags = [], s = { net: 0, gst: 0, total: 0 }, sf = { total: 0 };
    lines.forEach(function(x){
      s.net += cents(x.line.net || 0); s.gst += cents(x.line.gst || 0); s.total += cents(x.line.total || 0);
      sf.total += cents(x.check.fix ? x.check.fix.total : (x.line.total || 0));
    });
    var p = inv.invoice, adds = { net: null, gst: null, total: null }, withFixes = null;
    var seen = {}; lines.forEach(function(x){ if(x.line.page != null) seen[x.line.page] = 1; });
    var pages = Object.keys(seen).map(Number).sort(function(a, b){ return a - b; });
    if(!p) flags.push('No totals row: is the last page missing?');
    else {
      if(p.net != null) adds.net = s.net === cents(p.net);
      if(p.gst != null) adds.gst = s.gst === cents(p.gst);
      if(p.total != null) adds.total = s.total === cents(p.total);
      if(p.total == null) flags.push('The invoice\'s printed total is missing.');
      else if(!adds.total){
        withFixes = sf.total === cents(p.total);
        flags.push(withFixes ? 'The lines add up to the printed total once the suggested fix is made.'
          : 'The lines come to ' + money(s.total) + ', the invoice says ' + money(cents(p.total)) + ': ' + money(Math.abs(cents(p.total) - s.total)) + (cents(p.total) > s.total ? ' missing' : ' too much') + '.');
      }
      if(adds.gst === false) flags.push('The lines\' GST comes to ' + money(s.gst) + ', the invoice says ' + money(cents(p.gst)) + '.');
      if(p.pages){ for(var n = 1; n <= p.pages; n++) if(!seen[n]) flags.push('Page ' + n + ' has no lines: is it missing?'); }
    }
    if(!lines.length) flags.push('No lines.');
    var bad = lines.filter(function(x){ return !x.check.ok; }).length;
    if(bad) flags.push(bad + ' line' + (bad === 1 ? '' : 's') + ' to check.');
    return { lines: lines, sums: { net: s.net / 100, gst: s.gst / 100, total: s.total / 100 }, printed: p, adds: adds, addsWithFixes: withFixes,
      pagesSeen: pages, flags: flags, ok: !!p && adds.total === true && !bad && lines.length > 0 };
  }

  /* ---------- packs (plan §3) ---------- */
  var UNIT = { kg: ['kg', 1], kgs: ['kg', 1], g: ['kg', 0.001], gr: ['kg', 0.001], gm: ['kg', 0.001], gms: ['kg', 0.001], grams: ['kg', 0.001],
    l: ['L', 1], lt: ['L', 1], ltr: ['L', 1], litre: ['L', 1], litres: ['L', 1], ml: ['L', 0.001] };
  var U = '(kgs?|gms?|grams|gr|g|ltr|lt|litres?|ml|l)';
  /* "12KG" -> 12 kg; "2LT" -> 2 L; "500GR X 12" -> 6 kg; "2x6kg" -> 12 kg; "4.2KG TIN" -> 4.2 kg; none -> null */
  function readPack(desc){
    var s = ' ' + String(desc || '').toLowerCase().replace(/×/g, 'x') + ' ', m, amt, u, n = 1;
    if((m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*' + U + '(?![a-z])').exec(s))){ n = +m[1]; amt = +m[2]; u = m[3]; }
    else if((m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + U + '\\s*x\\s*(\\d+)(?![\\d.])').exec(s))){ amt = +m[1]; u = m[2]; n = +m[3]; }
    else if((m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + U + '(?![a-z])').exec(s))){ amt = +m[1]; u = m[2]; }
    else return null;
    var k = UNIT[u]; if(!k || !(amt > 0) || !(n > 0)) return null;
    return { amount: round(amt * k[1] * n, 4), unit: k[0] };
  }
  /* $ per kg / L / each: a weighed line's price is already per kg; else the pack's price ÷ its amount */
  function perBase(price, pack, billing){
    if(price == null) return null;
    if(billing === 'weight') return round(price, 4);
    if(!pack || !(pack.amount > 0)) return null;
    return round(price / pack.amount, 4);
  }

  /* ---------- matches (plan §3, §7: matched once per printed name, per supplier) ---------- */
  function nameKey(s){ return String(s || '').toUpperCase().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim(); }
  /* v3.11.31: a scan can read a name a little differently each time ("OLVES" for "OLIVES"), so with no exact match,
     the remembered name most like it counts: letters at least 85% the same, the numbers in it identical (so "MOZZA 2KG"
     never takes "MOZZA 12KG"'s match), and clearly the closest (5 points ahead of the next). Marked fuzzy. */
  function lev(a, b){
    var prev = [], cur, i, j;
    for(j = 0; j <= b.length; j++) prev.push(j);
    for(i = 1; i <= a.length; i++){ cur = [i]; for(j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))); prev = cur; }
    return prev[b.length];
  }
  function scanKey(s){ return nameKey(s).replace(/\b[IL](?=\s?(KG|G|GR|L|LT|ML)\b)/g, '1').replace(/(\d)O|O(\d)/g, function(x, p, q){ return p ? p + '0' : '0' + q; }).replace(/[^A-Z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function numbersIn(s){ return (scanKey(s).match(/\d+(?:\.\d+)?/g) || []).join(' '); }
  function findMatch(matches, supplier, description){
    var sk = nameKey(supplier), dk = nameKey(description), hit = null;
    (matches || []).forEach(function(m){ if(!hit && nameKey(m.supplier) === sk && nameKey(m.key || m.description) === dk) hit = m; });
    if(hit) return hit;
    var d = scanKey(description), dn = numbersIn(description), best = null, bs = 0, second = 0;
    (matches || []).forEach(function(m){
      if(nameKey(m.supplier) !== sk || numbersIn(m.key || m.description) !== dn) return;
      var k = scanKey(m.key || m.description), sim = d || k ? 1 - lev(d, k) / Math.max(d.length, k.length) : 0;
      if(sim > bs){ second = bs; bs = sim; best = m; } else if(sim > second) second = sim;
    });
    return best && bs >= 0.85 && bs - second >= 0.05 ? Object.assign({}, best, { fuzzy: true }) : null;
  }
  var SKIP = { the: 1, and: 1, with: 1, for: 1, ctn: 1, pkt: 1, each: 1, tin: 1, bag: 1, box: 1, full: 1, premium: 1, fresh: 1 };
  function words(s){
    return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function(w){ return w.length >= 3 && !SKIP[w] && !UNIT[w]; });
  }
  function close(a, b){ var n = Math.min(a.length, b.length, 5); return n >= 4 ? a.slice(0, n) === b.slice(0, n) : a === b; }
  /* the products most like a printed name, for "match this once": shared words (or the same first 4-5 letters: MOZZA ~ Mozzarella) */
  function suggest(description, products, n){
    var dw = words(description);
    return (products || []).map(function(p){
      var pw = words(p.name), hits = pw.filter(function(w){ return dw.some(function(d){ return close(d, w); }); }).length;
      return { id: p.id, name: p.name, score: pw.length ? hits / pw.length + hits * 0.01 : 0 };
    }).filter(function(x){ return x.score > 0; }).sort(function(a, b){ return b.score - a.score; }).slice(0, n || 3);
  }

  /* ---------- prices (plan §3, §6.4) ---------- */
  /* a kept line -> a price record: price per pack ex GST and $ per base unit, with its date and source */
  function priceRecord(supplier, match, line, date, source){
    var weighed = match && match.billing === 'weight';
    return { supplier: supplier, productId: match ? match.productId : '', pack: match ? match.pack || null : null, billing: weighed ? 'weight' : 'pack',
      price: line.price, perBase: perBase(line.price, match && match.pack, weighed ? 'weight' : 'pack'), date: date || '', source: source || '' };
  }
  /* against the last price for the same product from the same supplier: up / down / same, $ and %, how long ago.
     opts.highlight: the % from which a change stands out (his call; a start: 3) */
  function priceChange(history, rec, opts){
    opts = opts || {};
    var hi = opts.highlight == null ? 3 : opts.highlight, t = day(rec.date), last = null;
    (history || []).forEach(function(h){
      if(h.supplier !== rec.supplier || h.productId !== rec.productId || h === rec || h.once) return;   // against the current price, not a one-off
      var ht = day(h.date); if(t === t && ht === ht && ht >= t) return;
      if(!last || (day(h.date) || 0) > (day(last.date) || 0)) last = h;
    });
    if(!last) return { last: null, dir: 'new' };
    var a = last.perBase != null && rec.perBase != null ? [last.perBase, rec.perBase] : [last.price, rec.price];
    var diff = round(a[1] - a[0], 4), pct = a[0] ? round((a[1] - a[0]) / a[0] * 100, 1) : null;
    return { last: last, dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', diff: diff, pct: pct, by: last.perBase != null && rec.perBase != null ? 'base' : 'pack',
      days: t === t && day(last.date) === day(last.date) ? Math.round((t - day(last.date)) / DAY) : null, highlight: pct != null && Math.abs(pct) >= hi };
  }

  /* v3.11.30 (his picks, 23 Oct): a changed price asks "Approve once" (kept in the history, once: true,
     not the current price) or "Update price" (the current price); a first price is current.
     The current price: the newest record for the product from that supplier that isn't a one-off. */
  function newer(a, b){ var da = day(a.date) || 0, db = day(b.date) || 0; return da !== db ? da > db : (a.at || 0) > (b.at || 0); }
  function currentPrice(history, supplier, productId){
    var cur = null;
    (history || []).forEach(function(h){ if(h.supplier === supplier && h.productId === productId && !h.once && (!cur || newer(h, cur))) cur = h; });
    return cur;
  }
  /* a product's last n deliveries (default 5), newest first, each with its change against the delivery before it
     from the same supplier: { rec, dir: 'up'|'down'|'same'|'first', pct } */
  function historyOf(history, productId, n){
    var all = (history || []).filter(function(h){ return h.productId === productId; }).sort(function(a, b){ return newer(a, b) ? -1 : newer(b, a) ? 1 : 0; });
    return all.slice(0, n || 5).map(function(h, i){
      var prev = all.slice(i + 1).filter(function(x){ return x.supplier === h.supplier; })[0];
      if(!prev) return { rec: h, dir: 'first', pct: null };
      var a = prev.perBase != null && h.perBase != null ? [prev.perBase, h.perBase] : [prev.price, h.price];
      var pct = a[0] ? round((a[1] - a[0]) / a[0] * 100, 1) : null;
      return { rec: h, dir: a[1] > a[0] ? 'up' : a[1] < a[0] ? 'down' : 'same', pct: pct };
    });
  }

  /* ---------- ordered vs invoiced (plan §6.5) ---------- */
  var MEASURE = { kg: 'kg', kgs: 'kg', l: 'L', lt: 'L', ltr: 'L', litre: 'L', litres: 'L' };
  /* The Pass's sent orders to this supplier for the 3 days up to the invoice date (by the day the ticket
     asked for), product by product, against the invoice's matched lines, in kg/L or packs.
     o = { orders, supplierId, date, lines: [{ line, check, match }], products, groupOf(productId) }
     -> [{ kind: 'same'|'more'|'less'|'not invoiced'|'extra'|'different product'|'not matched'|'can\'t compare', … }] */
  function orderedVsInvoiced(o){
    var t = day(o.date), from = t - 3 * DAY, ordered = {}, out = [];
    var prod = {}; (o.products || []).forEach(function(p){ prod[p.id] = p; });
    var group = typeof o.groupOf === 'function' ? o.groupOf : function(){ return ''; };
    (o.orders || []).forEach(function(e){
      var d = day(e.for) === day(e.for) ? day(e.for) : day(e.day);
      if(e.sup !== o.supplierId || !(d >= from && d <= t)) return;
      Object.keys(e.items || {}).forEach(function(id){ ordered[id] = round((ordered[id] || 0) + Number(e.items[id] || 0), 3); });
    });
    var got = {};
    (o.lines || []).forEach(function(x){
      var m = x.match, q = x.check && x.check.qty;
      if(!m){ out.push({ kind: 'not matched', description: x.line.description }); return; }
      var p = prod[m.productId] || {}, measure = MEASURE[String(p.unit || '').toLowerCase()], amount = null, unit = '';
      if(q == null){ out.push({ kind: 'can\'t compare', productId: m.productId, why: 'its quantity didn\'t check out' }); return; }
      if(measure){
        if(m.billing === 'weight'){ amount = q; unit = measure; }
        else if(m.pack && m.pack.unit === measure){ amount = round(q * m.pack.amount, 3); unit = measure; }
      } else if(m.billing !== 'weight'){ amount = q; unit = p.unit || 'each'; }
      if(amount == null){ out.push({ kind: 'can\'t compare', productId: m.productId, why: measure ? 'its pack size isn\'t known' : 'billed by weight, ordered by the ' + (p.unit || 'each') }); return; }
      var g = got[m.productId] || (got[m.productId] = { amount: 0, unit: unit, pack: m.pack || null });
      g.amount = round(g.amount + amount, 3);
    });
    var used = {};   // an ordered product already paired with a different one sent instead
    Object.keys(got).forEach(function(id){
      var g = got[id], want = ordered[id];
      if(want == null){
        var same = Object.keys(ordered).filter(function(oid){ return !got[oid] && !used[oid] && group(oid) && group(oid) === group(id); })[0];
        if(same){ out.push({ kind: 'different product', productId: id, instead: same, ordered: ordered[same], invoiced: g.amount, unit: g.unit }); used[same] = 1; }
        else out.push({ kind: 'extra', productId: id, invoiced: g.amount, unit: g.unit });
        return;
      }
      var kind = cents(g.amount) === cents(want) ? 'same' : g.amount > want ? 'more' : 'less';
      var r = { kind: kind, productId: id, ordered: want, invoiced: g.amount, unit: g.unit };
      if(kind !== 'same' && g.pack && g.unit === g.pack.unit && Math.abs(want / g.pack.amount - Math.round(want / g.pack.amount)) > 1e-6) r.packNote = 'comes as ' + g.pack.amount + ' ' + g.pack.unit;
      out.push(r);
    });
    Object.keys(ordered).forEach(function(id){
      if(got[id] || used[id]) return;
      out.push({ kind: 'not invoiced', productId: id, ordered: ordered[id], unit: (prod[id] || {}).unit || '' });
    });
    return out;
  }

  /* ---------- received (plan §6.6): lines he unticks at bring-in -> credits to chase ---------- */
  function credits(checked, received){
    var list = [], c = 0;
    (checked || []).forEach(function(x, i){
      if(received && received[i] === false){ var tot = x.check && x.check.fix ? x.check.fix.total : x.line.total; list.push({ index: i, description: x.line.description, total: tot }); c += cents(tot || 0); }
    });
    return { lines: list, total: c / 100 };
  }

  /* ---------- suppliers compared (plan §6.7) ---------- */
  /* per item group, the latest price from each supplier in $ per base unit, with its date and source,
     "may be out of date" past 60 days or undated; savings on given quantities only between "same product".
     o = { prices, today, groupOf(productId), grade(productIdA, productIdB) -> 'same product'|'same item, different'|'not comparable', quantities: { group: base amount } } */
  function compareSuppliers(o){
    var t = day(o.today), groups = {};
    (o.prices || []).forEach(function(p){
      var g = typeof o.groupOf === 'function' ? o.groupOf(p.productId) : '';
      if(!g || p.perBase == null) return;
      var k = groups[g] || (groups[g] = {}), cur = k[p.supplier];
      if(!cur || (day(p.date) || 0) > (day(cur.date) || 0)) k[p.supplier] = p;
    });
    return Object.keys(groups).sort().map(function(g){
      var rows = Object.keys(groups[g]).map(function(s){
        var p = groups[g][s], age = day(p.date) === day(p.date) && t === t ? Math.round((t - day(p.date)) / DAY) : null;
        return { supplier: s, productId: p.productId, perBase: p.perBase, unit: p.pack ? p.pack.unit : (p.billing === 'weight' ? 'kg' : 'each'), date: p.date, source: p.source,
          stale: age == null || age > 60, age: age };
      }).sort(function(a, b){ return a.perBase - b.perBase; });
      var res = { group: g, rows: rows, cheapest: rows.length ? rows[0].supplier : '', grade: '', saving: null };
      if(rows.length >= 2){
        res.grade = typeof o.grade === 'function' ? o.grade(rows[0].productId, rows[1].productId) || 'not comparable' : 'not comparable';
        var qty = o.quantities && o.quantities[g];
        if(res.grade === 'same product' && qty > 0) res.saving = round((rows[1].perBase - rows[0].perBase) * qty, 2);
      }
      return res;
    });
  }

  /* ---------- price lists (v3.11.32, 24 Oct: his price sheet; invoice-plan.md §11) ----------
     His sheet's layout: one row per price (an invoice line, an order sheet's price, an app listing), its columns found
     by their names in the first row: supplier, source, date ("undated" or empty: no date, so the oldest), item,
     billed_unit, unit_price_ex_gst (ex GST), qty_billed, net_total_ex_gst, gst (empty = unknown, never 0),
     pack_size_kg_or_l (empty = unknown), price_per_kg_or_l, supplier_code, notes; and, on a sheet Claude has checked
     with him: pass_supplier (his supplier's name, or "prices only" for one not in The Pass), pass_item (his item's
     name, or a new item's), new_under (the supplier a new item goes to) and like (same / similar / different /
     not comparable / check). A weighed price (billed per kg) is per kg; any other is per pack. */
  var LIST_COLS = { supplier: 1, source: 1, date: 1, item: 1, billed_unit: 1, unit_price_ex_gst: 1, qty_billed: 1, net_total_ex_gst: 1, gst: 1,
    pack_size_kg_or_l: 1, price_per_kg_or_l: 1, supplier_code: 1, notes: 1, pass_supplier: 1, pass_item: 1, new_under: 1, like: 1 };
  var LIKES = { same: 'same', similar: 'similar', different: 'different', 'not comparable': 'not comparable', check: 'check' };
  /* names compared loosely: "Michaels Fresh" = "Michael's Fresh", "Dick Stone" = "Dick stone" */
  function looseKey(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  /* -> { ok, why, rows: [{ n (the sheet's line), supplier, source, date, item, unit, price, qty, net, gst, pack, weighed, perBase,
     code, note, passSupplier, passItem, newUnder, like }], problems } */
  function readPriceList(text){
    var rows = csvRows(text), out = { ok: false, why: '', rows: [], problems: [] };
    if(!rows.length){ out.why = 'Nothing pasted.'; return out; }
    var at = {};
    rows[0].forEach(function(h, j){ h = String(h).trim().toLowerCase(); if(LIST_COLS[h] && at[h] == null) at[h] = j; });
    if(at.supplier == null || at.item == null || at.unit_price_ex_gst == null){
      out.why = 'This isn’t a price list in the sheet’s layout (its first row names the columns: supplier, item, unit_price_ex_gst …).';
      return out;
    }
    var contact = false;
    rows.slice(1).forEach(function(r, i){
      var n = i + 2, bad = [];
      function g(k){ return at[k] == null || r[at[k]] == null ? '' : String(r[at[k]]).trim(); }
      function v(k){ var x = num(g(k)); if(x !== x){ bad.push(k); return null; } return x; }
      var o = { n: n, supplier: g('supplier'), source: g('source'), item: g('item'), note: g('notes'), code: g('supplier_code') };
      ['supplier', 'source', 'item', 'note'].forEach(function(k){ if(hasContact(o[k])){ o[k] = ''; contact = true; } });
      if(!o.supplier || !o.item){ out.problems.push('Line ' + n + ': no supplier or item, left out.'); return; }
      var d = g('date').replace(/[ T]00:00(:00)?$/, '');
      if(/^undated$/i.test(d)) d = '';
      if(d && day(d) !== day(d)){ out.problems.push('Line ' + n + ' (' + o.item + '): the date isn’t YYYY-MM-DD, left out.'); return; }
      o.date = d;
      o.unit = g('billed_unit');
      o.price = v('unit_price_ex_gst'); o.qty = v('qty_billed'); o.net = v('net_total_ex_gst'); o.gst = v('gst');
      var size = v('pack_size_kg_or_l'), per = v('price_per_kg_or_l');
      if(o.price == null){ out.problems.push('Line ' + n + ' (' + o.item + '): no price, left out.'); return; }
      if(bad.length) out.problems.push('Line ' + n + ' (' + o.item + '): can’t read ' + bad.join(', ') + '.');
      o.weighed = o.unit.toLowerCase() === 'kg';
      var read = readPack(o.item);
      o.pack = !o.weighed && size > 0 ? { amount: round(size, 4), unit: read ? read.unit : 'kg' } : null;
      o.perBase = perBase(o.price, o.pack, o.weighed ? 'weight' : 'pack');
      if(per != null && o.perBase != null && Math.abs(per - o.perBase) > Math.max(0.01, o.perBase * 0.005))
        out.problems.push('Line ' + n + ' (' + o.item + '): the sheet says ' + money(cents(per)) + ' a kg or L, but the price ÷ the pack is ' + money(cents(o.perBase)) + '. Using ' + money(cents(o.perBase)) + '.');
      o.passSupplier = g('pass_supplier'); o.passItem = g('pass_item'); o.newUnder = g('new_under');
      o.like = LIKES[g('like').toLowerCase()] || '';
      out.rows.push(o);
    });
    if(contact) out.problems.push('A phone number or email was left out (never kept).');
    out.ok = out.rows.length > 0;
    if(!out.ok) out.why = 'No prices found under the first row.';
    return out;
  }
  /* a price-list row -> a price record (the same shape as an invoice's, with the sheet's note, code and GST; via 'list') */
  function listRecord(row, supplierId, productId){
    return { supplier: supplierId, productId: productId, pack: row.pack || null, billing: row.weighed ? 'weight' : 'pack', price: row.price, perBase: row.perBase,
      date: row.date || '', source: row.source || 'price list', note: row.note || '', code: row.code || '', gst: row.gst == null ? null : row.gst, via: 'list' };
  }
  /* the same price kept before (an invoice scanned and the sheet's copy of it): same supplier, product, date and price */
  function samePrice(a, b){
    return !!a && !!b && a.supplier === b.supplier && a.productId === b.productId && (a.date || '') === (b.date || '') && cents(a.price) === cents(b.price);
  }

  /* v3.11.33 (his ask, 24 Oct): a pack size he types for one supplier's item whose pack wasn't known. That supplier's
     price records for the item (priced per pack, no pack yet) gain it and their $ per kg, L or each; so do its matches,
     so later invoices from that supplier work it out too. A weighed price, one with a pack already, another supplier's
     and another item's are left as they are. -> { prices, matches, changed } (new arrays; changed = price records) */
  function setPack(prices, matches, supplier, productId, pack){
    var changed = 0, ok = !!pack && pack.amount > 0 && /^(kg|L|each)$/.test(pack.unit), p = ok ? { amount: round(pack.amount, 4), unit: pack.unit } : null;
    function open(x){ return ok && x && x.supplier === supplier && x.productId === productId && x.billing !== 'weight' && !x.skip && !(x.pack && x.pack.amount > 0); }
    return {
      prices: (prices || []).map(function(r){ if(!open(r)) return r; changed++; return Object.assign({}, r, { pack: { amount: p.amount, unit: p.unit }, perBase: perBase(r.price, p, 'pack') }); }),
      matches: (matches || []).map(function(m){ return open(m) ? Object.assign({}, m, { pack: { amount: p.amount, unit: p.unit } }) : m; }),
      changed: changed   // counted while the prices above were mapped (properties are worked out in order)
    };
  }

  /* v3.11.37 (his pick, 24 Oct: "price + cheaper elsewhere"): one item's current price at each supplier, cheapest per
     kg, L or each first; a price with no pack size (its $ per kg not known) after them. Each row: { supplier, rec,
     perBase, unit ('kg'|'L'|'each'|''), date, age (days, null if undated), stale (undated, or past 60 days) }. */
  function suppliersFor(prices, productId, today){
    var t = day(today), seen = {}, rows = [];
    (prices || []).forEach(function(r){ if(r && r.productId === productId) seen[r.supplier] = 1; });
    Object.keys(seen).forEach(function(s){
      var mine = prices.filter(function(r){ return r && r.supplier === s; });
      var cur = currentPrice(mine, s, productId) || historyOf(mine, productId, 1)[0].rec;
      var age = t === t && day(cur.date) === day(cur.date) ? Math.round((t - day(cur.date)) / DAY) : null;
      rows.push({ supplier: s, rec: cur, perBase: cur.perBase != null ? cur.perBase : null, unit: cur.billing === 'weight' ? 'kg' : cur.pack ? cur.pack.unit : '',
        date: cur.date || '', age: age, stale: age == null || age > 60 });
    });
    return rows.sort(function(a, b){
      if((a.perBase == null) !== (b.perBase == null)) return a.perBase == null ? 1 : -1;
      if(a.unit !== b.unit) return a.unit < b.unit ? -1 : 1;
      return (a.perBase || 0) - (b.perBase || 0);
    });
  }
  /* against one supplier's price for the item: the cheapest other supplier in the same unit, when it's at least 1% less
     -> { mine, row, less } ; when his supplier's $ per kg isn't known (no pack size): { mine, row, unknown: true } with
     the cheapest known one, never called cheaper; else null */
  function cheaperElsewhere(rows, supplier){
    var mine = null;
    (rows || []).forEach(function(r){ if(r.supplier === supplier) mine = r; });
    if(!mine) return null;
    var others = rows.filter(function(r){ return r !== mine && r.perBase != null; });
    if(mine.perBase == null) return others.length ? { mine: mine, row: others[0], unknown: true } : null;
    var best = null;
    others.forEach(function(r){ if(r.unit === mine.unit && r.perBase < mine.perBase * 0.99 && (!best || r.perBase < best.perBase)) best = r; });
    return best ? { mine: mine, row: best, less: round(mine.perBase - best.perBase, 4) } : null;
  }

  /* v3.11.35 (his ask, 24 Oct: a price pasted wrong, "soon enough it will be editable"): a kept price changed by hand.
     c = { price, billing: 'pack'|'weight', pack: { amount, unit } | null (empty = not known), date: 'YYYY-MM-DD' or '' (undated),
     note }. -> { ok, rec } (a new record: $ per kg/L/each worked out again; its supplier, item, source, invoice, once and
     time kept; marked edited) | { ok: false, why }. A phone number or email is never kept in a note. */
  function editPrice(rec, c){
    c = c || {};
    var price = typeof c.price === 'number' ? c.price : num(c.price);
    if(!(price > 0)) return { ok: false, why: 'Type the price' };
    var date = String(c.date == null ? '' : c.date).trim();
    if(date && day(date) !== day(date)) return { ok: false, why: 'That date isn’t a date' };
    var note = String(c.note == null ? '' : c.note).trim().slice(0, 200);
    if(note && hasContact(note)) return { ok: false, why: 'A phone number or email can’t be kept in a note' };
    var weighed = c.billing === 'weight', pack = null, a = c.pack ? c.pack.amount : null;
    if(!weighed && a != null && String(a).trim() !== ''){
      a = typeof a === 'number' ? a : num(a);
      if(!(a > 0) || !/^(kg|L|each)$/.test(c.pack.unit)) return { ok: false, why: 'That pack size isn’t a size' };
      pack = { amount: round(a, 4), unit: c.pack.unit };
    }
    return { ok: true, rec: Object.assign({}, rec || {}, { price: round(price, 4), billing: weighed ? 'weight' : 'pack', pack: pack,
      perBase: perBase(price, pack, weighed ? 'weight' : 'pack'), date: date, note: note, edited: true }) };
  }

  return { COLS: COLS, cents: cents, money: money, num: num, csvRows: csvRows, readCSV: readCSV, checkLine: checkLine, checkInvoice: checkInvoice,
    readPack: readPack, perBase: perBase, nameKey: nameKey, findMatch: findMatch, suggest: suggest, priceRecord: priceRecord, priceChange: priceChange, currentPrice: currentPrice, historyOf: historyOf,
    orderedVsInvoiced: orderedVsInvoiced, credits: credits, compareSuppliers: compareSuppliers, hasContact: hasContact,
    looseKey: looseKey, readPriceList: readPriceList, listRecord: listRecord, samePrice: samePrice, setPack: setPack, editPrice: editPrice, suppliersFor: suppliersFor, cheaperElsewhere: cheaperElsewhere };
});

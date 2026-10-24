/* Invoices: the supplier readers (invoice-plan.md §0 "its own layout"; his order's step 3, 24 Oct 2026).
   The Pluto app's Scan (app 1.25) hands The Pass every page's printed lines and where they sit (Google's
   on-phone text reader); a reader for the supplier's invoice layout turns them into the same lines a
   pasted CSV gives (InvoiceEngine.readCSV's shape), for the same check screen. No AI: the reader finds the
   layout's columns and labels; what it can't read stays empty and the checks flag it, never a guess.
   Only the table's lines and the printed totals are read: bank details, balances and contact lines on a
   page never are. Plain rules: no storage, clock, network or page.
   Aziz (Food Distributors Australia): the reading proof's reader (../Pluto/lab/ocr/read-fda.mjs: 23 of 24
   lines exactly right on his real invoice 83554, the 24th flagged with its fix), plus its invoice number
   ("Tax Invoice: N") and date (under "Date", read like "190CT 2026"). The layout: columns Unit · Unit ex
   GST · Net ex GST · GST · Total; each description printed about one line under its numbers; a description
   over two lines leaves a one-line gap in the number columns. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoiceReaders = factory();
})(this, function(){
  var UNIT = /^(EACH|PKT|KG|CTN|BOX|CASE|BAG|TIN|LT|DOZ)$/;
  var MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

  /* a printed amount as read: "38,00" -> 38.00, "S1,985.06" -> 1985.06, "SI975.76" -> 1975.76, "00" / ".00" -> 0;
     v3.11.40: "A$145.00" (Michael's Fresh) -> 145 */
  function money(t){
    var s = String(t).trim().replace(/^A\s*[S$]/, '').replace(/^[S$]/, '').replace(/[Il]/g, '1').replace(/O/g, '0');
    if(/^\.?0{1,2}$/.test(s)) return 0;
    if(/^\d{1,3}(,\d{3})+\.\d{2}$/.test(s)) s = s.replace(/,/g, '');
    else if(/^\d+,\d{2}$/.test(s)) s = s.replace(',', '.');    // a comma read for the decimal point
    return /^\d+\.\d{2}$/.test(s) ? +s : null;
  }
  /* handwriting glued to the front of a printed (all-capitals) name: "TooSPECK" -> "SPECK" */
  function tidy(s){ return String(s).replace(/^[A-Za-z]*[a-z][A-Za-z]*?(?=[A-Z]{2,})/, '').trim(); }

  /* a page's lines with their centre: { t, x, y } */
  function linesOf(page){
    var out = [];
    ((page && page.blocks) || []).forEach(function(b){ (b.lines || []).forEach(function(l){
      var c = l.corners || [];
      if(c.length !== 4) return;
      out.push({ t: String(l.text || '').trim(), x: (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, y: (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4 });
    }); });
    return out;
  }

  /* ---------- Aziz (Food Distributors Australia) ---------- */
  function fdaRows(lines){
    var units = lines.filter(function(l){ return UNIT.test(l.t); }).sort(function(a, b){ return a.y - b.y; });
    if(!units.length) return [];
    var unitX = units.reduce(function(a, l){ return a + l.x; }, 0) / units.length;
    var gaps = units.slice(1).map(function(u, i){ return u.y - units[i].y; }).sort(function(a, b){ return a - b; });
    var lineH = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 21;
    // the last row has no next row to measure against: room for a two-line description (an unused slot costs little)
    var rows = units.map(function(u, k){ return { unit: u.t, y: u.y, h: k < units.length - 1 ? Math.max(1, Math.round((units[k + 1].y - u.y) / lineH)) : 2, nums: [] }; });
    // the amounts right of the unit column, in columns split where they're far apart
    var amts = lines.filter(function(l){ return l.x > unitX + 40 && money(l.t) != null && l.y > units[0].y - lineH && l.y < units[units.length - 1].y + 2 * lineH; });
    var xs = amts.map(function(a){ return a.x; }).sort(function(a, b){ return a - b; }), cols = [[]];
    xs.forEach(function(x, i){ if(i && x - xs[i - 1] > 40) cols.push([]); cols[cols.length - 1].push(x); });
    var colOf = function(x){ for(var c = 0; c < cols.length; c++) if(x >= cols[c][0] - 1 && x <= cols[c][cols[c].length - 1] + 1) return c; return -1; };
    var byCol = cols.map(function(){ return []; });
    amts.forEach(function(a){ var c = colOf(a.x); if(c >= 0) byCol[c].push(a); });
    var near = function(y){ return rows.reduce(function(best, r){ return Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best; }); };
    // four columns: price, net, GST, total; three (a page with no GST at all): price, net, total
    var field = function(ci){ return cols.length === 3 && ci === 2 ? 3 : ci; };
    byCol.forEach(function(c, col){
      var ci = field(col);
      c.sort(function(a, b){ return a.y - b.y; });
      if(c.length === rows.length){ c.forEach(function(a, k){ rows[k].nums[ci] = money(a.t); }); return; }
      // missing or extra: the nearest row, after this column's usual offset
      var offs = c.map(function(a){ return a.y - near(a.y).y; }).sort(function(a, b){ return a - b; }), off = offs[Math.floor(c.length / 2)] || 0;
      c.forEach(function(a){
        var r = rows.reduce(function(best, r){ return Math.abs(r.y + off - a.y) < Math.abs(best.y + off - a.y) ? r : best; });
        if(Math.abs(r.y + off - a.y) < lineH * 0.6 && r.nums[ci] == null) r.nums[ci] = money(a.t);
      });
    });
    // the descriptions: printed lines left of the units, matched to the rows' printed lines in order, the
    // offset between a description and its numbers changing only slowly down the page (a small alignment)
    var head = lines.filter(function(l){ return /^Description$/i.test(l.t); })[0];
    var descs = lines.filter(function(l){ return l.x < unitX - 60 && /[A-Z]{2}/.test(l.t) && l.y > (head ? head.y + 5 : units[0].y - lineH) && l.y < units[units.length - 1].y + 2.5 * lineH
      && !/^(Description|Continued|Qty|Trade Terms)/i.test(l.t); }).sort(function(a, b){ return a.y - b.y; });
    var slots = [];
    rows.forEach(function(r, k){ for(var j = 0; j < r.h; j++) slots.push({ k: k, y: r.y + j * lineH }); });
    var n = descs.length, m = slots.length, DROP = 25, SKIP = 6, i, j, i2, j2;
    var cost = [], from = [];
    for(i = 0; i < n; i++){ cost.push([]); from.push([]); for(j = 0; j < m; j++){ cost[i].push(Infinity); from[i].push(null); } }
    for(i = 0; i < n; i++) for(j = 0; j < m; j++){
      var off = descs[i].y - slots[j].y;
      if(off < -8 || off > lineH * 1.6) continue;
      var best = DROP * i + SKIP * j + Math.abs(off - lineH * 0.8) * 0.3, arg = null;
      for(i2 = 0; i2 < i; i2++) for(j2 = 0; j2 < j; j2++){
        if(cost[i2][j2] === Infinity) continue;
        var c = cost[i2][j2] + Math.abs(off - (descs[i2].y - slots[j2].y)) + DROP * (i - i2 - 1) + SKIP * (j - j2 - 1);
        if(c < best){ best = c; arg = [i2, j2]; }
      }
      cost[i][j] = best; from[i][j] = arg;
    }
    var end = null, endCost = Infinity;
    for(i = 0; i < n; i++) for(j = 0; j < m; j++) if(cost[i][j] < Infinity){ var e = cost[i][j] + DROP * (n - 1 - i) + SKIP * (m - 1 - j); if(e < endCost){ endCost = e; end = [i, j]; } }
    var got = [];
    for(var p = end; p; p = from[p[0]][p[1]]) got.unshift(p);
    rows.forEach(function(r){ r.desc = []; });
    got.forEach(function(g){ rows[slots[g[1]].k].desc.push(tidy(descs[g[0]].t)); });
    return rows.map(function(r){ return { description: r.desc.join(' '), unit: r.unit, price: r.nums[0], net: r.nums[1], gst: r.nums[2], total: r.nums[3] }; });
  }
  /* a printed total: for its label, the first $ amount (read as S) to its right, from its line down */
  function labelled(lines, re){
    var lb = lines.filter(function(l){ return re.test(l.t); })[0]; if(!lb) return null;
    var c = lines.filter(function(l){ return /^[S$]/.test(l.t) && money(l.t) != null && l.x > lb.x + 120 && l.y >= lb.y - 5; }).sort(function(a, b){ return a.y - b.y; })[0];
    return c ? money(c.t) : null;
  }
  /* "190CT 2026" (the O of OCT read as a zero), "19 OCT 2026", "19/10/2026" -> "2026-10-19"; '' when unreadable */
  function readDate(t){
    var s = String(t || '').toUpperCase().replace(/\s+/g, ''), m;
    if((m = /^(\d{1,2})([0O][A-Z]{2}|[A-Z]{3})(\d{4})$/.exec(s))){
      var mon = MONTHS[m[2].replace(/^0/, 'O')], d = +m[1], y = +m[3];
      if(mon && d >= 1 && d <= 31) return y + '-' + (mon < 10 ? '0' : '') + mon + '-' + (d < 10 ? '0' : '') + d;
    }
    // v3.11.40: in a date of digits, an O read for a zero and an I or L for a one ("31/1O/2026")
    if((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(/^[\dOIL\/.-]+$/.test(s) ? s.replace(/O/g, '0').replace(/[IL]/g, '1') : s)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31)
      return m[3] + '-' + (+m[2] < 10 ? '0' : '') + (+m[2]) + '-' + (+m[1] < 10 ? '0' : '') + (+m[1]);
    return '';
  }
  function fdaDate(lines){
    var lb = lines.filter(function(l){ return /^Date$/i.test(l.t); })[0]; if(!lb) return '';
    var under = lines.filter(function(l){ return l !== lb && Math.abs(l.x - lb.x) < 80 && l.y > lb.y + 4 && l.y < lb.y + 45; }).sort(function(a, b){ return a.y - b.y; });
    for(var i = 0; i < under.length; i++){ var d = readDate(under[i].t); if(d) return d; }
    return '';
  }
  var FDA = {
    name: 'Food Distributors Australia',
    detect: function(pages){
      return pages.some(function(p){ return p.some(function(l){ return /food\s*distrib/i.test(l.t); }); })
        || pages.some(function(p){ return p.some(function(l){ return /^Tax\s*Invoice\s*:/i.test(l.t); }) && p.some(function(l){ return /^Operator$/i.test(l.t); }); });
    },
    read: function(pages){
      var number = '', date = '', totals = null, lines = [], problems = [];
      pages.forEach(function(p, pi){
        p.forEach(function(l){ var m = /^Tax\s*Invoice\s*:?\s*(\d{3,})/i.exec(l.t); if(m && !number) number = m[1]; });
        if(!date) date = fdaDate(p);
        var rows = fdaRows(p);
        if(!rows.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        rows.forEach(function(r){ lines.push({ page: pi + 1, description: r.description || '(not read)', unit: r.unit, price: r.price, net: r.net, gst: r.gst, total: r.total }); });
        var tot = labelled(p, /^Total Invoice/i);
        if(tot != null) totals = { net: labelled(p, /^Total Ex GST/i), gst: labelled(p, /^Total GST/i), total: tot };
      });
      if(!number) problems.push('The invoice number wasn\'t read.');
      if(!date) problems.push('The invoice date wasn\'t read.');
      return { number: number, date: date, totals: totals, lines: lines, problems: problems };
    }
  };
  /* ---------- Michael's Fresh (v3.11.40, from his photo of invoice 210256, 24 Oct 2026) ----------
     One page: the name at the top; "INVOICE NO. N"; "DATE dd/mm/yyyy" (never the DUE DATE); a table QTY · ITEM ·
     RATE · AMOUNT, an item's unit its first word (KG, Box, Bunch, Punnet, Tray, Pack); "BALANCE DUE A$N". Fresh
     produce: no GST column (the checks take it as 0 when the amount is the net). As the text reader read his photo:
     some quantities glued to the item ("24 Bunch Chive"), some not read at all (then the checks work them out from
     amount ÷ rate, as Aziz's), the page a little tilted (a row's numbers higher on the right). So the rows are the
     AMOUNT column's, and everything else is placed on a row by its height corrected for the tilt of the header row.
     The phone number and email at the top are never read. */
  var MF_UNIT = /^(KG|KGS|BOX|BUNCH|PUNNET|TRAY|PACK|PKT|CTN|BAG|EACH|CASE|TUB|DOZ|DOZEN|BTL|BOTTLE)$/i;
  function median(a){ var s = a.slice().sort(function(x, y){ return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  function mfRows(lines){
    var first = function(re){ return lines.filter(function(l){ return re.test(l.t); })[0]; };
    var hA = first(/^AMOUNT$/i), hR = first(/^RATE$/i), hQ = first(/^(QTY(\s+ITEM)?|ITEM)$/i);
    if(!hA || !hR || hA.x - hR.x < 100) return null;
    var from = hQ && Math.abs(hA.x - hQ.x) > 200 ? hQ : hR;
    var slope = Math.max(-0.15, Math.min(0.15, (hA.y - from.y) / (hA.x - from.x)));
    var yc = function(l){ return l.y - slope * l.x; };
    var top = Math.max(yc(hA), yc(hR), hQ ? yc(hQ) : -Infinity);
    var foot = lines.filter(function(l){ return /^(TOTAL|BALANCE\s+DUE|AMOUNT\s+DUE)$/i.test(l.t) && yc(l) > top; }).map(yc).sort(function(a, b){ return a - b; })[0];
    var bottom = foot == null ? Infinity : foot;
    var half = (hA.x - hR.x) / 2;
    var inTable = function(l){ var v = yc(l); return v > top + 5 && v < bottom - 15; };
    var amts = lines.filter(function(l){ return inTable(l) && money(l.t) != null && Math.abs(l.x - hA.x) < half; }).sort(function(a, b){ return yc(a) - yc(b); });
    var gap = amts.length > 1 ? median(amts.slice(1).map(function(a, i){ return yc(a) - yc(amts[i]); })) : 60;
    amts = amts.filter(function(a){ return yc(a) < bottom - gap * 0.5; });   // never the balance's own amount
    var rows = amts.map(function(a){ return { y: yc(a), amount: money(a.t), rate: null, texts: [] }; });
    var rates = lines.filter(function(l){ return inTable(l) && money(l.t) != null && Math.abs(l.x - hR.x) < Math.min(half, 300); });
    var texts = lines.filter(function(l){ return inTable(l) && l.x < hR.x - 100 && !/^(QTY|ITEM|RATE|AMOUNT)\b/i.test(l.t) && l.t; });
    // a column's usual height offset from its row (each column sits a little differently), then the nearest row
    var place = function(list, put){
      var near = function(v){ return rows.reduce(function(b, r){ return !b || Math.abs(r.y - v) < Math.abs(b.y - v) ? r : b; }, null); };
      var off = rows.length ? median(list.map(function(l){ return yc(l) - near(yc(l)).y; })) : 0, left = [];
      list.forEach(function(l){ var r = rows.length ? near(yc(l) - off) : null; if(r && Math.abs(yc(l) - off - r.y) < gap * 0.5) put(r, l); else left.push(l); });
      return left;
    };
    // the item lines grouped into printed rows (a row's words can come as two lines)
    var trows = [];
    texts.slice().sort(function(a, b){ return yc(a) - yc(b); }).forEach(function(l){
      var last = trows[trows.length - 1];
      if(last && yc(l) - yc(last[0]) < gap * 0.5) last.push(l); else trows.push([l]);
    });
    // as many of each as there are amounts: paired top to bottom (a small tilt misjudged can't shift a row);
    // otherwise (something not read) each by its height
    if(rates.length === rows.length) rates.slice().sort(function(a, b){ return yc(a) - yc(b); }).forEach(function(l, k){ rows[k].rate = money(l.t); });
    else place(rates, function(r, l){ if(r.rate == null) r.rate = money(l.t); });
    var orphans = [];
    if(trows.length === rows.length) trows.forEach(function(g, k){ rows[k].texts = g.slice(); });
    else orphans = place(texts, function(r, l){ r.texts.push(l); });
    // words on no amount's row: a line whose amount wasn't read; kept with its numbers empty (the checks flag it)
    orphans.sort(function(a, b){ return yc(a) - yc(b); }).forEach(function(l){
      var r = rows.filter(function(x){ return x.amount == null && Math.abs(x.y - yc(l)) < gap * 0.5; })[0];
      if(r) r.texts.push(l); else rows.push({ y: yc(l), amount: null, rate: null, texts: [l] });
    });
    rows.sort(function(a, b){ return a.y - b.y; });
    return rows.map(function(r){
      var t = r.texts.slice().sort(function(a, b){ return a.x - b.x; }).map(function(l){ return l.t; }), qty = null, m;
      if(t.length > 1 && /^\d+(\.\d+)?$/.test(t[0])) qty = +t.shift();
      else if(t.length && (m = /^(\d+(?:\.\d+)?)\s+(\S.*)$/.exec(t[0]))){ qty = +m[1]; t[0] = m[2]; }
      var desc = t.join(' ').replace(/^(KG)(?=[A-Z][a-z])/i, '$1 ').replace(/\s+/g, ' ').trim();
      var w = (desc.split(' ')[0] || '').toUpperCase();
      return { description: desc, unit: MF_UNIT.test(w) ? (w === 'KGS' ? 'KG' : w) : 'EACH', qty: qty, price: r.rate, net: r.amount, gst: null, total: r.amount };
    });
  }
  var MF = {
    name: 'Michaels Fresh',
    // the name at the top, its first letter maybe cut by the photo's edge; never its email
    detect: function(pages){ return pages.some(function(p){ return p.some(function(l){ return /(^|\s)M?ICHAEL'?S\s*FRESH\b/i.test(l.t) && !/@/.test(l.t); }); }); },
    read: function(pages){
      var number = '', date = '', totals = null, lines = [], problems = [];
      pages.forEach(function(p, pi){
        p.forEach(function(l){
          var m = /INVOICE\s*NO\.?\s*:?\s*(\d{3,})/i.exec(l.t); if(m && !number) number = m[1];
          if(!date && (m = /^(?:INVOICE\s+)?DATE\b\s*:?\s*(\S.*)$/i.exec(l.t))) date = readDate(m[1]);
        });
        var rows = mfRows(p);
        if(rows == null){ problems.push('Page ' + (pi + 1) + ': the table\'s RATE and AMOUNT columns weren\'t read.'); return; }
        if(!rows.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        rows.forEach(function(r){ lines.push({ page: pi + 1, description: r.description || '(not read)', unit: r.unit, qty: r.qty, price: r.price, net: r.net, gst: null, total: r.total }); });
        var lb = p.filter(function(l){ return /^TOTAL$/i.test(l.t); })[0] || p.filter(function(l){ return /^BALANCE\s+DUE$/i.test(l.t); })[0];
        if(lb){
          var v = p.filter(function(l){ return l.x > lb.x + 120 && money(l.t) != null && Math.abs(l.y - lb.y) < 60; }).sort(function(a, b){ return Math.abs(a.y - lb.y) - Math.abs(b.y - lb.y); })[0];
          if(v) totals = { net: null, gst: null, total: money(v.t) };
        }
      });
      if(!number) problems.push('The invoice number wasn\'t read.');
      if(!date) problems.push('The invoice date wasn\'t read.');
      return { number: number, date: date, totals: totals, lines: lines, problems: problems };
    }
  };
  var READERS = [FDA, MF];

  /* the scan's pages -> { ok, reader, parsed: { invoice, lines, prices, problems } (InvoiceEngine.readCSV's shape), why } */
  function read(pages){
    var ps = (Array.isArray(pages) ? pages : []).map(linesOf);
    if(!ps.length || ps.every(function(p){ return !p.length; })) return { ok: false, why: 'No words were read from the scan: try again in better light, flat.' };
    var reader = READERS.filter(function(r){ return r.detect(ps); })[0];
    if(!reader) return { ok: false, why: 'The Pass can\'t read this supplier\'s invoices yet (only Aziz\'s and Michael\'s Fresh\'s so far). Paste a Claude chat\'s CSV instead.' };
    var r = reader.read(ps), sup = reader.name;
    var lines = r.lines.map(function(l){
      var v = function(x){ return x == null ? null : x; };   // an empty column is null, as a CSV's would be
      return { supplier: sup, number: r.number, date: r.date, page: l.page, description: l.description, unit: l.unit, qtyPrinted: l.qty == null ? null : l.qty,   // v3.11.40: a printed quantity (Michael's Fresh)
        price: v(l.price), net: v(l.net), gst: v(l.gst), total: v(l.total), note: '', unreadable: l.price == null || l.net == null || l.total == null };
    });
    var invoice = r.totals ? { supplier: sup, number: r.number, date: r.date, pages: ps.length, net: r.totals.net, gst: r.totals.gst, total: r.totals.total } : null;
    if(!invoice) r.problems.push('The printed totals weren\'t read: is the last page in the scan?');
    return { ok: lines.length > 0, reader: sup, why: lines.length ? '' : 'No invoice lines were read from the scan.', parsed: { invoice: invoice, lines: lines, prices: [], problems: r.problems } };
  }

  return { read: read, money: money, tidy: tidy, readDate: readDate, linesOf: linesOf };
});

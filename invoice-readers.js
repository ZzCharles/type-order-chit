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
     v3.11.40: "A$145.00" (Michael's Fresh) -> 145; v3.11.52 (his 210514 read as $2 on the phone): "A$ 51.50", "A51.50" */
  function money(t){
    var s = String(t).trim(), cur = /^(A\s*)?[S$]/.test(s);
    s = s.replace(/^A\s*[S$]?\s*(?=[\dIlO])/, '').replace(/^[S$]\s*/, '').replace(/[Il]/g, '1').replace(/O/g, '0');
    if(cur && /^\d+ \d{2}$/.test(s)) s = s.replace(' ', '.');   // "A$51 50": one amount (its $ says so), the point read as a space
    if(/^\.?0{1,2}$/.test(s)) return 0;
    if(/^\d{1,3}(,\d{3})+\.\d{2}$/.test(s)) s = s.replace(/,/g, '');
    else if(/^\d+,\d{2}$/.test(s)) s = s.replace(',', '.');    // a comma read for the decimal point
    return /^\d+\.\d{2}$/.test(s) ? +s : null;
  }
  /* handwriting glued to the front of a printed (all-capitals) name: "TooSPECK" -> "SPECK" */
  function tidy(s){ return String(s).replace(/^[A-Za-z]*[a-z][A-Za-z]*?(?=[A-Z]{2,})/, '').trim(); }

  /* a page's lines with their centre: { t, x, y }; v3.11.46: and their width and height (w, h);
     v3.11.56: and the slope of the line's own top edge (s: down per across; a photo that leans tilts every line) */
  function linesOf(page){
    var out = [], len = function(a, b){ return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); };
    ((page && page.blocks) || []).forEach(function(b){ (b.lines || []).forEach(function(l){
      var c = l.corners || [];
      if(c.length !== 4) return;
      out.push({ t: String(l.text || '').trim(), x: (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, y: (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4, w: len(c[0], c[1]), h: len(c[0], c[3]),
        s: c[1][0] !== c[0][0] ? (c[1][1] - c[0][1]) / (c[1][0] - c[0][0]) : 0 });
    }); });
    return out;
  }
  /* v3.11.56: how much the page leans: the middle slope of its longer lines (a word or two can sit crooked), never past
     about 6 degrees; 0 when there's no slope to read (an older reading) */
  function leanOf(lines){
    var s = lines.filter(function(l){ return l.t.length >= 6 && isFinite(l.s); }).map(function(l){ return l.s; });
    return Math.max(-0.1, Math.min(0.1, median(s)));
  }

  /* ---------- Aziz (Food Distributors Australia) ---------- */
  function fdaRows(lines){
    /* v3.11.56 (his 83653 of 30 Oct, a photo leaning 0.65 degrees: each name sat up to 16 px above its own numbers, and
       the window below allowed only 8 px, so every name went on the line above): heights are read as if the page
       were straight (each line raised by its distance across times the lean), and the window is a share of a row */
    var lean = leanOf(lines);
    lines = lines.map(function(l){ return { t: l.t, x: l.x, y: l.y - lean * l.x }; });
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
      if(off < -Math.max(8, lineH * 0.4) || off > lineH * 1.6) continue;   // v3.11.56: 8 px was a fifth of a row on a sharp photo
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
    var out = rows.map(function(r){ return { description: r.desc.join(' '), unit: r.unit, price: r.nums[0], net: r.nums[1], gst: r.nums[2], total: r.nums[3] }; });
    /* v3.11.52 (his 83653 of 30 Oct, the names a little above their numbers: the first name wasn't placed, every other one
       went on the line above its own, the last line had none, and the checks were clean): a name left over and a line
       left without one means the names slid */
    out.lost = got.length < n && rows.some(function(r){ return !r.desc.length; });
    return out;
  }
  /* a printed total: for its label, the first $ amount (read as S) to its right, from its line down */
  function labelled(lines, re){
    var lb = lines.filter(function(l){ return re.test(l.t); })[0]; if(!lb) return null;
    var c = lines.filter(function(l){ return /^[S$]/.test(l.t) && money(l.t) != null && l.x > lb.x + 120 && l.y >= lb.y - 5; }).sort(function(a, b){ return a.y - b.y; })[0];
    return c ? money(c.t) : null;
  }
  /* v3.11.44 (his photos of 29 Oct, invoices 83466 and 83634: one page each, leaning the other way from 83554, so each
     amount sat a little above its label and "the first amount from its line down" was the next label's): the printed
     totals as three amounts in a row (Total Ex GST, Total GST, Total Invoice) where the first two add up to the third,
     whichever way the photo leans; null when no three do, or more than one three do (then as before) */
  function fdaFooter(lines){
    var labels = lines.filter(function(l){ return /^(Freight Ex GST|Total Ex GST|Total GST|Total Invoice|Outstanding Balance)/i.test(l.t); });
    if(!labels.some(function(l){ return /^Total Invoice/i.test(l.t); })) return null;
    var lx = Math.min.apply(null, labels.map(function(l){ return l.x; }));
    var top = Math.min.apply(null, labels.map(function(l){ return l.y; })) - 40, bot = Math.max.apply(null, labels.map(function(l){ return l.y; })) + 40;
    var vals = lines.filter(function(l){ return /^[S$]/.test(l.t) && money(l.t) != null && l.x > lx + 120 && l.y > top && l.y < bot; })
      .sort(function(a, b){ return a.y - b.y; }).map(function(l){ return money(l.t); });
    var found = [];
    for(var k = 0; k + 2 < vals.length; k++) if(vals[k + 2] > 0 && Math.abs(vals[k] + vals[k + 1] - vals[k + 2]) < 0.005) found.push({ net: vals[k], gst: vals[k + 1], total: vals[k + 2] });
    return found.length === 1 ? found[0] : null;
  }
  /* "190CT 2026" (the O of OCT read as a zero), "19 OCT 2026", "19/10/2026" -> "2026-10-19"; '' when unreadable */
  function readDate(t){
    var s = String(t || '').toUpperCase().replace(/\s+/g, ''), m;
    if((m = /^(\d{1,2})([0O][A-Z]{2}|[A-Z]{3})(\d{4})$/.exec(s))){
      var mon = MONTHS[m[2].replace(/^0/, 'O')], d = +m[1], y = +m[3];
      if(mon && d >= 1 && d <= 31) return y + '-' + (mon < 10 ? '0' : '') + mon + '-' + (d < 10 ? '0' : '') + d;
    }
    // v3.11.40: in a date of digits, an O read for a zero and an I or L for a one ("31/1O/2026"); v3.11.46: a two-digit year ("26/10/26", Dick Stone's)
    if((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})$/.exec(/^[\dOIL\/.-]+$/.test(s) ? s.replace(/O/g, '0').replace(/[IL]/g, '1') : s)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31)
      return (m[3].length === 2 ? '20' : '') + m[3] + '-' + (+m[2] < 10 ? '0' : '') + (+m[2]) + '-' + (+m[1] < 10 ? '0' : '') + (+m[1]);
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
        if(rows.lost) problems.push(NAMES_LOST);   // v3.11.52: every line on the page says so
        rows.forEach(function(r){ lines.push({ page: pi + 1, description: r.description || '(not read)', unit: r.unit, price: r.price, net: r.net, gst: r.gst, total: r.total, nameDoubt: !!rows.lost }); });
        var tot = labelled(p, /^Total Invoice/i);
        if(tot != null) totals = { net: labelled(p, /^Total Ex GST/i), gst: labelled(p, /^Total GST/i), total: tot };
        var adds = fdaFooter(p);   // v3.11.44: three that add up win
        if(adds) totals = adds;
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
  // v3.11.52 (his invoices of 30 Oct): said when a reader lost its place pairing names with numbers; each line is flagged too
  var NAMES_LOST = 'The scan lost its place matching names to numbers, so names may be on the wrong lines: check each line against the paper (tap its numbers to fix them).';
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
    var rates = lines.filter(function(l){ return inTable(l) && money(l.t) != null && Math.abs(l.x - hR.x) < Math.min(half, 300); });
    var texts = lines.filter(function(l){ return inTable(l) && l.x < hR.x - 100 && !/^(QTY|ITEM|RATE|AMOUNT)\b/i.test(l.t) && l.t; });
    /* v3.11.56 (his phone's scan of 210358, 30 Oct: "KG Lemon 6 Buncth Chive", two items read as one line, and every name
       below it on the row above's numbers): a line holding two items is tried as two, one row apart, the second a row
       down or the first a row up (the joined line's height can't say which). The rows' own sums decide: a quantity
       times its rate is its amount. The way with the most sums that work, and none broken, is kept; as read when
       nothing is better (then flagged as before). */
    var tries = [{ texts: texts, split: 0 }].concat(mfSplits(texts, gap)), best = null;
    tries.forEach(function(tr){ var o = fill(tr.texts), s = mfSums(o); if(!best || s > best.s) best = { o: o, s: s, split: tr.split }; });
    var out = best.o;
    // split, but the other way works as well: which line went where isn't known (flagged)
    out.doubt = !!best.split && tries.some(function(tr){ return tr.split && tr.split !== best.split && mfSums(fill(tr.texts)) === best.s; });
    out.split = best.split;
    out.amts = amts;   // v3.11.52: the amounts that are rows (never the balance)
    return out;
    function fill(texts){
      var rows = amts.map(function(a){ return { y: yc(a), amount: money(a.t), rate: null, texts: [] }; });
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
      var out = rows.map(function(r){
        var t = r.texts.slice().sort(function(a, b){ return a.x - b.x; }).map(function(l){ return l.t; }), qty = null, m;
        if(t.length > 1 && /^\d+(\.\d+)?$/.test(t[0])) qty = +t.shift();
        else if(t.length && (m = /^(\d+(?:\.\d+)?)\s+(\S.*)$/.exec(t[0]))){ qty = +m[1]; t[0] = m[2]; }
        var desc = t.join(' ').replace(/^(KG)(?=[A-Z][a-z])/i, '$1 ').replace(/\s+/g, ' ').trim();
        var w = (desc.split(' ')[0] || '').toUpperCase();
        return { description: desc, unit: MF_UNIT.test(w) ? (w === 'KGS' ? 'KG' : w) : 'EACH', qty: qty, price: r.rate, net: r.amount, gst: null, total: r.amount,
          merged: mfMerged(desc) };
      });
      return out;
    }
  }
  /* v3.11.56: the ways to read lines holding two items as two (none: []): every such line split where the second item
     starts (its quantity, or its unit word after the first item's words), the second half a row down or the first half
     a row up. split: 1 down, 2 up. Up to two such lines on a page; more is left as read (and flagged). */
  var MF_SPLIT_QTY = /^(.*?[A-Za-z])\s+(\d+(?:\.\d+)?\s+[A-Za-z].*)$/;
  function mfSplitAt(t){
    var m = MF_SPLIT_QTY.exec(t);
    if(m) return [m[1], m[2]];
    var w = String(t).split(/\s+/);
    for(var i = 1; i < w.length; i++) if(MF_UNIT.test(w[i]) && !/^\d/.test(w[i - 1])) return [w.slice(0, i).join(' '), w.slice(i).join(' ')];
    return null;
  }
  function mfSplits(texts, gap){
    var two = texts.filter(function(l){ return mfMerged(l.t) && mfSplitAt(l.t); });
    if(!two.length || two.length > 2) return [];
    return [1, 2].map(function(way){
      var out = [];
      texts.forEach(function(l){
        if(two.indexOf(l) < 0){ out.push(l); return; }
        var p = mfSplitAt(l.t), dy = way === 1 ? [0, gap] : [-gap, 0];
        out.push({ t: p[0], x: l.x, y: l.y + dy[0] }, { t: p[1], x: l.x, y: l.y + dy[1] });
      });
      return { texts: out, split: way };
    });
  }
  /* the rows' sums: each with a quantity, a rate and an amount where quantity × rate is the amount counts 1; one where
     it isn't counts −2 (a broken sum is stronger evidence than a sum that works by chance) */
  function mfSums(rows){
    return rows.reduce(function(a, r){
      if(r.qty == null || r.price == null || r.net == null) return a;
      return a + (Math.abs(round2(r.qty * r.price) - r.net) < 0.015 ? 1 : -2);
    }, 0);
  }
  /* v3.11.52 (his phone's scan of 210358, 30 Oct: "KG Lemon 6 Buncth Chive", and every name below it on the row above's
     numbers): two items read as one line, a quantity and a word, or an item's unit word, after its start */
  function mfMerged(desc){
    var w = String(desc || '').split(' ');
    return /[A-Za-z]\s+\d+(?:\.\d+)?\s+[A-Za-z]/.test(String(desc || '')) || w.slice(1).some(function(x){ return MF_UNIT.test(x); });
  }
  var MF = {
    name: 'Michaels Fresh',
    // the name at the top, its first letter maybe cut by the photo's edge; never its email
    detect: function(pages){ return pages.some(function(p){ return p.some(function(l){ return /(^|\s)M?ICHAEL'?S\s*FRESH\b/i.test(l.t) && !/@/.test(l.t); }); }); },
    read: function(pages){
      var number = '', date = '', totals = null, lines = [], problems = [];
      pages.forEach(function(p, pi){
        p.forEach(function(l){
          var m = /INVOICE\s*NO[.,]?\s*:?\s*(\d{3,})/i.exec(l.t); if(m && !number) number = m[1];   // v3.11.52: "INVOICE NO, 210514"
          if(!date && (m = /^(?:INVOICE\s+)?DATE\b\s*:?\s*(\S.*)$/i.exec(l.t))) date = readDate(m[1]);
        });
        var rows = mfRows(p);
        if(rows == null){ problems.push('Page ' + (pi + 1) + ': the table\'s RATE and AMOUNT columns weren\'t read.'); return; }
        if(!rows.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        // v3.11.52: two items read as one line put names on other lines' numbers (pairs by order, or by a misjudged height):
        // every line on the page says its name may be on the wrong line
        var lost = rows.some(function(r){ return r.merged; }) || !!rows.doubt;   // v3.11.56: or split, but either way works
        if(lost) problems.push(NAMES_LOST);
        rows.forEach(function(r){ lines.push({ page: pi + 1, description: r.description || '(not read)', unit: r.unit, qty: r.qty, price: r.price, net: r.net, gst: null, total: r.total, nameDoubt: lost }); });
        var lb = p.filter(function(l){ return /^TOTAL$/i.test(l.t); })[0] || p.filter(function(l){ return /^BALANCE\s+DUE$/i.test(l.t); })[0];
        if(lb){
          // v3.11.52 (his 210514, read as $2.00 on the phone): never a line's own amount (the last line's can sit just above
          // the balance on a small scan); nothing else found: the total isn't read, and that's said
          var v = p.filter(function(l){ return l.x > lb.x + 120 && money(l.t) != null && Math.abs(l.y - lb.y) < 60 && (rows.amts || []).indexOf(l) < 0; })
            .sort(function(a, b){ return Math.abs(a.y - lb.y) - Math.abs(b.y - lb.y); })[0];
          if(v) totals = { net: null, gst: null, total: money(v.t) };
        }
      });
      // v3.11.44 (his invoice 210358, 29 Oct: an item's name printed on two lines, "Sliced Swiss / Brown Mushroom"):
      // words on no amount's row join the item above, only when the amounts read add up exactly to the printed balance
      // (so no item's numbers are missing); otherwise they stay a line of their own, empty, for the checks to flag
      if(totals && totals.total != null && Math.abs(lines.reduce(function(a, l){ return a + (l.total || 0); }, 0) - totals.total) < 0.005){
        lines = lines.reduce(function(out, l){
          var prev = out[out.length - 1];
          if(prev && prev.page === l.page && prev.total != null && l.price == null && l.net == null && l.total == null && l.qty == null && l.description !== '(not read)'){
            prev.description = (prev.description + ' ' + l.description).replace(/\s+/g, ' ').trim();
            return out;
          }
          out.push(l);
          return out;
        }, []);
      }
      if(!number) problems.push('The invoice number wasn\'t read.');
      if(!date) problems.push('The invoice date wasn\'t read.');
      return { number: number, date: date, totals: totals, lines: lines, problems: problems };
    }
  };
  /* ---------- v3.11.46: Dick Stone, Highland Poultry and Two Providores (his photos of invoices 846508, 17502 and
     756622, 26–28 Oct 2026: one of each, so each waits on a second photo before it's trusted) ----------
     What the three share. The text reader often reads several columns as one line ("3.73 KG", "13.20 FRE",
     "18.85 188.50 0.00 188.5("), so each word gets its own place: its share of the line's width. The columns are
     found by their headings' words; the rows by the line amounts; every other column's words are grouped into
     printed rows and paired with them top to bottom when there are as many (so a tilt, a curl, or a column printed
     half a line higher, as Dick Stone's amounts are, can't shift a row), otherwise by height after that column's
     usual offset. Only the table and the printed totals are read: never bank details, balances, phones or emails. */
  var UNITS = { EA: 'EACH', EACH: 'EACH', KG: 'KG', KGS: 'KG', CTN: 'CTN', CTNS: 'CTN', BOX: 'BOX', PKT: 'PKT', PK: 'PKT', PACK: 'PACK',
    BAG: 'BAG', TUB: 'TUB', TIN: 'TIN', BTL: 'BTL', LT: 'LT', DOZ: 'DOZ', CASE: 'CASE', TRAY: 'TRAY', BUNCH: 'BUNCH', PUNNET: 'PUNNET' };
  function unitOf(t){ return UNITS[String(t).toUpperCase().replace(/\.$/, '')] || ''; }
  function round2(v){ return Math.round(v * 100) / 100; }
  function digits(t){ var m = /^\s*(\d{3,})\s*$/.exec(t); return m ? m[1] : ''; }
  function isNum(t){ return /^\d+(\.\d+)?$/.test(t); }
  /* the supplier's name printed on the page: never in an email or web address (another supplier may write to them) */
  function named(pages, re){ return pages.some(function(p){ return p.some(function(l){ return re.test(l.t) && !/@|\.com|www\./i.test(l.t); }); }); }
  /* a line's words, each placed at its share of the line's width */
  function wordsOf(l){
    var out = [], re = /\S+/g, m, n = l.t.length || 1, w = l.w || 0, left = l.x - w / 2;
    while((m = re.exec(l.t))) out.push({ t: m[0], x: left + (m.index + m[0].length / 2) / n * w, y: l.y, w: m[0].length / n * w, line: l });
    return out;
  }
  /* a page's words, its usual line height and its width */
  function kit(lines){
    var ws = [].concat.apply([], lines.map(wordsOf)), xs = ws.map(function(w){ return w.x; });
    return { lines: lines, ws: ws, th: median(lines.map(function(l){ return l.h || 0; }).filter(function(h){ return h > 0; })) || 14,
      span: xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 1000, slope: 0, yc: function(o){ return o.y; } };
  }
  /* a heading's word, within a few lines' height of another heading (near): the nearest in height */
  function head(k, re, near, ok){
    return k.ws.filter(function(w){ return re.test(w.t) && Math.abs(w.y - near.y) < k.th * 4 && (!ok || ok(w)); })
      .sort(function(a, b){ return Math.abs(a.y - near.y) - Math.abs(b.y - near.y); })[0] || null;
  }
  /* the page's tilt from its headings (the median slope between headings far apart), at most 1 in 7 */
  function tilt(k, hs){
    var s = [];
    for(var i = 0; i < hs.length; i++) for(var j = i + 1; j < hs.length; j++) if(Math.abs(hs[j].x - hs[i].x) > k.span / 4) s.push((hs[j].y - hs[i].y) / (hs[j].x - hs[i].x));
    k.slope = s.length ? Math.max(-0.15, Math.min(0.15, median(s))) : 0;
    k.yc = function(o){ return o.y - k.slope * o.x; };
  }
  /* the table's band: below the headings, above the first footer line */
  function zone(k, hs, footRe){
    var top = Math.max.apply(null, hs.map(k.yc)) + k.th * 0.5;
    var foot = k.lines.filter(function(l){ return footRe.test(l.t) && k.yc(l) > top; }).map(k.yc).sort(function(a, b){ return a - b; })[0];
    var bottom = foot == null ? Infinity : foot - k.th * 0.5;
    return function(w){ var v = k.yc(w); return v > top && v < bottom; };
  }
  /* words into printed rows, top to bottom: a new row where the gap is over 0.6 of a line's height */
  function bands(k, ws){
    var out = [];
    ws.slice().sort(function(a, b){ return k.yc(a) - k.yc(b); }).forEach(function(w){
      var last = out[out.length - 1];
      if(last && k.yc(w) - last.end < k.th * 0.6){ last.ws.push(w); last.end = k.yc(w); } else out.push({ ws: [w], end: k.yc(w) });
    });
    out.forEach(function(b){ b.y = median(b.ws.map(k.yc)); b.ws.sort(function(a, c){ return a.x - c.x; }); });
    return out;
  }
  /* each group ({ y }) on a row ({ y }): top to bottom when there are as many; otherwise the nearest row after the
     groups' usual offset, within tol, when put takes it. -> the groups on no row */
  function pairRows(rows, groups, put, tol){
    if(!rows.length) return groups.slice();
    if(groups.length === rows.length){ groups.forEach(function(g, k){ put(rows[k], g); }); return []; }
    var near = function(v){ return rows.reduce(function(b, r){ return Math.abs(r.y - v) < Math.abs(b.y - v) ? r : b; }); };
    var off = median(groups.map(function(g){ return g.y - near(g.y).y; }));
    return groups.filter(function(g){ var r = near(g.y - off); return !(Math.abs(g.y - off - r.y) < tol && put(r, g) !== false); });
  }
  /* the rows: one per printed row of the anchor column (the line amounts); each other column's rows (cols: { key: words })
     paired with them; numbers on no row make a row of their own (its amount not read: the checks flag it); the
     description's rows last. Words alone on no row (a note like "1 CARTONS") are left out. */
  function assemble(k, anchorWords, cols, descWords){
    var rows = bands(k, anchorWords).map(function(b){ return { y: b.y, g: { a: b } }; });
    var gaps = rows.slice(1).map(function(r, i){ return r.y - rows[i].y; }), tol = (gaps.length ? Math.min.apply(null, gaps) : k.th * 3) / 2;
    var extra = [];
    Object.keys(cols).forEach(function(key){
      pairRows(rows, bands(k, cols[key]), function(r, g){ if(r.g[key]) return false; r.g[key] = g; }, tol).forEach(function(g){
        var o = extra.filter(function(x){ return !x.g[key] && Math.abs(x.y - g.y) < tol; })[0];
        if(o) o.g[key] = g; else { o = { y: g.y, g: {} }; o.g[key] = g; extra.push(o); }
      });
    });
    rows = rows.concat(extra).sort(function(a, b){ return a.y - b.y; });
    pairRows(rows, bands(k, descWords), function(r, g){ if(r.g.d) return false; r.g.d = g; }, tol);
    return rows.map(function(r){ var w = function(key){ return r.g[key] ? r.g[key].ws : []; }; return { a: w('a'), d: w('d'), w: w }; });
  }
  function textOf(ws){ return ws.map(function(w){ return w.t; }).join(' ').replace(/\s+/g, ' ').trim(); }
  /* where a label's own words end: its amount may be read on the same line ("Fuel Levy 3.63") */
  function labelEnd(lb){
    var ws = wordsOf(lb).filter(function(w){ return money(w.t) == null; }), w = ws[ws.length - 1];
    return w ? w.x + w.w / 2 : lb.x + (lb.w || 0) / 2;
  }
  /* the amount printed right of a label: the nearest in height within a line and a half */
  function moneyBeside(k, lb){
    var right = labelEnd(lb);
    var c = k.ws.filter(function(w){ return w.x > right && money(w.t) != null && Math.abs(k.yc(w) - k.yc(lb)) < k.th * 1.5; })
      .sort(function(a, b){ return Math.abs(k.yc(a) - k.yc(lb)) - Math.abs(k.yc(b) - k.yc(lb)); })[0];
    return c ? money(c.t) : null;
  }
  /* the printed totals as three amounts right of the footer's labels, top to bottom, the first two adding up to the
     third (net, GST, total), when exactly one three does */
  function footAdds(k, labels){
    if(!labels.length) return null;
    var right = Math.min.apply(null, labels.map(labelEnd));
    var top = Math.min.apply(null, labels.map(k.yc)) - k.th * 1.5, bot = Math.max.apply(null, labels.map(k.yc)) + k.th * 1.5;
    var vals = k.ws.filter(function(w){ return w.x > right && money(w.t) != null && k.yc(w) > top && k.yc(w) < bot; })
      .sort(function(a, b){ return k.yc(a) - k.yc(b); }).map(function(w){ return money(w.t); });
    var found = [];
    for(var i = 0; i + 2 < vals.length; i++) if(vals[i + 2] > 0 && Math.abs(vals[i] + vals[i + 1] - vals[i + 2]) < 0.005) found.push({ net: vals[i], gst: vals[i + 1], total: vals[i + 2] });
    return found.length === 1 ? found[0] : null;
  }
  /* the text printed with a label: after it on its line ("Date: 28/10/2026"), else the nearest line right of it
     (where 'right') or under it (where 'under') that read takes; never a due date */
  function besideText(k, re, read, where){
    var hits = k.lines.filter(function(l){ return re.test(l.t); }), i, v;
    for(i = 0; i < hits.length; i++) if((v = read(hits[i].t.replace(re, '').replace(/^\s*:?\s*/, '')))) return v;
    for(i = 0; i < hits.length; i++){
      var lb = hits[i];
      var c = k.lines.filter(function(l){
        if(l === lb || /due/i.test(l.t) || !read(l.t)) return false;
        return where === 'under' ? Math.abs(l.x - lb.x) < Math.max(lb.w || 0, k.th * 4) && l.y > lb.y + k.th * 0.3 && l.y < lb.y + k.th * 2.5
          : l.x - (l.w || 0) / 2 > lb.x && Math.abs(l.y - lb.y) < k.th * 1.5;
      }).sort(function(a, b){ return Math.abs(a.y - lb.y) - Math.abs(b.y - lb.y); })[0];
      if(c) return read(c.t);
    }
    return '';
  }
  /* a reader's lines and totals into the shape the other readers give */
  function result(number, date, totals, lines, problems){
    if(!number) problems.push('The invoice number wasn\'t read.');
    if(!date) problems.push('The invoice date wasn\'t read.');
    return { number: number, date: date, totals: totals, lines: lines, problems: problems };
  }

  /* Dick Stone (invoice 846508): DICK STONE PTY LTD at the top; "Invoice No:" and "Date:" (dd/mm/yy) on the right;
     a table Product Code · Item Description · Quantity · Unit · Unit Price · Amount (amounts before GST, printed half a
     line above their row; weighed quantities like 3.73 KG); a note under the items ("1 CARTONS", left out); the footer
     "Total Excl. GST $", "GST Amount", "Total Incl. GST $". Meat: no GST on the lines he showed. */
  function dsTable(k){
    var hD = k.ws.filter(function(w){ return /^Description$/i.test(w.t); })[0];
    if(!hD) return null;
    var hA = head(k, /^Amount$/i, hD), hP = head(k, /^Price$/i, hD), hQ = head(k, /^Quantity$/i, hD), hC = head(k, /^Code$/i, hD);
    if(!hA || !hP || !hQ) return null;
    var hU = head(k, /^Unit$/i, hD, function(w){ return w.line !== hP.line && w.x > hQ.x && w.x < hP.x; });
    var hs = [hD, hA, hP, hQ, hC, hU].filter(Boolean);
    tilt(k, hs);
    var inT = zone(k, hs, /^(Total\s*Excl|Terms\b|Claims\b|GST\s*Am)/i);
    var cutA = (hP.x + hA.x) / 2, cutP = ((hU || hQ).x + hP.x) / 2, cutQ = (hD.x + hQ.x) / 2, cutC = hC ? hC.line.x + hC.line.w / 2 + k.th * 0.5 : -Infinity;
    var t = k.ws.filter(inT), at = function(lo, hi){ return t.filter(function(w){ return w.x > lo && w.x <= hi; }); };
    var q = at(cutQ, cutP), desc = at(cutC, cutQ).concat(q.filter(function(w){ return !isNum(w.t) && !unitOf(w.t); }));
    return assemble(k, at(cutA, Infinity).filter(function(w){ return money(w.t) != null; }), {
      p: at(cutP, cutA).filter(function(w){ return money(w.t) != null; }),
      q: q.filter(function(w){ return isNum(w.t) || unitOf(w.t); })
    }, desc).map(function(r){
      var a = r.a.map(function(w){ return money(w.t); })[0], p = r.w('p').map(function(w){ return money(w.t); })[0];
      var qty = r.w('q').filter(function(w){ return isNum(w.t); })[0], u = r.w('q').map(function(w){ return unitOf(w.t); }).filter(Boolean)[0];
      return { description: textOf(r.d), unit: u || 'EACH', qty: qty ? +qty.t : null, price: p == null ? null : p, net: a == null ? null : a };
    });
  }
  var DS = {
    name: 'Dick Stone',
    detect: function(pages){ return named(pages, /DICK\s*STONE/i); },
    read: function(pages){
      var number = '', date = '', totals = null, lines = [], problems = [];
      pages.forEach(function(p, pi){
        var k = kit(p);
        if(!number) number = besideText(k, /^Invoice\s*No\.?/i, digits, 'right');
        if(!date) date = besideText(k, /^Date\b/i, readDate, 'right');
        var rows = dsTable(k);
        if(rows == null) problems.push('Page ' + (pi + 1) + ': the table\'s Quantity, Unit Price and Amount columns weren\'t read.');
        else if(!rows.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        (rows || []).forEach(function(r){ lines.push({ page: pi + 1, description: r.description || '(not read)', unit: r.unit, qty: r.qty, price: r.price, net: r.net }); });
        var labels = p.filter(function(l){ return /^(Total\s*Excl|GST\s*Am|Total\s*Incl)/i.test(l.t); });
        var t = footAdds(k, labels);
        if(!t){
          var lb = function(re){ return labels.filter(function(l){ return re.test(l.t); })[0]; }, inc = lb(/^Total\s*Incl/i);
          if(inc && moneyBeside(k, inc) != null) t = { net: lb(/^Total\s*Excl/i) ? moneyBeside(k, lb(/^Total\s*Excl/i)) : null, gst: lb(/^GST\s*Am/i) ? moneyBeside(k, lb(/^GST\s*Am/i)) : null, total: moneyBeside(k, inc) };
        }
        if(t) totals = t;
      });
      // the lines' amounts are before GST and no line says its GST: when the invoice charges none, each line's is 0
      lines.forEach(function(l){ l.gst = totals && totals.gst === 0 ? 0 : null; l.total = l.net; });
      if(totals && totals.gst > 0) problems.push('This invoice charges GST, and Dick Stone\'s lines don\'t say which: their amounts are before GST.');
      return result(number, date, totals, lines, problems);
    }
  };

  /* Highland Poultry (invoice 17502): "Tax invoice"; "Invoice number" and "Issue date" with the value under each
     (never the "Due date"); a table Item ID · Description · (unit) · Units · Unit Price incl. tax · Tax ("FRE": GST
     free) · Amount incl. tax; the footer "Tax", "Total Amount (inc. tax)", "Total paid", "Balance due" (only the
     first two read). Their name is printed only in the email and the payment details, so the email counts here
     with their table's own headings. */
  var HP_FREE = /^(FRE|FREE|EXEMPT|N-?T|GSTFREE)$/i, HP_TAXED = /^(GST|10%|GST10%)$/i;
  function hpTable(k){
    var hD = k.ws.filter(function(w){ return /^Description$/i.test(w.t); })[0];
    if(!hD) return null;
    var hA = head(k, /^Amount$/i, hD), hU = head(k, /^Units$/i, hD), hP = head(k, /^Price$/i, hD), hI = head(k, /^ID$/i, hD);
    if(!hA || !hU || !hP) return null;
    var hT = head(k, /^Tax$/i, hD, function(w){ return w.x > hP.x && w.x < hA.x; });
    var hs = [hD, hA, hU, hP, hI, hT].filter(Boolean);
    tilt(k, hs);
    var inT = zone(k, hs, /^(Subtotal|Tax\b|Total\s*Amount|Total\s*paid|Balance\s*due)/i);
    var cutA = ((hT || hP).x + hA.x) / 2, cutT = hT ? (hP.x + hT.x) / 2 : cutA, cutP = (hU.x + hP.x) / 2, cutU = hU.x - (hU.x - hD.x) / 4;
    var cutC = hI ? hI.line.x + hI.line.w / 2 + k.th * 0.5 : -Infinity;
    var t = k.ws.filter(inT), at = function(lo, hi){ return t.filter(function(w){ return w.x > lo && w.x <= hi; }); };
    var q = at(cutU, cutP), desc = at(cutC, cutU).concat(q.filter(function(w){ return !isNum(w.t) && !unitOf(w.t); }));
    return assemble(k, at(cutA, Infinity).filter(function(w){ return money(w.t) != null; }), {
      p: at(cutP, cutT).filter(function(w){ return money(w.t) != null; }),
      t: at(cutP, cutA).filter(function(w){ return HP_FREE.test(w.t) || HP_TAXED.test(w.t); }),
      q: q.filter(function(w){ return isNum(w.t) || unitOf(w.t); })
    }, desc).map(function(r){
      var a = r.a.map(function(w){ return money(w.t); })[0], p = r.w('p').map(function(w){ return money(w.t); })[0], tax = r.w('t').map(function(w){ return w.t; })[0] || '';
      var qty = r.w('q').filter(function(w){ return isNum(w.t); })[0], u = r.w('q').map(function(w){ return unitOf(w.t); }).filter(Boolean)[0];
      return { description: textOf(r.d), unit: u || 'EACH', qty: qty ? +qty.t : null, priceInc: p == null ? null : p, amount: a == null ? null : a, tax: tax };
    });
  }
  var HP = {
    name: 'Highland Poultry',
    detect: function(pages){
      return named(pages, /HIGHLAND\s*POULTRY/i) || pages.some(function(p){
        return p.some(function(l){ return /highland\s*poultry/i.test(l.t); }) && p.some(function(l){ return /^Item\s*ID$/i.test(l.t); }) && p.some(function(l){ return /including\s*tax/i.test(l.t); });
      });
    },
    read: function(pages){
      var number = '', date = '', totals = null, rows = [], problems = [];
      pages.forEach(function(p, pi){
        var k = kit(p);
        if(!number) number = besideText(k, /^Invoice\s*(number|no)\b\.?/i, digits, 'under');
        if(!date) date = besideText(k, /^Issue\s*dat\w*/i, readDate, 'under');
        var t = hpTable(k);
        if(t == null) problems.push('Page ' + (pi + 1) + ': the table\'s Units, Unit Price and Amount columns weren\'t read.');
        else if(!t.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        (t || []).forEach(function(r){ r.page = pi + 1; rows.push(r); });
        var tot = p.filter(function(l){ return /^Total\s*Amount/i.test(l.t); })[0];
        var total = tot ? moneyBeside(k, tot) : null;
        if(total != null){
          var tl = p.filter(function(l){ return /^Tax(\s+[S$]?[\d.,]+)?$/i.test(l.t) && l.y < tot.y; }).sort(function(a, b){ return b.y - a.y; })[0], gst = tl ? moneyBeside(k, tl) : null;
          totals = { net: gst == null ? null : round2(total - gst), gst: gst, total: total };
        }
      });
      // prices and amounts include the tax: "FRE" (or no tax on the whole invoice) means none; "GST" means a tenth of the
      // amount before it; a tax column not read on an invoice with tax: the net is left empty for the checks to flag
      var unread = 0;
      var lines = rows.map(function(r){
        var l = { page: r.page, description: r.description || '(not read)', unit: r.unit, qty: r.qty, price: null, net: null, gst: null, total: r.amount };
        if(HP_FREE.test(r.tax) || (!r.tax && totals && totals.gst === 0)){ l.price = r.priceInc; l.net = r.amount; l.gst = r.amount == null ? null : 0; }
        else if(HP_TAXED.test(r.tax) && r.amount != null){ l.gst = round2(r.amount / 11); l.net = round2(r.amount - l.gst); l.price = r.priceInc == null ? null : round2(r.priceInc / 1.1); }
        else unread++;
        return l;
      });
      if(unread) problems.push(unread + ' line' + (unread === 1 ? '\'s' : 's\'') + ' tax column wasn\'t read: check the GST.');
      return result(number, date, totals, lines, problems);
    }
  };

  /* Two Providores (invoice 756622): "Tax Invoice N" and "Date: dd/mm/yyyy" at the top; a table Qty Del · Qty Ord · Unit ·
     Product Code · Product · Brand · Unit Price · Gross · GST · Total Incl, under section names ("Dryarea", "Freezer");
     the quantity billed is the one delivered. The printer cuts off the Total Incl column's last digit ("188.5("), so a
     line's total is its Gross + GST when what's left of the printed one agrees (or none was read); a total read whole is
     passed on as read. The footer: a fuel levy (its price with GST: a line of its own, its GST worked out from the
     printed totals when they add up exactly), "Total Excluding GST", "GST", "Total Amount Due". */
  // a charge's label is the whole line ("Fuel Levy", or with its amount read on it), never a sentence about one
  // ("freight charges may apply …")
  var TP_CHARGE = /^(Fuel\s*Levy|Freight|Delivery(\s*Fee)?)\s*:?(\s+\$?[\d.,]+)?$/i,
    TP_FOOT = /^((Fuel\s*Levy|Freight|Delivery(\s*Fee)?)\s*:?(\s+\$?[\d.,]+)?$|Total\s*Excl|Total\s*Amount)/i;
  function tpTable(k){
    var hB = k.ws.filter(function(w){ return /^Brand$/i.test(w.t); })[0];
    if(!hB) return null;
    // "Product" is printed twice (over Product Code, and over the products): the products' is the one nearest Brand
    var hG = head(k, /^Gross$/i, hB), hProd = k.ws.filter(function(w){ return /^Product$/i.test(w.t) && w.x < hB.x && Math.abs(w.y - hB.y) < k.th * 4; })
      .sort(function(a, b){ return b.x - a.x; })[0];
    if(!hG || !hProd) return null;
    var hP = head(k, /^Price$/i, hB, function(w){ return w.x > hB.x && w.x < hG.x; }), hS = head(k, /^GST$/i, hB, function(w){ return w.x > hG.x; });
    var hT = head(k, /^(Total|Incl)$/i, hB, function(w){ return w.x > (hS || hG).x; });
    var hCode = head(k, /^Code$/i, hB, function(w){ return w.x < hProd.x; }), hDel = head(k, /^Del$/i, hB), hOrd = head(k, /^Ord$/i, hB);
    if(!hP) return null;
    var hs = [hB, hG, hProd, hP, hS, hT, hCode, hDel, hOrd].filter(Boolean);
    tilt(k, hs);
    var inT = zone(k, hs, TP_FOOT);
    var cutN = (hB.x + hP.x) / 2, cutB = hB.x - hB.w, pLeft = hProd.x - hProd.w / 2;
    var cutL = hCode ? (hCode.x + pLeft) / 2 : pLeft - k.th, cutDO = hDel && hOrd ? (hDel.x + hOrd.x) / 2 : null;
    var cols = [hP, hG, hS, hT].map(function(h){ return h ? h.x : null; });
    var t = k.ws.filter(inT), at = function(lo, hi){ return t.filter(function(w){ return w.x > lo && w.x <= hi; }); };
    var left = at(-Infinity, cutL).filter(function(w){ return isNum(w.t) || unitOf(w.t); });
    return assemble(k, at(cutN, Infinity).filter(function(w){ return /^[\d.,]+\S?$/.test(w.t); }), { l: left }, at(cutL, cutB)).map(function(r){
      // the numbers: four in order (price, gross, GST, total), else each by the nearest heading
      var v = [null, null, null, null], ns = r.a;
      if(ns.length === 4) v = ns.slice();
      else ns.forEach(function(w){
        var best = -1;
        cols.forEach(function(x, i){ if(x != null && (best < 0 || Math.abs(w.x - x) < Math.abs(w.x - cols[best]))) best = i; });
        if(best >= 0 && (!v[best] || Math.abs(w.x - cols[best]) < Math.abs(v[best].x - cols[best]))) v[best] = w;
      });
      var price = v[0] ? money(v[0].t) : null, gross = v[1] ? money(v[1].t) : null, gst = v[2] ? money(v[2].t) : null;
      var total = v[3] ? money(v[3].t) : null;
      if(total == null && gross != null && gst != null){
        var sum = round2(gross + gst), seen = v[3] ? v[3].t.replace(',', '.').replace(/[^\d.]+$/, '') : '';
        if(!v[3] || (seen.length >= 3 && sum.toFixed(2).indexOf(seen) === 0)) total = sum;
      }
      var lw = r.w('l'), nums = lw.filter(function(w){ return isNum(w.t); }), del = null;
      if(cutDO != null) del = nums.filter(function(w){ return w.x < cutDO; })[0] || null;
      else if(nums.length === 2) del = nums[0];
      var u = lw.map(function(w){ return unitOf(w.t); }).filter(Boolean)[0];
      return { description: textOf(r.d), unit: u || 'EACH', qty: del ? +del.t : null, price: price, net: gross, gst: gst, total: total };
    });
  }
  var TP = {
    name: 'Two Providores',
    detect: function(pages){ return named(pages, /TWO\s*PROVIDORES/i); },
    read: function(pages){
      var number = '', date = '', totals = null, lines = [], problems = [], levy = null;
      pages.forEach(function(p, pi){
        var k = kit(p);
        if(!number) p.forEach(function(l){ var m = /Tax\s*Invoice\s*:?\s*(\d{3,})/i.exec(l.t); if(m && !number) number = m[1]; });
        if(!date) date = besideText(k, /^Date\b/i, readDate, 'right');
        var rows = tpTable(k);
        if(rows == null) problems.push('Page ' + (pi + 1) + ': the table\'s Unit Price, Gross and Brand columns weren\'t read.');
        else if(!rows.length) problems.push('Page ' + (pi + 1) + ': no invoice lines read.');
        (rows || []).forEach(function(r){ r.page = pi + 1; r.description = r.description || '(not read)'; lines.push(r); });
        // "GST" is a heading too: the footer's is the one near the footer's other labels
        var GST = /^GST\s*:?(\s+\$?[\d.,]+)?$/i, labels = p.filter(function(l){ return TP_FOOT.test(l.t) || GST.test(l.t); });
        var foot = labels.filter(function(l){ return !GST.test(l.t); });
        labels = labels.filter(function(l){ return !GST.test(l.t) || foot.some(function(f){ return Math.abs(f.y - l.y) < k.th * 6; }); });
        var t = footAdds(k, labels);
        if(!t){
          var lb = function(re){ return labels.filter(function(l){ return re.test(l.t); })[0]; }, due = lb(/^Total\s*Amount/i), ex = lb(/^Total\s*Excl/i), g = lb(GST);
          if(due && moneyBeside(k, due) != null) t = { net: ex ? moneyBeside(k, ex) : null, gst: g ? moneyBeside(k, g) : null, total: moneyBeside(k, due) };
        }
        if(t) totals = t;
        var lv = labels.filter(function(l){ return TP_CHARGE.test(l.t); })[0];
        if(lv && moneyBeside(k, lv) != null) levy = { page: pi + 1, name: /fuel/i.test(lv.t) ? 'Fuel Levy' : /freight/i.test(lv.t) ? 'Freight' : 'Delivery', total: moneyBeside(k, lv) };
      });
      if(levy){
        // its net and GST: what the printed totals leave after the items, only when that comes back to the levy exactly
        var l = { page: levy.page, description: levy.name, unit: 'EACH', qty: null, price: null, net: null, gst: null, total: levy.total };
        var known = lines.every(function(x){ return x.net != null && x.gst != null; });
        if(totals && totals.net != null && totals.gst != null && known){
          var net = round2(totals.net - lines.reduce(function(a, x){ return a + x.net; }, 0)), gst = round2(totals.gst - lines.reduce(function(a, x){ return a + x.gst; }, 0));
          if(net > 0 && gst >= 0 && Math.round((net + gst) * 100) === Math.round(levy.total * 100) && (gst === 0 || Math.abs(gst * 100 - net * 10) <= 1)){ l.price = net; l.net = net; l.gst = gst; }
        }
        if(l.net == null) problems.push('The ' + levy.name.toLowerCase() + '\'s GST couldn\'t be worked out from the totals: check it.');
        lines.push(l);
      }
      return result(number, date, totals, lines, problems);
    }
  };
  var READERS = [FDA, MF, DS, HP, TP];

  /* the scan's pages -> { ok, reader, parsed: { invoice, lines, prices, problems } (InvoiceEngine.readCSV's shape), why } */
  function read(pages){
    var ps = (Array.isArray(pages) ? pages : []).map(linesOf);
    if(!ps.length || ps.every(function(p){ return !p.length; })) return { ok: false, why: 'No words were read from the scan: try again in better light, flat.' };
    var reader = READERS.filter(function(r){ return r.detect(ps); })[0];
    if(!reader) return { ok: false, why: 'The Pass can\'t read this supplier\'s invoices yet (so far: Aziz, Michael\'s Fresh, Dick Stone, Highland Poultry and Two Providores). Paste a Claude chat\'s CSV instead.' };
    var r = reader.read(ps), sup = reader.name;
    var lines = r.lines.map(function(l){
      var v = function(x){ return x == null ? null : x; };   // an empty column is null, as a CSV's would be
      return { supplier: sup, number: r.number, date: r.date, page: l.page, description: l.description, unit: l.unit, qtyPrinted: l.qty == null ? null : l.qty,   // v3.11.40: a printed quantity (Michael's Fresh)
        price: v(l.price), net: v(l.net), gst: v(l.gst), total: v(l.total), note: '', unreadable: l.price == null || l.net == null || l.total == null,
        nameDoubt: !!l.nameDoubt };   // v3.11.52
    });
    var invoice = r.totals ? { supplier: sup, number: r.number, date: r.date, pages: ps.length, net: r.totals.net, gst: r.totals.gst, total: r.totals.total } : null;
    if(!invoice) r.problems.push('The printed totals weren\'t read: is the last page in the scan?');
    return { ok: lines.length > 0, reader: sup, why: lines.length ? '' : 'No invoice lines were read from the scan.', parsed: { invoice: invoice, lines: lines, prices: [], problems: r.problems } };
  }

  return { read: read, money: money, tidy: tidy, readDate: readDate, linesOf: linesOf, mfSums: mfSums, mfSplitAt: mfSplitAt, leanOf: leanOf };
});

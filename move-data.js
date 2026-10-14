/* Move my data (v3.11.3; Pluto Stage 4, step 2 of the Almo work order).
   The Pass's saved data as one piece of text to copy, and that text read back.
   Plain rules, like roster-engine.js: no storage, network or page. index.html
   hands it what storage holds and writes what it gives back.

   What moves: every saved item whose name starts "order-chit-" (suppliers and
   products, prep items, recipes, orders and their history, roster, staff,
   timesheet, invoices, the voice's learned words and heard log, and the
   one-time setup marks, which must travel with the data or a setup would run
   again on it). What stays: the chef key (a password: he types it again), and
   this copy's own role and the data it kept aside at the last bring-in. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoveData = factory();
})(this, function(){
  var PREFIX = 'order-chit-';
  var STAY = ['order-chit-chef-key', 'order-chit-copy-role', 'order-chit-before-bring-in'];
  var FORMAT = 1;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function moves(key){ return typeof key === 'string' && key.indexOf(PREFIX) === 0 && STAY.indexOf(key) < 0; }

  /* "14 Oct, 2:05 pm" in the phone's own time */
  function when(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm');
  }

  /* entries: { key: the stored text }. meta: { version, from ('Chrome' | 'Pluto'), role, at } */
  function pack(entries, meta){
    meta = meta || {};
    var data = {};
    Object.keys(entries || {}).sort().forEach(function(k){
      if(moves(k) && typeof entries[k] === 'string') data[k] = entries[k];
    });
    var head = 'The Pass data, copied ' + when(meta.at) + ' from ' + (meta.from || 'The Pass') + ' (' + (meta.version || '?') + ')';
    return head + '\n' + JSON.stringify({ app: 'the-pass', format: FORMAT, version: meta.version || '', from: meta.from || '',
      role: meta.role || '', at: meta.at || 0, data: data });
  }

  function parsed(s){ try{ return JSON.parse(s); }catch(e){ return undefined; } }
  function count(s){
    var v = parsed(s);
    if(Array.isArray(v)) return v.length;
    if(v && typeof v === 'object') return Object.keys(v).length;
    return null;
  }
  function plural(n, one, many){ return n + ' ' + (n === 1 ? one : many); }

  /* What the pasted data holds, in his words: shown before anything is brought in. */
  function summary(data){
    var out = [];
    var sup = parsed(data['order-chit-suppliers']);
    if(Array.isArray(sup)){
      var products = 0;
      sup.forEach(function(s){ if(s && Array.isArray(s.products)) products += s.products.length; });
      out.push(plural(sup.length, 'supplier', 'suppliers') + ', ' + plural(products, 'product', 'products'));
    }
    var prep = count(data['order-chit-prep-items']);
    var rec = parsed(data['order-chit-recipes']);
    var recipes = rec && Array.isArray(rec.recipes) ? rec.recipes.length : null;
    var pr = [];
    if(prep != null) pr.push(plural(prep, 'prep item', 'prep items'));
    if(recipes != null) pr.push(plural(recipes, 'recipe', 'recipes'));
    if(pr.length) out.push(pr.join(', '));
    var hist = count(data['order-chit-order-history']);
    if(hist != null) out.push(plural(hist, 'sent order', 'sent orders') + ' in the history');
    var staff = count(data['order-chit-staff']);
    var rt = [];
    if(staff != null) rt.push(plural(staff, 'person', 'people') + ' on the staff list');
    if(data['order-chit-roster'] != null) rt.push('the roster');
    if(data['order-chit-timesheet-sheet'] != null || data['order-chit-timesheet'] != null) rt.push('the timesheet');
    if(rt.length) out.push(rt.length > 1 ? rt.slice(0, -1).join(', ') + ' and ' + rt[rt.length - 1] : rt[0]);
    var words = count(data['order-chit-voice-words']);
    if(words) out.push(plural(words, 'learned word', 'learned words'));
    return out;
  }

  /* The pasted text → { ok: true, data, meta, lines, size } or { ok: false, why } (said to him as it is). */
  function unpack(text){
    text = String(text == null ? '' : text).trim();
    if(!text) return { ok: false, why: 'Nothing pasted yet. Touch and hold the box, then Paste.' };
    var at = text.indexOf('{');
    var obj = at < 0 ? undefined : parsed(text.slice(at));
    if(obj === undefined){
      if(at >= 0 && text.indexOf('"the-pass"') >= 0) return { ok: false, why: 'The paste looks cut short. Copy it again, and paste the whole thing.' };
      return { ok: false, why: "That isn't The Pass's data. In the other copy, open Move my data and tap Copy my data, then paste here." };
    }
    if(!obj || obj.app !== 'the-pass' || !obj.data || typeof obj.data !== 'object')
      return { ok: false, why: "That isn't The Pass's data. In the other copy, open Move my data and tap Copy my data, then paste here." };
    if(obj.format !== FORMAT) return { ok: false, why: 'That copy was made by a different version of The Pass. Update both copies (close and reopen them), then copy again.' };
    var data = {}, size = 0;
    Object.keys(obj.data).forEach(function(k){
      var v = obj.data[k];
      if(moves(k) && typeof v === 'string'){ data[k] = v; size += k.length + v.length; }
    });
    var sup = parsed(data['order-chit-suppliers']);
    if(!Array.isArray(sup) || !sup.length) return { ok: false, why: "There are no suppliers in it, so it isn't a whole copy of The Pass. Nothing was brought in." };
    return { ok: true, data: data, size: size, lines: summary(data),
      meta: { version: String(obj.version || ''), from: String(obj.from || ''), role: String(obj.role || ''), at: +obj.at || 0, when: when(+obj.at || 0) } };
  }

  /* store: { keys(), get(k), set(k, v), remove(k) } (the page's storage; a plain object in the tests). */
  function collect(store){
    var out = {};
    store.keys().forEach(function(k){ if(moves(k)){ var v = store.get(k); if(typeof v === 'string') out[k] = v; } });
    return out;
  }

  /* Bring the unpacked data in, in place of this copy's. What was here is kept
     aside first (one item, "order-chit-before-bring-in"); if that can't be
     kept, nothing changes. If a write fails halfway, what was here is put back.
     The page reloads after an ok, so everything is read afresh. */
  var ASIDE = 'order-chit-before-bring-in';
  function bringIn(store, data, at){
    var before = collect(store);
    try{ store.set(ASIDE, JSON.stringify({ at: at || 0, data: before })); }
    catch(e){ return { ok: false, why: "There isn't room on the phone to keep this copy's data aside, so nothing was brought in." }; }
    try{
      Object.keys(before).forEach(function(k){ store.remove(k); });
      Object.keys(data).forEach(function(k){ if(moves(k)) store.set(k, data[k]); });
      return { ok: true, n: Object.keys(data).length };
    }catch(e){
      try{
        store.keys().forEach(function(k){ if(moves(k)) store.remove(k); });
        Object.keys(before).forEach(function(k){ store.set(k, before[k]); });
      }catch(e2){ return { ok: false, lost: true, why: "Couldn't bring it all in, and couldn't put this copy back as it was. Don't use this copy: tell Claude (what was here is kept aside)." }; }
      return { ok: false, why: "Couldn't bring it all in (is the phone's storage full?). Nothing changed." };
    }
  }

  return { PREFIX: PREFIX, STAY: STAY, ASIDE: ASIDE, FORMAT: FORMAT, moves: moves, when: when, pack: pack, unpack: unpack, summary: summary,
    collect: collect, bringIn: bringIn };
});

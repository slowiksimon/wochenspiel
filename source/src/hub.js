// One listener on the household's settings collection, shared by everything that keeps its data there: the shopping list
// and the wish list (settings/shop-…, settings/wish-…), the waste plan (settings/muell) and the cleaning overview
// (settings/putz, settings/putz-d-…). Every listener is a stream the phone keeps open, so one is better than several.
const subs = new Set();
let last = null, failure = null, started = false;

// fn(snapshot) on every change, err(error) when the listener fails; a late subscriber gets the last snapshot at once
export function watchSettings(db, fn, err) {
  const sub = { fn, err };
  subs.add(sub);
  if (last) Promise.resolve().then(() => { if (subs.has(sub)) fn(last); });
  else if (failure && err) Promise.resolve().then(() => { if (subs.has(sub)) err(failure); });
  if (!started && db) {
    started = true;
    db.collection('settings').onSnapshot(snap => {
      last = snap; failure = null;
      for (const s of Array.from(subs)) { try { s.fn(snap); } catch (e) { setTimeout(() => { throw e; }); } }
    }, e => {
      failure = e;
      for (const s of Array.from(subs)) { if (s.err) { try { s.err(e); } catch (x) { /* ignore */ } } }
    });
  }
  return () => subs.delete(sub);
}

// the data of one document of the snapshot (null when it does not exist or cannot be read)
export function docData(snap, id) {
  const d = snap && snap.docs ? snap.docs.find(x => x.id === id) : null;
  if (!d) return null;
  try { const v = d.data(); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

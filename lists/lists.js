'use strict';
/* ==========================================================
   Listen – To-Do-Listen, Bücher, Filme, Einkauf … mit Beschreibung, Datum, Uhrzeit, Ort, Link, Bewertung
   Daten: Tabellen lists / list_items (supabase/listen.sql), jedes Konto sieht nur die eigenen.
   ========================================================== */
(() => {
  const $ = s => document.querySelector(s);
  const fatalBox = $('#fatal');
  const fatal = msg => { fatalBox.textContent = msg; fatalBox.hidden = false; };
  if (!window.Auth || !Auth.enabled) { fatal('Supabase ist nicht eingerichtet (assets/config.js).'); return; }
  if (!Auth.session()) return;                 // die Weiterleitung zum Login läuft bereits
  const URL_ = String(window.SUPABASE_URL).trim().replace(/\/+$/, '');
  const KEY = String(window.SUPABASE_KEY).trim();

  // ---------- Hilfsfunktionen ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
    return e;
  }
  const pref = {
    get() { try { return JSON.parse(localStorage.getItem('lists-prefs') || '{}'); } catch { return {}; } },
    set(o) { try { localStorage.setItem('lists-prefs', JSON.stringify({ ...pref.get(), ...o })); } catch { /* ignorieren */ } },
  };
  const pad = n => String(n).padStart(2, '0');
  const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const hhmm = t => (t ? String(t).slice(0, 5) : '');

  // ---------- Server ----------
  class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status || 0; this.code = code || ''; } }
  async function api(path, o = {}) {
    let token;
    try { token = await Auth.token(); } catch { throw new ApiError('Keine Verbindung zum Server.', 0); }
    if (!token) throw new ApiError('Sitzung abgelaufen. Bitte neu anmelden.', 401);
    const headers = { apikey: KEY, Authorization: 'Bearer ' + token };
    let body = o.body;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    if (o.prefer) headers.Prefer = o.prefer;
    let r;
    try { r = await fetch(URL_ + '/rest/v1/' + path, { method: o.method || 'GET', headers, body, cache: 'no-store' }); }
    catch { throw new ApiError('Keine Verbindung zum Server.', 0); }
    if (!r.ok) {
      let d = null; try { d = await r.json(); } catch { /* leer */ }
      throw new ApiError((d && (d.message || d.msg || d.error)) || `Fehler ${r.status}`, r.status, d && d.code);
    }
    if (r.status === 204) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const explain = e => {
    if (!(e instanceof ApiError)) return (e && e.message) || 'Unbekannter Fehler.';
    const m = e.message || '';
    if (e.status === 0) return m;
    if (e.status === 401 || /jwt/i.test(m)) return 'Die Sitzung ist abgelaufen. Bitte neu anmelden.';
    if (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(m)) return 'Die Datenbank für Listen ist noch nicht eingerichtet. Bitte supabase/listen.sql ausführen.';
    if (e.status === 403 || /row-level security/i.test(m)) return 'Dafür fehlt die Berechtigung.';
    if (/check constraint|violates/i.test(m)) return 'Ein Wert ist ungültig oder zu lang.';
    return m;
  };

  // ---------- Arten von Listen ----------
  const ALL = ['subtitle', 'notes', 'date', 'time', 'place', 'url', 'rating', 'priority'];
  const KINDS = {
    todo: { label: 'To-Do-Liste', icon: '✅', color: '#34c759', name: 'To-Do', hint: 'Fälligkeit mit Datum und Uhrzeit, Ort, Wichtigkeit, Link und Beschreibung.', f: ['notes', 'date', 'time', 'place', 'url', 'priority'], L: { date: 'Fällig am', done: 'Erledigt' } },
    books: { label: 'Bücher', icon: '📚', color: '#af52de', name: 'Bücher', hint: 'Autor, Bewertung, Beschreibung, Lesedatum und Link.', f: ['subtitle', 'notes', 'rating', 'date', 'url'], L: { subtitle: 'Autor', date: 'Gelesen am', done: 'Gelesen' } },
    movies: { label: 'Filme & Serien', icon: '🎬', color: '#ff3b30', name: 'Filme', hint: 'Regie oder Jahr, Bewertung, Beschreibung, Datum, Uhrzeit, Ort und Link.', f: ['subtitle', 'notes', 'rating', 'date', 'time', 'place', 'url'], L: { subtitle: 'Regie / Jahr', date: 'Gesehen am', place: 'Wo gesehen', done: 'Gesehen' } },
    shopping: { label: 'Einkaufsliste', icon: '🛒', color: '#ff9500', name: 'Einkaufen', hint: 'Menge, Geschäft und Notizen.', f: ['subtitle', 'notes', 'place'], L: { subtitle: 'Menge', place: 'Geschäft', done: 'Gekauft' } },
    general: { label: 'Allgemein', icon: '📋', color: '#007aff', name: 'Liste', hint: 'Alle Felder: Beschreibung, Datum, Uhrzeit, Ort, Link, Bewertung, Wichtigkeit.', f: ALL, L: { subtitle: 'Zusatz', date: 'Datum', done: 'Erledigt' } },
  };
  const LABEL = { subtitle: 'Zusatz', date: 'Datum', place: 'Ort', done: 'Erledigt' };
  const lab = (kind, k) => ((KINDS[kind] || KINDS.general).L[k]) || LABEL[k];
  const COLORS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ff2d55', '#5ac8fa', '#8e8e93'];
  const ICONS = ['📋', '✅', '📚', '🎬', '🛒', '🎵', '🎮', '✈️', '🍽️', '🏠', '💼', '🎁', '💡', '🏃', '🌱', '⭐'];
  const PRIORITY = ['', 'Niedrig', 'Hoch', 'Dringend'];

  // ---------- Zustand ----------
  const P = pref.get();
  const S = {
    lists: [], items: [], view: { t: 'upcoming', id: null }, q: '',
    filter: ['open', 'all', 'done'].includes(P.filter) ? P.filter : 'all',
    sort: ['manual', 'date', 'title', 'priority', 'rating', 'new'].includes(P.sort) ? P.sort : 'manual',
    loadedAt: 0,
  };
  const listById = id => S.lists.find(l => l.id === id);
  const kindOf = it => (listById(it.list_id) || {}).kind || 'general';
  const colorOf = it => (listById(it.list_id) || {}).color || '#8e8e93';

  const status = (msg, err) => { const s = $('#status'); s.textContent = msg || ''; s.classList.toggle('err', !!err); };
  function toast(msg, act, fn) {
    for (const old of document.querySelectorAll('.toast')) old.remove();
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    if (act) t.append(h('button', { type: 'button', text: act, onclick: () => { t.remove(); fn(); } }));
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).append(t);
    setTimeout(() => t.remove(), act ? 8000 : 4500);
  }
  const fail = e => { const m = explain(e); status(m, true); toast(m); };

  async function loadAll(silent) {
    if (!silent) status('Wird geladen …');
    try {
      const lists = await api('lists?select=*&order=pos.asc,created_at.asc&limit=1000');
      const items = [];
      for (let off = 0; ; off += 1000) {
        const r = await api(`list_items?select=*&order=created_at.asc&limit=1000&offset=${off}`);
        items.push(...r);
        if (r.length < 1000) break;
      }
      S.lists = lists; S.items = items; S.loadedAt = Date.now();
      status('');
      render();
    } catch (e) { status(explain(e), true); if (!silent) { render(); fatal(explain(e)); } }
  }

  // ---------- Ansicht ----------
  const hashOf = v => v.t === 'upcoming' ? '#upcoming' : '#list/' + v.id;
  function viewFromHash() {
    const x = decodeURIComponent(location.hash.slice(1)); let m;
    if ((m = x.match(/^list\/(.+)$/)) && listById(m[1])) return { t: 'list', id: m[1] };
    if (x === 'upcoming') return { t: 'upcoming', id: null };
    const last = pref.get().last;
    if (last && listById(last)) return { t: 'list', id: last };
    return S.lists.length ? { t: 'list', id: S.lists[0].id } : { t: 'upcoming', id: null };
  }
  function go(v) {
    if (S.q) { S.q = ''; $('#q').value = ''; }
    if (v.t === 'list') pref.set({ last: v.id });
    const next = hashOf(v);
    if (location.hash === next) { S.view = v; render(); } else location.hash = next;
  }
  window.addEventListener('hashchange', () => { if (S.q) { S.q = ''; $('#q').value = ''; } S.view = viewFromHash(); render(); });

  // ---------- Datum ----------
  const nowParts = () => { const n = new Date(); return { day: dayStr(n), time: `${pad(n.getHours())}:${pad(n.getMinutes())}` }; };
  function isLate(it) {
    if (it.done || !it.due_date) return false;
    const n = nowParts();
    return it.due_date < n.day || (it.due_date === n.day && !!it.due_time && hhmm(it.due_time) < n.time);
  }
  function dateText(it) {
    if (!it.due_date) return '';
    const n = nowParts(), d = parseDay(it.due_date);
    let t;
    if (it.due_date === n.day) t = 'Heute';
    else if (it.due_date === dayStr(addDays(new Date(), 1))) t = 'Morgen';
    else if (it.due_date === dayStr(addDays(new Date(), -1))) t = 'Gestern';
    else t = d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    return t + (it.due_time ? ' · ' + hhmm(it.due_time) : '');
  }
  const mapUrl = place => 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(place);
  function normUrl(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    let u; try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  }
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // ---------- Sortieren / Filtern ----------
  const cmpText = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
  const dateKey = it => (it.due_date ? it.due_date + ' ' + (it.due_time || '99:99') : '');
  function sorted(items, sort) {
    const a = [...items];
    const byPos = (x, y) => (x.pos - y.pos) || (x.created_at < y.created_at ? -1 : 1);
    const cmp = {
      manual: byPos,
      date: (x, y) => (!x.due_date && !y.due_date) ? byPos(x, y) : !x.due_date ? 1 : !y.due_date ? -1 : (dateKey(x) < dateKey(y) ? -1 : dateKey(x) > dateKey(y) ? 1 : byPos(x, y)),
      title: (x, y) => cmpText(x.title, y.title),
      priority: (x, y) => (y.priority - x.priority) || byPos(x, y),
      rating: (x, y) => (y.rating - x.rating) || byPos(x, y),
      new: (x, y) => (x.created_at < y.created_at ? 1 : -1),
    }[sort] || byPos;
    a.sort(sort === 'manual' ? cmp : (x, y) => (Number(x.done) - Number(y.done)) || cmp(x, y));
    return a;
  }
  const openItems = () => S.items.filter(i => !i.done);
  const upcomingItems = () => openItems().filter(i => i.due_date);
  const searchItems = () => {
    const q = S.q.toLowerCase();
    return S.items.filter(i => [i.title, i.subtitle, i.notes, i.place].some(t => (t || '').toLowerCase().includes(q)));
  };

  // ---------- Darstellung ----------
  function render() {
    S.view = S.q ? { t: 'search', id: null } : S.view;
    if (S.view.t === 'list' && !listById(S.view.id)) S.view = viewFromHash();
    renderNav(); renderMain();
  }
  function renderNav() {
    const smart = $('#navSmart'), nav = $('#navLists');
    const late = upcomingItems().filter(isLate).length, up = upcomingItems().length;
    smart.replaceChildren(h('button', { type: 'button', class: 'nav-item' + (late ? ' over' : ''), 'aria-current': !S.q && S.view.t === 'upcoming' ? 'page' : null, style: '--c:#ff3b30', onclick: () => go({ t: 'upcoming', id: null }) },
      h('span', { class: 'ico', 'aria-hidden': 'true', text: '🗓️' }), h('span', { class: 'nm', text: 'Anstehend' }), h('span', { class: 'cnt', text: late ? late + ' überfällig' : up ? String(up) : '' })));
    nav.replaceChildren(...S.lists.map(l => {
      const n = S.items.filter(i => i.list_id === l.id && !i.done).length;
      return h('button', { type: 'button', class: 'nav-item', 'data-list': l.id, 'aria-current': !S.q && S.view.t === 'list' && S.view.id === l.id ? 'page' : null, style: `--c:${l.color}`, onclick: () => go({ t: 'list', id: l.id }) },
        h('span', { class: 'ico', 'aria-hidden': 'true', text: l.icon }), h('span', { class: 'nm', text: l.name }), h('span', { class: 'cnt', text: n ? String(n) : '' }));
    }));
    $('#sideEmpty').hidden = S.lists.length > 0;
  }

  function renderMain() {
    const v = S.view, isList = v.t === 'list', list = isList ? listById(v.id) : null;
    const items = $('#items'), empty = $('#empty');
    // Kopf
    let title, sub, badge, color = '#007aff';
    if (isList) {
      const mine = S.items.filter(i => i.list_id === list.id), done = mine.filter(i => i.done).length;
      title = list.name; badge = list.icon; color = list.color;
      sub = `${KINDS[list.kind].label} · ${mine.length - done} offen${done ? ' · ' + done + ' erledigt' : ''}`;
    } else if (v.t === 'upcoming') {
      title = 'Anstehend'; badge = '🗓️'; color = '#ff3b30'; sub = `${upcomingItems().length} offene Einträge mit Datum`;
    } else { title = 'Suche'; badge = '🔍'; sub = `Treffer für «${S.q}» in allen Listen`; }
    $('#hTitle').textContent = title; $('#hSub').textContent = sub;
    const hb = $('#hBadge'); hb.textContent = badge; hb.style.setProperty('--c', color);
    $('#editListBtn').hidden = !isList;
    $('#controls').hidden = !isList; $('#quick').hidden = !isList;
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === S.filter));
    $('#sortSel').value = S.sort;
    $('#clearDone').hidden = !(isList && S.items.some(i => i.list_id === list.id && i.done));
    items.className = 'items' + (isList && S.sort === 'manual' ? ' manual' : '');
    items.replaceChildren();
    empty.hidden = true;
    document.documentElement.style.setProperty('--accent', color);

    if (!S.lists.length && !S.q) { emptyNoLists(); return; }
    let shown = 0;
    if (isList) {
      let rows = S.items.filter(i => i.list_id === list.id);
      if (S.filter === 'open') rows = rows.filter(i => !i.done); else if (S.filter === 'done') rows = rows.filter(i => i.done);
      rows = sorted(rows, S.sort);
      for (const it of rows) items.append(itemEl(it, false));
      shown = rows.length;
      if (!shown) emptyText(S.items.some(i => i.list_id === list.id) ? ['🔎', 'Nichts zu zeigen', 'Mit dem Filter «Alle» siehst du alle Einträge dieser Liste.'] : ['✨', 'Die Liste ist leer', 'Schreibe oben einen Eintrag und drücke Enter.']);
    } else if (v.t === 'upcoming') {
      const rows = sorted(upcomingItems(), 'date');
      const n = nowParts(), tomorrow = dayStr(addDays(new Date(), 1)), week = dayStr(addDays(new Date(), 7));
      const groups = [['Überfällig', i => isLate(i) && i.due_date < n.day, 'late'], ['Heute', i => i.due_date === n.day], ['Morgen', i => i.due_date === tomorrow], ['In den nächsten 7 Tagen', i => i.due_date > tomorrow && i.due_date <= week], ['Später', i => i.due_date > week]];
      const used = new Set();
      for (const [name, test, cls] of groups) {
        const g = rows.filter(i => !used.has(i.id) && test(i));
        if (!g.length) continue;
        for (const i of g) used.add(i.id);
        items.append(h('h3', { class: 'group ' + (cls || ''), text: name }));
        for (const it of g) items.append(itemEl(it, true));
      }
      shown = rows.length;
      if (!shown) emptyText(['🎉', 'Nichts ansteht', 'Einträge mit Datum erscheinen hier, sobald du eines setzt.']);
    } else {
      const rows = sorted(searchItems(), 'manual').sort((a, b) => S.lists.indexOf(listById(a.list_id)) - S.lists.indexOf(listById(b.list_id)));
      for (const it of rows) items.append(itemEl(it, true));
      shown = rows.length;
      if (!shown) emptyText(['🔍', 'Nichts gefunden', `Kein Eintrag passt zu «${S.q}».`]);
    }
    status(shown ? `${shown} ${shown === 1 ? 'Eintrag' : 'Einträge'}` : '');
  }
  function emptyText([ico, t, d]) { const e = $('#empty'); e.replaceChildren(h('div', { class: 'big', text: ico }), h('b', { text: t }), h('span', { text: d })); e.hidden = false; }
  function emptyNoLists() {
    const e = $('#empty');
    e.replaceChildren(h('div', { class: 'big', text: '📋' }), h('b', { text: 'Lege deine erste Liste an' }), h('p', { text: 'Wähle eine Vorlage oder erstelle eine eigene Liste.' }),
      h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap' }, ...['todo', 'books', 'movies', 'shopping'].map(k =>
        h('button', { type: 'button', class: 'btn', text: `${KINDS[k].icon} ${KINDS[k].label}`, onclick: () => quickCreate(k) })), h('button', { type: 'button', class: 'btn primary', text: 'Eigene Liste …', onclick: () => openList(null) })));
    e.hidden = false;
    $('#hTitle').textContent = 'Listen'; $('#hSub').textContent = 'Noch keine Liste angelegt';
  }

  function itemEl(it, showList) {
    const list = listById(it.list_id), kind = list ? list.kind : 'general';
    const meta = [];
    if (it.due_date) meta.push(h('span', { class: isLate(it) ? 'late' : '', title: lab(kind, 'date'), text: '📅 ' + dateText(it) }));
    if (it.place) meta.push(h('span', { title: lab(kind, 'place') }, '📍 ', h('a', { href: mapUrl(it.place), target: '_blank', rel: 'noopener noreferrer', text: it.place, onclick: e => e.stopPropagation() })));
    if (it.rating) meta.push(h('span', { class: 'stars-ro', title: it.rating + ' von 5', text: '★'.repeat(it.rating) + '☆'.repeat(5 - it.rating) }));
    if (it.priority) meta.push(h('span', { class: 'pri p' + it.priority, text: '⚑ ' + PRIORITY[it.priority] }));
    if (it.url) meta.push(h('span', {}, '🔗 ', h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', text: hostOf(it.url), onclick: e => e.stopPropagation() })));
    const el = h('div', { class: 'item' + (it.done ? ' done' : ''), role: 'listitem', tabindex: '0', 'data-id': it.id, style: `--c:${colorOf(it)}`, draggable: (S.view.t === 'list' && S.sort === 'manual') ? 'true' : null },
      h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(it.done), 'aria-label': lab(kind, 'done'), title: lab(kind, 'done') }),
      h('div', { class: 'body' },
        h('div', { class: 'ttl' }, h('span', { class: 'grip', 'aria-hidden': 'true', text: '⋮⋮ ' }), it.title),
        it.subtitle ? h('div', { class: 'sub', text: it.subtitle }) : null,
        it.notes ? h('div', { class: 'note', text: it.notes }) : null,
        meta.length ? h('div', { class: 'meta' }, ...meta) : null),
      showList && list ? h('span', { class: 'chip', style: `--c:${list.color}`, text: `${list.icon} ${list.name}` }) : h('span'));
    return el;
  }

  // ---------- Einträge: Aktionen ----------
  const itemById = id => S.items.find(i => i.id === id);
  async function toggleDone(it) {
    const was = it.done; it.done = !was; render();
    try { const r = await api(`list_items?id=eq.${it.id}`, { method: 'PATCH', body: { done: it.done }, prefer: 'return=representation' }); if (r && r[0]) Object.assign(it, r[0]); }
    catch (e) { it.done = was; render(); fail(e); }
  }
  const nextPos = listId => S.items.filter(i => i.list_id === listId).reduce((m, i) => Math.max(m, i.pos), 0) + 1;

  $('#quick').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#quickInput'), title = inp.value.trim();
    if (!title || S.view.t !== 'list') return;
    const btn = $('#quickAdd'); btn.disabled = true;
    try {
      const rows = await api('list_items', { method: 'POST', prefer: 'return=representation', body: { list_id: S.view.id, title, pos: nextPos(S.view.id) } });
      S.items.push(rows[0]); inp.value = ''; render();
    } catch (ex) { fail(ex); } finally { btn.disabled = false; inp.focus(); }
  });
  $('#quickMore').addEventListener('click', () => { if (S.view.t === 'list') { const t = $('#quickInput').value.trim(); $('#quickInput').value = ''; openItem(null, S.view.id, t); } });

  async function deleteItem(it, closeDlg) {
    try {
      await api(`list_items?id=eq.${it.id}`, { method: 'DELETE' });
      S.items = S.items.filter(i => i !== it);
      if (closeDlg) $('#itemDialog').close();
      render();
      toast(`«${it.title}» gelöscht`, 'Rückgängig', async () => {
        try { const { updated_at, ...row } = it; await api('list_items', { method: 'POST', body: row }); S.items.push(it); render(); } catch (e) { fail(e); }
      });
    } catch (e) { if (closeDlg) showErr($('#iError'), e); else fail(e); }
  }

  // Klicks in der Liste
  const itemsEl = $('#items');
  itemsEl.addEventListener('click', e => {
    const el = e.target.closest('.item'); if (!el) return;
    const it = itemById(el.dataset.id); if (!it) return;
    if (e.target.closest('.tick')) toggleDone(it); else openItem(it);
  });
  itemsEl.addEventListener('keydown', e => {
    const el = e.target.closest('.item'); if (!el || e.target.closest('a, .tick')) return;
    const it = itemById(el.dataset.id); if (!it) return;
    if (e.key === 'Enter') { openItem(it); e.preventDefault(); }
    else if (e.key === ' ') { toggleDone(it); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const n = el[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling']; if (n && n.classList.contains('item')) n.focus(); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { deleteItem(it, false); e.preventDefault(); }
  });

  // Reihenfolge per Ziehen
  let dragId = null;
  itemsEl.addEventListener('dragstart', e => { const el = e.target.closest('.item'); if (!el) return; dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  itemsEl.addEventListener('dragend', () => { dragId = null; for (const x of itemsEl.querySelectorAll('.dragging, .drop-before, .drop-after')) x.classList.remove('dragging', 'drop-before', 'drop-after'); });
  itemsEl.addEventListener('dragover', e => {
    const el = e.target.closest('.item'); if (!dragId || !el || el.dataset.id === dragId) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    for (const x of itemsEl.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after');
    el.classList.add(before ? 'drop-before' : 'drop-after');
  });
  itemsEl.addEventListener('drop', async e => {
    const el = e.target.closest('.item'); if (!dragId || !el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    const moving = itemById(dragId), target = itemById(el.dataset.id);
    dragId = null;
    if (!moving || !target || moving === target) return;
    const order = sorted(S.items.filter(i => i.list_id === moving.list_id), 'manual').filter(i => i !== moving);
    const at = order.indexOf(target) + (before ? 0 : 1);
    order.splice(at, 0, moving);
    const prev = order[at - 1], next = order[at + 1];
    const old = moving.pos;
    try {
      let pos;
      if (prev && next) pos = (prev.pos + next.pos) / 2; else if (prev) pos = prev.pos + 1; else pos = (next ? next.pos : 1) - 1;
      if (prev && next && Math.abs(next.pos - prev.pos) < 1e-9) {          // Positionen aufgebraucht: neu durchnummerieren
        for (let i = 0; i < order.length; i++) { if (order[i].pos !== i + 1) { await api(`list_items?id=eq.${order[i].id}`, { method: 'PATCH', body: { pos: i + 1 } }); order[i].pos = i + 1; } }
      } else { moving.pos = pos; await api(`list_items?id=eq.${moving.id}`, { method: 'PATCH', body: { pos } }); }
      render();
    } catch (ex) { moving.pos = old; render(); fail(ex); }
  });

  // ---------- Dialog: Eintrag ----------
  const idlg = $('#itemDialog'), iform = $('#itemForm');
  let editing = null, rating = 0;
  const showErr = (box, e) => { box.textContent = typeof e === 'string' ? e : explain(e); box.hidden = false; };
  function drawStars() {
    $('#iStars').replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: 'star' + (n <= rating ? ' on' : ''), role: 'radio', 'aria-checked': String(n === rating), 'aria-label': n + (n === 1 ? ' Stern' : ' Sterne'), text: '★', onclick: () => { rating = rating === n ? 0 : n; drawStars(); } })));
  }
  function applyFields() {
    const list = listById($('#iList').value), kind = list ? list.kind : 'general', f = KINDS[kind].f;
    const has = k => editing && ({ subtitle: editing.subtitle, notes: editing.notes, date: editing.due_date, time: editing.due_time, place: editing.place, url: editing.url, rating: editing.rating, priority: editing.priority }[k]);
    for (const el of idlg.querySelectorAll('[data-f]')) el.hidden = !(f.includes(el.dataset.f) || has(el.dataset.f));
    $('#iSubtitleLbl').textContent = lab(kind, 'subtitle'); $('#iDateLbl').textContent = lab(kind, 'date');
    $('#iPlaceLbl').textContent = lab(kind, 'place'); $('#iDoneLbl').textContent = lab(kind, 'done');
    const b = $('#iBadge'); b.textContent = list ? list.icon : '📋'; b.style.setProperty('--c', list ? list.color : '#007aff');
  }
  function updateLinks() {
    const p = $('#iPlace').value.trim(), m = $('#iMap'); m.hidden = !p; if (p) m.href = mapUrl(p);
    const u = normUrl($('#iUrl').value), o = $('#iOpen'); o.hidden = !u; if (u) o.href = u;
  }
  $('#iPlace').addEventListener('input', updateLinks); $('#iUrl').addEventListener('input', updateLinks);
  $('#iList').addEventListener('change', applyFields);
  function openItem(it, listId, title = '') {
    editing = it; $('#iError').hidden = true;
    $('#iList').replaceChildren(...S.lists.map(l => h('option', { value: l.id, text: `${l.icon} ${l.name}` })));
    $('#iList').value = it ? it.list_id : (listId || (S.view.t === 'list' ? S.view.id : S.lists[0] && S.lists[0].id));
    $('#iHeading').textContent = it ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
    $('#iSub').textContent = it ? `Hinzugefügt am ${new Date(it.created_at).toLocaleDateString('de-CH')}` : '';
    $('#iTitle').value = it ? it.title : title; $('#iSubtitle').value = it ? it.subtitle : ''; $('#iNotes').value = it ? it.notes : '';
    $('#iDate').value = it && it.due_date || ''; $('#iTime').value = it ? hhmm(it.due_time) : '';
    $('#iPlace').value = it ? it.place : ''; $('#iUrl').value = it ? it.url : '';
    $('#iPriority').value = String(it ? it.priority : 0); $('#iDone').checked = !!(it && it.done);
    rating = it ? it.rating : 0; drawStars(); applyFields(); updateLinks();
    $('#iDelete').hidden = !it;
    idlg.showModal(); $('#iTitle').focus();
  }
  iform.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#iError'); err.hidden = true;
    const title = $('#iTitle').value.trim();
    if (!title) { showErr(err, 'Bitte einen Titel eingeben.'); $('#iTitle').focus(); return; }
    const url = normUrl($('#iUrl').value);
    if (url === null) { showErr(err, 'Der Link ist ungültig. Erlaubt sind Adressen mit http oder https, z. B. github.com/...'); return; }
    const date = $('#iDate').value, time = $('#iTime').value;
    if (time && !date) { showErr(err, 'Für eine Uhrzeit bitte auch ein Datum wählen.'); return; }
    const listId = $('#iList').value;
    if (!listId) { showErr(err, 'Bitte zuerst eine Liste anlegen.'); return; }
    const body = {
      list_id: listId, title, subtitle: $('#iSubtitle').value.trim(), notes: $('#iNotes').value.trim(),
      done: $('#iDone').checked, due_date: date || null, due_time: time || null,
      place: $('#iPlace').value.trim(), url, rating, priority: +$('#iPriority').value,
    };
    const btn = $('#iSave'); btn.disabled = true;
    try {
      if (editing) {
        if (listId !== editing.list_id) body.pos = nextPos(listId);
        const r = await api(`list_items?id=eq.${editing.id}`, { method: 'PATCH', body, prefer: 'return=representation' });
        Object.assign(editing, r && r[0] ? r[0] : body);
      } else {
        body.pos = nextPos(listId);
        const r = await api('list_items', { method: 'POST', body, prefer: 'return=representation' });
        S.items.push(r[0]);
      }
      idlg.close(); render();
    } catch (ex) { showErr(err, ex); } finally { btn.disabled = false; }
  });
  $('#iDelete').addEventListener('click', () => { if (editing) deleteItem(editing, true); });

  // ---------- Dialog: Liste ----------
  const ldlg = $('#listDialog'), lform = $('#listForm');
  let editingList = null, lColor = COLORS[0], lTouched = { icon: false, color: false };
  $('#lKind').replaceChildren(...Object.entries(KINDS).map(([k, v]) => h('option', { value: k, text: `${v.icon} ${v.label}` })));
  $('#lIcon').maxLength = 12;
  function drawListPickers() {
    $('#lColors').replaceChildren(...COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (c === lColor ? ' on' : ''), style: `--c:${c}`, 'aria-label': 'Farbe ' + c, 'aria-pressed': String(c === lColor), onclick: () => { lColor = c; lTouched.color = true; drawListPickers(); } })));
    $('#lIcons').replaceChildren(...ICONS.map(i => h('button', { type: 'button', class: 'swatch', text: i, 'aria-label': 'Symbol ' + i, onclick: () => { $('#lIcon').value = i; lTouched.icon = true; syncBadge(); } })));
    syncBadge();
  }
  function syncBadge() { const b = $('#lBadge'); b.textContent = $('#lIcon').value || '📋'; b.style.setProperty('--c', lColor); }
  $('#lIcon').addEventListener('input', () => { lTouched.icon = true; syncBadge(); });
  $('#lKind').addEventListener('change', () => {
    const k = KINDS[$('#lKind').value];
    $('#lKindHint').textContent = k.hint;
    if (!editingList) { if (!lTouched.icon) $('#lIcon').value = k.icon; if (!lTouched.color) lColor = k.color; drawListPickers(); }
  });
  function openList(l) {
    editingList = l; lTouched = { icon: !!l, color: !!l }; $('#lError').hidden = true;
    $('#listTitle').textContent = l ? 'Liste bearbeiten' : 'Neue Liste';
    $('#lName').value = l ? l.name : ''; $('#lKind').value = l ? l.kind : 'todo';
    $('#lIcon').value = l ? l.icon : KINDS.todo.icon; lColor = l ? l.color : KINDS.todo.color;
    $('#lKindHint').textContent = KINDS[$('#lKind').value].hint;
    $('#lDelete').hidden = !l; drawListPickers();
    ldlg.showModal(); $('#lName').focus();
  }
  lform.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#lError'); err.hidden = true;
    const name = $('#lName').value.trim(), icon = $('#lIcon').value.trim() || '📋';
    if (!name) { showErr(err, 'Bitte einen Namen eingeben.'); $('#lName').focus(); return; }
    const btn = $('#lSave'); btn.disabled = true;
    try {
      const body = { name, kind: $('#lKind').value, icon, color: lColor };
      if (editingList) {
        const r = await api(`lists?id=eq.${editingList.id}`, { method: 'PATCH', body, prefer: 'return=representation' });
        Object.assign(editingList, r && r[0] ? r[0] : body); ldlg.close(); render();
      } else {
        const pos = S.lists.reduce((m, l) => Math.max(m, l.pos), 0) + 1;
        const r = await api('lists', { method: 'POST', body: { ...body, pos }, prefer: 'return=representation' });
        S.lists.push(r[0]); ldlg.close(); go({ t: 'list', id: r[0].id });
      }
    } catch (ex) { showErr(err, ex); } finally { btn.disabled = false; }
  });
  async function quickCreate(kind) {
    const k = KINDS[kind];
    try {
      const r = await api('lists', { method: 'POST', prefer: 'return=representation', body: { name: k.name, kind, icon: k.icon, color: k.color, pos: S.lists.reduce((m, l) => Math.max(m, l.pos), 0) + 1 } });
      S.lists.push(r[0]); go({ t: 'list', id: r[0].id });
    } catch (e) { fail(e); }
  }

  // Bestätigen
  let confirmFn = null;
  function confirmBox(title, text, ok, fn) {
    $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = ok;
    $('#confirmErr').hidden = true; confirmFn = fn; $('#confirmDialog').showModal();
  }
  $('#confirmOk').addEventListener('click', async () => {
    const b = $('#confirmOk'); b.disabled = true;
    try { await confirmFn(); $('#confirmDialog').close(); } catch (ex) { showErr($('#confirmErr'), ex); } finally { b.disabled = false; }
  });
  $('#lDelete').addEventListener('click', () => {
    const l = editingList; if (!l) return;
    const n = S.items.filter(i => i.list_id === l.id).length;
    confirmBox('Liste löschen?', `«${l.name}» wird mit ${n === 1 ? '1 Eintrag' : n + ' Einträgen'} endgültig gelöscht. Das lässt sich nicht rückgängig machen.`, 'Liste löschen', async () => {
      await api(`lists?id=eq.${l.id}`, { method: 'DELETE' });
      S.lists = S.lists.filter(x => x !== l); S.items = S.items.filter(i => i.list_id !== l.id);
      ldlg.close(); const nv = S.lists[0] ? { t: 'list', id: S.lists[0].id } : { t: 'upcoming', id: null }; S.view = nv; location.hash = hashOf(nv); render();
    });
  });
  $('#clearDone').addEventListener('click', () => {
    if (S.view.t !== 'list') return;
    const id = S.view.id, n = S.items.filter(i => i.list_id === id && i.done).length;
    confirmBox('Erledigte löschen?', `${n === 1 ? '1 erledigter Eintrag wird' : n + ' erledigte Einträge werden'} endgültig gelöscht.`, 'Löschen', async () => {
      await api(`list_items?list_id=eq.${id}&done=eq.true`, { method: 'DELETE' });
      S.items = S.items.filter(i => !(i.list_id === id && i.done)); render();
    });
  });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });

  // ---------- Kopfzeile ----------
  $('#newListBtn').addEventListener('click', () => openList(null));
  $('#newListSide').addEventListener('click', () => openList(null));
  $('#editListBtn').addEventListener('click', () => { const l = listById(S.view.id); if (l) openList(l); });
  for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { S.filter = b.dataset.filter; pref.set({ filter: S.filter }); render(); });
  $('#sortSel').addEventListener('change', e => { S.sort = e.target.value; pref.set({ sort: S.sort }); render(); });
  let qTimer = 0;
  $('#q').addEventListener('input', e => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value.trim(); if (!S.q) S.view = viewFromHash(); render(); }, 150);
  });
  const layout = $('#layout'), sbBtn = $('#sidebarToggle');
  function setSidebar(open) { layout.classList.toggle('collapsed', !open); sbBtn.setAttribute('aria-expanded', String(open)); try { localStorage.setItem('lists-sidebar', open ? '1' : '0'); } catch { /* ignorieren */ } }
  sbBtn.addEventListener('click', () => setSidebar(layout.classList.contains('collapsed')));
  try { if (localStorage.getItem('lists-sidebar') === '0') setSidebar(false); } catch { /* ignorieren */ }
  $('#logoutBtn').addEventListener('click', async () => { await Auth.logout(); location.href = '../login/'; });
  // Auf anderen Geräten geänderte Daten nachladen, wenn man zur Seite zurückkehrt
  window.addEventListener('focus', () => { if (Date.now() - S.loadedAt > 30000 && !document.querySelector('dialog[open]')) loadAll(true); });
  setInterval(render, 60000);              // «überfällig» und «Heute» bleiben aktuell

  // ---------- Start ----------
  (async function init() {
    $('#whoAmI').textContent = '👤 ' + Auth.displayName(); $('#whoAmI').hidden = false; $('#logoutBtn').hidden = false;
    await loadAll();
    S.view = viewFromHash();
    render();
  })();
})();

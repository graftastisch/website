'use strict';
/* ==========================================================
   Dateien – Dateiverwaltung (Hochladen, Herunterladen, Löschen, Ordner, Vorschau, Teilen)
   Daten: Tabellen file_folders / files, Speicher: privater Bucket "user-files" (supabase/dateien.sql)
   ========================================================== */
(() => {
  const $ = s => document.querySelector(s);
  const fatalBox = $('#fatal');
  const fatal = msg => { fatalBox.textContent = msg; fatalBox.hidden = false; };

  if (!window.Auth || !Auth.enabled) { fatal('Supabase ist nicht eingerichtet (assets/config.js).'); return; }
  const session = Auth.session();
  if (!session) return;                         // die Weiterleitung zum Login läuft bereits
  const UID = session.user.id;
  const URL_ = String(window.SUPABASE_URL).trim().replace(/\/+$/, '');
  const KEY = String(window.SUPABASE_KEY).trim();
  const BUCKET = 'user-files';
  const MAX_FILE = 50 * 1024 * 1024;
  const QUOTA = 1024 * 1024 * 1024;
  const MAX_ZIP = 600 * 1024 * 1024;
  const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;
  const THUMB_MAX = 4 * 1024 * 1024;
  const PAGE = 100;

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
  const fmtSize = n => {
    n = Number(n) || 0;
    const f = (v, d) => v.toFixed(d).replace('.', ',');
    if (n < 1024) return n + ' B';
    if (n < 1048576) return f(n / 1024, n < 10240 ? 1 : 0) + ' KB';
    if (n < 1073741824) return f(n / 1048576, n < 10485760 ? 1 : 0) + ' MB';
    return f(n / 1073741824, 2) + ' GB';
  };
  const fmtDate = s => { const d = new Date(s); return Number.isNaN(+d) ? '' : d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const extOf = n => ((String(n).match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
  const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const pref = {
    get() { try { return JSON.parse(localStorage.getItem('files-prefs') || '{}'); } catch { return {}; } },
    set(o) { try { localStorage.setItem('files-prefs', JSON.stringify({ ...pref.get(), ...o })); } catch { /* ignorieren */ } },
  };

  // ---------- Dateitypen ----------
  const EXT = {
    image: 'png jpg jpeg gif webp svg bmp avif ico heic heif tif tiff',
    video: 'mp4 webm mov mkv avi m4v ogv wmv flv mpg mpeg 3gp',
    audio: 'mp3 wav ogg oga flac m4a aac opus wma aiff mid midi',
    doc: 'pdf doc docx xls xlsx ppt pptx odt ods odp txt rtf md csv tsv epub pages numbers key',
    code: 'js mjs cjs ts jsx tsx py pyw java c h cpp hpp cc cs go rs rb php sh bash zsh bat cmd ps1 html htm css scss sass less json jsonc xml yml yaml toml ini cfg conf env sql lua kt kts swift vue svelte dart r ipynb log gradle make cmake proto tex vb pl scala ex exs erl hs clj lock gitignore dockerfile',
    archive: 'zip rar 7z tar gz tgz bz2 xz zst iso dmg',
  };
  const EXT_KIND = {};
  for (const [k, list] of Object.entries(EXT)) for (const e of list.split(' ')) EXT_KIND[e] = k;
  const NAME_KIND = { dockerfile: 'code', makefile: 'code', readme: 'doc', license: 'doc' };
  const classify = (name, mime = '') => {
    const e = extOf(name);
    if (EXT_KIND[e]) return EXT_KIND[e];
    const low = String(name).toLowerCase();
    if (NAME_KIND[low]) return NAME_KIND[low];
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    if (/^text\/|json|xml|javascript/.test(mime)) return 'code';
    return 'other';
  };
  const KINDS = {
    image: { label: 'Bilder', ico: '🖼️' }, video: { label: 'Videos', ico: '🎞️' }, audio: { label: 'Audio', ico: '🎵' },
    doc: { label: 'Dokumente', ico: '📄' }, code: { label: 'Code', ico: '🧩' }, archive: { label: 'Archive', ico: '🗜️' }, other: { label: 'Sonstiges', ico: '📎' },
  };
  const iconOf = f => (f.kind === 'doc' && extOf(f.name) === 'pdf') ? '📕' : (KINDS[f.kind] || KINDS.other).ico;
  const isTextLike = f => f.kind === 'code' || ['txt', 'md', 'csv', 'tsv', 'rtf', 'log'].includes(extOf(f.name)) || /^text\//.test(f.mime);
  const filePath = f => `${UID}/${f.id}`;

  // ---------- Server ----------
  class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status || 0; this.code = code || ''; } }
  async function api(path, o = {}) {
    let token;
    try { token = await Auth.token(); } catch { throw new ApiError('Keine Verbindung zum Server.', 0); }
    if (!token) throw new ApiError('Sitzung abgelaufen. Bitte neu anmelden.', 401);
    const headers = { apikey: KEY, Authorization: 'Bearer ' + token, ...(o.headers || {}) };
    let body = o.body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    if (o.prefer) headers.Prefer = o.prefer;
    let r;
    try { r = await fetch(URL_ + path, { method: o.method || 'GET', headers, body, cache: 'no-store' }); }
    catch { throw new ApiError('Keine Verbindung zum Server.', 0); }
    if (!r.ok) {
      let d = null; try { d = await r.json(); } catch { /* leer */ }
      throw new ApiError((d && (d.message || d.error_description || d.msg || d.error)) || `Fehler ${r.status}`, r.status, d && (d.code || d.error));
    }
    if (o.raw) return r;
    if (r.status === 204) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const rest = (p, o) => api('/rest/v1/' + p, o);
  const explain = e => {
    if (!(e instanceof ApiError)) return (e && e.message) || 'Unbekannter Fehler.';
    const m = e.message || '';
    if (e.status === 0 || e.status === -1) return m;
    if (e.status === 401 || /jwt/i.test(m)) return 'Die Sitzung ist abgelaufen. Bitte neu anmelden.';
    if (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(m)) return 'Die Datenbank für Dateien ist noch nicht eingerichtet. Bitte supabase/dateien.sql ausführen.';
    if (e.status === 413 || /maximum allowed size|too large|exceeded/i.test(m)) return 'Die Datei ist zu gross (maximal 50 MB) oder der Speicher ist voll.';
    if (/quota|storage limit/i.test(m)) return 'Der Speicher ist voll.';
    if (e.status === 403 || /row-level security|violates/i.test(m)) return 'Dafür fehlt die Berechtigung.';
    return m;
  };

  const signCache = new Map();
  const fullUrl = u => (u.startsWith('http') ? u : URL_ + (u.startsWith('/storage/v1') ? '' : '/storage/v1') + (u.startsWith('/') ? u : '/' + u));
  async function signMany(paths, expiresIn = 3600) {
    const need = paths.filter(p => { const c = signCache.get(p); return !(c && c.exp > Date.now() + 60000); });
    for (const part of chunks(need, 100)) {
      const res = await api(`/storage/v1/object/sign/${BUCKET}`, { method: 'POST', body: { expiresIn, paths: part } });
      for (const r of res || []) if (r.signedURL) signCache.set(r.path, { url: fullUrl(r.signedURL), exp: Date.now() + expiresIn * 1000 });
    }
  }
  async function signOne(path) {
    await signMany([path]);
    const c = signCache.get(path);
    if (!c) throw new ApiError('Der Link konnte nicht erstellt werden.', 0);
    return c.url;
  }
  async function getBlob(path) {
    const r = await api(`/storage/v1/object/authenticated/${BUCKET}/${path}`, { raw: true });
    return r.blob();
  }

  // ---------- Zustand ----------
  const P = pref.get();
  const S = {
    folders: new Map(), files: [], total: 0, view: { t: 'all', folder: null, kind: null }, q: '',
    sort: P.sort || { col: 'name', dir: 'asc' }, mode: P.mode === 'grid' ? 'grid' : 'list',
    sel: new Set(), anchor: null, rows: [], token: 0, usage: 0, loading: false,
  };
  const SORT_COL = { name: 'name', size: 'size', date: 'created_at' };

  const childrenOf = id => [...S.folders.values()].filter(f => f.parent_id === id);
  function descendants(id) {
    const out = [id], q = [id];
    while (q.length) { const x = q.pop(); for (const c of childrenOf(x)) { out.push(c.id); q.push(c.id); } }
    return out;
  }
  const folderDeleted = id => { const f = S.folders.get(id); return !f || !!f.deleted_at; };
  function chain(id) { const o = []; let f = S.folders.get(id); while (f) { o.unshift(f); f = f.parent_id ? S.folders.get(f.parent_id) : null; } return o; }
  const patchFolders = (ids, patch) => { for (const id of ids) { const f = S.folders.get(id); if (f) Object.assign(f, patch); } };

  async function loadFolders() {
    S.folders.clear();
    for (let off = 0; ; off += 1000) {
      const rows = await rest(`file_folders?select=*&order=created_at.asc&limit=1000&offset=${off}`);
      for (const f of rows) S.folders.set(f.id, f);
      if (rows.length < 1000) break;
    }
  }

  // ---------- Ansicht (Adresse) ----------
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hashOf = v => v.t === 'folder' ? '#folder/' + v.folder : v.t === 'kind' ? '#kind/' + v.kind : v.t === 'starred' ? '#starred' : v.t === 'trash' ? '#trash' : '';
  function viewFromHash() {
    const x = decodeURIComponent(location.hash.slice(1));
    let m;
    if ((m = x.match(/^folder\/(.+)$/)) && UUID_RE.test(m[1]) && !folderDeleted(m[1])) return { t: 'all', folder: m[1], kind: null };
    if ((m = x.match(/^kind\/(\w+)$/)) && KINDS[m[1]] && m[1] !== 'other') return { t: 'kind', folder: null, kind: m[1] };
    if (x === 'starred') return { t: 'starred', folder: null, kind: null };
    if (x === 'trash') return { t: 'trash', folder: null, kind: null };
    return { t: 'all', folder: null, kind: null };
  }
  function go(v) {
    const next = hashOf(v.t === 'all' && !v.folder ? { t: 'all' } : v.t === 'all' ? { t: 'folder', folder: v.folder } : v);
    if (S.q) { S.q = ''; $('#q').value = ''; }
    if (next === (location.hash || '') || (next === '' && !location.hash)) { S.view = v; S.sel.clear(); load(); }
    else location.hash = next;      // löst "hashchange" aus
  }
  window.addEventListener('hashchange', () => { if (S.q) { S.q = ''; $('#q').value = ''; } S.view = viewFromHash(); S.sel.clear(); load(); });

  // ---------- Laden ----------
  const status = (msg, err) => { const s = $('#status'); s.textContent = msg || ''; s.classList.toggle('err', !!err); };
  function filesQuery() {
    const v = S.view;
    if (S.q) return `&deleted_at=is.null&name=ilike.${encodeURIComponent('*' + S.q + '*')}`;
    if (v.t === 'all') return '&deleted_at=is.null&folder_id=' + (v.folder ? 'eq.' + v.folder : 'is.null');
    if (v.t === 'kind') return '&deleted_at=is.null&kind=eq.' + v.kind;
    if (v.t === 'starred') return '&deleted_at=is.null&starred=eq.true';
    return '&deleted_at=not.is.null';
  }
  async function load(more = false) {
    const my = ++S.token;
    if (!more) { S.files = []; S.total = 0; }
    status('Wird geladen …');
    try {
      if (!S.folders.size && !S.foldersLoaded) { await loadFolders(); S.foldersLoaded = true; }
      if (my !== S.token) return;
      if (!more && S.view.folder && folderDeleted(S.view.folder)) { S.view = { t: 'all', folder: null, kind: null }; history.replaceState(null, '', location.pathname); }
      const col = SORT_COL[S.sort.col] || 'name';
      let files = [];
      if (S.view.t === 'trash' && !S.q) {
        for (let off = 0; ; off += 500) {
          const r = await rest(`files?select=*${filesQuery()}&order=deleted_at.desc,id.asc&limit=500&offset=${off}`);
          files.push(...r);
          if (r.length < 500) break;
        }
        files = files.filter(f => !f.folder_id || folderDeleted(f.folder_id) === false);
        S.total = files.length;
      } else {
        const r = await rest(`files?select=*${filesQuery()}&order=${col}.${S.sort.dir},id.asc&limit=${PAGE}&offset=${more ? S.files.length : 0}`, { raw: true, prefer: 'count=exact' });
        files = await r.json();
        const m = String(r.headers.get('content-range') || '').match(/\/(\d+)$/);
        S.total = m ? +m[1] : (more ? S.files.length : 0) + files.length;
      }
      if (my !== S.token) return;
      S.files = more ? S.files.concat(files) : files;
      render();
      status(summary());
    } catch (e) { if (my === S.token) { status(explain(e), true); S.files = more ? S.files : []; render(); } }
  }
  let reloadTimer = 0;
  const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load(), 600); };

  async function refreshUsage() {
    try {
      const n = await rest('rpc/files_usage', { method: 'POST', body: {} });
      S.usage = Number(n) || 0;
      const pct = Math.min(100, S.usage / QUOTA * 100);
      const fill = $('#meterFill');
      fill.style.width = pct + '%'; fill.classList.toggle('full', pct >= 95);
      $('#meterText').textContent = `${fmtSize(S.usage)} von ${fmtSize(QUOTA)} belegt`;
      $('#meter').title = 'Der kostenlose Speicher (1 GB) wird mit den Anhängen des Wochenplans geteilt.';
    } catch { /* Anzeige ist nebensächlich */ }
  }

  // ---------- Darstellung ----------
  function viewFolders() {
    const q = S.q.toLowerCase();
    let list;
    if (q) list = [...S.folders.values()].filter(f => !f.deleted_at && f.name.toLowerCase().includes(q));
    else if (S.view.t === 'all') list = [...S.folders.values()].filter(f => !f.deleted_at && f.parent_id === S.view.folder);
    else if (S.view.t === 'trash') list = [...S.folders.values()].filter(f => f.deleted_at && (!f.parent_id || !S.folders.get(f.parent_id) || !S.folders.get(f.parent_id).deleted_at));
    else list = [];
    const dir = S.sort.dir === 'asc' ? 1 : -1;
    const byDate = S.sort.col === 'date';
    return list.sort((a, b) => (byDate ? dir * (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) : dir * a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' })));
  }
  function summary() {
    const fo = S.rows.filter(r => r.type === 'folder').length;
    const fi = S.rows.filter(r => r.type === 'file');
    const bytes = fi.reduce((n, r) => n + (r.rec.size || 0), 0);
    const parts = [];
    if (fo) parts.push(fo === 1 ? '1 Ordner' : fo + ' Ordner');
    const total = S.total > fi.length ? `${fi.length} von ${S.total}` : String(fi.length);
    parts.push(fi.length === 1 && S.total <= 1 ? '1 Datei' : total + ' Dateien');
    return parts.join(', ') + (fi.length ? ' · ' + fmtSize(bytes) : '');
  }

  const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    const hit = entries.filter(e => e.isIntersecting).map(e => e.target);
    for (const el of hit) thumbObserver.unobserve(el);
    if (!hit.length) return;
    signMany(hit.map(el => el.dataset.path)).then(() => {
      for (const el of hit) {
        const c = signCache.get(el.dataset.path);
        if (!c || !el.isConnected) continue;
        const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
        img.className = el.dataset.cls;
        img.onload = () => { if (el.isConnected) el.replaceWith(img); };
        img.src = c.url;
      }
    }).catch(() => { /* Symbol bleibt */ });
  }, { rootMargin: '200px' }) : null;

  function iconEl(f, cls) {
    const span = h('span', { class: 'ic', 'aria-hidden': 'true', text: iconOf(f) });
    if (f.kind === 'image' && f.size <= THUMB_MAX && thumbObserver && !f.deleted_at) {
      span.dataset.path = filePath(f); span.dataset.cls = cls; thumbObserver.observe(span);
    }
    return span;
  }

  const keyOf = (type, id) => (type === 'folder' ? 'd:' : 'f:') + id;
  const inTrash = () => S.view.t === 'trash' && !S.q;

  function render() {
    const rows = [];
    for (const f of viewFolders()) rows.push({ key: keyOf('folder', f.id), type: 'folder', rec: f });
    for (const f of S.files) rows.push({ key: keyOf('file', f.id), type: 'file', rec: f });
    S.rows = rows;
    const keys = new Set(rows.map(r => r.key));
    for (const k of [...S.sel]) if (!keys.has(k)) S.sel.delete(k);

    renderNav(); renderCrumbs();
    const list = $('#list');
    list.className = 'list ' + (S.mode === 'grid' ? 'grid' : '');
    list.replaceChildren();
    if (rows.length) {
      list.append(listHead());
      for (const r of rows) list.append(S.mode === 'grid' ? tileEl(r) : rowEl(r));
    }
    const empty = $('#empty');
    empty.hidden = rows.length > 0;
    if (!rows.length) empty.replaceChildren(...emptyText());
    $('#moreWrap').hidden = !(S.files.length < S.total && !inTrash());
    $('#trashbar').hidden = !inTrash() || !rows.length;
    $('#viewList').setAttribute('aria-pressed', String(S.mode === 'list'));
    $('#viewGrid').setAttribute('aria-pressed', String(S.mode === 'grid'));
    updateSel();
  }
  function emptyText() {
    const v = S.view;
    let ico = '📂', t = 'Dieser Ordner ist leer', d = 'Ziehe Dateien hierher oder klicke auf «Hochladen».';
    if (S.q) { ico = '🔍'; t = 'Nichts gefunden'; d = `Keine Datei und kein Ordner passt zu «${S.q}».`; }
    else if (v.t === 'kind') { ico = KINDS[v.kind].ico; t = `Keine ${KINDS[v.kind].label}`; d = 'Hochgeladene Dateien dieses Typs erscheinen hier.'; }
    else if (v.t === 'starred') { ico = '⭐'; t = 'Nichts markiert'; d = 'Markierte Dateien findest du hier.'; }
    else if (v.t === 'trash') { ico = '🗑️'; t = 'Der Papierkorb ist leer'; d = 'Gelöschte Dateien landen zuerst hier.'; }
    else if (!v.folder) { t = 'Noch keine Dateien'; }
    return [h('div', { class: 'big', text: ico }), h('b', { text: t }), h('span', { text: d })];
  }
  function listHead() {
    const mk = (col, label, cls) => {
      const on = S.sort.col === col;
      return h('button', { type: 'button', 'data-sort': col, class: cls, text: label + (on ? (S.sort.dir === 'asc' ? ' ↑' : ' ↓') : '') });
    };
    const head = h('div', { class: 'row-item lhead', role: 'row' },
      h('span'), mk('name', 'Name', 'c-nm'), h('span', { class: 'r c-sz' }, mk('size', 'Grösse', '')), h('span', { class: 'c-dt' }, mk('date', inTrash() ? 'Gelöscht' : 'Datum', '')), h('span'));
    return head;
  }
  function metaOf(r) {
    const f = r.rec;
    return { size: r.type === 'folder' ? '–' : fmtSize(f.size), date: fmtDate(inTrash() ? f.deleted_at : f.created_at) };
  }
  function rowEl(r) {
    const f = r.rec, m = metaOf(r);
    const el = h('div', { class: 'row-item', role: 'row', tabindex: '0', 'data-key': r.key, draggable: S.view.t === 'trash' ? null : 'true' },
      h('input', { type: 'checkbox', class: 'chk', 'aria-label': 'Auswählen', tabindex: '-1' }),
      h('div', { class: 'nm' },
        r.type === 'folder' ? h('span', { class: 'ic', 'aria-hidden': 'true', text: '📁' }) : iconEl(f, 'th'),
        h('span', { class: 't', text: f.name, title: f.name }),
        f.starred ? h('span', { class: 'star', title: 'Markiert', text: '★' }) : null),
      h('span', { class: 'sz r', text: m.size }), h('span', { class: 'dt', text: m.date }),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'icon-btn small more', 'aria-label': 'Aktionen', 'aria-haspopup': 'menu', text: '⋯' })));
    return el;
  }
  function tileEl(r) {
    const f = r.rec, m = metaOf(r);
    return h('div', { class: 'tile', role: 'row', tabindex: '0', 'data-key': r.key, draggable: S.view.t === 'trash' ? null : 'true' },
      h('input', { type: 'checkbox', class: 'chk', 'aria-label': 'Auswählen', tabindex: '-1' }),
      h('button', { type: 'button', class: 'icon-btn small more', 'aria-label': 'Aktionen', 'aria-haspopup': 'menu', text: '⋯' }),
      h('div', { class: 'pv' }, r.type === 'folder' ? h('span', { class: 'ic', 'aria-hidden': 'true', text: '📁' }) : iconEl(f, 'cover')),
      h('div', { class: 'cap' }, h('b', { class: 't', text: (f.starred ? '★ ' : '') + f.name, title: f.name }), h('small', { text: r.type === 'folder' ? 'Ordner' : m.size })));
  }

  // Navigation (links) & Pfad
  const NAV = [
    { id: 'all', ico: '📁', label: 'Alle Dateien', view: { t: 'all', folder: null, kind: null }, drop: 'root' },
    { sep: true },
    ...['image', 'video', 'audio', 'doc', 'code', 'archive'].map(k => ({ id: 'kind:' + k, ico: KINDS[k].ico, label: KINDS[k].label, view: { t: 'kind', folder: null, kind: k } })),
    { sep: true },
    { id: 'starred', ico: '⭐', label: 'Markiert', view: { t: 'starred', folder: null, kind: null } },
    { id: 'trash', ico: '🗑️', label: 'Papierkorb', view: { t: 'trash', folder: null, kind: null }, drop: 'trash' },
  ];
  function navActive() { const v = S.view; return v.t === 'all' ? 'all' : v.t === 'kind' ? 'kind:' + v.kind : v.t; }
  function renderNav() {
    const nav = $('#nav');
    if (!nav.children.length) {
      for (const n of NAV) {
        if (n.sep) { nav.append(h('hr')); continue; }
        const b = h('button', { type: 'button', class: 'nav-item', 'data-nav': n.id }, h('span', { class: 'ico', 'aria-hidden': 'true', text: n.ico }), n.label);
        if (n.drop) b.dataset.drop = n.drop;
        b.addEventListener('click', () => go(n.view));
        nav.append(b);
      }
    }
    for (const b of nav.querySelectorAll('.nav-item')) {
      if (!S.q && b.dataset.nav === navActive()) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }
  function renderCrumbs() {
    const c = $('#crumbs');
    c.replaceChildren();
    const v = S.view;
    if (S.q) { c.append(h('span', { class: 'cur', text: `Suche: «${S.q}»` })); return; }
    if (v.t !== 'all') { c.append(h('span', { class: 'cur', text: v.t === 'kind' ? KINDS[v.kind].label : v.t === 'starred' ? 'Markiert' : 'Papierkorb' })); return; }
    const parts = chain(v.folder);
    const root = h('button', { type: 'button', text: 'Alle Dateien', 'data-drop-folder': '' });
    if (!parts.length) { c.append(h('span', { class: 'cur', text: 'Alle Dateien' })); return; }
    root.addEventListener('click', () => go({ t: 'all', folder: null, kind: null }));
    c.append(root);
    parts.forEach((f, i) => {
      c.append(h('span', { class: 'sep', text: '›' }));
      if (i === parts.length - 1) c.append(h('span', { class: 'cur', text: f.name }));
      else { const b = h('button', { type: 'button', text: f.name, 'data-drop-folder': f.id }); b.addEventListener('click', () => go({ t: 'all', folder: f.id, kind: null })); c.append(b); }
    });
  }

  // ---------- Auswahl ----------
  const rowByKey = k => S.rows.find(r => r.key === k);
  const selected = () => S.rows.filter(r => S.sel.has(r.key));
  function updateSel() {
    const list = $('#list');
    for (const el of list.querySelectorAll('[data-key]')) {
      const on = S.sel.has(el.dataset.key);
      el.classList.toggle('sel', on);
      const c = el.querySelector('.chk'); if (c) c.checked = on;
    }
    list.classList.toggle('selecting', S.sel.size > 0);
    const n = S.sel.size, bulk = $('#bulk');
    bulk.hidden = n === 0;
    $('#crumbs').hidden = n > 0;
    if (n) {
      $('#bulkCount').textContent = n === 1 ? '1 ausgewählt' : n + ' ausgewählt';
      const t = inTrash();
      $('#bkRestore').hidden = !t; $('#bkMove').hidden = t; $('#bkDownload').hidden = t;
      $('#bkDelete').textContent = t ? 'Endgültig löschen' : 'Löschen';
    }
  }
  function selectOnly(key) { S.sel = new Set([key]); S.anchor = key; updateSel(); }
  function toggleKey(key) { if (S.sel.has(key)) S.sel.delete(key); else S.sel.add(key); S.anchor = key; updateSel(); }
  function rangeTo(key) {
    const keys = S.rows.map(r => r.key);
    const a = keys.indexOf(S.anchor), b = keys.indexOf(key);
    if (a < 0) return selectOnly(key);
    S.sel = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)); updateSel();
  }

  // ---------- Dialoge, Meldungen ----------
  function toast(msg, act, fn) {
    for (const old of document.querySelectorAll('.toast')) old.remove();
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    if (act) t.append(h('button', { type: 'button', text: act, onclick: () => { t.remove(); fn(); } }));
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).append(t);
    setTimeout(() => t.remove(), act ? 8000 : 4500);
  }
  const fail = e => { const m = explain(e); status(m, true); toast(m); };
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
  }
  const badName = n => {
    if (!n) return 'Bitte einen Namen eingeben.';
    if (n.length > 255) return 'Der Name ist zu lang (höchstens 255 Zeichen).';
    if (/[\\/\u0000-\u001f]/.test(n)) return 'Der Name darf kein «/» oder «\\» enthalten.';
    if (n === '.' || n === '..') return 'Dieser Name ist nicht erlaubt.';
    return '';
  };
  let nameHandler = null;
  function askName({ title, label = 'Name', value = '', ok = 'OK' }, fn) {
    $('#nameTitle').textContent = title; $('#nameLabel').textContent = label; $('#nameOk').textContent = ok;
    const inp = $('#nameInput'); inp.value = value; $('#nameErr').hidden = true;
    nameHandler = fn;
    const dlg = $('#nameDialog');
    dlg.showModal();
    inp.focus();
    const dot = value.lastIndexOf('.');
    inp.setSelectionRange(0, dot > 0 ? dot : value.length);
  }
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#nameInput').value.trim(), err = $('#nameErr'), ok = $('#nameOk');
    const bad = badName(name);
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    ok.disabled = true;
    try { await nameHandler(name); $('#nameDialog').close(); }
    catch (ex) { err.textContent = explain(ex); err.hidden = false; }
    finally { ok.disabled = false; }
  });
  let confirmHandler = null;
  function confirmBox(title, text, okLabel, fn) {
    $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = okLabel;
    $('#confirmErr').hidden = true; confirmHandler = fn; $('#confirmDialog').showModal();
  }
  $('#confirmOk').addEventListener('click', async () => {
    const b = $('#confirmOk'); b.disabled = true;
    try { await confirmHandler(); $('#confirmDialog').close(); }
    catch (ex) { $('#confirmErr').textContent = explain(ex); $('#confirmErr').hidden = false; }
    finally { b.disabled = false; }
  });

  // ---------- Aktionen ----------
  async function createFolder(parent, name) {
    const rows = await rest('file_folders', { method: 'POST', body: { name, parent_id: parent }, prefer: 'return=representation' });
    const rec = rows[0]; S.folders.set(rec.id, rec); return rec;
  }
  function newFolder(parent = curFolder(), after) {
    askName({ title: 'Neuer Ordner', value: 'Neuer Ordner', ok: 'Erstellen' }, async name => {
      const rec = await createFolder(parent, name);
      if (after) after(rec); else load();
    });
  }
  const curFolder = () => (S.view.t === 'all' && !S.q ? S.view.folder : null);

  function renameItem(r) {
    askName({ title: r.type === 'folder' ? 'Ordner umbenennen' : 'Datei umbenennen', value: r.rec.name, ok: 'Umbenennen' }, async name => {
      if (name === r.rec.name) return;
      if (r.type === 'folder') { await rest(`file_folders?id=eq.${r.rec.id}`, { method: 'PATCH', body: { name } }); r.rec.name = name; }
      else { const kind = classify(name, r.rec.mime); await rest(`files?id=eq.${r.rec.id}`, { method: 'PATCH', body: { name, kind } }); Object.assign(r.rec, { name, kind }); }
      render();
    });
  }
  async function toggleStar(items) {
    const files = items.filter(r => r.type === 'file');
    if (!files.length) return;
    const on = !files.every(r => r.rec.starred);
    try {
      for (const part of chunks(files.map(r => r.rec.id), 50)) await rest(`files?id=in.(${part.join(',')})`, { method: 'PATCH', body: { starred: on } });
      for (const r of files) r.rec.starred = on;
      if (S.view.t === 'starred' && !on) load(); else render();
    } catch (e) { fail(e); }
  }

  const nowIso = () => new Date().toISOString();
  async function trashItems(items) {
    const ts = nowIso();
    const dirs = items.filter(r => r.type === 'folder').map(r => r.rec.id);
    const files = items.filter(r => r.type === 'file').map(r => r.rec.id);
    try {
      const all = [...new Set(dirs.flatMap(descendants))];
      for (const part of chunks(all, 50)) {
        await rest(`file_folders?id=in.(${part.join(',')})&deleted_at=is.null`, { method: 'PATCH', body: { deleted_at: ts } });
        await rest(`files?folder_id=in.(${part.join(',')})&deleted_at=is.null`, { method: 'PATCH', body: { deleted_at: ts } });
      }
      patchFolders(all.filter(id => !S.folders.get(id).deleted_at), { deleted_at: ts });
      for (const part of chunks(files, 50)) await rest(`files?id=in.(${part.join(',')})`, { method: 'PATCH', body: { deleted_at: ts } });
      S.sel.clear(); load();
      const n = items.length;
      toast(n === 1 ? `«${items[0].rec.name}» in den Papierkorb verschoben` : `${n} Elemente in den Papierkorb verschoben`, 'Rückgängig', () => restoreByIds(dirs, files, ts));
    } catch (e) { fail(e); load(); }
  }
  async function restoreByIds(dirs, files, ts) {
    try {
      for (const id of dirs) {
        const f = S.folders.get(id); if (!f) continue;
        const stamp = f.deleted_at || ts;
        const ids = descendants(id).filter(x => { const g = S.folders.get(x); return g && g.deleted_at === stamp; });
        const parentGone = f.parent_id && folderDeleted(f.parent_id);
        for (const part of chunks(ids, 50)) {
          await rest(`file_folders?id=in.(${part.join(',')})`, { method: 'PATCH', body: { deleted_at: null } });
          await rest(`files?folder_id=in.(${part.join(',')})&deleted_at=eq.${encodeURIComponent(stamp)}`, { method: 'PATCH', body: { deleted_at: null } });
        }
        patchFolders(ids, { deleted_at: null });
        if (parentGone) { await rest(`file_folders?id=eq.${id}`, { method: 'PATCH', body: { parent_id: null } }); f.parent_id = null; }
      }
      for (const part of chunks(files, 50)) {
        // Dateien, deren Ordner im Papierkorb liegt, kommen in «Alle Dateien»
        const recs = S.files.filter(x => part.includes(x.id));
        const orphan = recs.filter(x => x.folder_id && folderDeleted(x.folder_id)).map(x => x.id);
        await rest(`files?id=in.(${part.join(',')})`, { method: 'PATCH', body: { deleted_at: null } });
        if (orphan.length) await rest(`files?id=in.(${orphan.join(',')})`, { method: 'PATCH', body: { folder_id: null } });
      }
      S.sel.clear(); await load(); refreshUsage();
    } catch (e) { fail(e); }
  }
  const restoreItems = items => restoreByIds(items.filter(r => r.type === 'folder').map(r => r.rec.id), items.filter(r => r.type === 'file').map(r => r.rec.id), nowIso());

  // Endgültig löschen: erst die Dateien im Speicher, dann die Einträge
  async function purge(dirIds, fileRecs) {
    const all = [...new Set(dirIds.flatMap(descendants))];
    const paths = fileRecs.map(filePath);
    const seen = new Set(fileRecs.map(f => f.id));
    for (const part of chunks(all, 50)) {
      for (let off = 0; ; off += 1000) {
        const rows = await rest(`files?select=id&folder_id=in.(${part.join(',')})&limit=1000&offset=${off}`);
        for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); paths.push(`${UID}/${r.id}`); }
        if (rows.length < 1000) break;
      }
    }
    for (const part of chunks(paths, 100)) await api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: part } });
    for (const part of chunks(fileRecs.map(f => f.id), 50)) await rest(`files?id=in.(${part.join(',')})`, { method: 'DELETE' });
    for (const part of chunks(dirIds, 50)) await rest(`file_folders?id=in.(${part.join(',')})`, { method: 'DELETE' });
    for (const id of all) S.folders.delete(id);
    for (const p of paths) signCache.delete(p);
  }
  function purgeItems(items) {
    const n = items.length;
    confirmBox('Endgültig löschen?', n === 1 ? `«${items[0].rec.name}» wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.` : `${n} Elemente werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.`, 'Endgültig löschen', async () => {
      await purge(items.filter(r => r.type === 'folder').map(r => r.rec.id), items.filter(r => r.type === 'file').map(r => r.rec));
      S.sel.clear(); load(); refreshUsage();
    });
  }
  function emptyTrash() {
    confirmBox('Papierkorb leeren?', 'Alle Elemente im Papierkorb werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.', 'Papierkorb leeren', async () => {
      const dirs = viewFolders().map(f => f.id);
      await purge(dirs, S.files);
      S.sel.clear(); load(); refreshUsage();
    });
  }
  const deleteItems = items => { if (!items.length) return; if (inTrash()) purgeItems(items); else trashItems(items); };

  // Verschieben
  let moveItems = [], moveTarget = null;
  function openMove(items) {
    moveItems = items; moveTarget = curFolder();
    $('#moveSub').textContent = items.length === 1 ? items[0].rec.name : items.length + ' Elemente';
    $('#moveErr').hidden = true; drawTree(); $('#moveDialog').showModal();
  }
  function drawTree() {
    const tree = $('#moveTree');
    const blocked = new Set(moveItems.filter(r => r.type === 'folder').flatMap(r => descendants(r.rec.id)));
    tree.replaceChildren();
    const add = (id, name, depth) => {
      const b = h('button', { type: 'button', role: 'treeitem', 'aria-selected': String(moveTarget === id), style: `padding-left:${8 + depth * 18}px`, disabled: id && blocked.has(id) ? true : null },
        h('span', { 'aria-hidden': 'true', text: id ? '📁' : '🏠' }), name);
      b.addEventListener('click', () => { moveTarget = id; drawTree(); });
      tree.append(b);
    };
    add(null, 'Alle Dateien', 0);
    const walk = (parent, depth) => {
      for (const f of childrenOf(parent).filter(x => !x.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }))) { add(f.id, f.name, depth); walk(f.id, depth + 1); }
    };
    walk(null, 1);
  }
  $('#moveNew').addEventListener('click', () => newFolder(moveTarget, rec => { moveTarget = rec.id; drawTree(); }));
  $('#moveOk').addEventListener('click', async () => {
    try { await moveTo(moveItems, moveTarget); $('#moveDialog').close(); }
    catch (e) { const m = $('#moveErr'); m.textContent = explain(e); m.hidden = false; }
  });
  async function moveTo(items, target) {
    const dirs = items.filter(r => r.type === 'folder').map(r => r.rec.id).filter(id => id !== target && !(target && descendants(id).includes(target)));
    const files = items.filter(r => r.type === 'file').map(r => r.rec.id);
    for (const part of chunks(dirs, 50)) await rest(`file_folders?id=in.(${part.join(',')})`, { method: 'PATCH', body: { parent_id: target } });
    for (const part of chunks(files, 50)) await rest(`files?id=in.(${part.join(',')})`, { method: 'PATCH', body: { folder_id: target } });
    for (const id of dirs) { const f = S.folders.get(id); if (f) f.parent_id = target; }
    S.sel.clear(); await load();
    const name = target ? (S.folders.get(target) || {}).name : 'Alle Dateien';
    toast(`Verschoben nach «${name}»`);
  }

  // Herunterladen
  function saveUrl(url, name) {
    const a = h('a', { href: url, download: name || '', rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  }
  async function downloadFile(f) {
    const url = await signOne(filePath(f));
    saveUrl(url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name), f.name);
  }
  async function downloadItems(items) {
    try {
      if (items.length === 1 && items[0].type === 'file') return await downloadFile(items[0].rec);
      status('Wird vorbereitet …');
      const entries = [];       // { name, file | null }
      const used = new Set();
      const uniq = p => { let n = p, i = 2; while (used.has(n)) { const d = p.lastIndexOf('.'), s = d > p.lastIndexOf('/') + 1 ? d : p.length; n = p.slice(0, s) + ` (${i++})` + p.slice(s); } used.add(n); return n; };
      const addFolder = async (id, prefix) => {
        const base = uniq(prefix + S.folders.get(id).name + '/'); entries.push({ name: base, file: null });
        for (const c of childrenOf(id).filter(x => !x.deleted_at)) await addFolder(c.id, base);
        for (let off = 0; ; off += 1000) {
          const rows = await rest(`files?select=*&folder_id=eq.${id}&deleted_at=is.null&order=name.asc&limit=1000&offset=${off}`);
          for (const f of rows) entries.push({ name: uniq(base + f.name), file: f });
          if (rows.length < 1000) break;
        }
      };
      for (const r of items) { if (r.type === 'folder') await addFolder(r.rec.id, ''); else entries.push({ name: uniq(r.rec.name), file: r.rec }); }
      const total = entries.reduce((n, e) => n + (e.file ? e.file.size : 0), 0);
      if (total > MAX_ZIP) throw new Error(`Zu viel für einen Download auf einmal (${fmtSize(total)}, höchstens ${fmtSize(MAX_ZIP)}). Bitte in kleineren Teilen herunterladen.`);
      const out = []; let done = 0; const nFiles = entries.filter(e => e.file).length;
      for (const e of entries) {
        if (!e.file) { out.push({ name: e.name, data: null }); continue; }
        status(`Wird gepackt … ${++done} von ${nFiles}`);
        out.push({ name: e.name, data: await getBlob(filePath(e.file)), date: new Date(e.file.created_at) });
      }
      const blob = await Zip.build(out);
      const zipName = items.length === 1 && items[0].type === 'folder' ? items[0].rec.name + '.zip' : 'Dateien.zip';
      const url = URL.createObjectURL(blob);
      saveUrl(url, zipName); setTimeout(() => URL.revokeObjectURL(url), 60000);
      status(`«${zipName}» heruntergeladen (${fmtSize(blob.size)})`);
    } catch (e) { fail(e); }
  }

  // Teilen
  let shareFile = null, shareTok = 0;
  async function makeShare() {
    const my = ++shareTok, err = $('#shareErr'); err.hidden = true;
    $('#shareUrl').value = 'Wird erstellt …';
    try {
      const res = await api(`/storage/v1/object/sign/${BUCKET}/${filePath(shareFile)}`, { method: 'POST', body: { expiresIn: +$('#shareExp').value } });
      if (my !== shareTok) return;
      $('#shareUrl').value = fullUrl(res.signedURL);
    } catch (e) { if (my === shareTok) { $('#shareUrl').value = ''; err.textContent = explain(e); err.hidden = false; } }
  }
  function openShare(f) {
    shareFile = f; $('#shareName').textContent = f.name; $('#shareCopy').textContent = 'Kopieren';
    $('#shareDialog').showModal(); makeShare();
  }
  $('#shareExp').addEventListener('change', makeShare);
  $('#shareCopy').addEventListener('click', async () => {
    const inp = $('#shareUrl'); if (!inp.value.startsWith('http')) return;
    try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
    $('#shareCopy').textContent = 'Kopiert ✓';
  });
  $('#shareUrl').addEventListener('focus', e => e.target.select());

  // ---------- Vorschau ----------
  const PV = { list: [], i: 0, cleanup: () => {}, tok: 0 };
  const pvEnv = { getBlob: m => getBlob(m.path), getUrl: () => null };
  function openPreview(f) {
    PV.list = S.rows.filter(r => r.type === 'file').map(r => r.rec);
    PV.i = Math.max(0, PV.list.findIndex(x => x.id === f.id));
    if (!$('#pvDialog').open) $('#pvDialog').showModal();
    showPreview();
  }
  const decode = buf => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); } };
  async function showPreview() {
    PV.cleanup(); PV.cleanup = () => {};
    const my = ++PV.tok, f = PV.list[PV.i], body = $('#pvBody');
    $('#pvTitle').textContent = f.name;
    $('#pvMeta').textContent = `${fmtSize(f.size)} · ${fmtDate(f.created_at)} · ${PV.i + 1} von ${PV.list.length}`;
    $('#pvIcon').textContent = iconOf(f);
    $('#pvPrev').disabled = PV.i <= 0; $('#pvNext').disabled = PV.i >= PV.list.length - 1;
    body.className = 'pv-body';
    const note = t => body.replaceChildren(h('p', { class: 'note', text: t }));
    note('Wird geladen …');
    try {
      const path = filePath(f), docKind = PlanDocs.kind(f.name, f.mime);
      if (f.kind === 'image' || f.kind === 'video' || f.kind === 'audio') {
        const url = await signOne(path);
        if (my !== PV.tok) return;
        const m = f.kind === 'image' ? h('img', { alt: f.name }) : h(f.kind, { controls: true, preload: 'metadata', playsinline: true });
        m.onerror = () => note(f.kind === 'image' ? 'Das Bild kann nicht angezeigt werden.' : 'Dieses Format kann der Browser nicht abspielen. Bitte herunterladen.');
        m.src = url; body.replaceChildren(m);
      } else if (['pdf', 'docx', 'txt'].includes(docKind)) {
        body.classList.add('flow');
        const c = await PlanDocs.render(body, { name: f.name, mime: f.mime, path, cacheKey: f.id }, pvEnv);
        if (my !== PV.tok) { c(); return; }
        PV.cleanup = c;
      } else if (isTextLike(f) && f.size <= MAX_TEXT_PREVIEW) {
        const buf = await (await getBlob(path)).arrayBuffer();
        if (my !== PV.tok) return;
        if (new Uint8Array(buf.slice(0, 4096)).includes(0)) return note('Diese Datei ist keine Textdatei. Bitte herunterladen.');
        body.replaceChildren(h('pre', { class: 'code', text: decode(buf) }));
      } else if (isTextLike(f)) note('Die Datei ist zu gross für die Vorschau (über 2 MB). Bitte herunterladen.');
      else note('Für dieses Format gibt es keine Vorschau. Bitte herunterladen.');
    } catch (e) { if (my === PV.tok) note(explain(e)); }
  }
  const pvStep = d => { const n = PV.i + d; if (n >= 0 && n < PV.list.length) { PV.i = n; showPreview(); } };
  $('#pvPrev').addEventListener('click', () => pvStep(-1));
  $('#pvNext').addEventListener('click', () => pvStep(1));
  $('#pvDl').addEventListener('click', () => downloadFile(PV.list[PV.i]).catch(fail));
  $('#pvShare').addEventListener('click', () => openShare(PV.list[PV.i]));
  $('#pvDialog').addEventListener('close', () => { PV.tok++; PV.cleanup(); PV.cleanup = () => {}; $('#pvBody').replaceChildren(); });
  document.addEventListener('keydown', e => {
    if (!$('#pvDialog').open || [...document.querySelectorAll('dialog[open]')].pop() !== $('#pvDialog') || e.target.closest('input, textarea, select, video, audio')) return;
    if (e.key === 'ArrowLeft') { pvStep(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { pvStep(1); e.preventDefault(); }
  });

  // ---------- Hochladen ----------
  const U = { items: [], running: 0, MAX: 3, finished: 0 };
  async function ensurePath(rootId, dirs, cache) {
    let parent = rootId;
    for (const name of dirs) {
      const k = (parent || '') + '/' + name;
      if (!cache.has(k)) {
        const p = parent;
        cache.set(k, (async () => {
          const ex = [...S.folders.values()].find(f => !f.deleted_at && f.parent_id === p && f.name === name);
          return ex ? ex.id : (await createFolder(p, name)).id;
        })());
      }
      parent = await cache.get(k);
    }
    return parent;
  }
  async function namesIn(folderId) {
    const names = new Set();
    for (let off = 0; ; off += 1000) {
      const rows = await rest(`files?select=name&deleted_at=is.null&folder_id=${folderId ? 'eq.' + folderId : 'is.null'}&limit=1000&offset=${off}`);
      for (const r of rows) names.add(r.name);
      if (rows.length < 1000) break;
    }
    return names;
  }
  const uniqueName = (name, taken) => {
    if (!taken.has(name)) { taken.add(name); return name; }
    const d = name.lastIndexOf('.'), s = d > 0 ? d : name.length;
    for (let i = 2; ; i++) { const n = name.slice(0, s) + ` (${i})` + name.slice(s); if (!taken.has(n)) { taken.add(n); return n; } }
  };

  async function enqueue(entries, rootId) {
    if (inTrash()) rootId = null;
    const folderCache = new Map(), nameCache = new Map();
    let added = 0;
    try {
      for (const e of entries) {
        const folderId = await ensurePath(rootId, e.dirs, folderCache);
        if (!e.file) continue;
        if (!nameCache.has(folderId)) nameCache.set(folderId, await namesIn(folderId));
        const name = uniqueName(e.file.name, nameCache.get(folderId));
        U.items.push({ id: uuid(), file: e.file, name, folderId, state: 'wait', progress: 0, error: '' });
        added++;
      }
    } catch (ex) { fail(ex); }
    if (e_dirsOnly(entries)) scheduleReload();
    if (added) { U.finished = 0; drawUploads(); pump(); }
  }
  const e_dirsOnly = entries => entries.some(e => e.dirs.length);
  function drawUploads() {
    const box = $('#uploads'), ul = $('#upList');
    box.hidden = U.items.length === 0;
    const act = U.items.filter(i => i.state === 'wait' || i.state === 'run').length;
    const errs = U.items.filter(i => i.state === 'err').length;
    $('#upTitle').textContent = act ? `Lädt hoch … (${act} übrig)` : errs ? `Fertig – ${errs} fehlgeschlagen` : 'Hochladen abgeschlossen';
    ul.replaceChildren(...U.items.map(it => {
      const s = it.state === 'wait' ? 'Wartet' : it.state === 'run' ? Math.round(it.progress * 100) + ' %' : it.state === 'done' ? 'Fertig ✓' : it.error;
      const li = h('li', { class: it.state, 'data-id': it.id },
        h('span', { class: 'n', text: it.name, title: it.name }),
        h('span', { class: 's', text: s }),
        h('span', { class: 'bar' }, h('i', { style: `width:${it.state === 'done' ? 100 : Math.round(it.progress * 100)}%` })));
      if (it.state === 'err') li.querySelector('.s').append(' ', h('button', { type: 'button', text: 'Erneut', onclick: () => { it.state = 'wait'; it.progress = 0; drawUploads(); pump(); } }));
      if (it.state === 'wait' || it.state === 'run') li.querySelector('.s').append(' ', h('button', { type: 'button', text: '✕', title: 'Abbrechen', onclick: () => cancelUpload(it) }));
      return li;
    }));
  }
  function cancelUpload(it) {
    if (it.xhr) it.xhr.abort();
    else { U.items = U.items.filter(x => x !== it); drawUploads(); }
  }
  function putObject(path, file, token, it) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); it.xhr = x;
      x.open('POST', `${URL_}/storage/v1/object/${BUCKET}/${path}`);
      x.setRequestHeader('apikey', KEY); x.setRequestHeader('Authorization', 'Bearer ' + token); x.setRequestHeader('x-upsert', 'false');
      let last = 0;
      x.upload.onprogress = ev => { if (ev.lengthComputable && Date.now() - last > 120) { last = Date.now(); it.progress = ev.loaded / ev.total; drawUploads(); } };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve();
        let m = ''; try { m = JSON.parse(x.responseText).message; } catch { /* leer */ }
        reject(new ApiError(m || `Fehler ${x.status}`, x.status));
      };
      x.onerror = () => reject(new ApiError('Keine Verbindung zum Server.', 0));
      x.onabort = () => reject(new ApiError('Abgebrochen.', -1));
      const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', file);
      x.send(fd);
    });
  }
  async function uploadOne(it) {
    it.state = 'run'; it.progress = 0; it.error = ''; drawUploads();
    try {
      if (it.file.size > MAX_FILE) throw new ApiError(`Zu gross (${fmtSize(it.file.size)}, höchstens 50 MB)`, 400);
      const token = await Auth.token();
      if (!token) throw new ApiError('Sitzung abgelaufen. Bitte neu anmelden.', 401);
      const path = `${UID}/${it.id}`;
      await putObject(path, it.file, token, it);
      const mime = it.file.type || (PlanDocs.mimeOf(it.name, '') !== 'application/octet-stream' ? PlanDocs.mimeOf(it.name, '') : '');
      try {
        await rest('files', { method: 'POST', body: { id: it.id, folder_id: it.folderId, name: it.name, size: it.file.size, mime, kind: classify(it.name, mime) } });
      } catch (e) {
        try { await api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [path] } }); } catch { /* wird beim nächsten Aufräumen nicht gefunden */ }
        throw e;
      }
      it.state = 'done'; it.progress = 1;
    } catch (e) {
      if (e.status === -1) { U.items = U.items.filter(x => x !== it); return; }
      it.state = 'err'; it.error = explain(e);
    } finally { it.xhr = null; }
  }
  function pump() {
    while (U.running < U.MAX) {
      const it = U.items.find(i => i.state === 'wait');
      if (!it) break;
      U.running++;
      uploadOne(it).finally(() => {
        U.running--; drawUploads(); pump();
        const pending = U.items.some(i => i.state === 'wait' || i.state === 'run');
        if (!pending) { scheduleReload(); refreshUsage(); }
      });
    }
    drawUploads();
  }
  window.addEventListener('beforeunload', e => { if (U.items.some(i => i.state === 'wait' || i.state === 'run')) { e.preventDefault(); e.returnValue = ''; } });

  // Dateien und Ordner aus Auswahl / Ablegen einsammeln
  const fromInput = input => [...input.files].map(f => ({ file: f, dirs: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1) : [] }));
  async function fromDrop(dt) {
    const ents = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
    const loose = [...(dt.files || [])];
    if (!ents.length || ents.some(e => !e)) return loose.map(f => ({ file: f, dirs: [] }));
    const out = [];
    const walk = async (en, dirs) => {
      if (en.isFile) out.push({ file: await new Promise((res, rej) => en.file(res, rej)), dirs });
      else if (en.isDirectory) {
        const sub = [...dirs, en.name], reader = en.createReader();
        let any = false;
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          any = true;
          for (const c of batch) await walk(c, sub);
        }
        if (!any) out.push({ file: null, dirs: sub });
      }
    };
    for (const en of ents) await walk(en, []);
    return out;
  }
  const upload = (entries, folder) => {
    if (!entries.length) return;
    if (inTrash() && folder === undefined) { toast('Im Papierkorb kann nichts hochgeladen werden.'); return; }
    enqueue(entries, folder === undefined ? curFolder() : folder);
  };

  // ---------- Menüs ----------
  const ctx = $('#ctx');
  function menuFor(r) {
    const items = S.sel.has(r.key) ? selected() : [r];
    const one = items.length === 1 ? items[0] : null;
    const m = [];
    if (inTrash()) {
      m.push(['Wiederherstellen', () => restoreItems(items)]);
      if (one && one.type === 'file') m.push(['Vorschau', () => openPreview(one.rec)]);
      m.push('-', ['Endgültig löschen', () => purgeItems(items), true]);
      return m;
    }
    if (one) m.push(['Öffnen', () => openItem(one)]);
    m.push(['Herunterladen', () => downloadItems(items)]);
    if (one && one.type === 'file') m.push(['Link teilen …', () => openShare(one.rec)]);
    m.push('-');
    if (one) m.push(['Umbenennen', () => renameItem(one)]);
    m.push(['Verschieben …', () => openMove(items)]);
    const files = items.filter(x => x.type === 'file');
    if (files.length) m.push([files.every(x => x.rec.starred) ? 'Markierung entfernen' : 'Markieren', () => toggleStar(items)]);
    m.push('-', ['Löschen', () => trashItems(items), true]);
    return m;
  }
  function openMenu(r, x, y) {
    if (!S.sel.has(r.key)) selectOnly(r.key);
    ctx.replaceChildren(...menuFor(r).map(it => it === '-' ? h('hr') : h('button', { type: 'button', role: 'menuitem', class: it[2] ? 'danger' : '', text: it[0], onclick: () => { closeMenus(); it[1](); } })));
    ctx.hidden = false;
    const w = ctx.offsetWidth, hh = ctx.offsetHeight;
    ctx.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
    ctx.style.top = Math.max(6, Math.min(y, innerHeight - hh - 6)) + 'px';
    const first = ctx.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function closeMenus() { ctx.hidden = true; $('#uploadMenu').hidden = true; $('#uploadMore').setAttribute('aria-expanded', 'false'); }
  document.addEventListener('click', e => { if (!e.target.closest('#ctx, .more, #uploadMore, #uploadMenu')) closeMenus(); });
  document.addEventListener('scroll', closeMenus, true);
  window.addEventListener('resize', closeMenus);

  function openItem(r) {
    if (r.type === 'folder') { if (inTrash()) return toast('Zum Öffnen zuerst wiederherstellen.'); go({ t: 'all', folder: r.rec.id, kind: null }); }
    else openPreview(r.rec);
  }

  // ---------- Ereignisse: Liste ----------
  const list = $('#list');
  const rowOf = e => e.target.closest('[data-key]');
  list.addEventListener('click', e => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const col = sortBtn.dataset.sort;
      S.sort = { col, dir: S.sort.col === col && S.sort.dir === 'asc' ? 'desc' : 'asc' }; pref.set({ sort: S.sort }); load(); return;
    }
    const el = rowOf(e); if (!el) return;
    const r = rowByKey(el.dataset.key); if (!r) return;
    if (e.target.closest('.more')) { const b = e.target.closest('.more').getBoundingClientRect(); openMenu(r, b.right - 150, b.bottom + 4); e.stopPropagation(); return; }
    if (e.target.closest('.chk')) { toggleKey(r.key); return; }
    if (e.target.closest('.t, .pv') && !e.ctrlKey && !e.metaKey && !e.shiftKey) { openItem(r); return; }
    if (e.shiftKey) rangeTo(r.key); else if (e.ctrlKey || e.metaKey) toggleKey(r.key); else selectOnly(r.key);
  });
  list.addEventListener('dblclick', e => { const el = rowOf(e); if (el && !e.target.closest('.chk, .more')) { const r = rowByKey(el.dataset.key); if (r) openItem(r); } });
  list.addEventListener('contextmenu', e => { const el = rowOf(e); if (!el) return; e.preventDefault(); const r = rowByKey(el.dataset.key); if (r) openMenu(r, e.clientX, e.clientY); });
  list.addEventListener('keydown', e => {
    const el = rowOf(e); if (!el || e.target.closest('.more')) return;
    const r = rowByKey(el.dataset.key); if (!r) return;
    if (e.key === 'Enter') { openItem(r); e.preventDefault(); }
    else if (e.key === ' ') { toggleKey(r.key); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = [...list.querySelectorAll('[data-key]')], i = all.indexOf(el), n = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) { n.focus(); if (!e.shiftKey) selectOnly(n.dataset.key); else rangeTo(n.dataset.key); } e.preventDefault();
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { const b = el.getBoundingClientRect(); openMenu(r, b.left + 40, b.bottom); e.preventDefault(); }
  });
  $('#moreBtn').addEventListener('click', () => load(true));

  // Ziehen: Elemente in Ordner verschieben, Dateien von aussen hochladen
  let dragKeys = null;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  list.addEventListener('dragstart', e => {
    const el = rowOf(e); if (!el) return;
    if (!S.sel.has(el.dataset.key)) selectOnly(el.dataset.key);
    dragKeys = [...S.sel];
    e.dataTransfer.setData('application/x-fm', JSON.stringify(dragKeys));
    e.dataTransfer.effectAllowed = 'move';
    for (const k of dragKeys) { const x = list.querySelector(`[data-key="${k}"]`); if (x) x.classList.add('dragging'); }
  });
  list.addEventListener('dragend', () => { dragKeys = null; for (const x of document.querySelectorAll('.dragging, .drop')) x.classList.remove('dragging', 'drop'); });
  // Ziel: { folder: id|null, trash: bool }
  function dropTarget(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.key && el.dataset.key.startsWith('d:') && !inTrash()) return { folder: el.dataset.key.slice(2) };
    if (el.dataset && el.dataset.drop === 'root') return { folder: null };
    if (el.dataset && el.dataset.drop === 'trash') return { trash: true };
    if (el.dataset && 'dropFolder' in el.dataset) return { folder: el.dataset.dropFolder || null };
    return null;
  }
  const dropEl = e => e.target.closest('[data-key^="d:"], [data-drop], [data-drop-folder]');
  document.addEventListener('dragover', e => {
    const el = dropEl(e), t = dropTarget(el);
    for (const x of document.querySelectorAll('.drop')) if (x !== el) x.classList.remove('drop');
    if (dragKeys && t) {
      if (t.folder && dragKeys.includes('d:' + t.folder)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop');
    } else if (hasFiles(e) && !dragKeys) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      if (t && !t.trash) el.classList.add('drop');
    }
  });
  document.addEventListener('drop', async e => {
    for (const x of document.querySelectorAll('.drop')) x.classList.remove('drop');
    dz.hidden = true; dzDepth = 0;
    const el = dropEl(e), t = dropTarget(el);
    if (dragKeys && t) {
      e.preventDefault();
      const items = dragKeys.map(rowByKey).filter(Boolean);
      dragKeys = null;
      if (t.trash) trashItems(items);
      else if (!(t.folder && items.some(r => r.key === 'd:' + t.folder))) moveTo(items, t.folder).catch(fail);
    } else if (hasFiles(e) && !dragKeys) {
      e.preventDefault();
      const entries = await fromDrop(e.dataTransfer);
      if (t && t.trash) return;
      upload(entries, t ? t.folder : undefined);
    }
  });
  const dz = $('#dropzone'); let dzDepth = 0;
  document.addEventListener('dragenter', e => { if (hasFiles(e) && !dragKeys) { dzDepth++; dz.hidden = false; } });
  document.addEventListener('dragleave', e => { if (hasFiles(e) && !dragKeys && --dzDepth <= 0) { dzDepth = 0; dz.hidden = true; } });

  // ---------- Ereignisse: Kopfzeile ----------
  const pickFiles = $('#pickFiles'), pickDir = $('#pickDir');
  pickFiles.addEventListener('change', () => { upload(fromInput(pickFiles)); pickFiles.value = ''; });
  pickDir.addEventListener('change', () => { upload(fromInput(pickDir)); pickDir.value = ''; });
  $('#uploadBtn').addEventListener('click', () => pickFiles.click());
  $('#upFiles').addEventListener('click', () => { closeMenus(); pickFiles.click(); });
  $('#upDir').addEventListener('click', () => { closeMenus(); pickDir.click(); });
  $('#uploadMore').addEventListener('click', e => {
    e.stopPropagation();
    const m = $('#uploadMenu'), open = m.hidden;
    closeMenus(); m.hidden = !open; $('#uploadMore').setAttribute('aria-expanded', String(open));
  });
  $('#newFolder').addEventListener('click', () => { if (inTrash()) return toast('Im Papierkorb kann kein Ordner angelegt werden.'); newFolder(); });
  $('#viewList').addEventListener('click', () => { S.mode = 'list'; pref.set({ mode: 'list' }); render(); });
  $('#viewGrid').addEventListener('click', () => { S.mode = 'grid'; pref.set({ mode: 'grid' }); render(); });
  let qTimer = 0;
  $('#q').addEventListener('input', e => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value.trim(); S.sel.clear(); load(); }, 250);
  });
  $('#bkDownload').addEventListener('click', () => downloadItems(selected()));
  $('#bkMove').addEventListener('click', () => openMove(selected()));
  $('#bkRestore').addEventListener('click', () => restoreItems(selected()));
  $('#bkDelete').addEventListener('click', () => deleteItems(selected()));
  $('#bkClear').addEventListener('click', () => { S.sel.clear(); updateSel(); });
  $('#emptyTrash').addEventListener('click', emptyTrash);
  $('#upClose').addEventListener('click', () => { U.items = U.items.filter(i => i.state === 'wait' || i.state === 'run'); drawUploads(); });
  $('#upCollapse').addEventListener('click', () => $('#uploads').classList.toggle('min'));

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { if (!ctx.hidden) closeMenus(); else if (S.sel.size) { S.sel.clear(); updateSel(); } }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.rows.map(r => r.key)); updateSel(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.size) { e.preventDefault(); deleteItems(selected()); }
    else if (e.key === 'F2' && S.sel.size === 1 && !inTrash()) { e.preventDefault(); renameItem(selected()[0]); }
  });

  // Seitenleiste & Konto
  const layout = $('#layout'), sbBtn = $('#sidebarToggle');
  function setSidebar(open) { layout.classList.toggle('collapsed', !open); sbBtn.setAttribute('aria-expanded', String(open)); try { localStorage.setItem('files-sidebar', open ? '1' : '0'); } catch { /* ignorieren */ } }
  sbBtn.addEventListener('click', () => setSidebar(layout.classList.contains('collapsed')));
  try { if (localStorage.getItem('files-sidebar') === '0') setSidebar(false); } catch { /* ignorieren */ }
  $('#logoutBtn').addEventListener('click', async () => { await Auth.logout(); location.href = '../login/'; });

  // ---------- Start ----------
  (async function init() {
    $('#whoAmI').textContent = '👤 ' + Auth.displayName(); $('#whoAmI').hidden = false; $('#logoutBtn').hidden = false;
    try { await loadFolders(); S.foldersLoaded = true; } catch (e) { status(explain(e), true); fatal(explain(e)); }
    S.view = viewFromHash();
    await load();
    refreshUsage();
  })();
})();

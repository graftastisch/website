'use strict';
/* ==========================================================
   Dokumente (PDF, Word, TXT) im Termin – nur Ansicht, nicht bearbeitbar.
   Alles läuft im Browser, es wird nichts an Dritte gesendet:
     TXT   → Text
     DOCX  → eigener kleiner Leser (Absätze, Überschriften, Listen, Tabellen, fett/kursiv)
     PDF   → pdf.js (liegt unter assets/vendor/pdfjs/)
     DOC   → alte Word-Dateien können nicht angezeigt werden (nur Herunterladen)
   Die Kachel hat dieselbe Grösse wie Bilder/Videos. Ist das Dokument länger,
   öffnet ein Klick darauf die Ansicht in Gross (#docDialog).
   ========================================================== */
window.PlanDocs = (() => {
  const SCRIPT = (document.currentScript && document.currentScript.src) || location.href;
  const PDF_BASE = new URL('vendor/pdfjs/', SCRIPT).href;

  const MIME = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const LABEL = { pdf: 'PDF', txt: 'TXT', doc: 'DOC', docx: 'DOCX' };
  const ACCEPT = '.pdf,.txt,.doc,.docx,' + Object.values(MIME).join(',');
  const MAX_TEXT = 2_000_000;       // Zeichen, die in der Grossansicht höchstens angezeigt werden
  const MAX_XML = 40 * 1024 * 1024; // Schutz vor manipulierten Word-Dateien

  const extOf = n => ((String(n || '').match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
  const kind = (name, mime = '') => {
    const e = extOf(name);
    if (MIME[e]) return e;
    return Object.keys(MIME).find(k => MIME[k] === mime) || '';
  };
  const mimeOf = (name, fallback = '') => MIME[kind(name, fallback)] || fallback || 'application/octet-stream';

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
    return e;
  }

  // ---------- TXT ----------
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  }

  // ---------- DOCX (ZIP + XML, ohne Bibliothek) ----------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann Word-Dateien nicht entpacken.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function zipIndex(buf) {
    const dv = new DataView(buf);
    let i = buf.byteLength - 22;
    const stop = Math.max(0, buf.byteLength - 65557);
    while (i >= stop && dv.getUint32(i, true) !== 0x06054b50) i--;
    if (i < stop) throw new Error('Keine gültige Word-Datei.');
    const count = dv.getUint16(i + 10, true);
    let p = dv.getUint32(i + 16, true);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Beschädigte Word-Datei.');
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      entries.set(name, { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), lho: dv.getUint32(p + 42, true) });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return { dv, entries };
  }
  async function zipRead(buf, idx, name) {
    const e = idx.entries.get(name);
    if (!e) return null;
    if (e.usize > MAX_XML) throw new Error('Datei zu gross.');
    const { dv } = idx;
    if (dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('Beschädigte Word-Datei.');
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    const data = new Uint8Array(buf, start, e.csize);
    const raw = e.method === 0 ? data : e.method === 8 ? await inflateRaw(data) : null;
    if (!raw) throw new Error('Nicht unterstützte Komprimierung.');
    return new TextDecoder().decode(raw);
  }
  function xml(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Beschädigte Word-Datei.');
    return d;
  }
  const kids = (n, name) => [...n.children].filter(c => c.localName === name);
  const kid = (n, name) => (n && [...n.children].find(c => c.localName === name)) || null;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const attr = (n, name) => (n ? (n.getAttributeNS(W, name) ?? n.getAttribute('w:' + name) ?? n.getAttribute(name)) : null);
  const val = n => attr(n, 'val');
  const on = n => !!n && !['0', 'false', 'off', 'none'].includes(String(val(n) ?? 'true').toLowerCase());

  async function parseDocx(buf) {
    const idx = zipIndex(buf);
    const docText = await zipRead(buf, idx, 'word/document.xml');
    if (!docText) throw new Error('Kein Word-Dokument (word/document.xml fehlt).');
    const doc = xml(docText);
    const stylesText = await zipRead(buf, idx, 'word/styles.xml');
    const numText = await zipRead(buf, idx, 'word/numbering.xml');

    // Überschriften-Stile erkennen
    const heading = {};
    const styleNum = {};   // Listen, die in der Formatvorlage (z. B. "Liste mit Punkten") festgelegt sind
    if (stylesText) {
      for (const s of xml(stylesText).getElementsByTagName('*')) {
        if (s.localName !== 'style') continue;
        const id = attr(s, 'styleId') || '';
        const name = val(kid(s, 'name')) || '';
        const m = /^(?:heading|überschrift)\s*([1-6])$/i.exec(name) || /^heading([1-6])$/i.exec(id);
        const sn = kid(kid(s, 'pPr'), 'numPr');
        if (sn && val(kid(sn, 'numId'))) styleNum[id] = { numId: val(kid(sn, 'numId')), ilvl: val(kid(sn, 'ilvl')) || '0' };
        if (m) heading[id] = +m[1];
        else if (/^(title|titel)$/i.test(name)) heading[id] = 1;
      }
    }
    // Aufzählungen: nummeriert oder Punkte?
    const numFmt = {};   // `${numId}:${ilvl}` → Format
    if (numText) {
      const nd = xml(numText);
      const abs = {};
      for (const a of nd.getElementsByTagName('*')) {
        if (a.localName !== 'abstractNum') continue;
        const id = attr(a, 'abstractNumId');
        abs[id] = {};
        for (const l of kids(a, 'lvl')) abs[id][attr(l, 'ilvl')] = val(kid(l, 'numFmt'));
      }
      for (const n of nd.getElementsByTagName('*')) {
        if (n.localName !== 'num') continue;
        const a = abs[val(kid(n, 'abstractNumId'))] || {};
        for (const [lvl, fmt] of Object.entries(a)) numFmt[`${attr(n, 'numId')}:${lvl}`] = fmt;
      }
    }

    const counters = {};
    const runsOf = node => {
      const out = [];
      for (const c of node.children) {
        if (c.localName === 'r') {
          const pr = kid(c, 'rPr');
          let text = '';
          for (const t of c.children) {
            if (t.localName === 't') text += t.textContent;
            else if (t.localName === 'tab') text += '\t';
            else if (t.localName === 'br' && attr(t, 'type') !== 'page') text += '\n';
            else if (t.localName === 'cr') text += '\n';
          }
          if (text) out.push({ text, b: on(kid(pr, 'b')), i: on(kid(pr, 'i')), u: !!kid(pr, 'u') && val(kid(pr, 'u')) !== 'none' });
        } else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(c.localName)) out.push(...runsOf(c));
      }
      return out;
    };
    const para = p => {
      const pr = kid(p, 'pPr');
      const style = val(kid(pr, 'pStyle'));
      const b = { t: 'p', runs: runsOf(p), level: heading[style] || 0 };
      const np = kid(pr, 'numPr');
      const sn = styleNum[style];
      if (np || sn) {
        const numId = np ? val(kid(np, 'numId')) || (sn && sn.numId) : sn.numId;
        const ilvl = (np && val(kid(np, 'ilvl'))) || (sn && sn.ilvl) || '0';
        if (numId && numId !== '0') {
          const fmt = numFmt[`${numId}:${ilvl}`];
          const ordered = fmt && fmt !== 'bullet' && fmt !== 'none';
          const key = `${numId}:${ilvl}`;
          for (const k of Object.keys(counters)) if (k.startsWith(numId + ':') && +k.split(':')[1] > +ilvl) delete counters[k];
          counters[key] = (counters[key] || 0) + 1;
          b.list = { lvl: +ilvl, mark: ordered ? counters[key] + '.' : '•' };
        }
      }
      return b;
    };

    const body = [...doc.getElementsByTagName('*')].find(n => n.localName === 'body');
    const blocks = [];
    for (const c of body ? body.children : []) {
      if (c.localName === 'p') blocks.push(para(c));
      else if (c.localName === 'tbl') {
        const rows = kids(c, 'tr').map(tr => kids(tr, 'tc').map(tc => kids(tc, 'p').map(p => runsOf(p))));
        blocks.push({ t: 'table', rows });
      }
      if (blocks.length > 20000) break;
    }
    return blocks;
  }

  function runNodes(runs) {
    const out = [];
    for (const r of runs) {
      let node = document.createDocumentFragment();
      r.text.replace(/\t/g, '    ').split('\n').forEach((ln, i) => { if (i) node.append(document.createElement('br')); node.append(ln); });
      if (r.u) { const u = el('u'); u.append(node); node = u; }
      if (r.i) { const e = el('em'); e.append(node); node = e; }
      if (r.b) { const s = el('strong'); s.append(node); node = s; }
      out.push(node);
    }
    return out;
  }
  function renderBlocks(blocks, limit = Infinity) {
    const root = el('div', { class: 'docx' });
    let empty = 0;
    for (const b of blocks.slice(0, limit)) {
      if (b.t === 'table') {
        const tb = el('table');
        for (const row of b.rows) {
          const tr = el('tr');
          for (const cell of row) {
            const td = el('td');
            cell.forEach((runs, i) => { if (i) td.append(el('br')); td.append(...runNodes(runs)); });
            tr.append(td);
          }
          tb.append(tr);
        }
        root.append(tb); empty = 0;
        continue;
      }
      const text = b.runs.map(r => r.text).join('').trim();
      if (!text) { if (root.childNodes.length && !empty) root.append(el('p', { class: 'gap' })); empty++; continue; }
      empty = 0;
      if (b.level) root.append(el('h' + Math.min(b.level + 1, 4), { class: 'h' }, ...runNodes(b.runs)));
      else if (b.list) root.append(el('div', { class: 'li', style: `padding-left:${18 + b.list.lvl * 18}px` }, el('span', { class: 'mark', text: b.list.mark }), el('span', {}, ...runNodes(b.runs))));
      else root.append(el('p', {}, ...runNodes(b.runs)));
    }
    return root;
  }

  // ---------- PDF (pdf.js) ----------
  let pdfLibP = null;
  function pdfLib() {
    if (!pdfLibP) {
      pdfLibP = import(PDF_BASE + 'pdf.min.mjs').then(lib => {
        lib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.mjs';
        return lib;
      }).catch(e => { pdfLibP = null; throw e; });
    }
    return pdfLibP;
  }
  async function pdfPage(pdf, n, cssWidth) {
    const page = await pdf.getPage(n);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w1 = page.getViewport({ scale: 1 }).width;
    const vp = page.getViewport({ scale: (cssWidth / w1) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = (canvas.height / dpr) + 'px';
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas;
  }

  // ---------- Modell laden (einmal pro Datei) ----------
  const byBlob = new WeakMap(), byPath = new Map();
  function model(m, env) {
    const store = m.blob ? byBlob : byPath;
    const key = m.blob || m.cacheKey || m.path;
    let p = store.get(key);
    if (!p) {
      p = load(m, env).catch(e => { console.warn('Dokument nicht lesbar', e); store.delete(key); return { kind: 'error' }; });
      store.set(key, p);
    }
    return p;
  }
  async function load(m, env) {
    const k = kind(m.name, m.mime);
    if (!k || k === 'doc') return { kind: 'other' };
    const buf = await (await env.getBlob(m)).arrayBuffer();
    if (k === 'txt') return { kind: 'txt', text: decodeText(buf) };
    if (k === 'docx') return { kind: 'docx', blocks: await parseDocx(buf) };
    const lib = await pdfLib();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false, standardFontDataUrl: PDF_BASE + 'standard_fonts/' }).promise;
    return { kind: 'pdf', pdf };
  }

  const downloadLink = (m, env, text, cls) => {
    const url = env.getUrl(m);
    if (!url) return null;
    return el('a', { class: cls, href: url, download: m.name || 'dokument', target: '_blank', rel: 'noopener', title: 'Herunterladen', text, onclick: e => e.stopPropagation() });
  };
  const chip = m => { const k = kind(m.name, m.mime); return el('span', { class: 'doc-ext k-' + (k || 'x'), text: LABEL[k] || 'DATEI' }); };

  // ---------- Kachel (gleiche Grösse wie Bilder/Videos) ----------
  function tile(m, env) {
    const k = kind(m.name, m.mime);
    const paper = el('div', { class: 'doc-paper' }, el('p', { class: 'doc-note', text: 'Wird geladen …' }));
    const more = el('span', { class: 'doc-more', text: 'Vergrössern ⤢', hidden: true });
    const root = el('div', { class: 'doc-tile' }, paper,
      el('div', { class: 'doc-bar' }, chip(m), el('span', { class: 'doc-name', text: m.name || 'Dokument', title: m.name || '' }), more, downloadLink(m, env, '⬇', 'doc-dl')));

    const note = text => { paper.replaceChildren(el('p', { class: 'doc-note', text })); };
    const makeOpenable = mod => {
      root.classList.add('more'); more.hidden = false;
      root.tabIndex = 0; root.setAttribute('role', 'button');
      root.setAttribute('aria-label', `${m.name || 'Dokument'} – Ganze Ansicht öffnen`);
      const open = () => openLarge(m, env, mod);
      root.addEventListener('click', open);
      root.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    };

    async function fill() {
      const mod = await model(m, env);
      if (mod.kind === 'error') return note('Vorschau nicht verfügbar.');
      if (mod.kind === 'other') return note(k === 'doc' ? 'Alte Word-Dateien (.doc) können nicht angezeigt werden – bitte herunterladen.' : 'Keine Vorschau möglich.');
      let longer = false;
      if (mod.kind === 'txt') {
        paper.replaceChildren(el('pre', { class: 'doc-text', text: mod.text.slice(0, 3000) }));
        longer = mod.text.length > 3000;
      } else if (mod.kind === 'docx') {
        paper.replaceChildren(renderBlocks(mod.blocks, 80));
        longer = mod.blocks.length > 80;
      } else if (mod.kind === 'pdf') {
        try {
          const canvas = await pdfPage(mod.pdf, 1, paper.clientWidth);
          paper.classList.add('pdf');
          paper.replaceChildren(canvas);
          longer = mod.pdf.numPages > 1 || canvas.clientHeight > paper.clientHeight + 2;
        } catch (e) { console.warn(e); return note('Vorschau nicht verfügbar.'); }
      }
      if (longer || paper.scrollHeight > paper.clientHeight + 2) makeOpenable(mod);
    }

    let started = false;
    const ro = new ResizeObserver(() => {
      if (started || root.clientWidth < 1) return;
      started = true; ro.disconnect();
      fill().catch(e => { console.warn(e); note('Vorschau nicht verfügbar.'); });
    });
    ro.observe(root);
    return root;
  }

  // ---------- Grosse Ansicht ----------
  // Füllt einen Behälter mit der ganzen Ansicht. Gibt eine Aufräum-Funktion zurück.
  function fillLarge(body, mod) {
    body.replaceChildren();
    let observer = null;
    if (mod.kind === 'txt') {
      const t = mod.text.length > MAX_TEXT ? mod.text.slice(0, MAX_TEXT) + '\n\n… (gekürzt – bitte herunterladen)' : mod.text;
      body.append(el('pre', { class: 'doc-text big', text: t }));
    } else if (mod.kind === 'docx') {
      body.append(el('div', { class: 'doc-page' }, renderBlocks(mod.blocks)));
    } else if (mod.kind === 'pdf') {
      const width = Math.max(260, Math.min(860, body.clientWidth - 28));
      observer = new IntersectionObserver(entries => {
        for (const en of entries) {
          const box = en.target;
          if (!en.isIntersecting || box.dataset.done) continue;
          box.dataset.done = '1';
          pdfPage(mod.pdf, +box.dataset.n, width)
            .then(c => { box.style.minHeight = ''; box.replaceChildren(c); })
            .catch(() => { box.textContent = 'Seite konnte nicht angezeigt werden.'; });
          observer.unobserve(box);
        }
      }, { root: body, rootMargin: '700px 0px' });
      for (let n = 1; n <= mod.pdf.numPages; n++) {
        const box = el('div', { class: 'pdf-page', 'data-n': n });
        box.style.width = width + 'px'; box.style.minHeight = Math.round(width * 1.4) + 'px';
        body.append(box); observer.observe(box);
      }
    }
    return () => { if (observer) observer.disconnect(); };
  }

  let cleanup = () => {};
  async function openLarge(m, env, mod) {
    const dlg = document.getElementById('docDialog');
    const body = dlg.querySelector('.doc-body');
    dlg.querySelector('.doc-title').textContent = m.name || 'Dokument';
    dlg.querySelector('.doc-kind').replaceChildren(chip(m));
    dlg.querySelector('.doc-actions').replaceChildren(downloadLink(m, env, '⬇ Herunterladen', 'btn small') || '');
    body.scrollTop = 0;
    if (!dlg.open) dlg.showModal();
    cleanup(); cleanup = fillLarge(body, mod);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const dlg = document.getElementById('docDialog');
    if (dlg) dlg.addEventListener('close', () => { cleanup(); cleanup = () => {}; dlg.querySelector('.doc-body').replaceChildren(); });
  });

  // Ganze Ansicht in einem eigenen Behälter (z. B. Vorschau-Fenster der Dateiverwaltung).
  // m = { name, mime, path | blob | cacheKey }, env = { getBlob(m), getUrl(m) }.
  // Gibt eine Aufräum-Funktion zurück; bei Fehlern steht eine Meldung im Behälter.
  async function render(container, m, env) {
    container.replaceChildren(el('p', { class: 'doc-note', text: 'Wird geladen …' }));
    const mod = await model(m, env);
    if (mod.kind === 'error') { container.replaceChildren(el('p', { class: 'doc-note', text: 'Vorschau nicht verfügbar.' })); return () => {}; }
    if (mod.kind === 'other') { container.replaceChildren(el('p', { class: 'doc-note', text: 'Für dieses Format gibt es keine Vorschau.' })); return () => {}; }
    return fillLarge(container, mod);
  }

  return { accept: ACCEPT, kind, mimeOf, tile, render };
})();

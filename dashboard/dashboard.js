'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const SKIP = 'dashboard-name-skipped';

  function show(el, text, kind) {
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }
  function explain(e) {
    switch (e.code) {
      case 'empty_name': return 'Bitte einen Namen eingeben.';
      case 'name_too_long': return 'Der Name darf höchstens 40 Zeichen lang sein.';
      case 'network': return 'Keine Verbindung zum Server.';
      case 'same_password': return 'Das neue Passwort muss sich vom alten unterscheiden.';
      case 'weak_password': return 'Das Passwort ist zu schwach – bitte ein längeres wählen.';
      case 'no_session': return 'Du bist nicht mehr angemeldet.';
      default: return e.status === 429 ? 'Zu viele Versuche – bitte einen Moment warten.' : (e.message || 'Unbekannter Fehler.');
    }
  }
  const goLogin = () => location.replace('../login/?next=' + encodeURIComponent(location.pathname));

  // ---------- Karten aus der Navigation erzeugen ----------
  function buildCards() {
    const box = $('#cards');
    box.textContent = '';
    const apps = [...document.querySelectorAll('.nav-item.app')];
    if (!apps.length) { box.innerHTML = '<p class="empty">Noch keine Anwendungen.</p>'; return; }
    for (const a of apps) {
      const c = document.createElement('a');
      c.className = 'card'; c.href = a.getAttribute('href');
      const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = a.querySelector('.ico')?.textContent || '•';
      const t = document.createElement('b'); t.textContent = [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      const d = document.createElement('span'); d.className = 'd'; d.textContent = a.dataset.desc || '';
      c.append(ico, t, d);
      box.append(c);
    }
  }

  // ---------- Ansichten (Übersicht / Einstellungen) ----------
  function route() {
    const view = location.hash === '#einstellungen' && Auth.enabled ? 'einstellungen' : 'uebersicht';
    $('#viewUebersicht').hidden = view !== 'uebersicht';
    $('#viewEinstellungen').hidden = view !== 'einstellungen';
    for (const n of document.querySelectorAll('.nav-item[data-view]')) n.classList.toggle('active', n.dataset.view === view);
  }

  // ---------- Nutzer anzeigen ----------
  function renderUser() {
    if (!Auth.enabled) return;
    const name = Auth.displayName();
    $('#uName').textContent = name;
    $('#uLogin').textContent = Auth.hasDisplayName() ? Auth.username() : '';
    $('#uAvatar').textContent = (name.trim()[0] || '?').toUpperCase();
    $('#hello').textContent = name;
    $('#loginName').textContent = Auth.username();
    if (document.activeElement !== $('#nameInput')) $('#nameInput').value = Auth.hasDisplayName() ? name : '';
  }

  // ---------- Willkommen-Dialog ----------
  const welcome = $('#welcome');
  function openWelcome() {
    welcome.hidden = false;
    $('#welcomeInput').value = '';
    $('#welcomeInput').focus();
  }
  function closeWelcome(skipped) {
    welcome.hidden = true;
    if (skipped) { try { sessionStorage.setItem(SKIP, '1'); } catch { /* ignorieren */ } }
  }
  $('#welcomeSkip').addEventListener('click', () => closeWelcome(true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !welcome.hidden) closeWelcome(true); });
  $('#welcomeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#welcomeBtn'), msg = $('#welcomeMsg');
    show(msg, ''); btn.disabled = true;
    try {
      await Auth.setDisplayName($('#welcomeInput').value);
      closeWelcome(false); renderUser();
    } catch (err) { show(msg, explain(err), 'err'); }
    finally { btn.disabled = false; }
  });

  // ---------- Einstellungen ----------
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#nameBtn'), msg = $('#nameMsg');
    show(msg, ''); btn.disabled = true;
    try {
      await Auth.setDisplayName($('#nameInput').value);
      renderUser(); show(msg, 'Gespeichert ✓', 'ok');
    } catch (err) { show(msg, explain(err), 'err'); }
    finally { btn.disabled = false; }
  });

  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#pwMsg'), btn = $('#pwBtn');
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a.length < 8) return show(msg, 'Das Passwort braucht mindestens 8 Zeichen.', 'err');
    if (a !== b) return show(msg, 'Die beiden Passwörter stimmen nicht überein.', 'err');
    btn.disabled = true;
    try {
      await Auth.changePassword(a);
      $('#pw1').value = ''; $('#pw2').value = '';
      show(msg, 'Passwort geändert ✓', 'ok');
    } catch (err) { show(msg, explain(err), 'err'); }
    finally { btn.disabled = false; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    try { indexedDB.deleteDatabase('wochenplan'); } catch { /* ignorieren */ }
    try { sessionStorage.removeItem(SKIP); } catch { /* ignorieren */ }
    location.replace('../login/');
  });

  // ---------- Start ----------
  buildCards();
  window.addEventListener('hashchange', route);
  route();

  if (!Auth.enabled) {
    // Ohne Login-Konfiguration: reine Übersicht, keine Konto-Funktionen
    for (const s of ['#logoutBtn', '#userCard', '#navSettings']) $(s).hidden = true;
    $('#hello').textContent = 'willkommen';
    return;
  }
  if (!Auth.session()) return;   // Weiterleitung zum Login läuft bereits
  renderUser();

  Auth.me().then(() => {
    renderUser();
    let skipped = false;
    try { skipped = !!sessionStorage.getItem(SKIP); } catch { /* ignorieren */ }
    if (!Auth.hasDisplayName() && !skipped) openWelcome();
  }).catch(e => {
    if (!Auth.session()) goLogin();   // Sitzung ungültig
    // sonst (z. B. offline): mit dem Zwischengespeicherten weiterarbeiten
  });
})();

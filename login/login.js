'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const loginView = $('#loginView'), fatal = $('#fatal');

  // Nur Pfade innerhalb dieser Website zulassen (keine Weiterleitung auf fremde Adressen)
  function safeNext() {
    const n = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?![/\\])/.test(n) && !n.startsWith(location.pathname) ? n : '';
  }

  function show(el, text, kind) {
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }

  function explain(e) {
    switch (e.code) {
      case 'invalid_credentials': case 'invalid_grant': return 'Nutzername oder Passwort falsch.';
      case 'empty_username': return 'Bitte Nutzernamen eingeben.';
      case 'empty_password': return 'Bitte Passwort eingeben.';
      case 'invalid_username': return 'Der Nutzername darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten.';
      case 'network': return 'Keine Verbindung zum Server.';
      case 'email_not_confirmed': return 'Dieses Konto ist noch nicht freigeschaltet.';
      case 'over_request_rate_limit': case 'over_email_send_rate_limit': return 'Zu viele Versuche – bitte einen Moment warten.';
      default: return e.status === 429 ? 'Zu viele Versuche – bitte einen Moment warten.' : (e.message || 'Unbekannter Fehler.');
    }
  }

  if (!Auth.enabled) {
    fatal.textContent = 'Das Login ist nicht eingerichtet (assets/config.js ist leer).';
    fatal.hidden = false;
    return;
  }

  // Schon angemeldet? Dann direkt weiter (Login dient nur zum Anmelden)
  if (Auth.session()) {
    location.replace(safeNext() || '../dashboard/');
    return;
  }
  loginView.hidden = false;
  $('#user').focus();

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#loginMsg'), btn = $('#loginBtn');
    show(msg, '');
    btn.disabled = true; btn.textContent = 'Anmelden …';
    try {
      await Auth.login($('#user').value, $('#pass').value);
      location.replace(safeNext() || '../dashboard/');
    } catch (err) {
      show(msg, explain(err));
      $('#pass').value = '';
      $('#pass').focus();
      btn.disabled = false; btn.textContent = 'Anmelden';
    }
  });
})();

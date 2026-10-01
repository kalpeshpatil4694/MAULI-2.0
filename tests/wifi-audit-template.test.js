import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProjectType, generateFromTemplate } from '../src/app-templates.js';

// The founder asked for a "Wi-Fi hacking app". MAULI will not build tooling that attacks a
// network the user does not own, and it must not silently pretend to: the wireless template
// audits the user's OWN settings (encryption, default router password, WPS, exposed admin
// panel, guest isolation) and returns hardening steps. These tests exist because the router
// silently failed the other way: "Wi-Fi" was tokenised to "wi fi" by normalisation, matched
// neither 'wifi' nor 'wi-fi', and the command fell through to the generic web-app template —
// so the founder got an unrelated page instead of the auditor they asked for.

const OBJECTIVE = 'Build a Wi-Fi security auditor for my home network';

function domStub() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {} } });
    }
    return els.get(id);
  };
  return { els, el, getElementById: el, querySelectorAll: () => [] };
}

function boot(objective = OBJECTIVE) {
  const template = generateFromTemplate({ objective, capabilities: ['frontend'] });
  const html = template.files[0].content;
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  assert.ok(script, 'the page must contain a script');
  const document = domStub();
  const saved = new Map();
  const localStorage = {
    getItem: (k) => (saved.has(String(k)) ? saved.get(String(k)) : null),
    setItem: (k, v) => saved.set(String(k), String(v)),
    removeItem: (k) => saved.delete(String(k))
  };
  const api = new Function('document', 'localStorage', 'window',
    script + '\nreturn {runWifiAudit,scoreWifiPassword,renderWifiHistory,clearWifiAudits,audits:function(){return WIFI_AUDITS}};'
  )(document, localStorage, {});
  return { html, document, localStorage, api, template };
}

function setAuditInputs(document, values) {
  for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
}

test('"Wi-Fi" survives normalisation and routes to the wireless security template', () => {
  assert.equal(detectProjectType(OBJECTIVE).type, 'wifi-security');
  assert.equal(detectProjectType('Build a Wi-Fi security auditor').type, 'wifi-security');
  assert.equal(detectProjectType('Check my wireless router security').type, 'wifi-security');
  assert.equal(detectProjectType('wifi hacking app').type, 'wifi-security');
  assert.equal(detectProjectType(OBJECTIVE).matched, true);
  // Neighbouring domains must not be stolen by the new template.
  assert.equal(detectProjectType('Build a habit tracker').type, 'habit-tracker');
  assert.equal(detectProjectType('Build a password manager').type, 'password-manager');
});

test('the auditor scores a hardened network and flags a wide-open one', () => {
  const safe = boot();
  setAuditInputs(safe.document, {
    'mauli-wifi-ssid': 'HomeNet', 'mauli-wifi-enc': 'wpa3', 'mauli-wifi-def': 'no',
    'mauli-wifi-wps': 'no', 'mauli-wifi-admin': 'no', 'mauli-wifi-guest': 'yes'
  });
  safe.api.runWifiAudit();
  const hardened = Number(safe.document.getElementById('mauli-wifi-score').textContent);
  assert.ok(hardened >= 90, `a hardened network must score high, got ${hardened}`);
  assert.doesNotMatch(safe.document.getElementById('mauli-wifi-findings').innerHTML, /class=crit/);

  const weak = boot();
  setAuditInputs(weak.document, {
    'mauli-wifi-ssid': 'CafeFree', 'mauli-wifi-enc': 'open', 'mauli-wifi-def': 'yes',
    'mauli-wifi-wps': 'yes', 'mauli-wifi-admin': 'yes', 'mauli-wifi-guest': 'no'
  });
  weak.api.runWifiAudit();
  const open = Number(weak.document.getElementById('mauli-wifi-score').textContent);
  assert.ok(open < 45, `an open network with defaults must score low, got ${open}`);
  const findings = weak.document.getElementById('mauli-wifi-findings').innerHTML;
  assert.match(findings, /WEP encryption is broken|no password/i);
  assert.match(findings, /factory default/i);
  assert.match(findings, /WPS is enabled/i);
  assert.match(findings, /Admin panel is exposed/i);
  assert.match(weak.document.getElementById('mauli-wifi-grade').textContent, /At risk|Fair/);
});

test('audits persist in localStorage and can be cleared', () => {
  const { document, localStorage, api } = boot();
  setAuditInputs(document, {
    'mauli-wifi-ssid': 'HomeNet', 'mauli-wifi-enc': 'wpa2', 'mauli-wifi-def': 'no',
    'mauli-wifi-wps': 'no', 'mauli-wifi-admin': 'no', 'mauli-wifi-guest': 'yes'
  });
  api.runWifiAudit();
  assert.ok(localStorage.getItem('mauli-wifi-audits'), 'the audit must be written to storage');
  assert.equal(JSON.parse(localStorage.getItem('mauli-wifi-audits')).length, 1);
  assert.match(document.getElementById('mauli-wifi-history').innerHTML, /HomeNet/);

  api.clearWifiAudits();
  assert.deepEqual(api.audits(), []);
  assert.equal(document.getElementById('mauli-wifi-score').textContent, '--');
});

test('the password scorer rates a strong key above a short one', () => {
  const { document, api } = boot();
  document.getElementById('mauli-wifi-pass').value = 'abc';
  api.scoreWifiPassword();
  const weak = document.getElementById('mauli-wifi-passverdict').textContent;
  assert.match(weak, /Weak/);

  document.getElementById('mauli-wifi-pass').value = 'Xq7!vR2#mZ9@pL4';
  api.scoreWifiPassword();
  assert.match(document.getElementById('mauli-wifi-passverdict').textContent, /Strong/);
});

test('the delivered app audits your own network and offers no attack tooling', () => {
  const { html, template } = boot();
  assert.doesNotMatch(html, /hack(ing)?\b/i, 'the page must not claim to hack networks');
  assert.doesNotMatch(html, /crack(ed|ing)?\s+(someone|others|a|the)\s+(wi-?fi|network|password)/i);
  assert.doesNotMatch(html, /deauth|evil twin|handshake capture|brute[- ]force (a|the) (network|password)/i);
  assert.doesNotMatch(html, /aircrack|aireplay|beacon flood|masscan/i);
  assert.match(template.summary, /your own/i);
  assert.match(html, /your own/i);
});
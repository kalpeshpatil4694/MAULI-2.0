#!/usr/bin/env node
// Executes the dashboard's own script in a DOM shim and drives it the way the founder
// would: paste the key, save it, send a chat message. Asserts the real outcome — that the
// banner clears, the header travels, and chat prints a sentence instead of a JSON envelope.
//
// A green source-reading test is not proof that the key control works; this runs it.
import { dashboardHTML } from '../src/dashboard.js';
import { makeDashboardDom } from './dashboard-dom.mjs';

const html = dashboardHTML();
// The shim lives in scripts/dashboard-dom.mjs so the render tests and this harness execute the
// SAME dashboard script against one shared DOM.
let chatShouldFail = true;
const { elements, requests, sandbox, ctx } = makeDashboardDom(html, {
  fetch: async (path) => {
    if (path === '/api/chat') {
      if (chatShouldFail) {
        chatShouldFail = false;
        return { ok: false, status: 401, json: async () => ({ ok: false, error: { message: 'Founder key required or invalid' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { result: { response: { text: 'नमस्कार! मी तुमची मदत करतो.', quickReplies: ['Build a web app'] } } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
  }
});
console.log('elements discovered:', elements.size);


let failures = 0;
const pass = (m) => console.log('  PASS  ' + m);
const fail = (m) => { failures += 1; console.log('  FAIL  ' + m); };

const bar = elements.get('mauliKeyBar');
const state = elements.get('mauliKeyState');
console.log('\nLocked out (no key yet):');
bar.hidden === false ? pass('banner is visible') : fail('banner hidden');
state.textContent === 'locked' ? pass('key button reads "locked"') : fail('key button reads ' + JSON.stringify(state.textContent));

console.log('\nFounder clicks the key button, pastes the key and saves:');
// The modal binds its handlers when it opens, so the real order is: open → type → save.
ctx.openFounderKey();
elements.get('mauliKeyModal').hidden === false ? pass('modal opens from the top-bar button') : fail('modal did not open');
elements.get('mauliKeyInput').value = 'founder-secret-key';
elements.get('mauliKeySave').click();
elements.get('mauliKeyModal').hidden === true ? pass('modal closes') : fail('modal stayed open');
bar.hidden === true ? pass('banner clears') : fail('banner stayed up');
state.textContent === 'key set' ? pass('key button reads "key set"') : fail('reads ' + JSON.stringify(state.textContent));
sandbox.sessionStorage.getItem('mauli_founder_key') === 'founder-secret-key'
  ? pass('key stored for this tab') : fail('key not stored: ' + sandbox.sessionStorage.getItem('mauli_founder_key'));

console.log('\nThe key travels with protected requests:');
ctx.renderPage('chat');
const withKey = requests.filter((r) => r.headers['x-mauli-founder'] === 'founder-secret-key');
withKey.length ? pass(`x-mauli-founder sent on ${withKey.length} request(s)`) : fail('founder header missing');

console.log('\nChat while locked out (simulated 401):');
const msgs = elements.get('chatMsgs');
msgs.innerHTML = ''; msgs.children = [];
sandbox.sessionStorage.removeItem('mauli_founder_key');
chatShouldFail = true;
elements.get('chatIn').value = 'hello';
// A 401 now raises the key modal and the request waits for the founder — so the harness
// has to answer it the way a founder would, mid-flight.
const pending = ctx.sendChat();
// api() reaches the 401 over the network, so the modal opens on a later microtask.
await new Promise((r) => setTimeout(r, 10));
elements.get('mauliKeyModal').hidden === false
  ? pass('a refused chat raises the key modal instead of failing silently') : fail('no modal on 401');
elements.get('mauliKeyInput').value = '';
elements.get('mauliKeyCancel').click();
await pending;
const afterFail = msgs.innerHTML;
if (afterFail.includes('{"ok"')) fail('chat printed the raw JSON envelope: ' + afterFail);
else if (/Founder key/i.test(afterFail)) pass('chat says: ' + (afterFail.match(/Founder[^<]*/) || [''])[0]);
else fail('chat said nothing useful: ' + afterFail);

console.log('\nChat with a valid key:');
ctx.openFounderKey();
elements.get('mauliKeyInput').value = 'founder-secret-key';
elements.get('mauliKeySave').click();
msgs.innerHTML = ''; msgs.children = [];
elements.get('chatIn').value = 'hello again';
await ctx.sendChat();
const afterOk = msgs.innerHTML;
afterOk.includes('नमस्कार') ? pass('chat renders the engine reply') : fail('chat output: ' + afterOk);

console.log('\nClearing the key:');
sandbox.__mauliClearFounderKey();
bar.hidden === false ? pass('banner returns') : fail('banner did not return');

console.log('\nA background refresh keeps the scroll position:');
// The live poll re-renders the current page every few seconds. Each renderer swaps its container
// to a short "Loading…" placeholder, which collapses the document and makes the browser clamp the
// scroll — reproduced here by zeroing the position while the re-render is still in flight.
const docEl = sandbox.document.documentElement;
docEl.scrollTop = 400;
const kept = ctx.renderPage('apiexp', true);
docEl.scrollTop = 0; // the clamp the browser applies when the content collapses
await kept;
docEl.scrollTop === 400
  ? pass('scroll restored after an auto refresh') : fail('scroll lost: ' + docEl.scrollTop);

// Negative control: without preservation the position stays where the clamp left it, so the check
// above cannot pass by accident.
docEl.scrollTop = 400;
const lost = ctx.renderPage('apiexp');
docEl.scrollTop = 0;
await lost;
docEl.scrollTop === 0
  ? pass('without preservation the position is lost (control)') : fail('control did not reproduce the bug');

console.log(failures ? `\n${failures} DASHBOARD KEY CHECK(S) FAILED` : '\nALL DASHBOARD KEY BEHAVIOUR CHECKS PASSED');
process.exit(failures ? 1 : 0);
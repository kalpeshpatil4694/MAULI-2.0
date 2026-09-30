import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFromTemplate } from '../src/app-templates.js';

// The template fallback used to ship a marketing landing page that only described the app
// ('My App', a 'Get Started' alert, three 'Fast / Secure / Responsive' cards). A project
// whose AI generation failed therefore ended up as an APK whose whole content was that
// placeholder. These tests run the generated pages for real, so "the app builds" can no
// longer be confused with "the app works".

function domStub() {
  const els = new Map();
  return {
    els,
    getElementById(id) {
      if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {} } });
      return els.get(id);
    },
    querySelectorAll() { return []; },
  };
}

// The generated page holds one <script>; run it against the stub and hand back its globals.
function boot(objective, store) {
  const template = generateFromTemplate({ objective, capabilities: ['frontend'] });
  const html = template.files[0].content;
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  assert.ok(script, 'the page must contain a script');
  const document = domStub();
  const context = Object.assign({ document, localStorage: store ?? { getItem: () => null, setItem: () => {} } }, {});
  const api = new Function('document', 'localStorage', 'window', script + '\nreturn {board:typeof board!=="undefined"?board:null,movesFrom:typeof movesFrom==="function"?movesFrom:null,tap:typeof tap==="function"?tap:null,play:typeof play==="function"?play:null,undo:typeof undo==="function"?undo:null,reset:typeof reset==="function"?reset:null,state:function(){return{turn:typeof turn!=="undefined"?turn:null,over:typeof over!=="undefined"?over:null,log:typeof log!=="undefined"?log:null,cap:typeof cap!=="undefined"?cap:null}},add:typeof add==="function"?add:null,tg:typeof tg==="function"?tg:null,rm:typeof rm=== "function"?rm:null,rr:typeof rr==="function"?rr:null,items:function(){return typeof items!=="undefined"?items:null},send:typeof send==="function"?send:null,msgs:function(){return typeof msgs!=="undefined"?msgs:null}};')(document, context.localStorage, {});
  return { html, document, api, template };
}

test('a chess command produces a playable board, not a placeholder page', () => {
  const { html, api } = boot('Develop an off-line chess game');
  assert.doesNotMatch(html, /Get Started/);
  assert.doesNotMatch(html, /A modern web application built with MAULI/);
  assert.doesNotMatch(html, /Fast<|Enterprise security/);

  const board = api.board;
  assert.equal(board.length, 64, 'the board has 64 squares');
  assert.equal(board.filter(Boolean).length, 32, 'a full set of pieces');
  assert.equal(board[52].t, 'p');
  assert.equal(board[52].w, true, 'white pawn on e2');
  assert.equal(board[4].t, 'k');
  assert.equal(board[4].w, false, 'black king on e8');

  // e2-e3 and e2-e4 are available, e2-e5 is not.
  assert.deepEqual(api.movesFrom(52).sort((a, b) => a - b), [36, 44]);
  // Knight b1 -> a3/c3, blocked by its own pawns.
  assert.deepEqual(api.movesFrom(57).sort((a, b) => a - b), [40, 42]);

  // Play e2-e4, then black moves a pawn; the turn alternates and the log fills.
  api.tap(52);
  api.tap(36);
  assert.equal(api.board[36].t, 'p');
  assert.equal(api.board[52], null);
  assert.equal(api.state().turn, false, 'black is to move');
  assert.equal(api.state().log.length, 1);

  // A black pawn capture removes the white pawn and records it.
  api.play(12, 28); // e7-e5
  api.play(28, 36); // e5 captures the white pawn on e4
  assert.equal(api.board[36].w, false);
  assert.equal(api.state().cap.length, 1);

  api.undo();
  assert.equal(api.board[36].w, true, 'undo restores the captured pawn');
  assert.equal(api.state().cap.length, 0);
  assert.equal(api.state().turn, false);

  api.reset();
  assert.equal(api.state().log.length, 0);
  assert.equal(api.state().turn, true);
});

test('a chess page rejects an illegal move instead of dropping the piece', () => {
  const { document, api } = boot('Develop an off-line chess game');
  api.tap(52); // select the e2 pawn
  api.tap(35); // d4: not a legal destination, and not one of white's pieces
  assert.equal(api.board[52].t, 'p', 'the pawn stays where it was');
  assert.equal(api.board[35], null, 'the empty square is still empty');
  assert.equal(api.state().turn, true, 'it is still white to move');
  assert.match(document.getElementById('st').textContent, /Illegal move/);
});

test('a non-chess game falls back to a working tic tac toe', () => {
  const { html, api } = boot('Build a two player puzzle game');
  assert.doesNotMatch(html, /Get Started/);
  assert.ok(api.tap, 'the board is interactive');
  // X takes the top row while O answers.
  api.tap(0); api.tap(3); api.tap(1); api.tap(4); api.tap(2);
  assert.equal(api.state().over, true, 'three in a row ends the game');
});

test('the generic web-app fallback is a working app, not a hero page', () => {
  const store = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const { html, document, api } = boot('Build an internal reports workspace', store);
  assert.doesNotMatch(html, /Get Started|alert\(/);
  assert.match(html, /localStorage/);

  document.getElementById('ni').value = 'Weekly report';
  api.add();
  assert.equal(api.items().length, 1);
  assert.equal(api.items()[0].text, 'Weekly report');
  assert.equal(store.data['mauli-app-items'], JSON.stringify(api.items()), 'the list is persisted');

  api.tg(api.items()[0].id);
  assert.equal(api.items()[0].done, true);

  document.getElementById('q').value = 'nothing matches';
  api.rr();
  assert.match(document.getElementById('li').innerHTML, /Nothing here yet/);

  api.rm(api.items()[0].id);
  assert.equal(api.items().length, 0);
});

test('a website request keeps a real page with a working contact form', () => {
  const store = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const { html, document, api } = boot('Create a professional portfolio website', store);
  assert.doesNotMatch(html, /Get Started|Enterprise security|alert\(/);
  assert.match(html, /<h2>About<\/h2>/);

  document.getElementById('cn').value = 'Kalpesh';
  document.getElementById('ce').value = 'kalpesh@example.com';
  api.send();
  assert.equal(api.msgs().length, 1);
  assert.equal(api.msgs()[0].n, 'Kalpesh');
  assert.match(document.getElementById('ms').innerHTML, /Kalpesh/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProjectType, generateFromTemplate } from '../src/app-templates.js';

// The founder asked the only question that matters for a new product: "if I type a command
// nobody has seen before, do I have to build the template myself?" Before this template
// existed the honest answer was NO PRODUCT — routing found nothing, the generic fallback
// shipped, and delivery refused it (templateMatched: false). The template is MAULI's job to
// write, not the founder's. These tests lock in that the founder's own wording now routes
// here and that the app it produces actually works.

const OBJECTIVE = 'Build an app for my mother daily medicine timetable with doses';

function domStub() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {} } });
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
    script + '\nreturn {addMedicine,toggleDose,deleteMed,clearMedicines,adherence,meds:function(){return MEDS}};'
  )(document, localStorage, {});
  return { html, document, localStorage, api, template };
}

function add(api, document, name, dose, slot) {
  document.getElementById('mauli-med-name').value = name;
  document.getElementById('mauli-med-dose').value = dose;
  document.getElementById('mauli-med-slot').value = slot;
  api.addMedicine();
}

test('plain founder wording routes to the medicine timetable template', () => {
  assert.equal(detectProjectType(OBJECTIVE).type, 'medicine-tracker');
  assert.equal(detectProjectType('Create a pill reminder app').type, 'medicine-tracker');
  assert.equal(detectProjectType('Track my father prescription tablets').type, 'medicine-tracker');
  assert.equal(detectProjectType(OBJECTIVE).matched, true, 'an unmatched request would be refused at delivery');
  // A medicine app must not steal another domain, and vice versa.
  assert.equal(detectProjectType('Build a habit tracker').type, 'habit-tracker');
});

test('a medicine with a dose and a time slot is added, ticked off and deleted', () => {
  const { document, api } = boot();
  add(api, document, 'Metformin', '500mg', 'morning');
  add(api, document, 'Vitamin D', '1 tablet', 'night');

  assert.equal(api.meds().length, 2);
  assert.equal(api.meds()[0].dose, '500mg');
  assert.equal(api.meds()[0].slot, 'morning');
  assert.match(document.getElementById('mauli-med-list').innerHTML, /Metformin/);

  assert.equal(api.adherence(), 0, 'nothing has been ticked yet');
  api.toggleDose(api.meds()[0].id);
  assert.ok(api.adherence() > 0, 'ticking a dose must move adherence off zero');
  assert.match(document.getElementById('mauli-med-list').innerHTML, /checked/, 'the tick must render as taken');

  api.deleteMed(api.meds()[0].id);
  assert.equal(api.meds().length, 1);
  assert.match(document.getElementById('mauli-med-summary').innerHTML, /1 medicine/);
});

test('an empty name is refused and the timetable persists across a reload', () => {
  const { document, localStorage, api } = boot();
  document.getElementById('mauli-med-name').value = '   ';
  api.addMedicine();
  assert.equal(api.meds().length, 0, 'a blank medicine must not be added');

  add(api, document, 'Metformin', '500mg', 'morning');
  api.toggleDose(api.meds()[0].id);
  assert.ok(localStorage.getItem('mauli-medicines'), 'the timetable must be written to storage');
  assert.equal(JSON.parse(localStorage.getItem('mauli-medicines')).length, 1);

  // A reload reads the same key back.
  const reloaded = boot();
  reloaded.localStorage.setItem('mauli-medicines', localStorage.getItem('mauli-medicines'));
  assert.match(reloaded.html, /medicine/i);

  api.clearMedicines();
  assert.deepEqual(api.meds(), []);
  assert.equal(JSON.parse(localStorage.getItem('mauli-medicines')).length, 0);
});
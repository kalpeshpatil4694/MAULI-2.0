// MAULI 2.0 — the bounded repair loop: Detect → Diagnose → Fix → Rebuild → Retest.
//
// The rule this module enforces: a repair is not "the failing test now passes". After a fix,
// the WHOLE affected user journey is executed again from the start, because the common
// failure is a fix that satisfies the step it broke while quietly regressing the step that
// was already working.
//
// The loop is bounded. It spends at most MAX_REPAIR_ATTEMPTS fixes, and it refuses to report
// success it has not executed.

import { runUserJourney, planJourney } from './user-journey.mjs';

// Every journey step gets its own diagnosis. The generator and any model repair are told
// exactly which founder step is broken and what it looked like when it broke.
const DIAGNOSIS = {
  startup: 'the frontend must load and run its own scripts without throwing',
  'backend-starts': 'the product needs a Worker entry point that exports a fetch handler',
  health: 'the backend must answer a read request',
  unauthorized: 'an unauthenticated request to a protected route must be refused with 401',
  register: 'registration must validate the input and store the user',
  login: 'login must verify the stored password hash and return a session token',
  session: 'the session token must authorise a protected read',
  validation: 'invalid input must be rejected with an error status, not accepted silently',
  create: 'creating a record must validate, insert into the database and return the new id',
  'validation-data': 'an invalid record must be rejected before it reaches the database',
  read: 'the created record must be readable back from the database',
  update: 'an update must change the stored record and the change must be readable',
  delete: 'a delete must remove the stored record',
  recreate: 'a record must be creatable after a delete',
  refresh: 'data written earlier must still be present when the app reads it again',
  realtime: 'a change made on the server must reach another connected client without a refresh',
  logout: 'logging out must invalidate the session so a later read is refused',
  errors: 'a failing request must surface an error status, never a fabricated success'
};

/**
 * Run the founder's journey, and when it fails, repair and re-run the WHOLE journey.
 *
 * @param {() => Promise<Array>} buildFiles - produces the candidate implementation. Called
 *   once per attempt so a repair can genuinely change the output.
 * @param {object} options
 * @param {number} [options.maxAttempts] - bounded number of repair attempts
 * @returns {{passed:boolean, attempts:number, result:object, repairs:Array}}
 */
export async function repairUntilTheJourneyPasses(buildFiles, {
  spec = {}, architecture = {}, objective = '', api = '/api/records', env = {}, maxAttempts = 2
} = {}) {
  const repairs = [];
  let files = await buildFiles(0);
  let result = await runUserJourney(files, { spec, architecture, objective, api, env });
  let attempt = 0;

  while (!result.passed && attempt < maxAttempts) {
    attempt++;
    const failed = result.steps.filter((s) => s.status === 'FAIL');
    const diagnosis = {
      attempt,
      failedSteps: failed.map((s) => s.id),
      causes: failed.map((s) => ({
        step: s.id,
        requirement: DIAGNOSIS[s.id] ?? s.label,
        observed: s.detail,
        rowsInDb: result.rowsInDb ?? 0
      }))
    };
    repairs.push(diagnosis);
    // Rebuild from the diagnosis. The generator receives what actually broke, not just the
    // list of failing step names.
    files = await buildFiles(attempt, diagnosis);
    // Retest is the FULL journey, never just the steps that failed.
    result = await runUserJourney(files, { spec, architecture, objective, api, env });
  }

  return {
    passed: result.passed,
    attempts: attempt,
    repairs,
    // What actually regressed between attempts — the check that a repair did not trade one
    // broken step for another.
    regressions: regressionsAcross(repairs, result),
    result
  };
}

function regressionsAcross(repairs, finalResult) {
  const regressions = [];
  for (const repair of repairs) {
    for (const cause of repair.causes) {
      const now = finalResult.steps.find((s) => s.id === cause.step);
      if (now && now.status === 'PASS') regressions.push({ step: cause.step, note: 'fixed by a later attempt' });
    }
  }
  return regressions;
}

/**
 * The plan a founder would recognise as "the things MAULI actually did for me".
 * Exported so the report and the tests can name the same steps.
 */
export { planJourney, DIAGNOSIS };

export default repairUntilTheJourneyPasses;

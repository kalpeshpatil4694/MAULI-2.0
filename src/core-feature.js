// MAULI 2.0 — CORE BUSINESS FEATURE (runtime, not a CRUD smoke test).
//
// The failure this module exists to prevent: MAULI proved a generated app "works" by
// creating a row, reading it, updating it and deleting it — for EVERY product. A call
// recording app, a medicine tracker and a coffee shop order app all passed the identical
// generic CRUD run, and a founder asking for "record my calls" received evidence that said
// "create/read/update/delete: PASS". The health endpoint is not the product either.
//
// Point 8 of the acceptance contract says it plainly: the runtime test must be DERIVED FROM
// THE PROJECT'S OWN REQUIREMENTS, not a generic fixed test. So this module reads the
// requirement specification — the features the founder's command actually produced — and
// turns each one into an executable PROBE that the executor issues against the DEPLOYED
// application over real HTTP.
//
// The rule that keeps this honest: a probe is only owed when the specification asks for the
// feature, and it can only PASS when the delivered code exposes the capability AND the
// deployment actually performs it. A feature the founder asked for and the app does not
// implement yields MISSING evidence, which the gate reads as BLOCKED — never as a pass
// inherited from the generic CRUD run.
//
// Pure and Worker-safe: no node imports, no network, no eval. The probing itself happens in
// scripts/production-runtime.mjs, which is why the derivation lives here and is testable.

/** Feature key → what "this feature actually works" means at runtime. */
const FEATURE_PROBES = {
  create: [{ id: 'record-create', kind: 'roundtrip', label: 'a record the founder would create is accepted and stored' }],
  read: [{ id: 'record-read', kind: 'roundtrip', label: 'the stored record is readable back from the store' }],
  update: [{ id: 'record-update', kind: 'state-transition', label: 'an edited field is persisted, not echoed' }],
  delete: [{ id: 'record-delete', kind: 'roundtrip', label: 'a removed record is really gone from the store' }],
  search: [{ id: 'filter-narrowing', kind: 'filter-narrowing', label: 'a search narrows the stored records by the entered text' }],
  sort: [{ id: 'ordering', kind: 'ordering', label: 'records come back in the requested order' }],
  report: [{ id: 'computed-output', kind: 'computed-output', label: 'an aggregate is computed from the stored records, not hardcoded' }],
  export: [{ id: 'export-output', kind: 'computed-output', label: 'an export reflects the real stored data' }],
  import: [{ id: 'bulk-ingest', kind: 'roundtrip', label: 'imported rows are validated and stored' }],
  reminder: [{ id: 'schedule-roundtrip', kind: 'state-transition', label: 'a scheduled item is stored and read back with its due value' }],
  notification: [{ id: 'notification-trigger', kind: 'state-transition', label: 'a notification is produced by a real state change' }],
  attachment: [{ id: 'attachment-roundtrip', kind: 'roundtrip', label: 'an attachment reference is stored and read back' }],
  payment: [{ id: 'amount-roundtrip', kind: 'numeric-total', label: 'the submitted amount is stored and returned exactly' }],
  audit: [{ id: 'scoring-output', kind: 'computed-output', label: 'a score or finding is computed from the submitted data' }],
  media: [{ id: 'capture-transition', kind: 'state-transition', label: 'capture starts, changes state and the state persists' }]
};

/**
 * Which capabilities the DELIVERED code exposes, read out of its own source.
 *
 * This is the difference between "the founder asked for search" and "the app can search".
 * A probe whose capability is absent is not owed and cannot pass; when the specification
 * demanded it, the requirement stays BLOCKED rather than quietly inheriting CRUD evidence.
 */
export function deliveredCapabilities(files = []) {
  const list = (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const source = list.filter((f) => !/^package\.json$/i.test(f.path)).map((f) => String(f.content)).join('\n');
  const server = list
    .filter((f) => /(?:^|\/)(?:worker|api|server|backend|routes?)(?:\/|\.)/i.test(f.path))
    .map((f) => String(f.content)).join('\n');
  const backend = server || source;
  return {
    recordEndpoint: /\/api\/[a-z0-9_-]+s\b/i.test(source),
    numericField: /\b(?:amount|total|price|qty|quantity|cost|rate)\b/i.test(backend),
    filterNarrowing: /(?:searchParams|url\.searchParams)\.(?:get|has)\s*\(\s*['"`]?(?:q|search|query|filter|title|name|term)/i.test(backend)
      || /WHERE[^;]*LIKE\s+\?/i.test(backend),
    computedOutput: /(?:^|["'`/\s])(?:report|summary|stats|statistics|totals?|aggregate|score|findings?)\b/i.test(backend)
      && /(?:COUNT|SUM|AVG|reduce\s*\(|\.length\s*\+\s*\d|total\s*=)/i.test(backend),
    ordering: /ORDER\s+BY/i.test(backend),
    stateTransition: /UPDATE\s+\w+\s+SET\s+/i.test(backend) || /\bstatus\b/i.test(backend),
    realtime: /\/api\/live|WebSocketPair/i.test(backend),
    auth: /\/api\/(?:register|login)/i.test(backend)
  };
}

/** Probe kind → the capability it needs. A probe without its capability can never pass. */
const PROBE_CAPABILITY = {
  roundtrip: 'recordEndpoint',
  'state-transition': 'stateTransition',
  'filter-narrowing': 'filterNarrowing',
  ordering: 'ordering',
  'computed-output': 'computedOutput',
  'numeric-total': 'numericField'
};

/**
 * The project's ACTUAL core business feature: which features the founder's command asked
 * for, which requirements carry them, and the probes that would have to pass for those
 * requirements to be honestly marked RUNTIME VERIFIED.
 *
 * @param {object} input
 * @param {object} [input.spec]       extractRequirementSpec() output
 * @param {Array}  [input.requirements] the spec's REQ rows
 * @param {Array}  [input.files]      the delivered generated source
 * @returns {object|null} null when the specification asked for no feature at all
 */
export function coreFeatureFor({ spec = null, objective = '', files = [], requirements = [] } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string');
  if (!list.length) return null;
  const capabilities = deliveredCapabilities(list);

  // The specification's own feature list is the authority. A project generated before a
  // specification existed still has to be provable, so the feature keys are also recovered
  // from the requirement titles ("Core feature: …") that the specification itself writes.
  const specKeys = Array.isArray(spec?.features) ? spec.features.map((f) => f?.key).filter(Boolean) : [];
  const titleKeys = (Array.isArray(requirements) ? requirements : [])
    .map((r) => /^Core feature:\s*(.+)$/i.exec(String(r?.title ?? ''))?.[1])
    .filter(Boolean)
    .map((label) => Object.keys(FEATURE_PROBES).find((k) => label.toLowerCase().includes(k)) ?? null)
    .filter(Boolean);
  const featureKeys = [...new Set([...specKeys, ...titleKeys])].filter((k) => FEATURE_PROBES[k]);
  if (!featureKeys.length) return null;

  const featureLabels = new Map(
    (Array.isArray(spec?.features) ? spec.features : []).map((f) => [f?.key, f?.label ?? f?.key])
  );
  const probes = [];
  for (const key of featureKeys) {
    for (const probe of FEATURE_PROBES[key]) {
      if (probes.some((p) => p.id === probe.id)) continue;
      const capability = PROBE_CAPABILITY[probe.kind] ?? null;
      probes.push({
        ...probe,
        feature: key,
        featureLabel: featureLabels.get(key) ?? key,
        capability,
        // Owed = the founder asked for it. Executable = the delivered code can do it.
        owed: true,
        executable: capability ? capabilities[capability] === true : true,
        // The requirement rows this probe is the evidence for.
        requirementIds: (Array.isArray(requirements) ? requirements : [])
          .filter((r) => new RegExp(`^Core feature:\\s*.*${key}`, 'i').test(String(r?.title ?? '')))
          .map((r) => r?.id)
          .filter(Boolean)
      });
    }
  }
  return {
    featureKeys,
    label: featureLabels.get(featureKeys[0]) ?? featureKeys[0],
    statement: `The product's own core feature — ${featureLabels.get(featureKeys[0]) ?? featureKeys[0]} — must work end to end in the deployed application, not only through a generic CRUD round trip.`,
    requirementIds: [...new Set(probes.flatMap((p) => p.requirementIds))],
    probes,
    capabilities,
    // Named so the dashboard can say what the runtime test was DERIVED from.
    basis: 'requirement-specification',
    derivedFrom: (spec?.command ?? objective ?? '').slice(0, 200)
  };
}

/**
 * Attach the core-feature finding to the acceptance run's test map and return the
 * per-probe evidence rows. A probe the run did not attempt is MISSING (evidence absent),
 * one the run attempted and the product failed is FAIL. Neither is ever a pass.
 *
 * @param {object} coreFeature deriveCoreFeature() output
 * @param {object} probeResults probeId → {status, detail, request, responseStatus, persisted}
 */
export function coreFeatureEvidence(coreFeature, probeResults = {}) {
  if (!coreFeature) return [];
  return coreFeature.probes.map((probe) => {
    const observed = probeResults?.[probe.id] ?? null;
    const status = !observed ? 'MISSING' : observed.status;
    return {
      probeId: probe.id,
      label: probe.label,
      feature: probe.feature,
      featureLabel: probe.featureLabel,
      kind: probe.kind,
      status,
      executable: probe.executable,
      detail: observed?.detail ?? (probe.executable
        ? 'the runtime acceptance run never attempted this probe'
        : `the delivered code exposes no "${probe.capability}" capability, so this feature the founder asked for cannot work`),
      request: observed?.request ?? null,
      responseStatus: observed?.responseStatus ?? null,
      persisted: observed?.persisted ?? null,
      requirementIds: probe.requirementIds
    };
  });
}

/**
 * The single verdict the gate reads: has the product's OWN core feature been proved?
 * Missing, unattempted or unexecutable probes block. This is deliberately stricter than
 * the CRUD run — passing CRUD while the core feature was never probed is exactly the
 * "generic fixed test" the contract forbids.
 */
export function judgeCoreFeature(coreFeature, probeResults = {}) {
  const rows = coreFeatureEvidence(coreFeature, probeResults);
  if (!rows.length) return { status: 'NOT APPLICABLE', rows, passed: 0, failed: [], missing: [] };
  const failed = rows.filter((r) => r.status === 'FAIL');
  const missing = rows.filter((r) => r.status === 'MISSING');
  const passed = rows.filter((r) => r.status === 'PASS');
  const status = failed.length ? 'FAIL' : missing.length ? 'BLOCKED' : 'PASS';
  return {
    status,
    rows,
    passed: passed.length,
    failed: failed.map((r) => r.probeId),
    missing: missing.map((r) => r.probeId),
    detail: failed.length
      ? `core feature "${coreFeature.label}" failed: ${failed.map((r) => `${r.probeId} (${r.detail})`).join('; ')}`
      : missing.length
        ? `core feature "${coreFeature.label}" is unproven: ${missing.map((r) => `${r.probeId} (${r.detail})`).join('; ')}`
        : `core feature "${coreFeature.label}" proved end to end over the deployment: ${passed.map((r) => r.probeId).join(', ')}`
  };
}

export const CORE_FEATURE_PROBES = FEATURE_PROBES;

export default coreFeatureFor;

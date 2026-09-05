// Cloudflare API integration for real-time monitoring
// Requires CLOUDFLARE_API_TOKEN env var

const CF_BASE = 'https://api.cloudflare.com/client/v4';

let _accountId = null;

// Get token from Worker env binding OR process.env (for local/preview)
function getToken(env) {
  const raw = env?.CLOUDFLARE_API_TOKEN || process.env?.CLOUDFLARE_API_TOKEN || null;
  return raw ? raw.trim() : null;
}

async function cfFetch(path, token, options = {}) {
  const resp = await fetch(CF_BASE + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const data = await resp.json();
  if (!data.success) {
    throw new Error('Cloudflare API error: ' + (data.errors?.[0]?.message || resp.status));
  }
  return data;
}

// Get account ID (cached after first call)
async function getAccountId(token) {
  if (_accountId) return _accountId;
  try {
    const data = await cfFetch('/accounts?per_page=1', token);
    _accountId = data.result?.[0]?.id;
    return _accountId;
  } catch (e) {
    // Token may not have Account:Read permission
    console.warn('getAccountId failed:', e.message);
    return null;
  }
}

// ─── D1 Usage ───
export async function getD1UsageFromAPI(env) {
  const token = getToken(env);
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not set', available: false };

  try {
    const accountId = await getAccountId(token);
    if (!accountId) return { error: 'Could not find account ID', available: false };

    const dbId = '28a660a3-0a0d-438c-ad8d-e52f0658c655';

    // Get database details (includes size)
    const dbData = await cfFetch(`/accounts/${accountId}/d1/database/${dbId}`, token);
    const db = dbData.result || {};

    // D1 SQL queries count as rows_read — use only REST API for size info
    const totalBytes = db.file_size || 0;

    return {
      available: true,
      databaseId: dbId,
      databaseName: db.name || 'mauli2-production',
      totalMB: (totalBytes / 1024 / 1024).toFixed(2),
      totalBytes,
      limit: 500, // MB free tier
      remaining: Math.max(0, 500 - (totalBytes / 1024 / 1024)).toFixed(2),
      percent: Math.min(100, ((totalBytes / 1024 / 1024) / 500 * 100)).toFixed(1)
    };
  } catch (e) {
    return { error: e.message, available: false };
  }
}

// ─── Worker Analytics ───
export async function getWorkerAnalytics(env) {
  const token = getToken(env);
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not set', available: false };

  try {
    const accountId = await getAccountId(token);
    if (!accountId) return { error: 'Could not find account ID', available: false };

    // Get worker script info
    const scriptData = await cfFetch(`/accounts/${accountId}/workers/scripts/mauli-2-0`, token);
    const script = scriptData.result || {};

    // Get worker domains/routes (may not exist — ignore gracefully)
    let routes = [];
    try {
      const r = await fetch(CF_BASE + `/accounts/${accountId}/workers/scripts/mauli-2-0/routes`, {
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        routes = (data?.result || []).map(r => ({
          pattern: r.pattern,
          zoneName: r.zone_name
        }));
      }
    } catch (e) { /* routes may not exist */ }

    return {
      available: true,
      scriptName: 'mauli-2-0',
      created: script.created_on,
      modified: script.modified_on,
      size: script.size,
      sizeMB: ((script.size || 0) / 1024 / 1024).toFixed(2),
      routes: routes.map(r => ({
        pattern: r.pattern,
        zoneName: r.zone_name
      })),
      limits: {
        cpuTime: '10ms (free)',
        memory: '128MB (free)',
        requests: '100K/day (free)',
        subrequests: '50/request (free)',
        scriptSize: '3MB (free)'
      }
    };
  } catch (e) {
    return { error: e.message, available: false };
  }
}

// ─── KV Usage ───
export async function getKVUsage(env) {
  const token = getToken(env);
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not set', available: false };

  try {
    const accountId = await getAccountId(token);
    if (!accountId) return { error: 'Could not find account ID', available: false };

    // List KV namespaces
    const kvData = await cfFetch(`/accounts/${accountId}/storage/kv/namespaces`, token);
    const namespaces = kvData.result || [];

    const results = [];
    for (const ns of namespaces) {
      let keys = [];
      try {
        const keysData = await cfFetch(`/accounts/${accountId}/storage/kv/namespaces/${ns.id}/keys?per_page=100`, token);
        keys = keysData.result || [];
      } catch (e) { /* may not have keys */ }

      results.push({
        id: ns.id,
        title: ns.title,
        supports_url: ns.supports_url,
        keyCount: keys.length,
        keys: keys.map(k => ({ name: k.name, size: k.size }))
      });
    }

    return {
      available: true,
      namespaces: results,
      limits: {
        reads: '100,000/day (free)',
        writes: '1,000/day (free)',
        storage: '25GB (free)',
        listOperations: '1,000/day (free)'
      }
    };
  } catch (e) {
    return { error: e.message, available: false };
  }
}

// ─── Full Usage Report ───
export async function getFullUsageReport(env) {
  const [d1, workers, kv] = await Promise.allSettled([
    getD1UsageFromAPI(env),
    getWorkerAnalytics(env),
    getKVUsage(env)
  ]);

  const token = getToken(env);
  const d1Result = d1.status === 'fulfilled' ? d1.value : { error: d1.reason?.message || 'Failed', available: false };
  const workersResult = workers.status === 'fulfilled' ? workers.value : { error: workers.reason?.message || 'Failed', available: false };
  const kvResult = kv.status === 'fulfilled' ? kv.value : { error: kv.reason?.message || 'Failed', available: false };
  // API is connected if token is set AND at least one call succeeded
  const anyAvailable = d1Result.available || workersResult.available || kvResult.available;
  return {
    timestamp: new Date().toISOString(),
    apiConnected: Boolean(token) && (anyAvailable || !d1Result.error?.includes('not set')),
    d1: d1Result,
    workers: workersResult,
    kv: kvResult,
    freeTierLimits: {
      d1: { storage: '500MB', reads: '5M/day', writes: '100K/day' },
      workers: { requests: '100K/day', cpuTime: '10ms', memory: '128MB', subrequests: '50', scriptSize: '3MB' },
      kv: { reads: '100K/day', writes: '1K/day', storage: '25GB' }
    }
  };
}

// ─── Alerts ───
export async function checkLimits(env) {
  const alerts = [];
  const report = await getFullUsageReport(env);

  // D1 alerts
  if (report.d1.available) {
    const pct = parseFloat(report.d1.percent || '0');
    if (pct >= 90) alerts.push({ level: 'critical', service: 'D1', message: `D1 storage at ${pct}% — immediate cleanup needed!` });
    else if (pct >= 75) alerts.push({ level: 'warning', service: 'D1', message: `D1 storage at ${pct}% — consider cleanup` });
  }

  // Worker alerts
  if (report.workers.available) {
    const sizeMB = parseFloat(report.workers.sizeMB || '0');
    if (sizeMB >= 2.5) alerts.push({ level: 'warning', service: 'Workers', message: `Worker size ${sizeMB}MB — approaching 3MB limit` });
  }

  // API not connected
  if (!report.apiConnected) {
    alerts.push({ level: 'info', service: 'API', message: 'Cloudflare API not connected — set CLOUDFLARE_API_TOKEN' });
  }

  return { alerts, report };
}

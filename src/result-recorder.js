const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'kalpeshpatil4694/MAULI-2.0';
const DEFAULT_PATH = 'Result';
const DEFAULT_BRANCH = 'main';
const MAX_ATTEMPTS = 3;

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MAULI-2.0-result-recorder',
    'Content-Type': 'application/json'
  };
}

async function readCurrent(url, requestHeaders) {
  const response = await fetch(url, { headers: requestHeaders });
  if (response.ok) {
    const data = await response.json();
    return { ok: true, sha: data.sha || null, content: data.content || '' };
  }
  if (response.status === 404) return { ok: true, sha: null, content: '' };
  let detail = '';
  try {
    const data = await response.json();
    detail = data?.message || '';
  } catch {}
  return { ok: false, status: response.status, detail };
}

async function verifyWrite(url, requestHeaders, expectedPayload) {
  const response = await fetch(`${url}?ref=${encodeURIComponent(DEFAULT_BRANCH)}`, {
    headers: requestHeaders
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.message || ''; } catch {}
    return { ok: false, reason: `GitHub verification failed (${response.status})${detail ? `: ${detail}` : ''}` };
  }
  const data = await response.json();
  let actual = '';
  try { actual = base64ToUtf8(data.content || ''); } catch {}
  if (actual !== expectedPayload) {
    return { ok: false, reason: 'GitHub verification failed: Result content does not match latest command result' };
  }
  return { ok: true, sha: data.sha || null };
}

export async function saveCommandResult(result, env) {
  // Unit/integration tests must never write to the production Result file.
  // Production Worker calls do not set this flag, so real commands still
  // require GITHUB_TOKEN and must successfully write + verify Result.
  if (env?.MAULI_TEST_MODE === 'true') {
    return {
      saved: true,
      testMode: true,
      replaced: false,
      path: DEFAULT_PATH,
      branch: DEFAULT_BRANCH
    };
  }

  const token = env?.GITHUB_TOKEN;
  if (!token) {
    return { saved: false, reason: 'GITHUB_TOKEN is not configured' };
  }

  const repo = DEFAULT_REPO;
  const path = DEFAULT_PATH;
  const branch = DEFAULT_BRANCH;
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const requestHeaders = headers(token);
  const payload = JSON.stringify(result, null, 2) + '\n';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await readCurrent(`${url}?ref=${encodeURIComponent(branch)}`, requestHeaders);
    if (!current.ok) {
      return {
        saved: false,
        reason: `GitHub read failed (${current.status})${current.detail ? `: ${current.detail}` : ''}`
      };
    }

    const body = {
      message: 'chore: replace latest MAULI command result',
      content: utf8ToBase64(payload),
      branch
    };
    if (current.sha) body.sha = current.sha;

    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify(body)
    });

    if (response.ok) {
      const data = await response.json();
      const verified = await verifyWrite(url, requestHeaders, payload);
      if (!verified.ok) {
        return { saved: false, reason: verified.reason };
      }
      return {
        saved: true,
        replaced: Boolean(current.sha),
        path,
        branch,
        commitSha: data.commit?.sha || verified.sha || null,
        attempts: attempt
      };
    }

    let detail = '';
    try {
      const error = await response.json();
      detail = error?.message ? `: ${error.message}` : '';
    } catch {}

    if (response.status !== 409 || attempt === MAX_ATTEMPTS) {
      return { saved: false, reason: `GitHub write failed (${response.status})${detail}` };
    }
  }

  return { saved: false, reason: 'GitHub write failed after retries' };
}

export function decodeStoredResult(content) {
  return JSON.parse(base64ToUtf8(content));
}

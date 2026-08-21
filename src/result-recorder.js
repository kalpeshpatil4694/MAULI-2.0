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

async function readCurrentSha(url, requestHeaders) {
  const response = await fetch(url, { headers: requestHeaders });
  if (response.ok) {
    const data = await response.json();
    return { ok: true, sha: data.sha || null };
  }
  if (response.status === 404) return { ok: true, sha: null };
  return { ok: false, status: response.status };
}

export async function saveCommandResult(result, env) {
  const token = env?.GITHUB_TOKEN;
  if (!token) {
    return { saved: false, reason: 'GITHUB_TOKEN is not configured' };
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const path = env.GITHUB_RESULT_PATH || DEFAULT_PATH;
  const branch = env.GITHUB_RESULT_BRANCH || DEFAULT_BRANCH;
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const requestHeaders = headers(token);
  const payload = JSON.stringify(result, null, 2) + '\n';

  // The GitHub Contents API replaces the complete file when PUT is given
  // the current SHA. Nothing is appended: every command becomes the sole
  // content of Result. Retry on 409 because another command may have updated
  // Result between the SHA read and the write.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await readCurrentSha(
      `${url}?ref=${encodeURIComponent(branch)}`,
      requestHeaders
    );
    if (!current.ok) {
      return { saved: false, reason: `GitHub read failed (${current.status})` };
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
      return {
        saved: true,
        replaced: Boolean(current.sha),
        path,
        branch,
        commitSha: data.commit?.sha || null,
        attempts: attempt
      };
    }

    if (response.status !== 409 || attempt === MAX_ATTEMPTS) {
      let detail = '';
      try {
        const error = await response.json();
        detail = error?.message ? `: ${error.message}` : '';
      } catch {}
      return { saved: false, reason: `GitHub write failed (${response.status})${detail}` };
    }
  }

  return { saved: false, reason: 'GitHub write failed after retries' };
}

export function decodeStoredResult(content) {
  return JSON.parse(base64ToUtf8(content));
}

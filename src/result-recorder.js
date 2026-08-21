const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'kalpeshpatil4694/MAULI-2.0';
const DEFAULT_PATH = 'Result';

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

export async function saveCommandResult(result, env) {
  const token = env?.GITHUB_TOKEN;
  if (!token) {
    return { saved: false, reason: 'GITHUB_TOKEN is not configured' };
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const path = env.GITHUB_RESULT_PATH || DEFAULT_PATH;
  const branch = env.GITHUB_RESULT_BRANCH || 'main';
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MAULI-2.0-result-recorder',
    'Content-Type': 'application/json'
  };

  let sha;
  const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  } else if (existing.status !== 404) {
    return { saved: false, reason: `GitHub read failed (${existing.status})` };
  }

  const payload = JSON.stringify(result, null, 2) + '\n';
  const body = {
    message: `chore: save latest MAULI command result`,
    content: utf8ToBase64(payload),
    branch
  };
  if (sha) body.sha = sha;

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return { saved: false, reason: `GitHub write failed (${response.status})` };
  }

  const data = await response.json();
  return { saved: true, path, branch, commitSha: data.commit?.sha || null };
}

export function decodeStoredResult(content) {
  return JSON.parse(base64ToUtf8(content));
}

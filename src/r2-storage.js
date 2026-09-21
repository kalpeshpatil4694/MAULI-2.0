const PREFIX = "mauli2";

export function hasR2(env) {
  return Boolean(env?.ARTIFACTS && typeof env.ARTIFACTS.put === "function");
}

export function artifactZipKey(projectId, artifactId) {
  const safe = String(projectId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const id = String(artifactId || "delivery").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${PREFIX}/deliveries/${safe}/${id}.zip`;
}

export async function putArtifactZip(env, key, bytes, metadata = {}) {
  if (!hasR2(env)) return null;
  await env.ARTIFACTS.put(key, bytes, {
    httpMetadata: { contentType: "application/zip", cacheControl: "private, max-age=300" },
    customMetadata: Object.fromEntries(Object.entries(metadata).map(([k,v]) => [k, String(v ?? "")]))
  });
  return key;
}

export async function getArtifactObject(env, key) {
  if (!hasR2(env) || !key) return null;
  return env.ARTIFACTS.get(key);
}

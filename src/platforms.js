// MAULI 2.0 — target platforms.
//
// "Build a habit tracker" and "Build a habit tracker for Android" are different products,
// but until now MAULI built the same web page for both and only discovered the platform
// afterwards, when the founder clicked a build button. The target is part of the command,
// so it is captured with the command, planned for, recorded on the delivery, and chosen in
// the dashboard before the command is ever sent.
//
// Detection is a fallback, not the mechanism: an explicit choice always wins, and a
// command that names no platform still builds for the web rather than failing.

export const DEFAULT_PLATFORM = 'web';

export const PLATFORMS = [
  {
    id: 'web',
    label: 'Web',
    icon: '🌐',
    // A browser target needs no packaging step, so it adds no requirement of its own.
    requirements: [],
    // The web keywords describe a delivery shape rather than a named target, so this
    // platform ranks below any platform the founder actually named.
    priority: 10,
    keywords: ['web', 'website', 'browser', 'pwa', 'online', 'site'],
  },
  {
    id: 'android',
    label: 'Android',
    icon: '📱',
    requirements: ['Android packaging and device permissions'],
    priority: 30,
    keywords: ['android', 'apk', 'play store', 'google play'],
  },
  {
    id: 'ios',
    label: 'iOS',
    icon: '🍎',
    requirements: ['iOS packaging and device permissions'],
    priority: 30,
    keywords: ['ios', 'iphone', 'ipad', 'app store'],
  },
  {
    id: 'desktop',
    label: 'Desktop',
    icon: '🖥️',
    requirements: ['Desktop executable packaging and platform metadata'],
    priority: 30,
    keywords: ['desktop', 'exe', 'windows', 'macos', 'mac', 'linux', 'electron'],
  },
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

// Founders type what they mean, not our ids: "exe" is a desktop app and "apk" is an
// Android one. Aliases are resolved before anything else, so an explicit "exe" choice is
// never read as an unknown platform and silently dropped back to the default.
const ALIASES = new Map([
  ['apk', 'android'],
  ['android app', 'android'],
  ['google play', 'android'],
  ['play store', 'android'],
  ['iphone', 'ios'],
  ['ipad', 'ios'],
  ['app store', 'ios'],
  ['exe', 'desktop'],
  ['executable', 'desktop'],
  ['windows', 'desktop'],
  ['win', 'desktop'],
  ['macos', 'desktop'],
  ['mac', 'desktop'],
  ['linux', 'desktop'],
  ['electron', 'desktop'],
  ['browser', 'web'],
  ['website', 'web'],
  ['websites', 'web'],
  ['site', 'web'],
  ['pwa', 'web'],
  ['online', 'web'],
]);

export function isKnownPlatform(value) {
  return BY_ID.has(String(value ?? '').trim().toLowerCase());
}

export function getPlatform(value) {
  return BY_ID.get(String(value ?? '').trim().toLowerCase()) ?? null;
}

export function platformLabel(value) {
  return getPlatform(value)?.label ?? getPlatform(DEFAULT_PLATFORM).label;
}

export function platformIcon(value) {
  return getPlatform(value)?.icon ?? getPlatform(DEFAULT_PLATFORM).icon;
}

/**
 * Resolve any user-supplied platform value to a canonical id, or null when it is not one
 * we can build for. Callers decide what an unknown value means — the command endpoint
 * rejects it rather than guessing, because silently building the wrong platform is exactly
 * the class of failure this feature exists to remove.
 */
export function normalizePlatform(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (BY_ID.has(raw)) return raw;
  if (ALIASES.has(raw)) return ALIASES.get(raw);
  return null;
}

/**
 * Infer the target platform from the command text. Word-boundary matched so "mac" does not
 * fire on "machine" and "ios" does not fire on "curious".
 *
 * Ranking is by platform specificity, NOT keyword length. "Build a portfolio website for
 * Android" mentions both a target and a delivery shape, and ranking by word length let the
 * longer word win — the web default hijacking a command that named a real platform. A named
 * platform always outranks the browser hint; length only breaks ties within one platform.
 */
export function detectPlatformFromText(text) {
  const haystack = ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hits = [];
  for (const platform of PLATFORMS) {
    for (const keyword of platform.keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(haystack)) {
        hits.push({ id: platform.id, rank: platform.priority, weight: keyword.length });
      }
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (b.rank - a.rank) || (b.weight - a.weight));
  return hits[0].id;
}

/**
 * The platform a command will be built for.
 * @returns {{platform:string, source:'explicit'|'inferred'|'default'}}
 */
export function resolvePlatform(explicit, commandText = '') {
  const chosen = normalizePlatform(explicit);
  if (chosen) return { platform: chosen, source: 'explicit' };
  const inferred = detectPlatformFromText(commandText);
  if (inferred) return { platform: inferred, source: 'inferred' };
  return { platform: DEFAULT_PLATFORM, source: 'default' };
}

/** Requirements a plan must carry for the given target, beyond the standard set. */
export function platformRequirements(value) {
  return [...(getPlatform(value)?.requirements ?? [])];
}

/**
 * Merge platform requirements into a plan's requirement list without duplicating any, and
 * never drop one the planner already decided on.
 */
export function withPlatformRequirements(requirements, platform) {
  const list = Array.isArray(requirements) ? [...requirements] : [];
  for (const requirement of platformRequirements(platform)) {
    if (!list.includes(requirement)) list.push(requirement);
  }
  return list;
}

/** A one-line description of the target, for manifests and founder-facing output. */
export function describePlatform(value) {
  const platform = getPlatform(value) ?? getPlatform(DEFAULT_PLATFORM);
  return `${platform.icon} ${platform.label}`;
}

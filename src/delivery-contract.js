const lower = value => String(value ?? '').toLowerCase();

export function detectDeliveryType(text) {
  const value = lower(text);
  if (/\b(mobile application|mobile app|android app|ios app|react native|react-native|flutter app|expo app|native app|apk|aab)\b/.test(value)) return 'mobile-app';
  if (/\b(web application|web app|website|web platform|web site)\b/.test(value)) return 'web-app';
  if (/\b(api|backend service|rest api|graphql)\b/.test(value)) return 'api';
  if (/\b(desktop application|desktop app|windows app|mac app)\b/.test(value)) return 'desktop-app';
  return 'general-project';
}

function fileName(file) { return lower(file?.path).split('/').pop(); }
function fileText(files) { return files.map(file => lower(file?.content)).join('\n'); }

export function checkDeliveryContract(text, files) {
  const requestedType = detectDeliveryType(text);
  const names = files.map(fileName);
  const combined = fileText(files);
  const checks = [];

  if (requestedType === 'mobile-app') {
    const nativeEvidence = [
      names.some(name => ['androidmanifest.xml','build.gradle','settings.gradle','gradlew','pubspec.yaml'].includes(name)),
      names.some(name => ['app.json','app.config.js','app.config.ts'].includes(name)),
      names.some(name => name === 'package.json') && /react-native|expo|@react-native|ionic|capacitor/.test(combined),
      files.some(file => /^android\//i.test(String(file?.path ?? ''))),
      files.some(file => /^ios\//i.test(String(file?.path ?? '')))
    ].some(Boolean);
    const webOnly = names.includes('index.html') && !nativeEvidence;
    checks.push({ name: 'mobile_project_structure', passed: nativeEvidence, reason: nativeEvidence ? 'native-mobile evidence detected' : 'no Android/iOS/Expo/React-Native/Flutter project structure detected' });
    checks.push({ name: 'not_web_only_delivery', passed: !webOnly, reason: webOnly ? 'artifact is web-only but Founder requested a mobile application' : 'delivery is not web-only' });
    checks.push({ name: 'mobile_build_configuration', passed: nativeEvidence && (names.includes('package.json') || names.includes('pubspec.yaml') || names.some(name => ['build.gradle','settings.gradle'].includes(name))), reason: 'mobile build configuration required' });
  } else if (requestedType === 'web-app') {
    const webEvidence = names.includes('index.html') || names.includes('package.json') || names.some(name => ['vite.config.js','vite.config.ts','next.config.js','next.config.mjs'].includes(name));
    checks.push({ name: 'web_project_structure', passed: webEvidence });
  } else if (requestedType === 'api') {
    const apiEvidence = /\b(express|fastify|hono|koa|nestjs|graphql|fetch\s*\(|router|route)\b/.test(combined) || names.some(name => ['package.json','wrangler.toml','wrangler.json','wrangler.jsonc'].includes(name));
    checks.push({ name: 'api_project_structure', passed: apiEvidence });
  }

  return { requestedType, passed: checks.every(check => check.passed), checks };
}

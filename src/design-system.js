/**
 * Design System Integration — auto-generate design systems.
 * Inspired by github.com/nexu-io/open-design (5k+ stars)
 * Generates design tokens, components, and layouts.
 */
import { id, now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

/**
 * Pre-built design themes
 */
const DESIGN_THEMES = {
  dark: {
    name: 'Midnight Dark',
    colors: { bg: '#0f172a', surface: '#1e293b', primary: '#3b82f6', accent: '#8b5cf6', text: '#f8fafc', muted: '#94a3b8', success: '#22c55e', error: '#ef4444', warning: '#f59e0b' },
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '12px',
    shadows: '0 4px 6px -1px rgba(0,0,0,0.3)'
  },
  light: {
    name: 'Clean Light',
    colors: { bg: '#ffffff', surface: '#f8fafc', primary: '#2563eb', accent: '#7c3aed', text: '#0f172a', muted: '#64748b', success: '#16a34a', error: '#dc2626', warning: '#d97706' },
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '8px',
    shadows: '0 1px 3px rgba(0,0,0,0.1)'
  },
  cyberpunk: {
    name: 'Neon Cyberpunk',
    colors: { bg: '#0a0a0f', surface: '#1a1a2e', primary: '#00ff88', accent: '#ff00ff', text: '#e0e0e0', muted: '#888', success: '#00ff88', error: '#ff0044', warning: '#ffaa00' },
    fonts: { heading: 'Orbitron', body: 'Rajdhani', mono: 'Fira Code' },
    radius: '4px',
    shadows: '0 0 20px rgba(0,255,136,0.2)'
  },
  minimal: {
    name: 'Minimal Clean',
    colors: { bg: '#fafafa', surface: '#ffffff', primary: '#000000', accent: '#333333', text: '#111111', muted: '#666666', success: '#2d6a4f', error: '#d00000', warning: '#e85d04' },
    fonts: { heading: 'system-ui', body: 'system-ui', mono: 'monospace' },
    radius: '0px',
    shadows: 'none'
  },
  gradient: {
    name: 'Gradient Modern',
    colors: { bg: '#0f0f23', surface: '#1a1a3e', primary: '#667eea', accent: '#764ba2', text: '#f0f0f0', muted: '#a0a0c0', success: '#48bb78', error: '#fc8181', warning: '#f6ad55' },
    fonts: { heading: 'Poppins', body: 'Inter', mono: 'Source Code Pro' },
    radius: '16px',
    shadows: '0 10px 40px rgba(102,126,234,0.2)'
  },
  glassmorphism: {
    name: 'Glassmorphism',
    colors: { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', surface: 'rgba(255,255,255,0.1)', primary: '#ffffff', accent: '#e0e7ff', text: '#ffffff', muted: 'rgba(255,255,255,0.7)', success: '#86efac', error: '#fca5a5', warning: '#fde68a' },
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '20px',
    shadows: '0 8px 32px rgba(0,0,0,0.3)'
  }
};

/**
 * Generate a complete design system CSS
 */
export function generateDesignCSS(themeName = 'dark') {
  const theme = DESIGN_THEMES[themeName] || DESIGN_THEMES.dark;

  let css = `/* MAULI 2.0 Design System — ${theme.name} */\n`;
  css += `:root {\n`;

  // Colors
  for (const [key, value] of Object.entries(theme.colors)) {
    css += `  --color-${key}: ${value};\n`;
  }

  // Fonts
  css += `\n  /* Fonts */\n`;
  for (const [key, value] of Object.entries(theme.fonts)) {
    css += `  --font-${key}: ${value}, system-ui, sans-serif;\n`;
  }

  // Spacing
  css += `\n  /* Spacing */\n`;
  css += `  --space-xs: 4px;\n`;
  css += `  --space-sm: 8px;\n`;
  css += `  --space-md: 16px;\n`;
  css += `  --space-lg: 24px;\n`;
  css += `  --space-xl: 32px;\n`;
  css += `  --space-2xl: 48px;\n`;

  // Border radius
  css += `\n  /* Border Radius */\n`;
  css += `  --radius: ${theme.radius};\n`;
  css += `  --radius-sm: calc(var(--radius) / 2);\n`;
  css += `  --radius-lg: calc(var(--radius) * 1.5);\n`;

  // Shadows
  css += `\n  /* Shadows */\n`;
  css += `  --shadow: ${theme.shadows};\n`;

  css += `}\n\n`;

  // Base styles
  css += `* { margin: 0; padding: 0; box-sizing: border-box; }\n`;
  css += `body { font-family: var(--font-body); background: var(--color-bg); color: var(--color-text); line-height: 1.6; }\n`;
  css += `h1,h2,h3,h4,h5,h6 { font-family: var(--font-heading); font-weight: 700; }\n\n`;

  // Component classes
  css += `.btn { display: inline-flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border-radius: var(--radius); font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }\n`;
  css += `.btn-primary { background: var(--color-primary); color: var(--color-bg); }\n`;
  css += `.btn-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: var(--shadow); }\n`;
  css += `.btn-accent { background: var(--color-accent); color: white; }\n`;
  css += `.btn-ghost { background: transparent; color: var(--color-text); border: 1px solid var(--color-muted); }\n\n`;

  css += `.card { background: var(--color-surface); border-radius: var(--radius); padding: var(--space-lg); box-shadow: var(--shadow); border: 1px solid rgba(255,255,255,0.05); }\n`;
  css += `.badge { display: inline-flex; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }\n`;
  css += `.badge-success { background: rgba(34,197,94,0.15); color: var(--color-success); }\n`;
  css += `.badge-error { background: rgba(239,68,68,0.15); color: var(--color-error); }\n\n`;

  css += `.input { width: 100%; padding: var(--space-sm) var(--space-md); background: var(--color-surface); border: 1px solid rgba(255,255,255,0.1); border-radius: var(--radius); color: var(--color-text); font-size: 14px; }\n`;
  css += `.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }\n`;

  return css;
}

/**
 * Generate HTML component library
 */
export function generateComponentLibrary(themeName = 'dark') {
  const css = generateDesignCSS(themeName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MAULI Design System — ${DESIGN_THEMES[themeName]?.name || themeName}</title>
<style>${css}</style>
</head>
<body style="padding:2rem">
<h1>🎨 ${DESIGN_THEMES[themeName]?.name || themeName} Theme</h1>
<p style="color:var(--color-muted);margin:1rem 0">Component library for MAULI 2.0 projects</p>

<div style="display:grid;gap:1.5rem;max-width:800px;margin-top:2rem">
  <div class="card">
    <h3>Buttons</h3>
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-primary">Primary</button>
      <button class="btn btn-accent">Accent</button>
      <button class="btn btn-ghost">Ghost</button>
    </div>
  </div>
  
  <div class="card">
    <h3>Badges</h3>
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <span class="badge badge-success">Success</span>
      <span class="badge badge-error">Error</span>
    </div>
  </div>
  
  <div class="card">
    <h3>Input</h3>
    <input class="input" placeholder="Type something..." style="margin-top:1rem">
  </div>
  
  <div class="card">
    <h3>Colors</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:0.5rem;margin-top:1rem">
      ${Object.entries(DESIGN_THEMES[themeName]?.colors || {}).map(([name, color]) =>
        `<div style="text-align:center"><div style="width:60px;height:60px;border-radius:8px;background:${color};margin:0 auto"></div><div style="font-size:10px;margin-top:4px">${name}</div></div>`
      ).join('\n      ')}
    </div>
  </div>
</div>
</body>
</html>`;
}

/**
 * Get all available themes
 */
export function getThemes() {
  return Object.entries(DESIGN_THEMES).map(([key, theme]) => ({
    id: key,
    name: theme.name,
    colors: theme.colors
  }));
}

/**
 * Generate design system artifact
 */
export function createDesignSystem(projectId, themeName = 'dark') {
  const css = generateDesignCSS(themeName);
  const html = generateComponentLibrary(themeName);

  return registerArtifact({
    projectId,
    taskId: null,
    agentId: null,
    type: 'code-workspace',
    content: {
      summary: `Design system: ${DESIGN_THEMES[themeName]?.name || themeName}`,
      files: [
        { path: 'styles/theme.css', content: css },
        { path: 'styles/components.html', content: html },
        { path: 'styles/variables.css', content: `:root { ${Object.entries(DESIGN_THEMES[themeName]?.colors || {}).map(([k, v]) => `--color-${k}: ${v};`).join('\n  ')} }` }
      ],
      tests: ['Theme renders correctly', 'Components display properly'],
      notes: [`Theme: ${themeName}`, 'All design tokens included']
    },
    metadata: { generatedBy: 'design-system', theme: themeName }
  });
}

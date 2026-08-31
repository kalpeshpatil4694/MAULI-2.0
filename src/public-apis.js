/**
 * Public APIs Integration — auto-discovers free APIs for any project.
 * Based on github.com/public-apis/public-apis (473k stars)
 */
import { id, now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

const API_CATALOG = {
  weather: [
    { name: 'OpenWeatherMap', url: 'https://api.openweathermap.org/data/2.5/weather', auth: 'API Key', free: true, category: 'Weather' },
    { name: 'WeatherAPI', url: 'https://api.weatherapi.com/v1/current.json', auth: 'API Key', free: true, category: 'Weather' },
    { name: 'wttr.in', url: 'https://wttr.in', auth: 'None', free: true, category: 'Weather' }
  ],
  finance: [
    { name: 'Alpha Vantage', url: 'https://www.alphavantage.co/query', auth: 'API Key', free: true, category: 'Finance' },
    { name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3', auth: 'None', free: true, category: 'Crypto' },
    { name: 'ExchangeRate', url: 'https://open.er-api.com/v6/latest/USD', auth: 'None', free: true, category: 'Currency' }
  ],
  music: [
    { name: 'LastFM', url: 'https://ws.audioscrobbler.com/2.0/', auth: 'API Key', free: true, category: 'Music' },
    { name: 'Jamendo', url: 'https://api.jamendo.com/v3.0', auth: 'Client ID', free: true, category: 'Music' }
  ],
  maps: [
    { name: 'OpenStreetMap', url: 'https://nominatim.openstreetmap.org', auth: 'None', free: true, category: 'Maps' },
    { name: 'Mapbox', url: 'https://api.mapbox.com', auth: 'Access Token', free: true, category: 'Maps' }
  ],
  ai: [
    { name: 'Hugging Face', url: 'https://api-inference.huggingface.co/models', auth: 'API Key', free: true, category: 'AI' },
    { name: 'Cohere', url: 'https://api.cohere.ai/v1', auth: 'API Key', free: true, category: 'AI' },
    { name: 'Groq', url: 'https://api.groq.com/openai/v1', auth: 'API Key', free: true, category: 'AI' }
  ],
  news: [
    { name: 'NewsAPI', url: 'https://newsapi.org/v2', auth: 'API Key', free: true, category: 'News' },
    { name: 'GNews', url: 'https://gnews.io/api/v4', auth: 'API Key', free: true, category: 'News' }
  ],
  images: [
    { name: 'Unsplash', url: 'https://api.unsplash.com', auth: 'Access Key', free: true, category: 'Images' },
    { name: 'Pexels', url: 'https://api.pexels.com/v1', auth: 'API Key', free: true, category: 'Images' }
  ],
  pdf: [
    { name: 'pdf.co', url: 'https://api.pdf.co/v1', auth: 'API Key', free: true, category: 'PDF' },
    { name: 'iLovePDF', url: 'https://api.ilovepdf.com/v1', auth: 'API Key', free: true, category: 'PDF' }
  ],
  chat: [
    { name: 'Chatbot Arena', url: 'https://chat.lmsys.org/api', auth: 'None', free: true, category: 'Chat' }
  ],
  database: [
    { name: 'Supabase', url: 'https://api.supabase.com', auth: 'Service Key', free: true, category: 'Database' },
    { name: 'PlanetScale', url: 'https://api.planetscale.com/v1', auth: 'API Key', free: true, category: 'Database' }
  ],
  storage: [
    { name: 'Cloudflare R2', url: 'https://api.cloudflare.com/client/v4', auth: 'API Token', free: true, category: 'Storage' },
    { name: 'Backblaze B2', url: 'https://api.backblazeb2.com/b2api/v2', auth: 'API Key', free: true, category: 'Storage' }
  ],
  email: [
    { name: 'Resend', url: 'https://api.resend.com', auth: 'API Key', free: true, category: 'Email' },
    { name: 'EmailJS', url: 'https://api.emailjs.com/api/v1.0', auth: 'Service ID', free: true, category: 'Email' }
  ],
  sms: [
    { name: 'Twilio', url: 'https://api.twilio.com/2010-04-01', auth: 'Account SID', free: true, category: 'SMS' }
  ],
  auth: [
    { name: 'Clerk', url: 'https://api.clerk.com/v1', auth: 'API Key', free: true, category: 'Auth' },
    { name: 'Auth0', url: 'https://YOUR_DOMAIN.auth0.com/api/v2', auth: 'Token', free: true, category: 'Auth' }
  ],
  monitoring: [
    { name: 'Sentry', url: 'https://sentry.io/api/0', auth: 'Auth Token', free: true, category: 'Monitoring' },
    { name: 'UptimeRobot', url: 'https://api.uptimerobot.com/v2', auth: 'API Key', free: true, category: 'Monitoring' }
  ]
};

/**
 * Search for APIs matching a capability
 */
export function searchAPIs(capability) {
  const lower = capability.toLowerCase();
  const results = [];

  for (const [category, apis] of Object.entries(API_CATALOG)) {
    if (lower.includes(category) || category.includes(lower)) {
      results.push(...apis);
    }
  }

  // Also search by keywords in capability
  for (const [category, apis] of Object.entries(API_CATALOG)) {
    for (const api of apis) {
      if (lower.includes(api.name.toLowerCase()) || api.name.toLowerCase().includes(lower)) {
        if (!results.includes(api)) results.push(api);
      }
    }
  }

  return results;
}

/**
 * Get best API recommendation for a project
 */
export function recommendAPIs(projectObjective) {
  const lower = projectObjective.toLowerCase();
  const recommendations = {};

  if (/weather|climate|temperature|forecast/.test(lower)) recommendations.weather = API_CATALOG.weather[0];
  if (/finance|stock|crypto|money|payment/.test(lower)) recommendations.finance = API_CATALOG.finance[0];
  if (/music|song|audio|playlist/.test(lower)) recommendations.music = API_CATALOG.music[0];
  if (/map|location|geo|navigation|tracker/.test(lower)) recommendations.maps = API_CATALOG.maps[0];
  if (/ai|chat|bot|assistant|llm/.test(lower)) recommendations.ai = API_CATALOG.ai[0];
  if (/news|article|blog|feed/.test(lower)) recommendations.news = API_CATALOG.news[0];
  if (/image|photo|picture|gallery/.test(lower)) recommendations.images = API_CATALOG.images[0];
  if (/pdf|document|report/.test(lower)) recommendations.pdf = API_CATALOG.pdf[0];
  if (/database|data|storage|persist/.test(lower)) recommendations.database = API_CATALOG.database[0];
  if (/storage|upload|file|bucket/.test(lower)) recommendations.storage = API_CATALOG.storage[0];
  if (/email|mail|notify|notification/.test(lower)) recommendations.email = API_CATALOG.email[0];
  if (/sms|text|message|sms/.test(lower)) recommendations.sms = API_CATALOG.sms[0];
  if (/auth|login|signup|user/.test(lower)) recommendations.auth = API_CATALOG.auth[0];
  if (/monitor|uptime|health|track/.test(lower)) recommendations.monitoring = API_CATALOG.monitoring[0];

  // Always suggest a fallback AI API
  if (!recommendations.ai) recommendations.ai = API_CATALOG.ai[2]; // Groq (fast, free)

  return recommendations;
}

/**
 * Get full catalog
 */
export function getAPICatalog() {
  return API_CATALOG;
}

/**
 * Get all categories
 */
export function getAPICategories() {
  return Object.keys(API_CATALOG).map(cat => ({
    name: cat,
    count: API_CATALOG[cat].length,
    apis: API_CATALOG[cat].map(a => a.name)
  }));
}

/**
 * Store API usage in memory
 */
export function recordAPIUsage(projectId, apiName, success) {
  remember({
    type: 'technical_knowledge',
    content: { action: 'api_usage', apiName, success },
    scope: 'project',
    scopeId: projectId,
    importance: success ? 'normal' : 'high',
    source: 'public-apis'
  });
}

/**
 * Free Services Integration — recommends free tiers for any project.
 * Based on github.com/ripienaar/free-for-dev (200k+ stars)
 */
import { remember } from './memory.js';

const FREE_SERVICES = {
  hosting: [
    { name: 'Cloudflare Workers', url: 'https://workers.cloudflare.com', tier: '100k req/day', category: 'Serverless', best: true },
    { name: 'Vercel', url: 'https://vercel.com', tier: '100GB bandwidth', category: 'Frontend' },
    { name: 'Netlify', url: 'https://netlify.com', tier: '100GB bandwidth', category: 'Frontend' },
    { name: 'Render', url: 'https://render.com', tier: '750h/mo', category: 'Backend' },
    { name: 'Railway', url: 'https://railway.app', tier: '$5 credit', category: 'Backend' },
    { name: 'Fly.io', url: 'https://fly.io', tier: '3 shared-cpu-1x', category: 'Containers' },
    { name: 'GitHub Pages', url: 'https://pages.github.com', tier: '1GB', category: 'Static' }
  ],
  database: [
    { name: 'Supabase', url: 'https://supabase.com', tier: '500MB', category: 'PostgreSQL', best: true },
    { name: 'PlanetScale', url: 'https://planetscale.com', tier: '5GB', category: 'MySQL' },
    { name: 'Turso', url: 'https://turso.tech', tier: '500 databases', category: 'SQLite' },
    { name: 'Neon', url: 'https://neon.tech', tier: '512MB', category: 'PostgreSQL' },
    { name: 'MongoDB Atlas', url: 'https://mongodb.com/atlas', tier: '512MB', category: 'NoSQL' },
    { name: 'Firebase', url: 'https://firebase.google.com', tier: '1GB', category: 'NoSQL' }
  ],
  ai: [
    { name: 'Groq', url: 'https://groq.com', tier: '14k req/day', category: 'LLM', best: true },
    { name: 'Hugging Face', url: 'https://huggingface.co', tier: 'Unlimited inference', category: 'ML' },
    { name: 'Cohere', url: 'https://cohere.com', tier: '1000 req/mo', category: 'LLM' },
    { name: 'OpenAI', url: 'https://openai.com', tier: '$5 credit', category: 'LLM' },
    { name: 'Together AI', url: 'https://together.ai', tier: '$5 credit', category: 'LLM' },
    { name: 'Ollama', url: 'https://ollama.com', tier: 'Unlimited (local)', category: 'LLM', best: true }
  ],
  storage: [
    { name: 'Cloudflare R2', url: 'https://r2.cloudflare.com', tier: '10GB free', category: 'Object Storage', best: true },
    { name: 'Backblaze B2', url: 'https://backblaze.com', tier: '10GB free', category: 'Object Storage' },
    { name: 'Cloudinary', url: 'https://cloudinary.com', tier: '25GB', category: 'Image/Video' },
    { name: 'ImgBB', url: 'https://imgbb.com', tier: 'Unlimited', category: 'Image Hosting' }
  ],
  email: [
    { name: 'Resend', url: 'https://resend.com', tier: '100 emails/day', category: 'Transactional', best: true },
    { name: 'SendGrid', url: 'https://sendgrid.com', tier: '100 emails/day', category: 'Transactional' },
    { name: 'EmailJS', url: 'https://emailjs.com', tier: '200 emails/mo', category: 'Client-side' },
    { name: 'Mailgun', url: 'https://mailgun.com', tier: '1000 emails/mo', category: 'Transactional' }
  ],
  sms: [
    { name: 'Twilio', url: 'https://twilio.com', tier: '$15 credit', category: 'SMS' },
    { name: 'Vonage', url: 'https://vonage.com', tier: '€2 credit', category: 'SMS' }
  ],
  auth: [
    { name: 'Clerk', url: 'https://clerk.com', tier: '10k MAU', category: 'Auth', best: true },
    { name: 'Auth0', url: 'https://auth0.com', tier: '7k MAU', category: 'Auth' },
    { name: 'Supabase Auth', url: 'https://supabase.com/auth', tier: '50k MAU', category: 'Auth' },
    { name: 'Firebase Auth', url: 'https://firebase.google.com', tier: 'Unlimited', category: 'Auth' }
  ],
  monitoring: [
    { name: 'Sentry', url: 'https://sentry.io', tier: '5k errors/mo', category: 'Error Tracking', best: true },
    { name: 'UptimeRobot', url: 'https://uptimerobot.com', tier: '50 monitors', category: 'Uptime' },
    { name: 'Better Uptime', url: 'https://betterstack.com', tier: '10 monitors', category: 'Uptime' },
    { name: 'Grafana Cloud', url: 'https://grafana.com', tier: '10k metrics', category: 'Metrics' }
  ],
  cdn: [
    { name: 'Cloudflare CDN', url: 'https://cloudflare.com', tier: 'Unlimited', category: 'CDN', best: true },
    { name: 'jsDelivr', url: 'https://jsdelivr.com', tier: 'Unlimited', category: 'JS CDN' }
  ],
  domains: [
    { name: 'Freenom', url: 'https://freenom.com', tier: '.tk/.ml free', category: 'Free Domain' },
    { name: 'GitHub Pages', url: 'https://pages.github.com', tier: '.github.io', category: 'Subdomain' }
  ],
  analytics: [
    { name: 'Plausible', url: 'https://plausible.io', tier: '30-day trial', category: 'Analytics' },
    { name: 'Umami', url: 'https://umami.is', tier: 'Self-hosted free', category: 'Analytics', best: true },
    { name: 'GoatCounter', url: 'https://goatcounter.com', tier: 'Unlimited', category: 'Analytics' }
  ],
  search: [
    { name: 'Algolia', url: 'https://algolia.com', tier: '10k searches/mo', category: 'Search' },
    { name: 'MeiliSearch', url: 'https://meilisearch.com', tier: 'Self-hosted free', category: 'Search', best: true }
  ]
};

/**
 * Get free services for a project type
 */
export function getFreeServices(projectType) {
  const lower = projectType.toLowerCase();
  const recommendations = {};

  for (const [category, services] of Object.entries(FREE_SERVICES)) {
    // Find best service for this category
    const best = services.find(s => s.best) || services[0];
    recommendations[category] = {
      ...best,
      alternatives: services.filter(s => s !== best).slice(0, 3)
    };
  }

  return recommendations;
}

/**
 * Get services by category
 */
export function getServicesByCategory(category) {
  return FREE_SERVICES[category] || [];
}

/**
 * Get all categories
 */
export function getServiceCategories() {
  return Object.entries(FREE_SERVICES).map(([name, services]) => ({
    name,
    count: services.length,
    services: services.map(s => s.name)
  }));
}

/**
 * Estimate free tier costs for a project
 */
export function estimateFreeTierCost(projectType) {
  const services = getFreeServices(projectType);
  let totalCost = 0;

  for (const [category, service] of Object.entries(services)) {
    // All services listed are free
    totalCost += 0;
  }

  return {
    estimatedMonthlyCost: '$0',
    services: Object.entries(services).map(([cat, s]) => ({
      category: cat,
      service: s.name,
      tier: s.tier,
      cost: 'Free'
    }))
  };
}

/**
 * Record service recommendation
 */
export function recordServiceUsage(projectId, serviceName, category) {
  remember({
    type: 'technical_knowledge',
    content: { action: 'service_recommendation', serviceName, category },
    scope: 'project',
    scopeId: projectId,
    importance: 'normal',
    source: 'free-services'
  });
}

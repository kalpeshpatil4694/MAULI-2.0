/**
 * Scraper Integration — adaptive web scraping for Research Agent.
 * Based on github.com/D4Vinci/Scrapling (76k+ stars)
 * Uses fetch-based scraping (Cloudflare Workers compatible)
 */
import { id, now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

/**
 * Scrape a web page and extract content
 */
export async function scrapePage(url, options = {}) {
  const { selector = null, extract = 'text', timeout = 10000 } = options;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MAULI-Scraper/2.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract all text content (strip HTML tags)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000);

    // Extract links
    const links = [];
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      if (links.length >= 50) break;
      links.push({ url: linkMatch[1], text: linkMatch[2].trim() });
    }

    // Extract images
    const images = [];
    const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      if (images.length >= 20) break;
      images.push({ url: imgMatch[1], alt: imgMatch[2] || '' });
    }

    return {
      success: true,
      url,
      title,
      description,
      text: textContent,
      links: links.slice(0, 50),
      images: images.slice(0, 20),
      contentLength: html.length,
      scrapedAt: now()
    };
  } catch (e) {
    return { success: false, url, error: e.message };
  }
}

/**
 * Search and scrape multiple pages
 */
export async function scrapeMultiple(urls, options = {}) {
  const results = [];
  for (const url of urls) {
    const result = await scrapePage(url, options);
    results.push(result);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

/**
 * Extract structured data from a page
 */
export async function extractData(url, schema) {
  const page = await scrapePage(url);
  if (!page.success) return { error: page.error };

  const data = {};
  const text = page.text.toLowerCase();

  for (const [field, pattern] of Object.entries(schema)) {
    if (typeof pattern === 'string') {
      const regex = new RegExp(pattern, 'i');
      const match = page.text.match(regex);
      data[field] = match ? match[1] || match[0] : null;
    } else if (pattern instanceof RegExp) {
      const match = page.text.match(pattern);
      data[field] = match ? match[1] || match[0] : null;
    }
  }

  return { url, data, title: page.title };
}

/**
 * Scrape competitor information
 */
export async function scrapeCompetitor(competitorUrl) {
  const page = await scrapePage(competitorUrl);
  if (!page.success) return { error: page.error };

  return {
    url: competitorUrl,
    title: page.title,
    description: page.description,
    linksCount: page.links.length,
    imagesCount: page.images.length,
    contentPreview: page.text.substring(0, 500),
    scrapedAt: now()
  };
}

/**
 * Research a topic by scraping search results
 */
export async function researchTopic(topic) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic)}`;
  const page = await scrapePage(searchUrl);

  if (!page.success) return { error: page.error };

  // Extract search result links
  const results = page.links
    .filter(l => l.url.startsWith('http') && !l.url.includes('duckduckgo'))
    .slice(0, 10)
    .map(l => ({ title: l.text, url: l.url }));

  return {
    topic,
    results,
    totalFound: results.length,
    scrapedAt: now()
  };
}

/**
 * Record scraping activity
 */
export function recordScrape(projectId, url, success) {
  remember({
    type: 'technical_knowledge',
    content: { action: 'web_scrape', url: url.substring(0, 200), success },
    scope: 'project',
    scopeId: projectId,
    importance: 'normal',
    source: 'scraper'
  });
}

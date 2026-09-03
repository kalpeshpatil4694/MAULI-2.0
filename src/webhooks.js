// MAULI 2.0 — Webhook System
// Notify external services when events occur

import { id, now } from './core.js';
import { store } from './store.js';

const MAX_WEBHOOKS = 50;
const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_TIMEOUT_MS = 10000;

/**
 * Register a webhook endpoint
 */
export function registerWebhook({ url, events = ['*'], secret = null, active = true }) {
  if (!url || typeof url !== 'string') throw new Error('URL is required');
  if (store.list('webhooks').length >= MAX_WEBHOOKS) throw new Error('Maximum webhooks reached');

  const webhook = store.put('webhooks', {
    id: id('webhook'),
    url: url.trim(),
    events: Array.isArray(events) ? events : [events],
    secret,
    active: active !== false,
    createdAt: now(),
    deliveryCount: 0,
    lastDeliveryAt: null,
    lastStatus: null,
  });

  store.addEvent('webhook.registered', { webhookId: webhook.id, url: webhook.url });
  return webhook;
}

/**
 * Update a webhook
 */
export function updateWebhook(webhookId, patch) {
  const existing = store.get('webhooks', webhookId);
  if (!existing) return null;
  return store.put('webhooks', { ...existing, ...patch, id: existing.id, updatedAt: now() });
}

/**
 * Delete a webhook
 */
export function deleteWebhook(webhookId) {
  const webhook = store.get('webhooks', webhookId);
  if (!webhook) return false;
  store.put('webhooks', { ...webhook, active: false, deletedAt: now(), id: webhook.id });
  store.addEvent('webhook.deleted', { webhookId });
  return true;
}

/**
 * List all webhooks
 */
export function listWebhooks() {
  return store.list('webhooks').filter(w => w.active !== false);
}

/**
 * Trigger webhooks for an event
 */
export async function triggerWebhooks(eventType, payload) {
  const webhooks = store.list('webhooks').filter(w =>
    w.active && (w.events.includes('*') || w.events.includes(eventType))
  );

  if (!webhooks.length) return [];

  const results = [];
  for (const webhook of webhooks) {
    const delivery = {
      id: id('delivery'),
      webhookId: webhook.id,
      eventType,
      payload,
      status: 'pending',
      attemptedAt: now(),
    };

    try {
      const body = JSON.stringify({
        event: eventType,
        data: payload,
        timestamp: now(),
        deliveryId: delivery.id,
      });

      // Generate signature if secret is set
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'MAULI-2.0-Webhook' };
      if (webhook.secret) {
        // Simple HMAC-like signature (for production, use crypto.subtle)
        const sig = await generateSignature(body, webhook.secret);
        headers['X-Webhook-Signature'] = sig;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      delivery.status = response.ok ? 'delivered' : 'failed';
      delivery.statusCode = response.status;
      delivery.deliveredAt = now();

      // Update webhook stats
      store.put('webhooks', {
        ...webhook,
        deliveryCount: (webhook.deliveryCount || 0) + 1,
        lastDeliveryAt: now(),
        lastStatus: delivery.status,
        id: webhook.id,
      });

    } catch (error) {
      delivery.status = 'error';
      delivery.error = error.message;
      delivery.deliveredAt = now();

      store.put('webhooks', {
        ...webhook,
        lastDeliveryAt: now(),
        lastStatus: 'error',
        id: webhook.id,
      });
    }

    store.put('webhook_deliveries', delivery);
    results.push(delivery);
  }

  store.addEvent('webhook.triggered', { eventType, deliveryCount: results.length });
  return results;
}

/**
 * Get delivery history for a webhook
 */
export function getWebhookDeliveries(webhookId, limit = 20) {
  return store.list('webhook_deliveries')
    .filter(d => d.webhookId === webhookId)
    .sort((a, b) => String(b.attemptedAt).localeCompare(String(a.attemptedAt)))
    .slice(0, limit);
}

/**
 * Retry a failed delivery
 */
export async function retryDelivery(deliveryId) {
  const delivery = store.get('webhook_deliveries', deliveryId);
  if (!delivery) return null;

  const webhook = store.get('webhooks', delivery.webhookId);
  if (!webhook) return null;

  const newDelivery = {
    id: id('delivery'),
    webhookId: webhook.id,
    eventType: delivery.eventType,
    payload: delivery.payload,
    status: 'pending',
    attemptedAt: now(),
    retryOf: deliveryId,
  };

  try {
    const body = JSON.stringify({
      event: delivery.eventType,
      data: delivery.payload,
      timestamp: now(),
      deliveryId: newDelivery.id,
    });

    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'MAULI-2.0-Webhook' };
    if (webhook.secret) {
      const sig = await generateSignature(body, webhook.secret);
      headers['X-Webhook-Signature'] = sig;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(webhook.url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);

    newDelivery.status = response.ok ? 'delivered' : 'failed';
    newDelivery.statusCode = response.status;
    newDelivery.deliveredAt = now();
  } catch (error) {
    newDelivery.status = 'error';
    newDelivery.error = error.message;
    newDelivery.deliveredAt = now();
  }

  store.put('webhook_deliveries', newDelivery);
  return newDelivery;
}

/**
 * Generate a simple signature for webhook verification
 */
async function generateSignature(body, secret) {
  // Simple hash for webhook signature verification
  // In production, use crypto.subtle with HMAC-SHA256
  let hash = 0;
  const str = secret + body;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'sha256=' + Math.abs(hash).toString(16).padStart(8, '0');
}

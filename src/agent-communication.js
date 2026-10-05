import { store } from './store.js';
import { id, now } from './core.js';
import { remember, recall } from './memory.js';

/**
 * Agent Communication System — enables agents to send messages,
 * request help, share context, and collaborate on tasks.
 */

/**
 * Send a message from one agent to another
 *
 * Two field vocabularies exist. The internal API addresses agents as {fromAgentId,toAgentId}
 * with a {subject,body}; the dashboard's Messaging panel posts the shorter {from,to,content}.
 * Reading only the long names threw on every panel-sent message before anything was stored,
 * so the feed the founder was looking at stayed empty after they pressed Send. Both
 * vocabularies are accepted here — the stored record always uses the canonical field names.
 */
export function sendMessage({
  fromAgentId = null, toAgentId = null, type = 'info', subject = null, body = null,
  taskId = null, projectId = null,
  from = null, to = null, content = null, message = null
} = {}) {
  const sender = fromAgentId ?? from ?? null;
  const recipient = toAgentId ?? to ?? null;
  if (!sender || !recipient) throw new Error('fromAgentId and toAgentId are required');
  const text = body ?? content ?? message ?? '';

  const record = {
    id: id('msg'),
    fromAgentId: sender,
    toAgentId: recipient,
    type, // info, request, review, handoff, alert, collaboration
    subject: subject || 'Untitled',
    body: text,
    taskId,
    projectId,
    status: 'unread', // unread, read, acknowledged, responded
    createdAt: now(),
    readAt: null,
    responseAt: null,
    response: null
  };
  
  store.put('messages', record);
  store.addEvent('agent.message_sent', {
    messageId: record.id,
    from: sender,
    to: recipient,
    type,
    subject: record.subject
  });
  
  // Also remember in agent memory for learning
  remember({
    type: 'agent_communication',
    content: { from: sender, to: recipient, subject, type },
    scope: 'agent',
    scopeId: sender,
    importance: type === 'alert' ? 'high' : 'normal',
    source: 'agent-communication'
  });
  
  return record;
}

/**
 * Read messages for an agent
 */
export function getMessages(agentId, { unread = false, limit = 20 } = {}) {
  // agentId is optional: the dashboard Messages tab lists the whole feed when no
  // single agent mailbox is requested.
  let messages = store.list('messages');
  if (agentId) messages = messages.filter(m => m.toAgentId === agentId);
  if (unread) messages = messages.filter(m => m.status === 'unread');
  return messages.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

/**
 * Acknowledge a message
 */
export function acknowledgeMessage(messageId, agentId) {
  const msg = store.get('messages', messageId);
  if (!msg || msg.toAgentId !== agentId) return null;
  const updated = store.put('messages', { ...msg, status: 'acknowledged', readAt: now(), id: messageId });
  return updated;
}

/**
 * Respond to a message
 */
export function respondToMessage(messageId, agentId, response) {
  const msg = store.get('messages', messageId);
  if (!msg || msg.toAgentId !== agentId) return null;
  const updated = store.put('messages', {
    ...msg,
    status: 'responded',
    responseAt: now(),
    response,
    readAt: msg.readAt || now(),
    id: messageId
  });
  return updated;
}

/**
 * Request review from another agent
 */
export function requestReview({ fromAgentId, reviewerAgentId, taskId, projectId, subject, body }) {
  return sendMessage({
    fromAgentId,
    toAgentId: reviewerAgentId,
    type: 'review',
    subject: subject || 'Code Review Request',
    body: body || 'Please review this task output.',
    taskId,
    projectId
  });
}

/**
 * Hand off a task to another agent
 */
export function handoffTask({ fromAgentId, toAgentId, taskId, projectId, subject, body, context }) {
  const msg = sendMessage({
    fromAgentId,
    toAgentId,
    type: 'handoff',
    subject: subject || 'Task Handoff',
    body: body || JSON.stringify(context || {}),
    taskId,
    projectId
  });
  
  // Store handoff context in memory
  remember({
    type: 'task_handoff',
    content: {
      from: fromAgentId,
      to: toAgentId,
      taskId,
      projectId,
      context
    },
    scope: 'task',
    scopeId: taskId,
    importance: 'high',
    source: 'agent-handoff'
  });
  
  return msg;
}

/**
 * Broadcast alert to all agents
 */
export function broadcastAlert({
  fromAgentId = null, subject = null, body = null, projectId = null,
  from = null, content = null, message = null
} = {}) {
  // A founder broadcast has no agent sender, and the dashboard's Broadcast button posts only
  // {content,type} — both left `fromAgentId` undefined and every sendMessage() threw, so the
  // broadcast silently produced nothing. Default the sender to the founder and accept the
  // same alternative body/content/message spellings as sendMessage.
  const sender = fromAgentId ?? from ?? 'founder';
  const text = body ?? content ?? message ?? '';
  const agents = store.list('agents');
  const messages = [];
  for (const agent of agents) {
    if (agent.id !== sender) {
      messages.push(sendMessage({
        fromAgentId: sender,
        toAgentId: agent.id,
        type: 'alert',
        subject,
        body: text,
        projectId
      }));
    }
  }
  return messages;
}

/**
 * Get collaboration stats for dashboard
 */
export function getCollaborationStats() {
  const messages = store.list('messages');
  const agents = store.list('agents');
  
  const stats = {
    totalMessages: messages.length,
    unread: messages.filter(m => m.status === 'unread').length,
    responded: messages.filter(m => m.status === 'responded').length,
    byType: {},
    byAgent: {}
  };
  
  for (const msg of messages) {
    stats.byType[msg.type] = (stats.byType[msg.type] || 0) + 1;
    stats.byAgent[msg.fromAgentId] = (stats.byAgent[msg.fromAgentId] || 0) + 1;
  }
  
  return stats;
}

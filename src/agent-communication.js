import { store } from './store.js';
import { id, now } from './core.js';
import { remember, recall } from './memory.js';

/**
 * Agent Communication System — enables agents to send messages,
 * request help, share context, and collaborate on tasks.
 */

/**
 * Send a message from one agent to another
 */
export function sendMessage({ fromAgentId, toAgentId, type = 'info', subject, body, taskId = null, projectId = null }) {
  if (!fromAgentId || !toAgentId) throw new Error('fromAgentId and toAgentId are required');
  
  const message = {
    id: id('msg'),
    fromAgentId,
    toAgentId,
    type, // info, request, review, handoff, alert, collaboration
    subject: subject || 'Untitled',
    body: body || '',
    taskId,
    projectId,
    status: 'unread', // unread, read, acknowledged, responded
    createdAt: now(),
    readAt: null,
    responseAt: null,
    response: null
  };
  
  store.put('messages', message);
  store.addEvent('agent.message_sent', {
    messageId: message.id,
    from: fromAgentId,
    to: toAgentId,
    type,
    subject: message.subject
  });
  
  // Also remember in agent memory for learning
  remember({
    type: 'agent_communication',
    content: { from: fromAgentId, to: toAgentId, subject, type },
    scope: 'agent',
    scopeId: fromAgentId,
    importance: type === 'alert' ? 'high' : 'normal',
    source: 'agent-communication'
  });
  
  return message;
}

/**
 * Read messages for an agent
 */
export function getMessages(agentId, { unread = false, limit = 20 } = {}) {
  let messages = store.list('messages').filter(m => m.toAgentId === agentId);
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
export function broadcastAlert({ fromAgentId, subject, body, projectId = null }) {
  const agents = store.list('agents');
  const messages = [];
  for (const agent of agents) {
    if (agent.id !== fromAgentId) {
      messages.push(sendMessage({
        fromAgentId,
        toAgentId: agent.id,
        type: 'alert',
        subject,
        body,
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

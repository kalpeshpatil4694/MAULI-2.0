// MAULI 2.0 — Notification System
// In-app notifications for tracking events and alerts

import { id, now } from './core.js';
import { store } from './store.js';

const MAX_NOTIFICATIONS = 200;
const MAX_PER_USER = 50;

/**
 * Notification types
 */
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  SYSTEM: 'system',
};

/**
 * Create a notification
 */
export function createNotification({ type = 'info', title, message, userId = 'founder', data = {}, priority = 'normal' }) {
  if (!title) throw new Error('Title is required');

  const notification = store.put('notifications', {
    id: id('notif'),
    type: NOTIFICATION_TYPES[type.toUpperCase()] || type,
    title,
    message: message || '',
    userId,
    data,
    priority,
    read: false,
    readAt: null,
    createdAt: now(),
  });

  // Enforce max notifications per user
  const userNotifs = store.list('notifications')
    .filter(n => n.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (userNotifs.length > MAX_PER_USER) {
    for (const old of userNotifs.slice(MAX_PER_USER)) {
      store.put('notifications', { ...old, archived: true, id: old.id });
    }
  }

  store.addEvent('notification.created', { notificationId: notification.id, type: notification.type });
  return notification;
}

/**
 * Get notifications for a user
 */
export function getNotifications(userId = 'founder', options = {}) {
  const { unreadOnly = false, limit = 50, type = null } = options;

  let notifications = store.list('notifications')
    .filter(n => n.userId === userId && !n.archived);

  if (unreadOnly) notifications = notifications.filter(n => !n.read);
  if (type) notifications = notifications.filter(n => n.type === type);

  return notifications
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

/**
 * Get unread count
 */
export function getUnreadCount(userId = 'founder') {
  return store.list('notifications')
    .filter(n => n.userId === userId && !n.read && !n.archived)
    .length;
}

/**
 * Mark notification as read
 */
export function markRead(notificationId) {
  const notif = store.get('notifications', notificationId);
  if (!notif) return null;
  return store.put('notifications', {
    ...notif,
    read: true,
    readAt: now(),
    id: notif.id,
  });
}

/**
 * Mark all notifications as read for a user
 */
export function markAllRead(userId = 'founder') {
  const updated = [];
  for (const notif of store.list('notifications')) {
    if (notif.userId === userId && !notif.read && !notif.archived) {
      store.put('notifications', { ...notif, read: true, readAt: now(), id: notif.id });
      updated.push(notif.id);
    }
  }
  return { marked: updated.length };
}

/**
 * Delete a notification
 */
export function deleteNotification(notificationId) {
  const notif = store.get('notifications', notificationId);
  if (!notif) return false;
  store.put('notifications', { ...notif, archived: true, id: notif.id });
  return true;
}

/**
 * Clear all notifications for a user
 */
export function clearAll(userId = 'founder') {
  let cleared = 0;
  for (const notif of store.list('notifications')) {
    if (notif.userId === userId && !notif.archived) {
      store.put('notifications', { ...notif, archived: true, id: notif.id });
      cleared++;
    }
  }
  return { cleared };
}

/**
 * Create common notifications
 */
export function notifyProjectCreated(project) {
  return createNotification({
    type: 'success',
    title: 'Project Created',
    message: `Project "${project.name || project.objective}" has been created.`,
    data: { projectId: project.id },
  });
}

export function notifyProjectCompleted(project) {
  return createNotification({
    type: 'success',
    title: 'Project Completed',
    message: `Project "${project.name || project.objective}" has been completed!`,
    data: { projectId: project.id },
  });
}

export function notifyTaskFailed(task, error) {
  return createNotification({
    type: 'error',
    title: 'Task Failed',
    message: `Task "${task.title}" failed: ${error || 'Unknown error'}`,
    data: { taskId: task.id, projectId: task.projectId },
  });
}

export function notifyApprovalRequired(approval) {
  return createNotification({
    type: 'warning',
    title: 'Approval Required',
    message: `Action requires approval: ${approval.action}`,
    priority: 'high',
    data: { approvalId: approval.id, projectId: approval.projectId },
  });
}

export function notifySystemAlert(message) {
  return createNotification({
    type: 'system',
    title: 'System Alert',
    message,
    priority: 'high',
  });
}

export function notifyBuildStarted(build) {
  return createNotification({
    type: 'info',
    title: 'Build Started',
    message: `Build ${build.id} started for project.`,
    data: { buildId: build.id, projectId: build.projectId },
  });
}

export function notifyBuildCompleted(build) {
  return createNotification({
    type: build.status === 'success' ? 'success' : 'error',
    title: 'Build ' + (build.status === 'success' ? 'Completed' : 'Failed'),
    message: `Build ${build.id} ${build.status}.`,
    data: { buildId: build.id, projectId: build.projectId },
  });
}

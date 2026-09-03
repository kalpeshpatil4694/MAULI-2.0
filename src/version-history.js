// MAULI 2.0 — Version History System
// Track changes to projects over time

import { id, now } from './core.js';
import { store } from './store.js';

const MAX_VERSIONS_PER_PROJECT = 50;
const MAX_CHANGES_PER_VERSION = 20;

/**
 * Create a version snapshot for a project
 */
export function createVersion(projectId, options = {}) {
  const project = store.get('projects', projectId);
  if (!project) return null;

  const { changeType = 'update', description = '', changedBy = 'founder' } = options;

  // Get current tasks and artifacts
  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const artifacts = store.list('artifacts').filter(a => a.projectId === projectId);

  const version = store.put('versions', {
    id: id('version'),
    projectId,
    versionNumber: getNextVersionNumber(projectId),
    changeType,
    description,
    changedBy,
    snapshot: {
      project: { ...project },
      taskCount: tasks.length,
      completedTasks: tasks.filter(t => t.state === 'completed').length,
      artifactCount: artifacts.length,
      state: project.state,
    },
    createdAt: now(),
  });

  // Enforce max versions per project
  const versions = store.list('versions')
    .filter(v => v.projectId === projectId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (versions.length > MAX_VERSIONS_PER_PROJECT) {
    for (const old of versions.slice(MAX_VERSIONS_PER_PROJECT)) {
      store.put('versions', { ...old, archived: true, id: old.id });
    }
  }

  store.addEvent('version.created', { versionId: version.id, projectId, versionNumber: version.versionNumber });
  return version;
}

/**
 * Get version history for a project
 */
export function getVersionHistory(projectId, limit = 20) {
  return store.list('versions')
    .filter(v => v.projectId === projectId && !v.archived)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

/**
 * Get a specific version
 */
export function getVersion(versionId) {
  return store.get('versions', versionId) ?? null;
}

/**
 * Compare two versions
 */
export function compareVersions(versionId1, versionId2) {
  const v1 = store.get('versions', versionId1);
  const v2 = store.get('versions', versionId2);
  if (!v1 || !v2) return null;

  const changes = [];

  // Compare project state
  if (v1.snapshot.state !== v2.snapshot.state) {
    changes.push({ field: 'state', from: v1.snapshot.state, to: v2.snapshot.state });
  }

  // Compare task counts
  if (v1.snapshot.taskCount !== v2.snapshot.taskCount) {
    changes.push({ field: 'taskCount', from: v1.snapshot.taskCount, to: v2.snapshot.taskCount });
  }

  // Compare completed tasks
  if (v1.snapshot.completedTasks !== v2.snapshot.completedTasks) {
    changes.push({ field: 'completedTasks', from: v1.snapshot.completedTasks, to: v2.snapshot.completedTasks });
  }

  // Compare artifact counts
  if (v1.snapshot.artifactCount !== v2.snapshot.artifactCount) {
    changes.push({ field: 'artifactCount', from: v1.snapshot.artifactCount, to: v2.snapshot.artifactCount });
  }

  // Compare project fields
  const projectFields = ['name', 'objective', 'priority'];
  for (const field of projectFields) {
    const val1 = v1.snapshot.project[field];
    const val2 = v2.snapshot.project[field];
    if (val1 !== val2) {
      changes.push({ field, from: val1, to: val2 });
    }
  }

  return {
    version1: v1,
    version2: v2,
    changes,
    hasChanges: changes.length > 0,
  };
}

/**
 * Restore a project to a specific version
 */
export function restoreVersion(versionId) {
  const version = store.get('versions', versionId);
  if (!version) return null;

  const project = store.get('projects', version.projectId);
  if (!project) return null;

  // Create a new version before restoring
  createVersion(version.projectId, {
    changeType: 'restore',
    description: `Restored to version ${version.versionNumber}`,
  });

  // Restore project state
  const restored = store.put('projects', {
    ...version.snapshot.project,
    restoredFromVersion: version.versionNumber,
    restoredAt: now(),
    id: project.id,
  });

  store.addEvent('version.restored', { versionId, projectId: version.projectId, versionNumber: version.versionNumber });
  return restored;
}

/**
 * Get next version number for a project
 */
function getNextVersionNumber(projectId) {
  const versions = store.list('versions')
    .filter(v => v.projectId === projectId)
    .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
  return (versions[0]?.versionNumber || 0) + 1;
}

/**
 * Track a specific change within a version
 */
export function trackChange(versionId, { field, oldValue, newValue, changeType = 'modified' }) {
  const version = store.get('versions', versionId);
  if (!version) return null;

  if (!version.changes) version.changes = [];
  if (version.changes.length >= MAX_CHANGES_PER_VERSION) return version;

  version.changes.push({
    id: id('change'),
    field,
    oldValue,
    newValue,
    changeType,
    timestamp: now(),
  });

  return store.put('versions', { ...version, id: version.id });
}

/**
 * Get version statistics
 */
export function getVersionStats(projectId) {
  const versions = store.list('versions').filter(v => v.projectId === projectId && !v.archived);
  const changeTypes = {};

  for (const v of versions) {
    const type = v.changeType || 'unknown';
    changeTypes[type] = (changeTypes[type] || 0) + 1;
  }

  return {
    totalVersions: versions.length,
    changeTypes,
    firstVersion: versions.length > 0 ? versions[versions.length - 1].createdAt : null,
    lastVersion: versions.length > 0 ? versions[0].createdAt : null,
  };
}

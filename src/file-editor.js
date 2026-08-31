import { id, now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

/**
 * File Editor — enables editing files through conversation.
 * Tracks all changes with diffs, supports undo, and maintains audit trail.
 */

/**
 * Edit a file with a specific change
 */
export function editFile({ projectId, filePath, operation, oldContent, newContent, description }) {
  const editId = id('edit');
  const timestamp = now();

  // Store the edit record
  const edit = {
    id: editId,
    projectId,
    filePath,
    operation, // 'replace', 'insert', 'delete', 'create'
    oldContent: oldContent || null,
    newContent: newContent || null,
    description: description || `Edit ${filePath}`,
    timestamp,
    status: 'applied',
    userId: 'founder'
  };

  store.put('file_edits', edit);
  store.addEvent('file.edit_applied', {
    editId,
    projectId,
    filePath,
    operation,
    description: description?.substring(0, 200)
  });

  // Remember the edit
  remember({
    type: 'technical_knowledge',
    content: {
      action: 'file_edit',
      filePath,
      operation,
      description,
      editId
    },
    scope: 'project',
    scopeId: projectId,
    importance: 'normal',
    source: 'file-editor'
  });

  return edit;
}

/**
 * Get edit history for a project
 */
export function getEditHistory(projectId, { limit = 50 } = {}) {
  return store.list('file_edits')
    .filter(e => e.projectId === projectId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
}

/**
 * Get all recent edits
 */
export function getRecentEdits({ limit = 20 } = {}) {
  return store.list('file_edits')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
}

/**
 * Undo an edit
 */
export function undoEdit(editId) {
  const edit = store.get('file_edits', editId);
  if (!edit) return { error: 'Edit not found' };
  if (edit.status === 'undone') return { error: 'Edit already undone' };

  const undone = store.put('file_edits', {
    ...edit,
    status: 'undone',
    undoneAt: now(),
    id: editId
  });

  store.addEvent('file.edit_undone', { editId, filePath: edit.filePath });

  return undone;
}

/**
 * Get file change summary
 */
export function getFileChangeSummary(projectId) {
  const edits = store.list('file_edits').filter(e => e.projectId === projectId);
  const files = {};
  for (const edit of edits) {
    if (!files[edit.filePath]) {
      files[edit.filePath] = { edits: 0, operations: new Set(), lastEdit: null };
    }
    files[edit.filePath].edits++;
    files[edit.filePath].operations.add(edit.operation);
    if (!files[edit.filePath].lastEdit || edit.timestamp > files[edit.filePath].lastEdit) {
      files[edit.filePath].lastEdit = edit.timestamp;
    }
  }

  return Object.entries(files).map(([path, info]) => ({
    path,
    edits: info.edits,
    operations: [...info.operations],
    lastEdit: info.lastEdit
  }));
}

/**
 * Generate a diff summary
 */
export function generateDiffSummary(edit) {
  if (!edit.oldContent || !edit.newContent) return null;

  const oldLines = edit.oldContent.split('\n');
  const newLines = edit.newContent.split('\n');

  let added = 0;
  let removed = 0;
  const changes = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldLines.length) {
      added++;
      changes.push({ type: 'add', line: i + 1, content: newLines[i] });
    } else if (i >= newLines.length) {
      removed++;
      changes.push({ type: 'remove', line: i + 1, content: oldLines[i] });
    } else if (oldLines[i] !== newLines[i]) {
      removed++;
      added++;
      changes.push({ type: 'change', line: i + 1, old: oldLines[i], new: newLines[i] });
    }
  }

  return { added, removed, changes: changes.slice(0, 50) };
}

/**
 * Parse a chat command into file edit operations
 */
export function parseEditCommand(text) {
  const lower = text.toLowerCase();

  // "Edit [file] to [description]"
  const editMatch = text.match(/(?:edit|change|modify|update)\s+(?:the\s+)?(?:file\s+)?([^\s]+(?:\.\w+)?)\s+(?:to|so|by|with)\s+(.+)/i);
  if (editMatch) {
    return {
      operation: 'replace',
      filePath: editMatch[1],
      description: editMatch[2],
      parseConfidence: 'high'
    };
  }

  // "Add [something] to [file]"
  const addMatch = text.match(/(?:add|insert|append)\s+(.+?)\s+(?:to|in|into)\s+([^\s]+(?:\.\w+)?)/i);
  if (addMatch) {
    return {
      operation: 'insert',
      filePath: addMatch[2],
      description: addMatch[1],
      parseConfidence: 'medium'
    };
  }

  // "Fix [file]"
  const fixMatch = text.match(/(?:fix|repair|debug)\s+(?:the\s+)?(?:file\s+)?([^\s]+(?:\.\w+)?)/i);
  if (fixMatch) {
    return {
      operation: 'replace',
      filePath: fixMatch[1],
      description: text,
      parseConfidence: 'medium'
    };
  }

  return null;
}

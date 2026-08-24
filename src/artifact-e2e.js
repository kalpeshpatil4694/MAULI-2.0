import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact, listProjectArtifacts } from './artifacts.js';

const ARTIFACT_LINE = /(?:file|artifact file)\s+(?:named\s+)?([A-Za-z0-9._/-]+)\s+containing\s+exactly\s+["“]([^"”]+)["”]/i;
const ARTIFACT_LINE_ALL = /(?:file|artifact file)\s+(?:named\s+)?([A-Za-z0-9._/-]+)\s+containing\s+exactly\s+["“]([^"”]+)["”]/gi;

function cleanPath(value) {
  const path = String(value ?? '').trim().replace(/^\/+/, '');
  if (!path || path.includes('..') || /[\\\0]/.test(path)) throw new Error(`Unsafe artifact path: ${path}`);
  return path;
}

export function parseArtifactE2ECommand(command) {
  const text = String(command ?? '');
  if (!/artifact|real artifact|artifact file|output\.txt/i.test(text)) return null;
  const matches = [...text.matchAll(ARTIFACT_LINE_ALL)].map(match => ({ path: cleanPath(match[1]), content: match[2] }));
  if (matches.length < 1) return null;
  const unique = [];
  for (const item of matches) if (!unique.some(x => x.path === item.path)) unique.push(item);
  if (unique.length < 3) return null;
  const steps = unique.slice(0, 3);
  return steps.map((artifact, index) => ({
    title: `Task ${index + 1}`,
    artifact,
    verifyBefore: steps.slice(0, index),
    sequence: index + 1,
    dependsOnIndex: index - 1
  }));
}

export function buildArtifactE2EPlan(command) {
  const steps = parseArtifactE2ECommand(command);
  if (!steps) return null;
  return {
    objective: String(command).trim(),
    requirements: steps.flatMap(step => [`Create ${step.artifact.path} with exact content`, `Verify ${step.artifact.path} exists with exact content`]),
    capabilities: ['artifact-e2e', 'testing', 'verification'],
    risks: ['Deterministic test-artifact execution; no arbitrary code execution'],
    acceptanceCriteria: ['All artifact files exist', 'All artifact contents match exactly', 'Tasks execute in strict dependency order'],
    artifactSteps: steps
  };
}

function exactFilesForProject(projectId) {
  const files = new Map();
  for (const artifact of listProjectArtifacts(projectId)) {
    for (const file of artifact?.content?.files ?? []) {
      if (typeof file?.path === 'string' && typeof file?.content === 'string') files.set(file.path, file.content);
    }
  }
  return files;
}

export async function executeArtifactTask({ task }) {
  const spec = task?.artifactSpec;
  if (!spec?.artifact?.path) throw new Error('Artifact task specification is missing');
  const existing = exactFilesForProject(task.projectId);
  const prerequisiteChecks = (spec.verifyBefore ?? []).map(expected => ({
    path: expected.path,
    expected: expected.content,
    actual: existing.get(expected.path),
    passed: existing.get(expected.path) === expected.content
  }));
  if (prerequisiteChecks.some(check => !check.passed)) {
    return {
      type: 'artifact',
      artifactVerification: { passed: false, phase: 'prerequisite', checks: prerequisiteChecks },
      files: []
    };
  }

  const file = { path: cleanPath(spec.artifact.path), content: String(spec.artifact.content) };
  const artifact = registerArtifact({
    projectId: task.projectId,
    taskId: task.id,
    agentId: task.agentId ?? task.assignedAgentId ?? null,
    type: 'test-artifact',
    content: { summary: `Real test artifact ${file.path}`, files: [file], createdAt: now() },
    metadata: { generatedBy: 'internal.artifact-e2e', exactContent: true }
  });
  const stored = listProjectArtifacts(task.projectId).flatMap(item => item?.content?.files ?? []);
  const actual = stored.find(item => item.path === file.path)?.content;
  const verification = {
    passed: actual === file.content,
    phase: 'created-artifact',
    checks: [{ path: file.path, expected: file.content, actual, passed: actual === file.content }]
  };
  store.addEvent('artifact.verified', { projectId: task.projectId, taskId: task.id, artifactId: artifact.id, verification });
  return { type: 'artifact', artifactId: artifact.id, files: [file], artifactVerification: verification, summary: verification.passed ? `Created and verified ${file.path}.` : `Artifact verification failed for ${file.path}.` };
}

import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';
import { checkDeliveryContract, detectDeliveryType } from './delivery-contract.js';

const MOBILE_CONFIG = /(^|\/)(androidmanifest\.xml|build\.gradle|settings\.gradle|pubspec\.yaml|app\.json|app\.config\.(js|ts)|package\.json)$/i;
const MOBILE_SOURCE = /^(android|ios)\//i;

function filesOf(artifact) { return Array.isArray(artifact?.content?.files) ? artifact.content.files : []; }
function projectFiles(artifacts) { return artifacts.flatMap(filesOf); }
function checksum(value) { let hash = 2166136261; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }

export function validateArtifactPackage({ project, artifacts = [] }) {
  if (!project?.id) throw new Error('project is required');
  const files = projectFiles(artifacts);
  const contract = checkDeliveryContract(project.founderCommand ?? project.objective ?? '', files);
  const paths = new Set();
  const integrity = files.every(file => {
    if (!file?.path || typeof file.content !== 'string' || paths.has(file.path)) return false;
    paths.add(file.path); return true;
  });
  const requestedType = detectDeliveryType(project.founderCommand ?? project.objective ?? '');
  const mobileEvidence = files.some(file => MOBILE_CONFIG.test(String(file.path ?? '')) || MOBILE_SOURCE.test(String(file.path ?? '')));
  const hasPackageEvidence = requestedType !== 'mobile-app' || mobileEvidence;
  return { requestedType, passed: contract.passed && integrity && hasPackageEvidence, contract, integrity, hasPackageEvidence, fileCount: files.length };
}

export function createDeliveryManifest({ project, artifacts = [], version = '1.0.0' }) {
  const validation = validateArtifactPackage({ project, artifacts });
  if (!validation.passed) throw new Error('Artifact delivery blocked: package validation failed');
  const files = projectFiles(artifacts).map(file => ({ path: file.path, size: String(file.content).length, checksum: checksum(`${file.path}\n${file.content}`) }));
  return { schemaVersion: '2.0', projectId: project.id, version, requestedType: validation.requestedType, generatedAt: now(), fileCount: files.length, files, validation: { integrity: true, deliveryContract: true } };
}

export function buildArtifactDelivery({ project, artifacts = [], version = '1.0.0' }) {
  const manifest = createDeliveryManifest({ project, artifacts, version });
  const delivery = { projectId: project.id, version, requestedType: manifest.requestedType, manifest, artifacts: artifacts.map(artifact => ({ id: artifact.id, type: artifact.type, taskId: artifact.taskId ?? null, metadata: artifact.metadata ?? {}, files: filesOf(artifact) })) };
  return registerArtifact({ projectId: project.id, taskId: null, agentId: null, type: 'delivery-package', content: delivery, metadata: { version, requestedType: manifest.requestedType, integrityVerified: true, deliveryContractPassed: true, generatedAt: now() } });
}

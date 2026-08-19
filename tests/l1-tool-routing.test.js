import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, selectTools } from '../src/tools.js';

test('L1 tool routing selects tools by capability', () => {
  const codeTool = registerTool({
    name: 'test-code-tool',
    description: 'isolated coding tool',
    capabilities: ['coding', 'testing'],
    scope: 'internal',
    risk: 'low'
  });
  const webTool = registerTool({
    name: 'test-web-tool',
    description: 'research web tool',
    capabilities: ['research'],
    scope: 'external',
    risk: 'medium'
  });

  const coding = selectTools(['coding']);
  assert.ok(coding.some(tool => tool.name === codeTool.name));
  assert.ok(!coding.some(tool => tool.name === webTool.name));
});

test('L1 tool routing filters disabled tools', () => {
  const disabled = registerTool({
    name: 'test-disabled-tool',
    description: 'disabled tool',
    capabilities: ['coding'],
    scope: 'internal',
    risk: 'low',
    enabled: false
  });

  const selected = selectTools(['coding']);
  assert.ok(!selected.some(tool => tool.name === disabled.name));
});

test('L1 tool routing can enforce scope and risk policy', () => {
  const external = registerTool({
    name: 'test-high-risk-external',
    description: 'high risk external tool',
    capabilities: ['deployment'],
    scope: 'external',
    risk: 'high'
  });

  const safe = selectTools(['deployment'], { allowedScopes: ['internal'], maxRisk: 'medium' });
  assert.ok(!safe.some(tool => tool.name === external.name));
});

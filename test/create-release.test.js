import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'ava';
import { MockAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';
import { Octokit } from 'octokit';
import { run } from '../scripts/create-release.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create a mock core object for testing
function createMockCore() {
  const logs = [];
  const outputs = new Map();
  let failed = false;
  let failMessage = '';

  return {
    info: (message) => logs.push({ level: 'info', message }),
    warning: (message) => logs.push({ level: 'warning', message }),
    error: (message) => logs.push({ level: 'error', message }),
    setOutput: (name, value) => outputs.set(name, value),
    setFailed: (message) => {
      failed = true;
      failMessage = message;
      logs.push({ level: 'error', message });
    },
    getLogs: () => logs,
    getOutputs: () => outputs,
    isFailed: () => failed,
    getFailMessage: () => failMessage,
  };
}

// Helper to load fixture
function loadFixture(filename) {
  const filePath = join(__dirname, 'fixtures', filename);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test.beforeEach(t => {
  // Create a new MockAgent for each test
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  
  t.context.mockAgent = mockAgent;
});

test.afterEach(t => {
  // Clean up
  t.context.mockAgent.close();
});

// Helper to setup standard mocks
function setupMocks(t, existingTags = []) {
  // Ensure global dispatcher is set for this test
  setGlobalDispatcher(t.context.mockAgent);
  
  const mockPool = t.context.mockAgent.get('https://api.github.com');
  
  // Mock tags endpoint - ensure it returns an array
  mockPool
    .intercept({ path: '/repos/gr2m/ai-provider-api-changes/tags?per_page=100', method: 'GET' })
    .reply(200, Array.isArray(existingTags) ? existingTags : [])
    .persist(); // Make this intercept reusable
  
  // Mock tag creation
  mockPool
    .intercept({ path: '/repos/gr2m/ai-provider-api-changes/git/refs', method: 'POST' })
    .reply(201, { ref: 'refs/tags/test', sha: 'abc123' });
  
  // Mock release creation
  mockPool
    .intercept({ path: '/repos/gr2m/ai-provider-api-changes/releases', method: 'POST' })
    .reply(201, {
      id: 123456,
      tag_name: 'test@1.0.0',
      name: 'test@1.0.0',
      html_url: 'https://github.com/gr2m/ai-provider-api-changes/releases/tag/test@1.0.0',
      body: 'Test release body',
      draft: false,
      prerelease: false,
    });
}

test('creates first release for feature PR', async t => {
  const event = loadFixture('pr-merged-feature.json');
  const core = createMockCore();
  
  setupMocks(t, []); // No existing tags
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
});

test('creates breaking change release with version bump', async t => {
  const event = loadFixture('pr-merged-breaking.json');
  const core = createMockCore();
  
  setupMocks(t, [
    { name: 'openai@1.2.3', commit: { sha: 'old-sha' } },
    { name: 'anthropic@0.1.0', commit: { sha: 'other-sha' } },
  ]);
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
});

test('creates fix release with patch version bump', async t => {
  const event = loadFixture('pr-merged-fix.json');
  const core = createMockCore();
  
  setupMocks(t, [
    { name: 'openai@1.2.3', commit: { sha: 'old-sha' } },
    { name: 'openai@1.2.2', commit: { sha: 'older-sha' } },
  ]);
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
});

test('skips release for non-merged PR', async t => {
  const event = loadFixture('pr-not-merged.json');
  const core = createMockCore();
  
  // No need to setup mocks since we exit early
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
  
  // Should only log about processing and skipping
  t.is(logs.length, 2);
  t.is(logs[1].message, 'Pull request is not merged, skipping release creation');
});

test('skips release for PR without required labels', async t => {
  const event = loadFixture('pr-no-labels.json');
  const core = createMockCore();
  
  // No need to setup mocks since we exit early
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
  
  // Should log about missing provider label
  const providerLabelLog = logs.find(log => log.message === 'No provider label found, skipping release creation');
  t.truthy(providerLabelLog);
});

test('creates release for different provider (anthropic)', async t => {
  const event = loadFixture('pr-anthropic-feature.json');
  const core = createMockCore();
  
  setupMocks(t, [
    { name: 'openai@1.2.3', commit: { sha: 'openai-sha' } },
  ]);
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
  
  // Verify it correctly identified anthropic provider
  const providerLog = logs.find(log => log.message.includes('Provider: anthropic'));
  t.truthy(providerLog);
});

test('handles feature version bump correctly', async t => {
  const event = loadFixture('pr-merged-feature.json');
  const core = createMockCore();
  
  setupMocks(t, [
    { name: 'openai@2.1.0', commit: { sha: 'latest-sha' } },
    { name: 'openai@2.0.3', commit: { sha: 'older-sha' } },
    { name: 'openai@1.5.2', commit: { sha: 'old-sha' } },
    { name: 'anthropic@0.1.0', commit: { sha: 'other-provider' } },
  ]);
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs contain the correct version calculation
  const logs = core.getLogs();
  const createTagLog = logs.find(log => log.message.includes('Creating new tag: openai@2.2.0'));
  t.truthy(createTagLog, 'Should create tag with correct minor version bump');
  
  t.snapshot(logs);
});

test('handles edge case version parsing', async t => {
  const event = loadFixture('pr-merged-fix.json');
  const core = createMockCore();
  
  setupMocks(t, [
    { name: 'openai@1.0', commit: { sha: 'incomplete-version' } }, // Missing patch
    { name: 'openai@1', commit: { sha: 'very-incomplete' } }, // Missing minor and patch
  ]);
  
  const octokit = new Octokit({ 
    auth: 'test-token',
    request: {
      fetch: undiciFetch
    }
  });
  
  await run(event, core, octokit);
  
  // Verify no failure
  t.false(core.isFailed());
  
  // Verify logs
  const logs = core.getLogs();
  t.snapshot(logs);
});
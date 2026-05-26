import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');
export const MANIFEST_PATH = join(WORKFLOWS_DIR, 'manifest.json');

export function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--')) {
      const eq = raw.indexOf('=');
      if (eq >= 0) args[raw.slice(2, eq)] = raw.slice(eq + 1);
      else args[raw.slice(2)] = true;
    } else args._.push(raw);
  }
  return args;
}

export function resolveTarget(args) {
  const url = args.url || process.env.N8N_URL;
  const apiKey = args['api-key'] || process.env.N8N_API_KEY;
  if (!url || !apiKey) {
    console.error('Missing --url / --api-key (or N8N_URL / N8N_API_KEY env vars).');
    process.exit(2);
  }
  return { url: url.replace(/\/$/, ''), apiKey };
}

export class N8n {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async req(method, path, body) {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'X-N8N-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 800)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  // Cloud Run cold-starts return "n8n is starting up. Please wait" with HTTP 200
  // for ~10-20s; poll a cheap endpoint until it answers with real JSON.
  async waitForReady({ timeoutMs = 180000, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastReason = 'no response yet';
    while (Date.now() < deadline) {
      let res;
      try {
        res = await fetch(`${this.baseUrl}/api/v1/workflows?limit=1`, {
          headers: { 'X-N8N-API-KEY': this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
      } catch (e) {
        lastReason = `fetch failed: ${e.message}`;
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        try {
          JSON.parse(text);
          return;
        } catch {
          lastReason = `200 with non-JSON body "${text.slice(0, 60).replace(/\s+/g, ' ').trim()}"`;
        }
      } else if (res.status === 401 || res.status === 403) {
        throw new Error(`n8n ${res.status} during readiness probe: ${text.slice(0, 400)}`);
      } else {
        // 404 during boot (API route not mounted yet), 5xx, anything else: keep polling.
        lastReason = `${res.status}: ${text.slice(0, 60).replace(/\s+/g, ' ').trim()}`;
      }
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`n8n not ready after ${timeoutMs}ms (last: ${lastReason})`);
  }

  async listWorkflows() {
    const out = [];
    let cursor;
    do {
      const q = new URLSearchParams({ limit: '100' });
      if (cursor) q.set('cursor', cursor);
      const page = await this.req('GET', `/workflows?${q}`);
      out.push(...(page.data || []));
      cursor = page.nextCursor || null;
    } while (cursor);
    return out;
  }

  getWorkflow(id) {
    return this.req('GET', `/workflows/${id}`);
  }

  createWorkflow(body) {
    return this.req('POST', '/workflows', body);
  }

  updateWorkflow(id, body) {
    return this.req('PUT', `/workflows/${id}`, body);
  }

  listCredentials() {
    return this.req('GET', '/credentials').then((r) => r.data || []);
  }

  activateWorkflow(id) {
    return this.req('POST', `/workflows/${id}/activate`);
  }
}

// n8n PUT/POST workflow body accepts only these top-level fields.
const ACCEPTED_TOP_LEVEL = ['name', 'nodes', 'connections', 'settings'];

// n8n public-API workflow settings whitelist. Newer versions reject unknown keys;
// the export carries UI-only fields (binaryMode, callerPolicy, availableInMCP, …) that must be stripped.
const ACCEPTED_SETTINGS = [
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'executionOrder',
];

function stripNodeRuntime(node) {
  const n = { ...node };
  delete n.issues;
  return n;
}

// Build the API-ready body. Rebinds credentials by name (fails loudly if missing).
// errorWorkflowId: undefined -> strip errorWorkflow entirely; null -> strip; string -> set.
export function normalizeForApi(
  workflow,
  { credentialNameToId, errorWorkflowId, sourceFile } = {},
) {
  const out = {};
  for (const k of ACCEPTED_TOP_LEVEL) {
    if (k in workflow) out[k] = workflow[k];
  }

  out.nodes = (out.nodes || []).map((node) => {
    const n = stripNodeRuntime(node);
    if (n.credentials && credentialNameToId) {
      const rebound = {};
      for (const [type, ref] of Object.entries(n.credentials)) {
        const id = credentialNameToId[ref.name];
        if (!id) {
          const where = sourceFile ? ` in ${sourceFile}` : '';
          throw new Error(
            `Credential "${ref.name}" (type ${type}, used by node "${n.name}"${where}) ` +
              `not found on target. Create it in the n8n UI with that exact name.`,
          );
        }
        rebound[type] = { id, name: ref.name };
      }
      n.credentials = rebound;
    }
    return n;
  });

  const rawSettings = { ...(out.settings || {}) };
  const s = {};
  for (const k of ACCEPTED_SETTINGS) {
    if (k in rawSettings) s[k] = rawSettings[k];
  }
  delete s.errorWorkflow;
  if (errorWorkflowId !== undefined && errorWorkflowId !== null) {
    s.errorWorkflow = errorWorkflowId;
  }
  out.settings = s;

  return out;
}

// Build the repo-ready body. Strips per-instance ids; rewrites errorWorkflow id -> name.
export function normalizeForRepo(workflow, { workflowIdToName }) {
  const out = {
    name: workflow.name,
    nodes: (workflow.nodes || []).map((node) => {
      const n = stripNodeRuntime(node);
      if (n.credentials) {
        const rebound = {};
        for (const [type, ref] of Object.entries(n.credentials)) {
          rebound[type] = { name: ref.name };
        }
        n.credentials = rebound;
      }
      return n;
    }),
    connections: workflow.connections || {},
    settings: { ...(workflow.settings || {}) },
  };
  if (out.settings.errorWorkflow) {
    const name = workflowIdToName?.[out.settings.errorWorkflow];
    if (!name) {
      throw new Error(
        `Workflow "${workflow.name}" references error workflow ${out.settings.errorWorkflow} that wasn't in the listing.`,
      );
    }
    delete out.settings.errorWorkflow;
    out.settings.errorWorkflowName = name;
  }
  return out;
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  }
  return v;
}

export function stableStringify(v) {
  return JSON.stringify(canonical(v));
}

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

export function readWorkflowFile(file) {
  return JSON.parse(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'));
}

export function writeWorkflowFile(file, body) {
  writeFileSync(join(WORKFLOWS_DIR, file), JSON.stringify(body, null, 2) + '\n');
}

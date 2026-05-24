#!/usr/bin/env node
// Pull workflows from a target n8n instance into workflows/*.json.
// Usage: node scripts/export.mjs --url=https://... --api-key=...
//        (or N8N_URL / N8N_API_KEY env vars)

import {
  parseArgs,
  resolveTarget,
  N8n,
  normalizeForRepo,
  readManifest,
  writeWorkflowFile,
} from './lib.mjs';

const args = parseArgs(process.argv);
const { url, apiKey } = resolveTarget(args);
const manifest = readManifest();
const n8n = new N8n(url, apiKey);

console.log(`<- ${url}\n`);

const all = await n8n.listWorkflows();
const byName = new Map(all.map((w) => [w.name, w]));
const idToName = Object.fromEntries(all.map((w) => [w.id, w.name]));

let exported = 0;
for (const entry of manifest.workflows) {
  const meta = byName.get(entry.name);
  if (!meta) {
    console.log(`- ${entry.file}: "${entry.name}" not found on target — skipping`);
    continue;
  }
  const full = await n8n.getWorkflow(meta.id);
  const body = normalizeForRepo(full, { workflowIdToName: idToName });
  writeWorkflowFile(entry.file, body);
  console.log(`+ ${entry.file}`);
  exported++;
}

console.log(`\n${exported}/${manifest.workflows.length} workflows exported.`);

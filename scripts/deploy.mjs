#!/usr/bin/env node
// Push workflows/*.json to a target n8n instance.
// Usage: node scripts/deploy.mjs --url=https://... --api-key=... [--dry-run] [--activate-on-create]

import {
  parseArgs,
  resolveTarget,
  N8n,
  normalizeForApi,
  readManifest,
  readWorkflowFile,
  stableStringify,
} from './lib.mjs';

const args = parseArgs(process.argv);
const { url, apiKey } = resolveTarget(args);
const dryRun = !!args['dry-run'];
const activateOnCreate = !!args['activate-on-create'];
const n8n = new N8n(url, apiKey);
const manifest = readManifest();

console.log(`-> ${url}${dryRun ? '  (dry-run)' : ''}\n`);

process.stdout.write('  waiting for n8n to be ready... ');
await n8n.waitForReady();
console.log('ready');

const credList = await n8n.listCredentials();
const credByName = Object.fromEntries(credList.map((c) => [c.name, c.id]));
const allWorkflows = await n8n.listWorkflows();
const wfByName = new Map(allWorkflows.map((w) => [w.name, w]));
console.log(`  credentials: ${credList.length}, workflows: ${allWorkflows.length}\n`);

// --- Pass 1: upsert every manifest workflow without errorWorkflow ----------
const pass1 = [];
for (const entry of manifest.workflows) {
  const source = readWorkflowFile(entry.file);
  if (source.name !== entry.name) {
    throw new Error(`${entry.file}: name "${source.name}" doesn't match manifest "${entry.name}"`);
  }

  const body = normalizeForApi(source, { credentialNameToId: credByName });
  const existing = wfByName.get(entry.name);

  if (existing) {
    const current = await n8n.getWorkflow(existing.id);
    const currentBody = normalizeForApi(current, { credentialNameToId: credByName });
    if (stableStringify(currentBody) === stableStringify(body)) {
      console.log(`= ${entry.file}: no change`);
      pass1.push({ entry, id: existing.id, source });
      continue;
    }
    if (dryRun) {
      console.log(`~ ${entry.file}: would update (id ${existing.id})`);
    } else {
      await n8n.updateWorkflow(existing.id, body);
      console.log(`~ ${entry.file}: updated`);
    }
    pass1.push({ entry, id: existing.id, source });
  } else {
    if (dryRun) {
      console.log(`+ ${entry.file}: would create`);
      pass1.push({ entry, id: null, source });
    } else {
      const created = await n8n.createWorkflow(body);
      console.log(`+ ${entry.file}: created (id ${created.id})`);
      pass1.push({ entry, id: created.id, source });
      wfByName.set(entry.name, { id: created.id, name: entry.name });
      if (activateOnCreate) {
        await n8n.activateWorkflow(created.id);
        console.log(`  ` + `^ activated`);
      }
    }
  }
}

// --- Pass 2: bind errorWorkflow by name -----------------------------------
const errorRefs = pass1.filter((r) => r.source.settings?.errorWorkflowName);
if (errorRefs.length === 0) {
  console.log('\n(no error-workflow references to bind)');
} else {
  console.log('\nerror-workflow binding:');
  for (const r of errorRefs) {
    const targetName = r.source.settings.errorWorkflowName;
    const target = wfByName.get(targetName);
    if (!target) {
      throw new Error(
        `${r.entry.file} references error workflow "${targetName}" which isn't on target.`,
      );
    }
    const body = normalizeForApi(r.source, {
      credentialNameToId: credByName,
      errorWorkflowId: target.id,
    });
    if (r.id) {
      const current = await n8n.getWorkflow(r.id);
      const currentBody = normalizeForApi(current, {
        credentialNameToId: credByName,
        errorWorkflowId: target.id,
      });
      if (stableStringify(currentBody) === stableStringify(body)) {
        console.log(`= ${r.entry.file}: errorWorkflow already set (${target.id})`);
        continue;
      }
    }
    if (dryRun) {
      console.log(`~ ${r.entry.file}: would set errorWorkflow -> ${target.id} (${targetName})`);
    } else {
      await n8n.updateWorkflow(r.id, body);
      console.log(`~ ${r.entry.file}: errorWorkflow -> ${target.id} (${targetName})`);
    }
  }
}

console.log(dryRun ? '\nDry run complete.' : '\nDeploy complete.');

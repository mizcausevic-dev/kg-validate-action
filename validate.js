#!/usr/bin/env node
/**
 * kg-validate — validate JSON files against Kinetic Gain Protocol Suite specs.
 *
 * Usage:
 *   node validate.js "<glob>"
 *
 * Auto-detects which spec each input file belongs to via its top-level
 * version field, then validates against the corresponding bundled JSON Schema.
 *
 * Exit codes:
 *   0  — every file matched a known spec and passed validation
 *   1  — at least one file failed validation
 *   2  — at least one file did not match any known spec (no version field
 *        or unrecognized version field)
 *   3  — usage / configuration error
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fg from 'fast-glob';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Discriminator: version field name -> spec metadata.
// Order matters only for human-friendly output; lookup is by name.
const SPECS = [
  { key: 'aeo',                versionField: 'aeo_version',                  schemaFile: 'aeo.schema.json',                  displayName: 'AEO Protocol' },
  { key: 'prompt-provenance',  versionField: 'provenance_version',           schemaFile: 'provenance.schema.json',           displayName: 'Prompt Provenance' },
  { key: 'agent-card',         versionField: 'agent_card_version',           schemaFile: 'agent-card.schema.json',           displayName: 'Agent Card' },
  { key: 'ai-evidence',        versionField: 'evidence_version',             schemaFile: 'evidence.schema.json',             displayName: 'AI Evidence Format' },
  { key: 'tool-card',          versionField: 'tool_card_version',            schemaFile: 'tool-card.schema.json',            displayName: 'MCP Tool Card' },
  { key: 'tutor-card',         versionField: 'tutor_card_version',           schemaFile: 'tutor-card.schema.json',           displayName: 'AI Tutor Card' },
  { key: 'student-disclosure', versionField: 'disclosure_version',           schemaFile: 'student-ai-disclosure.schema.json', displayName: 'Student AI Disclosure' },
  { key: 'classroom-aup',      versionField: 'aup_version',                  schemaFile: 'aup.schema.json',                  displayName: 'Classroom AI AUP' },
  { key: 'clinical-ai',        versionField: 'clinical_ai_card_version',     schemaFile: 'clinical-ai-card.schema.json',     displayName: 'Clinical AI Card' },
  { key: 'ai-incident',        versionField: 'incident_card_version',        schemaFile: 'incident-card.schema.json',        displayName: 'AI Incident Card' },
  { key: 'decision-card',      versionField: 'decision_card_version',        schemaFile: 'decision-card.schema.json',        displayName: 'AI Procurement Decision Card' },
];

function detectSpec(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  for (const spec of SPECS) {
    if (Object.prototype.hasOwnProperty.call(doc, spec.versionField)) {
      return spec;
    }
  }
  return null;
}

const validatorCache = new Map();

async function getValidator(spec, ajv) {
  if (validatorCache.has(spec.key)) {
    return validatorCache.get(spec.key);
  }
  const path = resolvePath(__dirname, 'schemas', spec.schemaFile);
  const raw = await readFile(path, 'utf8');
  const schema = JSON.parse(raw);
  const validate = ajv.compile(schema);
  validatorCache.set(spec.key, validate);
  return validate;
}

function isGitHubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

function annotate(level, message, file, line) {
  if (!isGitHubActions()) return;
  // Workflow command syntax — surfaces as a PR annotation.
  const fields = [];
  if (file) fields.push(`file=${file}`);
  if (line != null) fields.push(`line=${line}`);
  process.stdout.write(`::${level} ${fields.join(',')}::${message}\n`);
}

async function validateFile(filePath, ajv) {
  let doc;
  try {
    const raw = await readFile(filePath, 'utf8');
    doc = JSON.parse(raw);
  } catch (err) {
    annotate('error', `Could not parse JSON: ${err.message}`, filePath);
    return { file: filePath, status: 'parse-error', error: err.message };
  }

  const spec = detectSpec(doc);
  if (!spec) {
    annotate(
      'warning',
      'No recognized Kinetic Gain Protocol Suite version field found at the top level. Skipping.',
      filePath,
    );
    return { file: filePath, status: 'unrecognized' };
  }

  let validate;
  try {
    validate = await getValidator(spec, ajv);
  } catch (err) {
    annotate('error', `Could not load bundled schema for ${spec.displayName}: ${err.message}`, filePath);
    return { file: filePath, status: 'config-error', spec, error: err.message };
  }

  const ok = validate(doc);
  if (ok) {
    return { file: filePath, status: 'pass', spec };
  }

  const errors = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || '(root)',
    keyword: e.keyword,
    message: e.message ?? 'invalid',
    params: e.params,
  }));
  for (const e of errors) {
    annotate('error', `${spec.displayName}: ${e.path} ${e.message}`, filePath);
  }
  return { file: filePath, status: 'fail', spec, errors };
}

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    process.stderr.write('Usage: validate.js "<glob>"\n');
    process.exit(3);
  }

  const files = await fg(pattern, {
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
  });

  if (files.length === 0) {
    process.stdout.write(`kg-validate: no files matched pattern "${pattern}"\n`);
    process.exit(0);
  }

  process.stdout.write(`kg-validate: ${files.length} file(s) matched "${pattern}"\n\n`);

  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  const results = [];
  for (const file of files) {
    const result = await validateFile(file, ajv);
    results.push(result);

    const tag =
      result.status === 'pass'         ? 'PASS' :
      result.status === 'fail'         ? 'FAIL' :
      result.status === 'unrecognized' ? 'SKIP' :
      result.status === 'parse-error'  ? 'PARSE-ERROR' :
                                          'CONFIG-ERROR';
    const specLabel = result.spec ? ` [${result.spec.displayName}]` : '';
    process.stdout.write(`  ${tag.padEnd(13)} ${result.file}${specLabel}\n`);

    if (result.status === 'fail') {
      for (const e of result.errors) {
        process.stdout.write(`      ${e.path} ${e.message}\n`);
      }
    } else if (result.status === 'parse-error') {
      process.stdout.write(`      ${result.error}\n`);
    }
  }

  // Summary
  const counts = {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    unrecognized: results.filter((r) => r.status === 'unrecognized').length,
    parseError: results.filter((r) => r.status === 'parse-error').length,
    configError: results.filter((r) => r.status === 'config-error').length,
  };

  process.stdout.write(`\nkg-validate summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.unrecognized} skipped (no recognized version field), ${counts.parseError} parse error, ${counts.configError} config error\n`);

  if (counts.fail > 0 || counts.parseError > 0 || counts.configError > 0) {
    process.exit(1);
  }
  if (counts.unrecognized > 0 && counts.pass === 0) {
    // Nothing was actually validated as a Suite document.
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`kg-validate: fatal: ${err.stack ?? err.message ?? err}\n`);
  process.exit(3);
});

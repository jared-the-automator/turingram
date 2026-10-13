#!/usr/bin/env node
//
// Validates electron-builder.config.js against electron-builder's own schema.
//
// electron-builder only validates at build time, and `npm run dist` cannot be
// run casually on this dev box: it rebuilds better-sqlite3 against the Electron
// ABI and leaves every DB test broken until `npm rebuild better-sqlite3`. So a
// config typo used to cost a full macOS CI run to discover — which is how
// `depends` sat in the `linux` block instead of `deb`, failing the whole
// packaging step after a clean install, test run, and ffmpeg build.
//
// The schema is closed (additionalProperties: false), so an unknown or
// misplaced key is caught here in about a second.

const path = require('path');
const Ajv = require('ajv');

const schema = require(path.join(__dirname, '../node_modules/app-builder-lib/scheme.json'));
const config = require(path.join(__dirname, '../electron-builder.config.js'));

// strict:false because electron-builder's schema uses keywords ajv 8 flags in
// strict mode. The validation itself is unaffected.
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// The schema cannot see inside the entitlements plist. v0.1.0 shipped
// allow-jit set to false, and every Mac build crashed at launch with SIGTRAP
// in v8::Isolate::Initialize. No CI step launches the app, so check it here.
const fs = require('fs');
for (const key of ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory']) {
  for (const plist of new Set([config.mac.entitlements, config.mac.entitlementsInherit])) {
    const text = fs.readFileSync(path.join(__dirname, '..', plist), 'utf8');
    if (!new RegExp(`<key>${key.replace(/\./g, '\\.')}</key>\\s*<true/>`).test(text)) {
      console.error(`${plist}: ${key} must be <true/>, or the Mac app crashes at launch`);
      process.exit(1);
    }
  }
}

if (validate(config)) {
  console.log('electron-builder.config.js: valid');
  process.exit(0);
}

console.error('electron-builder.config.js: INVALID\n');
// Errors from a schema this large are mostly noise from failed anyOf branches.
// The additionalProperties ones name the actual offending key.
const unknown = validate.errors.filter(e => e.keyword === 'additionalProperties');
for (const e of unknown) {
  console.error(`  unknown key "${e.params.additionalProperty}" at config${e.instancePath}`);
}
if (unknown.length === 0) {
  for (const e of validate.errors.slice(0, 15)) {
    console.error(`  config${e.instancePath} ${e.message}`);
  }
}
process.exit(1);

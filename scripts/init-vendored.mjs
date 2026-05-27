// npm postinstall hook for tinywebhook.
//
// Initializes the vendored `dexli-family` submodule at the pinned SHA.
// The `@dexli/family` import alias (declared in svelte.config.js) resolves
// against this submodule's `src/index.ts`. Cycle-3's handoff button
// consumes the cycle-2 dexli-family library by reference, not by
// re-implementation (bar item 5: "the cycle-2 infra end-to-end validation
// event").
//
// We do NOT need to chain into dexli-family's own submodule fetch
// (`vendored/{cron,regex}-dexli/`) because tinywebhook consumes only the
// library's public surface (`src/index.ts` → builder + family config). The
// nested submodules are dexli-family's test-time concern and never reached
// by tinywebhook's build or runtime.
//
// Cross-platform: pure Node stdlib (child_process), no platform-specific
// shell.

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

execSync('git submodule update --init vendored/dexli-family', {
	cwd: REPO_ROOT,
	stdio: 'inherit'
});

console.log('[init-vendored] dexli-family submodule initialized at pinned SHA.');

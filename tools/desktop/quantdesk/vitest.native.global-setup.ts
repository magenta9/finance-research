import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nativeTargets = new Set(['electron', 'node']);

const resolveNativeTarget = () => {
  const value = process.env.QUANTDESK_VITEST_NATIVE_TARGET?.trim();

  if (!value || !nativeTargets.has(value)) {
    throw new Error(
      'QUANTDESK_VITEST_NATIVE_TARGET must be set to "node" or "electron" before Vitest global setup runs.',
    );
  }

  return value;
};

export default async function setupVitestNativeTarget() {
  const target = resolveNativeTarget();
  const rebuildScript = fileURLToPath(new URL('./scripts/rebuild-native.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [rebuildScript, '--target', target], {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Native module rebuild for ${target} failed with exit code ${result.status ?? 'null'}.`);
  }
}
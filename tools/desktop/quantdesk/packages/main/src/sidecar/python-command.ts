import { existsSync } from 'node:fs';
import path from 'node:path';

export const resolveSidecarPythonCommand = ({
  isPackaged,
}: {
  isPackaged: boolean;
}) => {
  const sidecarRoot = isPackaged
    ? path.join(process.resourcesPath, 'sidecar')
    : path.resolve(process.cwd(), 'sidecar');

  const launcher = path.join(sidecarRoot, 'scripts', 'python-launcher.sh');

  if (isPackaged) {
    if (existsSync(launcher)) {
      return launcher;
    }

    const bundledPython = path.join(sidecarRoot, '.venv', 'bin', 'python');

    if (existsSync(bundledPython)) {
      return bundledPython;
    }

    throw new Error(`Missing packaged sidecar Python launcher and bundled interpreter under ${sidecarRoot}`);
  }

  const localPython = path.join(sidecarRoot, '.venv', 'bin', 'python');

  if (existsSync(localPython)) {
    return localPython;
  }

  if (existsSync(launcher)) {
    return launcher;
  }

  return 'python3';
};
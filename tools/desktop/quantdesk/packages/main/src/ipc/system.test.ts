import { createSystemHandlers } from './system';

describe('createSystemHandlers', () => {
  test('returns a typed ping payload with version metadata', async () => {
    const handlers = createSystemHandlers({
      getAppVersion: () => '0.1.0-test',
      getSqliteVersion: () => '3.0.0',
      resolveDummyScriptPath: () => '/tmp/dummy.py',
      runDummyPython: async (scriptPath) => ({
        command: 'python3',
        exitCode: 0,
        scriptPath,
        stderr: '',
        stdout: 'dummy-ok',
      }),
      getRuntimeStatus: () => ({
        lastError: null,
        logDir: null,
        sidecarPid: null,
        sidecarPort: null,
        sidecarReady: false,
      }),
    });

    const result = await handlers.ping();

    expect(result.message).toBe('pong');
    expect(result.appVersion).toBe('0.1.0-test');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  test('checks native better-sqlite3 availability through an in-memory database', async () => {
    let closed = false;

    const handlers = createSystemHandlers({
      getAppVersion: () => '0.1.0-test',
      getSqliteVersion: () => {
        closed = true;
        return '3.47.0';
      },
      resolveDummyScriptPath: () => '/tmp/dummy.py',
      runDummyPython: async (scriptPath) => ({
        command: 'python3',
        exitCode: 0,
        scriptPath,
        stderr: '',
        stdout: 'dummy-ok',
      }),
      getRuntimeStatus: () => ({
        lastError: null,
        logDir: null,
        sidecarPid: null,
        sidecarPort: null,
        sidecarReady: false,
      }),
    });

    const result = await handlers.checkNativeBindings();

    expect(result).toEqual({
      driver: 'better-sqlite3',
      memoryDbReady: true,
      sqliteVersion: '3.47.0',
    });
    expect(closed).toBe(true);
  });

  test('resolves the dummy python script path before running the spike command', async () => {
    const observedPaths: string[] = [];

    const handlers = createSystemHandlers({
      getAppVersion: () => '0.1.0-test',
      getSqliteVersion: () => '3.47.0',
      resolveDummyScriptPath: () => '/workspace/sidecar/scripts/dummy.py',
      runDummyPython: async (scriptPath) => {
        observedPaths.push(scriptPath);

        return {
          command: 'python3',
          exitCode: 0,
          scriptPath,
          stderr: '',
          stdout: 'dummy-ok',
        };
      },
      getRuntimeStatus: () => ({
        lastError: null,
        logDir: null,
        sidecarPid: null,
        sidecarPort: null,
        sidecarReady: false,
      }),
    });

    const result = await handlers.runDummyPython();

    expect(observedPaths).toEqual(['/workspace/sidecar/scripts/dummy.py']);
    expect(result).toMatchObject({
      exitCode: 0,
      scriptPath: '/workspace/sidecar/scripts/dummy.py',
      stdout: 'dummy-ok',
    });
  });
});

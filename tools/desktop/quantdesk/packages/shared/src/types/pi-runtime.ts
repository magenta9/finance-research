export type PiRuntimeState = 'stopped' | 'starting' | 'ready' | 'error' | 'degraded';

export type PiRuntimeDirectoryTarget = 'agentDir' | 'sessionDir' | 'toolInvocationDir' | 'workspaceDir';

export interface PiRuntimeDirectories {
  agentDir: string;
  sessionDir: string;
  toolInvocationDir: string;
  workspaceDir: string;
}

export interface PiDiagnosticItem {
  level: 'info' | 'warning' | 'error';
  message: string;
  source: string;
}

export interface PiModelSummary {
  available: boolean;
  availableModels: string[];
  model: string | null;
  provider: string | null;
  source: 'runtime' | 'unknown';
}

export interface PiFinanceToolStatus {
  available: boolean;
  lastError: string | null;
  names: string[];
}

export interface PiRuntimeStatus {
  currentSessionId: string | null;
  degraded: boolean;
  degradedReason: string | null;
  diagnostics: PiDiagnosticItem[];
  directories: PiRuntimeDirectories;
  financeTools: PiFinanceToolStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastStartedAt: string | null;
  model: PiModelSummary;
  pid: number | null;
  sessionCount: number;
  state: PiRuntimeState;
  wrapperVersion: string | null;
}

export interface PiRiskGateState {
  acknowledged: boolean;
  acknowledgedAt: string | null;
  message: string;
  required: boolean;
  riskLevel: 'high';
}
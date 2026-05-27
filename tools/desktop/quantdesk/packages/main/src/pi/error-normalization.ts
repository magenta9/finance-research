import { asString, isRecord } from '@quantdesk/shared/type-guards';

import type { PiToolInvocation, PiToolInvocationError } from './types';
import { extractText } from './wrapper/runtime-helpers';

const GENERIC_BASH_FAILURE_RE = /^\(no output\)(?:\n\nCommand exited with code (\d+))?$/;
const EXIT_CODE_RE = /Command exited with code (\d+)/;
const CURL_ERROR_RE = /^curl:\s*\((\d+)\)\s*(.+)$/gm;

const extractResultText = (result: unknown): string => {
    if (typeof result === 'string') {
        return result.trim();
    }

    if (!isRecord(result)) {
        return '';
    }

    const candidates = [
        extractText(result.content),
        asString(result.output),
        asString(result.summary),
        asString(result.message),
    ];

    return candidates.find((value) => value.trim().length > 0)?.trim() ?? '';
};

const extractExitCode = (message: string): number | null => {
    const match = message.match(EXIT_CODE_RE);

    if (!match) {
        return null;
    }

    const exitCode = Number.parseInt(match[1] ?? '', 10);
    return Number.isNaN(exitCode) ? null : exitCode;
};

const extractCurlError = (message: string): PiToolInvocationError | null => {
    CURL_ERROR_RE.lastIndex = 0;

    let lastMatch: RegExpExecArray | null = null;

    for (let match = CURL_ERROR_RE.exec(message); match; match = CURL_ERROR_RE.exec(message)) {
        lastMatch = match;
    }

    if (!lastMatch) {
        return null;
    }

    const exitCode = Number.parseInt(lastMatch[1] ?? '', 10);
    const detail = (lastMatch[2] ?? '').trim();

    return {
        code: Number.isNaN(exitCode) ? 'CURL_ERROR' : `CURL_EXIT_${exitCode}`,
        message: `curl: (${Number.isNaN(exitCode) ? 'unknown' : exitCode}) ${detail}`.trim(),
    };
};

const extractCommandHost = (command: string): string | null => {
    const urlMatch = command.match(/https?:\/\/[^\s"']+/);

    if (!urlMatch) {
        return null;
    }

    try {
        return new URL(urlMatch[0]).host || null;
    } catch (error) {
        void error;
        return null;
    }
};

const buildCurlTimeoutMessage = (command: string): string => {
    const host = extractCommandHost(command);

    if (host) {
        return `curl request timed out while fetching ${host} (exit code 28).`;
    }

    return 'curl request timed out while waiting for a network response (exit code 28).';
};

export const isGenericPiFailureMessage = (message: string | null | undefined): boolean => {
    if (!message) {
        return false;
    }

    return GENERIC_BASH_FAILURE_RE.test(message.trim());
};

export const normalizePiToolInvocationError = (
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
): PiToolInvocationError => {
    const rawMessage = extractResultText(result);

    if (toolName !== 'bash') {
        return {
            code: 'PI_TOOL_ERROR',
            message: rawMessage || 'Tool execution failed.',
        };
    }

    const curlError = extractCurlError(rawMessage);

    if (curlError) {
        return curlError;
    }

    const exitCode = extractExitCode(rawMessage);
    const command = asString(args.command);

    if (command.includes('curl') && exitCode === 28) {
        return {
            code: 'CURL_EXIT_28',
            message: buildCurlTimeoutMessage(command),
        };
    }

    return {
        code: exitCode == null ? 'PI_TOOL_ERROR' : `BASH_EXIT_${exitCode}`,
        message: rawMessage || 'Tool execution failed.',
    };
};

export const getPreferredPiToolInvocationError = (
    invocation: Pick<PiToolInvocation, 'args' | 'error' | 'result' | 'toolName'>,
): PiToolInvocationError | null => {
    if (invocation.error && !isGenericPiFailureMessage(invocation.error.message)) {
        return invocation.error;
    }

    if (invocation.result === undefined) {
        return invocation.error;
    }

    return normalizePiToolInvocationError(invocation.toolName, invocation.args, invocation.result);
};

export const choosePreferredPiFailureMessage = (
    transcriptFailure: string | null,
    latestToolInvocation: Pick<PiToolInvocation, 'args' | 'error' | 'result' | 'status' | 'toolName'> | null,
): string | null => {
    const invocationFailure = latestToolInvocation?.status === 'error'
        ? getPreferredPiToolInvocationError(latestToolInvocation)?.message ?? null
        : null;

    if (!transcriptFailure) {
        return invocationFailure;
    }

    if (!invocationFailure) {
        return transcriptFailure;
    }

    return isGenericPiFailureMessage(transcriptFailure) ? invocationFailure : transcriptFailure;
};

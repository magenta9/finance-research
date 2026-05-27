import type { ResearchArtifactWriteInput, ResearchPromptSnapshotArtifact, ResearchRole } from '@quantdesk/shared';

import type { PiSendMessageResult } from '../pi/types';
import { piNativeRuntimeMode, sanitizePromptSnapshot } from './pi-native-support';

export const createPiNativePromptSnapshotArtifact = (input: {
    allowedToolNames: string[];
    capturedAt: string;
    message: string;
    requestId: string;
    role: ResearchRole;
    run: PiSendMessageResult;
}): ResearchArtifactWriteInput => {
    const payload: ResearchPromptSnapshotArtifact = {
        allowedToolNames: input.allowedToolNames,
        capturedAt: input.capturedAt,
        nativeRunId: input.run.runId,
        nativeSessionId: input.run.sessionId,
        policyTags: ['pi-native', 'quantdesk-research-skill'],
        prompt: sanitizePromptSnapshot(input.message),
        requestId: input.requestId,
        role: input.role,
        runtimeMode: piNativeRuntimeMode,
    };

    return {
        artifactType: 'prompt_snapshot',
        dataProvenance: [],
        payload,
        promptVersionManifest: [{ id: 'quantdesk-research', layer: 'pi-native-skill', version: '1' }],
        requestId: input.requestId,
        role: input.role,
    };
};
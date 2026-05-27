import type { PromptVersionManifestEntry, ResearchRole, ReviewerRole } from '@quantdesk/shared';

import { getResearchRoleDefinition, getReviewerRoleDefinition } from './roles';
import { getResearchToolCapability } from './research-tool-capabilities';

export type PromptFragmentLayer =
    | 'base_policy'
    | 'user_profile'
    | 'task_overlay'
    | 'asset_overlay'
    | 'role_overlay'
    | 'tool_policy'
    | 'output_schema'
    | 'review_policy';

export interface PromptFragment {
    allowedToolNames: string[] | null;
    body: string;
    id: string;
    layer: PromptFragmentLayer;
    priority: number;
    requiredPolicyTags: string[];
    version: string;
}

export const basePolicyTags = [
    'no-fabrication',
    'risk-profile-required',
    'data-quality-hard-gate',
];

const basePolicyFragment: PromptFragment = {
    allowedToolNames: null,
    body: [
        'You are part of QuantDesk Research Director workflow.',
        'Never fabricate market data, fundamentals, news, social sentiment, probabilities or price levels.',
        'If data is missing, stale or out of scope, report a data gap and lower confidence.',
        'Precise position sizing is forbidden when the user risk profile is missing.',
        'A recommendation needs at least one explicit edge type.',
    ].join('\n'),
    id: 'research.base-policy',
    layer: 'base_policy',
    priority: 100,
    requiredPolicyTags: basePolicyTags,
    version: '2026-04-28.1',
};

const outputSchemaFragment: PromptFragment = {
    allowedToolNames: null,
    body: 'Return only structured researcher output matching the current researcher-output schema.',
    id: 'research.output-schema',
    layer: 'output_schema',
    priority: 20,
    requiredPolicyTags: ['structured-output'],
    version: '2026-04-28.1',
};

export const createTaskOverlayFragment = (body: string): PromptFragment => ({
    allowedToolNames: null,
    body,
    id: 'research.task-overlay.dynamic',
    layer: 'task_overlay',
    priority: 70,
    requiredPolicyTags: [],
    version: '2026-04-28.1',
});

export const createUserProfileFragment = (body: string): PromptFragment => ({
    allowedToolNames: null,
    body,
    id: 'research.user-profile.dynamic',
    layer: 'user_profile',
    priority: 80,
    requiredPolicyTags: ['risk-profile-required'],
    version: '2026-04-28.1',
});

export const createAssetOverlayFragment = (body: string): PromptFragment => ({
    allowedToolNames: null,
    body,
    id: 'research.asset-overlay.dynamic',
    layer: 'asset_overlay',
    priority: 60,
    requiredPolicyTags: [],
    version: '2026-04-28.1',
});

export const createResearchRoleFragment = (role: ResearchRole): PromptFragment => {
    const definition = getResearchRoleDefinition(role);

    return {
        allowedToolNames: definition.toolAllowlist,
        body: `${definition.label}: ${definition.description}`,
        id: `research.role.${role}`,
        layer: 'role_overlay',
        priority: 50,
        requiredPolicyTags: [],
        version: '2026-04-28.1',
    };
};

export const createReviewerRoleFragment = (role: ReviewerRole): PromptFragment => {
    const definition = getReviewerRoleDefinition(role);

    return {
        allowedToolNames: definition.toolAllowlist,
        body: `${definition.label}: ${definition.description}`,
        id: `research.reviewer.${role}`,
        layer: 'review_policy',
        priority: 40,
        requiredPolicyTags: role === 'data_quality' ? ['data-quality-hard-gate'] : [],
        version: '2026-04-28.1',
    };
};

const formatToolCapabilityLine = (toolName: string) => {
    const capability = getResearchToolCapability(toolName);

    if (!capability) {
        return `- ${toolName}: registered tool; no research capability metadata found.`;
    }

    return `- ${toolName}: scope=${capability.sourceScope}; evidence=${capability.evidenceKind}; sources=${capability.requiredDataSources.join('|') || 'none'}; limits=${capability.limitations.join(' ')}`;
};

export const createToolPolicyFragment = (allowedToolNames: string[]): PromptFragment => ({
    allowedToolNames,
    body: [
        `Allowed tools: ${allowedToolNames.length > 0 ? allowedToolNames.join(', ') : 'none'}.`,
        'Capability boundaries:',
        ...(allowedToolNames.length > 0 ? allowedToolNames.map(formatToolCapabilityLine) : ['- none']),
        'Do not call tools outside the allowlist. Search result snippets are leads only; fetch and parse a source before using it as factual evidence.',
    ].join('\n'),
    id: 'research.tool-policy.dynamic',
    layer: 'tool_policy',
    priority: 30,
    requiredPolicyTags: ['tool-allowlist'],
    version: '2026-04-28.1',
});

export const basePromptFragments = [basePolicyFragment, outputSchemaFragment];

export const toPromptVersionManifest = (fragments: PromptFragment[]): PromptVersionManifestEntry[] =>
    fragments.map((fragment) => ({
        id: fragment.id,
        layer: fragment.layer,
        version: fragment.version,
    }));
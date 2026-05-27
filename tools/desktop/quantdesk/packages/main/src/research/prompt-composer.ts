import type { ResearchRole, RiskProfileSnapshot } from '@quantdesk/shared';

import {
    basePolicyTags,
    basePromptFragments,
    createAssetOverlayFragment,
    createResearchRoleFragment,
    createTaskOverlayFragment,
    createToolPolicyFragment,
    createUserProfileFragment,
    toPromptVersionManifest,
    type PromptFragment,
} from './prompt-registry';
import type { ResearchContextSnapshot } from './context-snapshot';
import type { NormalizedResearchRequest } from '@quantdesk/shared';

export interface ComposeResearchPromptInput {
    context: ResearchContextSnapshot;
    normalizedRequest: NormalizedResearchRequest;
    query: string;
    riskProfile: RiskProfileSnapshot | null;
    role: ResearchRole;
}

export interface ComposedResearchPrompt {
    allowedToolNames: string[];
    manifest: ReturnType<typeof toPromptVersionManifest>;
    policyTags: string[];
    prompt: string;
}

const intersectToolAllowlist = (fragments: PromptFragment[]) => {
    const allowlists = fragments
        .map((fragment) => fragment.allowedToolNames)
        .filter((allowlist): allowlist is string[] => Array.isArray(allowlist));

    if (allowlists.length === 0) {
        return [];
    }

    return allowlists.reduce((current, allowlist) => current.filter((toolName) => allowlist.includes(toolName)));
};

const uniq = <T,>(values: T[]) => Array.from(new Set(values));

const formatDataSourceRegistry = (context: ResearchContextSnapshot) => context.dataSources
    .map((source) => {
        const tools = source.toolNames.length > 0 ? ` tools=${source.toolNames.join('|')}` : '';
        const warnings = source.warnings.length > 0 ? ` warnings=${source.warnings.join(' | ')}` : '';

        return `${source.id}: ${source.status}/${source.qualityStatus}${tools}${warnings}`;
    })
    .join('\n');

const formatRiskProfileForPrompt = (riskProfile: RiskProfileSnapshot | null) => (riskProfile
    ? `Risk profile: configured for ${riskProfile.baseCurrency} base currency with ${riskProfile.riskTolerance} tolerance. Precise sizing budgets are enforced by QuantDesk and are not included in prompt transcripts.`
    : 'Risk profile: missing. Do not provide precise position sizing.');

export const composeResearchPrompt = ({
    context,
    normalizedRequest,
    query,
    riskProfile,
    role,
}: ComposeResearchPromptInput): ComposedResearchPrompt => {
    const roleFragment = createResearchRoleFragment(role);
    const fragments = [
        ...basePromptFragments,
        createUserProfileFragment(formatRiskProfileForPrompt(riskProfile)),
        createTaskOverlayFragment(`Task: ${normalizedRequest.taskType}; horizon: ${normalizedRequest.timeHorizon}; intent: ${normalizedRequest.actionIntent}; intensity: ${normalizedRequest.actionIntensity}. User query: ${query}`),
        createAssetOverlayFragment([
            `Assets in scope: ${context.assets.map((asset) => `${asset.symbol}/${asset.market}`).join(', ') || 'none'}.`,
            'Local data only unless provenance says otherwise.',
            'Data source registry:',
            formatDataSourceRegistry(context),
            'Treat contract, degraded, or unavailable sources as explicit data gaps unless a tool call returns cited evidence.',
        ].join('\n')),
        roleFragment,
        createToolPolicyFragment(roleFragment.allowedToolNames ?? []),
    ].sort((left, right) => right.priority - left.priority);
    const policyTags = uniq(fragments.flatMap((fragment) => fragment.requiredPolicyTags));
    const missingBaseTag = basePolicyTags.find((tag) => !policyTags.includes(tag));

    if (missingBaseTag) {
        throw new Error(`Prompt composition lost required base policy tag: ${missingBaseTag}`);
    }

    const allowedToolNames = intersectToolAllowlist(fragments);

    return {
        allowedToolNames,
        manifest: toPromptVersionManifest(fragments),
        policyTags,
        prompt: fragments.map((fragment) => `## ${fragment.layer}:${fragment.id}\n${fragment.body}`).join('\n\n'),
    };
};
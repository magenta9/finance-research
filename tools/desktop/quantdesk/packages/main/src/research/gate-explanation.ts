import type { ReviewGateResult } from '@quantdesk/shared';

type GateExplanation = NonNullable<ReviewGateResult['explanation']>;

export const createGateExplanation = ({
    reasons,
    requiredDowngrades,
    reviewerRole,
    status,
}: Pick<ReviewGateResult, 'reasons' | 'requiredDowngrades' | 'reviewerRole' | 'status'>): GateExplanation => {
    const actionConstraint = status === 'block'
        ? 'observe'
        : status === 'warn'
            ? 'prepare'
            : 'none';
    const summary = status === 'block'
        ? `${reviewerRole} blocks aggressive action until ${reasons.length} issue(s) are resolved.`
        : status === 'warn'
            ? `${reviewerRole} allows research with ${reasons.length} limitation(s); action is capped at prepare.`
            : `${reviewerRole} found no required action downgrade.`;

    return {
        actionConstraint,
        reasonCount: reasons.length,
        requiredDowngradeCount: requiredDowngrades.length,
        summary,
    };
};

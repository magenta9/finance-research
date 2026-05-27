import crypto from 'node:crypto';

import type { ConflictRecord, ResearcherOutput } from '@quantdesk/shared';

const conflictsDirection = (left: ResearcherOutput, right: ResearcherOutput) => {
    if (left.direction === 'mixed' || right.direction === 'mixed') {
        return true;
    }

    return (left.direction === 'bullish' && right.direction === 'bearish')
        || (left.direction === 'bearish' && right.direction === 'bullish');
};

export const classifyResearchConflicts = (outputs: ResearcherOutput[]): ConflictRecord[] => {
    const conflicts: ConflictRecord[] = [];

    for (let leftIndex = 0; leftIndex < outputs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < outputs.length; rightIndex += 1) {
            const left = outputs[leftIndex];
            const right = outputs[rightIndex];

            if (!left || !right) {
                continue;
            }

            if (conflictsDirection(left, right)) {
                conflicts.push({
                    id: crypto.randomUUID(),
                    roles: [left.role, right.role],
                    severity: left.confidence === 'high' || right.confidence === 'high' ? 'warn' : 'pass',
                    summary: `${left.role} and ${right.role} disagree on direction.`,
                    type: 'objective',
                });
            }

            if (left.timeHorizon !== right.timeHorizon) {
                conflicts.push({
                    id: crypto.randomUUID(),
                    roles: [left.role, right.role],
                    severity: 'pass',
                    summary: `${left.role} horizon ${left.timeHorizon} differs from ${right.role} horizon ${right.timeHorizon}.`,
                    type: 'cycle',
                });
            }
        }
    }

    return conflicts;
};
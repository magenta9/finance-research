import type { ScoredAnalogCandidate } from './types';

const overlapRatio = (left: ScoredAnalogCandidate, right: ScoredAnalogCandidate) => {
    const start = Math.max(left.startIndex, right.startIndex);
    const end = Math.min(left.endIndex, right.endIndex);
    const overlap = Math.max(0, end - start + 1);
    const leftLength = left.endIndex - left.startIndex + 1;
    const rightLength = right.endIndex - right.startIndex + 1;

    return overlap / Math.min(leftLength, rightLength);
};

export const dedupeAnalogCandidates = (candidates: ScoredAnalogCandidate[]) => {
    const selected: ScoredAnalogCandidate[] = [];
    const sorted = [...candidates].sort((left, right) => right.similarity.score - left.similarity.score);

    for (const candidate of sorted) {
        const duplicatesExisting = selected.some((existing) => (
            existing.asset.id === candidate.asset.id && overlapRatio(existing, candidate) >= 0.6
        ));

        if (!duplicatesExisting) {
            selected.push(candidate);
        }
    }

    return selected;
};
import type { ConversationTimelineItem, PiWorkUnit } from '@quantdesk/shared';

export const MAX_VISIBLE_PI_WORK_LOG_ENTRIES = 6;

export type PiTimelineRow =
    | {
        createdAt: string | null;
        id: string;
        item: Extract<ConversationTimelineItem, { kind: 'message' }>;
        kind: 'message';
    }
    | {
        createdAt: string | null;
        id: string;
        item: Extract<ConversationTimelineItem, { kind: 'assistant_message' }>;
        kind: 'assistant_message';
    }
    | {
        createdAt: string | null;
        id: string;
        items: Array<Extract<ConversationTimelineItem, { kind: 'work_unit' }>>;
        kind: 'work_group';
    };

export interface PiWorkUnitPresentation {
    heading: string;
    preview: string | null;
    statusLabel: string;
    tone: 'thinking' | 'tool' | 'info' | 'error';
}

const toolStatusLabelMap: Record<Extract<PiWorkUnit, { kind: 'tool_call' }>['status'], string> = {
    approved: '已批准',
    cancelled: '已取消',
    complete: '完成',
    error: '失败',
    pending: '等待',
    rejected: '已拒绝',
    requires_approval: '待确认',
    running: '进行中',
};

const reasoningStatusLabelMap: Record<Extract<PiWorkUnit, { kind: 'reasoning' }>['status'], string> = {
    cancelled: '已取消',
    complete: '思考完成',
    streaming: '思考中',
};

export const normalizeCompactToolLabel = (value: string) => value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+(?:complete|completed|done)\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();

const compactLine = (value: string, maxLength = 84) => {
    const normalized = value.replace(/\s+/g, ' ').trim();

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const firstUsefulLine = (value: string) => value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== '```') ?? '';

const nonEmpty = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const previewIsDuplicate = (heading: string, preview: string | null) => {
    if (!preview) {
        return false;
    }

    return normalizeCompactToolLabel(heading).toLowerCase() === normalizeCompactToolLabel(preview).toLowerCase();
};

const looksLikeStructuredDump = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
        return false;
    }

    return (trimmed.startsWith('{') && trimmed.includes('"'))
        || (trimmed.startsWith('[') && trimmed.includes(']'))
        || (trimmed.length > 120 && /[{}[\]"]/.test(trimmed));
};

const deriveToolPreview = (workUnit: Extract<PiWorkUnit, { kind: 'tool_call' }>) => {
    const errorMessage = nonEmpty(workUnit.errorMessage);

    if ((workUnit.status === 'error' || workUnit.status === 'rejected') && errorMessage && !looksLikeStructuredDump(errorMessage)) {
        return compactLine(errorMessage);
    }

    const summary = nonEmpty(workUnit.output?.summary);

    if (summary && !looksLikeStructuredDump(summary)) {
        return compactLine(summary);
    }

    if (workUnit.status === 'running') {
        return '工具执行中';
    }

    if (workUnit.status === 'error' || workUnit.status === 'rejected') {
        return '工具执行失败';
    }

    return '点击展开查看输入输出';
};

export const derivePiTimelineRows = (timeline: ConversationTimelineItem[]): PiTimelineRow[] => {
    const rows: PiTimelineRow[] = [];

    for (let index = 0; index < timeline.length; index += 1) {
        const item = timeline[index];

        if (!item) {
            continue;
        }

        if (item.kind === 'work_unit') {
            const items = [item];
            let cursor = index + 1;

            while (cursor < timeline.length) {
                const nextItem = timeline[cursor];

                if (!nextItem || nextItem.kind !== 'work_unit') {
                    break;
                }

                items.push(nextItem);
                cursor += 1;
            }

            rows.push({
                createdAt: item.createdAt,
                id: `work-group:${item.id}`,
                items,
                kind: 'work_group',
            });
            index = cursor - 1;
            continue;
        }

        if (item.kind === 'message') {
            rows.push({
                createdAt: item.createdAt,
                id: item.id,
                item,
                kind: 'message',
            });
            continue;
        }

        rows.push({
            createdAt: item.createdAt,
            id: item.id,
            item,
            kind: 'assistant_message',
        });
    }

    return rows;
};

export const getVisiblePiWorkItems = (
    row: Extract<PiTimelineRow, { kind: 'work_group' }>,
    expanded: boolean,
) => {
    if (expanded || row.items.length <= MAX_VISIBLE_PI_WORK_LOG_ENTRIES) {
        return row.items;
    }

    const firstAlwaysVisibleIndex = row.items.length - MAX_VISIBLE_PI_WORK_LOG_ENTRIES;

    return row.items.filter((item, index) => index >= firstAlwaysVisibleIndex || isPiWorkUnitOpenByDefault(item.workUnit));
};

export const isPiWorkUnitOpenByDefault = (workUnit: PiWorkUnit) => workUnit.kind === 'reasoning'
    ? workUnit.status === 'streaming'
    : ['pending', 'approved', 'requires_approval', 'running'].includes(workUnit.status);

export const derivePiWorkUnitPresentation = (workUnit: PiWorkUnit): PiWorkUnitPresentation => {
    if (workUnit.kind === 'reasoning') {
        const preview = compactLine(nonEmpty(workUnit.summary) ?? firstUsefulLine(workUnit.content) ?? '思考中');

        return {
            heading: 'Thinking',
            preview: preview.length > 0 ? preview : '思考中',
            statusLabel: reasoningStatusLabelMap[workUnit.status],
            tone: workUnit.status === 'cancelled' ? 'info' : 'thinking',
        };
    }

    const heading = normalizeCompactToolLabel(workUnit.toolLabel || workUnit.toolName || 'Tool call') || 'Tool call';
    const preview = deriveToolPreview(workUnit);

    return {
        heading,
        preview: previewIsDuplicate(heading, preview) ? null : preview,
        statusLabel: toolStatusLabelMap[workUnit.status],
        tone: workUnit.status === 'error' || workUnit.status === 'rejected' ? 'error' : 'tool',
    };
};
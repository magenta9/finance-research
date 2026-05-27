import { describe, expect, test } from 'vitest';

import type { ConversationTimelineItem } from '@quantdesk/shared';

import {
    derivePiTimelineRows,
    derivePiWorkUnitPresentation,
    getVisiblePiWorkItems,
    MAX_VISIBLE_PI_WORK_LOG_ENTRIES,
} from './pi-message-timeline.logic';

const userMessage = (id: string): ConversationTimelineItem => ({
    content: `user ${id}`,
    createdAt: `2026-04-21T10:00:0${id}.000Z`,
    id: `user-${id}`,
    kind: 'message',
    role: 'user',
});

const assistantMessage = (id: string): ConversationTimelineItem => ({
    assistantMessage: {
        blocks: [],
        createdAt: `2026-04-21T10:00:1${id}.000Z`,
        id: `assistant-${id}`,
        role: 'assistant',
        status: 'complete',
    },
    createdAt: `2026-04-21T10:00:1${id}.000Z`,
    id: `assistant-${id}`,
    kind: 'assistant_message',
});

const reasoningUnit = (id: string, content = `reasoning ${id}`): ConversationTimelineItem => ({
    createdAt: `2026-04-21T10:00:2${id}.000Z`,
    id: `reasoning-${id}`,
    kind: 'work_unit',
    workUnit: {
        content,
        createdAt: `2026-04-21T10:00:2${id}.000Z`,
        id: `reasoning-${id}`,
        kind: 'reasoning',
        status: 'complete',
        summary: `reasoning ${id}`,
    },
});

const toolUnit = (id: string, summary?: string): ConversationTimelineItem => ({
    createdAt: `2026-04-21T10:00:3${id}.000Z`,
    id: `tool-${id}`,
    kind: 'work_unit',
    workUnit: {
        createdAt: `2026-04-21T10:00:3${id}.000Z`,
        id: `tool-${id}`,
        input: { id },
        kind: 'tool_call',
        output: summary ? { summary } : undefined,
        status: 'complete',
        toolLabel: 'playwright.run completed',
        toolName: 'playwright.run',
    },
});

const activeToolUnit = (id: string): ConversationTimelineItem => {
    const item = toolUnit(id, '等待用户确认');

    if (item.kind !== 'work_unit' || item.workUnit.kind !== 'tool_call') {
        throw new Error('expected a tool work unit');
    }

    item.workUnit.status = 'requires_approval';

    return item;
};

describe('pi-message-timeline logic', () => {
    test('groups adjacent work units between normal timeline rows', () => {
        const rows = derivePiTimelineRows([
            userMessage('1'),
            reasoningUnit('1'),
            toolUnit('1', '页面已打开'),
            assistantMessage('1'),
        ]);

        expect(rows.map((row) => row.kind)).toEqual(['message', 'work_group', 'assistant_message']);
        expect(rows[1]).toMatchObject({ id: 'work-group:reasoning-1', kind: 'work_group' });

        if (rows[1]?.kind !== 'work_group') {
            throw new Error('expected a work group row');
        }

        expect(rows[1].items.map((item) => item.id)).toEqual(['reasoning-1', 'tool-1']);
    });

    test('splits work groups at non-work boundaries', () => {
        const rows = derivePiTimelineRows([
            reasoningUnit('1'),
            userMessage('2'),
            toolUnit('2', '完成扫描'),
        ]);

        expect(rows.map((row) => row.kind)).toEqual(['work_group', 'message', 'work_group']);
    });

    test('shows only the latest work entries while collapsed', () => {
        const workItems = Array.from({ length: MAX_VISIBLE_PI_WORK_LOG_ENTRIES + 2 }, (_, index) => reasoningUnit(String(index)));
        const rows = derivePiTimelineRows(workItems);

        if (rows[0]?.kind !== 'work_group') {
            throw new Error('expected a work group row');
        }

        expect(getVisiblePiWorkItems(rows[0], false).map((item) => item.id)).toEqual([
            'reasoning-2',
            'reasoning-3',
            'reasoning-4',
            'reasoning-5',
            'reasoning-6',
            'reasoning-7',
        ]);
        expect(getVisiblePiWorkItems(rows[0], true)).toHaveLength(MAX_VISIBLE_PI_WORK_LOG_ENTRIES + 2);
    });

    test('keeps actionable work entries visible while collapsed', () => {
        const rows = derivePiTimelineRows([
            activeToolUnit('0'),
            ...Array.from({ length: MAX_VISIBLE_PI_WORK_LOG_ENTRIES + 2 }, (_, index) => reasoningUnit(String(index))),
        ]);

        if (rows[0]?.kind !== 'work_group') {
            throw new Error('expected a work group row');
        }

        expect(getVisiblePiWorkItems(rows[0], false).map((item) => item.id)).toEqual([
            'tool-0',
            'reasoning-2',
            'reasoning-3',
            'reasoning-4',
            'reasoning-5',
            'reasoning-6',
            'reasoning-7',
        ]);
    });

    test('derives compact thinking and tool presentation', () => {
        const thinking = reasoningUnit('1', '我先看上下文。\n再核对工具结果。');
        const tool = toolUnit('1', '已运行 Playwright 代码');

        if (thinking.kind !== 'work_unit' || tool.kind !== 'work_unit') {
            throw new Error('expected work units');
        }

        expect(derivePiWorkUnitPresentation(thinking.workUnit)).toMatchObject({
            heading: 'Thinking',
            preview: 'reasoning 1',
            statusLabel: '思考完成',
            tone: 'thinking',
        });
        expect(derivePiWorkUnitPresentation(tool.workUnit)).toMatchObject({
            heading: 'playwright.run',
            preview: '已运行 Playwright 代码',
            statusLabel: '完成',
            tone: 'tool',
        });
    });

    test('does not leak long tool output into the collapsed preview', () => {
        const tool = toolUnit('1');

        if (tool.kind !== 'work_unit' || tool.workUnit.kind !== 'tool_call') {
            throw new Error('expected a tool work unit');
        }

        tool.workUnit.output = {
            content: 'LONG_TOOL_OUTPUT_SENTINEL '.repeat(20).trim(),
            summary: '',
        };

        expect(derivePiWorkUnitPresentation(tool.workUnit).preview).toBe('点击展开查看输入输出');
    });

    test('does not use structured JSON summaries as collapsed tool previews', () => {
        const tool = toolUnit('1', '{ "audit": { "toolName": "health_check" }, "ok": true }');

        if (tool.kind !== 'work_unit') {
            throw new Error('expected a tool work unit');
        }

        expect(derivePiWorkUnitPresentation(tool.workUnit).preview).toBe('点击展开查看输入输出');
    });

    test('ignores structured complete-tool error messages in collapsed previews', () => {
        const tool = toolUnit('1', '{ "audit": { "toolName": "health_check" }, "ok": true }');

        if (tool.kind !== 'work_unit' || tool.workUnit.kind !== 'tool_call') {
            throw new Error('expected a tool work unit');
        }

        tool.workUnit.errorMessage = '{ "audit": { "toolName": "health_check" }, "ok": true }';

        expect(derivePiWorkUnitPresentation(tool.workUnit).preview).toBe('点击展开查看输入输出');
    });
});
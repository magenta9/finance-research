import type { AgentRichBlock, AgentSkillContext } from '@quantdesk/shared';

export interface SkillExecutionResult {
    citations: string[];
    richBlocks: AgentRichBlock[];
    skill: string;
    summary: string;
}

export interface SkillContext extends AgentSkillContext {
    message: string;
}

export interface AgentSkill {
    description: string;
    execute: (context: SkillContext) => Promise<SkillExecutionResult>;
    name: string;
}
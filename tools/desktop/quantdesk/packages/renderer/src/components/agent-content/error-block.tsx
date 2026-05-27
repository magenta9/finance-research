import type { ErrorBlock as ErrorBlockType } from '@quantdesk/shared';

export const AgentErrorBlock = ({ block }: { block: ErrorBlockType }) => (
    <section className="rounded-[18px] border border-[rgba(159,58,41,0.24)] bg-[rgba(159,58,41,0.08)] px-4 py-3.5 text-[#7d2c22]" data-testid={`content-block-${block.id}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#9f3a29]">错误</div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{block.message}</p>
        {block.code && <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#9f3a29]">{block.code}</p>}
    </section>
);
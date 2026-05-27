import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useOverlayFocusTrap } from '../use-overlay-focus-trap';
import { ConversationHistoryPanelContent, type ConversationHistoryPanelItem } from './conversation-history-panel-content';

interface ConversationHistoryPopoverProps {
    activeConversationId: string | null;
    allowDelete?: boolean;
    anchorRef: RefObject<HTMLButtonElement | null>;
    conversations: ConversationHistoryPanelItem[];
    id?: string;
    isLoading: boolean;
    onClose: () => void;
    onCreateConversation: () => void;
    onDeleteConversation: (id: string) => void;
    onSelectConversation: (id: string) => void;
    open: boolean;
}

export const ConversationHistoryPopover = ({
    activeConversationId,
    allowDelete = true,
    anchorRef,
    conversations,
    id = 'conversation-history-dropdown',
    isLoading,
    onClose,
    onCreateConversation,
    onDeleteConversation,
    onSelectConversation,
    open,
}: ConversationHistoryPopoverProps) => {
    const panelRef = useOverlayFocusTrap<HTMLDivElement>(open, onClose);
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({
        left: 12,
        maxHeight: 360,
        top: 84,
        width: 420,
    });

    const updatePanelPosition = useCallback(() => {
        const anchor = anchorRef.current;

        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const width = Math.min(360, window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        const top = Math.min(rect.bottom + 12, window.innerHeight - 180);
        const maxHeight = Math.max(240, window.innerHeight - top - 16);

        setPanelStyle({
            left,
            maxHeight,
            top,
            width,
        });
    }, [anchorRef]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        updatePanelPosition();

        const handleScroll = () => {
            updatePanelPosition();
        };

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;

            if (!(target instanceof Node)) {
                return;
            }

            if (panelRef.current?.contains(target)) {
                return;
            }

            if (anchorRef.current?.contains(target)) {
                return;
            }

            onClose();
        };

        window.addEventListener('resize', handleScroll);
        window.addEventListener('scroll', handleScroll, true);
        document.addEventListener('pointerdown', handlePointerDown, true);

        return () => {
            window.removeEventListener('resize', handleScroll);
            window.removeEventListener('scroll', handleScroll, true);
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [anchorRef, onClose, open, panelRef, updatePanelPosition]);

    if (!open) {
        return null;
    }

    return createPortal(
        <section
            aria-label="会话历史"
            className="fixed z-50 flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface-strong),var(--color-surface))] shadow-[0_24px_80px_rgba(23,19,16,0.22)] backdrop-blur-xl"
            id={id}
            ref={panelRef}
            role="dialog"
            style={panelStyle}
            tabIndex={-1}
        >
            <ConversationHistoryPanelContent
                activeConversationId={activeConversationId}
                allowDelete={allowDelete}
                conversations={conversations}
                description=""
                isLoading={isLoading}
                eyebrow=""
                listTestId="conversation-history-popover-list"
                onClose={onClose}
                onCreate={onCreateConversation}
                onDelete={onDeleteConversation}
                onSelect={onSelectConversation}
                showCreateButton={false}
                searchInputTestId="conversation-history-search"
                title="会话历史"
            />
        </section>
        ,
        document.body,
    );
};

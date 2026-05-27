import fs from 'node:fs';
import path from 'node:path';

import { computePlaceholderConversationTitle } from '@quantdesk/shared';

import type { PiRuntimeDirectories, PiWrapperSessionSummary } from './types';

export interface PiSessionTitleMetadata {
  title: string | null;
  titleSource: 'placeholder' | 'generated' | 'upstream';
  titleStatus: 'pending' | 'ready' | 'failed';
  titleUpdatedAt: string | null;
}

export class PiSessionTitleStore {
  private readonly directories: PiRuntimeDirectories;

  private readonly metadata = new Map<string, PiSessionTitleMetadata>();

  private readonly onError?: (error: unknown) => void;

  constructor({
    directories,
    onError,
  }: {
    directories: PiRuntimeDirectories;
    onError?: (error: unknown) => void;
  }) {
    this.directories = directories;
    this.onError = onError;
    this.load();
  }

  delete(sessionId: string) {
    if (!this.metadata.delete(sessionId)) {
      return false;
    }

    this.persist();
    return true;
  }

  prepareSessionCreated(session: PiWrapperSessionSummary): PiWrapperSessionSummary {
    if (session.name) {
      return this.resolveSessionSummary(session);
    }

    const titleUpdatedAt = new Date().toISOString();
    this.update(session.id, {
      title: computePlaceholderConversationTitle(session.firstMessage),
      titleSource: 'placeholder',
      titleStatus: 'pending',
      titleUpdatedAt,
    });

    return this.resolveSessionSummary({
      ...session,
      titleUpdatedAt,
    });
  }

  resolveSessionSummary(session: PiWrapperSessionSummary): PiWrapperSessionSummary {
    if (session.name) {
      return {
        ...session,
        title: session.name,
        titleSource: 'upstream',
        titleStatus: 'ready',
        titleUpdatedAt: session.modifiedAt,
      };
    }

    const metadata = this.metadata.get(session.id);
    const placeholderTitle = computePlaceholderConversationTitle(session.firstMessage);

    if (!metadata) {
      return {
        ...session,
        title: session.title ?? placeholderTitle,
        titleSource: session.titleSource ?? 'placeholder',
        titleStatus: session.titleStatus ?? 'ready',
        titleUpdatedAt: session.titleUpdatedAt ?? session.modifiedAt,
      };
    }

    return {
      ...session,
      title: metadata.title ?? placeholderTitle,
      titleSource: metadata.titleSource,
      titleStatus: metadata.titleStatus,
      titleUpdatedAt: metadata.titleUpdatedAt ?? session.modifiedAt,
    };
  }

  update(sessionId: string, metadata: PiSessionTitleMetadata) {
    this.metadata.set(sessionId, metadata);
    this.persist();
  }

  private getFilePath() {
    return path.join(this.directories.agentDir, 'session-title-metadata.json');
  }

  private load() {
    fs.mkdirSync(this.directories.agentDir, { recursive: true });
    const filePath = this.getFilePath();

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, PiSessionTitleMetadata>;

      for (const [sessionId, metadata] of Object.entries(parsed)) {
        this.metadata.set(sessionId, metadata);
      }
    } catch (error) {
      this.onError?.(error);
    }
  }

  private persist() {
    fs.mkdirSync(this.directories.agentDir, { recursive: true });
    fs.writeFileSync(
      this.getFilePath(),
      JSON.stringify(Object.fromEntries(this.metadata.entries()), null, 2),
      'utf8',
    );
  }
}

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  onRenameSession: (sessionId: string, summary: string) => void | Promise<void>;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  onRenameSession,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against the trailing blur re-running the commit after Enter/Escape
  // have already resolved the edit (Escape must cancel without saving).
  const editHandledRef = useRef(false);

  // Cursor sessions are named upstream and not renamable through this endpoint.
  const canRenameSession =
    activeTab === 'chat' && Boolean(selectedSession) && selectedSession?.__provider !== 'cursor';

  // Leave edit mode if the user navigates to a different session while editing.
  useEffect(() => {
    setIsEditing(false);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  const startEditing = () => {
    if (!selectedSession) return;
    editHandledRef.current = false;
    setDraftTitle(getSessionTitle(selectedSession));
    setIsEditing(true);
  };

  const finishEditing = (save: boolean) => {
    if (editHandledRef.current) return;
    editHandledRef.current = true;
    setIsEditing(false);
    if (!save || !selectedSession) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === getSessionTitle(selectedSession)) {
      return;
    }
    void onRenameSession(selectedSession.id, trimmed);
  };

  return (
    <div className="scrollbar-hide group flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={() => finishEditing(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    finishEditing(true);
                  } else if (event.key === 'Escape') {
                    finishEditing(false);
                  }
                }}
                className="w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:border-primary focus:outline-none"
                autoComplete="off"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <h2 title={getSessionTitle(selectedSession)} className="truncate text-sm font-semibold leading-tight text-foreground">
                  {getSessionTitle(selectedSession)}
                </h2>
                {canRenameSession && (
                  <button
                    type="button"
                    onClick={startEditing}
                    title={t('tooltips.renameSession', 'Rename chat')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="truncate text-[11px] leading-tight text-foreground/75">{selectedProject.displayName}</div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-foreground/75">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-foreground/75">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}

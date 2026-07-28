import { useCallback, useRef, useState, useEffect } from 'react';
import { CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MainContentHeaderProps } from '../../types/types';
import { useSessionUnreadStatus } from '../../hooks/useSessionUnreadStatus';

import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';
import SessionResumeDialog from './SessionResumeDialog';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  onRenameSession,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const { isUnread, markRead } = useSessionUnreadStatus(selectedSession?.id);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState]);

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            onRenameSession={onRenameSession}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>

        <div className="flex min-w-0 flex-shrink items-center gap-2 sm:flex-shrink-0">
          {activeTab === 'chat' && selectedSession && isUnread && (
            <button
              className="flex h-7 items-center gap-1.5 rounded-lg bg-sky-500/10 px-2 text-xs font-normal text-sky-600 transition-all hover:bg-sky-500/20 active:scale-95 dark:text-sky-400"
              onClick={markRead}
              title={t('tooltips.markSessionRead', 'Mark as read')}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('chat.markAsRead', 'Mark Read')}</span>
            </button>
          )}

          {activeTab === 'chat' && selectedSession && (
            <SessionResumeDialog
              selectedProject={selectedProject}
              selectedSession={selectedSession}
            />
          )}

          <div className="relative min-w-0 overflow-hidden">
            {canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
            )}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="scrollbar-hide overflow-x-auto"
            >
              <MainContentTabSwitcher
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                shouldShowTasksTab={shouldShowTasksTab}
                shouldShowBrowserTab={shouldShowBrowserTab}
              />
            </div>
            {canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

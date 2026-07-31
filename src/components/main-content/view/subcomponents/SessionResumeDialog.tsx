import { useEffect, useMemo, useState } from 'react';
import { Copy, LoaderCircle, TerminalSquare } from 'lucide-react';

import type { Project, ProjectSession, SessionResumeInfo } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';

type ResumeInfoApiResponse = {
  success?: boolean;
  data?: SessionResumeInfo;
  error?: string;
};

type SessionResumeDialogProps = {
  selectedProject: Project;
  selectedSession: ProjectSession;
};

type CopyStateKey = 'command' | 'path' | 'sessionId' | null;

function providerLabel(provider: SessionResumeInfo['provider'] | ProjectSession['__provider']): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'cursor') return 'Cursor';
  if (provider === 'opencode') return 'OpenCode';
  return 'Claude';
}

function DetailRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy} className="h-7 px-2 text-xs">
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 font-mono text-xs text-foreground break-all">
        {value}
      </div>
    </div>
  );
}

export default function SessionResumeDialog({
  selectedProject,
  selectedSession,
}: SessionResumeDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeInfo, setResumeInfo] = useState<SessionResumeInfo | null>(null);
  const [copyState, setCopyState] = useState<CopyStateKey>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void api.sessionResumeInfo(selectedSession.id)
      .then(async (response) => {
        const payload = await response.json() as ResumeInfoApiResponse;
        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(payload?.error || `Failed to load resume info (${response.status})`);
        }

        setResumeInfo(payload.data);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) {
          return;
        }

        const message = fetchError instanceof Error ? fetchError.message : 'Failed to load resume info.';
        setError(message);
        setResumeInfo(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedSession.id]);

  useEffect(() => {
    if (!open) {
      setCopyState(null);
    }
  }, [open]);

  const effectiveCommand = useMemo(() => {
    if (!resumeInfo) {
      return '';
    }

    return resumeInfo.resumeCommand || resumeInfo.startCommand;
  }, [resumeInfo]);

  const handleCopy = async (key: Exclude<CopyStateKey, null>, value: string | null | undefined) => {
    if (!value) {
      return;
    }

    const copied = await copyTextToClipboard(value);
    if (!copied) {
      return;
    }

    setCopyState(key);
    window.setTimeout(() => {
      setCopyState((current) => (current === key ? null : current));
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Resume this session in your native CLI"
        className="h-8 px-2 sm:px-3"
      >
        <TerminalSquare className="h-4 w-4" />
        <span className="hidden sm:inline">Resume in CLI</span>
      </Button>

      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-0">
        <DialogTitle>Resume in native CLI</DialogTitle>
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">Resume in native CLI</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {providerLabel(resumeInfo?.provider || selectedSession.__provider)} session for {selectedProject.displayName}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-8 px-2">
              Close
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading resume information...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && resumeInfo && (
            <>
              {!resumeInfo.canResume && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
                  {resumeInfo.reason || 'This session does not have a provider-native resume ID yet.'}
                </div>
              )}

              <DetailRow
                label={resumeInfo.canResume ? 'Resume Command' : 'Start Command'}
                value={effectiveCommand}
                onCopy={() => void handleCopy('command', effectiveCommand)}
                copied={copyState === 'command'}
              />

              <DetailRow
                label="Project Path"
                value={resumeInfo.projectPath}
                onCopy={() => void handleCopy('path', resumeInfo.projectPath)}
                copied={copyState === 'path'}
              />

              <DetailRow
                label="Provider Session ID"
                value={resumeInfo.providerSessionId || 'Not available yet'}
                onCopy={() => void handleCopy('sessionId', resumeInfo.providerSessionId)}
                copied={copyState === 'sessionId'}
              />

              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                Host platform: <span className="font-mono text-foreground">{resumeInfo.hostPlatform}</span>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

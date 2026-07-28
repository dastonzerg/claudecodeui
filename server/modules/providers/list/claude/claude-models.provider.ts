import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query, type ModelInfo, type Options } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

/**
 * Offline catalog, used only when the live lookup in `getSupportedModels()`
 * cannot reach the Claude CLI.
 *
 * Entries are deliberately keyed by version-free aliases (`opus`, `sonnet`,
 * `opus[1m]`, ...) and described without generation numbers or prices. The CLI
 * resolves those aliases to whatever the current generation is, so a hardcoded
 * "Opus 4.8" here goes stale the moment a new model ships even though the alias
 * keeps working. Live discovery supplies the concrete generation and pricing in
 * its own descriptions.
 */
export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: "Use the CLI's current default model",
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Most capable for complex work',
    },
    {
      value: 'opus[1m]',
      label: 'Opus (1M context)',
      description: 'Opus with a 1M-token context window',
    },
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Efficient for routine tasks',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fastest for quick answers',
    },
  ],
  DEFAULT: 'default',
};

type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

/**
 * Finds the most recent *model-selection* signal in a transcript.
 *
 * Unlike an assistant message's `message.model` (which the API returns as the
 * bare id, e.g. `claude-opus-4-8`, dropping any `[1m]` beta), a `/model`
 * command records the human-facing selection like `Opus 4.8 (1M context)` —
 * the only in-transcript evidence of the 1M context window. Scanning from the
 * end returns the latest selection so a mid-session switch wins. Returns null
 * when the session never expressed a model selection.
 */
export const getClaudeSelectedModelFromLines = (lines: string[]): string | null => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    // Cheap pre-filter: only selection lines carry these markers, so most
    // assistant/user lines are skipped without a JSON.parse.
    if (!line.includes('Set model') && !line.includes('<model>')) {
      continue;
    }

    try {
      const event = JSON.parse(line) as ClaudeInitEvent;
      const model = extractClaudeModelFromMessageContent(event.message?.content);
      if (model) {
        return model;
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

/**
 * Reads the model Claude Code is configured to start new sessions with.
 *
 * Sessions launched on the saved default never record a `/model` selection,
 * so this setting is the only place the `[1m]` beta shows up for them. It is
 * the *current* global default though, so callers should confirm it refers to
 * the same model family the session actually ran on before trusting it.
 */
export const getClaudeConfiguredDefaultModel = async (): Promise<string | null> => {
  try {
    const raw = await readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as { model?: unknown };
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    return model || null;
  } catch {
    return null;
  }
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

const CLAUDE_MODELS_QUERY_TIMEOUT_MS = 30_000;

/**
 * Options for the throwaway query used to read the model catalog.
 *
 * `persistSession: false` is the load-bearing setting. Without it the SDK
 * writes a transcript to `~/.claude/projects/<encoded-cwd>/`, which the session
 * synchronizer then indexes as a real session — auto-registering the server's
 * own working directory as a project (`sessionsDb.createSession` calls
 * `projectsDb.createProjectPath`). That phantom project is why this lookup was
 * previously disabled. `cwd` is pinned to the temp dir as a second line of
 * defence so nothing can attach to a real workspace.
 *
 * The executable is resolved the same way chat runs resolve it, so the catalog
 * always matches the binary that actually serves requests — the SDK's bundled
 * executable can lag the installed CLI and report an older model line-up.
 */
function buildClaudeQueryOptions(abortController: AbortController): Options {
  return {
    persistSession: false,
    cwd: os.tmpdir(),
    pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    abortController,
  };
}

/**
 * Maps the SDK's `ModelInfo[]` onto the app-facing catalog shape.
 *
 * Claude's display names are deliberately version-free ("Opus (1M context)"),
 * so the labels stay correct across model releases; the descriptions carry the
 * concrete generation and pricing.
 */
function buildClaudeModelsDefinition(models: ModelInfo[]): ProviderModelsDefinition {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    const value = typeof model?.value === 'string' ? model.value.trim() : '';
    if (!value || seenValues.has(value)) {
      continue;
    }

    seenValues.add(value);
    options.push({
      value,
      label: model.displayName?.trim() || value,
      description: model.description?.trim() || undefined,
    });
  }

  if (options.length === 0) {
    return CLAUDE_FALLBACK_MODELS;
  }

  const preferredDefault = seenValues.has(CLAUDE_FALLBACK_MODELS.DEFAULT)
    ? CLAUDE_FALLBACK_MODELS.DEFAULT
    : options[0].value;

  return { OPTIONS: options, DEFAULT: preferredDefault };
}

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), CLAUDE_MODELS_QUERY_TIMEOUT_MS);

    // The prompt is never sent: `supportedModels()` is answered over the SDK
    // control channel, and the query is closed before the turn is iterated.
    const queryInstance = query({
      prompt: 'Get supported models',
      options: buildClaudeQueryOptions(abortController),
    });

    try {
      return buildClaudeModelsDefinition(await queryInstance.supportedModels());
    } catch (error) {
      // A missing/older CLI, an auth prompt, or the timeout above all land here.
      // The catalog is cosmetic, so degrade to the bundled list instead of
      // failing the request.
      console.error('[ClaudeProviderModels] Falling back to static model list:', error);
      return CLAUDE_FALLBACK_MODELS;
    } finally {
      clearTimeout(timeout);
      try {
        await queryInstance.close?.();
      } catch {
        // Closing a query that already failed to spawn is not actionable.
      }
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      // The DB row is keyed by the app-facing session id, while the JSONL
      // rows on disk carry the provider-native id (see getSessionMessages in
      // claude-sessions.provider.ts for the same distinction).
      const session = sessionsDb.getSessionById(sessionId);
      const jsonlPath = session?.jsonl_path;
      const providerSessionId = session?.provider_session_id || sessionId;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(providerSessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}

import path from 'node:path';

import type { LLMProvider } from '@/shared/types.js';

type CommandPlatform = 'win32' | 'posix';

type BuildProviderCommandOptions = {
  provider: LLMProvider;
  resumeSessionId?: string | null;
  initialCommand?: string | null;
  platform: CommandPlatform;
};

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosixLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function normalizeCommandPlatform(platform: NodeJS.Platform): CommandPlatform {
  return platform === 'win32' ? 'win32' : 'posix';
}

export function buildProviderShellCommand({
  provider,
  resumeSessionId,
  initialCommand,
  platform,
}: BuildProviderCommandOptions): string {
  if (provider === 'cursor') {
    return resumeSessionId
      ? `cursor-agent --resume="${resumeSessionId}"`
      : 'cursor-agent';
  }

  if (provider === 'codex') {
    if (!resumeSessionId) {
      return 'codex';
    }

    return platform === 'win32'
      ? `codex resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { codex }`
      : `codex resume "${resumeSessionId}" || codex`;
  }

  if (provider === 'gemini') {
    const command = initialCommand || 'gemini';
    return resumeSessionId ? `${command} --resume "${resumeSessionId}"` : command;
  }

  if (provider === 'opencode') {
    if (resumeSessionId) {
      return `opencode --session "${resumeSessionId}"`;
    }

    return initialCommand || 'opencode';
  }

  const command = initialCommand || 'claude';
  if (!resumeSessionId) {
    return command;
  }

  return platform === 'win32'
    ? `claude --resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { claude }`
    : `claude --resume "${resumeSessionId}" || claude`;
}

export function scopeCommandToProject(
  projectPath: string,
  command: string,
  platform: CommandPlatform
): string {
  const normalizedProjectPath = path.resolve(projectPath);

  return platform === 'win32'
    ? `Set-Location -LiteralPath ${quotePowerShellLiteral(normalizedProjectPath)}; ${command}`
    : `cd ${quotePosixLiteral(normalizedProjectPath)} && ${command}`;
}

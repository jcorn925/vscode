/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isWindows } from '../../vs/base/common/platform.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { VSBuffer } from '../../vs/base/common/buffer.js';
import { IFileService } from '../../vs/platform/files/common/files.js';

export const IX_DEFAULT_INSTALL_URL = 'https://ix-infra.com/install.sh';
export const HOMEBREW_INSTALL_CMD = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
export const HOMEBREW_SHELLENV_ZSH = 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"';

export const HOMEBREW_PATH_MANUAL_HINT =
	'1. Add Homebrew to your PATH (after a successful install):\n\n'
	+ 'echo >> ~/.zprofile\n'
	+ 'echo \'eval "$(/opt/homebrew/bin/brew shellenv zsh)"\' >> ~/.zprofile\n'
	+ 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"\n\n'
	+ '2. Confirm Homebrew works:\n\n'
	+ 'brew --version\n'
	+ 'which brew';

export const IX_INSTALL_MANUAL_HINT =
	'3. Run the Ix installer without a pipe (keeps your terminal as stdin):\n\n'
	+ 'curl -fsSL https://ix-infra.com/install.sh -o /tmp/ix-install.sh\n'
	+ 'bash /tmp/ix-install.sh\n\n'
	+ '4. Verify:\n\n'
	+ 'which ix\n'
	+ 'ix --version\n\n'
	+ 'Then restart Code OSS (or set custom.ix.cliPath to the path from which ix).\n\n'
	+ 'Why: curl … | sh has no TTY, so Homebrew install aborts. '
	+ 'With brew on PATH, the Ix script skips the Homebrew step.';

export function buildShellEnvPreamble(): string {
	const lines: string[] = [];
	if (isMacintosh) {
		lines.push(
			'if [ -x /opt/homebrew/bin/brew ]; then',
			'  eval "$(/opt/homebrew/bin/brew shellenv zsh)"',
			'elif [ -x /usr/local/bin/brew ]; then',
			'  eval "$(/usr/local/bin/brew shellenv)"',
			'fi',
		);
	}
	if (!isWindows) {
		// Ix installs to ~/.local/bin; GUI/hidden bash probes do not load ~/.zshrc.
		lines.push('export PATH="$HOME/.local/bin:$PATH"');
	}
	return lines.join('\n');
}

export async function resolveKnownIxCliPath(
	fileService: IFileService,
	userHome: URI,
): Promise<string | undefined> {
	const candidates = [
		joinPath(userHome, '.local', 'bin', 'ix'),
		joinPath(userHome, '.ix', 'cli', 'ix'),
	];
	for (const candidate of candidates) {
		if (await fileService.exists(candidate)) {
			return candidate.fsPath;
		}
	}
	return undefined;
}

export function buildIxInstallScriptCommand(installUrl: string = IX_DEFAULT_INSTALL_URL): string {
	if (isWindows) {
		const safe = installUrl.replace(/'/g, "''");
		return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-Expression (Invoke-WebRequest -UseBasicParsing -Uri '${safe}').Content"`;
	}
	const safe = installUrl.replace(/'/g, `'\\''`);
	const body = [
		`curl -fsSL '${safe}' -o /tmp/ix-install.sh`,
		'bash /tmp/ix-install.sh',
	].join('\n');
	const preamble = buildShellEnvPreamble();
	return preamble ? `${preamble}\n${body}` : body;
}

export async function ensureHomebrewShellEnvInProfile(
	fileService: IFileService,
	userHome: URI,
): Promise<boolean> {
	if (!isMacintosh) {
		return false;
	}

	const optBrew = URI.file('/opt/homebrew/bin/brew');
	if (!(await fileService.exists(optBrew))) {
		return false;
	}

	const shellenvLine = HOMEBREW_SHELLENV_ZSH;
	let changed = false;
	for (const profileName of ['.zprofile', '.zshrc'] as const) {
		const profileUri = joinPath(userHome, profileName);
		let content = '';
		try {
			content = (await fileService.readFile(profileUri)).value.toString();
		} catch {
			content = '';
		}
		if (content.includes('brew shellenv')) {
			continue;
		}
		const next = content.length > 0 && !content.endsWith('\n')
			? `${content}\n\n# Added by VS Code startup setup\n${shellenvLine}\n`
			: `${content}# Added by VS Code startup setup\n${shellenvLine}\n`;
		await fileService.writeFile(profileUri, VSBuffer.fromString(next));
		changed = true;
	}
	return changed;
}

export async function resolveInstalledIxPath(probeOutput: string): Promise<string | undefined> {
	const line = probeOutput.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
	return line || undefined;
}

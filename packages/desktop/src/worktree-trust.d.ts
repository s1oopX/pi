export function parseWorktreeGitdir(content: string): string | null;
export function deriveWorktreeSourceRoot(gitdirPath: string): string | null;
export function resolveWorktreeSourceRoot(cwd: string, readImpl?: (path: string) => string): string | null;
export function directoriesShareIdentity(
	a: string,
	b: string,
	statImpl?: (path: string) => { dev: bigint; ino: bigint },
): boolean;

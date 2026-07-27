/**
 * Project template creation: copy a template directory, run npm install, and
 * git init. Follows the no-shell, canonicalized execFile pattern from
 * git-commit.js.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");
const EXEC_TIMEOUT_MS = 120_000;

/**
 * Recursively copy a directory to a target, creating intermediate directories
 * as needed. Returns the number of files copied.
 * @param {string} srcDir
 * @param {string} targetDir
 * @returns {Promise<number>}
 */
async function copyDirectory(srcDir, targetDir) {
	let count = 0;
	await mkdir(targetDir, { recursive: true });
	const entries = await readdir(srcDir, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = join(srcDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			count += await copyDirectory(srcPath, targetPath);
		} else if (entry.isFile()) {
			await copyFile(srcPath, targetPath);
			count++;
		}
	}
	return count;
}

/** Templates that ship with the app. The `template` argument must match one. */
export const TEMPLATE_NAMES = ["nextjs", "express", "cli"];

/**
 * Recursively copy a named template from the templates directory to targetDir.
 * @param {string} templateName
 * @param {string} targetDir
 * @returns {Promise<{ copied: number }>}
 */
export async function copyTemplate(templateName, targetDir) {
	if (!TEMPLATE_NAMES.includes(templateName)) {
		throw new Error(
			`Unknown template "${templateName}". Expected one of: ${TEMPLATE_NAMES.join(", ")}`,
		);
	}
	const srcDir = join(TEMPLATES_DIR, templateName);
	if (!existsSync(srcDir)) {
		throw new Error(`Template "${templateName}" not found at ${srcDir}`);
	}
	const srcStat = await stat(srcDir);
	if (!srcStat.isDirectory()) {
		throw new Error(`Template "${templateName}" is not a directory`);
	}
	const copied = await copyDirectory(srcDir, targetDir);
	return { copied };
}

/**
 * Run `npm install` in cwd. On Windows npm is a `.cmd` wrapper, not a binary,
 * so `execFile` with `shell: false` fails with ENOENT; route it through
 * `cmd.exe` there. The command and args are still passed as an array — never
 * concatenated — so caller input cannot reach the shell.
 * @param {string} cwd
 * @param {{ platform?: string }} [deps]
 * @returns {Promise<{ installed: boolean }>}
 */
export function runNpmInstall(cwd, deps = {}) {
	const platform = deps.platform ?? process.platform;
	const cmd = platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
	const args = platform === "win32" ? ["/d", "/s", "/c", "npm", "install"] : ["install"];
	return new Promise((resolve, reject) => {
		execFile(
			cmd,
			args,
			{
				cwd,
				encoding: "utf8",
				env: { ...process.env },
				shell: false,
				timeout: EXEC_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					const detail = (stderr || stdout || error.message || "unknown error").slice(0, 500);
					reject(new Error(`npm install failed: ${detail}`));
					return;
				}
				resolve({ installed: true });
			},
		);
	});
}

/**
 * Run `git init` in cwd, following the same execFile pattern as runGit.
 * @param {string} cwd
 * @returns {Promise<{ initialized: boolean }>}
 */
export function runGitInit(cwd) {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["init"],
			{
				cwd,
				encoding: "utf8",
				env: { ...process.env },
				shell: false,
				timeout: EXEC_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					const detail = (stderr || stdout || error.message || "unknown error").slice(0, 500);
					reject(new Error(`git init failed: ${detail}`));
					return;
				}
				resolve({ initialized: true });
			},
		);
	});
}

/**
 * Create a project from a template at targetDir. Orchestrates all three steps:
 * 1. Copy template files
 * 2. Run npm install
 * 3. Run git init
 *
 * @param {string} template
 * @param {string} targetDir
 * @returns {Promise<{ created: boolean, path: string }>}
 */
/**
 * Normalize a user-entered project name into a safe path segment. Rejects
 * anything that could escape its parent directory or contain path separators.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeProjectName(name) {
	if (typeof name !== "string") {
		throw new Error("Project name must be a string");
	}
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Project name is empty");
	// Disallow separators and parent-directory traversal outright — npm/git
	// project names are a single path segment, never a relative path.
	if (/[\\/:]/.test(trimmed) || trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
		throw new Error(`Project name must not contain path separators or "..": ${trimmed}`);
	}
	// Strip characters that are invalid in Windows folder names, which also
	// covers the most common accidental shell metacharacters.
	const cleaned = trimmed.replace(/[<>:"|?*\x00-\x1f]/g, "");
	if (!cleaned) throw new Error(`Project name has no valid characters: ${trimmed}`);
	return cleaned;
}

/**
 * Create a project from a template at targetDir. Orchestrates all three steps:
 * 1. Copy template files
 * 2. Run npm install
 * 3. git init
 *
 * The target directory is built from a parent folder and a sanitized project
 * name, so a caller cannot walk above the parent with `..` or absolute paths.
 *
 * @param {string} template
 * @param {string} parentDir
 * @param {string} projectName
 * @param {{ platform?: string }} [deps]
 * @returns {Promise<{ created: boolean, path: string }>}
 */
export async function createProject(template, parentDir, projectName, deps = {}) {
	if (!template || typeof template !== "string" || !template.trim()) {
		throw new Error("A template name is required");
	}
	if (!parentDir || typeof parentDir !== "string" || !parentDir.trim()) {
		throw new Error("A parent directory is required");
	}

	const safeName = sanitizeProjectName(projectName);
	const targetDir = resolve(parentDir.trim(), safeName);

	if (existsSync(targetDir)) {
		throw new Error(`Target directory already exists: ${targetDir}`);
	}

	mkdirSync(targetDir, { recursive: true });

	await copyTemplate(template.trim(), targetDir);
	await runNpmInstall(targetDir, deps);
	await runGitInit(targetDir);

	return { created: true, path: targetDir };
}
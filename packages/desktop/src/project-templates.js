/**
 * Project template creation: copy a template directory, run npm install, and
 * git init. Follows the no-shell, canonicalized execFile pattern from
 * git-commit.js.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/**
 * Recursively copy a named template from the templates directory to targetDir.
 * @param {string} templateName
 * @param {string} targetDir
 * @returns {Promise<{ copied: number }>}
 */
export async function copyTemplate(templateName, targetDir) {
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
 * Run `npm install` in cwd, following the same execFile pattern as runGit in
 * git-commit.js.
 * @param {string} cwd
 * @returns {Promise<{ installed: boolean }>}
 */
export function runNpmInstall(cwd) {
	return new Promise((resolve, reject) => {
		execFile(
			"npm",
			["install"],
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
export async function createProject(template, targetDir) {
	if (!template || typeof template !== "string" || !template.trim()) {
		throw new Error("A template name is required");
	}
	const trimmedTemplate = template.trim();

	if (!targetDir || typeof targetDir !== "string" || !targetDir.trim()) {
		throw new Error("A target directory is required");
	}
	const trimmedTarget = targetDir.trim();

	if (existsSync(trimmedTarget)) {
		throw new Error(`Target directory already exists: ${trimmedTarget}`);
	}

	mkdirSync(trimmedTarget, { recursive: true });

	await copyTemplate(trimmedTemplate, trimmedTarget);
	await runNpmInstall(trimmedTarget);
	await runGitInit(trimmedTarget);

	return { created: true, path: trimmedTarget };
}
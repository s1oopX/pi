import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	MAX_WORKSPACE_FILE_PREVIEW_BYTES,
	readWorkspaceFilePreview,
} from "../src/workspace-file-preview.js";
import { createXlsxFixture } from "./xlsx-fixture.js";

describe("workspace file preview", () => {
	it("previews supported files, caps size, and rejects escaping symlinks", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-workspace-preview-"));
		const workspace = join(root, "workspace");
		const outside = join(root, "outside");
		await Promise.all([mkdir(workspace), mkdir(outside)]);
		try {
			await writeFile(join(workspace, "report.md"), "# Report\n");
			const preview = await readWorkspaceFilePreview(workspace, "report.md");
			assert.equal(preview.path, join(workspace, "report.md"));
			assert.equal(preview.kind, "text");
			assert.equal(preview.mimeType, "text/markdown");
			assert.equal(preview.content, "# Report\n");
			assert.equal(preview.size, 9);
			assert.ok(Number.isFinite(preview.modifiedAt));

			await writeFile(join(workspace, "report.pdf"), "%PDF-1.4\n");
			const pdf = await readWorkspaceFilePreview(workspace, "report.pdf");
			assert.equal(pdf.kind, "pdf");
			assert.equal(pdf.mimeType, "application/pdf");
			assert.equal(Buffer.from(pdf.dataBase64, "base64").toString(), "%PDF-1.4\n");

			await writeFile(join(workspace, "metrics.csv"), 'Name,Note\nAlice,"Line one\nLine two"\n');
			const csv = await readWorkspaceFilePreview(workspace, "metrics.csv");
			assert.equal(csv.kind, "spreadsheet");
			assert.equal(csv.mimeType, "text/csv");
			assert.deepEqual(csv.sheets, [{
				name: "metrics",
				rows: [["Name", "Note"], ["Alice", "Line one\nLine two"]],
			}]);

			await writeFile(join(workspace, "quarterly.xlsx"), createXlsxFixture());
			const xlsx = await readWorkspaceFilePreview(workspace, "quarterly.xlsx");
			assert.equal(xlsx.kind, "spreadsheet");
			assert.equal(xlsx.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
			assert.deepEqual(xlsx.sheets, [{
				name: "Summary",
				rows: [["Metric", "Value"], ["Revenue", "120"]],
			}]);

			await writeFile(join(workspace, "legacy.xls"), "legacy");
			const xls = await readWorkspaceFilePreview(workspace, "legacy.xls");
			assert.equal(xls.kind, "unsupported");
			assert.equal(xls.mimeType, "application/vnd.ms-excel");

			const largePath = join(workspace, "large.txt");
			await writeFile(largePath, "");
			await truncate(largePath, MAX_WORKSPACE_FILE_PREVIEW_BYTES + 1);
			assert.equal((await readWorkspaceFilePreview(workspace, largePath)).kind, "too-large");

			await writeFile(join(outside, "secret.txt"), "secret");
			await symlink(outside, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
			await assert.rejects(
				readWorkspaceFilePreview(workspace, join("escape", "secret.txt")),
				/Path is outside the workspace/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

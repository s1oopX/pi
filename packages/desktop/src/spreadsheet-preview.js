import { posix } from "node:path";
import { inflateRawSync } from "node:zlib";

export const MAX_SPREADSHEET_ROWS = 200;
export const MAX_SPREADSHEET_COLUMNS = 100;
export const MAX_SPREADSHEET_SHEETS = 20;

const MAX_CELL_CHARS = 10_000;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_OUTPUT_BYTES = 64 * 1024 * 1024;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** @typedef {{ name: string, rows: string[][] }} SpreadsheetSheet */
/** @typedef {{ sheets: SpreadsheetSheet[], truncated: boolean }} SpreadsheetPreview */
/** @typedef {{ flags: number, method: number, compressedSize: number, uncompressedSize: number, localOffset: number }} ZipEntry */

/**
 * @param {unknown} value
 * @returns {{ text: string, truncated: boolean }}
 */
function cappedCell(value) {
	const text = String(value ?? "");
	return text.length <= MAX_CELL_CHARS ? { text, truncated: false } : {
		text: `${text.slice(0, MAX_CELL_CHARS)}…`,
		truncated: true,
	};
}

/**
 * @param {string} content
 * @param {string} delimiter
 * @param {string} sheetName
 * @returns {SpreadsheetPreview}
 */
export function parseDelimitedSpreadsheet(content, delimiter, sheetName) {
	/** @type {string[][]} */
	const rows = [];
	/** @type {string[]} */
	let row = [];
	let cell = "";
	let quoted = false;
	let truncated = false;

	/** @param {string} value */
	function append(value) {
		if (cell.length < MAX_CELL_CHARS) cell += value;
		else truncated = true;
	}

	function pushCell() {
		const capped = cappedCell(cell);
		if (row.length < MAX_SPREADSHEET_COLUMNS) row.push(capped.text);
		else truncated = true;
		if (capped.truncated) truncated = true;
		cell = "";
	}

	function pushRow() {
		pushCell();
		if (rows.length < MAX_SPREADSHEET_ROWS) rows.push(row);
		else truncated = true;
		row = [];
	}

	let index = 0;
	for (; index < content.length && rows.length < MAX_SPREADSHEET_ROWS; index += 1) {
		const character = content[index];
		if (quoted) {
			if (character === '"' && content[index + 1] === '"') {
				append('"');
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				append(character);
			}
			continue;
		}
		if (character === '"' && cell.length === 0) {
			quoted = true;
		} else if (character === delimiter) {
			pushCell();
		} else if (character === "\n" || character === "\r") {
			if (character === "\r" && content[index + 1] === "\n") index += 1;
			pushRow();
		} else {
			append(character);
		}
	}

	if (index < content.length) truncated = true;
	else if (cell.length > 0 || row.length > 0 || content.endsWith(delimiter)) pushRow();
	if (rows[0]?.[0]?.startsWith("\uFEFF")) rows[0][0] = rows[0][0].slice(1);
	return { sheets: [{ name: sheetName, rows }], truncated };
}

/**
 * @param {Buffer} archive
 * @returns {number}
 */
function findEndOfCentralDirectory(archive) {
	const lowerBound = Math.max(0, archive.length - 65_557);
	for (let offset = archive.length - 22; offset >= lowerBound; offset -= 1) {
		if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
	}
	throw new Error("Invalid XLSX archive: central directory not found");
}

/** @param {Buffer} archive */
function readZipEntries(archive) {
	const directoryEnd = findEndOfCentralDirectory(archive);
	const disk = archive.readUInt16LE(directoryEnd + 4);
	const centralDisk = archive.readUInt16LE(directoryEnd + 6);
	const entryCount = archive.readUInt16LE(directoryEnd + 10);
	const directorySize = archive.readUInt32LE(directoryEnd + 12);
	const directoryOffset = archive.readUInt32LE(directoryEnd + 16);
	if (disk !== 0 || centralDisk !== 0 || entryCount === 0xffff || directoryOffset === 0xffffffff) {
		throw new Error("Unsupported XLSX archive layout");
	}
	if (directoryOffset + directorySize > directoryEnd) throw new Error("Invalid XLSX central directory");

	/** @type {Map<string, ZipEntry>} */
	const entries = new Map();
	let offset = directoryOffset;
	for (let index = 0; index < entryCount; index += 1) {
		if (offset + 46 > directoryEnd || archive.readUInt32LE(offset) !== ZIP_CENTRAL_FILE_HEADER) {
			throw new Error("Invalid XLSX central directory entry");
		}
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
		if (nextOffset > directoryEnd) throw new Error("Invalid XLSX central directory bounds");
		const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/\\/gu, "/");
		if (!entries.has(name)) {
			entries.set(name, {
				flags: archive.readUInt16LE(offset + 8),
				method: archive.readUInt16LE(offset + 10),
				compressedSize: archive.readUInt32LE(offset + 20),
				uncompressedSize: archive.readUInt32LE(offset + 24),
				localOffset: archive.readUInt32LE(offset + 42),
			});
		}
		offset = nextOffset;
	}
	return entries;
}

/**
 * @param {Buffer} archive
 * @param {ZipEntry} entry
 * @param {{ used: number }} budget
 */
function inflateZipEntry(archive, entry, budget) {
	if ((entry.flags & 1) !== 0) throw new Error("Encrypted XLSX files cannot be previewed");
	if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES || budget.used + entry.uncompressedSize > MAX_ZIP_OUTPUT_BYTES) {
		throw new Error("XLSX preview exceeds the decompression limit");
	}
	if (entry.localOffset + 30 > archive.length || archive.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_FILE_HEADER) {
		throw new Error("Invalid XLSX local file header");
	}
	const nameLength = archive.readUInt16LE(entry.localOffset + 26);
	const extraLength = archive.readUInt16LE(entry.localOffset + 28);
	const dataStart = entry.localOffset + 30 + nameLength + extraLength;
	const dataEnd = dataStart + entry.compressedSize;
	if (dataEnd > archive.length) throw new Error("Invalid XLSX compressed data bounds");
	const compressed = archive.subarray(dataStart, dataEnd);
	let output;
	if (entry.method === 0) output = Buffer.from(compressed);
	else if (entry.method === 8) {
		output = inflateRawSync(compressed, {
			maxOutputLength: Math.min(MAX_ZIP_ENTRY_BYTES, Math.max(1, entry.uncompressedSize + 1)),
		});
	} else {
		throw new Error(`Unsupported XLSX compression method: ${entry.method}`);
	}
	if (output.length !== entry.uncompressedSize) throw new Error("Invalid XLSX uncompressed size");
	budget.used += output.length;
	return output.toString("utf8");
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeXml(value) {
	return value
		.replace(
			/&#x([\da-f]+);/giu,
			/** @param {string} _match @param {string} hex */
			(_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(
			/&#(\d+);/gu,
			/** @param {string} _match @param {string} decimal */
			(_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)),
		)
		.replace(/&lt;/gu, "<")
		.replace(/&gt;/gu, ">")
		.replace(/&quot;/gu, '"')
		.replace(/&apos;/gu, "'")
		.replace(/&amp;/gu, "&");
}

/**
 * @param {string} attributes
 * @param {string} name
 * @returns {string | undefined}
 */
function xmlAttribute(attributes, name) {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu").exec(attributes);
	return match ? decodeXml(match[2]) : undefined;
}

/**
 * @param {string} fragment
 * @param {string} tag
 * @returns {string}
 */
function xmlTagText(fragment, tag) {
	const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(fragment);
	return match ? decodeXml(match[1]) : "";
}

/**
 * @param {string} fragment
 * @returns {string}
 */
function richText(fragment) {
	let text = "";
	for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/giu)) text += decodeXml(match[1]);
	return text;
}

/**
 * @param {string} xml
 * @returns {{ strings: string[], truncated: boolean }}
 */
function parseSharedStrings(xml) {
	/** @type {string[]} */
	const strings = [];
	let truncated = false;
	for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/giu)) {
		if (strings.length >= 100_000) {
			truncated = true;
			break;
		}
		const capped = cappedCell(richText(match[1]));
		strings.push(capped.text);
		if (capped.truncated) truncated = true;
	}
	return { strings, truncated };
}

/**
 * @param {string} reference
 * @returns {number | undefined}
 */
function columnIndex(reference) {
	const letters = /^([a-z]+)/iu.exec(reference)?.[1];
	if (!letters) return undefined;
	let index = 0;
	for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
	return index - 1;
}

/**
 * @param {string} attributes
 * @param {string} body
 * @param {string[]} sharedStrings
 * @returns {string}
 */
function cellValue(attributes, body, sharedStrings) {
	const type = xmlAttribute(attributes, "t");
	if (type === "inlineStr") return richText(body);
	const raw = xmlTagText(body, "v");
	if (type === "s") {
		const index = Number.parseInt(raw, 10);
		return Number.isSafeInteger(index) && index >= 0 ? (sharedStrings[index] ?? raw) : raw;
	}
	if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
	return raw;
}

/**
 * @param {string} xml
 * @param {string} name
 * @param {string[]} sharedStrings
 * @returns {{ sheet: SpreadsheetSheet, truncated: boolean }}
 */
function parseWorksheet(xml, name, sharedStrings) {
	/** @type {string[][]} */
	const rows = [];
	let truncated = false;
	for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/giu)) {
		if (rows.length >= MAX_SPREADSHEET_ROWS) {
			truncated = true;
			break;
		}
		/** @type {string[]} */
		const row = [];
		let nextColumn = 0;
		for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/giu)) {
			const reference = xmlAttribute(cellMatch[1], "r") ?? "";
			const column = columnIndex(reference) ?? nextColumn;
			nextColumn = column + 1;
			if (column >= MAX_SPREADSHEET_COLUMNS) {
				truncated = true;
				continue;
			}
			const capped = cappedCell(cellValue(cellMatch[1], cellMatch[2] ?? "", sharedStrings));
			row[column] = capped.text;
			if (capped.truncated) truncated = true;
		}
		for (let column = 0; column < row.length; column += 1) row[column] ??= "";
		rows.push(row);
	}
	return { sheet: { name, rows }, truncated };
}

/**
 * Read only the workbook structures needed for a bounded grid preview.
 * ponytail: formatting, formulas, charts, and legacy BIFF .xls stay delegated
 * to the system app; add a full workbook engine only when edit fidelity matters.
 * @param {Buffer} archive
 * @returns {SpreadsheetPreview}
 */
export function parseXlsxSpreadsheet(archive) {
	const entries = readZipEntries(archive);
	const budget = { used: 0 };
	/**
	 * @param {string} name
	 * @returns {string | undefined}
	 */
	const readEntry = (name) => {
		const entry = entries.get(name);
		return entry ? inflateZipEntry(archive, entry, budget) : undefined;
	};
	const workbookXml = readEntry("xl/workbook.xml");
	const relationshipsXml = readEntry("xl/_rels/workbook.xml.rels");
	if (!workbookXml || !relationshipsXml) throw new Error("Invalid XLSX workbook structure");

	/** @type {Map<string, string>} */
	const relationships = new Map();
	for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*?)(?:\/>|>)/giu)) {
		const id = xmlAttribute(match[1], "Id");
		const target = xmlAttribute(match[1], "Target")?.replace(/\\/gu, "/");
		if (!id || !target) continue;
		const path = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.normalize(posix.join("xl", target));
		if (path.startsWith("xl/") && !path.includes("../")) relationships.set(id, path);
	}

	const sharedResult = parseSharedStrings(readEntry("xl/sharedStrings.xml") ?? "");
	/** @type {SpreadsheetSheet[]} */
	const sheets = [];
	let truncated = sharedResult.truncated;
	let sheetNumber = 0;
	for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)(?:\/>|>)/giu)) {
		sheetNumber += 1;
		if (sheets.length >= MAX_SPREADSHEET_SHEETS) {
			truncated = true;
			break;
		}
		const relationshipId = xmlAttribute(match[1], "r:id");
		const path = relationshipId ? relationships.get(relationshipId) : undefined;
		const sheetXml = path ? readEntry(path) : readEntry(`xl/worksheets/sheet${sheetNumber}.xml`);
		if (!sheetXml) continue;
		const parsed = parseWorksheet(
			sheetXml,
			xmlAttribute(match[1], "name") || `Sheet ${sheetNumber}`,
			sharedResult.strings,
		);
		sheets.push(parsed.sheet);
		if (parsed.truncated) truncated = true;
	}
	if (sheets.length === 0) throw new Error("XLSX workbook contains no readable sheets");
	return { sheets, truncated };
}

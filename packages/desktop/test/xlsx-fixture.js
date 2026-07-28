import { deflateRawSync } from "node:zlib";

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
	const localParts = [];
	const centralParts = [];
	let localOffset = 0;
	for (const [name, content] of entries) {
		const nameBuffer = Buffer.from(name);
		const source = Buffer.from(content);
		const compressed = deflateRawSync(source);
		const checksum = crc32(source);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(source.length, 22);
		local.writeUInt16LE(nameBuffer.length, 26);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(source.length, 24);
		central.writeUInt16LE(nameBuffer.length, 28);
		central.writeUInt32LE(localOffset, 42);

		localParts.push(local, nameBuffer, compressed);
		centralParts.push(central, nameBuffer);
		localOffset += local.length + nameBuffer.length + compressed.length;
	}
	const centralDirectory = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(localOffset, 16);
	return Buffer.concat([...localParts, centralDirectory, end]);
}

function escapeXml(value) {
	return String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function columnLabel(index) {
	let label = "";
	for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
		label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
	}
	return label;
}

export function createXlsxFixture({
	sheetName = "Summary",
	rows = [["Metric", "Value"], ["Revenue", 120]],
} = {}) {
	const sharedStrings = [];
	const sharedIndexes = new Map();
	function sharedIndex(value) {
		const text = String(value);
		const existing = sharedIndexes.get(text);
		if (existing !== undefined) return existing;
		const index = sharedStrings.length;
		sharedStrings.push(text);
		sharedIndexes.set(text, index);
		return index;
	}
	const sheetRows = rows.map((row, rowIndex) => {
		const cells = row.map((value, columnIndex) => {
			const reference = `${columnLabel(columnIndex)}${rowIndex + 1}`;
			return typeof value === "number"
				? `<c r="${reference}"><v>${value}</v></c>`
				: `<c r="${reference}" t="s"><v>${sharedIndex(value)}</v></c>`;
		}).join("");
		return `<row r="${rowIndex + 1}">${cells}</row>`;
	}).join("");

	return zip([
		["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
		["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'],
		["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
		["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
		["xl/sharedStrings.xml", `<?xml version="1.0"?><sst>${sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("")}</sst>`],
		["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`],
	]);
}

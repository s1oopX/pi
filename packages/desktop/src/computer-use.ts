import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import type { ExtensionAPI } from "../../coding-agent/src/index.ts";

const execFileAsync = promisify(execFile);
const MAX_POWERSHELL_OUTPUT_BYTES = 32 * 1024 * 1024;

const computerUseSchema = Type.Object({
	action: Type.Union([
		Type.Literal("screenshot"),
		Type.Literal("click"),
		Type.Literal("double_click"),
		Type.Literal("move"),
		Type.Literal("type"),
		Type.Literal("key"),
		Type.Literal("scroll"),
		Type.Literal("wait"),
	]),
	x: Type.Optional(Type.Integer({ minimum: 0, description: "X coordinate relative to the latest screenshot." })),
	y: Type.Optional(Type.Integer({ minimum: 0, description: "Y coordinate relative to the latest screenshot." })),
	button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])),
	text: Type.Optional(Type.String({ maxLength: 20_000 })),
	key: Type.Optional(Type.String({ maxLength: 80, description: "One key or chord, for example CTRL+L or ENTER." })),
	deltaY: Type.Optional(Type.Integer({ minimum: -2400, maximum: 2400 })),
	ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
});

type ComputerUseParams = Static<typeof computerUseSchema>;

export interface ComputerUseScreenshot {
	x: number;
	y: number;
	width: number;
	height: number;
	data: string;
}

const POWERSHELL_PREAMBLE = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PiStudioNativeInput {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
}
'@
[PiStudioNativeInput]::SetProcessDPIAware() | Out-Null
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'No interactive Windows desktop is available' }
`;

const POWERSHELL_CAPTURE = `
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$stream = New-Object System.IO.MemoryStream
try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $result = [ordered]@{
        x = $bounds.Left
        y = $bounds.Top
        width = $bounds.Width
        height = $bounds.Height
        data = [Convert]::ToBase64String($stream.ToArray())
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} finally {
    $stream.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
`;

function requireCoordinate(value: number | undefined, name: "x" | "y"): number {
	if (value === undefined) throw new Error(`${name} is required for this computer action`);
	return value;
}

function powershellUtf8(value: string): string {
	const encoded = Buffer.from(value, "utf8").toString("base64");
	return `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`;
}

export function normalizeComputerKey(value: string): string {
	const parts = value
		.trim()
		.toUpperCase()
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) throw new Error("key is required for the key action");

	const modifiers = new Set(parts.slice(0, -1));
	for (const modifier of modifiers) {
		if (modifier !== "CTRL" && modifier !== "ALT" && modifier !== "SHIFT") {
			throw new Error(`Unsupported key modifier: ${modifier}`);
		}
	}

	const namedKeys: Record<string, string> = {
		BACKSPACE: "{BACKSPACE}",
		DELETE: "{DELETE}",
		DOWN: "{DOWN}",
		END: "{END}",
		ENTER: "{ENTER}",
		ESC: "{ESC}",
		ESCAPE: "{ESC}",
		F1: "{F1}",
		F2: "{F2}",
		F3: "{F3}",
		F4: "{F4}",
		F5: "{F5}",
		F6: "{F6}",
		F7: "{F7}",
		F8: "{F8}",
		F9: "{F9}",
		F10: "{F10}",
		F11: "{F11}",
		F12: "{F12}",
		HOME: "{HOME}",
		LEFT: "{LEFT}",
		PAGEDOWN: "{PGDN}",
		PAGEUP: "{PGUP}",
		RIGHT: "{RIGHT}",
		SPACE: " ",
		TAB: "{TAB}",
		UP: "{UP}",
	};
	const key = parts[parts.length - 1];
	const keyToken = namedKeys[key] ?? (/^[A-Z0-9]$/.test(key) ? key.toLowerCase() : undefined);
	if (!keyToken) throw new Error(`Unsupported key: ${key}`);
	return `${modifiers.has("CTRL") ? "^" : ""}${modifiers.has("ALT") ? "%" : ""}${modifiers.has("SHIFT") ? "+" : ""}${keyToken}`;
}

function coordinateScript(x: number, y: number): string {
	return `
if (${x} -ge $bounds.Width -or ${y} -ge $bounds.Height) { throw 'Coordinates are outside the latest screenshot bounds' }
$screenX = $bounds.Left + ${x}
$screenY = $bounds.Top + ${y}
[PiStudioNativeInput]::SetCursorPos($screenX, $screenY) | Out-Null
`;
}

export function buildComputerUseScript(params: ComputerUseParams): string {
	let actionScript = "";
	switch (params.action) {
		case "screenshot":
			break;
		case "move": {
			actionScript = coordinateScript(requireCoordinate(params.x, "x"), requireCoordinate(params.y, "y"));
			break;
		}
		case "click":
		case "double_click": {
			const button = params.button ?? "left";
			const down = button === "right" ? "0x0008" : "0x0002";
			const up = button === "right" ? "0x0010" : "0x0004";
			const count = params.action === "double_click" ? 2 : 1;
			actionScript = `${coordinateScript(requireCoordinate(params.x, "x"), requireCoordinate(params.y, "y"))}
for ($i = 0; $i -lt ${count}; $i++) {
    [PiStudioNativeInput]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)
    [PiStudioNativeInput]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)
    if ($i -lt ${count - 1}) { Start-Sleep -Milliseconds 90 }
}`;
			break;
		}
		case "type": {
			if (params.text === undefined) throw new Error("text is required for the type action");
			actionScript = `
$text = ${powershellUtf8(params.text)}
$previousClipboard = $null
try { $previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject() } catch {}
try {
    [System.Windows.Forms.Clipboard]::SetText($text)
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 150
} finally {
    if ($null -ne $previousClipboard) {
        try { [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true) } catch {}
    }
}
`;
			break;
		}
		case "key": {
			if (params.key === undefined) throw new Error("key is required for the key action");
			actionScript = `[System.Windows.Forms.SendKeys]::SendWait(${powershellUtf8(normalizeComputerKey(params.key))})`;
			break;
		}
		case "scroll": {
			if (params.deltaY === undefined || params.deltaY === 0)
				throw new Error("A non-zero deltaY is required for scrolling");
			const move =
				params.x !== undefined || params.y !== undefined
					? coordinateScript(requireCoordinate(params.x, "x"), requireCoordinate(params.y, "y"))
					: "";
			actionScript = `${move}
[PiStudioNativeInput]::mouse_event(0x0800, 0, 0, ${-params.deltaY}, [UIntPtr]::Zero)`;
			break;
		}
		case "wait":
			actionScript = `Start-Sleep -Milliseconds ${params.ms ?? 1000}`;
			break;
	}

	const settle = params.action === "screenshot" || params.action === "wait" ? "" : "Start-Sleep -Milliseconds 150";
	return `${POWERSHELL_PREAMBLE}\n${actionScript}\n${settle}\n${POWERSHELL_CAPTURE}`;
}

export function parseComputerUseScreenshot(stdout: string): ComputerUseScreenshot {
	const parsed = JSON.parse(stdout.trim()) as Partial<ComputerUseScreenshot>;
	if (
		typeof parsed.x !== "number" ||
		typeof parsed.y !== "number" ||
		typeof parsed.width !== "number" ||
		typeof parsed.height !== "number" ||
		parsed.width <= 0 ||
		parsed.height <= 0 ||
		typeof parsed.data !== "string" ||
		parsed.data.length === 0
	) {
		throw new Error("Computer Use returned an invalid screenshot");
	}
	return parsed as ComputerUseScreenshot;
}

export async function runComputerUseAction(
	params: ComputerUseParams,
	signal?: AbortSignal,
): Promise<ComputerUseScreenshot> {
	if (process.platform !== "win32") throw new Error("Computer Use is currently available only on Windows");
	const encoded = Buffer.from(buildComputerUseScript(params), "utf16le").toString("base64");
	const { stdout } = await execFileAsync(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
		{
			encoding: "utf8",
			maxBuffer: MAX_POWERSHELL_OUTPUT_BYTES,
			timeout: 45_000,
			windowsHide: true,
			signal,
		},
	);
	return parseComputerUseScreenshot(stdout);
}

export function computerUseExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "computer_use",
		label: "Computer Use",
		description:
			"Capture and control the Windows desktop. Actions return a fresh screenshot; coordinates are relative to that screenshot.",
		promptSnippet: "Use the Windows desktop through screenshots, clicks, typing, keys, scrolling, and waits",
		promptGuidelines: [
			"Inspect the latest computer_use screenshot before clicking; never guess coordinates from an older layout.",
			"Coordinates are relative to the returned screenshot, including when the virtual desktop begins at a negative monitor coordinate.",
			"Use the fewest actions needed and stop when the requested UI outcome is visibly confirmed.",
		],
		parameters: computerUseSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const screenshot = await runComputerUseAction(params, signal);
			return {
				content: [
					{
						type: "text",
						text: `Computer action ${params.action} complete. Screenshot ${screenshot.width}x${screenshot.height}; use coordinates relative to its top-left corner.`,
					},
					{ type: "image", mimeType: "image/png", data: screenshot.data },
				],
				details: {
					action: params.action,
					bounds: { x: screenshot.x, y: screenshot.y, width: screenshot.width, height: screenshot.height },
				},
			};
		},
	});
}

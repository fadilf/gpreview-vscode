import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
	const provider = new GPreviewEditorProvider(context);
	const registration = vscode.window.registerCustomEditorProvider('gpreview.vi', provider);
	context.subscriptions.push(registration);
}

class GPreviewEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return new GPreviewDocument(uri);
    }

    async resolveCustomEditor(
        document: GPreviewDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Configure webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.file(path.dirname(document.uri.fsPath))
            ]
        };

        // Set initial HTML content
        webviewPanel.webview.html = await this.getWebviewContent(document, webviewPanel.webview);

        // Handle file changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(document, webviewPanel.webview);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private async getWebviewContent(document: GPreviewDocument, webview: vscode.Webview): Promise<string> {
        try {
			return await document.readFile();

        } catch (error) {
            return this.getErrorContent(error as Error);
        }
    }

    private getErrorContent(error: Error): string {
        const config = vscode.workspace.getConfiguration('gpreview');
        const viServerPort = config.get<number>('viServerPort', 3363);
        let labViewFilePath = config.get<string>('labViewFilePath', '');
        if (labViewFilePath === '') {
            labViewFilePath = 'empty (uses last opened version of LabVIEW on Windows)';
        }
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        background-color: var(--vscode-inputValidation-errorBackground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
                        padding: 15px;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <h3>Error Loading VI File</h3>
                    <p>${error.message}</p>
                    <p>Please ensure your VI converter script is properly configured. Check the VI Server port and executable file path in the settings.</p>
                    <p>Configuration:</p>
                    <ul>
                        <li>viServerPort: ${viServerPort}</li>
                        <li>labViewFilePath: ${labViewFilePath}</li>
                    </ul>
                </div>
            </body>
            </html>
        `;
    }

    private async updateWebview(document: GPreviewDocument, webview: vscode.Webview): Promise<void> {
        webview.html = await this.getWebviewContent(document, webview);
    }
}

export class GPreviewDocument implements vscode.CustomDocument {
    constructor(public readonly uri: vscode.Uri) {}

    async readFile() {
        const wsBytes = new Uint8Array(await vscode.workspace.fs.readFile(this.uri));
        if (fs.existsSync(this.uri.fsPath)) {
            const fsBytes = new Uint8Array(fs.readFileSync(this.uri.fsPath));
            if (Buffer.compare(wsBytes, fsBytes) === 0) {
                return await GPreviewDocument.convertViToHtml(this.uri.fsPath);
            }
        }
        vscode.window.showWarningMessage("VI is being read from bytes outside of environment. Rendering may be affected.");
        const tmpViFilePath = path.normalize(os.tmpdir() + "/" + crypto.randomBytes(16).toString('hex') + ".vi");
        fs.writeFileSync(tmpViFilePath, wsBytes);
        const htmlRender = await GPreviewDocument.convertViToHtml(tmpViFilePath);
        fs.unlinkSync(tmpViFilePath);
        return htmlRender;
    }

    static async convertViToHtml(viFilePath: string): Promise<string> {
        // Hold the lockfile for the entire execution of execAsync
        const lockfilePath = path.join(os.tmpdir(), 'gpreview-vi-convert-exec.lock');
        const waitForLockRelease = async (timeoutMs = 60000) => {
            const start = Date.now();
            while (fs.existsSync(lockfilePath)) {
                if (Date.now() - start > timeoutMs) {
                    throw new Error('Timeout waiting for VI conversion lockfile to be released.');
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
        await waitForLockRelease();
        fs.writeFileSync(lockfilePath, String(process.pid));
        try {
            const config = vscode.workspace.getConfiguration('gpreview');
            const viServerPort = config.get<number>('viServerPort', 3363);
            const directory = __dirname + "/../gpreview-labview/";
            const outputFilePath = path.normalize(os.tmpdir() + "/" + crypto.randomBytes(16).toString('hex') + ".html");
            const cliPath = path.normalize(directory + "CLI.vi");
            const normalizedViFilePath = path.resolve(path.normalize(viFilePath));
            let cmd = `LabVIEWCLI -OperationName RunVI `;
            const labViewFilePath = config.get<string>('labViewFilePath', '');
            if (labViewFilePath !== '') {
                const normalizedLabViewFilePath = path.normalize(labViewFilePath);
                cmd += `-LabVIEWPath "${normalizedLabViewFilePath}" `;
            }
            cmd += `-PortNumber ${viServerPort} -VIPath "${cliPath}" "${normalizedViFilePath}" "${outputFilePath}" ${viServerPort}`;
            const { stderr } = await execAsync(cmd);

            if (stderr) {
                console.warn('Conversion warning:', stderr);
            }
			const file = fs.readFileSync(outputFilePath, 'utf-8');
            fs.unlink(outputFilePath,  (error) => {
                if (error) {throw new Error(`Failed to convert VI file: ${error}`);}
            });

            return file || '<div class="loading">Processing VI file...</div>';
        } catch (error) {
            console.error('Error converting VI file:', error);
            throw new Error(`Failed to convert VI file: ${error}`);
        } finally {
            if (fs.existsSync(lockfilePath)) {
                try { fs.unlinkSync(lockfilePath); } catch (e) { /* ignore */ }
            }
        }
    }

    dispose(): void {}
}

export function deactivate() {}

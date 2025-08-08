import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { readFileSync, unlink } from 'fs';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
	const provider = new GPreviewEditorProvider(context);
	const registration = vscode.window.registerCustomEditorProvider('gpreview.vi', provider);
	context.subscriptions.push(registration);
}

export class GPreviewEditorProvider implements vscode.CustomReadonlyEditorProvider {
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
            const htmlContent = await this.convertViToHtml(document.uri.fsPath);
			return htmlContent;

        } catch (error) {
            return this.getErrorContent(error as Error);
        }
    }

    async convertViToHtml(viFilePath: string): Promise<string> {
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
            
			const file = readFileSync(outputFilePath, 'utf-8');
            unlink(outputFilePath,  (error) => {
                if (error) {throw new Error(`Failed to convert VI file: ${error}`);}
            });

            return file || '<div class="loading">Processing VI file...</div>';
        } catch (error) {
            console.error('Error converting VI file:', error);
            throw new Error(`Failed to convert VI file: ${error}`);
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

class GPreviewDocument implements vscode.CustomDocument {
    constructor(public readonly uri: vscode.Uri) {}

    dispose(): void {}
}

export function deactivate() {}

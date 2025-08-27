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
                    <p>If this error persists, consider raising an issue in the repository: <a href="https://github.com/fadilf/gpreview-vscode/issues">https://github.com/fadilf/gpreview-vscode/issues</a>.</p>
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
    /**
     * Copies the entire VS Code workspace virtual filesystem to a real folder in the temp directory.
     * Returns the path to the temp folder.
     */
    static async copyWorkspaceFsToTempFolder(): Promise<string> {
        const tempDir = path.join(os.tmpdir(), 'gpreview-vscode-fs-' + crypto.randomBytes(8).toString('hex'));
        fs.mkdirSync(tempDir, { recursive: true });
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folders found.');
        }
        // Helper to recursively copy
        async function copyDir(vsUri: vscode.Uri, realPath: string) {
            fs.mkdirSync(realPath, { recursive: true });
            const entries = await vscode.workspace.fs.readDirectory(vsUri);
            for (const [name, type] of entries) {
                const childVsUri = vscode.Uri.joinPath(vsUri, name);
                const childRealPath = path.join(realPath, name);
                if (type === vscode.FileType.Directory) {
                    await copyDir(childVsUri, childRealPath);
                } else if (type === vscode.FileType.File) {
                    const data = await vscode.workspace.fs.readFile(childVsUri);
                    fs.writeFileSync(childRealPath, data);
                }
                // Symlinks and unknown types are ignored
            }
        }
        for (const folder of workspaceFolders) {
            const folderName = path.basename(folder.uri.fsPath);
            const targetFolder = path.join(tempDir, folderName);
            await copyDir(folder.uri, targetFolder);
        }
        return tempDir;
    }
    constructor(public readonly uri: vscode.Uri) {}

    async readFile() {
        if (['git', 'gitlens'].includes(this.uri.scheme)) {
            // Extract commit hash from URI query
            let commitHash = JSON.parse(this.uri.query)["ref"];
            if (commitHash === "~") {
                commitHash = "HEAD";
            }
            if (!commitHash) {
                throw new Error('Could not determine commit hash from git URI.');
            }
            // Get repo root using git rev-parse
            const fileDir = path.dirname(this.uri.fsPath);
            const { execSync } = require('child_process');
            let repoRoot;
            try {
                repoRoot = execSync(`git -C "${fileDir}" rev-parse --show-toplevel`, { encoding: 'utf-8' }).trim();
            } catch (e) {
                throw new Error('Could not determine git repository root for file: ' + this.uri.fsPath);
            }
            const tempDir = path.join(os.tmpdir(), 'gpreview-gitfs-' + crypto.randomBytes(8).toString('hex'));
            fs.mkdirSync(tempDir, { recursive: true });
            // Clone and checkout the repo at the commit
            execSync(`git clone --no-checkout "${repoRoot}" "${tempDir}"`);
            execSync(`git -C "${tempDir}" checkout ${commitHash} -- .`);
            // Find the file path relative to repo root
            const relFilePath = path.relative(repoRoot, this.uri.fsPath);
            const filePath = path.join(tempDir, relFilePath);
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found in checked out commit.');
            }
            const htmlRender = await GPreviewDocument.convertViToHtml(filePath);
            fs.rmSync(tempDir, { recursive: true, force: true });
            return htmlRender;
        }

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

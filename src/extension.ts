import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';
import * as properLockfile from 'proper-lockfile';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
	GPreviewDocument.cleanupStaleGitTempFolders();
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
    private static readonly gitTempFolderPrefix = 'gpreview-gitfs-';
    private static readonly staleGitTempFolderAgeMs = 24 * 60 * 60 * 1000;

    static cleanupStaleGitTempFolders(): void {
        const tempRoot = os.tmpdir();
        const staleBefore = Date.now() - GPreviewDocument.staleGitTempFolderAgeMs;
        const folderNamePattern = /^gpreview-gitfs-(\d{13})-[a-f0-9]{16}$/;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(tempRoot, { withFileTypes: true });
        } catch (error) {
            console.warn('Unable to inspect temporary directory for stale GPreview folders:', error);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const match = folderNamePattern.exec(entry.name);
            if (!match) {
                continue;
            }

            const timestamp = Number(match[1]);
            if (!Number.isSafeInteger(timestamp) || timestamp > staleBefore) {
                continue;
            }

            GPreviewDocument.removeGitTempFolder(path.join(tempRoot, entry.name));
        }
    }

    private static createGitTempFolder(): string {
        const folderName = `${GPreviewDocument.gitTempFolderPrefix}${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        const tempDir = path.join(os.tmpdir(), folderName);
        fs.mkdirSync(tempDir, { recursive: true });
        return tempDir;
    }

    private static removeGitTempFolder(tempDir: string): void {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch (error) {
            console.warn('Unable to remove temporary GPreview Git folder:', tempDir, error);
        }
    }

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
        let commitHash: string | undefined;
        if (['git', 'gitlens'].includes(this.uri.scheme)) {
            // A ref is present for historical revisions. Ref-less Git/GitLens
            // URIs can represent staged, working-tree, or diff content, which
            // must be read through VS Code's virtual filesystem below.
            try {
                const query = JSON.parse(this.uri.query || '{}') as { ref?: unknown };
                if (typeof query.ref === 'string' && query.ref.length > 0) {
                    commitHash = query.ref;
                }
            } catch {
                // Fall back to the virtual filesystem for an unrecognised URI.
            }
            if (commitHash === "~") {
                commitHash = "HEAD";
            }
        }

        if (commitHash) {
            // Get repo root using git rev-parse
            const fileDir = path.dirname(this.uri.fsPath);
            const { execSync } = require('child_process');
            let repoRoot;
            try {
                repoRoot = execSync(`git -C "${fileDir}" rev-parse --show-toplevel`, { encoding: 'utf-8' }).trim();
            } catch (e) {
                throw new Error('Could not determine git repository root for file: ' + this.uri.fsPath);
            }
            // By default, read only the blob to avoid slow clones and NTFS
            // case-collision errors. An opt-in full checkout supports projects
            // whose LabVIEW dependencies are resolved relative to the VI.
            const relFilePath = path.relative(repoRoot, this.uri.fsPath).replace(/\\/g, '/');
            const checkoutGitDependencies = vscode.workspace
                .getConfiguration('gpreview')
                .get<boolean>('checkoutGitDependencies', false);
            const tempDir = GPreviewDocument.createGitTempFolder();
            try {
                let filePath: string;
                if (checkoutGitDependencies) {
                    // A complete checkout preserves relative LabVIEW dependencies.
                    execSync(`git clone --no-checkout "${repoRoot}" "${tempDir}"`);
                    execSync(`git -C "${tempDir}" checkout --detach ${commitHash}`);
                    filePath = path.join(tempDir, relFilePath);
                    if (!fs.existsSync(filePath)) {
                        throw new Error('File not found in checked out commit.');
                    }
                } else {
                    // Reading only the blob avoids slow clones and NTFS case-collision
                    // errors when dependencies are not required for rendering.
                    filePath = path.join(tempDir, path.basename(relFilePath));
                    const blob = execSync(
                        `git -C "${repoRoot}" show ${commitHash}:"${relFilePath}"`,
                        { encoding: 'buffer', maxBuffer: 1024 * 1024 * 512 }
                    );
                    fs.writeFileSync(filePath, blob);
                }
                const htmlRender = await GPreviewDocument.convertViToHtml(filePath);
                return htmlRender;
            } catch (e: any) {
                throw new Error('Could not read file at commit ' + commitHash + ': ' + (e?.message ?? e));
            } finally {
                GPreviewDocument.removeGitTempFolder(tempDir);
            }
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
        // Use a new lock target so stale files from the legacy lock cannot block
        // conversions after upgrading. proper-lockfile creates an atomic lock
        // directory and refreshes its mtime while the conversion is running.
        const lockTargetPath = path.join(os.tmpdir(), 'gpreview-vi-convert-exec-v2');
        let releaseLock: (() => Promise<void>) | undefined;
        let compromisedLockError: Error | undefined;
        let conversionError: unknown;
        try {
            releaseLock = await properLockfile.lock(lockTargetPath, {
                realpath: false,
                stale: 30_000,
                update: 5_000,
                retries: {
                    retries: 600,
                    factor: 1,
                    minTimeout: 100,
                    maxTimeout: 100
                },
                onCompromised: error => {
                    compromisedLockError = error;
                    console.error('GPreview conversion lock was compromised:', error);
                }
            });

            const config = vscode.workspace.getConfiguration('gpreview');
            const viServerPort = config.get<number>('viServerPort', 3363);
            const defaultTab = config.get<string>('defaultTab', '');
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
            cmd += `-PortNumber ${viServerPort} -VIPath "${cliPath}" --default-tab=${defaultTab} "${normalizedViFilePath}" "${outputFilePath}"`;
            const { stderr } = await execAsync(cmd);

            if (stderr) {
                console.warn('Conversion warning:', stderr);
            }

            if (compromisedLockError) {
                throw compromisedLockError;
            }

			const file = fs.readFileSync(outputFilePath, 'utf-8');
            fs.unlink(outputFilePath,  (error) => {
                if (error) {throw new Error(`Failed to convert VI file: ${error}`);}
            });

            return file || '<div class="loading">Processing VI file...</div>';
        } catch (error) {
            conversionError = error;
            console.error('Error converting VI file:', error);
            throw new Error(`Failed to convert VI file: ${error}`);
        } finally {
            if (releaseLock) {
                try {
                    await releaseLock();
                } catch (error) {
                    console.warn('Unable to release GPreview conversion lock:', error);
                    if (!conversionError) {
                        throw new Error(`Failed to release GPreview conversion lock: ${error}`);
                    }
                }
            }
        }
    }

    dispose(): void {}
}

export function deactivate() {}

import * as vscode from 'vscode';
import { DiagnosticsViewProvider } from './diagnosticsViewProvider.mjs';
import { TagStore } from './storage/tagStore.mjs';
import { StatsStore } from './storage/statsStore.mjs';
import { SheetsSync } from './google/sheetsSync.mjs';
import { TagTreeProvider } from './ui/tagTreeProvider.mjs';
import { TagCodeActionProvider } from './codeActions/tagCodeActionProvider.mjs';
import { generateResourceId } from './utils/hashing.mjs';

// Global stores
let tagStore: TagStore;
let statsStore: StatsStore;
let sheetsSync: SheetsSync;
let tagTreeProvider: TagTreeProvider;

export async function activate(context: vscode.ExtensionContext) {
    const provider = new DiagnosticsViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            DiagnosticsViewProvider.viewType,
            provider
        )
    );

    // Register commands (they check store readiness internally)
    registerCommands(context);

    // Initialize stores asynchronously (non-blocking)
    Promise.all([
        TagStore.init(context),
        StatsStore.init(context),
        SheetsSync.init(context)
    ]).then(([tag, stats, sheets]) => {
        tagStore = tag;
        statsStore = stats;
        sheetsSync = sheets;

        // Initialize tag tree provider
        tagTreeProvider = new TagTreeProvider(tagStore);
        
        // Register tag tree view
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('tellmeTags', tagTreeProvider)
        );

        // Register code action provider for tagging diagnostics
        const tagCodeActionProvider = new TagCodeActionProvider(tagStore);
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                { scheme: 'file', language: 'cpp' },
                tagCodeActionProvider,
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
            )
        );
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                { scheme: 'file', language: 'c' },
                tagCodeActionProvider,
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
            )
        );

        // Pass stores to provider
        provider.setStores(tagStore, statsStore, sheets);

        // Start status bar updates
        startStatusBar(context);

        console.log('Tell-me stores initialized successfully');
    }).catch(err => {
        console.error('Failed to initialize Tell-me stores:', err);
        console.error('Error details:', err.stack);
        vscode.window.showErrorMessage(`Tell-me: Failed to initialize extension stores - ${err.message}`);
    });
}

function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.tag.add', async () => {
            if (!tagStore) {
                vscode.window.showWarningMessage('Tag store is still initializing. Please wait a moment.');
                return;
            }

            // Show management options
            const action = await vscode.window.showQuickPick([
                { label: '$(add) Create New Tag', action: 'create' },
                { label: '$(trash) Delete a Tag', action: 'delete' },
                { label: '$(list-unordered) View All Tags', action: 'view' }
            ], {
                placeHolder: 'What would you like to do?'
            });

            if (!action) {
                return;
            }

            if (action.action === 'create') {
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Enter tag name',
                    prompt: 'Create a new tag'
                });

                if (name) {
                    const description = await vscode.window.showInputBox({
                        placeHolder: 'Optional description',
                        prompt: 'Tag description (optional)'
                    });

                    await tagStore.createTag(name, { description });
                    tagTreeProvider?.refresh();
                    vscode.window.showInformationMessage(`Tag "${name}" created!`);
                }
            } else if (action.action === 'delete') {
                const allTags = await tagStore.listTags();
                
                if (allTags.length === 0) {
                    vscode.window.showInformationMessage('No tags to delete');
                    return;
                }

                const tagToDelete = await vscode.window.showQuickPick(
                    allTags.map(tag => ({
                        label: `$(tag) ${tag.label}`,
                        description: tag.description,
                        id: tag.id
                    })),
                    { placeHolder: 'Select a tag to delete' }
                );

                if (tagToDelete) {
                    const confirmed = await vscode.window.showWarningMessage(
                        `Delete tag "${tagToDelete.label.replace('$(tag) ', '')}"?`,
                        'Delete',
                        'Cancel'
                    );

                    if (confirmed === 'Delete') {
                        await tagStore.deleteTag(tagToDelete.id);
                        tagTreeProvider?.refresh();
                        vscode.window.showInformationMessage('Tag deleted!');
                    }
                }
            } else if (action.action === 'view') {
                const allTags = await tagStore.listTags();
                
                if (allTags.length === 0) {
                    vscode.window.showInformationMessage('No tags created yet. Create your first tag!');
                    return;
                }

                const tagStats = await tagStore.getTagStats();
                const statsMap = new Map(tagStats.map(s => [s.tagId, s.count]));

                const items = allTags.map(tag => ({
                    label: `$(tag) ${tag.label}`,
                    description: tag.description || '',
                    detail: `Used ${statsMap.get(tag.id) || 0} times • Created: ${new Date(tag.createdAt).toLocaleDateString()}`
                }));

                await vscode.window.showQuickPick(items, {
                    placeHolder: 'Your Tags',
                    matchOnDescription: true,
                    matchOnDetail: true
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.tag.addToDiagnostic', async (filePath: string, diagnostic: vscode.Diagnostic) => {
            if (!tagStore) {
                vscode.window.showWarningMessage('Tag store is still initializing. Please wait a moment and try again.');
                return;
            }

            // Get all tags
            const allTags = await tagStore.listTags();
            
            // Show quick pick with existing tags + "Create new tag" + "Delete tag" options
            const items = [
                { label: '$(add) Create New Tag', id: '__create_new__' },
                { label: '$(trash) Delete a Tag', id: '__delete__' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                ...allTags.map(tag => ({ 
                    label: `$(tag) ${tag.label}`, 
                    description: tag.description,
                    id: tag.id 
                }))
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a tag, create new, or delete existing',
                matchOnDescription: true
            });

            if (!selected) {
                return;
            }

            let tagId = selected.id;

            // Delete tag if requested
            if (tagId === '__delete__') {
                if (allTags.length === 0) {
                    vscode.window.showInformationMessage('No tags to delete');
                    return;
                }

                const tagToDelete = await vscode.window.showQuickPick(
                    allTags.map(tag => ({
                        label: `$(tag) ${tag.label}`,
                        description: tag.description,
                        id: tag.id
                    })),
                    { placeHolder: 'Select a tag to delete' }
                );

                if (!tagToDelete) {
                    return;
                }

                const confirmed = await vscode.window.showWarningMessage(
                    `Delete tag "${tagToDelete.label.replace('$(tag) ', '')}"?`,
                    'Delete',
                    'Cancel'
                );

                if (confirmed === 'Delete') {
                    await tagStore.deleteTag(tagToDelete.id);
                    tagTreeProvider?.refresh();
                    vscode.window.showInformationMessage('Tag deleted!');
                }
                return;
            }

            // Create new tag if requested
            if (tagId === '__create_new__') {
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Enter tag name',
                    prompt: 'Tag name'
                });

                if (!name) {
                    return;
                }

                const newTag = await tagStore.createTag(name, { 
                    source: 'manual'
                });
                tagId = newTag.id;
                tagTreeProvider?.refresh();
            }

            // Generate resource ID for this diagnostic
            const diagnosticId = `${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.code || 'error'}`;
            const resourceId = generateResourceId(filePath, diagnosticId);

            // Assign tag with location data for click-to-highlight feature
            if (typeof tagId === 'string') {
                await tagStore.assignTag(resourceId, tagId, 'manual', undefined, {
                    filePath,
                    range: {
                        start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
                        end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character }
                    }
                });
            }
            
            vscode.window.showInformationMessage(`Tag added to error!`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.sync.connect', async () => {            // If already connected, just sync the data
            if (sheetsSync?.isConnected()) {
                await vscode.commands.executeCommand('tellme.sync.pushNow');
                return;
            }
            const clientId = await vscode.window.showInputBox({
                placeHolder: 'Paste your Google OAuth Client ID',
                prompt: 'Enter Google OAuth 2.0 Client ID (from Google Cloud Console)'
            });

            if (clientId && sheetsSync) {
                try {
                    vscode.window.showInformationMessage('Opening browser for authentication...');
                    const result = await sheetsSync.connect(clientId);
                    vscode.window.showInformationMessage(`Connected! Sheet URL: ${result.sheetUrl}`);
                } catch (err) {
                    vscode.window.showErrorMessage(`Connection failed: ${(err as Error).message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.sync.pushNow', async () => {
            if (!sheetsSync || !sheetsSync.isConnected()) {
                vscode.window.showErrorMessage('Not connected to Google Sheets. Use "Connect Google Sheets" command first.');
                return;
            }

            try {
                vscode.window.showInformationMessage('Syncing to Google Sheets...');
                const result = await sheetsSync.pushPending('', 50);
                if (result.errors.length > 0) {
                    vscode.window.showErrorMessage(`Sync completed with errors: ${result.errors.join(', ')}`);
                } else {
                    vscode.window.showInformationMessage(`Synced ${result.synced} records successfully!`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Sync failed: ${(err as Error).message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.stats.show', async () => {
            if (!statsStore) {
                vscode.window.showErrorMessage('Stats store not initialized');
                return;
            }

            const stats = await statsStore.getAggregateStats();
            const message = `📊 Tell-me Statistics\n\nTotal Analyses: ${stats.totalAnalyses}\nAverage Duration: ${stats.avgDuration}ms\nSuccess Rate: ${(stats.successRate * 100).toFixed(1)}%`;
            vscode.window.showInformationMessage(message, { modal: true });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.data.export', async () => {
            if (!statsStore) {
                vscode.window.showErrorMessage('Stats store not initialized');
                return;
            }

            const json = await statsStore.exportJson();
            await vscode.env.clipboard.writeText(json);
            vscode.window.showInformationMessage('Data exported to clipboard!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.data.delete', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                'Delete all analysis records and statistics?',
                { modal: true },
                'Delete',
                'Cancel'
            );

            if (confirmed === 'Delete' && statsStore) {
                await statsStore.clearAllData();
                vscode.window.showInformationMessage('All statistics cleared!');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.data.clearAll', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                'Clear ALL extension data? This will delete:\n• All tags and assignments\n• All analysis records and statistics\n• Google Sheets connection\n\nThis cannot be undone!',
                { modal: true },
                'Clear Everything',
                'Cancel'
            );

            if (confirmed === 'Clear Everything') {
                try {
                    // Clear all stores
                    if (statsStore) await statsStore.clearAllData();
                    if (tagStore) {
                        const allTags = await tagStore.listTags();
                        let deleted = 0;
                        let failed = 0;
                        
                        for (const tag of allTags) {
                            try {
                                await tagStore.deleteTag(tag.id);
                                deleted++;
                            } catch (error) {
                                console.error(`Failed to delete tag ${tag.label}:`, error);
                                failed++;
                            }
                        }
                        
                        if (failed > 0) {
                            console.warn(`Deleted ${deleted} tags, ${failed} failed`);
                        }
                    }
                    if (sheetsSync) {
                        // Clear connection state
                        await context.globalState.update('sheetsConnection', undefined);
                    }

                    // Clear all global state
                    await context.globalState.update('statsStore:state', undefined);
                    await context.globalState.update('tagStore:state', undefined);

                    tagTreeProvider?.refresh();
                    vscode.window.showInformationMessage('All extension data cleared! Reload the window to complete reset.');
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to clear data: ${(err as Error).message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.extension.resetToDefaults', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                'Reset extension to factory defaults? This will:\n• Clear ALL extension data\n• Reset ALL settings to defaults\n• Remove API key and Google connection\n\nThis cannot be undone!',
                { modal: true },
                'Reset to Defaults',
                'Cancel'
            );

            if (confirmed === 'Reset to Defaults') {
                try {
                    // Clear all data first
                    if (statsStore) await statsStore.clearAllData();
                    if (tagStore) {
                        const allTags = await tagStore.listTags();
                        for (const tag of allTags) {
                            await tagStore.deleteTag(tag.id);
                        }
                    }

                    // Clear all global state
                    for (const key of context.globalState.keys()) {
                        await context.globalState.update(key, undefined);
                    }

                    // Clear all workspace state
                    for (const key of context.workspaceState.keys()) {
                        await context.workspaceState.update(key, undefined);
                    }

                    // Reset all settings to default
                    const config = vscode.workspace.getConfiguration();
                    await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.model', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.temperature', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.topP', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.topK', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.maxTokens', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.enableTags', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.enableAutoTag', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.enableStats', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.googleSheets.clientId', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.googleSheets.autoSync', undefined, vscode.ConfigurationTarget.Global);
                    await config.update('tellMe.googleSheets.syncInterval', undefined, vscode.ConfigurationTarget.Global);

                    tagTreeProvider?.refresh();
                    vscode.window.showInformationMessage('Extension reset to factory defaults! Reload the window to complete reset.');
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to reset extension: ${(err as Error).message}`);
                }
            }
        })
    );

    // Show tag locations with highlighting
    context.subscriptions.push(
        vscode.commands.registerCommand('tellme.tag.showLocations', async (tag: any) => {
            if (!tagStore) {
                vscode.window.showWarningMessage('Tag store is not ready');
                return;
            }

            const assignments = await tagStore.getTagAssignments(tag.id);
            const locationsWithData = assignments.filter(a => a.filePath && a.range);

            if (locationsWithData.length === 0) {
                vscode.window.showInformationMessage(`Tag "${tag.label}" has no saved locations to display.`);
                return;
            }

            // If only one location, open it directly
            if (locationsWithData.length === 1) {
                const assignment = locationsWithData[0];
                await highlightTagLocation(assignment.filePath!, assignment.range!);
                return;
            }

            // Multiple locations - show quick pick
            const items = locationsWithData.map(a => ({
                label: `$(file) ${vscode.workspace.asRelativePath(a.filePath!)}`,
                description: `Line ${a.range!.start.line + 1}`,
                detail: `Tagged ${new Date(a.assignedAt).toLocaleString()}`,
                assignment: a
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select location for tag "${tag.label}"`
            });

            if (selected) {
                await highlightTagLocation(selected.assignment.filePath!, selected.assignment.range!);
            }
        })
    );
}

async function highlightTagLocation(
    filePath: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
) {
    try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(document);

        const vsRange = new vscode.Range(
            new vscode.Position(range.start.line, range.start.character),
            new vscode.Position(range.end.line, range.end.character)
        );

        // Create green highlight decoration
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(0, 255, 0, 0.3)',
            border: '2px solid rgba(0, 255, 0, 0.8)',
            borderRadius: '3px'
        });

        // Apply decoration
        editor.setDecorations(decorationType, [vsRange]);
        
        // Reveal the range
        editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenter);

        // Remove decoration after 5 seconds
        setTimeout(() => {
            decorationType.dispose();
        }, 5000);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open location: ${(error as Error).message}`);
    }
}

function startStatusBar(context: vscode.ExtensionContext) {
    // Register status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'tellme.stats.show';
    statusBarItem.tooltip = 'Show Tell-me statistics';
    context.subscriptions.push(statusBarItem);

    // Update status bar periodically
    const updateStatusBar = async () => {
        if (statsStore) {
            const pending = await statsStore.getPendingForSync();
            statusBarItem.text = `📊 Tell-me: ${pending.length} pending`;
            statusBarItem.show();
        }
    };

    updateStatusBar();
    const statusBarInterval = setInterval(updateStatusBar, 30000);
    context.subscriptions.push(new vscode.Disposable(() => clearInterval(statusBarInterval)));
}

export function deactivate() {}

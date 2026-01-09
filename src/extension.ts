import * as vscode from 'vscode';
import { DiagnosticsViewProvider } from './diagnosticsViewProvider.mjs';

export function activate(context: vscode.ExtensionContext) {
    const provider = new DiagnosticsViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            DiagnosticsViewProvider.viewType,
            provider
        )
    );
}

export function deactivate() {}

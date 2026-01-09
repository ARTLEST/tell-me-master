import * as vscode from 'vscode';
import { TagStore } from '../storage/tagStore.mjs';
import { generateResourceId } from '../utils/hashing.mjs';

/**
 * Code Action Provider for tagging diagnostics directly from Quick Fix menu
 */
export class TagCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private tagStore: TagStore) {}

  /**
   * Provide code actions for diagnostics at cursor position
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    const diagnostics = context.diagnostics;
    
    // Filter for only compiler/language server diagnostics (not telemetry, etc.)
    const relevantDiagnostics = diagnostics.filter(d => 
      d.source && (d.source.includes('C++') || d.source.includes('clang') || d.source === 'cpp')
    );
    
    if (relevantDiagnostics.length === 0) {
      return undefined;
    }

    const actions: vscode.CodeAction[] = [];

    // Create "Add Tag" action for each diagnostic
    for (const diagnostic of relevantDiagnostics) {
      const action = new vscode.CodeAction(
        '🏷️ Add Tag to this Error',
        vscode.CodeActionKind.QuickFix
      );

      action.command = {
        command: 'tellme.tag.addToDiagnostic',
        title: 'Add Tag to Error',
        arguments: [document.uri.fsPath, diagnostic]
      };

      action.diagnostics = [diagnostic];
      action.isPreferred = false;
      
      actions.push(action);
    }

    return actions;
  }
}

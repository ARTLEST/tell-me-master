import * as vscode from 'vscode';
import { TagStore, Tag } from '../storage/tagStore.mjs';

export class TagTreeItem extends vscode.TreeItem {
  children?: TagTreeItem[];

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly tag?: Tag,
    public readonly contextValue?: string
  ) {
    super(label, collapsibleState);
  }
}

export class TagTreeProvider implements vscode.TreeDataProvider<TagTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TagTreeItem | undefined | null | void> = new vscode.EventEmitter<TagTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TagTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private tagStore: TagStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TagTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TagTreeItem): Promise<TagTreeItem[]> {
    if (!element) {
      // Root level - show all tags
      return this.loadTags();
    }

    return [];
  }

  private async loadTags(): Promise<TagTreeItem[]> {
    const tags = await this.tagStore.listTags();

    if (tags.length === 0) {
      const noTagsItem = new TagTreeItem(
        'No tags yet - use commands to create tags',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'empty'
      );
      noTagsItem.iconPath = new vscode.ThemeIcon('info');
      return [noTagsItem];
    }

    const stats = await this.tagStore.getTagStats();
    const statsByTagId = new Map(stats.map(s => [s.tagId, s.count]));

    return tags.map(tag => {
      const count = statsByTagId.get(tag.id) || 0;
      const item = new TagTreeItem(
        `${tag.label} (${count})`,
        vscode.TreeItemCollapsibleState.None,
        tag,
        'tag'
      );

      item.description = tag.description;
      item.iconPath = new vscode.ThemeIcon('tag');
      item.tooltip = `${tag.label}\n${tag.description || 'No description'}\nUsed ${count} times\n\nClick to view tagged locations`;
      
      // Add command to show tag locations on click
      item.command = {
        command: 'tellme.tag.showLocations',
        title: 'Show Tag Locations',
        arguments: [tag]
      };

      return item;
    });
  }

  async addTag(name: string, description?: string, color?: string): Promise<void> {
    await this.tagStore.createTag(name, { description, color });
    this.refresh();
  }

  async removeTag(tagId: string): Promise<void> {
    // Remove tag logic handled by tagStore
    this.refresh();
  }
}

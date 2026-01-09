import * as path from 'path';
import { ExtensionContext } from 'vscode';
import {
  readJsonFile,
  writeJsonFile,
  appendNDJSON,
  readNDJSON,
  compactFile,
  ensureStoragePath,
} from '../utils/storage.mjs';

/**
 * Represents a tag that can be assigned to resources
 */
export interface Tag {
  id: string;
  label: string;
  description?: string;
  color?: string;
  createdAt: number;
  source: 'manual' | 'auto' | 'system';
  confidence?: number;
}

/**
 * Represents a tag assignment to a resource
 */
export interface TagAssignment {
  id: string;
  resourceId: string;
  tagId: string;
  assignedAt: number;
  source: 'manual' | 'auto';
  confidence?: number;
  removedAt?: number;
  // Location data for highlighting
  filePath?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export class TagStore {
  private static instance: TagStore | null = null;
  private storagePath: string = '';
  private tagsFile: string = '';
  private assignmentsFile: string = '';
  private tagsCache: Map<string, Tag> = new Map();
  private assignmentsIndex: Map<string, string[]> = new Map(); // resourceId -> tagIds
  private isDirty: boolean = false;

  private constructor() {}

  /**
   * Initialize TagStore with extension context
   */
  static async init(context: ExtensionContext): Promise<TagStore> {
    if (TagStore.instance) {
      return TagStore.instance;
    }

    const instance = new TagStore();
    instance.storagePath = await ensureStoragePath(context.globalStorageUri);
    instance.tagsFile = path.join(instance.storagePath, 'tags.json');
    instance.assignmentsFile = path.join(instance.storagePath, 'tag-assignments.ndjson');

    // Load existing data
    await instance.loadData();

    // Store index in globalState for quick access
    context.globalState.update('tagStore:assignmentsIndex', Object.fromEntries(instance.assignmentsIndex));

    TagStore.instance = instance;
    return instance;
  }

  /**
   * Load tags and assignments from disk
   */
  private async loadData(): Promise<void> {
    // Load tags
    const tagsData = await readJsonFile<Record<string, Tag>>(this.tagsFile);
    if (tagsData) {
      this.tagsCache = new Map(Object.entries(tagsData));
    }

    // Load and index assignments
    const assignments = await readNDJSON<TagAssignment>(this.assignmentsFile);
    for (const assignment of assignments) {
      // Only count active assignments
      if (!assignment.removedAt) {
        if (!this.assignmentsIndex.has(assignment.resourceId)) {
          this.assignmentsIndex.set(assignment.resourceId, []);
        }
        const tagIds = this.assignmentsIndex.get(assignment.resourceId)!;
        if (!tagIds.includes(assignment.tagId)) {
          tagIds.push(assignment.tagId);
        }
      }
    }
  }

  /**
   * Create a new tag
   */
  async createTag(label: string, meta?: Partial<Tag>): Promise<Tag> {
    const id = `tag-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const tag: Tag = {
      id,
      label,
      description: meta?.description,
      color: meta?.color,
      createdAt: Date.now(),
      source: meta?.source || 'manual',
      confidence: meta?.confidence,
    };

    this.tagsCache.set(id, tag);
    this.isDirty = true;
    await this.persistTags();

    return tag;
  }

  /**
   * Assign one or more tags to a resource
   */
  async assignTag(
    resourceId: string,
    tagId: string | string[],
    source: 'manual' | 'auto' = 'manual',
    confidence?: number,
    locationData?: { filePath: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }
  ): Promise<void> {
    const tagIds = Array.isArray(tagId) ? tagId : [tagId];

    // Validate tags exist
    for (const tid of tagIds) {
      if (!this.tagsCache.has(tid)) {
        throw new Error(`Tag not found: ${tid}`);
      }
    }

    const assignments: TagAssignment[] = [];
    const currentTags = this.assignmentsIndex.get(resourceId) || [];

    for (const tid of tagIds) {
      if (!currentTags.includes(tid)) {
        const assignment: TagAssignment = {
          id: `assign-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          resourceId,
          tagId: tid,
          assignedAt: Date.now(),
          source,
          confidence,
          filePath: locationData?.filePath,
          range: locationData?.range
        };
        assignments.push(assignment);
        currentTags.push(tid);
      }
    }

    if (assignments.length > 0) {
      await appendNDJSON(this.assignmentsFile, assignments);
      this.assignmentsIndex.set(resourceId, currentTags);
    }
  }

  /**
   * Remove a tag from a resource
   */
  async removeTag(resourceId: string, tagId: string): Promise<void> {
    const currentTags = this.assignmentsIndex.get(resourceId) || [];
    const index = currentTags.indexOf(tagId);

    if (index > -1) {
      currentTags.splice(index, 1);

      // Record soft delete
      const removal: TagAssignment = {
        id: `remove-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        resourceId,
        tagId,
        assignedAt: Date.now(),
        source: 'manual',
        removedAt: Date.now(),
      };

      await appendNDJSON(this.assignmentsFile, [removal]);

      if (currentTags.length === 0) {
        this.assignmentsIndex.delete(resourceId);
      } else {
        this.assignmentsIndex.set(resourceId, currentTags);
      }
    }
  }

  /**
   * List all tags
   */
  async listTags(): Promise<Tag[]> {
    return Array.from(this.tagsCache.values());
  }

  /**
   * Delete a tag
   */
  async deleteTag(tagId: string): Promise<void> {
    // Remove from cache
    this.tagsCache.delete(tagId);
    this.isDirty = true;
    await this.persistTags();
  }

  /**
   * Get tags assigned to a resource
   */
  async getResourceTags(resourceId: string): Promise<Tag[]> {
    const tagIds = this.assignmentsIndex.get(resourceId) || [];
    return tagIds
      .map(id => this.tagsCache.get(id))
      .filter((tag): tag is Tag => tag !== undefined);
  }

  /**
   * Get all assignments for a specific tag
   */
  async getTagAssignments(tagId: string): Promise<TagAssignment[]> {
    const allAssignments = await readNDJSON<TagAssignment>(this.assignmentsFile);
    return allAssignments.filter((a: TagAssignment) => a.tagId === tagId && !a.removedAt);
  }

  /**
   * Get tag statistics (usage counts)
   */
  async getTagStats(): Promise<Array<{ tagId: string; label: string; count: number }>> {
    const stats = new Map<string, number>();

    for (const tagIds of this.assignmentsIndex.values()) {
      for (const tagId of tagIds) {
        stats.set(tagId, (stats.get(tagId) || 0) + 1);
      }
    }

    return Array.from(stats.entries())
      .map(([tagId, count]) => ({
        tagId,
        label: this.tagsCache.get(tagId)?.label || 'Unknown',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Export tags as JSON
   */
  async exportTagsJson(): Promise<string> {
    const tags = Object.fromEntries(this.tagsCache);
    const assignments = await readNDJSON<TagAssignment>(this.assignmentsFile);
    const stats = await this.getTagStats();

    return JSON.stringify(
      {
        exportDate: new Date().toISOString(),
        tags,
        assignments: assignments.filter(a => !a.removedAt),
        statistics: stats,
      },
      null,
      2
    );
  }

  /**
   * Persist tags to disk
   */
  private async persistTags(): Promise<void> {
    const data = Object.fromEntries(this.tagsCache);
    await writeJsonFile(this.tagsFile, data);
  }
}

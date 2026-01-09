import * as path from 'path';
import { ExtensionContext } from 'vscode';
import {
  appendNDJSON,
  readNDJSON,
  compactFile,
  ensureStoragePath,
} from '../utils/storage.mjs';

/**
 * Represents a single analysis event for statistics tracking
 */
export interface AnalysisEvent {
  id: string;
  timestamp: number;
  filePath: string;
  language: string;
  diagnosticCount: number;
  resultType: 'success' | 'error' | 'partial';
  tokenCount: number;
  durationMs: number;
  model: string;
  synced: boolean;
  syncedAt?: number;
}

/**
 * Batch entry for debounced recording
 */
interface PendingRecord {
  event: Partial<AnalysisEvent>;
  timestamp: number;
}

/**
 * Stats Store for tracking and syncing analysis events
 * Implements debounced batching and append-only storage
 */
export class StatsStore {
  private static instance: StatsStore;
  private storagePath: string = '';
  private recordsFile: string = '';
  private context: ExtensionContext | null = null;
  private pendingRecords: PendingRecord[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY_MS = 500;
  private isFlushing = false;
  private lastSyncedTimestamp: number = 0;
  private pendingCount: number = 0;

  private constructor() {}

  /**
   * Initialize StatsStore with extension context
   */
  static async init(context: ExtensionContext): Promise<StatsStore> {
    if (StatsStore.instance) {
      return StatsStore.instance;
    }

    const instance = new StatsStore();
    instance.context = context;
    instance.storagePath = await ensureStoragePath(context.globalStorageUri);
    instance.recordsFile = path.join(instance.storagePath, 'records.ndjson');

    // Load state from globalState
    const savedState = context.globalState.get('statsStore:state') as any;
    if (savedState) {
      instance.lastSyncedTimestamp = savedState.lastSynced || 0;
      instance.pendingCount = savedState.pendingCount || 0;
    }

    StatsStore.instance = instance;
    return instance;
  }

  /**
   * Record an analysis event with debouncing
   * Batches records and flushes every 500ms
   */
  async recordAnalysis(event: Partial<AnalysisEvent>): Promise<void> {
    const eventWithDefaults: Partial<AnalysisEvent> = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      synced: false,
      ...event,
    };

    this.pendingRecords.push({
      event: eventWithDefaults,
      timestamp: Date.now(),
    });

    this.pendingCount++;
    this.updateGlobalState();

    // Clear existing timeout and set new one
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(async () => {
      await this.flushPendingRecords();
    }, this.BATCH_DELAY_MS);
  }

  /**
   * Flush pending records to disk
   */
  private async flushPendingRecords(): Promise<void> {
    if (this.pendingRecords.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    try {
      const events = this.pendingRecords.map(p => p.event);
      await appendNDJSON(this.recordsFile, events);

      this.pendingRecords = [];
      this.updateGlobalState();
    } catch (error) {
      console.error('Failed to flush stats records:', error);
      // Keep records for retry on next batch
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Get pending records for sync (limit optional)
   */
  async getPendingForSync(limit: number = 100): Promise<AnalysisEvent[]> {
    // First flush any buffered records
    if (this.pendingRecords.length > 0) {
      await this.flushPendingRecords();
    }

    const allRecords = await readNDJSON<AnalysisEvent>(this.recordsFile);
    const pending = allRecords
      .filter(r => !r.synced)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, limit);

    return pending;
  }

  /**
   * Mark records as synced
   */
  async markSynced(recordIds: string[]): Promise<void> {
    const idSet = new Set(recordIds);
    const allRecords = await readNDJSON<AnalysisEvent>(this.recordsFile);

    // Update records by rewriting file with synced flag
    const updated = allRecords.map(record => {
      if (idSet.has(record.id)) {
        return {
          ...record,
          synced: true,
          syncedAt: Date.now(),
        };
      }
      return record;
    });

    const content = updated.map(r => JSON.stringify(r)).join('\n');
    if (content.length > 0) {
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const dir = pathModule.dirname(this.recordsFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.recordsFile, content + '\n', 'utf-8');
    }

    this.pendingCount = updated.filter(r => !r.synced).length;
    this.lastSyncedTimestamp = Date.now();
    this.updateGlobalState();
  }

  /**
   * Get aggregate statistics across all records
   */
  async getAggregateStats(filters?: any): Promise<{
    totalAnalyses: number;
    avgDuration: number;
    successRate: number;
  }> {
    let records = await readNDJSON<AnalysisEvent>(this.recordsFile);

    // Apply filters if provided
    if (filters?.minTimestamp) {
      records = records.filter(r => (r.timestamp || 0) >= filters.minTimestamp);
    }
    if (filters?.maxTimestamp) {
      records = records.filter(r => (r.timestamp || 0) <= filters.maxTimestamp);
    }
    if (filters?.syncedOnly) {
      records = records.filter(r => r.synced);
    }

    const totalAnalyses = records.length;
    const avgDuration =
      totalAnalyses > 0
        ? records.reduce((sum, r) => sum + (r.durationMs || 0), 0) / totalAnalyses
        : 0;

    const successCount = records.filter(r => r.resultType === 'success').length;
    const successRate = totalAnalyses > 0 ? successCount / totalAnalyses : 0;

    return {
      totalAnalyses,
      avgDuration: Math.round(avgDuration),
      successRate: Math.round(successRate * 10000) / 10000,
    };
  }

  /**
   * Export all stats as JSON
   */
  async exportJson(): Promise<string> {
    const allRecords = await readNDJSON<AnalysisEvent>(this.recordsFile);
    const stats = await this.getAggregateStats();

    return JSON.stringify(
      {
        exportDate: new Date().toISOString(),
        statistics: stats,
        records: allRecords,
      },
      null,
      2
    );
  }

  /**
   * Clear all recorded data
   */
  async clearAllData(): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.unlink(this.recordsFile);
    } catch {
      // File may not exist
    }

    this.pendingRecords = [];
    this.pendingCount = 0;
    this.lastSyncedTimestamp = 0;
    this.updateGlobalState();
  }

  /**
   * Compact file by removing old synced records (older than 30 days)
   */
  async compact(): Promise<void> {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    await compactFile(this.recordsFile, (record: AnalysisEvent) => {
      // Keep: unsync'd records, recent records, or records synced recently
      return (
        !record.synced ||
        (record.timestamp || 0) > thirtyDaysAgo ||
        (record.syncedAt || 0) > thirtyDaysAgo
      );
    });
  }

  /**
   * Get last synced timestamp
   */
  getLastSynced(): number {
    return this.lastSyncedTimestamp;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.pendingCount;
  }

  /**
   * Update global state with current status
   */
  private updateGlobalState(): void {
    if (!this.context) return;

    this.context.globalState.update('statsStore:state', {
      lastSynced: this.lastSyncedTimestamp,
      pendingCount: this.pendingCount,
    });
  }
}

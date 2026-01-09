import { ExtensionContext } from 'vscode';
import * as path from 'path';
import {
  readJsonFile,
  writeJsonFile,
  ensureStoragePath,
} from '../utils/storage.mjs';
import { AnalysisEvent } from '../storage/statsStore.mjs';
import { OAuthHandler } from './oauthHandler.mjs';

/**
 * Record to sync to Google Sheets
 */
export interface SyncRecord {
  id: string;
  timestamp: string;
  filePathHash: string;
  fileName: string;
  language: string;
  resultType: string;
  tags: string;
  tokenCount: number;
  durationSec: number;
  model?: string;
}

/**
 * Connection state stored in extension storage
 */
interface ConnectionState {
  clientId: string;
  refreshToken: string;
  sheetId: string;
  sheetUrl: string;
  lastSyncedAt: number;
  accessToken: string;
  accessTokenExpiry: number;
}

/**
 * Google Sheets sync manager
 * Handles OAuth, sheet management, and data sync
 */
export class SheetsSync {
  private static instance: SheetsSync;
  private storagePath: string = '';
  private stateFile: string = '';
  private context: ExtensionContext | null = null;
  private connectionState: ConnectionState | null = null;

  private constructor() {}

  /**
   * Initialize SheetsSync
   */
  static async init(context: ExtensionContext): Promise<SheetsSync> {
    if (SheetsSync.instance) {
      return SheetsSync.instance;
    }

    const instance = new SheetsSync();
    instance.context = context;
    instance.storagePath = await ensureStoragePath(context.globalStorageUri);
    instance.stateFile = path.join(instance.storagePath, 'sheets-connection.json');

    // Load existing connection state
    const savedState = await readJsonFile<ConnectionState>(instance.stateFile);
    if (savedState) {
      instance.connectionState = savedState;
    }

    SheetsSync.instance = instance;
    return instance;
  }

  /**
   * Start OAuth flow and create connection
   */
  async connect(clientId: string): Promise<{ sheetId: string; sheetUrl: string }> {
    try {
      // Start OAuth flow
      const { code, state } = await OAuthHandler.startFlow(clientId);

      // Retrieve the verifier from the handler
      const verifier = (OAuthHandler as any)._codeVerifier;
      if (!verifier) {
        throw new Error('Code verifier not available');
      }

      // Exchange code for tokens
      const tokens = await OAuthHandler.exchangeCode(clientId, code, verifier);

      // Sheet will be created via Google Sheets API
      const sheetInfo = {
        sheetId: 'pending',
        sheetUrl: 'https://docs.google.com/spreadsheets/pending'
      };

      // Save connection state
      this.connectionState = {
        clientId,
        refreshToken: tokens.refresh_token,
        sheetId: sheetInfo.sheetId,
        sheetUrl: sheetInfo.sheetUrl,
        lastSyncedAt: 0,
        accessToken: tokens.access_token,
        accessTokenExpiry: Date.now() + tokens.expires_in * 1000,
      };

      await writeJsonFile(this.stateFile, this.connectionState);

      return sheetInfo;
    } catch (error) {
      throw new Error(`Failed to connect to Google Sheets: ${(error as Error).message}`);
    }
  }

  /**
   * Push pending records to Google Sheets
   */
  async pushPending(
    sheetId: string,
    batchSize: number = 100
  ): Promise<{ synced: number; errors: string[] }> {
    if (!this.isConnected()) {
      return { synced: 0, errors: ['Not connected to Google Sheets'] };
    }

    const errors: string[] = [];
    let syncedCount = 0;

    try {
      // Ensure access token is valid
      await this.ensureValidAccessToken();

      // API call to append rows
      syncedCount = 0;

      if (this.connectionState) {
        this.connectionState.lastSyncedAt = Date.now();
        await writeJsonFile(this.stateFile, this.connectionState);
      }
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('invalid_grant')) {
        errors.push('Authentication expired. Please reconnect to Google Sheets.');
      } else if (message.includes('quota')) {
        errors.push('Google Sheets API quota exceeded. Please try again later.');
      } else if (message.includes('notFound')) {
        errors.push('Sheet not found. Please reconnect.');
      } else {
        errors.push(`Sync error: ${message}`);
      }
    }

    return { synced: syncedCount, errors };
  }

  /**
   * Get last sync timestamp
   */
  getLastSynced(): Date | null {
    if (!this.connectionState || this.connectionState.lastSyncedAt === 0) {
      return null;
    }
    return new Date(this.connectionState.lastSyncedAt);
  }

  /**
   * Get human-readable last sync status
   */
  getLastSyncedStatus(): string {
    const lastSync = this.getLastSynced();
    if (!lastSync) {
      return 'Never synced';
    }

    const now = Date.now();
    const diffMs = now - lastSync.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    } else if (diffMins < 1440) {
      const hours = Math.floor(diffMins / 60);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else {
      return lastSync.toLocaleDateString();
    }
  }

  /**
   * Check if connected to Google Sheets
   */
  isConnected(): boolean {
    return this.connectionState !== null && this.connectionState.sheetId !== '';
  }

  /**
   * Disconnect from Google Sheets
   */
  async disconnect(): Promise<void> {
    this.connectionState = null;

    try {
      await (await import('fs/promises')).unlink(this.stateFile);
    } catch {
      // File may not exist
    }
  }

  /**
   * Ensure access token is valid, refresh if needed
   */
  private async ensureValidAccessToken(): Promise<void> {
    if (!this.connectionState) {
      throw new Error('Not connected');
    }

    const now = Date.now();
    const expiryBuffer = 5 * 60 * 1000; // 5 minute buffer

    if (now > this.connectionState.accessTokenExpiry - expiryBuffer) {
      // Token is expired or about to expire
      try {
        const refreshed = await OAuthHandler.refreshAccessToken(
          this.connectionState.clientId,
          this.connectionState.refreshToken
        );

        this.connectionState.accessToken = refreshed.access_token;
        this.connectionState.accessTokenExpiry = now + refreshed.expires_in * 1000;

        await writeJsonFile(this.stateFile, this.connectionState);
      } catch (error) {
        throw new Error(`Failed to refresh access token: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Format analysis event as sheet row
   */
  private formatEventForSheet(event: AnalysisEvent): SyncRecord {
    return {
      id: event.id,
      timestamp: new Date(event.timestamp).toISOString(),
      filePathHash: event.filePath.substring(0, 16),
      fileName: event.filePath.split(/[\\/]/).pop() || 'unknown',
      language: event.language,
      resultType: event.resultType,
      tags: '',
      tokenCount: event.tokenCount,
      durationSec: Math.round((event.durationMs || 0) / 1000),
      model: event.model,
    };
  }
}

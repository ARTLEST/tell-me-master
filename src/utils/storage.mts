import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';
import { Uri } from 'vscode';

/**
 * Read and parse a JSON file
 * @param filePath - Absolute path to JSON file
 * @returns Parsed JSON object, or null if file doesn't exist
 */
export async function readJsonFile<T = any>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read JSON file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Write JSON to file with automatic directory creation
 * @param filePath - Absolute path to JSON file
 * @param data - Data to write
 */
export async function writeJsonFile(filePath: string, data: any): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write JSON file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Append records to an NDJSON (newline-delimited JSON) file
 * @param filePath - Absolute path to NDJSON file
 * @param records - Array of objects to append
 */
export async function appendNDJSON(filePath: string, records: any[]): Promise<void> {
  if (records.length === 0) return;
  
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to append to NDJSON file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Read all records from an NDJSON file
 * @param filePath - Absolute path to NDJSON file
 * @returns Array of parsed objects, or empty array if file doesn't exist
 */
export async function readNDJSON<T = any>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read NDJSON file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Compact an NDJSON file by rewriting with filtered records
 * @param filePath - Absolute path to NDJSON file
 * @param filterFn - Filter function to keep/remove records
 */
export async function compactFile(
  filePath: string,
  filterFn: (record: any) => boolean
): Promise<void> {
  try {
    const records = await readNDJSON(filePath);
    const filtered = records.filter(filterFn);
    
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    const content = filtered.map(r => JSON.stringify(r)).join('\n');
    if (content.length > 0) {
      await fs.writeFile(filePath, content + '\n', 'utf-8');
    } else {
      await fs.writeFile(filePath, '', 'utf-8');
    }
  } catch (error) {
    throw new Error(`Failed to compact file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Ensure storage directory exists and return its path
 * @param uri - VS Code storage URI
 * @returns Absolute path to storage directory
 */
export async function ensureStoragePath(uri: Uri): Promise<string> {
  try {
    const storagePath = uri.fsPath;
    await fs.mkdir(storagePath, { recursive: true });
    return storagePath;
  } catch (error) {
    throw new Error(`Failed to create storage directory: ${(error as Error).message}`);
  }
}

/**
 * Get file statistics
 * @param filePath - Absolute path to file
 * @returns File stats or null if file doesn't exist
 */
export async function getFileStats(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a file
 * @param filePath - Absolute path to file
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

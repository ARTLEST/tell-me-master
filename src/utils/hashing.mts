import * as crypto from 'crypto';

/**
 * Hash a file path to a consistent SHA-256 hash
 * @param filePath - Absolute file path
 * @returns SHA-256 hash in hex format (first 16 chars for brevity)
 */
export function hashPath(filePath: string): string {
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
  return crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 16);
}

/**
 * Generate a unique resource ID for tracking diagnostics
 * Combines file path hash with optional diagnostic ID
 * @param filePath - Absolute file path
 * @param diagnosticId - Optional diagnostic identifier (line:col:code)
 * @returns Unique resource ID
 */
export function generateResourceId(filePath: string, diagnosticId?: string): string {
  const pathHash = hashPath(filePath);
  if (!diagnosticId) {
    return pathHash;
  }
  const diagHash = crypto.createHash('sha256').update(diagnosticId).digest('hex').substring(0, 8);
  return `${pathHash}-${diagHash}`;
}

/**
 * Generate a PKCE code challenge from a verifier
 * @param verifier - PKCE code verifier (43-128 chars)
 * @returns Base64-URL encoded code challenge
 */
export function generatePKCEChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return Buffer.from(hash)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

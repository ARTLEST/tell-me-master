import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

/**
 * OAuth token response from Google
 */
export interface TokenResponse {
  refresh_token: string;
  access_token: string;
  expires_in: number;
  token_type?: string;
}

/**
 * OAuth handler for PKCE-based loopback flow
 * Used for authenticating with Google APIs without user input of credentials
 */
export class OAuthHandler {
  private static readonly REDIRECT_URI = 'http://localhost';
  private static readonly AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  private static readonly TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  private static readonly SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ];

  /**
   * Start OAuth PKCE flow with loopback server
   * Opens authorization URL and listens for callback
   */
  static async startFlow(clientId: string, port: number = 7777): Promise<{
    code: string;
    state: string;
  }> {
    const { challenge, verifier } = this.generatePKCEPair();
    const state = this.generateRandomString(32);

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://localhost:${port}`);
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid authorization request');
            reject(new Error('Invalid authorization response'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body><h1>Authorization successful!</h1><p>You can close this window and return to VS Code.</p></body></html>'
          );

          server.close();
          resolve({ code, state });
        } catch (error) {
          res.writeHead(500);
          res.end('Internal server error');
          server.close();
          reject(error);
        }
      });

      server.listen(port, 'localhost', () => {
        const authUrl = new URL(OAuthHandler.AUTH_ENDPOINT);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `http://localhost:${port}`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', OAuthHandler.SCOPES.join(' '));
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        // Open authorization URL in default browser
        vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        // Store verifier temporarily - would be retrieved in token exchange
        (OAuthHandler as any)._codeVerifier = verifier;
      });

      setTimeout(() => {
        server.close();
        reject(new Error('OAuth flow timeout'));
      }, 10 * 60 * 1000); // 10 minute timeout
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCode(
    clientId: string,
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: OAuthHandler.REDIRECT_URI,
    });

    try {
      const response = await fetch(OAuthHandler.TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${error}`);
      }

      const data = (await response.json()) as TokenResponse;
      return data;
    } catch (error) {
      throw new Error(`Failed to exchange code for tokens: ${(error as Error).message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(
    clientId: string,
    refreshToken: string
  ): Promise<{ access_token: string; expires_in: number }> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    });

    try {
      const response = await fetch(OAuthHandler.TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${error}`);
      }

      return response.json();
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${(error as Error).message}`);
    }
  }

  /**
   * Generate PKCE code pair
   */
  static generatePKCEPair(): { challenge: string; verifier: string } {
    const verifier = this.generateRandomString(128);
    const challenge = this.hashCode(verifier);
    return { challenge, verifier };
  }

  /**
   * Hash and encode string for PKCE challenge
   */
  static hashCode(code: string): string {
    return crypto
      .createHash('sha256')
      .update(code)
      .digest()
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate random string
   */
  private static generateRandomString(length: number): string {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .substring(0, length);
  }
}

/**
 * outlookGraphClient.ts
 *
 * Klient mot Microsoft Graph för att hämta mail + bilagor från en konfigurerad
 * brevlåda och konvertera till RawEmail[] för outlookIngestionService.runIngestion().
 *
 * Autentisering: OAuth 2.0 client credentials flow mot Azure AD.
 *
 * Miljövariabler:
 *   OUTLOOK_GRAPH_TENANT_ID      — Azure tenant-id
 *   OUTLOOK_GRAPH_CLIENT_ID      — registrerad app (application permissions)
 *   OUTLOOK_GRAPH_CLIENT_SECRET  — klienthemlighet
 *   OUTLOOK_GRAPH_USER           — användarens principal name (email)
 *   OUTLOOK_GRAPH_FOLDER         — mapp (default "Inbox")
 *   OUTLOOK_GRAPH_FETCH_LIMIT    — antal mail per körning (default 25)
 *
 * Applikationen behöver Mail.Read-behörighet (application) i Azure.
 */

import { logger } from '../logger';
import type { RawAttachment, RawEmail } from './outlookIngestionService';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let _cachedToken: CachedToken | null = null;

export interface OutlookGraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  user: string;
  folder: string;
  fetchLimit: number;
}

export function readOutlookGraphConfig(): OutlookGraphConfig | null {
  const tenantId = process.env.OUTLOOK_GRAPH_TENANT_ID;
  const clientId = process.env.OUTLOOK_GRAPH_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_GRAPH_CLIENT_SECRET;
  const user = process.env.OUTLOOK_GRAPH_USER;
  if (!tenantId || !clientId || !clientSecret || !user) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    user,
    folder: process.env.OUTLOOK_GRAPH_FOLDER || 'Inbox',
    fetchLimit: Number(process.env.OUTLOOK_GRAPH_FETCH_LIMIT ?? 25),
  };
}

async function fetchAccessToken(config: OutlookGraphConfig): Promise<string> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) {
    return _cachedToken.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph token-fel ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return _cachedToken.accessToken;
}

interface GraphMessage {
  id: string;
  internetMessageId: string;
  subject: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
}

interface GraphFileAttachment {
  '@odata.type': string;
  id: string;
  name: string;
  contentType: string;
  contentBytes: string;
  size: number;
}

async function graphGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph GET ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function resolveFolderId(config: OutlookGraphConfig, token: string): Promise<string> {
  // Snabbväg: kända välbekanta mappnamn kan användas direkt.
  const wellKnown = new Set(['Inbox', 'Archive', 'SentItems', 'Drafts']);
  if (wellKnown.has(config.folder)) return config.folder;

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.user)}/mailFolders?$top=100`;
  const data = await graphGet<{ value: Array<{ id: string; displayName: string }> }>(url, token);
  const match = data.value.find((f) => f.displayName?.toLowerCase() === config.folder.toLowerCase());
  if (!match) {
    throw new Error(`Outlook-mapp '${config.folder}' hittades inte för ${config.user}`);
  }
  return match.id;
}

async function fetchAttachments(
  config: OutlookGraphConfig,
  token: string,
  messageId: string,
): Promise<RawAttachment[]> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.user)}/messages/${encodeURIComponent(messageId)}/attachments`;
  const data = await graphGet<{ value: GraphFileAttachment[] }>(url, token);
  return data.value
    .filter((a) => a['@odata.type'].includes('fileAttachment') && a.contentBytes)
    .map((a) => ({
      filename: a.name,
      data: Buffer.from(a.contentBytes, 'base64'),
    }));
}

/**
 * Huvud-API: hämta senaste mail från konfigurerad mapp, mappa till RawEmail[].
 * Returnerar tom array om konfiguration saknas (fail-soft).
 */
export async function fetchRecentEmailsFromOutlook(): Promise<{
  emails: RawEmail[];
  config: OutlookGraphConfig | null;
}> {
  const config = readOutlookGraphConfig();
  if (!config) {
    return { emails: [], config: null };
  }

  const token = await fetchAccessToken(config);
  const folderId = await resolveFolderId(config, token);
  const messagesUrl =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.user)}` +
    `/mailFolders/${encodeURIComponent(folderId)}/messages` +
    `?$top=${config.fetchLimit}` +
    `&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments` +
    `&$orderby=receivedDateTime desc`;

  const data = await graphGet<{ value: GraphMessage[] }>(messagesUrl, token);
  const emails: RawEmail[] = [];
  for (const msg of data.value) {
    try {
      const attachments = msg.hasAttachments ? await fetchAttachments(config, token, msg.id) : [];
      emails.push({
        messageId: msg.internetMessageId || msg.id,
        sender: msg.from?.emailAddress?.address || msg.from?.emailAddress?.name || 'unknown@unknown',
        subject: msg.subject || '(utan ämne)',
        receivedAt: new Date(msg.receivedDateTime),
        attachments,
      });
    } catch (err) {
      logger.warn('outlookGraphClient: failed to fetch attachments', {
        messageId: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { emails, config };
}

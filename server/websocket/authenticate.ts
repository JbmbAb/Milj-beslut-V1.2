import type { IncomingMessage } from 'http';
import { getUserFromAccessToken } from '../security/auth';
import { assertProjectAccess } from '../security/projectAccess';
import type { AuthUser } from '../security/types';

function extractBearerToken(req: IncomingMessage, url: URL): string | null {
  const fromQuery = url.searchParams.get('token')?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  return null;
}

export async function authenticateWebSocket(
  req: IncomingMessage,
  url: URL,
): Promise<{ user: AuthUser } | { error: string }> {
  const token = extractBearerToken(req, url);
  if (!token) {
    return { error: 'Missing access token' };
  }

  try {
    const user = await getUserFromAccessToken(token);
    return { user };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid token' };
  }
}

export async function authenticateProjectWebSocket(
  req: IncomingMessage,
  url: URL,
  projectId: string,
): Promise<{ user: AuthUser } | { error: string }> {
  const auth = await authenticateWebSocket(req, url);
  if ('error' in auth) {
    return auth;
  }

  try {
    await assertProjectAccess(auth.user, projectId, auth.user.organisationId);
    return auth;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Project access denied' };
  }
}

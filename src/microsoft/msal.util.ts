import {
  ConfidentialClientApplication,
  type AuthenticationResult,
} from '@azure/msal-node';

// ─── MSAL (Azure AD) OAuth for Microsoft Graph ───────────────────────────────
// Delegated auth-code flow for a confidential (server) client. Single-tenant: the
// authority uses MICROSOFT_TENANT_ID so only the firm's own directory can consent.

// Graph resource scopes we request. The reserved OIDC scopes (openid, profile,
// email, offline_access) are added by MSAL automatically — passing them here throws
// ClientConfigurationError, so they're intentionally omitted. offline_access is
// implicit for a confidential client, which is how we get a refresh token.
export const MS_SCOPES = [
  'Mail.ReadWrite', // list/read/mark-read Outlook mail
  'Mail.Send', // send/reply/forward
  'Chat.ReadWrite', // list Teams chats + messages
  'ChatMessage.Send', // send Teams messages
  'User.Read', // the connected account's identity
];

export function getMicrosoftRedirectUri(): string {
  return `${process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'}/api/microsoft/callback`;
}

/**
 * A fresh confidential client. The token cache is in-memory and per-instance; since
 * every OAuth call here is stateless we create one per operation and read the
 * refresh token straight out of its cache after a token acquisition.
 */
export function makeConfidentialClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    },
  });
}

/** The consent URL to send the admin to (popup). `prompt: consent` re-grants scopes. */
export async function buildMicrosoftAuthUrl(state: string): Promise<string> {
  const cca = makeConfidentialClient();
  return cca.getAuthCodeUrl({
    scopes: MS_SCOPES,
    redirectUri: getMicrosoftRedirectUri(),
    state,
    prompt: 'consent',
  });
}

// MSAL deliberately keeps the refresh token off the AuthenticationResult; the
// supported way to persist it is to read it from the serialized token cache.
function extractRefreshToken(
  cca: ConfidentialClientApplication,
): string | null {
  try {
    const cache = JSON.parse(cca.getTokenCache().serialize()) as {
      RefreshToken?: Record<string, { secret?: string }>;
    };
    const entries = Object.values(cache.RefreshToken ?? {});
    return entries[0]?.secret ?? null;
  } catch {
    return null;
  }
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string | null; // null on refresh when MSAL didn't rotate it
  expiresOn: Date;
  email: string | null;
  userId: string | null; // AAD object id (oid) — matches Teams from.user.id
  scopes: string[];
}

function toTokens(
  result: AuthenticationResult,
  refreshToken: string | null,
): MicrosoftTokens {
  const claims = (result.idTokenClaims ?? {}) as {
    oid?: string;
    preferred_username?: string;
    email?: string;
  };
  return {
    accessToken: result.accessToken,
    refreshToken,
    expiresOn: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
    email:
      result.account?.username ??
      claims.preferred_username ??
      claims.email ??
      null,
    userId: result.uniqueId || claims.oid || null,
    scopes: result.scopes ?? [],
  };
}

/** Redeem the auth code for tokens (initial connect). */
export async function redeemMicrosoftCode(
  code: string,
): Promise<MicrosoftTokens> {
  const cca = makeConfidentialClient();
  const result = await cca.acquireTokenByCode({
    code,
    scopes: MS_SCOPES,
    redirectUri: getMicrosoftRedirectUri(),
  });
  return toTokens(result, extractRefreshToken(cca));
}

/** Exchange a stored refresh token for a fresh access token (and maybe a new RT). */
export async function refreshMicrosoftTokens(
  refreshToken: string,
): Promise<MicrosoftTokens> {
  const cca = makeConfidentialClient();
  const result = await cca.acquireTokenByRefreshToken({
    refreshToken,
    scopes: MS_SCOPES,
  });
  if (!result) throw new Error('Microsoft token refresh returned no result');
  // MSAL may rotate the refresh token; persist the new one if it changed.
  return toTokens(result, extractRefreshToken(cca));
}

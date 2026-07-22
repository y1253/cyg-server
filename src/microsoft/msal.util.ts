import {
  ConfidentialClientApplication,
  type AuthenticationResult,
} from '@azure/msal-node';

// ─── MSAL (Azure AD) OAuth for Microsoft Graph ───────────────────────────────
// Delegated auth-code flow for a confidential (server) client. Multi-audience: the
// authority is `/common` so BOTH work/school and personal Microsoft accounts can
// connect. (Requires the app registration's "Supported account types" to include
// personal Microsoft accounts.)

// Which kind of account is connecting. Personal (free @outlook.com etc.) accounts
// support mail but NOT Microsoft Graph's Chat/Teams API — and requesting Chat.*
// scopes during a personal login breaks consent — so Teams scopes are requested
// only for the `work` flow.
export type MicrosoftConnectKind = 'work' | 'personal';

// The reserved OIDC scopes (openid, profile, email, offline_access) are added by
// MSAL automatically — passing them here throws ClientConfigurationError, so they're
// intentionally omitted. offline_access is implicit for a confidential client, which
// is how we get a refresh token.
export const MS_BASE_SCOPES = [
  'Mail.ReadWrite', // list/read/mark-read Outlook mail
  'Mail.Send', // send/reply/forward
  'User.Read', // the connected account's identity
];
export const MS_TEAMS_SCOPES = [
  'Chat.ReadWrite', // list Teams chats + messages (work/school only)
  'ChatMessage.Send', // send Teams messages (work/school only)
];

// Scopes to request for a given connect kind. Teams scopes are work-only.
export function scopesFor(kind: MicrosoftConnectKind): string[] {
  return kind === 'work'
    ? [...MS_BASE_SCOPES, ...MS_TEAMS_SCOPES]
    : [...MS_BASE_SCOPES];
}

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
      // `/common` accepts work, school, AND personal Microsoft accounts.
      authority: 'https://login.microsoftonline.com/common',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    },
  });
}

/** The consent URL to send the admin to (popup). `prompt: consent` re-grants scopes. */
export async function buildMicrosoftAuthUrl(
  state: string,
  kind: MicrosoftConnectKind,
): Promise<string> {
  const cca = makeConfidentialClient();
  return cca.getAuthCodeUrl({
    scopes: scopesFor(kind),
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

/** Redeem the auth code for tokens (initial connect). Scopes must match the ones
 * requested in buildMicrosoftAuthUrl for the same `kind`. */
export async function redeemMicrosoftCode(
  code: string,
  kind: MicrosoftConnectKind,
): Promise<MicrosoftTokens> {
  const cca = makeConfidentialClient();
  const result = await cca.acquireTokenByCode({
    code,
    scopes: scopesFor(kind),
    redirectUri: getMicrosoftRedirectUri(),
  });
  return toTokens(result, extractRefreshToken(cca));
}

/** Exchange a stored refresh token for a fresh access token (and maybe a new RT).
 * `scopes` should be the ones actually granted on connect (Teams scopes for work
 * accounts, base only for personal) — requesting Teams scopes for a personal
 * account's refresh token would fail. */
export async function refreshMicrosoftTokens(
  refreshToken: string,
  scopes: string[],
): Promise<MicrosoftTokens> {
  const cca = makeConfidentialClient();
  const result = await cca.acquireTokenByRefreshToken({
    refreshToken,
    scopes: scopes.length ? scopes : MS_BASE_SCOPES,
  });
  if (!result) throw new Error('Microsoft token refresh returned no result');
  // MSAL may rotate the refresh token; persist the new one if it changed.
  return toTokens(result, extractRefreshToken(cca));
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MS_SCOPES = void 0;
exports.getMicrosoftRedirectUri = getMicrosoftRedirectUri;
exports.makeConfidentialClient = makeConfidentialClient;
exports.buildMicrosoftAuthUrl = buildMicrosoftAuthUrl;
exports.redeemMicrosoftCode = redeemMicrosoftCode;
exports.refreshMicrosoftTokens = refreshMicrosoftTokens;
const msal_node_1 = require("@azure/msal-node");
exports.MS_SCOPES = [
    'Mail.ReadWrite',
    'Mail.Send',
    'Chat.ReadWrite',
    'ChatMessage.Send',
    'User.Read',
];
function getMicrosoftRedirectUri() {
    return `${process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'}/api/microsoft/callback`;
}
function makeConfidentialClient() {
    return new msal_node_1.ConfidentialClientApplication({
        auth: {
            clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
            authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
        },
    });
}
async function buildMicrosoftAuthUrl(state) {
    const cca = makeConfidentialClient();
    return cca.getAuthCodeUrl({
        scopes: exports.MS_SCOPES,
        redirectUri: getMicrosoftRedirectUri(),
        state,
        prompt: 'consent',
    });
}
function extractRefreshToken(cca) {
    try {
        const cache = JSON.parse(cca.getTokenCache().serialize());
        const entries = Object.values(cache.RefreshToken ?? {});
        return entries[0]?.secret ?? null;
    }
    catch {
        return null;
    }
}
function toTokens(result, refreshToken) {
    const claims = (result.idTokenClaims ?? {});
    return {
        accessToken: result.accessToken,
        refreshToken,
        expiresOn: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
        email: result.account?.username ??
            claims.preferred_username ??
            claims.email ??
            null,
        userId: result.uniqueId || claims.oid || null,
        scopes: result.scopes ?? [],
    };
}
async function redeemMicrosoftCode(code) {
    const cca = makeConfidentialClient();
    const result = await cca.acquireTokenByCode({
        code,
        scopes: exports.MS_SCOPES,
        redirectUri: getMicrosoftRedirectUri(),
    });
    return toTokens(result, extractRefreshToken(cca));
}
async function refreshMicrosoftTokens(refreshToken) {
    const cca = makeConfidentialClient();
    const result = await cca.acquireTokenByRefreshToken({
        refreshToken,
        scopes: exports.MS_SCOPES,
    });
    if (!result)
        throw new Error('Microsoft token refresh returned no result');
    return toTokens(result, extractRefreshToken(cca));
}
//# sourceMappingURL=msal.util.js.map
const crypto = require('crypto');
const LinkedInOAuthToken = require('../models/LinkedInOAuthToken');

const LINKEDIN_AUTH_BASE_URL = process.env.LINKEDIN_AUTH_BASE_URL || 'https://www.linkedin.com/oauth/v2';
const LINKEDIN_API_BASE_URL = process.env.LINKEDIN_API_BASE_URL || 'https://api.linkedin.com/v2';
const PROVIDER_ID = 'linkedin';
const TOKEN_EXPIRY_SKEW_MS = Number(process.env.LINKEDIN_TOKEN_EXPIRY_SKEW_MS || 60000);

function getOAuthScopes() {
  const raw = process.env.LINKEDIN_OAUTH_SCOPES || 'r_liteprofile r_emailaddress w_member_social offline_access';
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildEncryptionKey() {
  const secret = String(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!secret) {
    const error = new Error('Missing LINKEDIN_TOKEN_ENCRYPTION_KEY in backend environment');
    error.status = 500;
    throw error;
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(plainText) {
  const value = String(plainText || '');
  if (!value) {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', buildEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload) {
  const value = String(payload || '').trim();
  if (!value) {
    return null;
  }

  const [ivHex, tagHex, dataHex] = value.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    const error = new Error('Invalid encrypted token payload format');
    error.status = 500;
    throw error;
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    buildEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    const error = new Error(`Missing ${name} in backend environment`);
    error.status = 500;
    throw error;
  }

  return value;
}

function buildLinkedInAuthorizationUrl({ state, scopes } = {}) {
  const clientId = requiredEnv('LINKEDIN_CLIENT_ID');
  const redirectUri = requiredEnv('LINKEDIN_REDIRECT_URI');
  const requestedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : getOAuthScopes();
  const safeState = String(state || '').trim();

  const url = new URL('/authorization', `${LINKEDIN_AUTH_BASE_URL}/`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', requestedScopes.join(' '));

  if (safeState) {
    url.searchParams.set('state', safeState);
  }

  return {
    authorizationUrl: url.toString(),
    scopes: requestedScopes,
  };
}

async function exchangeAuthorizationCodeForToken({ code }) {
  const authorizationCode = String(code || '').trim();
  if (!authorizationCode) {
    const error = new Error('Missing OAuth authorization code');
    error.status = 400;
    throw error;
  }

  const clientId = requiredEnv('LINKEDIN_CLIENT_ID');
  const clientSecret = requiredEnv('LINKEDIN_CLIENT_SECRET');
  const redirectUri = requiredEnv('LINKEDIN_REDIRECT_URI');

  const tokenUrl = new URL('/accessToken', `${LINKEDIN_AUTH_BASE_URL}/`);
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', authorizationCode);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('redirect_uri', redirectUri);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`LinkedIn token exchange failed with status ${response.status}`);
    error.status = response.status;
    error.upstream = payload;
    throw error;
  }

  return payload;
}

async function refreshAccessToken({ refreshToken }) {
  const refreshValue = String(refreshToken || '').trim();
  if (!refreshValue) {
    const error = new Error('Missing LinkedIn refresh token');
    error.status = 400;
    throw error;
  }

  const clientId = requiredEnv('LINKEDIN_CLIENT_ID');
  const clientSecret = requiredEnv('LINKEDIN_CLIENT_SECRET');

  const tokenUrl = new URL('/accessToken', `${LINKEDIN_AUTH_BASE_URL}/`);
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshValue);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`LinkedIn token refresh failed with status ${response.status}`);
    error.status = response.status;
    error.upstream = payload;
    throw error;
  }

  return payload;
}

function computeExpiresAt(expiresInSeconds) {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(Date.now() + seconds * 1000);
}

function sanitizeTokenForClient(doc) {
  if (!doc) {
    return {
      connected: false,
      provider: PROVIDER_ID,
    };
  }

  return {
    connected: true,
    provider: doc.provider,
    tokenType: doc.tokenType || 'Bearer',
    scope: doc.scope || '',
    expiresAt: doc.expiresAt || null,
    lastRefreshedAt: doc.lastRefreshedAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function upsertLinkedInToken(tokenPayload, { preserveExistingRefreshToken = true } = {}) {
  const accessToken = String(tokenPayload?.access_token || '').trim();
  if (!accessToken) {
    const error = new Error('LinkedIn token response is missing access_token');
    error.status = 400;
    throw error;
  }

  const refreshToken = String(tokenPayload?.refresh_token || '').trim();
  const existing = await LinkedInOAuthToken.findOne({ provider: PROVIDER_ID });
  const resolvedRefreshToken =
    refreshToken || (preserveExistingRefreshToken && existing ? decryptSecret(existing.encryptedRefreshToken) : '');

  const update = {
    encryptedAccessToken: encryptSecret(accessToken),
    tokenType: tokenPayload?.token_type || existing?.tokenType || 'Bearer',
    scope: tokenPayload?.scope || existing?.scope || '',
    expiresAt: computeExpiresAt(tokenPayload?.expires_in),
    lastRefreshedAt: new Date(),
    raw: tokenPayload,
  };

  if (resolvedRefreshToken) {
    update.encryptedRefreshToken = encryptSecret(resolvedRefreshToken);
  }

  const doc = await LinkedInOAuthToken.findOneAndUpdate(
    { provider: PROVIDER_ID },
    { $set: update, $setOnInsert: { provider: PROVIDER_ID } },
    { upsert: true, new: true }
  );

  return doc;
}

function shouldRefreshToken(doc) {
  if (!doc?.expiresAt) {
    return false;
  }

  return new Date(doc.expiresAt).getTime() <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
}

async function getLinkedInAccessToken({ allowRefresh = true } = {}) {
  const doc = await LinkedInOAuthToken.findOne({ provider: PROVIDER_ID });
  if (!doc) {
    return {
      accessToken: null,
      source: 'none',
      tokenInfo: sanitizeTokenForClient(null),
    };
  }

  if (allowRefresh && shouldRefreshToken(doc)) {
    const refreshToken = decryptSecret(doc.encryptedRefreshToken);
    if (refreshToken) {
      const refreshed = await refreshAccessToken({ refreshToken });
      const updatedDoc = await upsertLinkedInToken(refreshed, {
        preserveExistingRefreshToken: true,
      });
      return {
        accessToken: decryptSecret(updatedDoc.encryptedAccessToken),
        source: 'stored-refreshed',
        tokenInfo: sanitizeTokenForClient(updatedDoc),
      };
    }
  }

  return {
    accessToken: decryptSecret(doc.encryptedAccessToken),
    source: 'stored',
    tokenInfo: sanitizeTokenForClient(doc),
  };
}

async function getLinkedInConnectionStatus() {
  const doc = await LinkedInOAuthToken.findOne({ provider: PROVIDER_ID });
  return sanitizeTokenForClient(doc);
}

async function clearLinkedInToken() {
  const result = await LinkedInOAuthToken.deleteOne({ provider: PROVIDER_ID });
  return {
    removed: result.deletedCount > 0,
  };
}

async function linkedinApiGet(path, { accessToken, query = {} } = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('Missing LinkedIn access token');
    error.status = 401;
    throw error;
  }

  const url = new URL(path, `${LINKEDIN_API_BASE_URL}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`LinkedIn API request failed with status ${response.status}`);
    error.status = response.status;
    error.upstream = payload;
    throw error;
  }

  return payload;
}

module.exports = {
  buildLinkedInAuthorizationUrl,
  clearLinkedInToken,
  exchangeAuthorizationCodeForToken,
  getLinkedInAccessToken,
  getLinkedInConnectionStatus,
  linkedinApiGet,
  upsertLinkedInToken,
};
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 5000);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || META_APP_ID;
const INSTAGRAM_APP_SECRET =
  process.env.INSTAGRAM_APP_SECRET || META_APP_SECRET;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const INSTAGRAM_GRAPH_VERSION =
  process.env.INSTAGRAM_GRAPH_VERSION || "v25.0";
const INSTAGRAM_EXCHANGE_LONG_LIVED_TOKEN =
  process.env.INSTAGRAM_EXCHANGE_LONG_LIVED_TOKEN === "true";
const INSTAGRAM_LOOKUP_PROFILE =
  process.env.INSTAGRAM_LOOKUP_PROFILE === "true";
const FACEBOOK_CONFIG_ID_PUBLISHING =
  process.env.FACEBOOK_CONFIG_ID_PUBLISHING;
const INSTAGRAM_WITH_FACEBOOK_CONFIG_ID =
  process.env.INSTAGRAM_WITH_FACEBOOK_CONFIG_ID;
const INSTAGRAM_DIRECT_CONFIG_ID = process.env.INSTAGRAM_DIRECT_CONFIG_ID;
const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_REDIRECT_URI ||
  `${API_BASE_URL}/api/auth/facebook/callback`;
const INSTAGRAM_REDIRECT_URI =
  process.env.INSTAGRAM_REDIRECT_URI ||
  `${API_BASE_URL}/api/auth/instagram/callback`;

const FACEBOOK_SCOPES =
  process.env.FACEBOOK_SCOPES ||
  [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish"
  ].join(",");

const INSTAGRAM_SCOPES =
  process.env.INSTAGRAM_SCOPES ||
  ["instagram_business_basic", "instagram_business_content_publish"].join(",");
const DATA_DIR = path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const accounts = new Map();
const oauthStates = new Map();

loadPersistedAccounts();

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  const missingConfig = getMissingMetaConfig();

  res.json({
    ok: true,
    configured: missingConfig.length === 0,
    missingConfig,
    accounts: accounts.size
  });
});

app.get("/api/auth/facebook/start", (_req, res) => {
  ensureMetaConfig();

  const state = createOAuthState("facebook");
  const url = buildFacebookOAuthUrl({
    state,
    configId: FACEBOOK_CONFIG_ID_PUBLISHING,
    fallbackScopes: FACEBOOK_SCOPES
  });

  res.redirect(url.toString());
});

app.get("/api/auth/instagram/facebook/start", (_req, res) => {
  ensureMetaConfig();

  const state = createOAuthState("instagram_with_facebook");
  const url = buildFacebookOAuthUrl({
    state,
    configId: INSTAGRAM_WITH_FACEBOOK_CONFIG_ID,
    fallbackScopes: FACEBOOK_SCOPES
  });

  res.redirect(url.toString());
});

app.get("/api/auth/facebook/callback", async (req, res, next) => {
  try {
    ensureMetaConfig();
    const oauthState = validateOAuthState(req.query.state, [
      "facebook",
      "instagram_with_facebook"
    ]);

    const code = requireQueryParam(req.query.code, "code");
    const shortLivedToken = await exchangeFacebookCode(code);
    const token = await exchangeLongLivedFacebookToken(shortLivedToken);
    const pages = await getFacebookPages(token.access_token);
    const connectedAccounts = upsertFacebookAccounts(pages);

    res.redirect(
      clientResultUrl(
        oauthState.provider === "instagram_with_facebook"
          ? "instagram_facebook_connected"
          : "facebook_connected",
        {
        accounts: String(connectedAccounts.length)
        }
      )
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/instagram/start", (_req, res) => {
  ensureMetaConfig();

  const state = createOAuthState("instagram");
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", INSTAGRAM_APP_ID);
  url.searchParams.set("redirect_uri", INSTAGRAM_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", INSTAGRAM_SCOPES);
  url.searchParams.set("response_type", "code");

  res.redirect(url.toString());
});

app.get("/api/auth/instagram/callback", async (req, res, next) => {
  try {
    ensureMetaConfig();
    validateOAuthState(req.query.state, "instagram");

    const code = requireQueryParam(req.query.code, "code");
    const shortLivedToken = await exchangeInstagramCode(code);
    const normalizedShortLivedToken =
      normalizeInstagramShortLivedToken(shortLivedToken);
    const token = await getBestAvailableInstagramToken(normalizedShortLivedToken);
    const profile = await getBestAvailableInstagramProfile(
      token.access_token,
      normalizedShortLivedToken
    );
    const account = upsertInstagramDirectAccount(profile, token);

    res.redirect(
      clientResultUrl("instagram_connected", {
        accounts: "1",
        account: account.displayName
      })
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/accounts", (_req, res) => {
  res.json({
    accounts: [...accounts.values()].map(toSafeAccount)
  });
});

app.delete("/api/accounts/:accountId", (req, res) => {
  const deleted = accounts.delete(req.params.accountId);
  persistAccounts();
  res.json({ deleted });
});

app.post("/api/publish/facebook", async (req, res, next) => {
  try {
    const { accountId, message, link } = req.body;
    const account = getAccount(accountId);

    if (account.provider !== "facebook") {
      throw badRequest("Selected account is not a Facebook Page.");
    }

    if (!message?.trim() && !link?.trim()) {
      throw badRequest("Facebook publish requires a message or link.");
    }

    const result = await publishFacebookPagePost(account, { message, link });
    res.json({ provider: "facebook", account: toSafeAccount(account), result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/publish/instagram", async (req, res, next) => {
  try {
    const { accountId, caption, imageUrl } = req.body;
    const account = getAccount(accountId);

    if (account.provider !== "instagram") {
      throw badRequest("Selected account is not an Instagram account.");
    }

    if (!imageUrl?.trim()) {
      throw badRequest("Instagram publish requires a public image URL.");
    }

    const result = await publishInstagramPost(account, { caption, imageUrl });
    res.json({ provider: "instagram", account: toSafeAccount(account), result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/publish", async (req, res) => {
  const { accountIds = [], message, caption, imageUrl, link } = req.body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw badRequest("Select at least one connected account.");
  }

  const results = [];

  for (const accountId of accountIds) {
    try {
      const account = getAccount(accountId);
      const result =
        account.provider === "facebook"
          ? await publishFacebookPagePost(account, { message, link })
          : await publishInstagramPost(account, { caption: caption || message, imageUrl });

      results.push({
        ok: true,
        account: toSafeAccount(account),
        result
      });
    } catch (error) {
      results.push({
        ok: false,
        accountId,
        error: error.message
      });
    }
  }

  res.status(results.some((result) => !result.ok) ? 207 : 200).json({ results });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: error.message || "Unexpected server error."
  });
});

app.listen(PORT, () => {
  console.log(`API running on ${API_BASE_URL}`);
  console.log(`Client URL allowed by CORS: ${CLIENT_URL}`);
});

function buildFacebookOAuthUrl({ state, configId, fallbackScopes }) {
  const url = new URL(
    `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`
  );
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");

  if (configId) {
    url.searchParams.set("config_id", configId);
  } else {
    url.searchParams.set("scope", fallbackScopes);
  }

  return url;
}

function ensureMetaConfig() {
  const missingConfig = getMissingMetaConfig();

  if (missingConfig.length > 0) {
    throw badRequest(
      `Missing Meta config: ${missingConfig.join(", ")}. Update .env and restart the server.`
    );
  }
}

function getMissingMetaConfig() {
  const required = {
    META_APP_ID,
    META_APP_SECRET,
    FACEBOOK_REDIRECT_URI,
    INSTAGRAM_REDIRECT_URI
  };

  return Object.entries(required)
    .filter(([, value]) => !isRealEnvValue(value))
    .map(([key]) => key);
}

function isRealEnvValue(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.trim().startsWith("your_")
  );
}

function createOAuthState(provider) {
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, { provider, createdAt: Date.now() });
  return state;
}

function validateOAuthState(state, expectedProviders) {
  const value = typeof state === "string" ? oauthStates.get(state) : null;
  oauthStates.delete(state);
  const providers = Array.isArray(expectedProviders)
    ? expectedProviders
    : [expectedProviders];

  if (
    !value ||
    !providers.includes(value.provider) ||
    Date.now() - value.createdAt > 600_000
  ) {
    throw badRequest("OAuth state is invalid or expired. Start connection again.");
  }

  return value;
}

function requireQueryParam(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Missing required query param: ${name}`);
  }
  return value;
}

async function exchangeFacebookCode(code) {
  const url = facebookGraphUrl("oauth/access_token", {
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: FACEBOOK_REDIRECT_URI,
    code
  });

  return getJson(url);
}

async function exchangeLongLivedFacebookToken(shortLivedUserToken) {
  const url = facebookGraphUrl("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: shortLivedUserToken.access_token
  });

  return getJson(url);
}

async function getFacebookPages(userAccessToken) {
  const url = facebookGraphUrl("me/accounts", {
    access_token: userAccessToken,
    fields:
      [
        "id",
        "name",
        "access_token",
        "instagram_business_account{id,username,name,profile_picture_url}",
        "connected_instagram_account{id,username,name,profile_picture_url}"
      ].join(",")
  });

  const response = await getJson(url);
  return response.data || [];
}

function upsertFacebookAccounts(pages) {
  const connectedAccounts = [];

  for (const page of pages) {
    if (!page.access_token) {
      continue;
    }

    const facebookAccount = upsertAccount({
      provider: "facebook",
      connectionType: "facebook_page",
      providerAccountId: page.id,
      displayName: page.name,
      accessToken: page.access_token,
      metadata: {
        pageId: page.id
      }
    });
    connectedAccounts.push(facebookAccount);

    const instagram =
      page.instagram_business_account || page.connected_instagram_account;

    if (instagram) {
      const instagramAccount = upsertAccount({
        provider: "instagram",
        connectionType: "instagram_via_facebook",
        providerAccountId: instagram.id,
        displayName: instagram.username || instagram.name || `Instagram ${instagram.id}`,
        accessToken: page.access_token,
        metadata: {
          igUserId: instagram.id,
          pageId: page.id,
          pageName: page.name,
          sourceField: page.instagram_business_account
            ? "instagram_business_account"
            : "connected_instagram_account",
          profilePictureUrl: instagram.profile_picture_url
        }
      });
      connectedAccounts.push(instagramAccount);
    }
  }

  return connectedAccounts;
}

async function exchangeInstagramCode(code) {
  const body = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID,
    client_secret: INSTAGRAM_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: INSTAGRAM_REDIRECT_URI,
    code
  });

  return postForm("https://api.instagram.com/oauth/access_token", body);
}

function normalizeInstagramShortLivedToken(payload) {
  const data = payload?.data?.[0] || payload || {};
  const accessToken = data.access_token;

  if (!accessToken) {
    throw badRequest(
      "Instagram token response did not include an access token. Check Instagram App ID/Secret and redirect URI."
    );
  }

  return {
    access_token: accessToken,
    user_id: data.user_id,
    permissions: data.permissions
  };
}

async function getBestAvailableInstagramToken(shortLivedToken) {
  if (!INSTAGRAM_EXCHANGE_LONG_LIVED_TOKEN) {
    return {
      ...shortLivedToken,
      tokenType: "short_lived"
    };
  }

  try {
    return await exchangeLongLivedInstagramToken(shortLivedToken.access_token);
  } catch (error) {
    if (!isUnsupportedMethodMetaError(error)) {
      throw error;
    }

    console.warn(
      "Falling back to short-lived Instagram token because long-lived exchange is unavailable for this app/API mode."
    );
    return {
      ...shortLivedToken,
      tokenType: "short_lived"
    };
  }
}

async function exchangeLongLivedInstagramToken(shortLivedAccessToken) {
  const body = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: INSTAGRAM_APP_SECRET,
    access_token: shortLivedAccessToken
  });

  return postForm("https://graph.instagram.com/access_token", body);
}

async function getInstagramProfile(accessToken) {
  const url = instagramGraphUrl("me");
  url.searchParams.set("fields", "user_id,username,name,account_type");

  return getJson(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

async function getBestAvailableInstagramProfile(accessToken, shortLivedToken) {
  if (!INSTAGRAM_LOOKUP_PROFILE) {
    return getInstagramProfileFromTokenPayload(shortLivedToken);
  }

  try {
    return await getInstagramProfile(accessToken);
  } catch (error) {
    console.warn(
      "Falling back to Instagram token payload because profile lookup failed.",
      error.message
    );
    return getInstagramProfileFromTokenPayload(shortLivedToken);
  }
}

function getInstagramProfileFromTokenPayload(shortLivedToken) {
  return {
    user_id: shortLivedToken.user_id,
    username: shortLivedToken.user_id
      ? `Instagram ${shortLivedToken.user_id}`
      : "Instagram account"
  };
}

function upsertInstagramDirectAccount(profile, token) {
  return upsertAccount({
    provider: "instagram",
    connectionType: "instagram_direct",
    providerAccountId: profile.user_id || profile.id,
    displayName: profile.username || profile.name || `Instagram ${profile.user_id}`,
    accessToken: token.access_token,
    tokenExpiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null,
    metadata: {
      igUserId: profile.user_id || profile.id,
      accountType: profile.account_type,
      name: profile.name,
      tokenType: token.tokenType || "long_lived",
      permissions: normalizePermissions(token.permissions),
      hasContentPublishPermission: normalizePermissions(token.permissions).includes(
        "instagram_business_content_publish"
      )
    }
  });
}

function normalizePermissions(permissions) {
  if (Array.isArray(permissions)) {
    return permissions;
  }

  if (typeof permissions === "string") {
    return permissions
      .split(",")
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  return [];
}

async function publishFacebookPagePost(account, { message, link }) {
  const url = facebookGraphUrl(`${account.metadata.pageId}/feed`);
  const body = new URLSearchParams({
    access_token: account.accessToken
  });

  if (message?.trim()) {
    body.set("message", message.trim());
  }
  if (link?.trim()) {
    body.set("link", link.trim());
  }

  return postForm(url, body);
}

async function publishInstagramPost(account, { caption, imageUrl }) {
  const media = await createInstagramMediaContainer(account, { caption, imageUrl });
  return publishInstagramMediaContainer(account, media.id);
}

async function createInstagramMediaContainer(account, { caption, imageUrl }) {
  if (account.connectionType === "instagram_direct") {
    return createDirectInstagramMediaContainer(account, { caption, imageUrl });
  }

  const body = new URLSearchParams({
    image_url: imageUrl.trim(),
    access_token: account.accessToken
  });

  if (caption?.trim()) {
    body.set("caption", caption.trim());
  }

  return postForm(facebookGraphUrl(`${account.metadata.igUserId}/media`), body);
}

async function publishInstagramMediaContainer(account, creationId) {
  if (account.connectionType === "instagram_direct") {
    return publishDirectInstagramMediaContainer(account, creationId);
  }

  const body = new URLSearchParams({
    creation_id: creationId,
    access_token: account.accessToken
  });

  return postForm(facebookGraphUrl(`${account.metadata.igUserId}/media_publish`), body);
}

async function createDirectInstagramMediaContainer(account, { caption, imageUrl }) {
  const jsonBody = {
    image_url: imageUrl.trim(),
    media_type: "IMAGE"
  };

  if (caption?.trim()) {
    jsonBody.caption = caption.trim();
  }

  const formBody = new URLSearchParams({
    ...jsonBody,
    access_token: account.accessToken
  });

  return tryMetaRequestVariants([
    () =>
      postJson(instagramGraphUrl("me/media"), jsonBody, {
        Authorization: `Bearer ${account.accessToken}`
      }),
    () => postForm(instagramGraphUrl("me/media"), formBody),
    () => postForm(instagramGraphUrlWithoutVersion("me/media"), formBody),
    () =>
      postJson(instagramGraphUrl(`${account.metadata.igUserId}/media`), jsonBody, {
        Authorization: `Bearer ${account.accessToken}`
      }),
    () => postForm(instagramGraphUrl(`${account.metadata.igUserId}/media`), formBody),
    () =>
      postForm(
        instagramGraphUrlWithoutVersion(`${account.metadata.igUserId}/media`),
        formBody
      )
  ]);
}

async function publishDirectInstagramMediaContainer(account, creationId) {
  const jsonBody = {
    creation_id: creationId
  };
  const formBody = new URLSearchParams({
    creation_id: creationId,
    access_token: account.accessToken
  });

  return tryMetaRequestVariants([
    () =>
      postJson(instagramGraphUrl("me/media_publish"), jsonBody, {
        Authorization: `Bearer ${account.accessToken}`
      }),
    () => postForm(instagramGraphUrl("me/media_publish"), formBody),
    () => postForm(instagramGraphUrlWithoutVersion("me/media_publish"), formBody),
    () =>
      postJson(
        instagramGraphUrl(`${account.metadata.igUserId}/media_publish`),
        jsonBody,
        {
          Authorization: `Bearer ${account.accessToken}`
        }
      ),
    () =>
      postForm(
        instagramGraphUrl(`${account.metadata.igUserId}/media_publish`),
        formBody
      ),
    () =>
      postForm(
        instagramGraphUrlWithoutVersion(`${account.metadata.igUserId}/media_publish`),
        formBody
      )
  ]);
}

function upsertAccount(account) {
  const id = `${account.provider}:${account.connectionType}:${account.providerAccountId}`;
  const savedAccount = {
    id,
    connectedAt: new Date().toISOString(),
    ...account
  };

  accounts.set(id, savedAccount);
  persistAccounts();
  return savedAccount;
}

function loadPersistedAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      return;
    }

    const savedAccounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));

    if (!Array.isArray(savedAccounts)) {
      return;
    }

    for (const account of savedAccounts) {
      if (account?.id) {
        accounts.set(account.id, account);
      }
    }
  } catch (error) {
    console.warn("Could not load persisted accounts.", error.message);
  }
}

function persistAccounts() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      ACCOUNTS_FILE,
      JSON.stringify([...accounts.values()], null, 2)
    );
  } catch (error) {
    console.warn("Could not persist accounts.", error.message);
  }
}

function getAccount(accountId) {
  const account = accounts.get(accountId);

  if (!account) {
    throw badRequest("Connected account was not found. Reconnect and try again.");
  }

  return account;
}

function toSafeAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    connectionType: account.connectionType,
    providerAccountId: account.providerAccountId,
    displayName: account.displayName,
    connectedAt: account.connectedAt,
    tokenExpiresAt: account.tokenExpiresAt || null,
    metadata: {
      pageId: account.metadata?.pageId,
      pageName: account.metadata?.pageName,
      igUserId: account.metadata?.igUserId,
      accountType: account.metadata?.accountType,
      tokenType: account.metadata?.tokenType,
      permissions: account.metadata?.permissions || [],
      hasContentPublishPermission:
        account.metadata?.hasContentPublishPermission || false,
      profilePictureUrl: account.metadata?.profilePictureUrl
    }
  };
}

function facebookGraphUrl(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function instagramGraphUrl(path, params = {}) {
  const url = new URL(`https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function instagramGraphUrlWithoutVersion(path, params = {}) {
  const url = new URL(`https://graph.instagram.com/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  return parseMetaResponse(response);
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  return parseMetaResponse(response, {
    method: "POST",
    url: response.url
  });
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  return parseMetaResponse(response, {
    method: "POST",
    url: response.url
  });
}

async function tryMetaRequestVariants(variants) {
  let lastError;

  for (const variant of variants) {
    try {
      return await variant();
    } catch (error) {
      lastError = error;

      if (!isUnsupportedMethodMetaError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function parseMetaResponse(response, requestInfo = {}) {
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error_description ||
      `Meta request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status >= 500 ? 502 : 400;
    error.meta = payload;
    error.requestInfo = {
      method: requestInfo.method || "GET",
      url: requestInfo.url || response.url
    };
    console.error("Meta API error", {
      method: error.requestInfo.method,
      url: redactAccessToken(error.requestInfo.url),
      status: response.status,
      payload
    });
    throw error;
  }

  return payload;
}

function redactAccessToken(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.searchParams.has("access_token")) {
      parsedUrl.searchParams.set("access_token", "[redacted]");
    }
    if (parsedUrl.searchParams.has("client_secret")) {
      parsedUrl.searchParams.set("client_secret", "[redacted]");
    }
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function isUnsupportedMethodMetaError(error) {
  return (
    error?.meta?.error?.code === 100 &&
    typeof error?.message === "string" &&
    error.message.toLowerCase().includes("unsupported request - method type")
  );
}

function clientResultUrl(status, params = {}) {
  const url = new URL(CLIENT_URL);
  url.searchParams.set("status", status);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

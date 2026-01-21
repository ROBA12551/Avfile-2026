/**
 * netlify/functions/github-upload.js
 * Avfile - GitHub Releases Uploader + github.json Registry + View Creator
 *
 * Actions:
 * - create-release
 * - upload-asset
 * - get-github-json
 * - save-github-json
 * - create-view   ← views を Functions 側で一本化（shortId発行 + views追記）
 */

const https = require('https');

/* =========================
   Environment
========================= */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

/* =========================
   Logging
========================= */
function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}
function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

/* =========================
   Rate Limit (simple, best-effort)
   Note: Netlify Functions can be stateless; this is a soft limiter.
========================= */
const requestCache = new Map();
function checkRateLimit(clientId) {
  const now = Date.now();
  const windowMs = 3600 * 1000;

  if (!requestCache.has(clientId)) {
    requestCache.set(clientId, { count: 0, reset: now + windowMs });
  }

  const record = requestCache.get(clientId);
  if (now > record.reset) {
    record.count = 0;
    record.reset = now + windowMs;
  }

  record.count++;
  return record.count <= 60;
}

/* =========================
   Helpers
========================= */
function unwrapData(x) {
  // Protect against accidental nesting {data:{data:{...}}}
  while (x && typeof x === 'object' && x.data) x = x.data;
  return x;
}

function normalizeGithubJson(obj) {
  const out = unwrapData(obj) || {};
  out.files = Array.isArray(out.files) ? out.files : [];
  out.views = Array.isArray(out.views) ? out.views : [];
  out.lastUpdated = typeof out.lastUpdated === 'string' ? out.lastUpdated : new Date().toISOString();
  return out;
}

function generateShortId(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/* =========================
   GitHub API (api.github.com)
========================= */
async function githubRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Avfile-Netlify',
        ...headers,
      },
    };

    if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
    }
    if (body) {
      options.headers['Content-Type'] =
        options.headers['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    logInfo(`GitHub API Request: ${method} ${path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            // Some endpoints can return empty or non-json
            resolve({});
          }
        } else {
          reject(
            new Error(
              `GitHub API Error ${res.statusCode}: ${data || 'Unknown'}`
            )
          );
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* =========================
   GitHub Upload API (uploads.github.com)
========================= */
async function githubUploadRequest(method, fullUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);

    const options = {
      hostname: parsed.hostname, // uploads.github.com
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Avfile-Netlify',
        ...headers,
      },
    };

    if (body) {
      options.headers['Content-Length'] = body.length;
    }

    logInfo(`GitHub Upload Request: ${method} ${parsed.hostname}${options.path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve({});
          }
        } else {
          reject(
            new Error(
              `Upload Error ${res.statusCode}: ${data || 'Unknown'}`
            )
          );
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* =========================
   Release
========================= */
async function createRelease(tag, metadata) {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

  const body = {
    tag_name: tag,
    name: metadata?.title || 'Uploaded File',
    body: JSON.stringify(metadata || {}, null, 2),
    draft: false,
    prerelease: false,
  };

  const data = await githubRequest('POST', path, body);

  return {
    release_id: data.id,
    upload_url: data.upload_url,
    html_url: data.html_url,
    tag_name: data.tag_name,
  };
}

/* =========================
   Upload Asset
========================= */
async function uploadAsset(uploadUrl, fileData, fileName) {
  const clean = uploadUrl.replace('{?name,label}', '');
  const assetUrl = `${clean}?name=${encodeURIComponent(fileName)}`;

  const data = await githubUploadRequest(
    'POST',
    assetUrl,
    fileData,
    { 'Content-Type': 'application/octet-stream' }
  );

  return {
    asset_id: data.id,
    name: data.name,
    size: data.size,
    download_url: data.browser_download_url,
  };
}

/* =========================
   github.json (repo contents)
========================= */
async function getGithubJson() {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  try {
    const res = await githubRequest('GET', path);
    const decoded = Buffer.from(res.content, 'base64').toString('utf-8');
    let parsed = JSON.parse(decoded);

    // 🔥 data.data.data... を全部剥がす + 正規化
    parsed = normalizeGithubJson(parsed);

    return { data: parsed, sha: res.sha };
  } catch {
    return {
      data: { files: [], views: [], lastUpdated: new Date().toISOString() },
      sha: null,
    };
  }
}

async function saveGithubJson(jsonData, sha = null) {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  const clean = normalizeGithubJson(jsonData);

  const content = Buffer
    .from(JSON.stringify(clean, null, 2))
    .toString('base64');

  const payload = {
    message: `Update github.json ${new Date().toISOString()}`,
    content,
    branch: 'main',
  };

  if (sha) payload.sha = sha;

  await githubRequest('PUT', path, payload);
}

/* =========================
   Create View (Functions side, unified)
========================= */
async function createViewOnServer(fileIds, passwordHash, origin) {
  const current = await getGithubJson();
  const json = current.data;

  // collision-safe viewId generation
  let viewId = null;
  for (let i = 0; i < 12; i++) {
    const cand = generateShortId(6);
    const exists = (json.views || []).some(v => v && v.viewId === cand);
    if (!exists) { viewId = cand; break; }
  }
  if (!viewId) throw new Error('Failed to generate viewId');

  json.views = json.views || [];
  json.views.push({
    viewId,
    files: fileIds,
    password: passwordHash || null,
    createdAt: new Date().toISOString(),
  });

  json.lastUpdated = new Date().toISOString();

  await saveGithubJson(json, current.sha);

  const base = (origin || '').replace(/\/$/, '');
  return {
    viewId,
    viewPath: `/d/${viewId}`,
    shareUrl: base ? `${base}/d/${viewId}` : `/d/${viewId}`,
  };
}

/* =========================
   Handler
========================= */
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing GitHub env vars' }),
    };
  }

  const clientIp =
    event.headers['client-ip'] ||
    event.headers['x-forwarded-for'] ||
    'unknown';

  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let response;

    switch (body.action) {
      case 'create-release':
        response = await createRelease(body.releaseTag, body.metadata);
        break;

      case 'upload-asset':
        response = await uploadAsset(
          body.uploadUrl,
          Buffer.from(body.fileBase64, 'base64'),
          body.fileName
        );
        break;

      case 'get-github-json':
        response = await getGithubJson();
        break;

      case 'save-github-json': {
        const current = await getGithubJson();

        // 🔥 unwrap + normalize to prevent nested data/data/data
        let cleanData = body.jsonData;
        cleanData = normalizeGithubJson(cleanData);

        await saveGithubJson(cleanData, current.sha);
        response = { success: true };
        break;
      }

      case 'create-view': {
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        if (fileIds.length === 0) throw new Error('fileIds required');

        // passwordHash is already sha256 from client (or null)
        const passwordHash = body.passwordHash || null;
        const origin = body.origin || '';

        response = await createViewOnServer(fileIds, passwordHash, origin);
        break;
      }

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: response }),
    };
  } catch (e) {
    logError(e.stack || e.message || String(e));
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message || 'Bad Request' }),
    };
  }
};

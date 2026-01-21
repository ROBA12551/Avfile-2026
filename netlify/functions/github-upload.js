const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

/* =======================
   Logging
======================= */
function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}
function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

/* =======================
   Rate Limit (simple)
======================= */
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

/* =======================
   GitHub API (api.github.com)
======================= */
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
      options.headers['Content-Length'] = Buffer.byteLength(body);
      options.headers['Content-Type'] =
        options.headers['Content-Type'] || 'application/json';
    }

    logInfo(`GitHub API Request: ${method} ${path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
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

/* =======================
   GitHub Upload API (uploads.github.com)
======================= */
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
          resolve(data ? JSON.parse(data) : {});
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

/* =======================
   Release
======================= */
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

/* =======================
   Upload Asset
======================= */
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

/* =======================
   Handler
======================= */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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
    return { statusCode: 429, body: 'Rate limit exceeded' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    let result;
    switch (body.action) {
      case 'create-release':
        result = await createRelease(body.releaseTag, body.metadata);
        break;

      case 'upload-asset':
        result = await uploadAsset(
          body.uploadUrl,
          Buffer.from(body.fileBase64, 'base64'),
          body.fileName
        );
        break;

      default:
        throw new Error('Unknown action');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: result }),
    };
  } catch (e) {
    logError(e.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};

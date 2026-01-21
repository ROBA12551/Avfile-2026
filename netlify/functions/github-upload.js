const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}
function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

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

function unwrapData(x) {
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
        logInfo(`GitHub Response: ${res.statusCode}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
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

async function githubUploadRequest(method, fullUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(fullUrl);

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'Avfile-Netlify',
          'Content-Type': 'application/octet-stream',
          ...headers,
        },
      };

      if (body) {
        options.headers['Content-Length'] = body.length;
      }

      logInfo(`Upload Request: ${method} ${parsed.hostname}${options.path.substring(0, 80)}`);
      logInfo(`Upload body size: ${body ? body.length : 0} bytes`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          logInfo(`Upload Response: ${res.statusCode}`);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              logError('Upload response not JSON - retrying');
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

      req.on('error', (err) => {
        logError(`Upload Request Error: ${err.message}`);
        reject(err);
      });
      
      if (body) req.write(body);
      req.end();
    } catch (e) {
      logError(`URL Parse Error: ${e.message}`);
      reject(e);
    }
  });
}

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

  logInfo(`Release created: ${data.id}`);

  return {
    release_id: data.id,
    upload_url: data.upload_url,
    html_url: data.html_url,
    tag_name: data.tag_name,
  };
}

async function uploadAsset(uploadUrl, fileData, fileName) {
  try {
    logInfo(`Preparing asset upload: ${fileName}`);
    logInfo(`File size: ${fileData.length} bytes`);

    const clean = uploadUrl.replace('{?name,label}', '');
    const assetUrl = `${clean}?name=${encodeURIComponent(fileName)}`;

    logInfo(`Asset URL: ${assetUrl.substring(0, 100)}`);

    const data = await githubUploadRequest(
      'POST',
      assetUrl,
      fileData,
      { 'Content-Type': 'application/octet-stream' }
    );

    logInfo(`Asset uploaded: ${data.id || 'unknown'}`);

    return {
      asset_id: data.id,
      name: data.name,
      size: data.size,
      download_url: data.browser_download_url,
    };
  } catch (e) {
    logError(`Asset upload failed: ${e.message}`);
    throw e;
  }
}

async function getGithubJson() {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  try {
    const res = await githubRequest('GET', path);
    const decoded = Buffer.from(res.content, 'base64').toString('utf-8');
    let parsed = JSON.parse(decoded);

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

  logInfo(`Saving: ${clean.files.length} files, ${clean.views.length} views`);

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
  logInfo('github.json saved');
}

async function createViewOnServer(fileIds, passwordHash, origin) {
  const current = await getGithubJson();
  const json = current.data;

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

exports.handler = async (event) => {
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
    logError('Missing GitHub env vars');
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
        logInfo(`Action: create-release tag=${body.releaseTag}`);
        response = await createRelease(body.releaseTag, body.metadata);
        break;

      case 'upload-asset':
        logInfo(`Action: upload-asset fileName=${body.fileName}`);
        const assetResponse = await uploadAsset(
          body.uploadUrl,
          Buffer.from(body.fileBase64, 'base64'),
          body.fileName
        );

        // ★★★ 重要: アセットアップロード後、ファイル情報を github.json に保存 ★★★
        const current = await getGithubJson();
        const json = current.data;
        json.files = json.files || [];

        const fileInfo = {
          fileId: body.fileId,
          fileName: body.fileName,
          downloadUrl: assetResponse.download_url,  // ★ URL を保存
          fileSize: body.fileSize,
          uploadedAt: new Date().toISOString(),
        };

        json.files.push(fileInfo);
        logInfo(`File saved to github.json: ${body.fileName}`);

        await saveGithubJson(json, current.sha);

        response = assetResponse;
        break;

      case 'get-github-json':
        logInfo('Action: get-github-json');
        response = await getGithubJson();
        break;

      case 'save-github-json': {
        logInfo('Action: save-github-json');
        const current = await getGithubJson();
        let cleanData = body.jsonData;
        cleanData = normalizeGithubJson(cleanData);
        await saveGithubJson(cleanData, current.sha);
        response = { success: true };
        break;
      }

      case 'create-view': {
        logInfo(`Action: create-view fileIds=${body.fileIds.length}`);
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        if (fileIds.length === 0) throw new Error('fileIds required');
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
    logError(`Error: ${e.message}`);
    logError(`Stack: ${e.stack}`);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message || 'Bad Request' }),
    };
  }
};
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
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
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
          reject(new Error(`GitHub API Error ${res.statusCode}: ${data || 'Unknown'}`));
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
      // ★ 修正: URL形式を完全にチェック
      if (!fullUrl || typeof fullUrl !== 'string') {
        throw new Error('Invalid uploadUrl: empty or not a string');
      }

      // ★ 修正: URI Templateを削除（複数パターン対応）
      let cleanUrl = fullUrl.trim();
      cleanUrl = cleanUrl.replace('{?name,label}', '');
      cleanUrl = cleanUrl.replace('{?name}', '');
      cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, ''); // 正規表現で全パターン対応

      logInfo(`Clean Upload URL: ${cleanUrl.substring(0, 80)}...`);

      // ★ 修正: URL形式を厳密にチェック
      let parsed;
      try {
        parsed = new URL(cleanUrl);
      } catch (e) {
        throw new Error(`Invalid URL format: ${e.message}`);
      }

      // ★ 修正: hostname が uploads.github.com であることを確認
      if (!parsed.hostname.includes('github.com')) {
        logInfo(`⚠️ Warning: hostname is ${parsed.hostname}, expected github.com`);
      }

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

      if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {
        body = Buffer.from(body);
      }

      if (body) {
        options.headers['Content-Length'] = body.length;
      }

      logInfo(`Upload Request: ${method} ${parsed.hostname}${parsed.pathname.substring(0, 50)}...`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          logInfo(`Upload Response: ${res.statusCode}`);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve({});
            }
          } else {
            reject(new Error(`Upload Error ${res.statusCode}: ${data || 'Unknown'}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    } catch (e) {
      logError(`Upload Request Error: ${e.message}`);
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

// ★ 修正: uploadAsset関数を完全にリファクタリング
async function uploadAsset(uploadUrl, fileData, fileName) {
  try {
    logInfo(`Preparing asset upload: ${fileName}`);

    // ★ 修正: uploadUrlをバリデーション
    if (!uploadUrl || typeof uploadUrl !== 'string') {
      throw new Error('Invalid uploadUrl provided');
    }

    // ★ 修正: URI Templateを削除
    let baseUrl = String(uploadUrl).trim();
    baseUrl = baseUrl.replace('{?name,label}', '');
    baseUrl = baseUrl.replace('{?name}', '');
    baseUrl = baseUrl.replace(/\{[?&].*?\}/g, '');

    // ★ 修正: fileName をエンコード
    const encodedFileName = encodeURIComponent(fileName);
    const assetUrl = `${baseUrl}?name=${encodedFileName}`;

    logInfo(`Asset URL: ${assetUrl.substring(0, 100)}...`);

    // ★ 修正: fileData が Buffer であることを確認
    if (!Buffer.isBuffer(fileData)) {
      if (typeof fileData === 'string') {
        fileData = Buffer.from(fileData, 'base64');
      } else {
        throw new Error('Invalid fileData type');
      }
    }

    logInfo(`File size: ${fileData.length} bytes`);

    const data = await githubUploadRequest('POST', assetUrl, fileData, { 
      'Content-Type': 'application/octet-stream' 
    });

    logInfo(`Asset uploaded successfully`);

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

    parsed.files = Array.isArray(parsed.files) ? parsed.files : [];
    parsed.views = Array.isArray(parsed.views) ? parsed.views : [];

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

  logInfo(`Saving: ${jsonData.files.length} files, ${jsonData.views.length} views`);

  const content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64');

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
  
  const shareUrl = `${(origin || '').replace(/\/$/, '')}/d/${viewId}`;

  json.views.push({
    viewId,
    files: fileIds,
    password: passwordHash || null,
    shareUrl: shareUrl,
    createdAt: new Date().toISOString(),
  });

  json.lastUpdated = new Date().toISOString();

  await saveGithubJson(json, current.sha);

  return {
    viewId,
    viewPath: `/d/${viewId}`,
    shareUrl: shareUrl,
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
      body: JSON.stringify({ success: false, error: 'Missing GitHub env vars' }),
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
          body.fileBase64, // base64文字列として渡される
          body.fileName
        );

        const current = await getGithubJson();
        const json = current.data;
        json.files = json.files || [];

        const fileInfo = {
          fileId: body.fileId,
          fileName: body.fileName,
          downloadUrl: assetResponse.download_url,
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
        const result = await getGithubJson();
        response = result.data;
        break;

      case 'save-github-json': {
        logInfo('Action: save-github-json');
        const current = await getGithubJson();
        await saveGithubJson(body.jsonData, current.sha);
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
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message || 'Bad Request' }),
    };
  }
};
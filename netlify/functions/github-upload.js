/**
 * netlify/functions/github-upload.js
 * ✅ パスワード保護対応版
 */

const https = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// ===================== shard settings =====================
const INDEX_PATH = 'github.index.json';
const SHARD_PREFIX = 'github.';
const SHARD_SUFFIX = '.json';
const SHARD_MAX_ITEMS = 8000;
const SHARD_MAX_CHARS = 2_500_000;

// ===================== chunk settings =====================
const uploadChunks = new Map();
const CHUNK_TIMEOUT = 3600000;

setInterval(() => {
  const now = Date.now();
  for (const [uploadId, data] of uploadChunks.entries()) {
    if (now - data.timestamp > CHUNK_TIMEOUT) {
      console.log('[CLEANUP] Removing expired upload:', uploadId);
      uploadChunks.delete(uploadId);
    }
  }
}, 600000);

function shardPath(n) {
  return `${SHARD_PREFIX}${String(n).padStart(4, '0')}${SHARD_SUFFIX}`;
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function githubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch { /* ignore */ }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json || {});
        } else {
          const msg = (json && json.message) ? json.message : data;
          reject(new Error(`GitHub API Error ${res.statusCode}: ${msg}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getContent(pathInRepo) {
  const res = await githubApi(
    'GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(pathInRepo)}`
  );

  const text = res?.content
    ? Buffer.from(res.content, 'base64').toString('utf8')
    : '';

  return {
    sha: res?.sha || null,
    text,
    json: text ? safeJsonParse(text, null) : null,
  };
}

async function putContent(pathInRepo, jsonObj, message, sha = null) {
  const payload = {
    message,
    content: Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8').toString('base64'),
  };
  if (sha) payload.sha = sha;

  return await githubApi(
    'PUT',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(pathInRepo)}`,
    payload
  );
}

async function ensureIndex() {
  try {
    const { sha, json } = await getContent(INDEX_PATH);
    if (json && typeof json.current === 'number' && Array.isArray(json.shards)) {
      return { sha, index: json };
    }
  } catch (_) {}

  const now = new Date().toISOString();
  const fresh = {
    version: 1,
    current: 1,
    shards: [{ n: 1, path: shardPath(1), createdAt: now }]
  };

  await putContent(INDEX_PATH, fresh, 'Create github shards index');
  await putContent(shardPath(1), [], `Create shard: ${shardPath(1)}`);
  return { sha: null, index: fresh };
}

function shardIsFull(filesArr) {
  if (!Array.isArray(filesArr)) return false;
  if (filesArr.length >= SHARD_MAX_ITEMS) return true;
  const chars = JSON.stringify(filesArr).length;
  if (chars >= SHARD_MAX_CHARS) return true;
  return false;
}

async function getWritableShard() {
  const { index } = await ensureIndex();

  let n = index.current || 1;
  let path = shardPath(n);

  let shardSha = null;
  let files = [];
  try {
    const res = await getContent(path);
    shardSha = res.sha;
    files = Array.isArray(res.json) ? res.json : [];
  } catch (_) {
    shardSha = null;
    files = [];
  }

  if (!shardIsFull(files)) {
    return { n, path, sha: shardSha, files, rotated: false };
  }

  n += 1;
  path = shardPath(n);

  const now = new Date().toISOString();
  index.current = n;
  if (!Array.isArray(index.shards)) index.shards = [];
  if (!index.shards.find(s => s && s.n === n)) {
    index.shards.push({ n, path, createdAt: now });
  }

  let indexSha = null;
  try {
    const res = await getContent(INDEX_PATH);
    indexSha = res.sha;
  } catch (_) {}
  await putContent(INDEX_PATH, index, `Rotate shard -> ${path}`, indexSha);

  await putContent(path, [], `Create shard: ${path}`);

  return { n, path, sha: null, files: [], rotated: true };
}

function uploadBinaryToGithub(uploadUrl, buffer, fileName) {
  return new Promise((resolve, reject) => {
    try {
      const cleanUrl = uploadUrl.split('{')[0];
      const url = new URL(cleanUrl);
      url.searchParams.set('name', fileName);

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              reject(new Error(json.message || data));
            } else {
              console.log('[UPLOAD_BINARY] Success:', fileName);
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(buffer);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * ★ パスワード保護対応のファイル追加
 */
async function addFileToShardedJson(fileData) {
  const shard = await getWritableShard();

  // ★ パスワードハッシュが含まれていればそのまま保存
  const fileRecord = {
    fileId: fileData.fileId,
    fileName: fileData.fileName,
    fileSize: fileData.fileSize,
    downloadUrl: fileData.downloadUrl,
    uploadedAt: new Date().toISOString(),
    shard: shard.path,
  };

  // ★ パスワードハッシュがあれば追加
  if (fileData.passwordHash) {
    fileRecord.passwordHash = fileData.passwordHash;
    console.log('[ADD_FILE] Password hash added');
  }

  shard.files.push(fileRecord);

  await putContent(
    shard.path,
    shard.files,
    `Add file: ${fileData.fileName} -> ${shard.path}`,
    shard.sha
  );

  return { success: true, shard: shard.path, shardNumber: shard.n, rotated: shard.rotated };
}

// ===================== main handler =====================
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server not configured' }) };
    }

    const url = new URL(event.rawUrl || `http://localhost${event.rawPath || ''}`);
    const action = url.searchParams.get('action');

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-upload-url, x-is-base64, x-file-name',
        },
        body: ''
      };
    }

    if (action === 'upload-chunk') {
      const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
      const uploadId = params.get('uploadId');
      const chunkIndex = parseInt(params.get('chunkIndex'));
      const totalChunks = parseInt(params.get('totalChunks'));
      const fileName = params.get('fileName');

      if (!uploadId || Number.isNaN(chunkIndex) || !totalChunks || !fileName) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
      }

      let buffer;
      if (event.isBase64Encoded) buffer = Buffer.from(event.body || '', 'base64');
      else if (typeof event.body === 'string') buffer = Buffer.from(event.body, 'binary');
      else if (Buffer.isBuffer(event.body)) buffer = event.body;
      else buffer = Buffer.from(event.body || '');

      if (!uploadChunks.has(uploadId)) {
        uploadChunks.set(uploadId, {
          chunks: new Array(totalChunks),
          totalChunks,
          fileName,
          timestamp: Date.now()
        });
        console.log('[CHUNK] New upload session:', uploadId);
      }

      const session = uploadChunks.get(uploadId);
      session.chunks[chunkIndex] = buffer;
      session.timestamp = Date.now();

      const receivedCount = session.chunks.filter(Boolean).length;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, uploadId, receivedChunks: receivedCount, totalChunks })
      };
    }

    const uploadUrl = event.headers['x-upload-url'];
    if (uploadUrl) {
      const isBase64 = event.headers['x-is-base64'] === 'true';
      const fileName = event.headers['x-file-name'] || 'file';
      const buffer = isBase64 ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');

      const result = await uploadBinaryToGithub(uploadUrl, buffer, fileName);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: { asset_id: result.id, download_url: result.browser_download_url, name: result.name, size: result.size }
        })
      };
    }

    const body = safeJsonParse(event.body || '{}', {});

    if (body.action === 'create-release') {
      const result = await githubApi(
        'POST',
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
        {
          tag_name: body.releaseTag,
          name: body.metadata?.title || body.releaseTag,
          body: body.metadata?.description || '',
          draft: false,
          prerelease: false
        }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: { release_id: result.id, tag_name: result.tag_name, upload_url: result.upload_url }
        })
      };
    }

    if (body.action === 'add-file') {
      // ★ パスワードハッシュをそのまま渡す
      const res = await addFileToShardedJson(body.fileData);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...res }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Unknown action' }) };
  } catch (error) {
    console.error('[ERROR]', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
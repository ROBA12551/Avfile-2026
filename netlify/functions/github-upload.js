/**
 * netlify/functions/github-upload.js
 * ✅ finalize-chunks アクション対応修正版
 * ★ 機能変更なし - エラーハンドリングのみ修正
 */

const https = require('https');

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
const CHUNK_TIMEOUT = 3600000; // 1h

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

async function addFileToShardedJson(fileData) {
  const shard = await getWritableShard();

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

/**
 * ★ チャンク受信処理
 */
async function handleChunkUpload(event) {
  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const uploadId = params.get('uploadId');
    const chunkIndex = parseInt(params.get('chunkIndex'));
    const totalChunks = parseInt(params.get('totalChunks'));
    const fileName = params.get('fileName');

    if (!uploadId || Number.isNaN(chunkIndex) || !totalChunks || !fileName) {
      console.error('[CHUNK] Missing parameters');
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing parameters' }) };
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

    console.log('[CHUNK] Received chunk', chunkIndex + 1, '/', totalChunks);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, uploadId, receivedChunks: receivedCount, totalChunks })
    };
  } catch (error) {
    console.error('[CHUNK] Error:', error.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: error.message }) };
  }
}

/**
 * ★ チャンク最終化処理（修正版）
 */
async function finalizeCombinedUpload(event) {
  try {
    const body = safeJsonParse(event.body || '{}', {});
    const { uploadId, fileName, releaseUploadUrl } = body;

    console.log('[FINALIZE] Processing:', { uploadId, fileName });

    const session = uploadChunks.get(uploadId);
    if (!session) {
      console.error('[FINALIZE] Upload session not found:', uploadId);
      return { 
        statusCode: 404, 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ success: false, error: 'Upload session not found' }) 
      };
    }

    const missing = session.chunks.map((c, i) => (c ? null : i)).filter(v => v !== null);
    if (missing.length) {
      console.error('[FINALIZE] Missing chunks:', missing);
      return { 
        statusCode: 400, 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ success: false, error: 'Missing chunks', missingChunks: missing }) 
      };
    }

    const combined = Buffer.concat(session.chunks);
    console.log('[FINALIZE] Combined buffer size:', combined.length);

    let result = {
      id: uploadId,
      browser_download_url: '',
      name: fileName || 'file',
      size: combined.length
    };

    // ★ releaseUploadUrl が指定されている場合はGitHubにアップロード
    if (releaseUploadUrl) {
      console.log('[FINALIZE] Uploading to GitHub...');
      result = await uploadBinaryToGithub(releaseUploadUrl, combined, fileName);
    }

    uploadChunks.delete(uploadId);
    console.log('[FINALIZE] Success');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          asset_id: result.id,
          download_url: result.browser_download_url,
          name: result.name || fileName,
          size: result.size || combined.length
        }
      })
    };
  } catch (error) {
    console.error('[FINALIZE] Error:', error.message);
    return { 
      statusCode: 500, 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ success: false, error: error.message }) 
    };
  }
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

    console.log('[HANDLER] action:', action, 'method:', event.httpMethod);

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-upload-url, x-is-base64, x-file-name, X-Upload-Url, X-Is-Base64, X-File-Name',
        },
        body: ''
      };
    }

    // ★ チャンク受信
    if (action === 'upload-chunk') {
      return await handleChunkUpload(event);
    }

    // ★ チャンク最終化（リクエストボディから読み込む）
    if (action === 'finalize-chunks') {
      return await finalizeCombinedUpload(event);
    }

    // binary upload (小ファイル)
    const uploadUrl = event.headers['x-upload-url'] || event.headers['X-Upload-Url'];
    if (uploadUrl) {
      const isBase64Str = event.headers['x-is-base64'] || event.headers['X-Is-Base64'];
      const isBase64 = isBase64Str === 'true';
      const fileName = (event.headers['x-file-name'] || event.headers['X-File-Name'] || 'file').replace(/^"|"$/g, '');
      
      console.log('[BINARY] Uploading:', { fileName, isBase64, bodyLength: event.body?.length });
      
      let buffer;
      if (isBase64) {
        buffer = Buffer.from(event.body || '', 'base64');
      } else {
        buffer = Buffer.isBuffer(event.body) ? event.body : Buffer.from(event.body || '', 'binary');
      }

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

    // JSON action
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
      const res = await addFileToShardedJson(body.fileData);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...res }) };
    }

    console.error('[HANDLER] Unknown action:', action);
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Unknown action: ' + action }) };
  } catch (error) {
    console.error('[ERROR]', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
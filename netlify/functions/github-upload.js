/**
 * netlify/functions/github-upload.js
 * ★ グループID対応版
 * 複数ファイルを1つのグループIDで管理
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// ===================== shard settings =====================
const INDEX_PATH = 'github.index.json';
const GROUPS_PATH = 'groups.json';  // ★ グループ管理ファイル
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

// ===================== グループ管理 =====================
/**
 * ★ グループを作成（複数ファイル用）
 */
async function createGroup(groupId, fileIds, passwordHash) {
  try {
    console.log('[GROUP] Creating group:', groupId, 'with', fileIds.length, 'files');

    // 既存のグループファイルを取得
    let groupsSha = null;
    let groups = [];
    
    try {
      const { sha, json } = await getContent(GROUPS_PATH);
      groupsSha = sha;
      groups = Array.isArray(json) ? json : [];
    } catch (e) {
      console.log('[GROUP] Groups file not found, creating new');
      groups = [];
    }

    // ★ 新しいグループを追加
    const newGroup = {
      groupId: groupId,
      fileIds: fileIds,
      createdAt: new Date().toISOString(),
      passwordHash: passwordHash || null
    };

    groups.push(newGroup);
    console.log('[GROUP] New group:', newGroup);

    // ★ グループファイルを保存
    await putContent(
      GROUPS_PATH,
      groups,
      `Create group: ${groupId}`,
      groupsSha
    );

    console.log('[GROUP] Group saved successfully');
    return { success: true, groupId: groupId };
  } catch (e) {
    console.error('[GROUP] Error creating group:', e.message);
    throw e;
  }
}

/**
 * ★ グループからファイルIDを取得
 */
async function getGroupFileIds(groupId) {
  try {
    console.log('[GROUP] Fetching group:', groupId);

    const { json: groups } = await getContent(GROUPS_PATH);
    
    if (!Array.isArray(groups)) {
      console.warn('[GROUP] Groups file is not an array');
      return null;
    }

    const group = groups.find(g => g && g.groupId === groupId);
    
    if (!group) {
      console.warn('[GROUP] Group not found:', groupId);
      return null;
    }

    console.log('[GROUP] Found group with', group.fileIds.length, 'files');
    return group;
  } catch (e) {
    console.warn('[GROUP] Error fetching group:', e.message);
    return null;
  }
}

// ===================== 既存の関数 =====================
// （以下、既存のコードと同じ）

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

// ===================== メインハンドラー =====================
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

    // ★ グループ作成アクション
    if (action === 'create-group') {
      const body = safeJsonParse(event.body || '{}', {});
      const { groupId, fileIds, passwordHash } = body;

      if (!groupId || !fileIds || !Array.isArray(fileIds)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Missing parameters' })
        };
      }

      const result = await createGroup(groupId, fileIds, passwordHash);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
      };
    }

    // ★ グループ取得アクション（view.js で使用）
    if (action === 'get-group') {
      const groupId = url.searchParams.get('groupId');
      if (!groupId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Missing groupId' })
        };
      }

      const group = await getGroupFileIds(groupId);
      if (!group) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Group not found' })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, group: group })
      };
    }

    // ★ チャンク受信
    if (action === 'upload-chunk') {
      // ... 既存のチャンク処理コード ...
      return { statusCode: 501, headers, body: JSON.stringify({ error: 'Not implemented in this template' }) };
    }

    // ★ チャンク最終化
    if (action === 'finalize-chunks') {
      // ... 既存の最終化処理コード ...
      return { statusCode: 501, headers, body: JSON.stringify({ error: 'Not implemented in this template' }) };
    }

    console.error('[HANDLER] Unknown action:', action);
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Unknown action: ' + action }) };
  } catch (e) {
    console.error('[ERROR]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
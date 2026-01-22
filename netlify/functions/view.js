/**
 * netlify/functions/view.js
 * ✅ パスワード保護対応版
 */

const https = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}
function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

async function githubRequest(method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Avfile-View',
      },
    };

    logInfo(`GitHub Request: ${method} ${path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        logInfo(`GitHub Response: ${res.statusCode}`);

        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch { /* ignore */ }

        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json || {});
        else reject(new Error(`GitHub Error ${res.statusCode}: ${(json && json.message) ? json.message : data}`));
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getRepoJson(pathInRepo) {
  const res = await githubRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(pathInRepo)}`);
  if (!res || !res.content) throw new Error(`Missing content for ${pathInRepo}`);
  const text = Buffer.from(res.content, 'base64').toString('utf8');
  return safeJsonParse(text, null);
}

function guessMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function isPlayableVideo(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ['mp4', 'm4v', 'webm', 'ogg'].includes(ext);
}

exports.handler = async (event) => {
  logInfo(`=== VIEW HANDLER START ===`);
  logInfo(`Query params: ${JSON.stringify(event.queryStringParameters)}`);

  try {
    const viewId = event.queryStringParameters?.id;
    const passwordHash = event.queryStringParameters?.pwd; // ★ パスワードハッシュをクエリパラメータから取得

    if (!viewId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Missing id parameter' })
      };
    }

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Server not configured' })
      };
    }

    // 1) index 読む
    let index;
    try {
      index = await getRepoJson('github.index.json');
    } catch (e) {
      logError(`Index read failed: ${e.message}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Index not found', message: e.message })
      };
    }

    const shards = Array.isArray(index?.shards) ? index.shards : [];
    if (!shards.length) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'No shards in index' })
      };
    }

    // 2) shard を順に探す
    for (let i = shards.length - 1; i >= 0; i--) {
      const sp = shards[i]?.path;
      if (!sp) continue;

      logInfo(`Searching shard: ${sp}`);

      let arr;
      try {
        arr = await getRepoJson(sp);
      } catch (e) {
        logError(`Shard read failed (${sp}): ${e.message}`);
        continue;
      }

      const files = Array.isArray(arr) ? arr : [];
      const file = files.find(f => f && f.fileId === viewId);
      if (!file) continue;

      // ★ パスワード保護チェック
      if (file.passwordHash) {
        logInfo(`File is password protected`);

        // パスワードハッシュが提供されていない場合
        if (!passwordHash) {
          return {
            statusCode: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
              success: false, 
              error: 'Password required',
              requiresPassword: true,
              message: 'This file is password protected. Please provide the password.'
            })
          };
        }

        // パスワードハッシュが一致しない場合
        if (passwordHash !== file.passwordHash) {
          logError(`Password hash mismatch`);
          return {
            statusCode: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
              success: false, 
              error: 'Invalid password',
              requiresPassword: true,
              message: 'The password you provided is incorrect.'
            })
          };
        }

        logInfo(`Password verified successfully`);
      }

      const mime = guessMime(file.fileName);
      const playable = isPlayableVideo(file.fileName);

      logInfo(`File found in ${sp}: ${file.fileName}`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          success: true,
          files: [
            {
              fileId: file.fileId,
              fileName: file.fileName,
              fileSize: file.fileSize,
              downloadUrl: file.downloadUrl,
              shard: sp,
              mime,
              playable,
              // ★ パスワード保護情報を返す
              isPasswordProtected: !!file.passwordHash
            }
          ]
        })
      };
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'File not found', viewId })
    };

  } catch (e) {
    logError(`Unhandled error: ${e.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'Internal server error', message: e.message })
    };
  }
};
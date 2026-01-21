const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

// 非同期処理用の保留ファイル
let pendingFiles = [];
let lastGithubJsonUpdate = 0;
const GITHUB_JSON_UPDATE_INTERVAL = 30000; // 30秒ごと

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

/**
 * GitHub APIにリクエストを送信
 */
async function githubRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      timeout: 15000,
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
          } catch (e) {
            logError(`JSON parse error: ${e.message}`);
            resolve({});
          }
        } else {
          const errorMsg = `GitHub API Error ${res.statusCode}: ${data || 'Unknown'}`;
          logError(errorMsg);
          reject(new Error(errorMsg));
        }
      });
    });

    req.on('error', (err) => {
      logError(`Request error: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      logError('GitHub API Request timeout');
      req.destroy();
      reject(new Error('GitHub API Request timeout'));
    });
    
    if (body) req.write(body);
    req.end();
  });
}

/**
 * GitHub アセットアップロード用リクエスト
 * ★ 重要: ローカル側で既に圧縮済みのデータを受け取るので、
 *      サーバー側では単純に Buffer として受け取り、GitHub にアップロード
 */
async function githubUploadRequest(method, fullUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!fullUrl || typeof fullUrl !== 'string') {
        throw new Error('Invalid uploadUrl: empty or not a string');
      }

      let cleanUrl = fullUrl.trim();
      cleanUrl = cleanUrl.replace('{?name,label}', '');
      cleanUrl = cleanUrl.replace('{?name}', '');
      cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

      logInfo(`Clean Upload URL: ${cleanUrl.substring(0, 80)}...`);

      let parsed;
      try {
        parsed = new URL(cleanUrl);
      } catch (e) {
        throw new Error(`Invalid URL format: ${e.message}`);
      }

      if (!Buffer.isBuffer(body)) {
        throw new Error('Body must be a Buffer');
      }

      logInfo(`Upload body size: ${body.length} bytes`);

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        timeout: 30000,
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'Avfile-Netlify',
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
          ...headers,
        },
      };

      logInfo(`Upload Request: ${method} ${parsed.hostname}${parsed.pathname.substring(0, 50)}...`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          logInfo(`Upload Response: ${res.statusCode}`);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch (e) {
              logError(`JSON parse error: ${e.message}`);
              resolve({});
            }
          } else {
            const errorMsg = `Upload Error ${res.statusCode}: ${data || 'Unknown'}`;
            logError(errorMsg);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', (err) => {
        logError(`Upload request error: ${err.message}`);
        reject(err);
      });

      req.on('timeout', () => {
        logError('Upload request timeout');
        req.destroy();
        reject(new Error('Upload request timeout'));
      });
      
      if (body) req.write(body);
      req.end();
    } catch (e) {
      logError(`Upload Request Error: ${e.message}`);
      reject(e);
    }
  });
}

/**
 * Release を作成
 */
async function createRelease(tag, metadata) {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  const body = {
    tag_name: tag,
    name: metadata?.title || 'Uploaded File',
    body: JSON.stringify(metadata || {}, null, 2),
    draft: false,
    prerelease: false,
  };

  logInfo(`[CREATE_RELEASE] Creating release with tag: ${tag}`);

  try {
    const data = await githubRequest('POST', path, body);
    
    if (!data || !data.id) {
      throw new Error('Release creation response missing id field');
    }

    logInfo(`Release created: ${data.id}`);

    return {
      release_id: data.id,
      upload_url: data.upload_url,
      html_url: data.html_url,
      tag_name: data.tag_name,
    };
  } catch (error) {
    logError(`[CREATE_RELEASE] Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Asset (ファイル) をアップロード
 * ★ 重要: Base64 文字列 → Buffer に変換 → GitHub にアップロード
 *      ローカル側で既に圧縮済みなので、ここでは追加処理は不要
 */
async function uploadAsset(uploadUrl, fileName, fileBase64String) {
  try {
    logInfo(`Preparing asset upload: ${fileName}`);

    if (!uploadUrl || typeof uploadUrl !== 'string') {
      throw new Error('Invalid uploadUrl provided');
    }

    // ★ 重要: Base64 → Buffer に変換（ローカル側で圧縮済み）
    if (typeof fileBase64String !== 'string') {
      throw new Error('fileBase64String must be a string');
    }

    logInfo(`Converting Base64 to Buffer (length: ${fileBase64String.length})`);
    
    const fileBuffer = Buffer.from(fileBase64String, 'base64');

    if (fileBuffer.length === 0) {
      throw new Error('Decoded buffer is empty');
    }

    logInfo(`Successfully decoded: ${fileBuffer.length} bytes`);

    let baseUrl = String(uploadUrl).trim();
    baseUrl = baseUrl.replace('{?name,label}', '');
    baseUrl = baseUrl.replace('{?name}', '');
    baseUrl = baseUrl.replace(/\{[?&].*?\}/g, '');

    const encodedFileName = encodeURIComponent(fileName);
    const assetUrl = `${baseUrl}?name=${encodedFileName}`;

    logInfo(`Asset URL: ${assetUrl.substring(0, 100)}...`);
    logInfo(`File size: ${fileBuffer.length} bytes`);

    // ★ Buffer を GitHub にアップロード（追加圧縮なし）
    const data = await githubUploadRequest('POST', assetUrl, fileBuffer);

    if (!data || !data.id) {
      throw new Error('Asset upload response missing id field');
    }

    logInfo(`Asset uploaded successfully: ${data.id}`);

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

/**
 * github.json を取得
 */
async function getGithubJson() {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  try {
    logInfo(`Fetching github.json`);
    const res = await githubRequest('GET', path);
    
    if (!res.content) {
      logInfo('github.json not found, creating new one');
      return {
        data: { files: [], views: [], lastUpdated: new Date().toISOString() },
        sha: null,
      };
    }

    const decoded = Buffer.from(res.content, 'base64').toString('utf-8');
    let parsed = JSON.parse(decoded);

    parsed.files = Array.isArray(parsed.files) ? parsed.files : [];
    parsed.views = Array.isArray(parsed.views) ? parsed.views : [];

    logInfo(`github.json retrieved: ${parsed.files.length} files, ${parsed.views.length} views`);

    return { data: parsed, sha: res.sha };
  } catch (error) {
    logError(`Error fetching github.json: ${error.message}`);
    return {
      data: { files: [], views: [], lastUpdated: new Date().toISOString() },
      sha: null,
    };
  }
}

/**
 * github.json を保存
 */
async function saveGithubJson(jsonData, sha = null) {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  logInfo(`Saving: ${jsonData.files.length} files, ${jsonData.views.length} views`);

  const content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64');

  const payload = {
    message: `Update github.json ${new Date().toISOString()}`,
    content,
    branch: 'main',
  };

  if (sha) {
    payload.sha = sha;
    logInfo(`Updating existing github.json with SHA: ${sha}`);
  } else {
    logInfo(`Creating new github.json`);
  }

  try {
    await githubRequest('PUT', path, payload);
    logInfo('github.json saved successfully');
  } catch (error) {
    logError(`Failed to save github.json: ${error.message}`);
    throw error;
  }
}

/**
 * github.json を非同期で更新
 */
async function updateGithubJsonAsync(fileId, fileName, downloadUrl, fileSize) {
  try {
    pendingFiles.push({
      fileId,
      fileName,
      downloadUrl,
      fileSize,
      uploadedAt: new Date().toISOString(),
    });

    const now = Date.now();
    const timeSinceLastUpdate = now - lastGithubJsonUpdate;

    if (timeSinceLastUpdate >= GITHUB_JSON_UPDATE_INTERVAL || pendingFiles.length >= 10) {
      logInfo(`[ASYNC] Flushing ${pendingFiles.length} pending files to github.json`);
      
      const current = await getGithubJson();
      const json = current.data;
      json.files = json.files || [];
      json.files.push(...pendingFiles);
      json.lastUpdated = new Date().toISOString();
      
      await saveGithubJson(json, current.sha);
      
      lastGithubJsonUpdate = Date.now();
      pendingFiles = [];
      
      logInfo(`[ASYNC] github.json updated successfully`);
    } else {
      logInfo(`[ASYNC] File queued for batch update (${pendingFiles.length} pending)`);
    }
  } catch (error) {
    logError(`[ASYNC] github.json update failed: ${error.message}`);
  }
}

/**
 * View を作成
 */
async function createViewOnServer(fileIds, passwordHash, origin) {
  try {
    logInfo(`Creating view with ${fileIds.length} files`);

    const current = await getGithubJson();
    const json = current.data;

    let viewId = null;
    for (let i = 0; i < 12; i++) {
      const cand = generateShortId(6);
      const exists = (json.views || []).some(v => v && v.viewId === cand);
      if (!exists) { 
        viewId = cand; 
        break; 
      }
    }
    
    if (!viewId) {
      throw new Error('Failed to generate unique viewId');
    }

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

    logInfo(`View created: ${viewId}`);

    return {
      viewId,
      viewPath: `/d/${viewId}`,
      shareUrl: shareUrl,
    };
  } catch (error) {
    logError(`Failed to create view: ${error.message}`);
    throw error;
  }
}

/**
 * Netlify Function ハンドラー
 * ★ ローカル圧縮対応版
 *    - クライアント側で既に圧縮済みのファイルを受け取る
 *    - サーバー側では Base64 デコード → GitHub アップロードだけ
 */
exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}, Path: ${event.path}`);

    // 環境変数チェック
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing environment variables');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Server configuration error'
        }),
      };
    }

    // CORS プリフライト対応
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

    // JSON をパース
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      logError(`Failed to parse JSON: ${e.message}`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON'
        }),
      };
    }

    logInfo(`Action: ${body.action}`);
    
    let response;

    switch (body.action) {
      // Release 作成
      case 'create-release': {
        logInfo(`Creating release: ${body.releaseTag}`);
        
        if (!body.releaseTag) {
          throw new Error('releaseTag is required');
        }

        response = await createRelease(body.releaseTag, body.metadata);
        break;
      }

      // ★ Asset アップロード（ローカル圧縮対応）
      case 'upload-asset': {
        logInfo(`Uploading asset: ${body.fileName}`);
        
        if (!body.fileBase64 || typeof body.fileBase64 !== 'string') {
          throw new Error('Invalid fileBase64: must be a non-empty string');
        }

        if (!body.fileName || typeof body.fileName !== 'string') {
          throw new Error('Invalid fileName: must be a non-empty string');
        }

        if (!body.uploadUrl || typeof body.uploadUrl !== 'string') {
          throw new Error('Invalid uploadUrl: must be a non-empty string');
        }

        logInfo(`File: ${body.fileName}, Base64 length: ${body.fileBase64.length}`);
        logInfo(`Pre-compressed: ${body.isPreCompressed ? 'Yes' : 'No'}`);

        // ★ ここではBase64→Buffer変換 + GitHub アップロードだけ
        // 追加の圧縮処理は不要（ローカル側で既に圧縮済み）
        const assetResponse = await uploadAsset(
          body.uploadUrl,
          body.fileName,
          body.fileBase64
        );

        // github.json 更新は非同期
        updateGithubJsonAsync(
          body.fileId,
          body.fileName,
          assetResponse.download_url,
          body.fileSize
        ).catch(err => logError(`Async update error: ${err.message}`));

        response = assetResponse;
        break;
      }

      // github.json 取得
      case 'get-github-json': {
        logInfo('Getting github.json');
        const result = await getGithubJson();
        response = result.data;
        break;
      }

      // github.json 保存
      case 'save-github-json': {
        logInfo('Saving github.json');
        
        if (!body.jsonData) {
          throw new Error('jsonData is required');
        }

        const current = await getGithubJson();
        await saveGithubJson(body.jsonData, current.sha);
        response = { success: true };
        break;
      }

      // View 作成
      case 'create-view': {
        logInfo(`Creating view with ${body.fileIds ? body.fileIds.length : 0} files`);
        
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        if (fileIds.length === 0) {
          throw new Error('fileIds is required and must be non-empty array');
        }

        response = await createViewOnServer(
          fileIds,
          body.passwordHash || null,
          body.origin || ''
        );
        break;
      }

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    logInfo(`=== REQUEST SUCCESS ===`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: response }),
    };

  } catch (e) {
    logError(`=== REQUEST FAILED ===`);
    logError(`Error: ${e.message}`);
    logError(`Stack: ${e.stack}`);
    
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: e.message || 'Internal Server Error'
      }),
    };
  }
};
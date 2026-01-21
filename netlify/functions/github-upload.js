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
    
    if (body) req.write(body);
    req.end();
  });
}

/**
 * GitHub アセットアップロード用リクエスト
 */
async function githubUploadRequest(method, fullUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      // URLをバリデーション
      if (!fullUrl || typeof fullUrl !== 'string') {
        throw new Error('Invalid uploadUrl: empty or not a string');
      }

      // URI Templateを削除
      let cleanUrl = fullUrl.trim();
      cleanUrl = cleanUrl.replace('{?name,label}', '');
      cleanUrl = cleanUrl.replace('{?name}', '');
      cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

      logInfo(`Clean Upload URL: ${cleanUrl.substring(0, 80)}...`);

      // URL形式をチェック
      let parsed;
      try {
        parsed = new URL(cleanUrl);
      } catch (e) {
        throw new Error(`Invalid URL format: ${e.message}`);
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

  logInfo(`[CREATE_RELEASE] Attempting to create release with tag: ${tag}`);
  logInfo(`[CREATE_RELEASE] Repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
  logInfo(`[CREATE_RELEASE] Body: ${JSON.stringify(body)}`);

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
 */
async function uploadAsset(uploadUrl, fileName, fileData) {
  try {
    logInfo(`Preparing asset upload: ${fileName}`);

    // uploadUrl をバリデーション
    if (!uploadUrl || typeof uploadUrl !== 'string') {
      throw new Error('Invalid uploadUrl provided');
    }

    // URI Template を削除
    let baseUrl = String(uploadUrl).trim();
    baseUrl = baseUrl.replace('{?name,label}', '');
    baseUrl = baseUrl.replace('{?name}', '');
    baseUrl = baseUrl.replace(/\{[?&].*?\}/g, '');

    // ファイル名をエンコード
    const encodedFileName = encodeURIComponent(fileName);
    const assetUrl = `${baseUrl}?name=${encodedFileName}`;

    logInfo(`Asset URL: ${assetUrl.substring(0, 100)}...`);

    // fileData を Buffer に変換
    if (!Buffer.isBuffer(fileData)) {
      if (typeof fileData === 'string') {
        logInfo(`Converting base64 string to Buffer...`);
        fileData = Buffer.from(fileData, 'base64');
      } else {
        throw new Error('Invalid fileData type: must be string or Buffer');
      }
    }

    logInfo(`File size: ${fileData.length} bytes`);

    // Content-Length をヘッダーに設定
    const uploadHeaders = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileData.length.toString(),
    };

    const data = await githubUploadRequest('POST', assetUrl, fileData, uploadHeaders);

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
    logInfo(`Fetching github.json from ${path}`);
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
 * View を作成
 */
async function createViewOnServer(fileIds, passwordHash, origin) {
  try {
    logInfo(`Creating view with ${fileIds.length} files`);

    const current = await getGithubJson();
    const json = current.data;

    // ユニークな viewId を生成
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
    
    // Share URL を作成
    const shareUrl = `${(origin || '').replace(/\/$/, '')}/d/${viewId}`;

    // View をデータに追加
    json.views.push({
      viewId,
      files: fileIds,
      password: passwordHash || null,
      shareUrl: shareUrl,
      createdAt: new Date().toISOString(),
    });

    json.lastUpdated = new Date().toISOString();

    // github.json を保存
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
 */
exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}, Path: ${event.path}`);

    // ========================================
    // 環境変数チェック
    // ========================================
    if (!GITHUB_TOKEN) {
      logError('GITHUB_TOKEN is not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'GITHUB_TOKEN not configured',
          details: 'Please set GITHUB_TOKEN environment variable in Netlify'
        }),
      };
    }

    if (!GITHUB_OWNER) {
      logError('GITHUB_OWNER is not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'GITHUB_OWNER not configured',
          details: 'Please set GITHUB_OWNER environment variable in Netlify'
        }),
      };
    }

    if (!GITHUB_REPO) {
      logError('GITHUB_REPO is not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'GITHUB_REPO not configured',
          details: 'Please set GITHUB_REPO environment variable in Netlify'
        }),
      };
    }

    // ========================================
    // CORS プリフライト対応
    // ========================================
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

    // ========================================
    // リクエストボディをパース
    // ========================================
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      logError(`Failed to parse request body: ${e.message}`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON in request body'
        }),
      };
    }

    logInfo(`Action: ${body.action}`);
    
    let response;

    // ========================================
    // アクション別処理
    // ========================================
    switch (body.action) {
      // -------- Release 作成 --------
      case 'create-release': {
        logInfo(`Creating release: ${body.releaseTag}`);
        
        if (!body.releaseTag) {
          throw new Error('releaseTag is required');
        }

        response = await createRelease(body.releaseTag, body.metadata);
        break;
      }

      // -------- Asset アップロード --------
      case 'upload-asset': {
        logInfo(`Uploading asset: ${body.fileName}`);
        
        // バリデーション
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

        // Asset をアップロード
        const assetResponse = await uploadAsset(
          body.uploadUrl,
          body.fileName,
          body.fileBase64
        );

        // github.json を更新
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
      }

      // -------- github.json 取得 --------
      case 'get-github-json': {
        logInfo('Getting github.json');
        const result = await getGithubJson();
        response = result.data;
        break;
      }

      // -------- github.json 保存 --------
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

      // -------- View 作成 --------
      case 'create-view': {
        logInfo(`Creating view with ${body.fileIds ? body.fileIds.length : 0} files`);
        
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        if (fileIds.length === 0) {
          throw new Error('fileIds is required and must be non-empty array');
        }

        const passwordHash = body.passwordHash || null;
        const origin = body.origin || '';
        
        response = await createViewOnServer(fileIds, passwordHash, origin);
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

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

const MAX_RETRIES = 3;
const RETRY_DELAY = 500;
const MAX_REQUEST_SIZE = 50 * 1024 * 1024;

function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

function logWarn(msg) {
  console.warn(`[WARN] ${new Date().toISOString()} ${msg}`);
}

function generateShortId(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ★ ファイルタイプ判定
function getFileType(fileName, mimeType) {
  const ext = fileName.toLowerCase().split('.').pop();
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || 
      (mimeType && mimeType.startsWith('image/'))) {
    return 'image';
  }
  
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', '3gp'].includes(ext) || 
      (mimeType && mimeType.startsWith('video/'))) {
    return 'video';
  }
  
  return 'file';
}

async function githubRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      timeout: 30000,
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

// ★ GitHub Uploadsへのリクエスト（CORS回避）
async function githubUploadRequest(method, fullUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!fullUrl || typeof fullUrl !== 'string') {
        throw new Error('Invalid uploadUrl');
      }

      let cleanUrl = fullUrl.trim();
      cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

      logInfo(`Upload URL: ${cleanUrl.substring(0, 80)}...`);

      const parsed = new URL(cleanUrl);

      let uploadBody = body;
      let contentLength = 0;

      if (Buffer.isBuffer(body)) {
        uploadBody = body;
        contentLength = body.length;
      } else {
        throw new Error('Body must be a Buffer');
      }

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        timeout: 120000,
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'Avfile-Netlify',
          'Content-Type': 'application/octet-stream',
          'Content-Length': contentLength,
          ...headers,
        },
      };

      logInfo(`Upload: ${method} ${parsed.hostname}${parsed.pathname.substring(0, 50)}...`);
      logInfo(`Size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);

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
        logError(`Upload error: ${err.message}`);
        reject(err);
      });

      req.on('timeout', () => {
        logError('Upload timeout (120s)');
        req.destroy();
        reject(new Error('Upload timeout'));
      });
      
      if (uploadBody) req.write(uploadBody);
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

  logInfo(`Creating release: ${tag}`);

  try {
    const data = await githubRequest('POST', path, body);
    
    if (!data || !data.id) {
      throw new Error('Release creation failed');
    }

    logInfo(`Release created: ${data.id}`);

    return {
      release_id: data.id,
      upload_url: data.upload_url,
      html_url: data.html_url,
      tag_name: data.tag_name,
    };
  } catch (error) {
    logError(`Create release failed: ${error.message}`);
    throw error;
  }
}

async function getGithubJson() {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  try {
    logInfo(`Fetching github.json`);
    const res = await githubRequest('GET', path);
    
    if (!res.content) {
      logInfo('github.json not found, creating new');
      return {
        data: { files: [], views: [], lastUpdated: new Date().toISOString() },
        sha: null,
      };
    }

    const decoded = Buffer.from(res.content, 'base64').toString('utf-8');
    let parsed = JSON.parse(decoded);

    parsed.files = Array.isArray(parsed.files) ? parsed.files : [];
    parsed.views = Array.isArray(parsed.views) ? parsed.views : [];

    logInfo(`github.json: ${parsed.files.length} files, ${parsed.views.length} views`);

    return { data: parsed, sha: res.sha };
  } catch (error) {
    logError(`Error fetching github.json: ${error.message}`);
    return {
      data: { files: [], views: [], lastUpdated: new Date().toISOString() },
      sha: null,
    };
  }
}

async function saveGithubJson(jsonData, sha = null, retryCount = 0) {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`;

  logInfo(`Saving github.json (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  const content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64');

  const payload = {
    message: `Update github.json ${new Date().toISOString()}`,
    content,
    branch: 'main',
  };

  if (sha) {
    payload.sha = sha;
  }

  try {
    await githubRequest('PUT', path, payload);
    logInfo('github.json saved');
  } catch (error) {
    if (error.message.includes('409') && retryCount < MAX_RETRIES) {
      logWarn(`SHA conflict, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      
      await sleep(RETRY_DELAY * (retryCount + 1));
      
      const latest = await getGithubJson();
      return await saveGithubJson(jsonData, latest.sha, retryCount + 1);
    }

    logError(`Failed to save github.json: ${error.message}`);
    throw error;
  }
}

// ★ ファイル情報を github.json に追加
async function addFileToGithubJson(fileData) {
  logInfo(`Adding file: ${fileData.fileId}`);
  
  try {
    const current = await getGithubJson();
    const json = current.data;

    const exists = json.files.some(f => f.fileId === fileData.fileId);
    if (exists) {
      logWarn(`File already exists: ${fileData.fileId}`);
      return { success: true, message: 'File already exists' };
    }

    const fileType = getFileType(fileData.fileName, fileData.mimeType);
    
    json.files.push({
      fileId: fileData.fileId,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      fileType: fileType,
      mimeType: fileData.mimeType || 'application/octet-stream',
      releaseId: fileData.releaseId,
      releaseTag: fileData.releaseTag,
      downloadUrl: fileData.downloadUrl,
      uploadedAt: new Date().toISOString(),
      metadata: fileData.metadata || {}
    });

    json.lastUpdated = new Date().toISOString();

    await saveGithubJson(json, current.sha, 0);

    logInfo(`File added: ${fileData.fileId} (type: ${fileType})`);

    return { 
      success: true, 
      fileId: fileData.fileId,
      fileType: fileType
    };
  } catch (error) {
    logError(`Add file failed: ${error.message}`);
    throw error;
  }
}

async function createViewOnServer(fileIds, passwordHash, origin) {
  try {
    logInfo(`Creating view: ${fileIds.length} files`);

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

    await saveGithubJson(json, current.sha, 0);

    logInfo(`View created: ${viewId}`);

    return {
      viewId,
      viewPath: `/d/${viewId}`,
      shareUrl: shareUrl,
    };
  } catch (error) {
    logError(`Create view failed: ${error.message}`);
    throw error;
  }
}exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}`);

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

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Content-Length',
        },
        body: '',
      };
    }

    let body;
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    
if (contentType.includes('application/octet-stream')) {
  logInfo('[BINARY] Processing binary upload');
  
  const action = event.queryStringParameters?.action;
  const uploadUrl = event.queryStringParameters?.url;
  const fileName = event.queryStringParameters?.name;
  
  logInfo(`[BINARY] Action: ${action}`);
  logInfo(`[BINARY] FileName: ${fileName}`);
  logInfo(`[BINARY] UploadUrl: ${uploadUrl ? 'present' : 'missing'}`);
  
  if (!action || !uploadUrl || !fileName) {
    logError('[BINARY] Missing required parameters');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Missing parameters: action, url, name'
      }),
    };
  }
  
  // ★ バイナリデータを Buffer に変換
  let binaryData;
  try {
    if (event.isBase64Encoded) {
      binaryData = Buffer.from(event.body, 'base64');
      logInfo(`[BINARY] Decoded from base64: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
    } else {
      binaryData = Buffer.from(event.body, 'binary');
      logInfo(`[BINARY] Binary data: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (e) {
    logError(`[BINARY] Failed to convert to Buffer: ${e.message}`);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Failed to process binary data'
      }),
    };
  }
  
  if (!binaryData || binaryData.length === 0) {
    logError('[BINARY] Empty binary data');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Empty binary data'
      }),
    };
  }

  // ★ サイズチェック (50MB)
  const maxSize = 50 * 1024 * 1024;
  if (binaryData.length > maxSize) {
    logError(`[BINARY] File too large: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: `File too large: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB (max: 50 MB)`
      }),
    };
  }
  
  body = {
    action: action,
    uploadUrl: uploadUrl,
    fileName: fileName,
    fileSize: binaryData.length,
    _binaryData: binaryData
  };
}else {
      // JSON
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        logError(`Invalid JSON: ${e.message}`);
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            success: false, 
            error: 'Invalid JSON'
          }),
        };
      }
    }

    logInfo(`Action: ${body.action}`);
    
    let response;

    switch (body.action) {
      case 'create-release': {
        if (!body.releaseTag) {
          throw new Error('releaseTag required');
        }
        response = await createRelease(body.releaseTag, body.metadata);
        break;
      }

// ★ バイナリアップロード
case 'upload-asset-binary': {
  logInfo(`[UPLOAD] Starting binary upload`);
  
  const { fileName, uploadUrl, _binaryData } = body;

  if (!fileName || !uploadUrl || !_binaryData) {
    throw new Error('Missing required fields for upload');
  }

  logInfo(`[UPLOAD] File: ${fileName}`);
  logInfo(`[UPLOAD] Size: ${(_binaryData.length / 1024 / 1024).toFixed(2)} MB`);
  
  // URL クリーンアップ
  let cleanUrl = String(uploadUrl).trim();
  cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');
  
  const encodedFileName = encodeURIComponent(fileName);
  const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

  logInfo(`[UPLOAD] Target: ${assetUrl.substring(0, 100)}...`);
  logInfo(`[UPLOAD] Uploading to GitHub...`);

  // ★ Buffer をそのまま GitHub API に送信
  const assetResponse = await githubUploadRequest('POST', assetUrl, _binaryData);

  if (!assetResponse || !assetResponse.id) {
    throw new Error('GitHub upload response missing ID');
  }

  logInfo(`[UPLOAD] Success: Asset ID ${assetResponse.id}`);

  response = {
    asset_id: assetResponse.id,
    name: assetResponse.name,
    size: assetResponse.size,
    download_url: assetResponse.browser_download_url,
  };
  break;
}
      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    logInfo(`=== SUCCESS ===`);
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, data: response }),
    };

  } catch (e) {
    logError(`=== FAILED ===`);
    logError(`Error: ${e.message}`);
    logError(`Stack: ${e.stack}`);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false, 
        error: e.message || 'Internal Server Error'
      }),
    };
  }
};
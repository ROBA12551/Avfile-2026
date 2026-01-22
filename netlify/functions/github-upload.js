const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

const MAX_RETRIES = 3;
const RETRY_DELAY = 500;

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
        timeout: 180000,
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
        logError('Upload timeout (180s)');
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

// ★ createRelease 関数
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
}

exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}`);
    logInfo(`Content-Type: ${event.headers['content-type'] || 'none'}`);

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing environment variables');
      return {
        statusCode: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
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
  // ★ バイナリデータの処理
if (contentType.includes('application/octet-stream')) {
  logInfo('[BINARY] Processing binary upload');
  
  const action = event.queryStringParameters?.action;
  const uploadUrl = event.queryStringParameters?.url;
  const fileName = event.queryStringParameters?.name;
  
  logInfo(`[BINARY] Action: ${action}`);
  logInfo(`[BINARY] FileName: ${fileName}`);
  logInfo(`[BINARY] Body length: ${event.body ? event.body.length : 0}`);
  logInfo(`[BINARY] isBase64Encoded: ${event.isBase64Encoded}`);
  
  if (!action || !uploadUrl || !fileName) {
    logError('[BINARY] Missing required parameters');
    return {
      statusCode: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false, 
        error: 'Missing parameters: action, url, name'
      }),
    };
  }
  
  // ★ バイナリデータを Buffer に変換
  let binaryData;
  try {
    if (!event.body) {
      throw new Error('Request body is empty');
    }

    if (event.isBase64Encoded) {
      logInfo('[BINARY] Decoding base64...');
      binaryData = Buffer.from(event.body, 'base64');
      logInfo(`[BINARY] Decoded from base64: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
    } else {
      logInfo('[BINARY] Processing as binary...');
      // ★ Netlifyは自動的にバイナリをbase64エンコードする場合がある
      // まずbase64としてデコードを試みる
      try {
        binaryData = Buffer.from(event.body, 'base64');
        logInfo(`[BINARY] Decoded as base64: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (decodeError) {
        // base64デコードに失敗したら、そのままバイナリとして処理
        binaryData = Buffer.from(event.body, 'binary');
        logInfo(`[BINARY] Processed as binary: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
      }
    }
  } catch (e) {
    logError(`[BINARY] Failed to convert to Buffer: ${e.message}`);
    logError(`[BINARY] Stack: ${e.stack}`);
    return {
      statusCode: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false, 
        error: `Failed to process binary data: ${e.message}`
      }),
    };
  }
  
  if (!binaryData || binaryData.length === 0) {
    logError('[BINARY] Empty binary data');
    return {
      statusCode: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false, 
        error: 'Empty binary data'
      }),
    };
  }

  logInfo(`[BINARY] Buffer size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);

  // ★ GitHub に直接アップロード
  try {
    let cleanUrl = uploadUrl.trim().replace(/\{[?&].*?\}/g, '');
    const encodedFileName = encodeURIComponent(fileName);
    const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

    logInfo(`[BINARY] Uploading to GitHub...`);
    logInfo(`[BINARY] URL: ${assetUrl.substring(0, 100)}...`);
    logInfo(`[BINARY] Size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);

    const assetResponse = await githubUploadRequest('POST', assetUrl, binaryData);

    if (!assetResponse || !assetResponse.id) {
      logError('[BINARY] GitHub response missing ID');
      logError('[BINARY] Response:', JSON.stringify(assetResponse).substring(0, 500));
      throw new Error('GitHub upload response missing ID');
    }

    logInfo(`[BINARY] Upload success: Asset ID ${assetResponse.id}`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true, 
        data: {
          asset_id: assetResponse.id,
          name: assetResponse.name,
          size: assetResponse.size,
          download_url: assetResponse.browser_download_url,
        }
      }),
    };
  } catch (uploadError) {
    logError(`[BINARY] Upload failed: ${uploadError.message}`);
    logError(`[BINARY] Stack: ${uploadError.stack}`);
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false, 
        error: `Upload failed: ${uploadError.message}`
      }),
    };
  }
}

    // JSON処理
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      logError(`Invalid JSON: ${e.message}`);
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON'
        }),
      };
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

  case 'add-file': {
    if (!body.fileData) {
      throw new Error('fileData required');
    }
    
    const required = ['fileId', 'fileName', 'fileSize', 'releaseId', 'releaseTag', 'downloadUrl'];
    for (const field of required) {
      if (!body.fileData[field]) {
        throw new Error(`fileData.${field} required`);
      }
    }
    
    response = await addFileToGithubJson(body.fileData);
    break;
  }

  case 'get-github-json': {
    const result = await getGithubJson();
    response = result.data;
    break;
  }

  case 'create-view': {
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    if (fileIds.length === 0) {
      throw new Error('fileIds required');
    }
    response = await createViewOnServer(
      fileIds,
      body.passwordHash || null,
      body.origin || ''
    );
    break;
  }

  case 'get-token': {
    logInfo('[TOKEN] Providing GitHub token');
    
    if (!GITHUB_TOKEN) {
      throw new Error('GitHub token not configured');
    }
    
    response = {
      token: GITHUB_TOKEN
    };
    break;
  }

  default:
    throw new Error(`Unknown action: ${body.action}`);
}
  
  // ★ セキュリティ注意: 本番環境では適切な認証を実装すること
  response = {
    token: GITHUB_TOKEN
  };
  break;
}
      case 'create-view': {
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        if (fileIds.length === 0) {
          throw new Error('fileIds required');
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
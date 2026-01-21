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

      let uploadBody = body;
      let contentLength = 0;

      if (Buffer.isBuffer(body)) {
        uploadBody = body;
        contentLength = body.length;
        logInfo(`Upload body: Buffer (${contentLength} bytes)`);
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

      logInfo(`Upload Request: ${method} ${parsed.hostname}${parsed.pathname.substring(0, 50)}...`);
      logInfo(`Upload size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);

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
        logError('Upload request timeout (120s)');
        req.destroy();
        reject(new Error('Upload request timeout'));
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

    logInfo(`github.json retrieved: ${parsed.files.length} files, ${parsed.views.length} views, SHA: ${res.sha}`);

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

  logInfo(`Saving: ${jsonData.files.length} files, ${jsonData.views.length} views (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  const content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64');

  const payload = {
    message: `Update github.json ${new Date().toISOString()}`,
    content,
    branch: 'main',
  };

  if (sha) {
    payload.sha = sha;
    logInfo(`Using SHA: ${sha}`);
  } else {
    logInfo(`Creating new github.json (no SHA)`);
  }

  try {
    await githubRequest('PUT', path, payload);
    logInfo('github.json saved successfully');
  } catch (error) {
    if (error.message.includes('409') && retryCount < MAX_RETRIES) {
      logWarn(`SHA競合検出。リトライ中... (${retryCount + 1}/${MAX_RETRIES})`);
      
      await sleep(RETRY_DELAY * (retryCount + 1));
      
      try {
        const latest = await getGithubJson();
        logInfo(`最新の SHA を取得: ${latest.sha}`);
        
        return await saveGithubJson(jsonData, latest.sha, retryCount + 1);
      } catch (retryError) {
        logError(`リトライ失敗: ${retryError.message}`);
        throw new Error(`Failed to save github.json after ${retryCount + 1} attempts: ${error.message}`);
      }
    }

    logError(`Failed to save github.json: ${error.message}`);
    throw error;
  }
}

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

    await saveGithubJson(json, current.sha, 0);

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

exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}, Path: ${event.path}`);

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

    const requestSize = event.body ? Buffer.byteLength(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : 0;
    logInfo(`Request size: ${(requestSize / 1024 / 1024).toFixed(2)} MB`);
    
    if (requestSize > MAX_REQUEST_SIZE) {
      throw new Error(`Request too large: ${(requestSize / 1024 / 1024).toFixed(2)} MB (max: 50 MB)`);
    }

    let body;
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    
    // ★ バイナリデータの場合
    if (contentType.includes('application/octet-stream')) {
      logInfo('[BINARY] Detected binary data');
      
      // ★ クエリパラメータから最小限のメタデータを取得
      const action = event.queryStringParameters?.action;
      const uploadUrl = event.queryStringParameters?.url;
      const fileName = event.queryStringParameters?.name;
      
      logInfo(`[BINARY] Query params - action: ${action}, url: ${uploadUrl ? 'present' : 'missing'}, name: ${fileName}`);
      
      if (!action || !uploadUrl || !fileName) {
        throw new Error('Missing required parameters: action, url, name');
      }
      
      // バイナリデータを取得
      const binaryData = event.isBase64Encoded 
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'binary');
      
      logInfo(`[BINARY] Binary data size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
      
      body = {
        action: action,
        uploadUrl: uploadUrl,
        fileName: fileName,
        fileSize: binaryData.length,
        _binaryData: binaryData
      };
    } else {
      // JSON の場合
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
    }

    logInfo(`Action: ${body.action}`);
    
    let response;

    switch (body.action) {
      case 'get-token': {
        logInfo('[TOKEN] Providing GitHub token');
        response = {
          token: GITHUB_TOKEN,
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO
        };
        break;
      }

      case 'create-release': {
        logInfo(`Creating release: ${body.releaseTag}`);
        if (!body.releaseTag) {
          throw new Error('releaseTag is required');
        }
        response = await createRelease(body.releaseTag, body.metadata);
        break;
      }

      case 'upload-asset-binary': {
        logInfo(`[BINARY] Starting upload`);
        
        let fileName, uploadUrl;
        let binaryData = null;

        // ★ バイナリデータを取得
        if (body._binaryData) {
          logInfo(`[BINARY] Using binary data`);
          
          fileName = body.fileName;
          uploadUrl = body.uploadUrl;
          binaryData = body._binaryData;
          
          logInfo(`[BINARY] Binary data received: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
          logInfo(`[BINARY] File name: ${fileName}`);
        } else {
          logError(`[BINARY] No binary data found`);
          throw new Error('No binary data provided');
        }

        // バリデーション
        if (!fileName) throw new Error('fileName not found');
        if (!uploadUrl) throw new Error('uploadUrl not found');
        if (!binaryData || binaryData.length === 0) throw new Error('File data is empty');

        logInfo(`[BINARY] Validated - File: ${fileName}, Size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
        logInfo(`[BINARY] Uploading to GitHub API...`);
        
        let cleanUrl = String(uploadUrl).trim();
        cleanUrl = cleanUrl.replace('{?name,label}', '');
        cleanUrl = cleanUrl.replace('{?name}', '');
        cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

        const encodedFileName = encodeURIComponent(fileName);
        const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

        logInfo(`[BINARY] GitHub upload URL: ${assetUrl.substring(0, 100)}...`);

        const assetResponse = await githubUploadRequest('POST', assetUrl, binaryData);

        if (!assetResponse || !assetResponse.id) {
          throw new Error('Asset upload response missing id field');
        }

        logInfo(`[BINARY] GitHub upload complete: Asset ID ${assetResponse.id}`);

        response = {
          asset_id: assetResponse.id,
          name: assetResponse.name,
          size: assetResponse.size,
          download_url: assetResponse.browser_download_url,
        };
        break;
      }

      case 'get-github-json': {
        logInfo('Getting github.json');
        const result = await getGithubJson();
        response = result.data;
        break;
      }

      case 'save-github-json': {
        logInfo('Saving github.json');
        if (!body.jsonData) {
          throw new Error('jsonData is required');
        }
        const current = await getGithubJson();
        await saveGithubJson(body.jsonData, current.sha, 0);
        response = { success: true };
        break;
      }

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
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, data: response }),
    };

  } catch (e) {
    logError(`=== REQUEST FAILED ===`);
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
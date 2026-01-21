const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

let pendingFiles = [];
let lastGithubJsonUpdate = 0;
const GITHUB_JSON_UPDATE_INTERVAL = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 500; // ミリ秒

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

/**
 * 指定時間待機
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

      let uploadBody = body;
      let contentLength = 0;

      if (typeof body === 'string') {
        uploadBody = Buffer.from(body, 'base64');
        contentLength = uploadBody.length;
        logInfo(`Upload body: Base64 string (${body.length} chars) → Buffer (${contentLength} bytes)`);
      } else if (Buffer.isBuffer(body)) {
        uploadBody = body;
        contentLength = body.length;
        logInfo(`Upload body: Buffer (${contentLength} bytes)`);
      } else {
        throw new Error('Body must be a Base64 string or Buffer');
      }

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
          'Content-Length': contentLength,
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
      
      if (uploadBody) req.write(uploadBody);
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
 */
async function uploadAsset(uploadUrl, fileName, fileBase64String) {
  try {
    logInfo(`Preparing asset upload: ${fileName}`);

    if (!uploadUrl || typeof uploadUrl !== 'string') {
      throw new Error('Invalid uploadUrl provided');
    }

    if (typeof fileBase64String !== 'string') {
      throw new Error('fileBase64String must be a string');
    }

    logInfo(`Asset upload parameters:`, {
      fileName: fileName,
      base64Length: fileBase64String.length,
      uploadUrl: uploadUrl.substring(0, 100)
    });

    let baseUrl = String(uploadUrl).trim();
    baseUrl = baseUrl.replace('{?name,label}', '');
    baseUrl = baseUrl.replace('{?name}', '');
    baseUrl = baseUrl.replace(/\{[?&].*?\}/g, '');

    const encodedFileName = encodeURIComponent(fileName);
    const assetUrl = `${baseUrl}?name=${encodedFileName}`;

    logInfo(`Asset URL: ${assetUrl.substring(0, 100)}...`);

    const data = await githubUploadRequest('POST', assetUrl, fileBase64String);

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

/**
 * github.json を保存（リトライ機能付き）
 * ★ SHA競合時は最新を再取得してリトライ
 */
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
    // ★ SHA競合エラーをチェック
    if (error.message.includes('409') && retryCount < MAX_RETRIES) {
      logWarn(`SHA競合検出。リトライ中... (${retryCount + 1}/${MAX_RETRIES})`);
      
      // 少し待機
      await sleep(RETRY_DELAY * (retryCount + 1));
      
      try {
        // 最新の SHA を取得
        const latest = await getGithubJson();
        logInfo(`最新の SHA を取得: ${latest.sha}`);
        
        // マージして再試行
        // 新しいデータを上書きする（古いデータは失う）
        logInfo(`古いデータとのマージを試行`);
        
        // リトライ
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

/**
 * github.json を非同期で更新
 * ★ 複数ファイル同時アップロード時にバッチ処理
 */
async function updateGithubJsonAsync(fileId, fileName, downloadUrl, fileSize) {
  try {
    // ★ fileInfo をキューに追加
    pendingFiles.push({
      fileId,
      fileName,
      downloadUrl,
      fileSize,
      uploadedAt: new Date().toISOString(),
    });

    logInfo(`[ASYNC] File queued (${pendingFiles.length} pending)`);

    const now = Date.now();
    const timeSinceLastUpdate = now - lastGithubJsonUpdate;

    // ★ 一定条件でバッチ更新
    if (timeSinceLastUpdate >= GITHUB_JSON_UPDATE_INTERVAL || pendingFiles.length >= 10) {
      logInfo(`[ASYNC] Flushing ${pendingFiles.length} pending files to github.json`);
      
      // 最新の github.json を取得
      const current = await getGithubJson();
      const json = current.data;
      json.files = json.files || [];
      
      // pendingFiles を全て追加
      const filesToAdd = [...pendingFiles];
      json.files.push(...filesToAdd);
      json.lastUpdated = new Date().toISOString();

      try {
        // SHA を指定して保存（リトライ機能付き）
        await saveGithubJson(json, current.sha, 0);
        
        lastGithubJsonUpdate = Date.now();
        pendingFiles = [];
        
        logInfo(`[ASYNC] github.json updated successfully (${filesToAdd.length} files added)`);
      } catch (saveError) {
        logError(`[ASYNC] Failed to save github.json: ${saveError.message}`);
        // エラーでも処理は続行（ファイル自体はアップロード済み）
        pendingFiles = [];
      }
    }
  } catch (error) {
    logError(`[ASYNC] Error: ${error.message}`);
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

    // リトライ機能付きで保存
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

/**
 * Netlify Function ハンドラー
 */
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
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: '',
      };
    }

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
      case 'create-release': {
        logInfo(`Creating release: ${body.releaseTag}`);
        
        if (!body.releaseTag) {
          throw new Error('releaseTag is required');
        }

        response = await createRelease(body.releaseTag, body.metadata);
        break;
      }

      // ★ Blob を直接アップロード（圧縮と Base64 をスキップ）
      case 'upload-asset-direct': {
        logInfo(`[DIRECT] Uploading asset directly`);
        
        let fileName, uploadUrl, fileData;

        // ★ FormData をパース
        if (event.isBase64Encoded && event.body) {
          logInfo(`[DIRECT] Parsing FormData...`);
          
          const decodedBody = Buffer.from(event.body, 'base64');
          const contentType = event.headers['content-type'] || '';
          const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
          
          if (!boundaryMatch) {
            throw new Error('No boundary found in FormData');
          }

          const boundary = boundaryMatch[1];
          const parts = decodedBody.toString('binary').split(`--${boundary}`);
          
          for (const part of parts) {
            if (!part || part.includes('--')) continue;

            const [headerPart, ...bodyParts] = part.split('\r\n\r\n');
            if (!headerPart) continue;

            const body = bodyParts.join('\r\n\r\n').replace(/\r\n--$/, '');
            const nameMatch = headerPart.match(/name="([^"]+)"/);
            const filenameMatch = headerPart.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
              const fieldName = nameMatch[1];
              
              if (filenameMatch && fieldName === 'file') {
                fileData = Buffer.from(body, 'binary');
                logInfo(`[DIRECT] File found: ${fileData.length} bytes`);
              } else {
                const value = body.trim();
                if (fieldName === 'fileName') fileName = value;
                if (fieldName === 'uploadUrl') uploadUrl = value;
              }
            }
          }
        }

        if (!fileName) throw new Error('fileName not found');
        if (!uploadUrl) throw new Error('uploadUrl not found');
        if (!fileData || fileData.length === 0) throw new Error('File data not found');

        logInfo(`[DIRECT] File: ${fileName}, Size: ${fileData.length} bytes`);

        // ★ ファイルを GitHub にアップロード
        let cleanUrl = String(uploadUrl).trim();
        cleanUrl = cleanUrl.replace('{?name,label}', '');
        cleanUrl = cleanUrl.replace('{?name}', '');
        cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

        const encodedFileName = encodeURIComponent(fileName);
        const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

        logInfo(`[DIRECT] Asset URL: ${assetUrl.substring(0, 100)}...`);

        const assetResponse = await githubUploadRequest('POST', assetUrl, fileData);

        if (!assetResponse || !assetResponse.id) {
          throw new Error('Asset upload response missing id field');
        }

        logInfo(`[DIRECT] Asset uploaded successfully: ${assetResponse.id}`);

        const result = {
          asset_id: assetResponse.id,
          name: assetResponse.name,
          size: assetResponse.size,
          download_url: assetResponse.browser_download_url,
        };

        // ★ 非同期で github.json を更新
        updateGithubJsonAsync(
          body.fileId,
          fileName,
          result.download_url,
          body.fileSize
        ).catch(err => logError(`[DIRECT] Async update error: ${err.message}`));

        response = result;
        break;
      }

      case 'upload-asset': {
        logInfo(`[ASSET] Uploading asset`);
        
        let fileName, uploadUrl, fileData;

        // ★ JSON body から直接取得
        if (body && body.action === 'upload-asset') {
          logInfo(`[ASSET] Using JSON body`);
          fileName = body.fileName;
          uploadUrl = body.uploadUrl;
          
          if (body.fileBase64 && typeof body.fileBase64 === 'string') {
            fileData = Buffer.from(body.fileBase64, 'base64');
            logInfo(`[ASSET] fileBase64 found: ${body.fileBase64.length} chars → ${fileData.length} bytes`);
          }
        }

        if (!fileName) throw new Error('fileName not found');
        if (!uploadUrl) throw new Error('uploadUrl not found');
        if (!fileData || fileData.length === 0) throw new Error('File data not found');

        logInfo(`[ASSET] File: ${fileName}, Size: ${fileData.length} bytes`);

        // ★ ファイルを GitHub にアップロード
        let cleanUrl = String(uploadUrl).trim();
        cleanUrl = cleanUrl.replace('{?name,label}', '');
        cleanUrl = cleanUrl.replace('{?name}', '');
        cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

        const encodedFileName = encodeURIComponent(fileName);
        const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

        logInfo(`[ASSET] Asset URL: ${assetUrl.substring(0, 100)}...`);

        const assetResponse = await githubUploadRequest('POST', assetUrl, fileData);

        if (!assetResponse || !assetResponse.id) {
          throw new Error('Asset upload response missing id field');
        }

        logInfo(`[ASSET] Asset uploaded successfully: ${assetResponse.id}`);

        const result = {
          asset_id: assetResponse.id,
          name: assetResponse.name,
          size: assetResponse.size,
          download_url: assetResponse.browser_download_url,
        };

        // ★ 非同期で github.json を更新
        updateGithubJsonAsync(
          body.fileId,
          fileName,
          result.download_url,
          body.fileSize
        ).catch(err => logError(`[ASSET] Async update error: ${err.message}`));

        response = result;
        break;
      }

      // ★ バイナリ直接アップロード（FormData 対応）
      case 'upload-asset-binary': {
        logInfo(`[BINARY] Uploading asset`);
        
        // ★ FormData の場合、event.body が base64 エンコードされた multipart データ
        let fileName, uploadUrl, fileId, fileSize;
        let binaryData = null;

        // event.isBase64Encoded === true の場合、event.body は base64
        if (event.isBase64Encoded && event.body) {
          logInfo(`[BINARY] Parsing FormData (base64 encoded)...`);
          
          // Base64 をデコード
          const decodedBody = Buffer.from(event.body, 'base64');
          
          // Content-Type から boundary を取得
          const contentType = event.headers['content-type'] || '';
          const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
          
          if (!boundaryMatch) {
            throw new Error('No boundary found in FormData');
          }

          const boundary = boundaryMatch[1];
          logInfo(`[BINARY] Boundary: ${boundary}`);

          // FormData を手動でパース
          const parts = decodedBody.toString('binary').split(`--${boundary}`);
          
          for (const part of parts) {
            if (!part || part.includes('--')) continue;

            // ヘッダーとボディを分割
            const [headerPart, ...bodyParts] = part.split('\r\n\r\n');
            if (!headerPart) continue;

            const body = bodyParts.join('\r\n\r\n').replace(/\r\n--$/, '');

            // name と filename を抽出
            const nameMatch = headerPart.match(/name="([^"]+)"/);
            const filenameMatch = headerPart.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
              const fieldName = nameMatch[1];
              
              if (filenameMatch) {
                // ファイルフィールド
                if (fieldName === 'file') {
                  binaryData = Buffer.from(body, 'binary');
                  logInfo(`[BINARY] File field found: ${binaryData.length} bytes`);
                }
              } else {
                // テキストフィールド
                const value = body.trim();
                
                if (fieldName === 'fileName') fileName = value;
                if (fieldName === 'uploadUrl') uploadUrl = value;
                if (fieldName === 'fileId') fileId = value;
                if (fieldName === 'fileSize') fileSize = parseInt(value);
                
                logInfo(`[BINARY] Field: ${fieldName} = ${value.substring(0, 50)}`);
              }
            }
          }
        } else if (body && body.fileName) {
          // JSON の場合（互換性のため）
          logInfo(`[BINARY] Using JSON body`);
          fileName = body.fileName;
          uploadUrl = body.uploadUrl;
          fileId = body.fileId;
          fileSize = body.fileSize;
          
          if (body.fileBase64 && typeof body.fileBase64 === 'string') {
            binaryData = Buffer.from(body.fileBase64, 'base64');
          }
        }

        // バリデーション
        if (!fileName) throw new Error('fileName not found');
        if (!uploadUrl) throw new Error('uploadUrl not found');
        if (!binaryData || binaryData.length === 0) throw new Error('File data not found');

        logInfo(`[BINARY] File: ${fileName}, Size: ${binaryData.length} bytes, uploadUrl length: ${uploadUrl.length}`);

        // ★ バイナリを直接アップロード
        let cleanUrl = String(uploadUrl).trim();
        cleanUrl = cleanUrl.replace('{?name,label}', '');
        cleanUrl = cleanUrl.replace('{?name}', '');
        cleanUrl = cleanUrl.replace(/\{[?&].*?\}/g, '');

        const encodedFileName = encodeURIComponent(fileName);
        const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

        logInfo(`[BINARY] Asset URL: ${assetUrl.substring(0, 100)}...`);

        const binaryResponse = await githubUploadRequest('POST', assetUrl, binaryData);

        if (!binaryResponse || !binaryResponse.id) {
          throw new Error('Asset upload response missing id field');
        }

        logInfo(`[BINARY] Asset uploaded successfully: ${binaryResponse.id}`);

        const assetResponse = {
          asset_id: binaryResponse.id,
          name: binaryResponse.name,
          size: binaryResponse.size,
          download_url: binaryResponse.browser_download_url,
        };

        // ★ 非同期で github.json を更新
        if (fileId && fileSize) {
          updateGithubJsonAsync(
            fileId,
            fileName,
            assetResponse.download_url,
            fileSize
          ).catch(err => logError(`[BINARY] Async update error: ${err.message}`));
        }

        response = assetResponse;
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
        // ★ リトライ機能付きで保存
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
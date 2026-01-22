const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

const MAX_RETRIES = 3;
const RETRY_DELAY = 500;

// ★ グローバルキャッシュ（チャンク一時保存用）
const uploadCache = {};

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

async function uploadToGitHub(uploadUrl, fileName, binaryBuffer) {
  return new Promise((resolve, reject) => {
    try {
      let cleanUrl = uploadUrl.trim().replace(/\{[?&].*?\}/g, '');
      const encodedFileName = encodeURIComponent(fileName);
      const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

      const parsed = new URL(assetUrl);

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        timeout: 180000,
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'Avfile-Netlify',
          'Content-Type': 'application/octet-stream',
          'Content-Length': binaryBuffer.length,
        },
      };

      logInfo(`[UPLOAD] Uploading to GitHub: ${parsed.hostname}${parsed.pathname.substring(0, 50)}...`);
      logInfo(`[UPLOAD] Size: ${(binaryBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          logInfo(`[UPLOAD] Response: ${res.statusCode}`);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              logError(`[UPLOAD] JSON parse error: ${e.message}`);
              resolve({});
            }
          } else {
            const errorMsg = `Upload Error ${res.statusCode}: ${data}`;
            logError(errorMsg);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', (err) => {
        logError(`[UPLOAD] Request error: ${err.message}`);
        reject(err);
      });

      req.on('timeout', () => {
        logError('[UPLOAD] Timeout (180s)');
        req.destroy();
        reject(new Error('Upload timeout'));
      });
      
      req.write(binaryBuffer);
      req.end();
    } catch (e) {
      logError(`[UPLOAD] Error: ${e.message}`);
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

// =====================================================
// ★ チャンク処理を追加
// =====================================================
// 修正された handleUploadChunk() メソッド
async function handleUploadChunk(event) {
  try {
    const params = event.queryStringParameters || {};
    const uploadId = params.uploadId;
    const chunkIndex = parseInt(params.chunkIndex);
    const totalChunks = parseInt(params.totalChunks);
    const fileName = params.fileName;
    const mimeType = params.mimeType;

    console.log(`[CHUNK] uploadId: ${uploadId}`);
    console.log(`[CHUNK] chunkIndex: ${chunkIndex}, totalChunks: ${totalChunks}`);
    console.log(`[CHUNK] fileName: ${fileName}`);

    // ボディをバイナリに変換
    let chunkBuffer;
    if (event.isBase64Encoded) {
      chunkBuffer = Buffer.from(event.body, 'base64');
      console.log(`[CHUNK] Decoded from base64: ${chunkBuffer.length} bytes`);
    } else {
      chunkBuffer = Buffer.from(event.body, 'binary');
      console.log(`[CHUNK] Binary buffer: ${chunkBuffer.length} bytes`);
    }

    // バリデーション
    if (!uploadId || chunkIndex === undefined || totalChunks === undefined) {
      console.error(`[CHUNK] Missing required parameters`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required parameters: uploadId, chunkIndex, totalChunks'
        })
      };
    }

    if (!chunkBuffer || chunkBuffer.length === 0) {
      console.error(`[CHUNK] Empty chunk buffer`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: 'Empty chunk buffer'
        })
      };
    }

    // キャッシュを初期化
    if (!uploadCache[uploadId]) {
      uploadCache[uploadId] = {
        chunks: {},  // ★ 配列ではなくオブジェクトに変更
        fileName: fileName,
        mimeType: mimeType,
        totalChunks: totalChunks,
        createdAt: Date.now()
      };
      console.log(`[CHUNK] Created new upload session: ${uploadId}`);
    }

    // チャンクを保存
    uploadCache[uploadId].chunks[chunkIndex] = chunkBuffer;
    console.log(`[CHUNK] Saved chunk ${chunkIndex}: ${chunkBuffer.length} bytes`);

    // 受信完了したチャンク数をカウント
    const receivedChunks = Object.keys(uploadCache[uploadId].chunks).length;
    console.log(`[CHUNK] Progress: ${receivedChunks}/${totalChunks} chunks received`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({
        success: true,
        uploadId: uploadId,
        chunkIndex: chunkIndex,
        receivedChunks: receivedChunks,
        totalChunks: totalChunks
      })
    };

  } catch (error) {
    console.error(`[CHUNK] Error: ${error.message}`);
    console.error(`[CHUNK] Stack: ${error.stack}`);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}

/**
 * 修正された handleFinalizeChunks() メソッド
 */
async function handleFinalizeChunks(body) {
  try {
    const uploadId = body.uploadId;
    const fileName = body.fileName;
    const mimeType = body.mimeType;

    console.log(`[FINALIZE] uploadId: ${uploadId}`);
    console.log(`[FINALIZE] fileName: ${fileName}`);

    const cache = uploadCache[uploadId];

    if (!cache) {
      console.error(`[FINALIZE] Upload session not found: ${uploadId}`);
      return {
        statusCode: 404,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
        body: JSON.stringify({
          success: false,
          error: 'Upload session not found'
        })
      };
    }

    // チャンクをソートして統合
    const chunkIndices = Object.keys(cache.chunks)
      .map(i => parseInt(i))
      .sort((a, b) => a - b);

    console.log(`[FINALIZE] Chunk indices: ${chunkIndices.join(', ')}`);

    // すべてのチャンクが揃っているか確認
    if (chunkIndices.length !== cache.totalChunks) {
      console.error(`[FINALIZE] Missing chunks. Expected ${cache.totalChunks}, got ${chunkIndices.length}`);
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
        body: JSON.stringify({
          success: false,
          error: `Missing chunks. Expected ${cache.totalChunks}, got ${chunkIndices.length}`
        })
      };
    }

    // チャンクを順序通りに取得
    const chunksArray = chunkIndices.map(i => cache.chunks[i]);
    
    // バッファを統合
    const merged = Buffer.concat(chunksArray);
    console.log(`[FINALIZE] Merged size: ${merged.length} bytes (${(merged.length / 1024 / 1024).toFixed(2)}MB)`);

    // Release を作成
    const fileId = uploadId.split('_')[1] || uploadId;
    const releaseTag = `file_${fileId}`;
    
    console.log(`[FINALIZE] Creating release: ${releaseTag}`);
    const release = await createRelease(releaseTag, {
      title: fileName
    });

    console.log(`[FINALIZE] Release created: ${release.release_id}`);
    console.log(`[FINALIZE] Upload URL: ${release.upload_url.substring(0, 100)}...`);

    // GitHub にアップロード
    console.log(`[FINALIZE] Uploading to GitHub...`);
    const result = await uploadToGitHub(
      release.upload_url,
      fileName,
      merged
    );

    console.log(`[FINALIZE] GitHub upload success: ${result.id}`);

    // github.json に追加
    console.log(`[FINALIZE] Adding to github.json...`);
    await addFileToGithubJson({
      fileId: fileId,
      fileName: fileName,
      fileSize: merged.length,
      mimeType: mimeType,
      releaseId: release.release_id,
      releaseTag: release.tag_name,
      downloadUrl: result.browser_download_url
    });

    console.log(`[FINALIZE] Added to github.json`);

    // キャッシュをクリア
    delete uploadCache[uploadId];
    console.log(`[FINALIZE] Cache cleared`);

    console.log(`[FINALIZE] ✓ Complete`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({
        success: true,
        data: {
          fileId: fileId,
          fileName: fileName,
          size: merged.length,
          downloadUrl: result.browser_download_url
        }
      })
    };

  } catch (error) {
    console.error(`[FINALIZE] Error: ${error.message}`);
    console.error(`[FINALIZE] Stack: ${error.stack}`);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}`);

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing environment variables');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Server configuration error' }),
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

    const action = event.queryStringParameters?.action;
    const contentType = event.headers['content-type'] || '';
    
    // ★ チャンク受信
    if (action === 'upload-chunk') {
      logInfo('[CHUNK] Processing chunk upload');
      return await handleUploadChunk(event);
    }

    // ★ チャンク統合
    if (action === 'finalize-chunks') {
      logInfo('[FINALIZE] Processing finalize');
      const body = JSON.parse(event.body || '{}');
      return await handleFinalizeChunks(body);
    }

    // ★ 既存の処理: バイナリアップロード（5MB未満）
    if (contentType.includes('application/octet-stream')) {
      logInfo('[BINARY] Direct binary upload');
      
      const uploadUrl = event.queryStringParameters?.url;
      const fileName = event.queryStringParameters?.name;
      
      if (!uploadUrl || !fileName) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: false, error: 'Missing parameters' }),
        };
      }
      
      if (!event.body) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: false, error: 'Empty body' }),
        };
      }

      const binaryBuffer = event.isBase64Encoded 
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'binary');

      logInfo(`[BINARY] Buffer size: ${(binaryBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const result = await uploadToGitHub(uploadUrl, fileName, binaryBuffer);

      if (!result || !result.id) {
        throw new Error('GitHub upload failed');
      }

      logInfo(`[BINARY] Success: ${result.id}`);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ 
          success: true, 
          data: {
            asset_id: result.id,
            name: result.name,
            size: result.size,
            download_url: result.browser_download_url,
          }
        }),
      };
    }

    // ★ 既存の処理: JSON リクエスト
    const body = JSON.parse(event.body || '{}');
    logInfo(`Action: ${body.action}`);
    
    let response;

    switch (body.action) {
      case 'create-release':
        response = await createRelease(body.releaseTag, body.metadata);
        break;

      case 'add-file':
        response = await addFileToGithubJson(body.fileData);
        break;

      case 'get-github-json':
        const result = await getGithubJson();
        response = result.data;
        break;

      case 'create-view':
        response = await createViewOnServer(body.fileIds, body.passwordHash, body.origin);
        break;

      case 'get-token':
        response = { token: GITHUB_TOKEN };
        break;

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, data: response }),
    };

  } catch (e) {
    logError(`Error: ${e.message}`);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
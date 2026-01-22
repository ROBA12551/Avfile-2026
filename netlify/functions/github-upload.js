/**
 * =====================================================
 * netlify/functions/github-upload.js - 完全新規実装
 * =====================================================
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const uploadCache = {};

// GitHub API 呼び出し
function callGithubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify-Function',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API Error ${res.statusCode}: ${json.message || data}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

// バイナリアップロード
function uploadBinaryToGithub(uploadUrl, fileName, buffer) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(uploadUrl.replace('{?name,label}', ''));
      url.searchParams.set('name', fileName);

      const options = {
        hostname: url.hostname,
        port: 443,
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
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`GitHub upload error ${res.statusCode}: ${json.message}`));
            } else {
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

// =====================
// ハンドラー
// =====================

async function handleCreateRelease(body) {
  const releaseTag = body.releaseTag;
  const metadata = body.metadata || {};

  const releaseBody = {
    tag_name: releaseTag,
    name: metadata.title || releaseTag,
    body: metadata.description || '',
    draft: false,
    prerelease: false
  };

  const result = await callGithubApi(
    'POST',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
    releaseBody
  );

  return {
    release_id: result.id,
    tag_name: result.tag_name,
    upload_url: result.upload_url
  };
}

async function handleUploadAssetBinary(body) {
  const uploadUrl = body.uploadUrl;
  const fileName = body.fileName;
  const fileData = body.fileData;

  if (!uploadUrl || !fileName || !fileData) {
    throw new Error('Missing parameters: uploadUrl, fileName, fileData');
  }

  const buffer = Buffer.from(fileData, 'base64');
  const result = await uploadBinaryToGithub(uploadUrl, fileName, buffer);

  return {
    asset_id: result.id,
    download_url: result.browser_download_url,
    name: result.name,
    size: result.size
  };
}

async function handleUploadChunk(event) {
  const params = event.queryStringParameters || {};
  const uploadId = params.uploadId;
  const chunkIndex = parseInt(params.chunkIndex);
  const totalChunks = parseInt(params.totalChunks);
  const fileName = params.fileName;

  if (!uploadId || chunkIndex === undefined || !event.body) {
    throw new Error('Missing parameters');
  }

  const chunkBuffer = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'binary');

  if (!uploadCache[uploadId]) {
    uploadCache[uploadId] = {
      chunks: {},
      fileName: fileName,
      totalChunks: totalChunks
    };
  }

  uploadCache[uploadId].chunks[chunkIndex] = chunkBuffer;
  const received = Object.keys(uploadCache[uploadId].chunks).length;

  return {
    success: true,
    receivedChunks: received,
    totalChunks: totalChunks
  };
}

async function handleFinalizeChunks(body) {
  const uploadId = body.uploadId;
  const fileName = body.fileName;
  const uploadUrl = body.uploadUrl;

  const cache = uploadCache[uploadId];
  if (!cache) {
    throw new Error('Upload session not found');
  }

  const indices = Object.keys(cache.chunks).map(i => parseInt(i)).sort((a, b) => a - b);
  const chunksArray = indices.map(i => cache.chunks[i]);
  const merged = Buffer.concat(chunksArray);

  const result = await uploadBinaryToGithub(uploadUrl, fileName, merged);

  delete uploadCache[uploadId];

  return {
    fileId: uploadId,
    fileName: fileName,
    size: merged.length,
    downloadUrl: result.browser_download_url
  };
}

async function handleAddFileToGithubJson(body) {
  const fileData = body.fileData;

  const getRes = await callGithubApi(
    'GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
  );

  let jsonData = [];
  if (getRes.content) {
    const content = Buffer.from(getRes.content, 'base64').toString();
    jsonData = JSON.parse(content);
  }

  jsonData.push(fileData);

  const updateBody = {
    message: `Add file: ${fileData.fileName}`,
    content: Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64'),
    sha: getRes.sha
  };

  await callGithubApi(
    'PUT',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`,
    updateBody
  );

  return { success: true };
}

async function handleGetGithubJson() {
  const res = await callGithubApi(
    'GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
  );

  const content = Buffer.from(res.content, 'base64').toString();
  const data = JSON.parse(content);

  return data;
}

async function handleCreateView(body) {
  return {
    shareUrl: `${body.origin}/?id=${body.fileIds[0]}`
  };
}
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const uploadUrl = event.headers['x-upload-url'];
    const fileName = event.headers['x-upload-name'];
    const action = event.queryStringParameters?.action;

    // ★ バイナリアセットアップロード
    if (action === 'upload-asset-binary' || (!action && uploadUrl && fileName)) {
      const buffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body instanceof Buffer
        ? event.body
        : Buffer.from(event.body, 'binary');

      const result = await uploadBinaryToGithub(uploadUrl, fileName, buffer);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            asset_id: result.id,
            download_url: result.browser_download_url,
            name: result.name,
            size: result.size
          }
        })
      };
    }

    // 既存の JSON ベースの処理
    const body = JSON.parse(event.body || '{}');
    
    // ... 既存のコード
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
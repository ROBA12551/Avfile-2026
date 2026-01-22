/**
 * netlify/functions/github-upload.js
 * チャンク分割アップロード対応版
 * 大ファイルを分割して GitHub に保存
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// チャンク管理（メモリに保存）
const uploadChunks = new Map(); // uploadId -> { chunks: [], totalChunks, metadata }
const CHUNK_TIMEOUT = 3600000; // 1時間

// ★ 定期的に古いチャンクを削除
setInterval(() => {
  const now = Date.now();
  for (const [uploadId, data] of uploadChunks.entries()) {
    if (now - data.timestamp > CHUNK_TIMEOUT) {
      console.log('[CLEANUP] Removing expired upload:', uploadId);
      uploadChunks.delete(uploadId);
    }
  }
}, 600000); // 10分ごと

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
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(json.message));
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

function callGithubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify',
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
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * ★ 新機能: チャンクを受け取って保存
 */
async function handleChunkUpload(event) {
  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const uploadId = params.get('uploadId');
    const chunkIndex = parseInt(params.get('chunkIndex'));
    const totalChunks = parseInt(params.get('totalChunks'));
    const fileName = params.get('fileName');

    if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing parameters' })
      };
    }

    console.log('[CHUNK] Received:', {
      uploadId,
      chunkIndex,
      totalChunks,
      fileName,
      size: event.body?.length
    });

    // ★ チャンク情報を初期化
    if (!uploadChunks.has(uploadId)) {
      uploadChunks.set(uploadId, {
        chunks: new Array(totalChunks),
        totalChunks,
        fileName,
        metadata: { timestamp: Date.now() }
      });
      console.log('[CHUNK] New upload session created:', uploadId);
    }

    const uploadData = uploadChunks.get(uploadId);

    // チャンクを保存
    const buffer = Buffer.isBuffer(event.body)
      ? event.body
      : Buffer.from(event.body, 'binary');

    uploadData.chunks[chunkIndex] = buffer;
    console.log('[CHUNK] Stored chunk:', {
      index: chunkIndex,
      size: buffer.length,
      progress: `${uploadData.chunks.filter(c => c).length}/${totalChunks}`
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        uploadId,
        receivedChunks: uploadData.chunks.filter(c => c).length,
        totalChunks
      })
    };
  } catch (error) {
    console.error('[CHUNK] Error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * ★ 新機能: すべてのチャンクを結合して GitHub に保存
 */
async function finalizeCombinedUpload(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { uploadId, fileName, releaseUploadUrl, releaseId } = body;

    if (!uploadId || !fileName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing uploadId or fileName' })
      };
    }

    console.log('[FINALIZE] Starting:', {
      uploadId,
      fileName,
      hasReleaseUrl: !!releaseUploadUrl
    });

    const uploadData = uploadChunks.get(uploadId);
    if (!uploadData) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Upload session not found' })
      };
    }

    // ★ チャンクが揃っているか確認
    const missingChunks = uploadData.chunks
      .map((chunk, i) => chunk ? null : i)
      .filter(i => i !== null);

    if (missingChunks.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing chunks',
          missingChunks
        })
      };
    }

    // ★ チャンクを結合
    console.log('[FINALIZE] Combining chunks...');
    const combinedBuffer = Buffer.concat(uploadData.chunks);
    console.log('[FINALIZE] Combined size:', combinedBuffer.length, 'bytes');

    // ★ GitHub にアップロード
    let result;
    if (releaseUploadUrl) {
      // リリースアセットとしてアップロード
      result = await uploadBinaryToGithub(releaseUploadUrl, combinedBuffer, fileName);
    } else {
      // github.json に情報を保存するだけ
      result = { id: 'direct-upload', browser_download_url: '' };
    }

    // ★ チャンクデータをクリア
    uploadChunks.delete(uploadId);

    console.log('[FINALIZE] Success');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          asset_id: result.id,
          download_url: result.browser_download_url,
          name: result.name || fileName,
          size: result.size || combinedBuffer.length
        }
      })
    };
  } catch (error) {
    console.error('[FINALIZE] Error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * github.json にファイル情報を追加
 */
async function addFileToGithubJson(fileData) {
  try {
    let sha = null;
    let files = [];

    console.log('[ADD_FILE] Saving:', fileData.fileName);

    try {
      const getRes = await callGithubApi(
        'GET',
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
      );

      if (getRes.content) {
        const content = Buffer.from(getRes.content, 'base64').toString();
        files = JSON.parse(content);
      }
      sha = getRes.sha;
    } catch (e) {
      if (e.message.includes('404')) {
        console.log('[ADD_FILE] Creating new github.json');
        files = [];
        sha = null;
      } else {
        throw e;
      }
    }

    files.push({
      fileId: fileData.fileId,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      downloadUrl: fileData.downloadUrl,
      uploadedAt: new Date().toISOString()
    });

    const updatePayload = {
      message: `Add file: ${fileData.fileName}`,
      content: Buffer.from(JSON.stringify(files, null, 2)).toString('base64')
    };

    if (sha) {
      updatePayload.sha = sha;
    }

    await callGithubApi(
      'PUT',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`,
      updatePayload
    );

    return { success: true };
  } catch (e) {
    console.error('[ADD_FILE] Error:', e.message);
    throw e;
  }
}

// ★★★ メインハンドラ ★★★
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const uploadUrl = event.headers['x-upload-url'];
    
    // ★ バイナリアップロード（小ファイル）
    if (uploadUrl) {
      const isBase64 = event.headers['x-is-base64'] === 'true';
      const fileName = event.headers['x-file-name'] || 'file';
      const buffer = isBase64
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'binary');
      
      console.log('[MAIN] Binary upload:', {
        fileName,
        size: buffer.length,
        sizeMB: (buffer.length / 1024 / 1024).toFixed(2)
      });

      const result = await uploadBinaryToGithub(uploadUrl, buffer, fileName);

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

    // JSON アクション処理
    const body = JSON.parse(event.body || '{}');

    // ★ チャンクアップロード
    if (body.action === 'upload-chunk') {
      return await handleChunkUpload(event);
    }

    // ★ チャンク統合
    if (body.action === 'finalize-chunks') {
      return await finalizeCombinedUpload(event);
    }

    if (body.action === 'create-release') {
      const result = await callGithubApi(
        'POST',
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
        {
          tag_name: body.releaseTag,
          name: body.metadata?.title || body.releaseTag,
          body: body.metadata?.description || '',
          draft: false,
          prerelease: false
        }
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            release_id: result.id,
            tag_name: result.tag_name,
            upload_url: result.upload_url
          }
        })
      };
    }

    if (body.action === 'add-file') {
      await addFileToGithubJson(body.fileData);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    if (body.action === 'get-token') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: { token: GITHUB_TOKEN } })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Unknown action' })
    };

  } catch (error) {
    console.error('[ERROR]', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
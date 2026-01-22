/**
 * =====================================================
 * netlify/functions/github-upload.js の拡張
 * チャンク受信・統合機能を追加
 * =====================================================
 * 
 * 追加する処理:
 * 1. action=upload-chunk → チャンク受信（メモリに一時保存）
 * 2. action=finalize-chunks → チャンク統合 → GitHub に直接アップロード
 * 
 * 既存の処理はそのまま使用
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

// グローバルキャッシュ（チャンク一時保存）
const uploadCache = {};

// ============ 既存のコード（変更なし） ============

function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

function logWarn(msg) {
  console.warn(`[WARN] ${new Date().toISOString()} ${msg}`);
}

// ... (既存のコードをここに含める)

// ============ チャンク処理の追加 ============

/**
 * チャンク受信（5MB単位）
 */
async function handleUploadChunk(event) {
  try {
    const params = event.queryStringParameters || {};
    const uploadId = params.uploadId;
    const chunkIndex = parseInt(params.chunkIndex);
    const totalChunks = parseInt(params.totalChunks);
    const fileName = params.fileName;
    const mimeType = params.mimeType;

    if (!uploadId || chunkIndex === undefined || totalChunks === undefined) {
      throw new Error('Missing required parameters');
    }

    // バイナリボディを取得
    const chunkBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'binary');

    console.log(`[CHUNK] Received chunk ${chunkIndex + 1}/${totalChunks} (${(chunkBuffer.length / 1024 / 1024).toFixed(2)}MB)`);

    // キャッシュを初期化
    if (!uploadCache[uploadId]) {
      uploadCache[uploadId] = {
        chunks: [],
        fileName: fileName,
        mimeType: mimeType,
        totalChunks: totalChunks,
        createdAt: Date.now()
      };
    }

    // チャンクを保存
    uploadCache[uploadId].chunks[chunkIndex] = chunkBuffer;

    const cache = uploadCache[uploadId];
    const receivedChunks = cache.chunks.filter(c => c).length;
    const isComplete = receivedChunks === cache.totalChunks;

    console.log(`[CHUNK] Progress: ${receivedChunks}/${cache.totalChunks}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        chunkIndex: chunkIndex,
        receivedChunks: receivedChunks,
        totalChunks: totalChunks,
        complete: isComplete
      })
    };
  } catch (error) {
    logError(`[CHUNK] Error: ${error.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

/**
 * チャンク統合 → GitHub に直接アップロード
 */
async function handleFinalizeChunks(body) {
  try {
    const uploadId = body.uploadId;
    const fileName = body.fileName;
    const mimeType = body.mimeType;

    if (!uploadId) {
      throw new Error('Missing uploadId');
    }

    const cache = uploadCache[uploadId];
    if (!cache) {
      throw new Error('Upload session not found');
    }

    console.log(`[FINALIZE] Finalizing upload: ${uploadId}`);

    // チャンクが全て揃っているか確認
    const receivedChunks = cache.chunks.filter(c => c).length;
    if (receivedChunks !== cache.totalChunks) {
      throw new Error(`Incomplete chunks: ${receivedChunks}/${cache.totalChunks}`);
    }

    // チャンクを統合
    console.log('[FINALIZE] Merging chunks...');
    const mergedBuffer = Buffer.concat(cache.chunks);
    console.log(`[FINALIZE] Total size: ${(mergedBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // リリースを作成
    console.log('[FINALIZE] Creating release...');
    const releaseTag = `file_${uploadId}`;
    
    const releaseResult = await createRelease(releaseTag, {
      title: fileName,
      description: `File: ${fileName}`
    });

    if (!releaseResult || !releaseResult.upload_url) {
      throw new Error('Release creation failed');
    }

    // GitHub に直接アップロード
    console.log('[FINALIZE] Uploading to GitHub...');
    const uploadResult = await uploadToGitHub(releaseResult.upload_url, fileName, mergedBuffer);

    if (!uploadResult || !uploadResult.id) {
      throw new Error('GitHub upload failed');
    }

    // github.json に追加
    console.log('[FINALIZE] Adding to github.json...');
    const fileId = `f_${uploadId}`;
    
    await addFileToGithubJson({
      fileId: fileId,
      fileName: fileName,
      fileSize: mergedBuffer.length,
      mimeType: mimeType,
      releaseId: releaseResult.release_id,
      releaseTag: releaseTag,
      downloadUrl: uploadResult.browser_download_url,
      metadata: { extension: fileName.split('.').pop() }
    });

    // キャッシュをクリア
    delete uploadCache[uploadId];

    console.log('[FINALIZE] ✓ Upload complete');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        file: {
          fileId: fileId,
          fileName: fileName,
          size: mergedBuffer.length,
          downloadUrl: uploadResult.browser_download_url
        }
      })
    };
  } catch (error) {
    logError(`[FINALIZE] Error: ${error.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

// ============ メインハンドラー（既存のコードを拡張） ============

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
    
    // ★ 新機能: チャンク受信
    if (action === 'upload-chunk') {
      logInfo('[CHUNK] Processing chunk upload');
      return await handleUploadChunk(event);
    }

    // ★ 新機能: チャンク統合
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
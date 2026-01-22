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

// ... (他のヘルパー関数は同じ)

// ★ GitHub Uploadsへの直接ストリーミングアップロード
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
        timeout: 180000, // 3分のタイムアウト
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

// ... (他の関数は同じ)

exports.handler = async (event) => {
  try {
    logInfo(`=== REQUEST START ===`);
    logInfo(`Method: ${event.httpMethod}`);
    logInfo(`Content-Type: ${event.headers['content-type'] || 'none'}`);

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
    
    // ★ バイナリデータの処理
    if (contentType.includes('application/octet-stream')) {
      logInfo('[BINARY] Processing binary upload');
      
      const action = event.queryStringParameters?.action;
      const uploadUrl = event.queryStringParameters?.url;
      const fileName = event.queryStringParameters?.name;
      
      logInfo(`[BINARY] Action: ${action}`);
      logInfo(`[BINARY] FileName: ${fileName}`);
      
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
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
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

        logInfo(`[BINARY] Uploading to GitHub: ${assetUrl.substring(0, 100)}...`);

        const assetResponse = await githubUploadRequest('POST', assetUrl, binaryData);

        if (!assetResponse || !assetResponse.id) {
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
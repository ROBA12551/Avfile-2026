const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
}

async function githubRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Avfile-View',
      },
    };

    if (body) {
      const jsonBody = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(jsonBody);
    }

    logInfo(`GitHub Request: ${method} ${path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        logInfo(`GitHub Response: ${res.statusCode}`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(new Error('Failed to parse response'));
          }
        } else {
          reject(new Error(`GitHub Error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  logInfo(`=== VIEW HANDLER START ===`);
  logInfo(`Query params: ${JSON.stringify(event.queryStringParameters)}`);

  try {
    const viewId = event.queryStringParameters?.id;
    
    if (!viewId) {
      logError('Missing id parameter');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Missing id parameter' })
      };
    }

    logInfo(`Looking for viewId: ${viewId}`);

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing env vars');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Server not configured' })
      };
    }

    logInfo(`Fetching github.json from ${GITHUB_OWNER}/${GITHUB_REPO}`);

    let jsonRes;
    try {
      jsonRes = await githubRequest(
        'GET',
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
      );
    } catch (e) {
      logError(`Failed to fetch github.json: ${e.message}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'github.json not found', message: e.message })
      };
    }

    if (!jsonRes || !jsonRes.content) {
      logError('Invalid github.json response');
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'github.json not found or invalid' })
      };
    }

    let decoded;
    try {
      decoded = Buffer.from(jsonRes.content, 'base64').toString('utf-8');
      logInfo(`Decoded github.json: ${decoded.length} bytes`);
    } catch (e) {
      logError(`Decode error: ${e.message}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Failed to decode github.json' })
      };
    }

    let data;
    try {
      data = JSON.parse(decoded);
      logInfo(`Parsed successfully`);
      logInfo(`Files count: ${(data || []).length}`);
    } catch (e) {
      logError(`Parse error: ${e.message}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Invalid JSON in github.json', message: e.message })
      };
    }

    // ★ 修正: github.json は直接ファイル配列
    // [{fileId, fileName, fileSize, downloadUrl}, ...]
    const allFiles = Array.isArray(data) ? data : [];
    logInfo(`All files: ${allFiles.length}`);

    // viewId に合致するファイルを探す
    const file = allFiles.find(f => f && f.fileId === viewId);
    
    if (!file) {
      logError(`File not found for viewId: ${viewId}`);
      logInfo(`Available fileIds: ${allFiles.map(f => f.fileId).join(', ')}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'File not found', viewId })
      };
    }

    logInfo(`File found: ${file.fileName}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: true,
        files: [
          {
            fileId: file.fileId,
            fileName: file.fileName,
            fileSize: file.fileSize,
            downloadUrl: file.downloadUrl
          }
        ]
      })
    };

  } catch (e) {
    logError(`Unhandled error: ${e.message}`);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: false,
        error: 'Internal server error',
        message: e.message
      })
    };
  }
};
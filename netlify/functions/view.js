const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

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

// ★ GitHub Releases URL を jsDelivr CDN に変換
function convertToJsDelivrUrl(downloadUrl) {
  if (!downloadUrl || !downloadUrl.includes('github.com')) {
    return downloadUrl;
  }

  try {
    // URL format: https://github.com/OWNER/REPO/releases/download/TAG/FILENAME
    // または: https://api.github.com/repos/OWNER/REPO/releases/assets/ID
    
    // github.com/releases/download の場合
    const match1 = downloadUrl.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
    if (match1) {
      const [, owner, repo, tag, filename] = match1;
      const jsDelivrUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${tag}/${filename}`;
      logInfo(`Converted URL: ${downloadUrl} → ${jsDelivrUrl}`);
      return jsDelivrUrl;
    }

    // github releases redirect の場合（通常はこちら）
    // https://github.com/user/repo/releases/download/tag/file.ext
    if (downloadUrl.includes('/releases/download/')) {
      const parts = downloadUrl.split('/');
      const owner = parts[3];
      const repo = parts[4];
      // releases/download の後ろを取得
      const idx = downloadUrl.indexOf('/releases/download/');
      const tagAndFile = downloadUrl.substring(idx + '/releases/download/'.length);
      const [tag, ...fileParts] = tagAndFile.split('/');
      const filename = fileParts.join('/');
      
      const jsDelivrUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${tag}/${filename}`;
      logInfo(`Converted URL: ${downloadUrl} → ${jsDelivrUrl}`);
      return jsDelivrUrl;
    }

    return downloadUrl;
  } catch (e) {
    logError(`URL conversion error: ${e.message}`);
    return downloadUrl;
  }
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing id parameter' })
      };
    }

    logInfo(`Looking for viewId: ${viewId}`);

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing env vars');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server not configured' })
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'github.json not found', message: e.message })
      };
    }

    if (!jsonRes || !jsonRes.content) {
      logError('Invalid github.json response');
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'github.json not found or invalid' })
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to decode github.json' })
      };
    }

    let data;
    try {
      data = JSON.parse(decoded);
      logInfo(`Parsed successfully`);
      logInfo(`Views count: ${(data.views || []).length}`);
      logInfo(`Files count: ${(data.files || []).length}`);
    } catch (e) {
      logError(`Parse error: ${e.message}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in github.json', message: e.message })
      };
    }

    // Find view
    const view = (data.views || []).find(v => v && v.viewId === viewId);
    
    if (!view) {
      logError(`View not found: ${viewId}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'View not found', viewId })
      };
    }

    logInfo(`View found: ${view.viewId}`);

    // ★ github.json から downloadUrl を取得し、jsDelivr に変換
    const files = (view.files || [])
      .map(fid => {
        logInfo(`Looking for file: ${fid}`);
        const file = (data.files || []).find(f => f && f.fileId === fid);
        if (!file) {
          logError(`File not found: ${fid}`);
          return null;
        }
        logInfo(`Found file: ${file.fileName}`);
        
        // ★ URL を jsDelivr に変換（CORS エラーを回避）
        const downloadUrl = convertToJsDelivrUrl(file.downloadUrl);
        
        return {
          fileId: file.fileId,
          fileName: file.fileName,
          fileSize: file.fileSize,
          downloadUrl: downloadUrl  // ★ 変換後の URL を返す
        };
      })
      .filter(Boolean);

    logInfo(`Returning ${files.length} files`);

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
        password: view.password || null,
        shareUrl: view.shareUrl || null,
        files: files
      })
    };

  } catch (e) {
    logError(`Unhandled error: ${e.message}`);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: e.message
      })
    };
  }
};
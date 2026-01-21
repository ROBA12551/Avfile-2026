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

// ★ Release タグからダウンロードURLを構築
async function getDownloadUrlForFileId(fileId) {
  try {
    logInfo(`Getting release URL for fileId: ${fileId}`);
    
    // Release tag の形式: file_XXX
    const releaseTag = `file_${fileId}`;
    
    // GitHub API で release を取得
    const release = await githubRequest(
      'GET',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${releaseTag}`
    );
    
    if (!release || !release.assets || release.assets.length === 0) {
      logError(`No assets found for release: ${releaseTag}`);
      return null;
    }
    
    // 最初のアセットのダウンロードURLを取得
    const downloadUrl = release.assets[0].browser_download_url;
    logInfo(`Got download URL: ${downloadUrl}`);
    
    return downloadUrl;
  } catch (e) {
    logError(`Failed to get download URL for ${fileId}: ${e.message}`);
    return null;
  }
}

// ★ GitHub Releases URL を jsDelivr CDN に変換（修正版）
function convertToJsDelivrUrl(githubReleaseUrl, tag, fileName) {
  try {
    // githubReleaseUrl 形式:
    // https://github.com/OWNER/REPO/releases/download/TAG/FILENAME
    
    const match = githubReleaseUrl.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/download\//);
    if (!match) {
      logError(`URL doesn't match expected pattern: ${githubReleaseUrl}`);
      return githubReleaseUrl;
    }
    
    const [, owner, repo] = match;
    
    // jsDelivr URL: https://cdn.jsdelivr.net/gh/OWNER/REPO@TAG/FILENAME
    const jsDelivrUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${tag}/${fileName}`;
    logInfo(`Converted: ${githubReleaseUrl} → ${jsDelivrUrl}`);
    
    return jsDelivrUrl;
  } catch (e) {
    logError(`URL conversion error: ${e.message}`);
    return githubReleaseUrl;
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

    // ★ fileIds からファイル情報を取得し、GitHub APIから正しいダウンロードURLを取得
    const files = [];
    for (const fileId of (view.fileIds || [])) {
      try {
        logInfo(`Processing fileId: ${fileId}`);
        
        // github.json からファイル情報を取得
        const fileInfo = (data.files || []).find(f => f && f.fileId === fileId);
        if (!fileInfo) {
          logError(`File not found in github.json: ${fileId}`);
          continue;
        }
        
        logInfo(`Found file in github.json: ${fileInfo.fileName}`);
        
        // ★ GitHub API から実際のダウンロードURLを取得
        const downloadUrl = await getDownloadUrlForFileId(fileId);
        if (!downloadUrl) {
          logError(`Could not get download URL for: ${fileId}`);
          continue;
        }
        
        // ★ GitHub URL を jsDelivr に変換
        const releaseTag = `file_${fileId}`;
        const jsDelivrUrl = convertToJsDelivrUrl(downloadUrl, releaseTag, fileInfo.fileName);
        
        files.push({
          fileId: fileInfo.fileId,
          fileName: fileInfo.fileName,
          fileSize: fileInfo.fileSize,
          downloadUrl: jsDelivrUrl  // ★ jsDelivr URL を返す
        });
        
        logInfo(`Added file: ${fileInfo.fileName} → ${jsDelivrUrl}`);
      } catch (e) {
        logError(`Error processing fileId ${fileId}: ${e.message}`);
        continue;
      }
    }

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
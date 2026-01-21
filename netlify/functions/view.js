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

    // Check env vars
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      logError('Missing env vars');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Server not configured',
          details: 'Missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO'
        })
      };
    }

    logInfo(`Fetching github.json from ${GITHUB_OWNER}/${GITHUB_REPO}`);

    // Fetch github.json
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
      logError('Invalid github.json response - no content field');
      logError(`Response keys: ${Object.keys(jsonRes || {})}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'github.json not found or invalid' })
      };
    }

    // Decode base64
    let decoded;
    try {
      decoded = Buffer.from(jsonRes.content, 'base64').toString('utf-8');
      logInfo(`Decoded github.json: ${decoded.length} bytes`);
      logInfo(`Content preview: ${decoded.substring(0, 200)}`);
    } catch (e) {
      logError(`Decode error: ${e.message}`);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to decode github.json' })
      };
    }

    // Parse JSON
    let data;
    try {
      data = JSON.parse(decoded);
      logInfo(`Parsed successfully`);
      logInfo(`Root keys: ${Object.keys(data).join(', ')}`);
      logInfo(`Views count: ${(data.views || []).length}`);
      logInfo(`Files count: ${(data.files || []).length}`);
      logInfo(`Views: ${JSON.stringify(data.views || [])}`);
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
      logInfo(`Available views: ${(data.views || []).map(v => v?.viewId).filter(Boolean).join(', ')}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'View not found', viewId })
      };
    }

    logInfo(`View found: ${view.viewId}`);
    logInfo(`View files array: ${JSON.stringify(view.files)}`);

    // Map files
    const files = (view.files || [])
      .map(fid => {
        logInfo(`Looking for file: ${fid}`);
        const file = (data.files || []).find(f => f && f.fileId === fid);
        if (!file) {
          logError(`File not found: ${fid}`);
          return null;
        }
        logInfo(`Found file: ${file.fileName}`);
        return {
          fileId: file.fileId,
          fileName: file.fileName,
          fileSize: file.fileSize,
          downloadUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/uploads/${file.fileId}-${encodeURIComponent(file.fileName)}`
        };
      })
      .filter(Boolean);

    logInfo(`Returning ${files.length} files`);
    logInfo(`Files: ${JSON.stringify(files)}`);

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
        files: files
      })
    };

  } catch (e) {
    logError(`Unhandled error: ${e.message}`);
    logError(`Stack: ${e.stack}`);
    
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
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

console.log('=== VIEW FUNCTION STARTED ===');
console.log('Config:', { GITHUB_OWNER, GITHUB_REPO, TOKEN: GITHUB_TOKEN ? 'SET' : 'MISSING' });

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Avfile-View',
        'Accept': 'application/vnd.github.v3.raw',
      }
    };

    console.log('GitHub Request:', path);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log('GitHub Response:', res.statusCode);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => {
      console.error('Request error:', err.message);
      reject(err);
    });

    req.end();
  });
}

exports.handler = async (event) => {
  console.log('Handler called with:', event.queryStringParameters);

  try {
    const viewId = event.queryStringParameters?.id;
    if (!viewId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing id parameter' })
      };
    }

    console.log('Looking for viewId:', viewId);

    // Check environment variables
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Server not configured',
          details: 'Missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO'
        })
      };
    }

    // Fetch github.json
    let jsonRes;
    try {
      jsonRes = await githubGet(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
      );
      console.log('github.json retrieved');
    } catch (e) {
      console.error('Failed to fetch github.json:', e.message);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'github.json not found: ' + e.message })
      };
    }

    if (!jsonRes || !jsonRes.content) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid github.json content' })
      };
    }

    // Decode base64
    let decoded;
    try {
      decoded = Buffer.from(jsonRes.content, 'base64').toString('utf-8');
      console.log('Decoded github.json length:', decoded.length);
    } catch (e) {
      console.error('Decode error:', e.message);
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
      console.log('Parsed. Views count:', (data.views || []).length);
    } catch (e) {
      console.error('Parse error:', e.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in github.json' })
      };
    }

    // Find view
    const view = (data.views || []).find(v => v.viewId === viewId);
    if (!view) {
      console.log('View not found. Available views:', (data.views || []).map(v => v.viewId));
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'View not found', viewId })
      };
    }

    console.log('View found. Files:', view.files.length);

    // Map files
    const files = view.files
      .map(fid => data.files.find(f => f.fileId === fid))
      .filter(Boolean)
      .map(f => ({
        fileId: f.fileId,
        fileName: f.fileName,
        fileSize: f.fileSize,
        downloadUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/uploads/${f.fileId}-${f.fileName}`
      }));

    console.log('Returning files:', files.length);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: true,
        password: view.password || null,
        files: files
      })
    };

  } catch (e) {
    console.error('Unhandled error:', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: e.message,
        stack: e.stack
      })
    };
  }
};
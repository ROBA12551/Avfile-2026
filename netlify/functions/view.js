const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

console.log('View Function loaded. Owner:', GITHUB_OWNER, 'Repo:', GITHUB_REPO);

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Avfile-Upload',
        'Accept': 'application/vnd.github.v3.raw',
      }
    };

    console.log('GitHub API Request:', options.path);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log('GitHub API Response Status:', res.statusCode);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from GitHub: ' + e.message));
          }
        } else {
          console.error('GitHub API Error:', res.statusCode, data.substring(0, 200));
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => {
      console.error('Request Error:', err);
      reject(err);
    });

    req.end();
  });
}

exports.handler = async (event) => {
  try {
    console.log('View handler called. Query:', event.queryStringParameters);

    const viewId = event.queryStringParameters?.id;
    if (!viewId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing id parameter' })
      };
    }

    console.log('Fetching view:', viewId);

    // github.json を取得
    let jsonRes;
    try {
      jsonRes = await githubGet(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
      );
    } catch (e) {
      console.error('Failed to fetch github.json:', e.message);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'github.json not found: ' + e.message })
      };
    }

    if (!jsonRes.content) {
      console.error('github.json content not found');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid github.json format' })
      };
    }

    let decoded;
    try {
      decoded = Buffer.from(jsonRes.content, 'base64').toString('utf-8');
    } catch (e) {
      console.error('Failed to decode github.json:', e.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to decode github.json' })
      };
    }

    let data;
    try {
      data = JSON.parse(decoded);
    } catch (e) {
      console.error('Failed to parse github.json:', e.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in github.json' })
      };
    }

    console.log('github.json loaded. Views:', (data.views || []).length);

    const view = (data.views || []).find(v => v.viewId === viewId);
    if (!view) {
      console.log('View not found:', viewId);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'View not found' })
      };
    }

    console.log('View found. Files:', view.files.length);

    // fileId → file情報に変換
    const files = view.files
      .map(fid => data.files.find(f => f.fileId === fid))
      .filter(Boolean)
      .map(f => ({
        fileId: f.fileId,
        fileName: f.fileName,
        fileSize: f.fileSize,
        downloadUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/uploads/${f.fileId}-${f.fileName}`
      }));

    console.log('Returning', files.length, 'files');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({
        success: true,
        password: view.password || null,
        files: files
      })
    };

  } catch (e) {
    console.error('Handler Error:', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Internal server error' })
    };
  }
};
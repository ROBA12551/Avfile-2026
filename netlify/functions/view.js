const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Avfile',
        'Accept': 'application/vnd.github.v3.raw',
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  try {
    const viewId = event.queryStringParameters?.id;
    if (!viewId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing id' })
      };
    }

    // github.json を取得
    const jsonRes = await githubGet(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
    );

    const decoded = Buffer.from(jsonRes.content, 'base64').toString('utf-8');
    const data = JSON.parse(decoded);

    const view = (data.views || []).find(v => v.viewId === viewId);
    if (!view) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'View not found' })
      };
    }

    // fileId → file情報に変換
    const files = view.files
      .map(fid => data.files.find(f => f.fileId === fid))
      .filter(Boolean)
      .map(f => ({
        fileId: f.fileId,
        fileName: f.fileName,
        fileSize: f.fileSize,
        // GitHub Raw URL - ブラウザで直接ストリーミング再生可能
        downloadUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/uploads/${f.fileId}-${f.fileName}`
      }));

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
    console.error('Error:', e.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Internal server error' })
    };
  }
};
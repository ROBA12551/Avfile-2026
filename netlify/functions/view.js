const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

/* =====================
   GitHub GET helper
===================== */
function githubGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Avfile',
        'Accept': 'application/vnd.github+json',
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error('GitHub API error'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/* =====================
   Handler
===================== */
exports.handler = async (event) => {
  try {
    const viewId = event.queryStringParameters?.id;
    if (!viewId) {
      return { statusCode: 400, body: 'Missing id' };
    }

    // github.json を取得
    const jsonRes = await githubGet(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
    );

    const decoded = Buffer
      .from(jsonRes.content, 'base64')
      .toString('utf-8');

    const data = JSON.parse(decoded);

    const view = (data.views || []).find(v => v.viewId === viewId);
    if (!view) {
      return { statusCode: 404, body: 'Not found' };
    }

    // fileId → file情報に変換
    const files = view.files
      .map(fid => data.files.find(f => f.fileId === fid))
      .filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        password: view.password || null,
        files
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};

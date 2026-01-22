const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

const cache = new Map();
const TTL = 3600 * 1000;

/* =======================
   GitHub GET
======================= */
async function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Avfile-Netlify',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`GitHub GET ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/* =======================
   Cache Helper
======================= */
async function withCache(key, fn) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.value;

  const value = await fn();
  cache.set(key, { value, expires: now + TTL });
  return value;
}

/* =======================
   Handler
======================= */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405 };
  }

  try {
    const q = event.queryStringParameters || {};
    const action = q.action || 'get-release';

    let data;

    if (action === 'get-release') {
      data = await withCache(`r:${q.releaseId}`, async () => {
        return githubGet(
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/${q.releaseId}`
        );
      });
    } else if (action === 'latest-releases') {
      data = await withCache('latest', async () => {
        return githubGet(
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`
        );
      });
    } else {
      throw new Error('Unknown action');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data }),
    };
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};

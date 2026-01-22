const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

function uploadBinaryToGithub(uploadUrl, buffer) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(uploadUrl.replace('{?name,label}', ''));
      url.searchParams.set('name', 'file');

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.message));
          } else {
            resolve(json);
          }
        });
      });

      req.on('error', reject);
      req.write(buffer);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function callGithubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        if (res.statusCode >= 400) {
          reject(new Error(json.message));
        } else {
          resolve(json);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    console.log('[HANDLER] Method:', event.httpMethod);
    console.log('[HANDLER] Headers:', Object.keys(event.headers));
    console.log('[HANDLER] Body size:', event.body ? event.body.length : 0);

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    const uploadUrl = event.headers['x-upload-url'];
    console.log('[HANDLER] uploadUrl:', uploadUrl ? 'present' : 'missing');

    const body = JSON.parse(event.body || '{}');
    console.log('[HANDLER] body.action:', body.action);

    // ... 後は既存コード

  } catch (error) {
    console.error('[ERROR]', error.message);
    console.error('[ERROR] Stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
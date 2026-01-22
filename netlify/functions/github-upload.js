
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const uploadCache = {};

function uploadBinaryToGithub(uploadUrl, fileName, buffer) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(uploadUrl.replace('{?name,label}', ''));
      url.searchParams.set('name', fileName);

      const options = {
        hostname: url.hostname,
        port: 443,
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
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`GitHub error ${res.statusCode}: ${json.message}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data}`));
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

async function handleCreateRelease(body) {
  const releaseBody = {
    tag_name: body.releaseTag,
    name: body.metadata?.title || body.releaseTag,
    body: body.metadata?.description || '',
    draft: false,
    prerelease: false
  };

  const result = await callGithubApi(
    'POST',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
    releaseBody
  );

  return {
    release_id: result.id,
    tag_name: result.tag_name,
    upload_url: result.upload_url
  };
}

function callGithubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
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
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${json.message}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    const uploadUrl = event.headers['x-upload-url'];
    const fileName = event.headers['x-upload-name'];
    const action = event.queryStringParameters?.action;

    // バイナリアップロード
    if (uploadUrl && fileName) {
      const buffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'binary');

      const result = await uploadBinaryToGithub(uploadUrl, fileName, buffer);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            asset_id: result.id,
            download_url: result.browser_download_url,
            name: result.name,
            size: result.size
          }
        })
      };
    }

    const body = JSON.parse(event.body || '{}');

    if (body.action === 'create-release') {
      const result = await handleCreateRelease(body);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: result })
      };
    }

    if (body.action === 'get-token') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: { token: GITHUB_TOKEN } })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Unknown action' })
    };

  } catch (error) {
    console.error('[ERROR]', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

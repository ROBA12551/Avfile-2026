const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

function uploadBinaryToGithub(uploadUrl, buffer) {
  return new Promise((resolve, reject) => {
    try {
      const cleanUrl = uploadUrl.split('{')[0];
      const url = new URL(cleanUrl);
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
        resolve(json);
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
    const uploadUrl = event.headers['x-upload-url'];
    
    // バイナリアップロード
    if (uploadUrl) {
      // ★ Base64 チェック削除
      const buffer = Buffer.from(event.body, 'binary');
      const result = await uploadBinaryToGithub(uploadUrl, buffer);

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

    // JSON アクション処理
    const body = JSON.parse(event.body || '{}');

    if (body.action === 'create-release') {
      const result = await callGithubApi('POST', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`, {
        tag_name: body.releaseTag,
        name: body.metadata?.title || body.releaseTag,
        body: body.metadata?.description || '',
        draft: false,
        prerelease: false
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: { 
            release_id: result.id, 
            tag_name: result.tag_name, 
            upload_url: result.upload_url 
          }
        })
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
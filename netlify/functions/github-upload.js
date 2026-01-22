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
        try {
          const json = JSON.parse(data);
          
          // ✅ HTTP ステータスをチェック
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API Error ${res.statusCode}: ${json.message || data}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ★ 修正: github.json にファイルを追加
async function addFileToGithubJson(fileData) {
  try {
    let sha = null;
    let files = [];

    // 既存の github.json を取得
    try {
      const getRes = await callGithubApi(
        'GET',
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`
      );

      if (getRes.content) {
        const content = Buffer.from(getRes.content, 'base64').toString();
        files = JSON.parse(content);
      }
      sha = getRes.sha;
    } catch (e) {
      // ✅ github.json が存在しない場合は新規作成
      if (e.message.includes('404')) {
        console.log('[ADD_FILE] github.json not found, creating new');
        files = [];
        sha = null;
      } else {
        throw e;
      }
    }

    // 新しいファイル情報を追加
    files.push({
      fileId: fileData.fileId,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      downloadUrl: fileData.downloadUrl,
      uploadedAt: new Date().toISOString()
    });

    // github.json を更新
    const updatePayload = {
      message: `Add file: ${fileData.fileName}`,
      content: Buffer.from(JSON.stringify(files, null, 2)).toString('base64')
    };

    // ✅ 既存ファイルの場合は sha を含める
    if (sha) {
      updatePayload.sha = sha;
    }

    await callGithubApi(
      'PUT',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/github.json`,
      updatePayload
    );

    return { success: true };
  } catch (e) {
    console.error('[ADD_FILE] Error:', e.message);
    throw e;
  }
}
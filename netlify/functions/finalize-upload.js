const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const uploads = require('./initiate-upload').uploads || new Map();

exports.handler = async (event) => {
  try {
    const { uploadId } = JSON.parse(event.body);

    const upload = uploads.get(uploadId);
    if (!upload) {
      throw new Error('Upload not found');
    }

    // ★ すべてのチャンクを結合
    const completeFile = Buffer.concat(upload.chunks);

    console.log('[FINALIZE] Total size:', (completeFile.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('[FINALIZE] Uploading to GitHub...');

    // ★ GitHub にアップロード
    const result = await uploadToGitHub(upload.uploadUrl, upload.fileName, completeFile);

    // ★ クリーンアップ
    uploads.delete(uploadId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true, 
        data: {
          asset_id: result.id,
          name: result.name,
          size: result.size,
          download_url: result.browser_download_url,
        }
      }),
    };

  } catch (error) {
    console.error('[FINALIZE] Error:', error.message);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};

function uploadToGitHub(uploadUrl, fileName, binaryBuffer) {
  return new Promise((resolve, reject) => {
    try {
      let cleanUrl = uploadUrl.trim().replace(/\{[?&].*?\}/g, '');
      const encodedFileName = encodeURIComponent(fileName);
      const assetUrl = `${cleanUrl}?name=${encodedFileName}`;

      const parsed = new URL(assetUrl);

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        timeout: 180000,
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'Avfile-Proxy',
          'Content-Type': 'application/octet-stream',
          'Content-Length': binaryBuffer.length,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`GitHub error: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(binaryBuffer);
      req.end();
      
    } catch (e) {
      reject(e);
    }
  });
}
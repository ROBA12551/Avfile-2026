/**
 * netlify/functions/proxy-download.js
 * GitHub リリースアセットを CORS プロキシ経由で配信
 */

const https = require('https');

exports.handler = async (event) => {
  try {
    const { url } = event.queryStringParameters || {};

    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'URL parameter required' })
      };
    }

    // URL をデコード
    const decodedUrl = decodeURIComponent(url);
    console.log('[PROXY] Fetching:', decodedUrl.substring(0, 100));

    // ファイルを取得
    const fileData = await new Promise((resolve, reject) => {
      const chunks = [];

      https
        .get(decodedUrl, { 
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }, (res) => {
          // リダイレクトハンドリング
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            console.log('[PROXY] Redirect to:', res.headers.location);
            const redirectUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, decodedUrl).toString();
            
            return https.get(redirectUrl, { 
              maxRedirects: 5,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            }, handleResponse);
          }

          handleResponse(res);
        })
        .on('error', reject);

      function handleResponse(res) {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            data: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || 'application/octet-stream'
          });
        });
        res.on('error', reject);
      }
    });

    // Base64 エンコード
    const base64 = fileData.data.toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': fileData.contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Cache-Control': 'public, max-age=31536000',
        'Content-Disposition': 'inline'
      },
      isBase64Encoded: true,
      body: base64
    };
  } catch (error) {
    console.error('[PROXY] Error:', error.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
/**
 * netlify/functions/proxy-download.js - デバッグ版
 * GitHub リリースアセットを CORS プロキシ経由で配信
 */

const https = require('https');

exports.handler = async (event) => {
  try {
    const { url } = event.queryStringParameters || {};

    console.log('[PROXY] Request received');
    console.log('[PROXY] Query params:', event.queryStringParameters);

    if (!url) {
      console.log('[PROXY] Error: No URL parameter');
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'URL parameter required' })
      };
    }

    // URL をデコード
    const decodedUrl = decodeURIComponent(url);
    console.log('[PROXY] Fetching URL:', decodedUrl);

    // ファイルを取得
    const fileData = await new Promise((resolve, reject) => {
      const chunks = [];
      let redirectCount = 0;
      const maxRedirects = 5;

      function makeRequest(currentUrl) {
        if (redirectCount > maxRedirects) {
          reject(new Error(`Too many redirects (${redirectCount})`));
          return;
        }

        console.log(`[PROXY] Request ${redirectCount + 1}: ${currentUrl}`);

        https
          .get(currentUrl, { 
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }, (res) => {
            console.log(`[PROXY] Response status: ${res.statusCode}`);
            console.log(`[PROXY] Response headers:`, Object.keys(res.headers));

            // リダイレクトハンドリング
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              redirectCount++;
              console.log(`[PROXY] Redirect ${redirectCount} to:`, res.headers.location);

              const redirectUrl = res.headers.location.startsWith('http')
                ? res.headers.location
                : new URL(res.headers.location, currentUrl).toString();
              
              return makeRequest(redirectUrl);
            }

            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
              return;
            }

            console.log(`[PROXY] Content-Type: ${res.headers['content-type']}`);
            console.log(`[PROXY] Content-Length: ${res.headers['content-length']}`);

            res.on('data', (chunk) => {
              chunks.push(chunk);
              console.log(`[PROXY] Received chunk: ${chunk.length} bytes`);
            });

            res.on('end', () => {
              const buffer = Buffer.concat(chunks);
              console.log(`[PROXY] Total size: ${buffer.length} bytes`);
              resolve({
                data: buffer,
                contentType: res.headers['content-type'] || 'application/octet-stream'
              });
            });

            res.on('error', reject);
          })
          .on('error', reject);
      }

      makeRequest(decodedUrl);
    });

    // Base64 エンコード
    const base64 = fileData.data.toString('base64');
    console.log(`[PROXY] Base64 size: ${base64.length} bytes`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': fileData.contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
        'Cache-Control': 'public, max-age=31536000',
        'Content-Disposition': 'inline'
      },
      isBase64Encoded: true,
      body: base64
    };
  } catch (error) {
    console.error('[PROXY] Error:', error.message);
    console.error('[PROXY] Stack:', error.stack);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: error.message,
        type: error.constructor.name 
      })
    };
  }
};
/**
 * netlify/functions/proxy-download.js
 * ★ GitHub からのファイルダウンロードをプロキシ
 * mp4、画像、PDFなどをサイト内で再生・表示するために必要
 */

const https = require('https');
const url = require('url');

function proxyDownload(downloadUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(downloadUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Avfile-Proxy/1.0',
          'Accept': '*/*',
        },
        timeout: 30000  // 30秒タイムアウト
      };

      console.log('[PROXY] Downloading from:', parsedUrl.hostname + parsedUrl.pathname);

      const req = https.request(options, (res) => {
        const buffers = [];
        
        console.log('[PROXY] Response status:', res.statusCode);
        
        res.on('data', (chunk) => {
          buffers.push(chunk);
        });
        
        res.on('end', () => {
          const buffer = Buffer.concat(buffers);
          console.log('[PROXY] Downloaded:', buffer.length, 'bytes');
          
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'] || 'application/octet-stream',
            contentLength: buffer.length,
            buffer: buffer
          });
        });
      });

      req.on('error', (e) => {
        console.error('[PROXY] Request error:', e.message);
        reject(e);
      });

      req.on('timeout', () => {
        console.error('[PROXY] Request timeout');
        req.abort();
        reject(new Error('Download timeout'));
      });

      req.end();
    } catch (e) {
      console.error('[PROXY] Parse error:', e.message);
      reject(e);
    }
  });
}

exports.handler = async (event) => {
  try {
    const downloadUrl = event.queryStringParameters?.url;

    console.log('[PROXY] Request received');
    console.log('[PROXY] URL param present:', !!downloadUrl);

    if (!downloadUrl) {
      console.error('[PROXY] Missing url parameter');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing url parameter' })
      };
    }

    console.log('[PROXY] URL to download:', downloadUrl.substring(0, 80) + '...');

    // URLがGitHub Release Assetsか確認
    if (!downloadUrl.includes('github.com') && !downloadUrl.includes('githubusercontent.com')) {
      console.error('[PROXY] Invalid host');
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid host' })
      };
    }

    // ダウンロード実行
    const result = await proxyDownload(downloadUrl);

    if (result.statusCode !== 200) {
      console.error('[PROXY] Download failed with status:', result.statusCode);
      return {
        statusCode: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Download failed', status: result.statusCode })
      };
    }

    // ファイルタイプ判定
    let contentType = result.contentType;
    
    // MIME Type の修正
    if (contentType.includes('video/quicktime')) {
      contentType = 'video/mp4';  // MOVをMP4として扱う
    } else if (contentType.includes('octet-stream')) {
      // 拡張子から判定
      const pathname = new URL(downloadUrl).pathname.toLowerCase();
      if (pathname.endsWith('.mp4')) {
        contentType = 'video/mp4';
      } else if (pathname.endsWith('.mov')) {
        contentType = 'video/mp4';
      } else if (pathname.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (pathname.endsWith('.ogg')) {
        contentType = 'video/ogg';
      } else if (pathname.endsWith('.png')) {
        contentType = 'image/png';
      } else if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (pathname.endsWith('.gif')) {
        contentType = 'image/gif';
      } else if (pathname.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (pathname.endsWith('.pdf')) {
        contentType = 'application/pdf';
      }
    }

    console.log('[PROXY] Content-Type:', contentType);

    // Base64エンコード
    const base64Body = result.buffer.toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': result.contentLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
      },
      isBase64Encoded: true,
      body: base64Body
    };
  } catch (e) {
    console.error('[PROXY] Error:', e.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
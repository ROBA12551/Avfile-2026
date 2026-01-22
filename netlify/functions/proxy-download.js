/**
 * netlify/functions/proxy-download.js
 * ★ GitHub からのファイルダウンロードをプロキシ
 * ★ 大容量ファイル対応（ストリーミング）
 */

const https = require('https');
const url = require('url');

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

    // ★ HEAD リクエストでファイル情報を取得
    const headResult = await proxyHead(downloadUrl);
    console.log('[PROXY] HEAD response:', {
      statusCode: headResult.statusCode,
      contentLength: headResult.contentLength,
      contentType: headResult.contentType
    });

    if (headResult.statusCode !== 200) {
      console.error('[PROXY] HEAD request failed:', headResult.statusCode);
      return {
        statusCode: headResult.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File not found' })
      };
    }

    // ★ 大容量ファイル（> 10MB）の場合は Rangeリクエスト対応
    const contentLength = headResult.contentLength;
    const isLargeFile = contentLength > 10 * 1024 * 1024;  // 10MB以上

    console.log('[PROXY] File size:', contentLength, 'bytes', isLargeFile ? '(LARGE)' : '(small)');

    // Range リクエストが来ている場合
    const rangeHeader = event.headers['range'] || event.headers['Range'];
    if (rangeHeader && isLargeFile) {
      console.log('[PROXY] Range request:', rangeHeader);
      return proxyRange(downloadUrl, contentLength, rangeHeader);
    }

    // ★ 小容量ファイル（<= 10MB）: 全ファイルをメモリに読み込む
    if (contentLength <= 10 * 1024 * 1024) {
      console.log('[PROXY] Small file - loading into memory');
      return proxySmallFile(downloadUrl, headResult.contentType);
    }

    // ★ 大容量ファイル（> 10MB）: Range リクエストを促す
    console.log('[PROXY] Large file - returning 206 Partial Content');
    return proxyRange(downloadUrl, contentLength, 'bytes=0-1048575');  // 最初の1MBのみ

  } catch (e) {
    console.error('[PROXY] Error:', e.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};

/**
 * ★ HEAD リクエストでファイル情報を取得
 */
function proxyHead(downloadUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(downloadUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'Avfile-Proxy/1.0',
        },
        timeout: 10000
      };

      console.log('[PROXY HEAD] Request to:', parsedUrl.hostname + parsedUrl.pathname);

      const req = https.request(options, (res) => {
        console.log('[PROXY HEAD] Status:', res.statusCode);
        console.log('[PROXY HEAD] Headers:', {
          'content-type': res.headers['content-type'],
          'content-length': res.headers['content-length']
        });

        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'] || 'application/octet-stream',
          contentLength: parseInt(res.headers['content-length'] || '0', 10)
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.abort();
        reject(new Error('HEAD request timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * ★ 小容量ファイル（<= 10MB）をメモリに読み込んで返す
 */
function proxySmallFile(downloadUrl, contentType) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(downloadUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Avfile-Proxy/1.0',
        },
        timeout: 30000
      };

      console.log('[PROXY GET] Small file download start');

      const buffers = [];
      let totalSize = 0;

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          console.error('[PROXY GET] Status:', res.statusCode);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          buffers.push(chunk);
          totalSize += chunk.length;
          console.log('[PROXY GET] Downloaded:', totalSize, 'bytes');
        });

        res.on('end', () => {
          const buffer = Buffer.concat(buffers);
          const mimeType = getMimeType(contentType, downloadUrl);
          const base64Body = buffer.toString('base64');

          console.log('[PROXY GET] Complete:', totalSize, 'bytes');

          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': mimeType,
              'Content-Length': totalSize.toString(),
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*',
            },
            isBase64Encoded: true,
            body: base64Body
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.abort();
        reject(new Error('Download timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * ★ 大容量ファイル（> 10MB）: Range リクエスト対応
 */
function proxyRange(downloadUrl, contentLength, rangeHeader) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(downloadUrl);
      const range = parseRange(rangeHeader, contentLength);

      if (!range) {
        reject(new Error('Invalid range'));
        return;
      }

      const [start, end] = range;
      const rangeSize = end - start + 1;

      console.log('[PROXY RANGE] Requested:', start, '-', end, '/', contentLength);

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Avfile-Proxy/1.0',
          'Range': `bytes=${start}-${end}`,
        },
        timeout: 30000
      };

      const buffers = [];
      let totalSize = 0;

      const req = https.request(options, (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          console.error('[PROXY RANGE] Status:', res.statusCode);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        console.log('[PROXY RANGE] Response status:', res.statusCode);
        console.log('[PROXY RANGE] Content-Length:', res.headers['content-length']);

        res.on('data', (chunk) => {
          buffers.push(chunk);
          totalSize += chunk.length;
        });

        res.on('end', () => {
          const buffer = Buffer.concat(buffers);
          const mimeType = getMimeType(res.headers['content-type'] || 'application/octet-stream', downloadUrl);
          const base64Body = buffer.toString('base64');

          console.log('[PROXY RANGE] Downloaded:', totalSize, 'bytes');

          resolve({
            statusCode: res.statusCode === 206 ? 206 : 200,
            headers: {
              'Content-Type': mimeType,
              'Content-Length': totalSize.toString(),
              'Content-Range': res.statusCode === 206 ? `bytes ${start}-${end}/${contentLength}` : undefined,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*',
            },
            isBase64Encoded: true,
            body: base64Body
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.abort();
        reject(new Error('Range request timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * ★ Range ヘッダーをパース
 */
function parseRange(rangeHeader, contentLength) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const range = rangeHeader.slice(6).split('-');
  let start = parseInt(range[0], 10);
  let end = parseInt(range[1], 10);

  if (isNaN(start)) start = 0;
  if (isNaN(end)) end = Math.min(start + 1048576 - 1, contentLength - 1);  // 1MB

  return [start, Math.min(end, contentLength - 1)];
}

/**
 * ★ MIME Type を判定
 */
function getMimeType(contentType, downloadUrl) {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }

  const pathname = new URL(downloadUrl).pathname.toLowerCase();
  
  if (pathname.endsWith('.mp4')) return 'video/mp4';
  if (pathname.endsWith('.mov')) return 'video/mp4';
  if (pathname.endsWith('.webm')) return 'video/webm';
  if (pathname.endsWith('.ogg')) return 'video/ogg';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.pdf')) return 'application/pdf';
  
  return 'application/octet-stream';
}
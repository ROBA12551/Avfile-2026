const https = require('https');
const http = require('http');
const { URL } = require('url');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    console.log('[DOWNLOAD] Requesting:', options.hostname + options.path);

    const req = protocol.request(options, (res) => {
      console.log('[DOWNLOAD] Status:', res.statusCode);
      console.log('[DOWNLOAD] Headers:', res.headers);

      // リダイレクト処理
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log('[DOWNLOAD] Redirect to:', res.headers.location);
        res.destroy();
        makeRequest(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      let totalSize = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        console.log('[DOWNLOAD] Received chunk:', chunk.length, 'bytes, total:', totalSize);
      });

      res.on('end', () => {
        console.log('[DOWNLOAD] Transfer complete, total:', totalSize, 'bytes');
        
        if (totalSize === 0) {
          reject(new Error('Empty response'));
          return;
        }

        const buffer = Buffer.concat(chunks);
        console.log('[DOWNLOAD] Buffer created:', buffer.length, 'bytes');
        
        resolve({
          buffer,
          contentType: res.headers['content-type'] || 'application/octet-stream'
        });
      });
    });

    req.on('error', (err) => {
      console.error('[DOWNLOAD] Request error:', err.message);
      reject(err);
    });

    req.end();
  });
}

exports.handler = async (event) => {
  console.log('[DOWNLOAD] Handler called');
  console.log('[DOWNLOAD] Query:', event.queryStringParameters);

  const downloadUrl = event.queryStringParameters?.url;

  if (!downloadUrl) {
    console.error('[DOWNLOAD] Missing url parameter');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  console.log('[DOWNLOAD] Download URL:', downloadUrl);

  try {
    const { buffer, contentType } = await makeRequest(downloadUrl);
    
    console.log('[DOWNLOAD] Converting to base64');
    const base64 = buffer.toString('base64');
    console.log('[DOWNLOAD] Base64 size:', base64.length);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': base64.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=3600'
      },
      body: base64,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('[DOWNLOAD] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: err.message,
        url: downloadUrl
      })
    };
  }
};
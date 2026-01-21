const https = require('https');

exports.handler = async (event) => {
  console.log('[DOWNLOAD] Request:', event.queryStringParameters);
  
  const downloadUrl = event.queryStringParameters?.url;
  
  if (!downloadUrl) {
    console.error('[DOWNLOAD] Missing url parameter');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  console.log('[DOWNLOAD] Fetching:', downloadUrl);

  return new Promise((resolve) => {
    https.get(downloadUrl, { 
      redirect: 'follow',
      headers: { 'User-Agent': 'Avfile-Download' }
    }, (res) => {
      console.log('[DOWNLOAD] Response status:', res.statusCode);
      console.log('[DOWNLOAD] Content-Type:', res.headers['content-type']);
      
      const chunks = [];
      let totalSize = 0;
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });
      
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('[DOWNLOAD] Received:', totalSize, 'bytes');
        
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': res.headers['content-type'] || 'application/octet-stream',
            'Content-Length': buffer.length.toString(),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, max-age=3600'
          },
          body: buffer.toString('base64'),
          isBase64Encoded: true
        });
      });
    }).on('error', (err) => {
      console.error('[DOWNLOAD] Error:', err.message);
      resolve({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message })
      });
    });
  });
};
const https = require('https');

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-GitHub-Url, X-GitHub-Token, X-GitHub-Method',
      },
      body: '',
    };
  }

  try {
    console.log('[PROXY] ========== START ==========');
    
    // ★ ヘッダーから情報を取得
    const githubUrl = event.headers['x-github-url'] || event.headers['X-GitHub-Url'];
    const githubToken = event.headers['x-github-token'] || event.headers['X-GitHub-Token'];
    const githubMethod = event.headers['x-github-method'] || event.headers['X-GitHub-Method'] || 'POST';
    
    console.log('[PROXY] URL:', githubUrl ? githubUrl.substring(0, 100) + '...' : 'missing');
    console.log('[PROXY] Method:', githubMethod);
    console.log('[PROXY] Token present:', !!githubToken);
    console.log('[PROXY] Body present:', !!event.body);
    console.log('[PROXY] isBase64Encoded:', event.isBase64Encoded);

    if (!githubUrl || !githubToken) {
      throw new Error('Missing required headers: X-GitHub-Url, X-GitHub-Token');
    }

    // ★ バイナリデータを Buffer に変換
    let bodyBuffer;
    if (event.body) {
      if (event.isBase64Encoded) {
        bodyBuffer = Buffer.from(event.body, 'base64');
        console.log('[PROXY] Decoded from base64:', (bodyBuffer.length / 1024 / 1024).toFixed(2), 'MB');
      } else {
        bodyBuffer = Buffer.from(event.body, 'binary');
        console.log('[PROXY] Binary data:', (bodyBuffer.length / 1024 / 1024).toFixed(2), 'MB');
      }
    } else {
      bodyBuffer = Buffer.alloc(0);
    }

    console.log('[PROXY] Final buffer size:', (bodyBuffer.length / 1024 / 1024).toFixed(2), 'MB');

    // ★ URL をパース
    const parsedUrl = new URL(githubUrl);

    console.log('[PROXY] Uploading to GitHub...');
    console.log('[PROXY] Host:', parsedUrl.hostname);
    console.log('[PROXY] Path:', parsedUrl.pathname.substring(0, 50) + '...');

    // ★ GitHub に直接リクエスト
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: githubMethod,
        headers: {
          'Authorization': `token ${githubToken}`,
          'User-Agent': 'Avfile-Proxy',
          'Content-Type': 'application/octet-stream',
          'Content-Length': bodyBuffer.length,
        },
        timeout: 180000, // 3分
      };

      console.log('[PROXY] Request headers:', JSON.stringify(options.headers, null, 2));

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          console.log('[PROXY] GitHub response status:', res.statusCode);
          console.log('[PROXY] Response data length:', data.length);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              console.log('[PROXY] Success - Asset ID:', parsed.id);
              resolve(parsed);
            } catch (e) {
              console.log('[PROXY] Non-JSON response');
              resolve({ raw: data });
            }
          } else {
            console.error('[PROXY] GitHub API error:', res.statusCode);
            console.error('[PROXY] Error data:', data.substring(0, 500));
            reject(new Error(`GitHub API error: ${res.statusCode} - ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        console.error('[PROXY] Request error:', err.message);
        reject(err);
      });

      req.on('timeout', () => {
        console.error('[PROXY] Request timeout');
        req.destroy();
        reject(new Error('Request timeout (180s)'));
      });

      // ★ バイナリデータを書き込み
      if (bodyBuffer && bodyBuffer.length > 0) {
        console.log('[PROXY] Writing binary data...');
        req.write(bodyBuffer);
      }
      
      req.end();
      console.log('[PROXY] Request sent');
    });

    console.log('[PROXY] ========== SUCCESS ==========');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: result,
      }),
    };

  } catch (error) {
    console.error('[PROXY] ========== ERROR ==========');
    console.error('[PROXY] Error message:', error.message);
    console.error('[PROXY] Stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
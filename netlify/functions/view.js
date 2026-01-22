/**
 * netlify/functions/view.js
 * ★ 複数ファイルID対応版
 * 
 * 用途: ファイル情報をID（複数対応）から取得
 * 
 * 使用例:
 * GET /.netlify/functions/view?id=f_abc123
 * GET /.netlify/functions/view?id=f_abc123,f_def456,f_ghi789
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const INDEX_PATH = 'github.index.json';
const SHARD_PREFIX = 'github.';
const SHARD_SUFFIX = '.json';

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function githubApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : {};
        } catch {}

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json || {});
        } else {
          const msg = (json && json.message) ? json.message : data;
          reject(new Error(`GitHub API Error ${res.statusCode}: ${msg}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getContent(pathInRepo) {
  const res = await githubApi(
    'GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(pathInRepo)}`
  );

  const text = res?.content
    ? Buffer.from(res.content, 'base64').toString('utf8')
    : '';

  return {
    sha: res?.sha || null,
    text,
    json: text ? safeJsonParse(text, null) : null,
  };
}

/**
 * ★ 複数IDからファイル情報を検索
 */
async function findFilesById(fileIds) {
  console.log('[VIEW] Searching for files:', fileIds);

  try {
    // インデックスを取得
    const { json: indexData } = await getContent(INDEX_PATH);
    
    if (!indexData || !Array.isArray(indexData.shards)) {
      console.log('[VIEW] No index found');
      return [];
    }

    const shards = indexData.shards || [];
    const foundFiles = [];

    // ★ 各シャードから対象ファイルを検索
    for (const shard of shards) {
      try {
        const { json: shardData } = await getContent(shard.path);
        
        if (!Array.isArray(shardData)) {
          console.warn('[VIEW] Shard is not an array:', shard.path);
          continue;
        }

        // ★ シャード内の各ファイルをチェック
        for (const file of shardData) {
          if (file && file.fileId && fileIds.includes(file.fileId)) {
            console.log('[VIEW] Found file:', file.fileId, file.fileName);
            foundFiles.push(file);
          }
        }
      } catch (e) {
        console.warn('[VIEW] Error reading shard', shard.path, ':', e.message);
        continue;
      }
    }

    console.log('[VIEW] Total files found:', foundFiles.length);
    return foundFiles;
  } catch (e) {
    console.error('[VIEW] Error searching files:', e.message);
    throw e;
  }
}

/**
 * ★ パスワード検証
 */
function validatePassword(filePasswordHash, providedHash) {
  if (!filePasswordHash) {
    // パスワル保護なし
    return { valid: true, message: 'OK' };
  }

  if (!providedHash) {
    // パスワル要求
    return { valid: false, message: 'Password required' };
  }

  if (filePasswordHash === providedHash) {
    // パスワル正解
    return { valid: true, message: 'OK' };
  }

  // パスワル不正
  return { valid: false, message: 'Invalid password' };
}

/**
 * ★ メインハンドラー
 */
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Server not configured' })
      };
    }

    // ★ クエリパラメータを解析
    const url = new URL(event.rawUrl || `http://localhost${event.rawPath || ''}`);
    const idParam = url.searchParams.get('id');
    const pwdParam = url.searchParams.get('pwd');

    console.log('[VIEW] Request - id:', idParam, 'pwd:', pwdParam ? '***' : 'none');

    if (!idParam) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing id parameter' })
      };
    }

    // ★ コンマ区切りIDをサポート
    const fileIds = idParam
      .split(',')
      .map(id => id.trim().toLowerCase())
      .filter(id => id.length > 0);

    console.log('[VIEW] Parsed file IDs:', fileIds);

    // ★ ファイルを検索
    const files = await findFilesById(fileIds);

    if (files.length === 0) {
      console.warn('[VIEW] No files found for IDs:', fileIds);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Files not found' })
      };
    }

    // ★ パスワル保護をチェック（複数ファイル対応）
    const filesWithPasswordCheck = files.map(file => {
      if (file.passwordHash) {
        // ★ パスワル保護あり
        const validation = validatePassword(file.passwordHash, pwdParam);
        
        if (!validation.valid) {
          console.log('[VIEW] Password check failed for', file.fileId, ':', validation.message);
          return { ...file, passwordError: validation.message };
        }
        
        console.log('[VIEW] Password validated for', file.fileId);
      }
      
      return file;
    });

    // ★ パスワル要求が必要かチェック
    const needsPassword = filesWithPasswordCheck.some(f => f.passwordError === 'Password required');
    
    if (needsPassword) {
      console.log('[VIEW] Password required for one or more files');
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Password required',
          requiresPassword: true,
          message: 'One or more files are password protected'
        })
      };
    }

    // ★ パスワル不正がないかチェック
    const invalidPassword = filesWithPasswordCheck.find(f => f.passwordError === 'Invalid password');
    
    if (invalidPassword) {
      console.log('[VIEW] Invalid password for', invalidPassword.fileId);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid password',
          requiresPassword: true,
          message: 'Invalid password for file: ' + invalidPassword.fileName
        })
      };
    }

    // ★ パスワル情報を削除（セキュリティ）
    const cleanFiles = filesWithPasswordCheck.map(f => {
      const { passwordHash, passwordError, ...clean } = f;
      return clean;
    });

    console.log('[VIEW] Returning', cleanFiles.length, 'files');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        files: cleanFiles
      })
    };
  } catch (e) {
    console.error('[VIEW] Error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
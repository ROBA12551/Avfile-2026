/**
 * netlify/functions/view.js
 * ★ 統合版 - グループID・単一ファイルID・パスワル保護対応
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const INDEX_PATH = 'github.index.json';
const GROUPS_PATH = 'groups.json';
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

// ===================== Group Management =====================
async function getGroupFileIds(groupId) {
  try {
    console.log('[GROUP] Fetching group:', groupId);

    const { json: groups } = await getContent(GROUPS_PATH);
    
    if (!Array.isArray(groups)) {
      console.warn('[GROUP] Groups file is not an array');
      return null;
    }

    const group = groups.find(g => g && g.groupId === groupId);
    
    if (!group) {
      console.warn('[GROUP] Group not found:', groupId);
      return null;
    }

    console.log('[GROUP] Found group with', group.fileIds.length, 'files');
    return group;
  } catch (e) {
    console.warn('[GROUP] Error fetching group:', e.message);
    return null;
  }
}

// ===================== File Search =====================
async function findFilesById(fileIds) {
  console.log('[VIEW] Searching for files:', fileIds);

  try {
    const { json: indexData } = await getContent(INDEX_PATH);
    
    if (!indexData || !Array.isArray(indexData.shards)) {
      console.log('[VIEW] No index found');
      return [];
    }

    const shards = indexData.shards || [];
    const foundFilesMap = new Map();  // ★ Mapを使って順序を保持

    // Search through all shards
    for (const shard of shards) {
      try {
        const { json: shardData } = await getContent(shard.path);
        
        if (!Array.isArray(shardData)) {
          console.warn('[VIEW] Shard is not an array:', shard.path);
          continue;
        }

        console.log('[VIEW] Searching shard:', shard.path, 'items:', shardData.length);

        // Check each file in shard
        for (const file of shardData) {
          if (file && file.fileId && fileIds.includes(file.fileId)) {
            console.log('[VIEW] Found file:', file.fileId, file.fileName, 'downloadUrl:', file.downloadUrl?.substring(0, 50) + '...');
            foundFilesMap.set(file.fileId, file);  // ★ Mapに保存
          }
        }
      } catch (e) {
        console.warn('[VIEW] Error reading shard', shard.path, ':', e.message);
        continue;
      }
    }

    // ★ 元の順序を保持してファイルを取得
    const foundFiles = [];
    for (const fileId of fileIds) {
      if (foundFilesMap.has(fileId)) {
        const file = foundFilesMap.get(fileId);
        console.log('[VIEW] Adding file to results:', fileId, '-', file.fileName);
        foundFiles.push(file);
      } else {
        console.warn('[VIEW] File not found in any shard:', fileId);
      }
    }

    console.log('[VIEW] Total files found:', foundFiles.length, 'requested:', fileIds.length);
    
    // ★ 重要: 返すファイルの順序とダウンロードURLを確認
    foundFiles.forEach((f, idx) => {
      console.log(`[VIEW] Result[${idx}]:`, {
        fileId: f.fileId,
        fileName: f.fileName,
        downloadUrl: f.downloadUrl?.substring(0, 60) + '...'
      });
    });

    return foundFiles;
  } catch (e) {
    console.error('[VIEW] Error searching files:', e.message);
    throw e;
  }
}

// ===================== Password Validation =====================
function validatePassword(filePasswordHash, providedHash) {
  if (!filePasswordHash) {
    return { valid: true, message: 'OK' };
  }

  if (!providedHash) {
    return { valid: false, message: 'Password required' };
  }

  if (filePasswordHash === providedHash) {
    return { valid: true, message: 'OK' };
  }

  return { valid: false, message: 'Invalid password' };
}

// ===================== Main Handler =====================
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

    // ===================== Handle Group ID (g_xxxxx) =====================
    let fileIds = [];

    if (idParam.startsWith('g_')) {
      console.log('[VIEW] Processing group ID:', idParam);
      const group = await getGroupFileIds(idParam);

      if (!group) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Group not found' })
        };
      }

      fileIds = group.fileIds;
      console.log('[VIEW] Group contains', fileIds.length, 'files');

      // Check group-level password protection
      if (group.passwordHash) {
        const validation = validatePassword(group.passwordHash, pwdParam);
        
        if (!validation.valid && validation.message === 'Password required') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Password required',
              requiresPassword: true,
              message: 'This file group is password protected'
            })
          };
        }

        if (!validation.valid && validation.message === 'Invalid password') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Invalid password',
              requiresPassword: true,
              message: 'Invalid password'
            })
          };
        }
      }
    } else {
      // Handle single file ID (f_xxxxx) or comma-separated IDs
      if (idParam.includes(',')) {
        fileIds = idParam.split(',').map(id => id.trim().toLowerCase()).filter(id => id.length > 0);
      } else {
        fileIds = [idParam.toLowerCase()];
      }

      console.log('[VIEW] Processing', fileIds.length, 'file ID(s)');
    }

    // ===================== Retrieve Files =====================
    const files = await findFilesById(fileIds);

    if (files.length === 0) {
      console.warn('[VIEW] No files found for IDs:', fileIds);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Files not found' })
      };
    }

    // ===================== Validate Passwords =====================
    const filesWithPasswordCheck = files.map(file => {
      if (file.passwordHash && !idParam.startsWith('g_')) {
        const validation = validatePassword(file.passwordHash, pwdParam);
        
        if (!validation.valid) {
          return { ...file, passwordError: validation.message };
        }
      }
      
      return file;
    });

    // Check for required passwords
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

    // Check for invalid passwords
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
          message: 'Invalid password'
        })
      };
    }

    // ===================== Clean and Return =====================
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
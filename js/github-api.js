class GitHubUploader {
  constructor() {
    this.functionUrl = '/.netlify/functions/github-upload';
  }

  /**
   * ファイル名をサニタイズ（iOS対応）
   */
  sanitizeFileName(fileName) {
    try {
      if (!fileName || typeof fileName !== 'string') {
        return 'file';
      }

      let sanitized = String(fileName)
        .trim()
        .replace(/^\.+/, '') // 先頭のドットを削除
        .replace(/[\x00-\x1f<>:"\\/|?*]/g, '_') // 制御文字と危険な文字を削除
        .replace(/\s+/g, '_') // スペースをアンダースコアに
        .replace(/_+/g, '_') // 連続したアンダースコアを1つに
        .replace(/^_+|_+$/g, ''); // 前後のアンダースコアを削除

      // 拡張子の処理
      const parts = sanitized.split('.');
      if (parts.length > 1) {
        const ext = parts[parts.length - 1].toLowerCase();
        if (ext.length > 10 || ext.length === 0) {
          sanitized = parts.slice(0, -1).join('.');
        }
      }

      // 長さ制限
      if (sanitized.length > 200) {
        sanitized = sanitized.substring(0, 200);
      }

      // 空文字列チェック
      if (!sanitized || sanitized === '.' || sanitized === '_') {
        sanitized = 'file';
      }

      console.log('[SANITIZE] Original:', fileName, '→ Sanitized:', sanitized);
      return sanitized;
    } catch (e) {
      console.error('[SANITIZE] Error:', e.message);
      return 'file';
    }
  }

  /**
   * Release を作成
   */
  async createRelease(releaseTag, fileName, description) {
    try {
      // ★ 修正: ファイル名をサニタイズ
      const sanitizedFileName = this.sanitizeFileName(fileName);

      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-release',
          releaseTag: releaseTag,
          metadata: {
            title: sanitizedFileName,
            description: description,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Release creation failed: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Release creation failed');
      }

      console.log('✅ Release created:', data.data.release_id);
      return data.data;
    } catch (error) {
      console.error('❌ Release creation error:', error.message);
      throw error;
    }
  }

  /**
   * Asset（ファイル）をアップロード - iOS対応版
   */
  async uploadAsset(uploadUrl, fileName, base64Data) {
    try {
      // ★ 修正: ファイル名をサニタイズ
      const sanitizedFileName = this.sanitizeFileName(fileName);

      console.log('[UPLOAD_ASSET] Original fileName:', fileName);
      console.log('[UPLOAD_ASSET] Sanitized fileName:', sanitizedFileName);
      console.log('[UPLOAD_ASSET] Base64 length:', base64Data ? base64Data.length : 0);

      // ★ 修正: base64Data のバリデーション
      if (!base64Data || typeof base64Data !== 'string') {
        throw new Error('Invalid base64 data provided');
      }

      // ★ 修正: uploadUrl のバリデーション
      if (!uploadUrl || typeof uploadUrl !== 'string') {
        throw new Error('Invalid uploadUrl provided');
      }

      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-asset',
          uploadUrl: uploadUrl,
          fileName: sanitizedFileName,  // ★ サニタイズされたファイル名を使用
          fileBase64: base64Data,
          fileId: 'auto',  // サーバー側で生成
          fileSize: base64Data.length * 0.75, // Base64は25%大きいため
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Asset upload failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Asset upload failed');
      }

      console.log('✅ Asset uploaded:', data.data.asset_id);
      return data.data;
    } catch (error) {
      console.error('❌ Asset upload error:', error.message);
      throw error;
    }
  }

  /**
   * Release を Tag で取得
   */
  async getReleaseByTag(releaseTag) {
    try {
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-release-by-tag',
          releaseTag: releaseTag,
        }),
      });

      if (!response.ok) {
        console.warn('⚠️ Release not found');
        return null;
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('⚠️ Failed to get release');
        return null;
      }

      return data.data;
    } catch (error) {
      console.error('❌ Error:', error.message);
      return null;
    }
  }

  /**
   * View を作成
   */
  async createView(fileIds, passwordHash, origin) {
    try {
      // ★ 修正: fileIds のバリデーション
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        throw new Error('fileIds must be a non-empty array');
      }

      console.log('[CREATE_VIEW] fileIds:', fileIds);

      const res = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-view',
          fileIds: fileIds,
          passwordHash: passwordHash || null,
          origin: origin || window.location.origin
        })
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`createView failed: ${res.status} ${t}`);
      }

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'createView failed');
      }

      console.log('✅ View created:', json.data.viewId);
      return json.data;
    } catch (error) {
      console.error('❌ createView error:', error.message);
      throw error;
    }
  }

  /**
   * github.json を取得 - 完全版
   */
  async getGithubJson() {
    try {
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-github-json',
        }),
      });

      if (!response.ok) {
        console.warn('⚠️ github.json not found - will create new one');
        return {
          success: true,
          data: {
            files: [],
            views: [],
            lastUpdated: new Date().toISOString()
          }
        };
      }

      const data = await response.json();
      
      // ★ 修正: レスポンス形式を複数パターン対応
      if (data.success && data.data) {
        console.log('[GET_JSON] Success response received');
        return data;
      } else if (data.files !== undefined) {
        // 古い形式のレスポンス
        console.log('[GET_JSON] Legacy response format');
        return {
          success: true,
          data: data
        };
      } else {
        console.warn('⚠️ github.json retrieval failed - unknown format');
        return {
          success: true,
          data: {
            files: [],
            views: [],
            lastUpdated: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      console.warn('⚠️ Error retrieving github.json:', error.message);
      return {
        success: true,
        data: {
          files: [],
          views: [],
          lastUpdated: new Date().toISOString()
        }
      };
    }
  }

  /**
   * github.json を保存
   */
  async saveGithubJson(jsonData) {
    try {
      // ★ 修正: jsonData のバリデーション
      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('Invalid jsonData: must be an object');
      }

      // ★ 修正: jsonData の構造を確認
      if (!jsonData.files) {
        jsonData.files = [];
      }
      if (!jsonData.views) {
        jsonData.views = [];
      }
      jsonData.lastUpdated = new Date().toISOString();

      console.log('[SAVE_JSON] Saving:', {
        files: jsonData.files.length,
        views: jsonData.views.length
      });

      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-github-json',
          jsonData: jsonData,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`github.json save failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'github.json save failed');
      }

      console.log('✅ github.json saved');
      return data.data;
    } catch (error) {
      console.error('❌ github.json save error:', error.message);
      throw error;
    }
  }
}

// グローバルエクスポート
window.GitHubUploader = GitHubUploader;
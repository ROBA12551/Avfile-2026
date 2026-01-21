/**
 * js/github-api.js
 * 
 * Netlify Function 経由で GitHub Releases にアップロード
 */

class GitHubUploader {
  constructor() {
    this.functionUrl = '/.netlify/functions/github-upload';
  }

  /**
   * Release を作成
   */
  async createRelease(releaseTag, fileName, description) {
    try {
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-release',
          releaseTag: releaseTag,
          metadata: {
            title: fileName,
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
   * Asset（ファイル）をアップロード
   */
  async uploadAsset(uploadUrl, fileName, base64Data) {
    try {
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-asset',
          uploadUrl: uploadUrl,
          fileName: fileName,
          fileBase64: base64Data,
        }),
      });

      if (!response.ok) {
        throw new Error(`Asset upload failed: ${response.statusText}`);
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
   * github.json を取得
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
        return { files: [], lastUpdated: new Date().toISOString() };
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('⚠️ github.json retrieval failed');
        return { files: [], lastUpdated: new Date().toISOString() };
      }

      return data.data;
    } catch (error) {
      console.warn('⚠️ Error retrieving github.json:', error.message);
      return { files: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * github.json を保存
   */
  async saveGithubJson(jsonData) {
    try {
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-github-json',
          jsonData: jsonData,
        }),
      });

      if (!response.ok) {
        throw new Error(`github.json save failed: ${response.statusText}`);
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
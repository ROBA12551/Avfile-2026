/**
 * js/simple-upload.js
 * 
 * Gofile 風ファイル共有サービス
 * - 動画を 702p 30fps に圧縮
 * - GitHub Releases に保存
 * - CDN URL で視聴可能
 */

class SimpleUploadManager {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: 'https://api.github.com',
      requestTimeout: 30000,
      ...config,
    };
  }

  /**
   * ファイルを Base64 に変換
   */
  async fileToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * UUID を生成
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 動画ファイルか判定
   */
  isVideoFile(file) {
    const videoMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
    ];
    return videoMimes.some(mime => file.type.startsWith(mime));
  }

  /**
   * ファイルをアップロード
   */
  async uploadFile(fileBlob, fileName, onProgress = () => {}) {
    try {
      // onProgress がない場合のデフォルト
      if (typeof onProgress !== 'function') {
        onProgress = (progress, message) => {
          console.log(`[${progress}%] ${message}`);
        };
      }

      const fileId = this.generateUUID();
      
      onProgress(5, '⏳ 準備中...');

      // 動画ファイルを圧縮
      let processedBlob = fileBlob;
      if (this.isVideoFile(fileBlob)) {
        console.log('🎥 動画ファイルを検出 - 圧縮開始...');
        
        if (window.VideoCompressionEngine) {
          const compressor = new window.VideoCompressionEngine();
          processedBlob = await compressor.compress(fileBlob, (progress, message) => {
            // 圧縮進捗を反映（5-30%）
            onProgress(5 + (progress * 0.5), message);
          });
          
          const originalMB = (fileBlob.size / 1024 / 1024).toFixed(1);
          const compressedMB = (processedBlob.size / 1024 / 1024).toFixed(1);
          const ratio = ((1 - processedBlob.size / fileBlob.size) * 100).toFixed(0);
          console.log(`📊 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);
        } else {
          console.warn('⚠️ 圧縮エンジンが利用できません');
        }
      }

      onProgress(30, '📤 Base64 エンコード中...');

      // Base64 にエンコード
      const base64 = await this.fileToBase64(processedBlob);

      onProgress(40, '☁️ GitHub にアップロード中...');

      // GitHub Releases にアップロード
      const uploadResult = await this.uploadToGitHubReleases(
        fileId, 
        fileName, 
        base64, 
        processedBlob.type,
        (progress, message) => {
          // GitHub アップロード進捗を反映（40-70%）
          onProgress(40 + (progress * 0.3), message);
        }
      );

      onProgress(75, '🔗 共有リンク生成中...');

      // 共有情報を localStorage に保存
      this.saveShareLink(fileId, fileName, uploadResult);

      onProgress(90, '✨ 最後の処理中...');

      // 視聴可能な URL を生成
      const viewUrl = `${window.location.origin}/?id=${fileId}`;

      onProgress(100, '✅ アップロード完了！');

      console.log('✅ ファイルがアップロードされました');
      console.log('📺 視聴URL:', viewUrl);
      console.log('📥 ダウンロードURL:', uploadResult.download_url);

      return {
        success: true,
        fileName: fileName,
        fileId: fileId,
        viewUrl: viewUrl,
        downloadUrl: uploadResult.download_url,
        fileSize: processedBlob.size,
        githubUrl: uploadResult.html_url,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ アップロードエラー:', error.message);
      throw new Error(`ファイルアップロード失敗: ${error.message}`);
    }
  }

  /**
   * GitHub Releases にアップロード
   */
  async uploadToGitHubReleases(fileId, fileName, base64, fileType, onProgress) {
    try {
      const releaseTag = `file_${fileId}`;
      const assetFileName = `${fileId}.${this.getFileExtension(fileType)}`;

      onProgress(10, '📝 Release を作成中...');

      // 1. Release を作成
      const createReleaseResponse = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-release',
          releaseTag: releaseTag,
          metadata: {
            title: `Upload: ${fileName}`,
            description: `
File ID: ${fileId}
Original Name: ${fileName}
Type: ${fileType}
Uploaded: ${new Date().toISOString()}
            `.trim(),
          },
        }),
      });

      if (!createReleaseResponse.ok) {
        throw new Error(`Release 作成失敗: ${createReleaseResponse.statusText}`);
      }

      const createData = await createReleaseResponse.json();
      if (!createData.success) {
        throw new Error(createData.error || 'Release 作成失敗');
      }

      console.log('✅ Release 作成:', createData.data.release_id);

      onProgress(40, '📤 ファイルをアップロード中...');

      // 2. Asset（ファイル）をアップロード
      const uploadAssetResponse = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-asset',
          uploadUrl: createData.data.upload_url,
          fileName: assetFileName,
          fileBase64: base64,
        }),
      });

      if (!uploadAssetResponse.ok) {
        throw new Error(`ファイルアップロード失敗: ${uploadAssetResponse.statusText}`);
      }

      const uploadData = await uploadAssetResponse.json();
      if (!uploadData.success) {
        throw new Error(uploadData.error || 'ファイルアップロード失敗');
      }

      console.log('✅ ファイルアップロード:', uploadData.data.asset_id);

      onProgress(100, '✨ 完了');

      return {
        release_id: createData.data.release_id,
        asset_id: uploadData.data.asset_id,
        download_url: uploadData.data.download_url,
        html_url: createData.data.html_url,
      };
    } catch (error) {
      console.error('❌ GitHub アップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * ファイルタイプから拡張子を取得
   */
  getFileExtension(fileType) {
    const extensionMap = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogg',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    };
    return extensionMap[fileType] || 'bin';
  }

  /**
   * 共有リンク情報を localStorage に保存
   */
  saveShareLink(fileId, fileName, uploadResult) {
    try {
      let shareLinks = JSON.parse(localStorage.getItem('avfile_shares') || '[]');
      
      shareLinks.push({
        fileId: fileId,
        fileName: fileName,
        downloadUrl: uploadResult.download_url,
        githubUrl: uploadResult.html_url,
        uploadedAt: new Date().toISOString(),
      });

      // 最新 50 件のみ保持
      shareLinks = shareLinks.slice(-50);
      localStorage.setItem('avfile_shares', JSON.stringify(shareLinks));
      
      console.log('✅ 共有リンクを保存');
    } catch (error) {
      console.warn('⚠️ 共有リンク保存失敗:', error.message);
    }
  }

  /**
   * GitHub から共有ファイルを取得
   */
  async getSharedFile(fileId) {
    try {
      console.log('📥 ファイルを取得中...');

      const releaseTag = `file_${fileId}`;
      
      // Netlify Function 経由で Release 情報を取得
      const response = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-release-by-tag',
          releaseTag: releaseTag,
        }),
      });

      if (!response.ok) {
        console.warn('⚠️ ファイルが見つかりません');
        return null;
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('⚠️ エラー:', data.error);
        return null;
      }

      const releaseData = data.data;
      if (!releaseData.assets || releaseData.assets.length === 0) {
        console.warn('⚠️ ファイルが見つかりません');
        return null;
      }

      const asset = releaseData.assets[0];

      const fileInfo = {
        fileId: fileId,
        fileName: asset.name,
        downloadUrl: asset.download_url,
        githubUrl: releaseData.html_url,
        size: asset.size,
        uploadedAt: releaseData.created_at,
      };

      console.log('✅ ファイル取得完了:', fileInfo.fileName);
      return fileInfo;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      return null;
    }
  }

  /**
   * 共有履歴を取得
   */
  getShareHistory() {
    try {
      return JSON.parse(localStorage.getItem('avfile_shares') || '[]');
    } catch (error) {
      console.warn('⚠️ 共有履歴取得失敗');
      return [];
    }
  }

  /**
   * 共有リンクをクリップボードにコピー
   */
  copyToClipboard(text) {
    return new Promise((resolve, reject) => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text)
          .then(() => {
            console.log('✅ コピー完了');
            resolve();
          })
          .catch(reject);
      } else {
        // フォールバック
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        console.log('✅ コピー完了');
        resolve();
      }
    });
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;
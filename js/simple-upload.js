class SimpleUploadManager {
  constructor() {
    this.githubUploader = new window.GitHubUploader();
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
   * ファイル拡張子を取得
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
   * ファイルをアップロード - 本番用のみ
   */
  async uploadFile(fileBlob, fileName, onProgress = () => {}) {
    try {
      if (typeof onProgress !== 'function') {
        onProgress = (progress, message) => console.log(`[${progress}%] ${message}`);
      }

      const fileId = this.generateUUID();
      onProgress(2, '⏳ 準備中...');

      // 動画ファイルのみ圧縮
      let processedBlob = fileBlob;
      let wasCompressed = false;

      // ★ 修正: モバイルデバイス判定を追加
      const isMobile = this.isMobileDevice();
      console.log('[UPLOAD] isMobile:', isMobile);

      if (this.isVideoFile(fileBlob) && !isMobile) {
        console.log('🎥 動画ファイルを検出 - 720p 30fps に圧縮開始...');
        
        if (window.VideoCompressionEngine) {
          try {
            const compressor = new window.VideoCompressionEngine();
            processedBlob = await compressor.compress(fileBlob, (progress, message) => {
              onProgress(2 + (progress * 0.33), message);
            });
            
            wasCompressed = true;
            const originalMB = (fileBlob.size / 1024 / 1024).toFixed(1);
            const compressedMB = (processedBlob.size / 1024 / 1024).toFixed(1);
            const ratio = ((1 - processedBlob.size / fileBlob.size) * 100).toFixed(0);
            console.log(`📊 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);
          } catch (error) {
            console.warn('⚠️ 圧縮失敗 - FFmpeg のロードに問題があります');
            console.warn('ℹ️ エラー詳細:', error.message);
            console.warn('ℹ️ ネットワーク接続を確認し、再度アップロードしてください');
            console.warn('ℹ️ オリジナルファイルでアップロードを続行します');
            wasCompressed = false;
          }
        } else {
          console.warn('⚠️ 圧縮エンジンが利用できません - スクリプトのロードを確認してください');
          wasCompressed = false;
        }
      } else if (this.isVideoFile(fileBlob) && isMobile) {
        console.log('📱 モバイルデバイス検出 - 圧縮処理をスキップします');
      }

      onProgress(40, '📤 Base64 エンコード中...');
      const base64 = await this.fileToBase64(processedBlob);

      onProgress(45, '☁️ GitHub にアップロード中...');

      // Release を作成
      const releaseTag = `file_${fileId}`;
      const fileExtension = this.getFileExtension(processedBlob.type);
      const assetFileName = `${fileName.substring(0, fileName.lastIndexOf('.') || fileName.length)}.${fileExtension}`;

      const releaseData = await this.githubUploader.createRelease(
        releaseTag,
        fileName,
        `File ID: ${fileId}\nOriginal Name: ${fileName}\nType: ${processedBlob.type}\nUploaded: ${new Date().toISOString()}\nCompressed: ${wasCompressed ? 'Yes' : 'No'}`
      );

      onProgress(65, '📤 ファイルをアップロード中...');

      // Asset をアップロード
      const assetData = await this.githubUploader.uploadAsset(
        releaseData.upload_url,
        assetFileName,
        base64
      );

      onProgress(80, '📝 アップロード情報を記録中...');

      // ★ 修正: 完全なバリデーションとエラーハンドリング
      let githubJson = null;
      try {
        const res = await this.githubUploader.getGithubJson();
        
        console.log('[UPLOAD] getGithubJson response:', res);
        
        // ★ 修正: レスポンス形式を複数パターン対応
        if (res && res.data) {
          githubJson = res.data;
        } else if (res && res.files !== undefined) {
          githubJson = res;
        } else {
          throw new Error('Invalid response format from getGithubJson');
        }

        // ★ 修正: githubJson が null/undefined の場合の対応
        if (!githubJson || typeof githubJson !== 'object') {
          throw new Error('githubJson is not an object');
        }

        // ★ 修正: files 配列の安全な初期化
        if (!Array.isArray(githubJson.files)) {
          console.warn('[UPLOAD] files is not an array, reinitializing');
          githubJson.files = [];
        }

      } catch (error) {
        console.error('[UPLOAD] Error fetching github.json:', error.message);
        throw new Error(`Failed to fetch github.json: ${error.message}`);
      }

      // ★ 修正: ファイル情報の追加
      try {
        const fileInfo = {
          fileId: fileId,
          fileName: fileName,
          downloadUrl: assetData.download_url,
          githubReleaseUrl: releaseData.html_url,
          fileSize: processedBlob.size,
          originalSize: fileBlob.size,
          compressed: wasCompressed,
          uploadedAt: new Date().toISOString(),
          releaseTag: releaseTag,
          assetId: assetData.asset_id,
        };

        console.log('[UPLOAD] Adding file info:', fileInfo);
        githubJson.files.push(fileInfo);
        githubJson.lastUpdated = new Date().toISOString();

        // ★ 修正: saveGithubJson の呼び出し
        await this.githubUploader.saveGithubJson(githubJson);
        console.log('[UPLOAD] github.json saved successfully');

      } catch (error) {
        console.error('[UPLOAD] Error saving file info:', error.message);
        throw new Error(`Failed to save file info: ${error.message}`);
      }

      onProgress(90, '🔗 共有リンク生成中...');
      const viewUrl = `${window.location.origin}/?id=${fileId}`;

      onProgress(98, '✨ 最後の処理中...');
      onProgress(100, '✅ アップロード完了！');

      console.log('✅ ファイルが GitHub にアップロードされました');
      console.log('📥 ダウンロードURL:', assetData.download_url);

      return {
        success: true,
        fileName: fileName,
        fileId: fileId,
        viewUrl: viewUrl,
        downloadUrl: assetData.download_url,
        fileSize: processedBlob.size,
        originalSize: fileBlob.size,
        githubUrl: releaseData.html_url,
        uploadedAt: new Date().toISOString(),
        wasCompressed: wasCompressed,
      };
    } catch (error) {
      console.error('❌ アップロードエラー:', error.message);
      throw new Error(`ファイルアップロード失敗: ${error.message}`);
    }
  }

  /**
   * モバイルデバイス判定
   */
  isMobileDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    
    if (/iPad|iPhone|iPod/.test(userAgent)) {
      console.log('[MOBILE] iOS detected');
      return true;
    }
    
    if (/android/i.test(userAgent)) {
      console.log('[MOBILE] Android detected');
      return true;
    }
    
    if (/mobile/i.test(userAgent)) {
      console.log('[MOBILE] Mobile device detected');
      return true;
    }
    
    return false;
  }

  /**
   * GitHub から特定のファイルを取得
   */
  async getFileInfo(fileId) {
    try {
      const githubJson = await this.githubUploader.getGithubJson();
      
      // ★ 修正: レスポンス形式を処理
      let files = [];
      if (githubJson && githubJson.data && Array.isArray(githubJson.data.files)) {
        files = githubJson.data.files;
      } else if (githubJson && Array.isArray(githubJson.files)) {
        files = githubJson.files;
      }
      
      return files.find(f => f && f.fileId === fileId) || null;
    } catch (error) {
      console.error('❌ ファイル取得エラー:', error.message);
      return null;
    }
  }

  /**
   * すべてのファイル情報を取得
   */
  async getAllFiles() {
    try {
      const githubJson = await this.githubUploader.getGithubJson();
      
      // ★ 修正: レスポンス形式を処理
      if (githubJson && githubJson.data && Array.isArray(githubJson.data.files)) {
        return githubJson.data.files;
      } else if (githubJson && Array.isArray(githubJson.files)) {
        return githubJson.files;
      }
      
      return [];
    } catch (error) {
      console.error('❌ ファイル一覧取得エラー:', error.message);
      return [];
    }
  }

  /**
   * クリップボードにコピー
   */
  async copyToClipboard(text) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      console.log('✅ コピー完了');
    } catch (error) {
      console.error('❌ コピーエラー:', error.message);
    }
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;
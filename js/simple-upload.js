

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
      onProgress(2, ' 準備中...');

      // 動画ファイルのみ圧縮
      let processedBlob = fileBlob;
      let wasCompressed = false;

      if (this.isVideoFile(fileBlob)) {
        console.log(' 動画ファイルを検出 - 720p 30fps に圧縮開始...');
        
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
            console.log(` 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);
          } catch (error) {
            console.warn(' 圧縮失敗 - オリジナルでアップロード:', error.message);
            wasCompressed = false;
          }
        } else {
          console.warn(' 圧縮エンジンが利用できません');
        }
      }

      onProgress(40, ' Base64 エンコード中...');
      const base64 = await this.fileToBase64(processedBlob);

      onProgress(45, ' GitHub にアップロード中...');

      // Release を作成
      const releaseTag = `file_${fileId}`;
      const fileExtension = this.getFileExtension(processedBlob.type);
      const assetFileName = `${fileName.substring(0, fileName.lastIndexOf('.') || fileName.length)}.${fileExtension}`;

      const releaseData = await this.githubUploader.createRelease(
        releaseTag,
        fileName,
        `File ID: ${fileId}\nOriginal Name: ${fileName}\nType: ${processedBlob.type}\nUploaded: ${new Date().toISOString()}\nCompressed: ${wasCompressed ? 'Yes' : 'No'}`
      );

      onProgress(65, ' ファイルをアップロード中...');

      // Asset をアップロード
      const assetData = await this.githubUploader.uploadAsset(
        releaseData.upload_url,
        assetFileName,
        base64
      );

      onProgress(80, ' アップロード情報を記録中...');

      // github.json にファイル情報を追加
      const githubJson = await this.githubUploader.getGithubJson();
      githubJson.files = githubJson.files || [];
      githubJson.files.push({
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
      });
      githubJson.lastUpdated = new Date().toISOString();

      await this.githubUploader.saveGithubJson(githubJson);

      onProgress(90, ' 共有リンク生成中...');
      const viewUrl = `${window.location.origin}/?id=${fileId}`;

      onProgress(98, ' 最後の処理中...');
      onProgress(100, ' アップロード完了！');

      console.log('ファイルが GitHub にアップロードされました');
      console.log('視聴URL:', viewUrl);
      console.log('ダウンロードURL:', assetData.download_url);

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
      console.error('アップロードエラー:', error.message);
      throw new Error(`ファイルアップロード失敗: ${error.message}`);
    }
  }

  /**
   * GitHub から特定のファイルを取得
   */
  async getFileInfo(fileId) {
    try {
      const githubJson = await this.githubUploader.getGithubJson();
      const files = githubJson.files || [];
      return files.find(f => f.fileId === fileId) || null;
    } catch (error) {
      console.error('ファイル取得エラー:', error.message);
      return null;
    }
  }

  /**
   * すべてのファイル情報を取得
   */
  async getAllFiles() {
    try {
      const githubJson = await this.githubUploader.getGithubJson();
      return githubJson.files || [];
    } catch (error) {
      console.error('ファイル一覧取得エラー:', error.message);
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
      console.log('コピー完了');
    } catch (error) {
      console.error('コピーエラー:', error.message);
    }
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;
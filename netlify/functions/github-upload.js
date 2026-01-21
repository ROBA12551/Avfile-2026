/**
 * js/client-upload.js
 * ローカルで圧縮したファイルを Base64 エンコード後、サーバーにアップロード
 * サーバーは単純に GitHub にアップロードするだけ
 */

class ClientVideoUploader {
  constructor() {
    this.compressionEngine = new VideoCompressionEngineLocal();
  }

  /**
   * Blob を Base64 文字列に変換（ローカル側）
   * これはクライアント側で高速に実行される
   */
  async blobToBase64(blob) {
    console.log('[BASE64] Starting blob to base64 conversion...');
    console.log('[BASE64] Blob size:', blob.size, 'bytes');

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const startTime = Date.now();

      reader.onload = () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`[BASE64] Conversion completed in ${duration}ms`);

        // データ URL から "data:video/mp4;base64," プレフィックスを削除
        const base64String = reader.result.split(',')[1];
        console.log('[BASE64] Base64 string length:', base64String.length);

        resolve(base64String);
      };

      reader.onerror = () => {
        console.error('[BASE64] Conversion error:', reader.error);
        reject(reader.error);
      };

      reader.readAsDataURL(blob);
    });
  }

  /**
   * 圧縮されたビデオをアップロード
   * @param {Blob} compressedVideoBlob - FFmpeg.wasm で圧縮されたビデオ
   * @param {Object} releaseData - GitHub Release のデータ
   * @param {Function} onProgress - プログレスコールバック
   */
  async uploadCompressedVideo(compressedVideoBlob, releaseData, onProgress = () => {}) {
    try {
      console.log('[UPLOAD] Starting upload process');
      console.log('[UPLOAD] Video blob:', {
        size: compressedVideoBlob.size,
        type: compressedVideoBlob.type,
        sizeMB: (compressedVideoBlob.size / 1024 / 1024).toFixed(2)
      });

      if (!releaseData || !releaseData.upload_url) {
        throw new Error('Invalid release data - missing upload_url');
      }

      // ========================================
      // Step 1: Base64 エンコード（ローカル側）
      // ========================================
      onProgress(10, '📦 ファイルをBase64エンコード中...');
      console.log('[UPLOAD] Step 1: Base64 encoding...');

      const startEncode = Date.now();
      const base64String = await this.blobToBase64(compressedVideoBlob);
      const encodeTime = Date.now() - startEncode;

      console.log(`[UPLOAD] Base64 encoding completed in ${encodeTime}ms`);
      console.log('[UPLOAD] Base64 string length:', base64String.length);

      // ========================================
      // Step 2: サーバーに送信（JSON で POST）
      // ========================================
      onProgress(30, '📤 サーバーにアップロード中...');
      console.log('[UPLOAD] Step 2: Sending to server...');

      const startUpload = Date.now();

      const response = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'upload-asset',
          fileBase64: base64String,        // クライアント側でエンコード済み
          fileName: 'video.mp4',
          uploadUrl: releaseData.upload_url,
          fileId: 'file_' + Date.now(),
          fileSize: compressedVideoBlob.size,
          isPreCompressed: true             // ローカルで既に圧縮済みであることを示す
        })
      });

      const uploadTime = Date.now() - startUpload;
      console.log(`[UPLOAD] Network upload completed in ${uploadTime}ms`);

      // ========================================
      // Step 3: レスポンス解析
      // ========================================
      onProgress(80, '✅ レスポンス処理中...');
      console.log('[UPLOAD] Step 3: Processing response...');

      const result = await response.json();
      console.log('[UPLOAD] Server response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const assetData = result.data;

      console.log('[UPLOAD] Asset uploaded successfully:', {
        assetId: assetData.asset_id,
        name: assetData.name,
        size: assetData.size,
        downloadUrl: assetData.download_url
      });

      // ========================================
      // Step 4: 完了
      // ========================================
      onProgress(100, '✅ アップロード完了！');

      return {
        success: true,
        assetId: assetData.asset_id,
        fileName: assetData.name,
        fileSize: assetData.size,
        downloadUrl: assetData.download_url,
        uploadTime: uploadTime,
        encodeTime: encodeTime
      };

    } catch (error) {
      console.error('[UPLOAD] Upload failed:', error);
      onProgress(100, `❌ エラー: ${error.message}`);
      throw error;
    }
  }
}

/**
 * 完全なワークフロー
 */
class VideoUploadWorkflow {
  constructor() {
    this.compressionEngine = new VideoCompressionEngineLocal();
    this.uploader = new ClientVideoUploader();
  }

  /**
   * ビデオファイルを選択 → ローカルで圧縮 → Base64 エンコード → アップロード
   */
  async handleVideoUpload(videoFile, releaseData, onProgress = () => {}) {
    try {
      console.log('=== VIDEO UPLOAD WORKFLOW START ===');
      console.log('Input file:', {
        name: videoFile.name,
        size: videoFile.size,
        sizeMB: (videoFile.size / 1024 / 1024).toFixed(2)
      });

      // ========================================
      // Phase 1: ビデオ圧縮（ローカル）
      // ========================================
      console.log('[WORKFLOW] Phase 1: Compress video locally...');
      
      const startCompress = Date.now();
      const compressedBlob = await this.compressionEngine.compress(
        videoFile,
        (progress, message) => {
          // 全体の 0-50% を圧縮フェーズに割り当て
          onProgress(Math.floor(progress / 2), `[圧縮] ${message}`);
        }
      );
      const compressTime = Date.now() - startCompress;

      console.log('[WORKFLOW] Compression completed:', {
        originalSize: videoFile.size,
        compressedSize: compressedBlob.size,
        ratio: ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0) + '%',
        duration: compressTime + 'ms'
      });

      // ========================================
      // Phase 2: Base64 エンコード + アップロード
      // ========================================
      console.log('[WORKFLOW] Phase 2: Encode and upload...');

      const startUpload = Date.now();
      const uploadResult = await this.uploader.uploadCompressedVideo(
        compressedBlob,
        releaseData,
        (progress, message) => {
          // 全体の 50-100% をアップロードフェーズに割り当て
          onProgress(50 + Math.floor(progress / 2), `[アップロード] ${message}`);
        }
      );
      const uploadTime = Date.now() - startUpload;

      console.log('[WORKFLOW] Upload completed:', uploadResult);

      // ========================================
      // Phase 3: クリーンアップ
      // ========================================
      console.log('[WORKFLOW] Phase 3: Cleanup...');
      await this.compressionEngine.cleanup();

      const totalTime = compressTime + uploadTime;
      console.log('=== VIDEO UPLOAD WORKFLOW SUCCESS ===');
      console.log('Timeline:', {
        compressionTime: compressTime + 'ms',
        uploadTime: uploadTime + 'ms',
        totalTime: totalTime + 'ms'
      });

      return {
        success: true,
        originalSize: videoFile.size,
        compressedSize: compressedBlob.size,
        compressionRatio: ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0) + '%',
        compressTime: compressTime,
        uploadTime: uploadTime,
        totalTime: totalTime,
        asset: uploadResult
      };

    } catch (error) {
      console.error('[WORKFLOW] Upload workflow failed:', error);
      await this.compressionEngine.cleanup();
      throw error;
    }
  }
}

// グローバル変数に割り当て
window.ClientVideoUploader = ClientVideoUploader;
window.VideoUploadWorkflow = VideoUploadWorkflow;
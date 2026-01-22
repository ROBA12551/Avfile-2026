/**
 * js/chunked-binary-uploader.js
 * ★ 修正版: GitHubUploader を参照しない独立版
 */

class ChunkedBinaryUploader {
  constructor() {
    this.CHUNK_THRESHOLD = 3 * 1024 * 1024;   // ★ 3MB以上でチャンク分割（Base64化で ~4MB）
    this.CHUNK_SIZE = 1 * 1024 * 1024;        // ★ 1MBごとに分割
    this.functionUrl = '/.netlify/functions/github-upload';
  }

  /**
   * ファイルサイズに応じて通常/チャンク分割を切り替え
   */
  async uploadAssetBinary(uploadUrl, fileName, fileObject) {
    console.log('[UPLOAD_BINARY] Starting upload:', {
      fileName: fileName,
      fileSize: fileObject.size,
      fileSizeMB: (fileObject.size / 1024 / 1024).toFixed(2) + ' MB'
    });

    if (fileObject.size > this.CHUNK_THRESHOLD) {
      console.log('[UPLOAD_BINARY] Using chunked upload');
      return await this.uploadAssetBinaryChunked(uploadUrl, fileName, fileObject);
    } else {
      console.log('[UPLOAD_BINARY] Using regular upload');
      return await this.uploadAssetBinaryRegular(uploadUrl, fileName, fileObject);
    }
  }

  /**
   * 通常のアップロード（50MB以下）
   */
  async uploadAssetBinaryRegular(uploadUrl, fileName, fileObject) {
    try {
      const arrayBuffer = await fileObject.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      console.log('[UPLOAD_REGULAR] Converting to Base64...');
      let base64 = '';
      const chunkSize = 10000;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        base64 += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
      }
      base64 = btoa(base64);

      console.log('[UPLOAD_REGULAR] Sending to GitHub...');
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: {
          'X-Upload-Url': uploadUrl,
          'X-Is-Base64': 'true',
          'X-File-Name': fileName,
          'Content-Type': 'text/plain'
        },
        body: base64
      });

      console.log('[UPLOAD_REGULAR] Response status:', response.status);

      if (!response.ok) {
        const text = await response.text();
        console.error('[UPLOAD_REGULAR] Error:', text.substring(0, 500));
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[UPLOAD_REGULAR] Success');
      
      return {
        size: data.data.size,
        browser_download_url: data.data.download_url
      };
    } catch (e) {
      console.error('[UPLOAD_REGULAR] Error:', e.message);
      throw e;
    }
  }

  /**
   * チャンク分割アップロード（50MB以上）
   */
  async uploadAssetBinaryChunked(uploadUrl, fileName, fileObject) {
    try {
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const totalChunks = Math.ceil(fileObject.size / this.CHUNK_SIZE);

      console.log('[UPLOAD_CHUNKED] Starting:', {
        uploadId,
        fileName,
        totalChunks,
        fileSizeMB: (fileObject.size / 1024 / 1024).toFixed(2)
      });

      // チャンクをアップロード
      for (let i = 0; i < totalChunks; i++) {
        const start = i * this.CHUNK_SIZE;
        const end = Math.min(start + this.CHUNK_SIZE, fileObject.size);
        const chunk = fileObject.slice(start, end);

        console.log(`[UPLOAD_CHUNKED] Uploading chunk ${i + 1}/${totalChunks}:`, {
          start,
          end,
          chunkSize: chunk.size
        });

        // ★ Blob をそのまま body に使用（Buffer は不要）
        const params = new URLSearchParams({
          action: 'upload-chunk',
          uploadId,
          chunkIndex: i,
          totalChunks,
          fileName
        });

        const response = await fetch(`${this.functionUrl}?${params}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          body: chunk  // ★ Blob を直接送信
        });

        console.log(`[UPLOAD_CHUNKED] Chunk ${i + 1} response status:`, response.status);

        if (!response.ok) {
          const text = await response.text();
          console.error(`[UPLOAD_CHUNKED] Chunk ${i + 1} failed:`, text.substring(0, 500));
          throw new Error(`Chunk ${i + 1} failed: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[UPLOAD_CHUNKED] Chunk ${i + 1} success:`, {
          uploadId: data.uploadId,
          receivedChunks: data.receivedChunks,
          totalChunks: data.totalChunks
        });
      }

      // チャンクを結合
      console.log('[UPLOAD_CHUNKED] All chunks uploaded, finalizing...');

      const finalizeResponse = await fetch(this.functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'finalize-chunks',
          uploadId,
          fileName,
          releaseUploadUrl: uploadUrl
        })
      });

      console.log('[UPLOAD_CHUNKED] Finalize response status:', finalizeResponse.status);

      if (!finalizeResponse.ok) {
        const text = await finalizeResponse.text();
        console.error('[UPLOAD_CHUNKED] Finalize failed:', text.substring(0, 500));
        throw new Error(`Finalize failed: ${finalizeResponse.status}`);
      }

      const data = await finalizeResponse.json();
      console.log('[UPLOAD_CHUNKED] Success');

      return {
        size: data.data.size,
        browser_download_url: data.data.download_url
      };
    } catch (e) {
      console.error('[UPLOAD_CHUNKED] Error:', e.message);
      throw e;
    }
  }

  /**
   * ファイルサイズをフォーマット
   */
  formatSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// ★ グローバルにインスタンスを作成
window.chunkedBinaryUploader = new ChunkedBinaryUploader();

console.log('[CHUNKED_UPLOADER] Initialized - Chunked upload support enabled');

// ★ GitHubUploader.prototype.uploadAssetBinary を割り当て（後から定義される）
// ただし、この行は削除するか、GitHubUploader が定義された後に実行
setTimeout(() => {
  if (window.GitHubUploader && !window.GitHubUploader.prototype.uploadAssetBinary_overridden) {
    window.GitHubUploader.prototype.uploadAssetBinary_original = window.GitHubUploader.prototype.uploadAssetBinary;
    window.GitHubUploader.prototype.uploadAssetBinary = function(uploadUrl, fileName, fileObject) {
      return window.chunkedBinaryUploader.uploadAssetBinary(uploadUrl, fileName, fileObject);
    };
    window.GitHubUploader.prototype.uploadAssetBinary_overridden = true;
    console.log('[CHUNKED_UPLOADER] Hooked into GitHubUploader.uploadAssetBinary');
  }
}, 100);
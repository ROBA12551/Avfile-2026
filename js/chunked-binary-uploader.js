/**
 * =====================================================
 * js/chunked-upload-minimal.js
 * 
 * 既存の uploadMultiple() をラップして
 * チャンク化機能を追加（最小限の変更）
 * =====================================================
 */

class MinimalChunkedUploader {
  constructor() {
    this.chunkSize = 5 * 1024 * 1024; // 5MB
  }

  /**
   * ファイルをチャンク分割
   */
  *generateChunks(file) {
    let offset = 0;
    let chunkIndex = 0;

    while (offset < file.size) {
      const chunkEnd = Math.min(offset + this.chunkSize, file.size);
      const chunk = file.slice(offset, chunkEnd);

      yield {
        chunkIndex,
        totalChunks: Math.ceil(file.size / this.chunkSize),
        data: chunk,
        offset
      };

      offset = chunkEnd;
      chunkIndex++;
    }
  }

  /**
   * 単一チャンクをアップロード
   */
  async uploadChunk(uploadId, chunkInfo, fileName, mimeType) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            reject(new Error(`Invalid response: ${xhr.responseText}`));
          }
        } else {
          reject(new Error(`Chunk upload failed: ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });

      const params = new URLSearchParams({
        action: 'upload-chunk',
        uploadId: uploadId,
        chunkIndex: chunkInfo.chunkIndex,
        totalChunks: chunkInfo.totalChunks,
        fileName: fileName,
        mimeType: mimeType
      });

      xhr.open('POST', `/.netlify/functions/github-upload?${params}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.send(chunkInfo.data);
    });
  }

  /**
   * すべてのチャンクを送信して統合
   */
  async uploadFileChunked(file, fileName, mimeType) {
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[CHUNKED] Starting: ${fileName} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`[CHUNKED] Upload ID: ${uploadId}`);

    // チャンクを送信
    for (const chunkInfo of this.generateChunks(file)) {
      console.log(`[CHUNKED] Chunk ${chunkInfo.chunkIndex + 1}/${chunkInfo.totalChunks} (${(chunkInfo.data.size / 1024 / 1024).toFixed(2)}MB)`);
      
      const result = await this.uploadChunk(uploadId, chunkInfo, fileName, mimeType);
      console.log(`[CHUNKED] Chunk ${chunkInfo.chunkIndex} - OK`);
    }

    // 統合リクエスト
    console.log(`[CHUNKED] Finalizing...`);
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log(`[CHUNKED] ✓ Complete`);
            resolve(response);
          } catch (e) {
            reject(new Error(`Invalid response: ${xhr.responseText}`));
          }
        } else {
          reject(new Error(`Finalize failed: ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });

      xhr.open('POST', `/.netlify/functions/github-upload?action=finalize-chunks`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        uploadId: uploadId,
        fileName: fileName,
        mimeType: mimeType
      }));
    });
  }

  /**
   * ファイルサイズでチャンク化するか判定
   */
  async upload(file, fileName, mimeType) {
    // 5MB以上ならチャンク化、未満なら既存の方法
    if (file.size >= this.chunkSize) {
      console.log(`[CHUNKED] File size >= 5MB, using chunked upload`);
      return await this.uploadFileChunked(file, fileName, mimeType);
    } else {
      console.log(`[NORMAL] File size < 5MB, using normal upload`);
      // 既存のアップロード方法を使用（ここでは省略）
      return { success: true, message: 'Normal upload' };
    }
  }
}

// グローバルに公開
window.MinimalChunkedUploader = MinimalChunkedUploader;
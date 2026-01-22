class ChunkedBinaryUploader {
  constructor(functionsUrl = '/.netlify/functions/github-upload') {
    this.functionsUrl = functionsUrl;
    this.chunkSize = 5 * 1024 * 1024; // 5MB (6MB制限を避けるため)
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
   * 単一チャンクをバイナリで送信（5MB以下）
   */
  async uploadChunk(uploadId, chunkInfo, fileName, mimeType, onProgress) {
    console.log(`[CHUNK] Uploading chunk ${chunkInfo.chunkIndex + 1}/${chunkInfo.totalChunks}`);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          if (onProgress) onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            reject(new Error(`Invalid response: ${xhr.responseText}`));
          }
        } else {
          reject(new Error(`Chunk upload failed: ${xhr.status} ${xhr.responseText}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });

      // ★ 重要: application/octet-stream でバイナリ送信
      xhr.open('POST', `${this.functionsUrl}?action=upload-chunk&uploadId=${uploadId}&chunkIndex=${chunkInfo.chunkIndex}&totalChunks=${chunkInfo.totalChunks}&fileName=${encodeURIComponent(fileName)}&mimeType=${encodeURIComponent(mimeType)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      
      console.log(`[CHUNK] Sending ${chunkInfo.chunkIndex}: ${(chunkInfo.data.size / 1024 / 1024).toFixed(2)}MB`);
      
      // ★ Blob をそのまま送信（Arraybuffer に変換）
      xhr.send(chunkInfo.data);
    });
  }

  /**
   * すべてのチャンクを送信
   */
  async uploadFile(file, fileName, mimeType, onProgress) {
    try {
      console.log('[UPLOAD] Starting chunked upload:', fileName);
      console.log('[UPLOAD] File size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const chunkResults = [];

      // 各チャンクを送信
      for (const chunkInfo of this.generateChunks(file)) {
        const result = await this.uploadChunk(uploadId, chunkInfo, fileName, mimeType, (progress) => {
          const overall = ((chunkInfo.chunkIndex + progress / 100) / chunkInfo.totalChunks) * 100;
          console.log(`[UPLOAD] Progress: ${overall.toFixed(1)}%`);
          if (onProgress) onProgress(overall);
        });

        chunkResults.push(result);
      }

      console.log('[UPLOAD] ✓ All chunks uploaded');

      // 統合リクエスト（github-upload.js が統合）
      console.log('[UPLOAD] Finalizing...');

      const finalizeResponse = await fetch(`${this.functionsUrl}?action=finalize-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName,
          mimeType
        })
      });

      if (!finalizeResponse.ok) {
        throw new Error(`Finalize failed: ${finalizeResponse.status}`);
      }

      const finalizeData = await finalizeResponse.json();

      console.log('[UPLOAD] ✓ Upload complete');

      return finalizeData;

    } catch (error) {
      console.error('[UPLOAD] Error:', error.message);
      throw error;
    }
  }

  /**
   * 複数ファイルをアップロード
   */
  async uploadMultiple(files, onStatus, onProgress) {
    console.log('[MULTI] Starting upload of', files.length, 'files');

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        onStatus(`Uploading: ${file.name} (${i + 1}/${files.length})`);

        const result = await this.uploadFile(file, file.name, file.type, (progress) => {
          const overall = ((i + progress / 100) / files.length) * 100;
          onProgress(overall);
        });

        results.push({
          fileName: file.name,
          size: file.size,
          success: true,
          ...result
        });

        console.log('[MULTI] ✓ File', i + 1, 'complete');

      } catch (error) {
        console.error('[MULTI] ✗ File failed:', error.message);
        results.push({
          fileName: file.name,
          size: file.size,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }
}

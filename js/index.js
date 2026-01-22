/**
 * =====================================================
 * js/index.js に追加するチャンク化コード
 * 
 * 既存の appState.github.uploadFile() をラップして
 * チャンク化機能を追加
 * =====================================================
 */

// ★ グローバル定数
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * ファイルをチャンク化してアップロード（既存コードに統合）
 * 
 * @param {Blob} file - アップロードするファイル
 * @param {string} fileName - ファイル名
 * @param {Function} onProgress - プログレスコールバック
 * @returns {Promise} アップロード結果
 */
async function uploadFileChunkedNew(file, fileName, onProgress = () => {}) {
  try {
    const fileSize = file.size;
    const mimeType = file.type || 'application/octet-stream';

    console.log(`[CHUNKED] Starting: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

    // ========================================
    // チャンク化判定: 5MB以上なら分割
    // ========================================

    if (fileSize < CHUNK_SIZE) {
      console.log(`[CHUNKED] File < 5MB, returning null (use existing method)`);
      return null; // 既存の方法を使用
    }

    console.log(`[CHUNKED] File >= 5MB, using chunked upload`);

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    console.log(`[CHUNKED] Upload ID: ${uploadId}, Total chunks: ${totalChunks}`);

    // ========================================
    // チャンク送信
    // ========================================

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunk = file.slice(start, end);

      console.log(`[CHUNKED] Chunk ${i + 1}/${totalChunks} (${(chunk.size / 1024 / 1024).toFixed(2)}MB)`);

      onProgress(Math.round((i / totalChunks) * 50), `チャンク ${i + 1}/${totalChunks} を送信中...`);

      const params = new URLSearchParams({
        action: 'upload-chunk',
        uploadId: uploadId,
        chunkIndex: i,
        totalChunks: totalChunks,
        fileName: fileName,
        mimeType: mimeType
      });

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const chunkProgress = (e.loaded / e.total) * 100;
            const overallProgress = Math.round((i + chunkProgress / 100) / totalChunks * 50);
            onProgress(overallProgress, `チャンク ${i + 1}/${totalChunks}: ${chunkProgress.toFixed(0)}%`);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              console.log(`[CHUNKED] Chunk ${i} OK`);
              resolve(response);
            } catch (e) {
              console.error(`[CHUNKED] Parse error: ${xhr.responseText}`);
              reject(new Error(`Parse error: ${xhr.responseText}`));
            }
          } else {
            console.error(`[CHUNKED] Chunk ${i} failed: ${xhr.status}`);
            reject(new Error(`Chunk ${i} failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          console.error(`[CHUNKED] Chunk ${i} network error`);
          reject(new Error(`Chunk ${i} network error`));
        });

        xhr.addEventListener('abort', () => {
          console.error(`[CHUNKED] Chunk ${i} aborted`);
          reject(new Error(`Chunk ${i} aborted`));
        });

        xhr.open('POST', `/.netlify/functions/github-upload?${params}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.send(chunk);
      });
    }

    console.log(`[CHUNKED] All chunks sent, finalizing...`);
    onProgress(75, 'チャンクを統合中...');

    // ========================================
    // チャンク統合リクエスト
    // ========================================

    const finalResponse = await fetch(`/.netlify/functions/github-upload?action=finalize-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: uploadId,
        fileName: fileName,
        mimeType: mimeType
      })
    });

    if (!finalResponse.ok) {
      throw new Error(`Finalize failed: ${finalResponse.status}`);
    }

    const finalData = await finalResponse.json();

    if (!finalData.success) {
      throw new Error(finalData.error || 'Finalize failed');
    }

    console.log(`[CHUNKED] ✓ Complete`);
    onProgress(100, 'アップロード完了！');

    // 既存のコード形式に合わせて返す
    return {
      fileId: finalData.data.fileId,
      downloadUrl: finalData.data.downloadUrl,
      fileName: finalData.data.fileName,
      originalSize: fileSize,
      uploadedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[CHUNKED] Error:`, error.message);
    throw error;
  }
}


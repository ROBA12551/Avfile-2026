/**
 * ★ チャンク分割対応版: uploadAssetBinary
 * ファイルサイズに応じて通常/チャンク分割を切り替え
 */
async function uploadAssetBinary(uploadUrl, fileName, fileObject) {
  const CHUNK_THRESHOLD = 50 * 1024 * 1024; // 50MB 以上はチャンク分割

  console.log('[UPLOAD_BINARY] Starting upload:', {
    fileName: fileName,
    fileSize: fileObject.size,
    fileSizeMB: (fileObject.size / 1024 / 1024).toFixed(2) + ' MB'
  });

  // ★ ファイルサイズに応じて判定
  if (fileObject.size > CHUNK_THRESHOLD) {
    console.log('[UPLOAD_BINARY] File size exceeds threshold, using chunked upload');
    return await uploadAssetBinaryChunked(uploadUrl, fileName, fileObject);
  } else {
    console.log('[UPLOAD_BINARY] Using regular upload');
    return await uploadAssetBinaryRegular(uploadUrl, fileName, fileObject);
  }
}

/**
 * ★ 通常のアップロード（50MB以下）
 */
async function uploadAssetBinaryRegular(uploadUrl, fileName, fileObject) {
  try {
    const arrayBuffer = await fileObject.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Base64 に変換
    let base64 = '';
    const chunkSize = 10000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      base64 += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }
    base64 = btoa(base64);

    console.log('[UPLOAD_REGULAR] Base64 conversion complete:', {
      originalSize: fileObject.size,
      base64Size: base64.length
    });

    const response = await fetch('/.netlify/functions/github-upload', {
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
      console.error('[UPLOAD_REGULAR] Error:', text);
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
 * ★ チャンク分割アップロード（50MB以上）
 */
async function uploadAssetBinaryChunked(uploadUrl, fileName, fileObject) {
  try {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB チャンク
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalChunks = Math.ceil(fileObject.size / CHUNK_SIZE);

    console.log('[UPLOAD_CHUNKED] Starting chunked upload:', {
      uploadId,
      fileName,
      fileSize: fileObject.size,
      totalChunks,
      chunkSize: CHUNK_SIZE
    });

    // ★ チャンクをアップロード
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileObject.size);
      const chunk = fileObject.slice(start, end);

      console.log(`[UPLOAD_CHUNKED] Uploading chunk ${i + 1}/${totalChunks}:`, {
        start,
        end,
        size: chunk.size
      });

      const arrayBuffer = await chunk.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const params = new URLSearchParams({
        action: 'upload-chunk',
        uploadId,
        chunkIndex: i,
        totalChunks,
        fileName
      });

      const response = await fetch(`/.netlify/functions/github-upload?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: buffer
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[UPLOAD_CHUNKED] Chunk ${i} failed:`, text);
        throw new Error(`Chunk ${i} upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[UPLOAD_CHUNKED] Chunk ${i} success:`, data);
    }

    // ★ チャンクを結合
    console.log('[UPLOAD_CHUNKED] All chunks uploaded, finalizing...');

    const finalizeResponse = await fetch('/.netlify/functions/github-upload', {
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
      console.error('[UPLOAD_CHUNKED] Finalize failed:', text);
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

GitHubUploader.prototype.uploadAssetBinary = async function(uploadUrl, fileName, fileObject) {
  const CHUNK_THRESHOLD = 50 * 1024 * 1024; // 50MB 以上はチャンク分割

  console.log('[UPLOAD_BINARY] Starting upload:', {
    fileName: fileName,
    fileSize: fileObject.size,
    fileSizeMB: (fileObject.size / 1024 / 1024).toFixed(2) + ' MB'
  });

  if (fileObject.size > CHUNK_THRESHOLD) {
    console.log('[UPLOAD_BINARY] Using chunked upload for large file');
    return await uploadAssetBinaryChunked(uploadUrl, fileName, fileObject);
  } else {
    console.log('[UPLOAD_BINARY] Using regular upload');
    return await uploadAssetBinaryRegular(uploadUrl, fileName, fileObject);
  }
};
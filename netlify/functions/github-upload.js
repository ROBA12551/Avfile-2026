// ★ 修正: uploadMultiple関数のアップロード部分
async function uploadMultiple(files) {
  showStatus();
  const uploader = new GitHubUploader();
  const ids = [];
  const isMobile = isMobileDevice();

  try {
    const promises = files.map((file, i) => (async () => {
      document.getElementById('statusMessage').textContent = `${i + 1} / ${files.length}`;
      
      const fileId = 'f_' + Math.random().toString(36).substr(2, 9);
      
      console.log('[UPLOAD] Starting file:', file.name, 'Size:', file.size, 'Type:', file.type);
      console.log('[UPLOAD] isMobile:', isMobile);
      
      let fileName = file.name || 'file';
      fileName = sanitizeFileName(fileName);
      
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File size exceeds limit: ${(file.size / 1024 / 1024).toFixed(2)}MB (max 500MB)`);
      }
      
      let uploadFile = file;
      
      // VideoCompressionEngine を使用
      if (isVideoFile(file) && !isMobile && window.VideoCompressionEngine) {
        try {
          console.log('[UPLOAD] Video detected - compressing...');
          const engine = new VideoCompressionEngine();
          uploadFile = await engine.compress(file, (percent, message) => {
            document.getElementById('statusMessage').textContent = `${i + 1} / ${files.length} - ${message}`;
          });
          console.log('[UPLOAD] Compression successful');
        } catch (err) {
          console.warn('[UPLOAD] Compression failed:', err.message);
          uploadFile = file;
        }
      } else if (isVideoFile(file)) {
        console.log('[UPLOAD] Mobile device or compression unavailable - skipping compression');
      }
      
      // ★ 修正: Base64変換のデバッグ出力を追加
      let base64 = '';
      try {
        console.log('[UPLOAD] Starting Base64 conversion...');
        base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = reader.result;
              console.log('[UPLOAD] FileReader result type:', typeof result, 'length:', result.length);
              
              const b64 = result.split(',')[1];
              if (!b64 || b64.length === 0) {
                console.error('[UPLOAD] Base64 data is empty!');
                reject(new Error('Failed to convert file to base64 - empty result'));
              }
              
              console.log('[UPLOAD] Base64 conversion successful, length:', b64.length);
              console.log('[UPLOAD] Base64 first 50 chars:', b64.substring(0, 50));
              
              resolve(b64);
            } catch (e) {
              console.error('[UPLOAD] Base64 parsing error:', e);
              reject(e);
            }
          };
          reader.onerror = () => {
            console.error('[UPLOAD] FileReader error:', reader.error);
            reject(reader.error);
          };
          console.log('[UPLOAD] FileReader readAsDataURL started');
          reader.readAsDataURL(uploadFile);
        });
      } catch (err) {
        console.error('[UPLOAD] Failed to convert file to base64:', err);
        throw new Error(`Failed to read file: ${fileName}`);
      }

      console.log('[UPLOAD] Creating release...');
      const releaseData = await uploader.createRelease(`file_${fileId}`, fileName);
      console.log('[UPLOAD] Release created:', releaseData.release_id);

      console.log('[UPLOAD] Uploading asset...');
      console.log('[UPLOAD] uploadUrl:', releaseData.upload_url.substring(0, 100));
      console.log('[UPLOAD] fileName:', fileName);
      console.log('[UPLOAD] base64 length:', base64.length);
      
      await uploader.uploadAsset(releaseData.upload_url, fileName, base64, fileId, uploadFile.size);
      console.log('[UPLOAD] Asset uploaded successfully');

      let githubJson = null;
      try {
        githubJson = await uploader.getGithubJson();
        
        if (!githubJson || typeof githubJson !== 'object') {
          throw new Error('Invalid githubJson response');
        }

        if (!Array.isArray(githubJson.files)) {
          console.warn('[UPLOAD] files is not an array, reinitializing');
          githubJson.files = [];
        }
      } catch (error) {
        console.error('[UPLOAD] Error fetching github.json:', error.message);
        throw new Error(`Failed to fetch github.json: ${error.message}`);
      }

      try {
        const fileInfo = {
          fileId: fileId,
          fileName: fileName,
          downloadUrl: releaseData.assets_url || releaseData.upload_url,
          fileSize: uploadFile.size,
          uploadedAt: new Date().toISOString(),
        };

        console.log('[UPLOAD] Adding file info:', fileInfo);
        githubJson.files.push(fileInfo);
        githubJson.lastUpdated = new Date().toISOString();

        await uploader.saveGithubJson(githubJson);
        console.log('[UPLOAD] github.json saved successfully');
      } catch (error) {
        console.error('[UPLOAD] Error saving file info:', error.message);
        throw new Error(`Failed to save file info: ${error.message}`);
      }

      const progress = Math.round(((ids.length + 1) / files.length) * 100);
      document.getElementById('progressFill').style.width = progress + '%';
      document.getElementById('progressPercent').textContent = progress + '%';

      return fileId;
    })());

    const results = await Promise.all(promises);
    ids.push(...results);

    const view = await uploader.createView(ids);
    document.getElementById('shareUrl').value = view.shareUrl;
    showSuccess();
  } catch (e) {
    console.error('[UPLOAD] Error:', e);
    const errorMsg = e.message || 'Upload failed. Please try again.';
    showError(errorMsg);
  }
}
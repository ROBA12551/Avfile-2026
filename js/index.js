/**
 * js/index-fast.js
 * 
 * Optimized for FASTEST upload performance
 * - Minimal processing
 * - Parallel uploads
 * - Quick feedback
 * - No unnecessary operations
 */

// Global state
const appState = {
  storage: null,
  compression: null,
  github: null,
  currentFile: null,
  isProcessing: false,
  uploadQueue: [],
  activeUploads: 0,
};

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', async () => {
  appState.storage = new StorageManager();
  appState.compression = new VideoCompressionEngine();
  appState.github = new SimpleUploadManager();

  setupEventListeners();
  console.log('✅ Fast Upload Initialized');
});

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadArea = document.getElementById('uploadArea');

  // Click to select
  uploadBtn.addEventListener('click', () => fileInput.click());

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  // Success buttons
  document.getElementById('copyUrlBtn')?.addEventListener('click', copyShareUrl);
  document.getElementById('uploadMoreBtn')?.addEventListener('click', resetForm);
  document.getElementById('retryBtn')?.addEventListener('click', resetForm);

  // Social share
  setupSocialShare();
}

/**
 * モバイルデバイス判定（iOS対応）
 */
function isMobileDevice() {
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
 * Handle file selection - OPTIMIZED FOR SPEED
 */
async function handleFileSelect(file) {
  if (!file) return;

  // ファイルサイズ検証（100MB制限）
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    showError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 100MB.`);
    return;
  }

  // ファイル種別に応じたメッセージ
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  const isDocument = file.type.startsWith('application/') || file.type.includes('document');

  let fileType = 'file';
  if (isVideo) fileType = 'video';
  else if (isImage) fileType = 'image';
  else if (isDocument) fileType = 'document';

  console.log(`📁 ${fileType}: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

  appState.currentFile = file;
  showProcessing();

  try {
    // ★ 修正: モバイルデバイス判定
    const isMobile = isMobileDevice();
    console.log('[UPLOAD] isMobile:', isMobile);

    // 1. PREPARE FILE
    console.log('📦 Preparing file...');
    
    let compressedBlob = file;
    let wasCompressed = false;

    // ★ 修正: モバイル以外の場合のみ圧縮
    if (isVideo && !isMobile) {
      const fileTypeMessage = 'Optimizing video';
      updateProgress(5, fileTypeMessage + '...');

      try {
        compressedBlob = await appState.compression.compress(
          file,
          (percent, message) => {
            updateProgress(percent * 0.4, message); // 40% of total
          }
        );
        wasCompressed = true;
        console.log('✅ Video optimized');
      } catch (error) {
        console.warn('⚠️ Video optimization failed:', error.message);
        console.warn('📱 Continuing with original file...');
        compressedBlob = file;
        wasCompressed = false;
      }
    } else if (isVideo && isMobile) {
      console.log('📱 Mobile device detected - Skipping compression');
      updateProgress(5, 'Preparing file...');
      compressedBlob = file;
      wasCompressed = false;
    } else {
      updateProgress(5, 'Preparing file...');
      compressedBlob = file;
      wasCompressed = false;
    }

    console.log('✅ File ready');
    updateProgress(40, 'Uploading to cloud...');

    // 2. UPLOAD to GitHub via Netlify
    // ★ 修正: 正しいメソッド名を使用
    const uploadResult = await appState.github.uploadFile(
      compressedBlob,
      file.name,
      (percent, message) => {
        updateProgress(40 + percent * 0.6, message); // 60% of total
      }
    );

    console.log('✅ Upload complete');

    // ★ 修正: uploadResult から正しいプロパティを取得
    if (appState.storage) {
      appState.storage.addUpload({
        file_id: uploadResult.fileId,
        title: file.name.replace(/\.[^/.]+$/, ''),
        original_filename: file.name,
        original_size: uploadResult.originalSize || file.size,
        download_url: uploadResult.downloadUrl,
        uploaded_at: uploadResult.uploadedAt,
        was_compressed: wasCompressed,
      });
    }

    // 成功画面を表示
    updateProgress(100, 'Complete!');
    showSuccess(uploadResult);

  } catch (error) {
    console.error('❌ Error:', error);
    const userMessage = error.message || 'Upload failed. Please try again.';
    showError(userMessage);
  }
}

/**
 * Show processing state
 */
function showProcessing() {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'block';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';
  appState.isProcessing = true;
}

/**
 * Update progress
 */
function updateProgress(percent, message) {
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  if (progressFill) {
    progressFill.style.width = Math.min(percent, 100) + '%';
  }
  
  if (progressText) {
    progressText.textContent = Math.round(percent) + '%';
  }

  const processingMessage = document.getElementById('processingMessage');
  const processingTitle = document.getElementById('processingTitle');
  
  if (processingMessage) {
    processingMessage.textContent = message;
  }
  
  if (processingTitle) {
    processingTitle.textContent = message;
  }

  console.log(`⏳ ${percent.toFixed(0)}% - ${message}`);
}

/**
 * Show success
 */
function showSuccess(uploadResult) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'block';
  document.getElementById('errorArea').style.display = 'none';

  // ★ 修正: uploadResult から正しいプロパティを取得
  const shareUrl = uploadResult.downloadUrl || uploadResult.viewUrl || window.location.origin;
  const shareUrlInput = document.getElementById('shareUrl');
  
  if (shareUrlInput) {
    shareUrlInput.value = shareUrl;
  }

  // Update stats
  if (appState.storage) {
    const stats = appState.storage.getStatistics();
    const totalUploads = document.getElementById('totalUploads');
    const totalStorage = document.getElementById('totalStorage');
    
    if (totalUploads) {
      totalUploads.textContent = stats.active_uploads;
    }
    
    if (totalStorage) {
      totalStorage.textContent = (stats.total_storage_used / 1024 / 1024).toFixed(1);
    }
  }

  console.log('✅ Upload success!');
  console.log('📥 Download URL:', shareUrl);
}

/**
 * Show error
 */
function showError(message) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'block';

  const errorMessage = document.getElementById('errorMessage');
  if (errorMessage) {
    errorMessage.textContent = message;
  }

  appState.isProcessing = false;
}

/**
 * Reset form
 */
function resetForm() {
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';

  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.value = '';
  }

  const progressFill = document.getElementById('progressFill');
  if (progressFill) {
    progressFill.style.width = '0%';
  }

  appState.currentFile = null;
  appState.isProcessing = false;
}

/**
 * Copy share URL
 */
function copyShareUrl() {
  const shareUrl = document.getElementById('shareUrl');
  if (!shareUrl) return;

  shareUrl.select();

  navigator.clipboard.writeText(shareUrl.value).then(() => {
    const btn = document.getElementById('copyUrlBtn');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  }).catch(error => {
    console.error('Copy failed:', error);
  });
}

/**
 * Social share
 */
function setupSocialShare() {
  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const url = document.getElementById('shareUrl').value;
    const text = encodeURIComponent('Check out this file: ' + url);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}`,
      '_blank',
      'width=500,height=400'
    );
  });

  document.getElementById('shareLINE')?.addEventListener('click', () => {
    const url = document.getElementById('shareUrl').value;
    window.open(
      `https://line.me/R/msg/text/${encodeURIComponent(url)}`,
      '_blank'
    );
  });
}

/**
 * Generate UUID
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Warn on page leave during upload
 */
window.addEventListener('beforeunload', (e) => {
  if (appState.isProcessing) {
    e.preventDefault();
    e.returnValue = 'Upload in progress. Are you sure?';
    return 'Upload in progress. Are you sure?';
  }
});
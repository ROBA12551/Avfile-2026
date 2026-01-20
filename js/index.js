
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
  appState.github = new GitHubUploadManagerNetlify({
    apiBaseUrl: '/.netlify/functions',
    requestTimeout: 30000,
  });

  // FFmpeg 準備は不要（フォールバック対応）
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
    // 1. PREPARE FILE
    console.log('📥 Preparing file...');
    const fileTypeMessage = isVideo ? 'Optimizing video' : 'Preparing file';
    updateProgress(5, fileTypeMessage + '...');

    const compressedBlob = await appState.compression.compress(
      file,
      (percent, message) => {
        updateProgress(percent * 0.4, message); // 40% of total
      }
    );

    console.log('✅ File ready');
    updateProgress(40, 'Uploading to cloud...');

    // 2. UPLOAD to GitHub via Netlify
    const fileId = generateUUID();
    const metadata = {
      file_id: fileId,
      original_filename: file.name,
      original_size: file.size,
      compressed_size: compressedBlob.size,
      compression_ratio: (compressedBlob.size / file.size).toFixed(4),
      resolution: '720p',
      fps: 30,
      upload_time: new Date().toISOString(),
      uploader_id: appState.storage.getUserId(),
      title: file.name.replace(/\.[^/.]+$/, ''),
    };

    const uploadResult = await appState.github.uploadWithMetadata(
      compressedBlob,
      metadata,
      (percent, message) => {
        updateProgress(40 + percent * 0.6, message); // 60% of total
      }
    );

    console.log('✅ Upload complete');

    // 3. SAVE to localStorage
    appState.storage.addUpload({
      file_id: fileId,
      release_id: uploadResult.release_id,
      title: metadata.title,
      original_filename: file.name,
      original_size: file.size,
      compressed_size: compressedBlob.size,
      asset_url: uploadResult.asset_url,
      download_url: uploadResult.asset_url,
    });

    // 4. SHOW SUCCESS
    updateProgress(100, 'Complete!');
    showSuccess(uploadResult);

  } catch (error) {
    console.error('❌ Error:', error);
    const userMessage = GitHubUploadManagerNetlify.getErrorMessage(error);
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

  progressFill.style.width = Math.min(percent, 100) + '%';
  progressText.textContent = Math.round(percent) + '%';

  document.getElementById('processingMessage').textContent = message;
  document.getElementById('processingTitle').textContent = message;

  console.log(`📊 ${percent.toFixed(0)}% - ${message}`);
}

/**
 * Show success
 */
function showSuccess(uploadResult) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'block';
  document.getElementById('errorArea').style.display = 'none';

  // Generate share URL
  const shareUrl = `${window.location.origin}/v/${uploadResult.release_id}`;
  document.getElementById('shareUrl').value = shareUrl;

  // Update stats
  const stats = appState.storage.getStatistics();
  document.getElementById('totalUploads').textContent = stats.active_uploads;
  document.getElementById('totalStorage').textContent =
    (stats.total_storage_used / 1024 / 1024).toFixed(1);
}

/**
 * Show error
 */
function showError(message) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'block';

  document.getElementById('errorMessage').textContent = message;
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

  document.getElementById('fileInput').value = '';
  document.getElementById('progressFill').style.width = '0%';

  appState.currentFile = null;
  appState.isProcessing = false;
}

/**
 * Copy share URL
 */
function copyShareUrl() {
  const shareUrl = document.getElementById('shareUrl');
  shareUrl.select();

  navigator.clipboard.writeText(shareUrl.value).then(() => {
    const btn = document.getElementById('copyUrlBtn');
    const originalText = btn.textContent;

    btn.textContent = '✓ Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
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
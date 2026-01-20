/**
 * js/viewer.js
 * 
 * ビデオプレビュー・ビューアページのロジック
 * - Release ID からファイル情報を取得
 * - 動画をストリーミング再生
 * - ダウンロード・共有機能
 * - 通報機能
 */

// グローバル状態
const viewerState = {
  storage: null,
  releaseId: null,
  fileData: null,
  isLoaded: false,
};

// アップロード管理（SimpleUploadManager へのアクセス用）
const appState = {
  github: null,
};

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', async () => {
  viewerState.storage = new StorageManager();
  appState.github = new SimpleUploadManager(); // localStorage アクセス用

  // URL から File ID を取得
  const urlParams = new URLSearchParams(window.location.search);
  viewerState.releaseId = urlParams.get('id') || getFileIdFromPath();

  if (!viewerState.releaseId) {
    showError('No file specified');
    return;
  }

  // ファイル情報を取得
  await loadFileInfo();

  // イベントリスナー登録
  setupEventListeners();

  console.log('✅ Viewer initialized');
});

/**
 * パスから File ID を抽出
 * 例: /?id=xxx-xxx-xxx → xxx-xxx-xxx
 * または: /view/xxx-xxx-xxx → xxx-xxx-xxx
 */
function getFileIdFromPath() {
  // クエリパラメータから取得
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  if (id) return id;
  
  // パスから取得
  const pathMatch = window.location.pathname.match(/\/view\/(.+)$/);
  return pathMatch ? pathMatch[1] : null;
}

/**
 * ファイル情報を取得（localStorage から）
 */
async function loadFileInfo() {
  try {
    console.log('📥 Loading file info...');
    showPreparing();

    // localStorage からファイルデータを取得
    const fileData = appState.github?.getFileData(viewerState.releaseId);
    
    if (fileData) {
      console.log('✅ File found in localStorage');
      viewerState.fileData = fileData;
      
      // 再生回数を増加
      viewerState.storage.incrementViewCount(viewerState.fileData.id);
      
      // UI を更新
      showContent(viewerState.fileData);
      viewerState.isLoaded = true;
      console.log('✅ File loaded');
    } else {
      // localStorage に見つからない場合
      throw new Error('File not found');
    }

  } catch (error) {
    console.error('❌ Error loading file:', error);
    showError('Failed to load file. ' + error.message);
  }
}

/**
 * 準備中画面を表示
 */
function showPreparing() {
  document.getElementById('preparingArea').style.display = 'block';
  document.getElementById('contentArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';

  // プログレスアニメーション
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 30;
    if (progress > 90) progress = 90;

    const progressFill = document.getElementById('preparingProgress');
    progressFill.style.width = progress + '%';

    if (viewerState.isLoaded) {
      clearInterval(interval);
    }
  }, 300);
}

/**
 * コンテンツを表示
 * @param {Object} fileData - ファイル情報
 */
function showContent(fileData) {
  document.getElementById('preparingArea').style.display = 'none';
  document.getElementById('contentArea').style.display = 'block';
  document.getElementById('errorArea').style.display = 'none';

  // ファイル情報を表示
  const fileName = fileData.name || fileData.title || fileData.original_filename || 'File';
  document.getElementById('fileName').textContent = fileName;

  // ファイルサイズをフォーマット
  const fileSize = fileData.size || fileData.compressed_size || 0;
  const sizeInMB = (fileSize / 1024 / 1024).toFixed(1);
  document.getElementById('fileSize').innerHTML =
    `<strong>Size:</strong> ${sizeInMB} MB`;

  // アップロード日時
  const uploadTime = fileData.uploadedAt || fileData.created_at || new Date().toISOString();
  const uploadDate = new Date(uploadTime).toLocaleString();
  document.getElementById('uploadTime').innerHTML =
    `<strong>Uploaded:</strong> ${uploadDate}`;

  // ファイルタイプを判定
  const fileType = fileData.type || 'application/octet-stream';
  const isVideo = fileType.startsWith('video/');
  const isImage = fileType.startsWith('image/');

  // 動画の場合
  if (isVideo && fileData.data) {
    const videoSource = document.getElementById('videoSource');
    videoSource.src = `data:${fileType};base64,${fileData.data}`;
    videoSource.type = fileType;

    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.style.display = 'block';
    videoPlayer.load();
  } else if (isImage && fileData.data) {
    // 画像の場合
    const videoWrapper = document.querySelector('.video-wrapper');
    videoWrapper.innerHTML = `<img src="data:${fileType};base64,${fileData.data}" style="max-width: 100%; max-height: 600px; object-fit: contain;" />`;
  } else if (fileData.data) {
    // その他のファイル
    const videoWrapper = document.querySelector('.video-wrapper');
    videoWrapper.innerHTML = `<div style="text-align: center; padding: 40px;">
      <h3>${fileName}</h3>
      <p>File type: ${fileType}</p>
      <button id="downloadFileBtn" class="btn btn-primary" style="margin-top: 20px;">Download File</button>
    </div>`;
    
    document.getElementById('downloadFileBtn')?.addEventListener('click', () => {
      downloadFile(fileData);
    });
  }

  // 共有 URL を設定
  const shareUrl = window.location.href;
  document.getElementById('shareUrl').value = shareUrl;
}

/**
 * エラー画面を表示
 * @param {string} message - エラーメッセージ
 */
function showError(message) {
  document.getElementById('preparingArea').style.display = 'none';
  document.getElementById('contentArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'block';

  document.getElementById('errorMessage').textContent = message;
}

/**
 * イベントリスナー登録
 */
function setupEventListeners() {
  // コピーボタン
  document.getElementById('copyBtn')?.addEventListener('click', () => {
    const shareUrl = document.getElementById('shareUrl');
    shareUrl.select();

    navigator.clipboard.writeText(shareUrl.value).then(() => {
      const btn = document.getElementById('copyBtn');
      const originalText = btn.textContent;

      btn.textContent = '✓ Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  });

  // ダウンロードボタン
  document.getElementById('downloadBtn')?.addEventListener('click', () => {
    if (viewerState.fileData) {
      downloadFile(viewerState.fileData);
    }
  });

  // 再生ボタン
  document.getElementById('playBtn')?.addEventListener('click', () => {
    const videoPlayer = document.getElementById('videoPlayer');
    if (videoPlayer.paused) {
      videoPlayer.play();
    } else {
      videoPlayer.pause();
    }
  });

  // 通報ボタン
  document.getElementById('reportBtn')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'flex';
  });

  // モーダル閉じるボタン
  document.getElementById('closeReport')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'none';
  });

  document.getElementById('cancelReport')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'none';
  });

  // 通報フォーム送信
  document.getElementById('reportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const reason = document.getElementById('reportReason').value;
    const details = document.getElementById('reportDetails').value;

    if (!reason) {
      alert('Please select a reason');
      return;
    }

    try {
      // 通報を送信（本実装では Netlify Function へ）
      console.log('📤 Submitting report:', { reason, details });

      // モック実装
      alert('Report submitted. Thank you for helping us keep the platform safe.');
      document.getElementById('reportModal').style.display = 'none';
      document.getElementById('reportForm').reset();
    } catch (error) {
      alert('Failed to submit report: ' + error.message);
    }
  });

  // テキストエリアの文字数カウント
  document.getElementById('reportDetails')?.addEventListener('input', (e) => {
    const count = e.target.value.length;
    document.getElementById('charCount').textContent = `${count}/500`;
  });

  // ソーシャルシェア
  setupSocialShare();

  // モーダル外側をクリックで閉じる
  document.getElementById('reportModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reportModal') {
      document.getElementById('reportModal').style.display = 'none';
    }
  });
}

/**
 * ソーシャルシェア機能
 */
function setupSocialShare() {
  const shareUrl = window.location.href;

  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const text = encodeURIComponent(`Check out this video: "${viewerState.fileData?.title || 'Video'}"`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'width=500,height=400'
    );
  });

  document.getElementById('shareLINE')?.addEventListener('click', () => {
    window.open(
      `https://line.me/R/msg/text/${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  });

  document.getElementById('shareEmail')?.addEventListener('click', () => {
    const subject = encodeURIComponent(`Video: ${viewerState.fileData?.title || 'Shared Video'}`);
    const body = encodeURIComponent(`Check out this video:\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
}

/**
 * ファイルをダウンロード
 */
function downloadFile(fileData) {
  const fileName = fileData.name || fileData.original_filename || 'file';
  
  if (fileData.data) {
    // Base64 データからダウンロード
    const link = document.createElement('a');
    link.href = `data:${fileData.type || 'application/octet-stream'};base64,${fileData.data}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('✅ Download started:', fileName);
  } else if (fileData.downloadUrl) {
    // URL からダウンロード
    const link = document.createElement('a');
    link.href = fileData.downloadUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('✅ Download started:', fileName);
  } else {
    console.error('❌ No file data available for download');
    alert('File data not available. Please try again.');
  }
}
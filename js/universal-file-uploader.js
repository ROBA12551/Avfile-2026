/**
 * js/universal-file-uploader.js
 * 汎用ファイルアップロード機能
 * 画像、動画、PDF、音声、ドキュメント など全ファイルタイプに対応
 * GoFile や MediaFile のような多機能ファイル共有サービス対応
 */

class UniversalFileUploader {
  constructor() {
    this.supportedTypes = {
      // 動画
      video: {
        extensions: ['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'm2ts', 'mts', '3gp', '3g2', 'asf', 'f4v', 'm3u8', 'mxf', 'mpeg', 'mpg'],
        mimeTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska', 'video/x-msvideo', 'video/quicktime', 'video/x-flv', 'video/x-ms-wmv']
      },
      // 画像
      image: {
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/x-icon', 'image/tiff', 'image/heic', 'image/heif', 'image/avif']
      },
      // PDF
      pdf: {
        extensions: ['pdf'],
        mimeTypes: ['application/pdf']
      },
      // 音声
      audio: {
        extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff'],
        mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/x-ms-wma', 'audio/opus', 'audio/aiff']
      },
      // ドキュメント
      document: {
        extensions: ['doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ods', 'ppt', 'pptx', 'odp'],
        mimeTypes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf', 'application/vnd.oasis.opendocument.text']
      },
      // アーカイブ
      archive: {
        extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
        mimeTypes: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip']
      },
      // コード
      code: {
        extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb', 'php', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sh', 'bash', 'sql'],
        mimeTypes: ['application/javascript', 'text/javascript', 'text/typescript', 'text/plain', 'text/html', 'text/css']
      }
    };

    this.maxFileSize = 500 * 1024 * 1024; // 500MB
  }

  /**
   * ファイルタイプを判定
   */
  getFileType(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'file';

    const lowerName = fileName.toLowerCase();
    const ext = lowerName.split('.').pop();

    for (const [type, config] of Object.entries(this.supportedTypes)) {
      if (config.extensions.includes(ext)) {
        return type;
      }
    }

    return 'file';
  }

  /**
   * ファイルが圧縮対象かどうか判定
   * 動画ファイルのみローカル圧縮対象
   */
  shouldCompress(file) {
    if (!file) return false;
    const fileType = this.getFileType(file.name);
    return fileType === 'video' && file.size > 100 * 1024 * 1024; // 100MB以上
  }

  /**
   * ファイル情報を取得
   */
  getFileInfo(file) {
    if (!file) return null;

    const fileType = this.getFileType(file.name);
    const size = file.size;
    const sizeStr = this.formatSize(size);
    const mimeType = file.type || this.getMimeType(file.name);

    return {
      name: file.name,
      type: fileType,
      size: size,
      sizeStr: sizeStr,
      mimeType: mimeType,
      lastModified: file.lastModified,
      lastModifiedDate: new Date(file.lastModified)
    };
  }

  /**
   * MIME タイプを取得
   */
  getMimeType(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'application/octet-stream';

    const lowerName = fileName.toLowerCase();
    const ext = lowerName.split('.').pop();

    for (const config of Object.values(this.supportedTypes)) {
      const index = config.extensions.indexOf(ext);
      if (index !== -1 && config.mimeTypes[index]) {
        return config.mimeTypes[index];
      }
    }

    // 一般的な拡張子のマッピング
    const mimeMap = {
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'json': 'application/json',
      'xml': 'application/xml',
      'csv': 'text/csv',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'md': 'text/markdown'
    };

    return mimeMap[ext] || 'application/octet-stream';
  }

  /**
   * ファイルサイズを人間が読みやすい形式にフォーマット
   */
  formatSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 複数ファイルをバリデーション
   */
  validateFiles(files) {
    const errors = [];
    const valid = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // ファイルサイズチェック
      if (file.size > this.maxFileSize) {
        errors.push(`${file.name}: ${this.formatSize(file.size)} (Max: ${this.formatSize(this.maxFileSize)})`);
        continue;
      }

      // ファイル名チェック
      if (!file.name || file.name.length === 0) {
        errors.push(`File ${i + 1}: No file name`);
        continue;
      }

      valid.push(file);
    }

    return { valid, errors };
  }

  /**
   * ファイルをプレビュー用にキャッシュ
   */
  async cacheFilePreview(file, fileId) {
    try {
      const fileType = this.getFileType(file.name);
      
      // 画像とビデオのみキャッシュ
      if (fileType === 'image' || fileType === 'video') {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          localStorage.setItem(`preview_${fileId}`, dataUrl);
          console.log(`[CACHE] Preview cached: ${fileId}`);
        } catch (e) {
          window._previewCache = window._previewCache || {};
          window._previewCache[fileId] = dataUrl;
          console.log(`[CACHE] Preview cached to memory: ${fileId}`);
        }

        return dataUrl;
      }

      return null;
    } catch (e) {
      console.warn('[CACHE] Preview caching failed:', e.message);
      return null;
    }
  }

  /**
   * キャッシュされたプレビューを取得
   */
  getPreviewFromCache(fileId) {
    try {
      const cached = localStorage.getItem(`preview_${fileId}`);
      if (cached) return cached;
    } catch (e) {
      // localStorageが無効な場合
    }

    if (window._previewCache && window._previewCache[fileId]) {
      return window._previewCache[fileId];
    }

    return null;
  }

  /**
   * ファイルの詳細情報を取得（メタデータ）
   */
  async getFileMetadata(file) {
    try {
      const fileInfo = this.getFileInfo(file);
      const metadata = {
        ...fileInfo,
        extension: file.name.split('.').pop().toLowerCase(),
        isCompressible: this.shouldCompress(file),
        previewCapable: ['image', 'video', 'pdf'].includes(fileInfo.type)
      };

      // ビデオの場合は尺を取得してみる
      if (fileInfo.type === 'video') {
        try {
          const duration = await this.getVideoDuration(file);
          if (duration) {
            metadata.duration = duration;
            metadata.durationStr = this.formatDuration(duration);
          }
        } catch (e) {
          console.warn('[METADATA] Failed to get video duration:', e.message);
        }
      }

      // 画像の場合は寸法を取得してみる
      if (fileInfo.type === 'image') {
        try {
          const dimensions = await this.getImageDimensions(file);
          if (dimensions) {
            metadata.width = dimensions.width;
            metadata.height = dimensions.height;
          }
        } catch (e) {
          console.warn('[METADATA] Failed to get image dimensions:', e.message);
        }
      }

      return metadata;
    } catch (e) {
      console.error('[METADATA] Error getting metadata:', e.message);
      return this.getFileInfo(file);
    }
  }

  /**
   * ビデオの尺を取得
   */
  getVideoDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Timeout'));
      }, 5000);

      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        resolve(video.duration);
      });

      video.addEventListener('error', () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video'));
      });

      video.src = url;
    });
  }

  /**
   * 画像の寸法を取得
   */
  getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      const timeout = setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Timeout'));
      }, 5000);

      img.addEventListener('load', () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        resolve({ width: img.width, height: img.height });
      });

      img.addEventListener('error', () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      });

      img.src = url;
    });
  }

  /**
   * 時間をフォーマット（秒 → HH:MM:SS）
   */
  formatDuration(seconds) {
    if (!seconds || typeof seconds !== 'number') return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * ファイル用のアイコン（絵文字）を取得
   */
  getFileIcon(fileName) {
    const fileType = this.getFileType(fileName);

    const iconMap = {
      'video': '🎬',
      'image': '🖼️',
      'pdf': '📄',
      'audio': '🎵',
      'document': '📝',
      'archive': '📦',
      'code': '💻',
      'file': '📁'
    };

    return iconMap[fileType] || '📁';
  }

  /**
   * ファイル用の色を取得
   */
  getFileColor(fileName) {
    const fileType = this.getFileType(fileName);

    const colorMap = {
      'video': '#FF6B6B',
      'image': '#4ECDC4',
      'pdf': '#FF6348',
      'audio': '#FFE66D',
      'document': '#95E1D3',
      'archive': '#C44569',
      'code': '#6BCB77',
      'file': '#8B9DC3'
    };

    return colorMap[fileType] || '#8B9DC3';
  }
}

// グローバルに割り当て
window.UniversalFileUploader = UniversalFileUploader;

console.log('[UPLOADER] Universal File Uploader initialized');
/**
 * js/universal-file-uploader-enhanced.js
 * フォトライブラリ＆ファイル選択対応
 * iOS/Android のメディアピッカーに完全対応
 */

class UniversalFileUploaderEnhanced {
  constructor() {
    this.supportedTypes = {
      video: {
        extensions: ['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'm2ts', 'mts', '3gp', '3g2', 'asf', 'f4v', 'm3u8', 'mxf', 'mpeg', 'mpg'],
        mimeTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska', 'video/x-msvideo', 'video/quicktime', 'video/x-flv', 'video/x-ms-wmv']
      },
      image: {
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/x-icon', 'image/tiff', 'image/heic', 'image/heif', 'image/avif']
      },
      pdf: {
        extensions: ['pdf'],
        mimeTypes: ['application/pdf']
      },
      audio: {
        extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff'],
        mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/x-ms-wma', 'audio/opus', 'audio/aiff']
      },
      document: {
        extensions: ['doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ods', 'ppt', 'pptx', 'odp'],
        mimeTypes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf']
      },
      archive: {
        extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
        mimeTypes: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip']
      },
      code: {
        extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb', 'php', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sh', 'bash', 'sql'],
        mimeTypes: ['application/javascript', 'text/javascript', 'text/typescript', 'text/plain', 'text/html', 'text/css']
      }
    };

    this.maxFileSize = 500 * 1024 * 1024; // 500MB
  }

  /**
   * ファイル名を修復（フォトライブラリ対応）
   * ★ Blob/File から拡張子がない場合は MIME タイプから推測
   */
  inferFileNameFromMimeType(file) {
    try {
      let fileName = file.name || 'file';

      // ファイル名に拡張子がない場合
      if (!fileName || !fileName.includes('.')) {
        const mimeType = file.type || 'application/octet-stream';
        
        // MIME タイプから拡張子を推測
        const mimeToExt = {
          'video/mp4': 'mp4',
          'video/quicktime': 'mov',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/heic': 'heic',
          'image/heif': 'heif',
          'audio/mpeg': 'mp3',
          'audio/wav': 'wav',
          'audio/ogg': 'ogg',
          'audio/mp4': 'm4a',
          'application/pdf': 'pdf',
          'application/zip': 'zip',
          'text/plain': 'txt',
          'text/html': 'html',
          'text/css': 'css',
          'application/json': 'json',
          'application/xml': 'xml',
        };

        const ext = mimeToExt[mimeType] || 'bin';
        fileName = `file_${Date.now()}.${ext}`;

        console.log(`[FILE_INFER] MIME type: ${mimeType} → Extension: ${ext}`);
        console.log(`[FILE_INFER] New filename: ${fileName}`);
      }

      return fileName;
    } catch (e) {
      console.error('[FILE_INFER] Error:', e.message);
      return `file_${Date.now()}`;
    }
  }

  /**
   * ファイル情報を取得（フォトライブラリ対応）
   */
  async getFileInfo(file) {
    try {
      if (!file) return null;

      // ★ ファイル名を修復
      const inferredName = this.inferFileNameFromMimeType(file);
      
      const fileType = this.getFileType(inferredName);
      const size = file.size;
      const sizeStr = this.formatSize(size);
      const mimeType = file.type || this.getMimeType(inferredName);

      console.log(`[FILE_INFO] OriginalName: ${file.name}, InferredName: ${inferredName}`);
      console.log(`[FILE_INFO] MIME: ${mimeType}, Type: ${fileType}, Size: ${sizeStr}`);

      return {
        originalName: file.name,
        name: inferredName,
        type: fileType,
        size: size,
        sizeStr: sizeStr,
        mimeType: mimeType,
        lastModified: file.lastModified,
        lastModifiedDate: new Date(file.lastModified)
      };
    } catch (e) {
      console.error('[FILE_INFO] Error:', e.message);
      return {
        originalName: file.name,
        name: `file_${Date.now()}`,
        type: 'file',
        size: file.size,
        sizeStr: this.formatSize(file.size),
        mimeType: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
        lastModifiedDate: new Date(file.lastModified)
      };
    }
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
   * ファイルサイズをフォーマット
   */
  formatSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * ファイルをバリデーション（詳細ログ付き）
   */
  async validateFiles(files) {
    const errors = [];
    const valid = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      console.log(`[VALIDATE] File ${i + 1}: ${file.name || 'unnamed'}`);

      // ファイルサイズチェック
      if (file.size > this.maxFileSize) {
        const msg = `${file.name}: ${this.formatSize(file.size)} (Max: ${this.formatSize(this.maxFileSize)})`;
        errors.push(msg);
        console.error(`[VALIDATE] Size error: ${msg}`);
        continue;
      }

      // ファイル名チェック
      if (!file.name && file.size === 0) {
        const msg = `File ${i + 1}: Empty or invalid file`;
        errors.push(msg);
        console.error(`[VALIDATE] Empty file error: ${msg}`);
        continue;
      }

      // ★ フォトライブラリ対応: 名前がない場合でも MIME タイプから判定
      const inferredName = this.inferFileNameFromMimeType(file);
      const fileType = this.getFileType(inferredName);

      console.log(`[VALIDATE] File ${i + 1} OK - Type: ${fileType}, Size: ${this.formatSize(file.size)}`);
      valid.push(file);
    }

    return { valid, errors };
  }

  /**
   * Base64 変換時のエラーハンドリング
   */
  async toBase64(file, onProgress) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();

        reader.onloadstart = () => {
          console.log(`[BASE64] Starting conversion for: ${file.name || 'unnamed'}`);
        };

        reader.onprogress = (event) => {
          const progress = Math.round((event.loaded / event.total) * 100);
          console.log(`[BASE64] Progress: ${progress}%`);
          if (onProgress) onProgress(progress);
        };

        reader.onload = () => {
          try {
            const result = reader.result;

            if (!result || typeof result !== 'string') {
              throw new Error('Invalid FileReader result');
            }

            const parts = result.split(',');
            if (parts.length < 2) {
              throw new Error('Invalid data URL format');
            }

            const base64 = parts[1];
            if (!base64 || base64.length === 0) {
              throw new Error('Empty Base64 data');
            }

            console.log(`[BASE64] Conversion successful: ${base64.length} chars`);
            resolve(base64);
          } catch (e) {
            console.error(`[BASE64] Parsing error: ${e.message}`);
            reject(e);
          }
        };

        reader.onerror = () => {
          const errorMsg = reader.error ? reader.error.message : 'Unknown error';
          console.error(`[BASE64] FileReader error: ${errorMsg}`);
          reject(new Error(`FileReader error: ${errorMsg}`));
        };

        reader.onabort = () => {
          console.error(`[BASE64] FileReader aborted`);
          reject(new Error('FileReader aborted'));
        };

        console.log(`[BASE64] Starting FileReader for: ${file.name || 'unnamed'} (${this.formatSize(file.size)})`);
        reader.readAsDataURL(file);

        // ★ タイムアウト設定（30秒）
        const timeout = setTimeout(() => {
          console.error(`[BASE64] Timeout after 30 seconds`);
          reader.abort();
          reject(new Error('Base64 conversion timeout (30s)'));
        }, 30000);

        // 完了時にタイムアウトをクリア
        const originalOnload = reader.onload;
        reader.onload = function() {
          clearTimeout(timeout);
          originalOnload.call(this);
        };

      } catch (e) {
        console.error(`[BASE64] Error: ${e.message}`);
        reject(e);
      }
    });
  }

  /**
   * ファイル情報を詳細ログ出力
   */
  logFileDetails(file, index) {
    try {
      console.log(`\n[FILE_DETAILS] ========== File ${index + 1} ==========`);
      console.log(`[FILE_DETAILS] Name: ${file.name || 'unnamed'}`);
      console.log(`[FILE_DETAILS] Type: ${file.type || 'unknown'}`);
      console.log(`[FILE_DETAILS] Size: ${this.formatSize(file.size)} (${file.size} bytes)`);
      console.log(`[FILE_DETAILS] LastModified: ${new Date(file.lastModified).toISOString()}`);
      console.log(`[FILE_DETAILS] Is Blob: ${file instanceof Blob}`);
      console.log(`[FILE_DETAILS] Is File: ${file instanceof File}`);
      console.log(`[FILE_DETAILS] ==============================\n`);
    } catch (e) {
      console.error('[FILE_DETAILS] Error logging file details:', e.message);
    }
  }

  /**
   * デバイス情報を取得
   */
  getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
      isIOS: /iPad|iPhone|iPod/.test(ua),
      isAndroid: /Android/.test(ua),
      isMobile: /iPad|iPhone|iPod|Android/.test(ua),
      isChrome: /Chrome/.test(ua),
      isSafari: /Safari/.test(ua),
      isFirefox: /Firefox/.test(ua),
      userAgent: ua
    };
  }
}

window.UniversalFileUploaderEnhanced = UniversalFileUploaderEnhanced;

console.log('[UPLOADER_ENHANCED] Initialized - Photo Library support enabled');
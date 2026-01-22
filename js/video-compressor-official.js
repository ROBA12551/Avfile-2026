/**
 * js/video-compressor-official.js
 * ★ FFmpeg.wasm 公式ドキュメント対応版（createFFmpeg API）
 * https://ffmpegwasm.netlify.app/ を参照
 * 720p/30fps + 低ビットレート設定で最大50-80%の圧縮
 */

class VideoCompressor {
  constructor() {
    this.ffmpeg = null;
    this.isLoaded = false;
    this.isLoading = false;
    
    this.VIDEO_COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB以上は圧縮
    
    // ★ 圧縮設定
    this.COMPRESSION_SETTINGS = {
      resolution: '1280x720',      // 720p
      fps: 30,                      // 30fps
      videoBitrate: '800k',         // 800kbps
      audioBitrate: '64k',          // 64kbps
      audioSampleRate: '44100',     // 44.1kHz
      codec: 'libx264',            // H.264 codec
      preset: 'faster',            // 圧縮速度重視
      crf: 23                       // CRF値
    };

    // ★ 対応動画形式
    this.SUPPORTED_VIDEO_FORMATS = {
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
      'ogv': 'video/ogg',
      'ogg': 'video/ogg',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv',
      '3gp': 'video/3gpp',
      '3g2': 'video/3gpp2',
      'ts': 'video/mp2t',
      'm2ts': 'video/mp2t',
      'mts': 'video/mp2t',
      'mpg': 'video/mpeg',
      'mpeg': 'video/mpeg',
      'm4v': 'video/x-m4v',
      'asf': 'video/x-ms-asf',
      'vob': 'video/x-vob'
    };

    // ★ FFmpeg.wasmの読み込みを待機（遅延初期化）
    this.scheduleInitFFmpeg();
  }

  /**
   * FFmpeg.wasmの読み込みを待機
   */
  scheduleInitFFmpeg() {
    console.log('[VIDEO_COMPRESSOR] Scheduling FFmpeg initialization...');
    console.log('[VIDEO_COMPRESSOR] Checking for FFmpeg.createFFmpeg...');
    console.log('[VIDEO_COMPRESSOR] typeof FFmpeg:', typeof FFmpeg);
    
    if (typeof FFmpeg !== 'undefined' && FFmpeg && FFmpeg.createFFmpeg && FFmpeg.fetchFile) {
      console.log('[VIDEO_COMPRESSOR] ✓ FFmpeg.wasm immediately available, initializing...');
      // 次のティックで初期化（メインスクリプトが準備されるまで待つ）
      setTimeout(() => this.initFFmpeg(), 0);
      return;
    }
    
    console.log('[VIDEO_COMPRESSOR] FFmpeg.wasm not yet available, waiting...');
    
    let waitCount = 0;
    const maxWait = 120; // 120 * 500ms = 60秒
    
    const checkFFmpeg = setInterval(() => {
      waitCount++;
      const isAvailable = typeof FFmpeg !== 'undefined' && 
                         FFmpeg && 
                         FFmpeg.createFFmpeg && 
                         FFmpeg.fetchFile;
      
      if (waitCount % 5 === 1) {
        console.log(`[VIDEO_COMPRESSOR] Checking FFmpeg... (${waitCount}/${maxWait}, available: ${isAvailable})`);
      }
      
      if (isAvailable) {
        clearInterval(checkFFmpeg);
        console.log('[VIDEO_COMPRESSOR] ✓ FFmpeg.wasm detected, initializing...');
        this.initFFmpeg();
      } else if (waitCount > maxWait) {
        clearInterval(checkFFmpeg);
        console.error('[VIDEO_COMPRESSOR] ✗ FFmpeg.wasm not found after 60 seconds');
        this.isLoading = false;
      }
    }, 500);
  }

  /**
   * ★ FFmpeg.wasm createFFmpeg API を使用した初期化
   */
  async initFFmpeg() {
    if (this.isLoaded || this.isLoading) {
      console.log('[VIDEO_COMPRESSOR] FFmpeg init already in progress');
      return;
    }
    
    this.isLoading = true;

    try {
      console.log('[VIDEO_COMPRESSOR] FFmpeg init starting...');
      
      // ★ createFFmpeg関数が利用可能か確認
      if (typeof FFmpeg === 'undefined' || !FFmpeg) {
        throw new Error('FFmpeg global object not available');
      }

      if (!FFmpeg.createFFmpeg) {
        throw new Error('FFmpeg.createFFmpeg function not available');
      }

      if (!FFmpeg.fetchFile) {
        throw new Error('FFmpeg.fetchFile function not available');
      }

      console.log('[VIDEO_COMPRESSOR] FFmpeg methods available');

      // ★ 1. FFmpegインスタンスを作成（createFFmpeg API）
      console.log('[VIDEO_COMPRESSOR] Creating FFmpeg instance with createFFmpeg...');
      this.ffmpeg = FFmpeg.createFFmpeg({
        log: true,  // ログ出力を有効にする
        corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js'
      });

      console.log('[VIDEO_COMPRESSOR] FFmpeg instance created successfully');

      // ★ 2. FFmpegのロード（Coreファイルをダウンロード・準備する）
      console.log('[VIDEO_COMPRESSOR] Loading FFmpeg WASM core...');
      await this.ffmpeg.load();

      this.isLoaded = true;
      this.isLoading = false;
      console.log('[VIDEO_COMPRESSOR] ✓✓✓ FFmpeg LOADED SUCCESSFULLY ✓✓✓');
      console.log('[VIDEO_COMPRESSOR] Ready for video compression now!');

    } catch (error) {
      this.isLoading = false;
      this.isLoaded = false;
      console.error('[VIDEO_COMPRESSOR] ✗ Failed to initialize FFmpeg:', error.message);
      console.error('[VIDEO_COMPRESSOR] Error details:', error);
    }
  }

  /**
   * 動画ファイルが圧縮対象か判定
   */
  shouldCompress(file) {
    if (!this.isLoaded) {
      console.log('[VIDEO_COMPRESSOR] FFmpeg not loaded, skipping compression');
      return false;
    }

    const ext = this.getFileExtension(file.name).toLowerCase();
    const isVideoFile = (file.type && file.type.startsWith('video/')) || 
                        this.SUPPORTED_VIDEO_FORMATS[ext];
    const isLargeFile = file.size > this.VIDEO_COMPRESSION_THRESHOLD;
    
    const shouldCompress = isVideoFile && isLargeFile;
    console.log('[VIDEO_COMPRESSOR] Compression decision:', {
      file: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + 'MB',
      isVideo: isVideoFile,
      isLarge: isLargeFile,
      shouldCompress: shouldCompress
    });

    return shouldCompress;
  }

  /**
   * ★ 動画を圧縮（createFFmpeg API準拠）
   */
  async compressVideo(file, onProgress = () => {}) {
    if (!this.isLoaded) {
      throw new Error('FFmpeg not loaded');
    }

    try {
      const inputExt = this.getFileExtension(file.name);
      const outputFormat = this.getOutputFormat(file.name);
      const inputFileName = `input.${inputExt}`;
      const outputFileName = `output.${outputFormat}`;

      console.log('[VIDEO_COMPRESSOR] Starting compression:', {
        input: inputFileName,
        output: outputFileName,
        originalSize: (file.size / 1024 / 1024).toFixed(2) + 'MB'
      });

      onProgress(5, 'ファイルを読み込み中...');

      // ★ ファイルを FFmpeg FileSystem に書き込み
      console.log('[VIDEO_COMPRESSOR] Writing file to FFmpeg FS...');
      await this.ffmpeg.FS('writeFile', inputFileName, await FFmpeg.fetchFile(file));
      console.log('[VIDEO_COMPRESSOR] File written successfully');

      onProgress(10, 'ビデオエンコード中...');

      // ★ FFmpeg コマンド実行（run API）
      const audioCodec = this.getAudioCodec(outputFormat);
      console.log('[VIDEO_COMPRESSOR] Executing FFmpeg command...');
      
      await this.ffmpeg.run(
        '-i', inputFileName,
        '-vf', `scale=${this.COMPRESSION_SETTINGS.resolution}`,
        '-r', String(this.COMPRESSION_SETTINGS.fps),
        '-c:v', this.COMPRESSION_SETTINGS.codec,
        '-preset', this.COMPRESSION_SETTINGS.preset,
        '-crf', String(this.COMPRESSION_SETTINGS.crf),
        '-b:v', this.COMPRESSION_SETTINGS.videoBitrate,
        '-c:a', audioCodec,
        '-b:a', this.COMPRESSION_SETTINGS.audioBitrate,
        '-ar', this.COMPRESSION_SETTINGS.audioSampleRate,
        outputFileName
      );

      console.log('[VIDEO_COMPRESSOR] FFmpeg command completed');
      onProgress(85, '圧縮ファイルを取得中...');

      // ★ ファイルを読み出す
      console.log('[VIDEO_COMPRESSOR] Reading compressed file...');
      const data = await this.ffmpeg.FS('readFile', outputFileName);
      const mimeType = this.getMimeType(outputFormat);
      const compressedBlob = new Blob([data.buffer], { type: mimeType });

      // ★ ファイルを削除（クリーンアップ）
      console.log('[VIDEO_COMPRESSOR] Cleaning up temporary files...');
      await this.ffmpeg.FS('unlink', inputFileName);
      await this.ffmpeg.FS('unlink', outputFileName);

      const originalSize = file.size;
      const compressedSize = compressedBlob.size;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log('[VIDEO_COMPRESSOR] ✓ Compression complete:', {
        original: (originalSize / 1024 / 1024).toFixed(2) + 'MB',
        compressed: (compressedSize / 1024 / 1024).toFixed(2) + 'MB',
        ratio: compressionRatio + '%'
      });

      onProgress(100, `圧縮完了！（${compressionRatio}%削減）`);

      return {
        blob: compressedBlob,
        originalSize: originalSize,
        compressedSize: compressedSize,
        compressionRatio: compressionRatio,
        fileName: `compressed_${this.getFileNameWithoutExt(file.name)}.${outputFormat}`,
        outputFormat: outputFormat
      };

    } catch (error) {
      console.error('[VIDEO_COMPRESSOR] ✗ Compression failed:', error.message);
      console.error('[VIDEO_COMPRESSOR] Error details:', error);
      throw error;
    }
  }

  /**
   * ファイル拡張子を取得
   */
  getFileExtension(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'mp4';
    return fileName.split('.').pop().toLowerCase();
  }

  /**
   * 出力形式を決定
   */
  getOutputFormat(inputFileName) {
    const ext = this.getFileExtension(inputFileName);
    if (ext === 'webm' || ext === 'ogv' || ext === 'ogg') {
      return ext;
    }
    return 'mp4';
  }

  /**
   * オーディオコーデックを自動選択
   */
  getAudioCodec(outputFormat) {
    switch(outputFormat) {
      case 'webm':
        return 'libopus';
      case 'ogv':
      case 'ogg':
        return 'libvorbis';
      default:
        return 'aac';
    }
  }

  /**
   * MIMEタイプを取得
   */
  getMimeType(format) {
    const mimeMap = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogv': 'video/ogg',
      'ogg': 'video/ogg',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska'
    };
    return mimeMap[format] || 'video/mp4';
  }

  /**
   * ファイル名から拡張子を除去
   */
  getFileNameWithoutExt(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'file';
    return fileName.substring(0, fileName.lastIndexOf('.'));
  }
}

// ★ グローバルインスタンス作成（遅延初期化対応）
window.videoCompressor = new VideoCompressor();

console.log('[VIDEO_COMPRESSOR] VideoCompressor class instantiated, waiting for FFmpeg.wasm...');
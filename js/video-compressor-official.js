/**
 * js/video-compressor-official.js
 * ★ FFmpeg.wasm 完全準拠版（CDN読み込み + createFFmpeg/fetchFile）
 * https://ffmpegwasm.netlify.app/ を参照
 * 720p/30fps + 低ビットレート設定で最大50-80%の圧縮
 */

const { createFFmpeg, fetchFile } = FFmpeg;

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

    console.log('[VIDEO_COMPRESSOR] Class initialized');
    console.log('[VIDEO_COMPRESSOR] Checking FFmpeg availability...');
    
    // FFmpeg CDN スクリプトが読み込まれているか確認
    if (typeof FFmpeg === 'undefined') {
      console.error('[VIDEO_COMPRESSOR] ✗ FFmpeg not found - CDN script may not be loaded');
    } else if (!FFmpeg.createFFmpeg) {
      console.error('[VIDEO_COMPRESSOR] ✗ createFFmpeg not found');
    } else if (!FFmpeg.fetchFile) {
      console.error('[VIDEO_COMPRESSOR] ✗ fetchFile not found');
    } else {
      console.log('[VIDEO_COMPRESSOR] ✓ FFmpeg CDN loaded successfully');
      this.initFFmpeg();
    }
  }

  /**
   * ★ FFmpeg.wasm 初期化（createFFmpeg + fetchFile）
   */
  async initFFmpeg() {
    if (this.isLoaded || this.isLoading) {
      console.log('[VIDEO_COMPRESSOR] FFmpeg init already in progress');
      return;
    }
    
    this.isLoading = true;

    try {
      console.log('[VIDEO_COMPRESSOR] Creating FFmpeg instance...');
      
      // ★ 1. createFFmpeg でインスタンス作成
      this.ffmpeg = createFFmpeg({
        log: true,  // ログ出力を有効にする
        corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js'
      });

      console.log('[VIDEO_COMPRESSOR] FFmpeg instance created');

      // ★ 2. load() で Coreファイルをロード
      console.log('[VIDEO_COMPRESSOR] Loading FFmpeg core...');
      await this.ffmpeg.load();

      this.isLoaded = true;
      this.isLoading = false;
      console.log('[VIDEO_COMPRESSOR] ✓✓✓ FFmpeg LOADED SUCCESSFULLY ✓✓✓');

    } catch (error) {
      this.isLoading = false;
      this.isLoaded = false;
      console.error('[VIDEO_COMPRESSOR] ✗ Failed to initialize FFmpeg:', error.message);
      console.error('[VIDEO_COMPRESSOR] Error:', error);
    }
  }

  /**
   * 動画ファイルが圧縮対象か判定
   */
  shouldCompress(file) {
    if (!this.isLoaded) {
      return false;
    }

    const ext = this.getFileExtension(file.name).toLowerCase();
    const isVideoFile = (file.type && file.type.startsWith('video/')) || 
                        this.SUPPORTED_VIDEO_FORMATS[ext];
    const isLargeFile = file.size > this.VIDEO_COMPRESSION_THRESHOLD;
    
    return isVideoFile && isLargeFile;
  }

  /**
   * ★ 動画を圧縮
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

      console.log('[VIDEO_COMPRESSOR] Starting compression:', file.name);

      onProgress(5, 'Reading file...');
      
      // ★ 3. fetchFile でファイルを読み込み、FS('writeFile') で書き込み
      const fileData = await fetchFile(file);
      await this.ffmpeg.FS('writeFile', inputFileName, fileData);

      onProgress(10, 'Encoding...');
      
      // ★ 4. run() でFFmpegコマンド実行
      const audioCodec = this.getAudioCodec(outputFormat);
      
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

      onProgress(85, 'Finalizing...');
      
      // ★ 5. FS('readFile') で出力ファイルを読み込み
      const data = this.ffmpeg.FS('readFile', outputFileName);
      const mimeType = this.getMimeType(outputFormat);
      const compressedBlob = new Blob([data.buffer], { type: mimeType });

      // ★ 6. FS('unlink') でクリーンアップ
      this.ffmpeg.FS('unlink', inputFileName);
      this.ffmpeg.FS('unlink', outputFileName);

      const originalSize = file.size;
      const compressedSize = compressedBlob.size;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log('[VIDEO_COMPRESSOR] ✓ Compressed:', compressionRatio + '%');
      onProgress(100, `Done! (${compressionRatio}% reduction)`);

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
      throw error;
    }
  }

  getFileExtension(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'mp4';
    return fileName.split('.').pop().toLowerCase();
  }

  getOutputFormat(inputFileName) {
    const ext = this.getFileExtension(inputFileName);
    if (ext === 'webm' || ext === 'ogv' || ext === 'ogg') return ext;
    return 'mp4';
  }

  getAudioCodec(outputFormat) {
    switch(outputFormat) {
      case 'webm': return 'libopus';
      case 'ogv':
      case 'ogg': return 'libvorbis';
      default: return 'aac';
    }
  }

  getMimeType(format) {
    const mimeMap = {
      'mp4': 'video/mp4', 'webm': 'video/webm', 'ogv': 'video/ogg',
      'ogg': 'video/ogg', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska'
    };
    return mimeMap[format] || 'video/mp4';
  }

  getFileNameWithoutExt(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'file';
    return fileName.substring(0, fileName.lastIndexOf('.'));
  }
}

// ★ グローバルインスタンス作成
window.videoCompressor = new VideoCompressor();

console.log('[VIDEO_COMPRESSOR] Ready');
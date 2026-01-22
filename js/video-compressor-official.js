/**
 * js/video-compressor-official.js
 * ★ FFmpeg.wasm 公式ドキュメント対応版
 * https://ffmpegwasm.netlify.app/ を参照
 * 720p/30fps + 低ビットレート設定で最大50-80%の圧縮
 */

const { FFmpeg, fetchFile } = FFmpeg;

class VideoCompressor {
  constructor() {
    this.ffmpeg = new FFmpeg.FFmpeg();
    this.isLoaded = false;
    
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

    this.initFFmpeg();
  }

  /**
   * ★ 公式ドキュメント通りのFFmpeg初期化
   */
  async initFFmpeg() {
    try {
      // ★ ログメッセージの設定
      this.ffmpeg.on('log', ({ type, message }) => {
        console.log('[FFMPEG]', message);
      });

      // ★ プログレスの設定
      this.ffmpeg.on('progress', ({ ratio }) => {
        console.log('[FFMPEG_PROGRESS]', Math.round(ratio * 100) + '%');
      });

      // ★ 公式推奨: CoreURL を明示的に指定
      await this.ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm',
      });

      this.isLoaded = true;
      console.log('[VIDEO_COMPRESSOR] ✓ FFmpeg loaded successfully');

    } catch (error) {
      console.error('[VIDEO_COMPRESSOR] ✗ Failed to load FFmpeg:', error.message);
      this.isLoaded = false;
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
    const isVideoFile = file.type && file.type.startsWith('video/') || 
                        this.SUPPORTED_VIDEO_FORMATS[ext];
    const isLargeFile = file.size > this.VIDEO_COMPRESSION_THRESHOLD;
    
    const shouldCompress = isVideoFile && isLargeFile;
    console.log('[VIDEO_COMPRESSOR] Check:', {
      file: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + 'MB',
      video: isVideoFile,
      large: isLargeFile,
      compress: shouldCompress
    });

    return shouldCompress;
  }

  /**
   * ★ 動画を圧縮（公式ドキュメント準拠）
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
      await this.ffmpeg.writeFile(inputFileName, await fetchFile(file));
      console.log('[VIDEO_COMPRESSOR] File written');

      onProgress(10, 'ビデオエンコード中...');

      // ★ FFmpeg コマンド実行（公式推奨形式）
      const audioCodec = this.getAudioCodec(outputFormat);
      const command = [
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
      ];

      console.log('[VIDEO_COMPRESSOR] Running FFmpeg command');
      await this.ffmpeg.exec(command);

      onProgress(85, '圧縮ファイルを取得中...');

      // ★ ファイルを読み出す
      const data = await this.ffmpeg.readFile(outputFileName);
      const mimeType = this.getMimeType(outputFormat);
      const compressedBlob = new Blob([data.buffer], { type: mimeType });

      // ★ ファイルを削除
      await this.ffmpeg.deleteFile(inputFileName);
      await this.ffmpeg.deleteFile(outputFileName);

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
      throw error;
    }
  }

  /**
   * ファイル拡張子を取得
   */
  getFileExtension(fileName) {
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
    return fileName.substring(0, fileName.lastIndexOf('.'));
  }
}

// ★ グローバルインスタンス作成
window.videoCompressor = new VideoCompressor();

console.log('[VIDEO_COMPRESSOR] Initialized');
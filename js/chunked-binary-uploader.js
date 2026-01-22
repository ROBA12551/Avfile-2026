/**
 * js/video-compressor.js
 * ★ FFmpeg.wasm を使用した動画圧縮
 * 720p/30fps + 低ビットレート設定で最大50-80%の圧縮
 * 対応形式: MP4, MOV, AVI, MKV, WebM, OGV, FLV, WMV, 3GP等
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
      videoBitrate: '800k',         // 800kbps（低圧縮）
      audioBitrate: '64k',          // 64kbps
      audioSampleRate: '44100',     // 44.1kHz
      codec: 'libx264',            // H.264 codec
      preset: 'faster',            // 圧縮速度重視（faster > fast > medium）
      crf: 23                       // CRF値 (0-51, 低いほど高品質)
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
   * FFmpeg.wasmの初期化
   */
  async initFFmpeg() {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      const { FFmpeg, fetchFile } = FFmpeg;
      this.ffmpeg = new FFmpeg.FFmpeg();

      console.log('[VIDEO_COMPRESSOR] Loading FFmpeg...');
      
      this.ffmpeg.on('log', ({ type, message }) => {
        if (type === 'error') {
          console.error('[FFMPEG]', message);
        } else {
          console.log('[FFMPEG]', message);
        }
      });

      this.ffmpeg.on('progress', (progress) => {
        console.log('[FFMPEG_PROGRESS]', {
          currentTime: progress.currentTime,
          ratio: progress.ratio,
          percent: Math.round(progress.ratio * 100) + '%'
        });
      });

      await this.ffmpeg.load();
      this.isLoaded = true;
      console.log('[VIDEO_COMPRESSOR] FFmpeg loaded successfully');
    } catch (error) {
      console.error('[VIDEO_COMPRESSOR] Failed to load FFmpeg:', error);
      this.isLoading = false;
    }
  }

  /**
   * 動画ファイルが圧縮対象か判定
   */
  shouldCompress(file) {
    const ext = this.getFileExtension(file.name).toLowerCase();
    const isVideoFile = file.type && file.type.startsWith('video/') || 
                        this.SUPPORTED_VIDEO_FORMATS[ext];
    const isLargeFile = file.size > this.VIDEO_COMPRESSION_THRESHOLD;
    
    console.log('[VIDEO_COMPRESSOR] Compression check:', {
      fileName: file.name,
      fileExt: ext,
      fileSize: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      isVideo: isVideoFile,
      isLarge: isLargeFile,
      shouldCompress: isVideoFile && isLargeFile,
      mimeType: file.type
    });

    return isVideoFile && isLargeFile;
  }

  /**
   * ファイル拡張子を取得
   */
  getFileExtension(fileName) {
    return fileName.split('.').pop().toLowerCase();
  }

  /**
   * ファイル形式がサポートされているか判定
   */
  isFormatSupported(fileName) {
    const ext = this.getFileExtension(fileName);
    return ext in this.SUPPORTED_VIDEO_FORMATS;
  }

  /**
   * 出力形式を決定（サポートされていない形式はMP4に変換）
   */
  getOutputFormat(inputFileName) {
    const ext = this.getFileExtension(inputFileName);
    
    // ★ WebM, OGV以外はMP4に統一（互換性向上）
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
        return 'libopus';  // WebMはOpus推奨
      case 'ogv':
      case 'ogg':
        return 'libvorbis'; // OGVはVorbis推奨
      default:
        return 'aac';       // MP4はAAC
    }
  }

  /**
   * ★ 動画を圧縮（複数形式対応）
   */
  async compressVideo(file, onProgress = () => {}) {
    try {
      // ★ FFmpegの初期化待機
      if (!this.isLoaded) {
        console.log('[VIDEO_COMPRESSOR] Waiting for FFmpeg to load...');
        onProgress(0, '動画圧縮エンジンを初期化中...');
        
        let attempts = 0;
        while (!this.isLoaded && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }

        if (!this.isLoaded) {
          throw new Error('Failed to load FFmpeg after timeout');
        }
      }

      const inputExt = this.getFileExtension(file.name);
      const outputFormat = this.getOutputFormat(file.name);
      const inputFileName = `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${inputExt}`;
      const outputFileName = `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${outputFormat}`;

      console.log('[VIDEO_COMPRESSOR] Starting compression:', {
        inputFile: inputFileName,
        outputFile: outputFileName,
        inputFormat: inputExt,
        outputFormat: outputFormat,
        originalSize: (file.size / 1024 / 1024).toFixed(2) + ' MB',
        settings: this.COMPRESSION_SETTINGS
      });

      onProgress(5, 'ファイルを読み込み中...');

      // ★ ファイルをFFmpeg FileSystemに書き込み
      const fileData = await file.arrayBuffer();
      this.ffmpeg.FS('writeFile', inputFileName, new Uint8Array(fileData));

      console.log('[VIDEO_COMPRESSOR] File written to FFmpeg FS');
      onProgress(10, 'ビデオエンコード中...');

      // ★ 出力形式に応じたFFmpegコマンド生成
      const audioCodec = this.getAudioCodec(outputFormat);
      const ffmpegCommand = this.buildFFmpegCommand(
        inputFileName,
        outputFileName,
        outputFormat,
        audioCodec
      );

      console.log('[VIDEO_COMPRESSOR] Executing FFmpeg command:', ffmpegCommand.join(' '));
      
      await this.ffmpeg.run(...ffmpegCommand);

      console.log('[VIDEO_COMPRESSOR] Encoding completed');
      onProgress(85, '圧縮ファイルを取得中...');

      // ★ 圧縮後のファイルを取得
      const compressedData = this.ffmpeg.FS('readFile', outputFileName);
      
      // ★ 出力形式に応じたMIMEタイプ設定
      const mimeType = this.getMimeType(outputFormat);
      const compressedBlob = new Blob([compressedData.buffer], { type: mimeType });

      // ★ ファイルシステムをクリーンアップ
      try {
        this.ffmpeg.FS('unlink', inputFileName);
        this.ffmpeg.FS('unlink', outputFileName);
      } catch (e) {
        console.warn('[VIDEO_COMPRESSOR] Cleanup warning:', e.message);
      }

      const originalSize = file.size;
      const compressedSize = compressedBlob.size;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log('[VIDEO_COMPRESSOR] Compression complete:', {
        originalSize: (originalSize / 1024 / 1024).toFixed(2) + ' MB',
        compressedSize: (compressedSize / 1024 / 1024).toFixed(2) + ' MB',
        compressionRatio: compressionRatio + '%',
        outputFormat: outputFormat
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
      console.error('[VIDEO_COMPRESSOR] Error:', error.message);
      throw new Error(`Video compression failed: ${error.message}`);
    }
  }

  /**
   * FFmpegコマンドを生成（形式別最適化）
   */
  buildFFmpegCommand(inputFile, outputFile, outputFormat, audioCodec) {
    const baseCommand = [
      '-i', inputFile,
      '-vf', `scale=${this.COMPRESSION_SETTINGS.resolution}`, // 解像度変更
      '-r', String(this.COMPRESSION_SETTINGS.fps),            // フレームレート変更
      '-c:v', this.COMPRESSION_SETTINGS.codec,                // ビデオコーデック
      '-preset', this.COMPRESSION_SETTINGS.preset,            // 圧縮プリセット
      '-crf', String(this.COMPRESSION_SETTINGS.crf),          // 品質
      '-b:v', this.COMPRESSION_SETTINGS.videoBitrate,         // ビデオビットレート
      '-c:a', audioCodec,                                     // オーディオコーデック
      '-b:a', this.COMPRESSION_SETTINGS.audioBitrate,         // オーディオビットレート
      '-ar', this.COMPRESSION_SETTINGS.audioSampleRate        // サンプリングレート
    ];

    // ★ 形式別の追加オプション
    if (outputFormat === 'webm') {
      return [
        ...baseCommand,
        '-deadline', 'good',      // WebMの圧縮レベル
        '-y',
        outputFile
      ];
    } else if (outputFormat === 'ogv' || outputFormat === 'ogg') {
      return [
        ...baseCommand,
        '-q:a', '6',              // OGVの品質
        '-y',
        outputFile
      ];
    } else {
      // MP4とその他形式（デフォルト）
      return [
        ...baseCommand,
        '-movflags', 'faststart', // ストリーミング最適化
        '-y',
        outputFile
      ];
    }
  }

  /**
   * ファイル名から拡張子を除去
   */
  getFileNameWithoutExt(fileName) {
    return fileName.substring(0, fileName.lastIndexOf('.'));
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
   * ビデオ情報を取得（メタデータ）
   */
  async getVideoInfo(file) {
    try {
      if (!this.isLoaded) {
        await this.initFFmpeg();
      }

      const inputFileName = `info_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const fileData = await file.arrayBuffer();
      this.ffmpeg.FS('writeFile', inputFileName, new Uint8Array(fileData));

      // ffprobeコマンド実行
      await this.ffmpeg.run('-i', inputFileName);

      this.ffmpeg.FS('unlink', inputFileName);

      return {
        fileName: file.name,
        fileSize: file.size,
        duration: 'N/A'
      };
    } catch (error) {
      console.error('[VIDEO_INFO] Error:', error);
      return null;
    }
  }
}

// ★ グローバルインスタンス作成
window.videoCompressor = new VideoCompressor();

console.log('[VIDEO_COMPRESSOR] Initialized - Video compression support enabled');
console.log('[VIDEO_COMPRESSOR] Settings:', {
  resolution: '1280x720',
  fps: 30,
  videoBitrate: '800kbps',
  compressionThreshold: '50MB'
});
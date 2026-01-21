/**
 * js/video-compression.js
 * 
 * 動画圧縮エンジン
 * 702p 30fps で最適化
 * インターネット配信に最適なサイズに自動圧縮
 */

class VideoCompressionEngine {
  constructor(config = {}) {
    this.ffmpeg = null;
    this.isReady = false;
    this.config = {
      // 解像度: 702p (1244x702 または 1280x720 相当)
      maxWidth: 1280,
      maxHeight: 720,
      
      // フレームレート: 30fps
      fps: 30,
      
      // ビットレート設定
      videoBitrate: '1500k',    // 1500 kbps（高品質）
      audioBitrate: '128k',     // 128 kbps（標準）
      
      // コーデック
      videoCodec: 'libx264',    // H.264（最も互換性高い）
      audioCodec: 'aac',        // AAC（標準）
      
      // エンコード品質
      preset: 'medium',         // fast/medium/slow（品質とトレードオフ）
      crf: 23,                  // 0-51（低いほど高品質、23=デフォルト）
      
      // 最大ファイルサイズ: 100MB
      maxOutputSize: 100 * 1024 * 1024,
      
      // その他設定
      movflags: 'faststart',    // 動画ストリーミング最適化
      ...config,
    };

    console.log('🎥 VideoCompressionEngine initialized');
    console.log(`Resolution: ${this.config.maxWidth}x${this.config.maxHeight}`);
    console.log(`FPS: ${this.config.fps}`);
    console.log(`Video Bitrate: ${this.config.videoBitrate}`);
    console.log(`Audio Bitrate: ${this.config.audioBitrate}`);
  }

  /**
   * ファイルを読み込み（Uint8Array）
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        resolve(new Uint8Array(e.target.result));
      };

      reader.onerror = (error) => {
        console.error('❌ File read error:', error);
        reject(error);
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 動画ファイルか判定
   */
  isVideoFile(file) {
    const videoMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/3gpp',
      'video/x-flv',
      'application/x-mpegURL',
    ];

    return videoMimes.some(mime => file.type.startsWith(mime));
  }

  /**
   * 動画を圧縮
   */
  async compress(file, onProgress = () => {}) {
    try {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
      console.log(`📥 File: ${file.name} (${fileSizeMB}MB)`);
      
      onProgress(5, 'Checking file...');

      // ファイルサイズ確認
      const maxSize = 500 * 1024 * 1024; // 500MB まで圧縮対象
      if (file.size > maxSize) {
        throw new Error(`File size (${fileSizeMB}MB) exceeds ${maxSize / 1024 / 1024}MB limit`);
      }

      // ビデオファイルか確認
      const isVideo = this.isVideoFile(file);

      if (isVideo) {
        console.log('✅ Video file detected - attempting compression');
        return await this.compressVideo(file, onProgress);
      } else {
        console.log('⚠️ Not a video file - returning as-is');
        onProgress(100, 'Ready');
        return file;
      }
    } catch (error) {
      console.error('❌ Compression error:', error.message);
      throw error;
    }
  }

  /**
   * FFmpeg で動画を圧縮
   */
  async compressVideo(file, onProgress = () => {}) {
    try {
      // FFmpeg が利用可能か確認
      if (!window.FFmpeg || !window.FFmpeg.FFmpeg) {
        console.warn('⚠️ FFmpeg not available - using fallback');
        return await this.fallbackCompress(file, onProgress);
      }

      console.log('🚀 Starting FFmpeg compression...');

      const FFmpeg = window.FFmpeg.FFmpeg;
      const { FileSystemFlags } = window.FFmpeg;

      this.ffmpeg = new FFmpeg();

      onProgress(10, 'Loading FFmpeg...');

      // FFmpeg をロード
      await this.ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm',
      });

      console.log('✅ FFmpeg loaded');

      onProgress(20, 'Reading file...');

      // ファイルをメモリに読み込み
      const fileData = await this.readFile(file);
      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      this.ffmpeg.FS('writeFile', inputFileName, fileData);
      console.log('✅ File written to FFmpeg filesystem');

      onProgress(30, 'Analyzing video...');

      // FFmpeg コマンド: 702p 30fps で圧縮
      const ffmpegArgs = [
        '-i', inputFileName,
        
        // 動画フィルター: スケーリング
        '-vf', `scale=${this.config.maxWidth}:${this.config.maxHeight}:flags=lanczos`,
        
        // フレームレート: 30fps
        '-r', String(this.config.fps),
        
        // ビデオコーデック: H.264
        '-c:v', this.config.videoCodec,
        
        // ビットレート: 1500kbps（702p 30fps に最適）
        '-b:v', this.config.videoBitrate,
        
        // 品質パラメータ
        '-crf', String(this.config.crf),
        
        // エンコード速度（fast/medium/slow）
        '-preset', this.config.preset,
        
        // オーディオコーデック: AAC
        '-c:a', this.config.audioCodec,
        
        // オーディオビットレート: 128kbps
        '-b:a', this.config.audioBitrate,
        
        // ストリーミング最適化
        '-movflags', this.config.movflags,
        
        // マルチスレッド処理
        '-threads', '4',
        
        // 出力ファイル
        outputFileName
      ];

      console.log('🔧 FFmpeg command:', ffmpegArgs.join(' '));

      onProgress(40, 'Compressing video...');

      // FFmpeg を実行
      await this.ffmpeg.run(...ffmpegArgs);

      console.log('✅ Compression complete');

      onProgress(80, 'Finalizing...');

      // 圧縮ファイルを取得
      const compressedData = this.ffmpeg.FS('readFile', outputFileName);
      const blob = new Blob([compressedData.buffer], { type: 'video/mp4' });

      const compressedSizeMB = (blob.size / 1024 / 1024).toFixed(1);
      const originalSizeMB = (file.size / 1024 / 1024).toFixed(1);
      const ratio = ((1 - blob.size / file.size) * 100).toFixed(1);

      console.log(`📊 Compression result:`);
      console.log(`   Original: ${originalSizeMB}MB`);
      console.log(`   Compressed: ${compressedSizeMB}MB`);
      console.log(`   Compression ratio: ${ratio}%`);

      // メモリクリーンアップ
      try {
        this.ffmpeg.FS('unlink', inputFileName);
        this.ffmpeg.FS('unlink', outputFileName);
        console.log('✅ Cleanup complete');
      } catch (e) {
        console.warn('⚠️ Cleanup warning:', e.message);
      }

      onProgress(100, 'Upload ready!');

      // 圧縮ファイルを返す
      return blob;
    } catch (error) {
      console.error('❌ FFmpeg compression failed:', error.message);
      console.log('⚠️ Falling back to simple compression');
      return await this.fallbackCompress(file, onProgress);
    }
  }

  /**
   * フォールバック圧縮（FFmpeg が利用できない場合）
   */
  async fallbackCompress(file, onProgress = () => {}) {
    try {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);

      onProgress(50, 'Optimizing file...');

      // 100MB 以下ならそのまま返す
      if (file.size <= 100 * 1024 * 1024) {
        console.log('✅ File size OK - using as-is');
        onProgress(100, 'Ready');
        return file;
      }

      // 100MB を超える場合はエラー
      throw new Error(`File too large (${fileSizeMB}MB). FFmpeg compression unavailable.`);
    } catch (error) {
      console.error('❌ Fallback compression failed:', error.message);
      throw error;
    }
  }
}

// グローバルに利用可能にする
window.VideoCompressionEngine = VideoCompressionEngine;
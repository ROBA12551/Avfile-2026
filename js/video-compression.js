/**
 * js/video-compression-local.js
 * ローカル（クライアント側）で完全に圧縮処理を行う
 * サーバーはBase64デコード→Gzipもしない、単純にGitHubアップロードのみ
 */

class VideoCompressionEngineLocal {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
    this.setupDeviceDetection();
  }

  setupDeviceDetection() {
    const ua = navigator.userAgent || '';
    
    console.log('[DEVICE] User-Agent:', ua.substring(0, 100));

    this.IS_IOS = /iPad|iPhone|iPod/.test(ua);
    this.IS_ANDROID = /Android/.test(ua);
    this.IS_SAFARI = /Safari/.test(ua) && !/Chrome|CriOS|Edg/.test(ua);
    this.IS_OPERA = /Opera|OPR/.test(ua);
    this.IS_FIREFOX = /Firefox/.test(ua);
    this.IS_MOBILE = this.IS_IOS || this.IS_ANDROID || /Mobile|Tablet|Kindle/.test(ua);
    this.SHOULD_SKIP = this.IS_MOBILE || this.IS_SAFARI || this.IS_OPERA;

    console.log('[DEVICE] Detection result:', {
      iOS: this.IS_IOS,
      Android: this.IS_ANDROID,
      Safari: this.IS_SAFARI,
      Mobile: this.IS_MOBILE,
      shouldSkip: this.SHOULD_SKIP,
    });

    if (this.SHOULD_SKIP) {
      console.log('⏭️ このデバイスではFFmpeg処理をスキップします');
    }
  }

  async initFFmpeg() {
    if (this.SHOULD_SKIP) {
      console.log('⏭️ モバイル/Safari - FFmpeg処理をスキップ');
      this.ffmpegReady = true;
      return;
    }

    if (this.ffmpegReady && this.ffmpeg && this.ffmpeg.isLoaded()) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      if (!window.FFmpeg || !window.FFmpeg.FFmpeg) {
        console.error('❌ window.FFmpeg が見つかりません');
        throw new Error('FFmpeg ライブラリが読み込まれていません');
      }

      const { FFmpeg } = window.FFmpeg;
      
      this.ffmpeg = new FFmpeg({ log: false });

      if (this.ffmpeg.isLoaded()) {
        console.log('✅ FFmpeg は既にロード済み');
        this.ffmpegReady = true;
        return;
      }

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      await this.ffmpeg.load();

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      this.ffmpegReady = false;
      throw new Error(`FFmpeg 初期化失敗: ${error.message}`);
    }
  }

  async blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        console.log('[BLOB] Converted to ArrayBuffer:', reader.result.byteLength, 'bytes');
        resolve(reader.result);
      };
      reader.onerror = () => {
        console.error('[BLOB] Conversion error:', reader.error);
        reject(reader.error);
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  async compress(videoFile, onProgress = () => {}) {
    try {
      console.log('[COMPRESS] Starting compression:', {
        name: videoFile.name,
        size: videoFile.size,
        type: videoFile.type,
      });

      if (this.SHOULD_SKIP) {
        console.log('⏭️ モバイル/Safari デバイス - 圧縮をスキップ');
        
        onProgress(10, '📱 モバイルデバイス検出 - ファイルをそのままアップロード');
        await new Promise(r => setTimeout(r, 100));
        
        onProgress(50, '📦 ファイルを準備中...');
        await new Promise(r => setTimeout(r, 100));
        
        onProgress(100, '✅ 準備完了');
        
        return videoFile;
      }

      try {
        await this.initFFmpeg();
      } catch (error) {
        console.warn('⚠️ FFmpeg 初期化に失敗 - 元のファイルを返却:', error.message);
        onProgress(100, '⚠️ ファイルをそのままアップロード');
        return videoFile;
      }

      const inputFileName = 'input_video.mp4';
      const outputFileName = 'output.mp4';

      onProgress(10, '📥 ファイルを読み込み中...');
      console.log('[COMPRESS] Reading file...');

      let inputData;
      try {
        inputData = await this.blobToArrayBuffer(videoFile);
        console.log('[COMPRESS] ArrayBuffer created:', inputData.byteLength, 'bytes');
      } catch (err) {
        console.error('[COMPRESS] Blob conversion failed:', err.message);
        console.warn('⚠️ ファイル変換失敗 - 元のファイルを返却');
        onProgress(100, '⚠️ ファイルをそのままアップロード');
        return videoFile;
      }

      try {
        console.log('[COMPRESS] Writing to FFmpeg FS...');
        await this.ffmpeg.FS('writeFile', inputFileName, new Uint8Array(inputData));
        console.log('[COMPRESS] File written to FFmpeg FS');
      } catch (err) {
        console.error('[COMPRESS] writeFile failed:', err.message);
        console.warn('⚠️ ファイル書き込み失敗 - 元のファイルを返却');
        onProgress(100, '⚠️ ファイルをそのままアップロード');
        return videoFile;
      }

      const originalMB = (videoFile.size / 1024 / 1024).toFixed(2);
      console.log(`✅ ファイルロード完了: ${originalMB}MB`);

      onProgress(30, '⚙️ 圧縮設定中...');
      console.log('[COMPRESS] Building FFmpeg command...');

      const command = [
        '-i', inputFileName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '32',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        outputFileName,
      ];

      console.log('[COMPRESS] FFmpeg command:', command.join(' '));

      onProgress(40, '🎬 動画を圧縮中...');
      console.log('[COMPRESS] Running FFmpeg...');

      try {
        await this.ffmpeg.run(...command);
        console.log('✅ FFmpeg 実行完了');
      } catch (err) {
        console.error('[COMPRESS] FFmpeg run failed:', err.message);
        console.warn('⚠️ 圧縮失敗 - 元のファイルを返却');
        onProgress(100, '⚠️ ファイルをそのままアップロード');
        return videoFile;
      }

      onProgress(80, '📤 圧縮ファイルを取得中...');
      console.log('[COMPRESS] Reading output file...');

      let outputData;
      try {
        outputData = await this.ffmpeg.FS('readFile', outputFileName);
        console.log('[COMPRESS] Output file read:', outputData.length, 'bytes');
      } catch (err) {
        console.error('[COMPRESS] readFile failed:', err.message);
        console.warn('⚠️ 出力ファイル読み込み失敗 - 元のファイルを返却');
        onProgress(100, '⚠️ ファイルをそのままアップロード');
        return videoFile;
      }

      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

      try {
        await this.ffmpeg.FS('unlink', inputFileName);
        await this.ffmpeg.FS('unlink', outputFileName);
        console.log('✅ Temporary files cleaned up');
      } catch (err) {
        console.warn('[COMPRESS] Cleanup warning:', err.message);
      }

      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`✅ 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);

      onProgress(100, `✅ 圧縮完了 (${ratio}% 削減)`);

      return compressedBlob;
    } catch (error) {
      console.error('❌ 圧縮エラー:', error.message);
      console.error('Stack:', error.stack);
      
      console.warn('⚠️ 圧縮失敗 - 元のファイルを返却します');
      onProgress(100, '⚠️ ファイルをそのままアップロード');
      return videoFile;
    }
  }

  async cleanup() {
    try {
      if (this.ffmpeg && this.ffmpeg.isLoaded()) {
        console.log('🗑️ FFmpeg メモリ解放中...');
        this.ffmpeg = null;
        this.ffmpegReady = false;
        console.log('✅ メモリ解放完了');
      }
    } catch (err) {
      console.warn('⚠️ メモリ解放エラー:', err.message);
    }
  }
}

window.VideoCompressionEngineLocal = VideoCompressionEngineLocal;
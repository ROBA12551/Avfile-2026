/**
 * js/video-compression.js
 * 
 * FFmpeg.wasm v0.10.1 による動画圧縮
 * 
 * ★ 修正点:
 * - fetchFile() エラーハンドリング強化
 * - ArrayBuffer を直接使用
 * - ファイルパスの特殊文字対応
 * - Blob → ArrayBuffer 変換を明示的に実行
 */

class VideoCompressionEngine {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
    this.IS_MOBILE = /iPad|iPhone|iPod|Android/.test(navigator.userAgent);
    this.IS_SAFARI = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    this.SHOULD_SKIP = this.IS_MOBILE || this.IS_SAFARI;
  }

  /**
   * FFmpeg を初期化
   */
  async initFFmpeg() {
    if (this.SHOULD_SKIP) {
      console.log('⏭️ モバイル/Safari - FFmpeg処理をスキップ');
      return;
    }

    if (this.ffmpegReady && this.ffmpeg && this.ffmpeg.isLoaded()) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      // window.FFmpeg が存在するか確認
      if (!window.FFmpeg || !window.FFmpeg.FFmpeg) {
        console.error('window.FFmpeg:', window.FFmpeg);
        throw new Error('window.FFmpeg.FFmpeg が利用できません');
      }

      // ★ 修正: 正しい API を使用
      const { FFmpeg, fetchFile } = window.FFmpeg;
      
      console.log('✅ FFmpeg API を確認');
      
      // FFmpeg インスタンスを作成
      this.ffmpeg = new FFmpeg({ log: false }); // log を false に

      if (this.ffmpeg.isLoaded()) {
        console.log('✅ FFmpeg は既にロード済み');
        this.ffmpegReady = true;
        return;
      }

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      
      // FFmpeg コアをロード
      await this.ffmpeg.load();

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      throw new Error(`FFmpeg 初期化失敗: ${error.message}`);
    }
  }

  /**
   * ★ 修正: Blob を ArrayBuffer に変換（fetchFile エラー対策）
   */
  async blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * 動画を圧縮
   */
  async compress(videoFile, onProgress = () => {}) {
    try {
      // ★ モバイル・Safari ではスキップ
      if (this.SHOULD_SKIP) {
        console.log('⏭️ モバイル/Safari - 元のファイルを返す');
        onProgress(10, '📱 モバイルです - ファイルをそのままアップロード');
        await new Promise(r => setTimeout(r, 200));
        onProgress(100, '✅ 準備完了');
        return videoFile;
      }

      // FFmpeg を初期化
      await this.initFFmpeg();

      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      onProgress(10, '📥 ファイルを読み込み中...');
      console.log('📥 ファイルを読み込み中...');

      // ★ 修正: fetchFile() の代わりに blobToArrayBuffer を使用
      let inputData;
      try {
        console.log('[VIDEO] Converting blob to ArrayBuffer...');
        inputData = await this.blobToArrayBuffer(videoFile);
        console.log('[VIDEO] ArrayBuffer created:', inputData.byteLength, 'bytes');
      } catch (err) {
        console.error('[VIDEO] Blob conversion failed:', err.message);
        throw new Error(`Failed to convert file: ${err.message}`);
      }

      // ★ 修正: FFmpeg FS に書き込む
      try {
        console.log('[VIDEO] Writing to FFmpeg FS...');
        await this.ffmpeg.FS('writeFile', inputFileName, new Uint8Array(inputData));
        console.log('[VIDEO] File written to FFmpeg FS');
      } catch (err) {
        console.error('[VIDEO] writeFile failed:', err.message);
        throw new Error(`Failed to write file: ${err.message}`);
      }

      const originalMB = (videoFile.size / 1024 / 1024).toFixed(2);
      console.log(`✅ ファイルロード完了: ${originalMB}MB`);

      onProgress(30, '⚙️ 圧縮設定中...');
      console.log('⚙️ 圧縮コマンド実行中...');

      // 圧縮コマンド（720p 30fps）
      const command = [
        '-i', inputFileName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // 速度優先
        '-crf', '32', // 圧縮率優先
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        outputFileName,
      ];

      onProgress(40, '🎬 動画を圧縮中...');
      console.log('🎬 FFmpeg 圧縮実行中...');

      // ★ 修正: ffmpeg.run() のエラーハンドリング
      try {
        await this.ffmpeg.run(...command);
        console.log('✅ FFmpeg 実行完了');
      } catch (err) {
        console.error('[VIDEO] FFmpeg run failed:', err.message);
        throw new Error(`FFmpeg compression failed: ${err.message}`);
      }

      onProgress(80, '📤 圧縮ファイルを取得中...');
      console.log('📤 圧縮ファイルを取得中...');

      // ★ 修正: readFile() のエラーハンドリング
      let outputData;
      try {
        outputData = await this.ffmpeg.FS('readFile', outputFileName);
        console.log('[VIDEO] Output file read:', outputData.length, 'bytes');
      } catch (err) {
        console.error('[VIDEO] readFile failed:', err.message);
        throw new Error(`Failed to read output file: ${err.message}`);
      }

      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

      // ★ 修正: クリーンアップ時のエラーハンドリング
      try {
        await this.ffmpeg.FS('unlink', inputFileName);
        await this.ffmpeg.FS('unlink', outputFileName);
        console.log('✅ Temporary files cleaned up');
      } catch (err) {
        console.warn('[VIDEO] Cleanup warning:', err.message);
        // クリーンアップエラーは無視
      }

      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`✅ 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);

      onProgress(100, `✅ 圧縮完了 (${ratio}% 削減)`);

      return compressedBlob;
    } catch (error) {
      console.error('❌ 圧縮エラー:', error.message);
      console.error('スタックトレース:', error.stack);
      throw new Error(`動画圧縮失敗: ${error.message}`);
    }
  }

  /**
   * ★ 新機能: メモリを解放
   */
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

// グローバルエクスポート
window.VideoCompressionEngine = VideoCompressionEngine;
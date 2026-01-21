/**
 * js/video-compression.js
 * 
 * FFmpeg.wasm v0.12.6 による動画圧縮
 * 720p 30fps に自動圧縮
 * 
 * 参考: https://github.com/ffmpegwasm/ffmpeg.wasm
 */

class VideoCompressionEngine {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
  }

  /**
   * FFmpeg を初期化
   */
  async initFFmpeg() {
    if (this.ffmpegReady && this.ffmpeg && this.ffmpeg.isLoaded()) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      // window.FFmpeg が存在するか確認
      if (!window.FFmpeg) {
        throw new Error('window.FFmpeg が利用できません');
      }

      const { FFmpeg, fetchFile } = window.FFmpeg;
      
      // FFmpeg インスタンスを作成
      this.ffmpeg = new FFmpeg.FFmpeg();

      if (this.ffmpeg.isLoaded()) {
        console.log('✅ FFmpeg は既にロード済み');
        this.ffmpegReady = true;
        return;
      }

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      
      // FFmpeg コアをロード
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
      await this.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      throw new Error(`FFmpeg 初期化失敗: ${error.message}`);
    }
  }

  /**
   * 動画を圧縮
   */
  async compress(videoFile, onProgress = () => {}) {
    try {
      // FFmpeg を初期化
      await this.initFFmpeg();

      const { fetchFile } = window.FFmpeg;
      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      onProgress(10, '📥 ファイルを読み込み中...');
      console.log('📥 ファイルを読み込み中...');

      // ファイルを FFmpeg に読み込む
      const inputData = await fetchFile(videoFile);
      await this.ffmpeg.writeFile(inputFileName, inputData);

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
        '-preset', 'medium',
        '-crf', '28',
        '-b:v', '1500k',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputFileName,
      ];

      onProgress(40, '🎬 動画を圧縮中...');
      console.log('🎬 FFmpeg 圧縮実行中...');
      console.log('コマンド:', command.join(' '));

      // FFmpeg を実行
      await this.ffmpeg.exec(command);

      onProgress(80, '📤 圧縮ファイルを取得中...');
      console.log('📤 圧縮ファイルを取得中...');

      // 圧縮ファイルを取得
      const outputData = await this.ffmpeg.readFile(outputFileName);
      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

      // ファイルをクリーンアップ
      await this.ffmpeg.deleteFile(inputFileName);
      await this.ffmpeg.deleteFile(outputFileName);

      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`✅ 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);

      onProgress(100, '✅ 圧縮完了');

      return compressedBlob;
    } catch (error) {
      console.error('❌ 圧縮エラー:', error.message);
      console.error('スタックトレース:', error.stack);
      throw new Error(`動画圧縮失敗: ${error.message}`);
    }
  }
}

// グローバルエクスポート
window.VideoCompressionEngine = VideoCompressionEngine;
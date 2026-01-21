/**
 * js/video-compression.js
 * 
 * FFmpeg.wasm v0.10.1 による動画圧縮
 * 
 * ★ 修正点:
 * - チャンク処理で遅延実行
 * - メモリ効率化
 * - 低スペック対応
 * - プログレス更新の細分化
 */

class VideoCompressionEngine {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
    this.CHUNK_SIZE = 256 * 1024; // 256KB
    this.DELAY_MS = 50; // 50ms delay between operations
  }

  /**
   * ★ 修正: 遅延実行ユーティリティ
   */
  async delay(ms = this.DELAY_MS) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * FFmpeg を初期化（遅延付き）
   */
  async initFFmpeg() {
    if (this.ffmpegReady && this.ffmpeg && this.ffmpeg.isLoaded()) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      // window.FFmpeg が存在するか確認
      if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
        console.error('window.FFmpeg:', window.FFmpeg);
        throw new Error('window.FFmpeg.createFFmpeg が利用できません');
      }

      // 正しい API: createFFmpeg を使用
      const { createFFmpeg, fetchFile } = window.FFmpeg;
      
      console.log('✅ FFmpeg API を確認');
      
      // FFmpeg インスタンスを作成
      this.ffmpeg = createFFmpeg({ log: false }); // logを無効化してメモリ節約
      await this.delay(100);

      if (this.ffmpeg.isLoaded()) {
        console.log('✅ FFmpeg は既にロード済み');
        this.ffmpegReady = true;
        return;
      }

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      await this.delay(100);
      
      // FFmpeg コアをロード
      await this.ffmpeg.load();
      await this.delay(200);

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      throw new Error(`FFmpeg 初期化失敗: ${error.message}`);
    }
  }

  /**
   * ★ 修正: ファイルをチャンク単位で読み込む（メモリ効率化）
   */
  async readFileInChunks(file, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let chunks = [];
      let offset = 0;
      const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

      const readChunk = async () => {
        if (offset >= file.size) {
          // すべてのチャンクを結合
          const blob = new Blob(chunks, { type: file.type });
          onProgress(100, '✅ ファイル読み込み完了');
          resolve(blob);
          return;
        }

        const end = Math.min(offset + this.CHUNK_SIZE, file.size);
        const chunk = file.slice(offset, end);
        const chunkIndex = Math.floor(offset / this.CHUNK_SIZE);
        
        reader.readAsArrayBuffer(chunk);
        offset = end;

        // プログレス更新
        const progress = Math.round((offset / file.size) * 20); // 0-20%
        onProgress(progress, `📥 読み込み中... ${chunkIndex + 1}/${totalChunks}`);
      };

      reader.onload = async (e) => {
        try {
          chunks.push(new Uint8Array(e.target.result));
          await this.delay(10); // チャンク間の遅延
          readChunk();
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(reader.error);
      readChunk();
    });
  }

  /**
   * ★ 修正: 動画を圧縮（プログレス細分化・遅延実行）
   */
  async compress(videoFile, onProgress = () => {}) {
    try {
      // FFmpeg を初期化
      await this.initFFmpeg();
      onProgress(10, '⏳ FFmpeg 準備完了');
      await this.delay(100);

      const { fetchFile } = window.FFmpeg;
      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      // ★ 修正: ファイルを遅延読み込み
      console.log('📥 ファイルを読み込み中（チャンク処理）...');
      const fileBlob = await this.readFileInChunks(videoFile, onProgress);
      const originalMB = (fileBlob.size / 1024 / 1024).toFixed(2);
      console.log(`✅ ファイルロード完了: ${originalMB}MB`);
      
      onProgress(22, `📥 FFmpegに書き込み中... (${originalMB}MB)`);
      await this.delay(150);

      // ★ 修正: ファイルをFFmpegに書き込む（遅延付き）
      const inputData = await fetchFile(fileBlob);
      await this.delay(100);
      
      await this.ffmpeg.FS('writeFile', inputFileName, inputData);
      console.log(`✅ FFmpeg FS書き込み完了`);
      
      onProgress(30, '⚙️ 圧縮設定中...');
      await this.delay(150);

      console.log('⚙️ 圧縮コマンド実行中...');

      // ★ 修正: 低スペック向けの軽量圧縮設定
      const command = [
        '-i', inputFileName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // fast → ultrafastに変更（速度優先）
        '-crf', '32', // 28 → 32に変更（圧縮率優先）
        '-c:a', 'aac',
        '-b:a', '96k', // 128k → 96kに変更（低スペック対応）
        '-movflags', '+faststart',
        outputFileName,
      ];

      console.log('🎬 FFmpeg 圧縮実行中...');
      
      // ★ 修正: 圧縮実行（プログレス分割）
      onProgress(40, '🎬 動画を圧縮中... (0%)');
      await this.delay(100);

      // 長時間処理なので途中でプログレス更新
      const ffmpegPromise = this.ffmpeg.run(...command);
      
      // プログレスシミュレーション（実際の進捗は取得できないため）
      const progressInterval = setInterval(() => {
        onProgress(50 + Math.random() * 30, '🎬 動画を圧縮中...');
      }, 2000);

      try {
        await ffmpegPromise;
      } finally {
        clearInterval(progressInterval);
      }

      onProgress(80, '📤 圧縮ファイルを取得中...');
      console.log('📤 圧縮ファイルを取得中...');
      await this.delay(150);

      // ★ 修正: ファイルを読み込む（遅延付き）
      const outputData = await this.ffmpeg.FS('readFile', outputFileName);
      await this.delay(100);
      
      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

      onProgress(85, '🗑️ 一時ファイルを削除中...');
      await this.delay(100);

      // ★ 修正: ファイルをクリーンアップ（遅延付き）
      await this.ffmpeg.FS('unlink', inputFileName);
      await this.delay(50);
      
      await this.ffmpeg.FS('unlink', outputFileName);
      await this.delay(50);

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
        // FFmpegのメモリをクリア
        this.ffmpeg = null;
        this.ffmpegReady = false;
        await this.delay(100);
        console.log('✅ メモリ解放完了');
      }
    } catch (err) {
      console.error('⚠️ メモリ解放エラー:', err.message);
    }
  }
}

// グローバルエクスポート
window.VideoCompressionEngine = VideoCompressionEngine;

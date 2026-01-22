/**
 * js/password-viewer.js
 * パスワード保護されたファイルビューア
 */

class PasswordViewer {
  constructor() {
    this.viewId = this.getViewIdFromPath();
    this.passwordHash = null;
    this.isPasswordRequired = false;
  }

  /**
   * URLからviewIdを取得
   */
  getViewIdFromPath() {
    const pathname = location.pathname || '';
    
    // /d/xxxxx パターン
    let match = pathname.match(/\/d\/([a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
    
    // クエリパラメータ
    const params = new URLSearchParams(location.search);
    if (params.has('id')) return params.get('id');
    if (params.has('view')) return params.get('view');
    
    // ハッシュ
    const hash = location.hash.replace('#', '').split('?')[0];
    if (hash && hash.length > 0) return hash;
    
    return null;
  }

  /**
   * SHA-256ハッシュ計算
   */
  async sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * パスワード入力ダイアログを表示
   */
  showPasswordDialog() {
    return new Promise((resolve) => {
      // ダイアログのHTML
      const dialogHTML = `
        <div id="passwordDialog" style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        ">
          <div style="
            background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 2rem;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          ">
            <div style="text-align: center; margin-bottom: 1.5rem;">
              <div style="font-size: 2.5rem; margin-bottom: 1rem;">🔒</div>
              <h2 style="color: #ffffff; font-size: 1.3rem; margin: 0; margin-bottom: 0.5rem;">Password Protected</h2>
              <p style="color: rgba(255, 255, 255, 0.7); margin: 0; font-size: 0.9rem;">This content is password protected</p>
            </div>

            <div style="margin-bottom: 1rem;">
              <input 
                type="password" 
                id="passwordInput" 
                placeholder="Enter password" 
                style="
                  width: 100%;
                  padding: 0.8rem;
                  background: rgba(255, 255, 255, 0.05);
                  border: 1px solid rgba(255, 255, 255, 0.1);
                  border-radius: 8px;
                  color: #ffffff;
                  font-size: 1rem;
                  box-sizing: border-box;
                "
              />
              <div id="errorMsg" style="
                color: #ff6b6b;
                font-size: 0.85rem;
                margin-top: 0.5rem;
                display: none;
              ">Invalid password</div>
            </div>

            <div style="display: flex; gap: 0.5rem;">
              <button id="submitBtn" style="
                flex: 1;
                padding: 0.8rem;
                background: rgba(76, 175, 80, 0.3);
                border: 1px solid rgba(76, 175, 80, 0.5);
                border-radius: 8px;
                color: #ffffff;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s;
              ">Submit</button>
              <button id="cancelBtn" style="
                flex: 1;
                padding: 0.8rem;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                color: #ffffff;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s;
              ">Cancel</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', dialogHTML);

      const dialog = document.getElementById('passwordDialog');
      const input = document.getElementById('passwordInput');
      const submitBtn = document.getElementById('submitBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      const errorMsg = document.getElementById('errorMsg');

      input.focus();

      const handleSubmit = async () => {
        const password = input.value.trim();
        if (!password) {
          errorMsg.style.display = 'block';
          return;
        }

        dialog.style.display = 'none';
        resolve(password);
        dialog.remove();
      };

      const handleCancel = () => {
        dialog.remove();
        resolve(null);
      };

      submitBtn.addEventListener('click', handleSubmit);
      cancelBtn.addEventListener('click', handleCancel);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSubmit();
      });
    });
  }

  /**
   * ファイルを読み込む
   */
  async loadFile() {
    try {
      if (!this.viewId) {
        throw new Error('No file ID found');
      }

      // まずパスワードなしで試す
      let url = `/.netlify/functions/view?id=${encodeURIComponent(this.viewId)}`;
      
      let response = await fetch(url);
      let data = await response.json();

      // ★ パスワードが必要な場合
      if (!response.ok && data.requiresPassword) {
        console.log('[PASSWORD] File requires password');
        this.isPasswordRequired = true;

        // パスワード入力を促す
        const password = await this.showPasswordDialog();
        if (!password) {
          throw new Error('Password required to access this file');
        }

        // パスワードハッシュを計算
        this.passwordHash = await this.sha256(password);

        // パスワードハッシュ付きでリトライ
        url = `/.netlify/functions/view?id=${encodeURIComponent(this.viewId)}&pwd=${encodeURIComponent(this.passwordHash)}`;
        response = await fetch(url);
        data = await response.json();
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load file');
      }

      return data.files?.[0];
    } catch (e) {
      console.error('[PASSWORD_VIEWER] Error:', e.message);
      throw e;
    }
  }

  /**
   * URLにパスワードハッシュを含める
   */
  getShareUrlWithPassword() {
    const baseUrl = `${window.location.origin}/d/${this.viewId}`;
    if (this.passwordHash) {
      return `${baseUrl}?pwd=${encodeURIComponent(this.passwordHash)}`;
    }
    return baseUrl;
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.PasswordViewer = PasswordViewer;
}
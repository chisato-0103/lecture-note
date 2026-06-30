// ライブ字幕の表示専用スクリプト。main から push される確定テキストを
// ローリング表示する（直近 MAX_SEGMENTS 件を連結）。
// CSP で inline script 不可のため外部ファイルにしている（settings.js と同じ扱い）。

const textEl = document.getElementById("text");
const statusEl = document.getElementById("status");

const MAX_SEGMENTS = 3; // 直近この件数ぶんを表示
const segments = [];

function render() {
  textEl.innerHTML = "";
  segments.forEach((seg, i) => {
    const span = document.createElement("span");
    // 最新以外は淡く
    if (i < segments.length - 1) span.className = "old";
    span.textContent = seg + " ";
    textEl.appendChild(span);
  });
}

window.caption.onText(({ text, ready, error }) => {
  if (ready) {
    statusEl.textContent = "認識中 …";
    return;
  }
  if (error) {
    statusEl.textContent = "字幕エラー（録音は継続中）";
    return;
  }
  if (!text) return; // 無音などで空テキストは無視
  segments.push(text);
  while (segments.length > MAX_SEGMENTS) segments.shift();
  statusEl.textContent = "";
  render();
});

// 音声入力レベル（0..1）をバー幅に反映する。
const levelEl = document.getElementById("level");
window.caption.onLevel((v) => {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  levelEl.style.width = pct + "%";
});

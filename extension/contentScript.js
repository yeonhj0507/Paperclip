/**
 * Gmail Polite Rewrite Extension – with Robust Compose Detection & Rollback
 * - Robust editor detection (KR/EN, role=textbox, contenteditable)
 * - Works even without [role="dialog"] container
 * - Focus/selection tracking & bootstrap polling
 * - Background commands integrated
 */

/* ========== Globals ========== */
const PUNCT_KEYS = ['.', '!', '?'];
const PUNCT_REGEX = /[.!?؟¡。？！]/;
const lastSentMap = new WeakMap();
const rollbackStack = new WeakMap();
let lastTarget = null;
let politeIndicator = null;
let rollbackIndicator = null;
let suggestBuf = [];
let isAnalyzing = false;

/* ========== Styles ========== */
const GMAIL_INTEGRATED_STYLES = `
  .polite-indicator {
    position: absolute; z-index: 100000;
    font-family: 'Google Sans','Segoe UI',Roboto,sans-serif;
    background: white; border: 1px solid #dadce0; border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,.1);
    padding: 8px 12px; font-size: 13px; line-height: 1.4;
    display: flex; align-items: center; gap: 8px; cursor: pointer;
    transition: all .25s cubic-bezier(.4,0,.2,1);
    max-width: 280px; min-width: 180px;
  }
  .polite-indicator:hover { border-color:#1a73e8; box-shadow:0 4px 16px rgba(26,115,232,.15); transform: translateY(-1px); }
  .polite-indicator.tone-neutral{ border-color:#34a853; background:linear-gradient(135deg,#f8fff9 0%,#e8f5e8 100%); }
  .polite-indicator.tone-error{ border-color:#ea4335; background:linear-gradient(135deg,#fff8f8 0%,#fce8e6 100%); }
  .polite-indicator.analyzing{ border-color:#1a73e8; background:linear-gradient(135deg,#f8fbff 0%,#e8f0fe 100%); }

  .rollback-indicator{
    position:absolute; z-index:100001; font-family:'Google Sans','Segoe UI',Roboto,sans-serif;
    background:linear-gradient(135deg,#fff3e0 0%,#ffe0b2 100%); border:1px solid #ff9800; border-radius:8px;
    box-shadow:0 2px 10px rgba(255,152,0,.15); padding:8px 12px; font-size:13px; line-height:1.4;
    display:flex; align-items:center; gap:8px; cursor:pointer; transition:all .25s cubic-bezier(.4,0,.2,1);
    max-width:300px; min-width:200px;
  }
  .rollback-indicator:hover{ border-color:#f57c00; box-shadow:0 4px 16px rgba(245,124,0,.25); transform: translateY(-1px); }

  .tone-badge{ width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; flex-shrink:0; }
  .tone-badge.neutral{ background:#34a853; color:#fff; }
  .tone-badge.error{ background:#ea4335; color:#fff; }
  .tone-badge.analyzing{ background:#1a73e8; color:#fff; }
  .tone-badge.rollback{ background:#ff9800; color:#fff; }

  .indicator-content{ flex:1; min-width:0; }
  .indicator-title{ font-weight:500; color:#202124; margin-bottom:2px; }
  .indicator-subtitle{ font-size:11px; color:#5f6368; opacity:.9; }

  .polite-popup,.rollback-popup{
    position:absolute; z-index:100003; background:#fff; border-radius:12px; overflow:hidden;
    box-shadow:0 8px 28px rgba(0,0,0,.12); padding:0; min-width:320px; max-width:420px;
    animation:gmailPopupFadeIn .2s cubic-bezier(.4,0,.2,1);
  }
  .polite-popup{ border:1px solid #dadce0; z-index:100002; }
  .rollback-popup{ border:1px solid #ff9800; }
  @keyframes gmailPopupFadeIn{ from{opacity:0; transform: translateY(-8px) scale(.95);} to{opacity:1; transform: translateY(0) scale(1);} }

  .popup-header{ background:#f8f9fa; padding:16px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; justify-content:space-between; }
  .rollback-popup .popup-header{ background:#fff3e0; border-bottom:1px solid #ffcc02; }
  .popup-title{ font-size:14px; font-weight:500; color:#202124; display:flex; align-items:center; gap:8px; }
  .popup-close{ background:none; border:none; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#5f6368; font-size:16px; transition: background-color .15s ease; }
  .popup-close:hover{ background:#f1f3f4; }
  .popup-body{ padding:16px; }

  .original-text{ background:#fef7e0; border:1px solid #f9ab00; border-radius:6px; padding:10px; margin-bottom:16px; font-size:12px; color:#8a4600; }
  .modified-text{ background:#fff3e0; border:1px solid #ff9800; border-radius:6px; padding:10px; margin-bottom:16px; font-size:12px; color:#e65100; }
  .original-label{ font-weight:500; margin-bottom:4px; display:block; }

  .suggestions-list,.rollback-list{ display:flex; flex-direction:column; gap:8px; }
  .suggestion-item,.rollback-item{ background:#f8f9fa; border:1px solid #e8eaed; border-radius:8px; padding:12px; cursor:pointer; transition: all .15s ease; position:relative; }
  .rollback-item{ background:#fff3e0; border-color:#ffcc02; }
  .suggestion-item:hover,.suggestion-item:focus{ background:#e8f0fe; border-color:#1a73e8; outline:none; transform: translateY(-1px); box-shadow:0 2px 8px rgba(26,115,232,.15); }
  .rollback-item:hover,.rollback-item:focus{ background:#ffe0b2; border-color:#ff9800; outline:none; transform: translateY(-1px); box-shadow:0 2px 8px rgba(255,152,0,.25); }
  .suggestion-text,.rollback-text{ font-size:13px; line-height:1.4; color:#202124; }
  .rollback-meta{ font-size:11px; color:#5f6368; margin-top:4px; display:flex; justify-content:space-between; align-items:center; }
  .suggestion-number,.rollback-number{ position:absolute; top:-6px; left:8px; background:#1a73e8; color:#fff; font-size:10px; font-weight:600; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
  .rollback-number{ background:#ff9800; }

  .popup-footer{ background:#f8f9fa; padding:12px 16px; border-top:1px solid #e8eaed; font-size:11px; color:#5f6368; text-align:center; }
  .rollback-popup .popup-footer{ background:#fff3e0; border-top:1px solid #ffcc02; }

  .polite-button{ background:#1a73e8; color:#fff; border:none; border-radius:20px; padding:8px 16px; font-size:13px; font-weight:500; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all .2s ease; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .polite-button:hover{ background:#1557b0; box-shadow:0 2px 8px rgba(26,115,232,.25); transform: translateY(-1px); }

  .analyzing-spinner{ width:16px; height:16px; border:2px solid #e8eaed; border-top:2px solid #1a73e8; border-radius:50%; animation: spin 1s linear infinite; }
  @keyframes spin{ 0%{transform: rotate(0)} 100%{transform: rotate(360deg)} }

  .success-toast{ position:fixed; top:24px; right:24px; background:#137333; color:#fff; padding:12px 20px; border-radius:8px; font-size:14px; font-weight:500; box-shadow:0 4px 20px rgba(19,115,51,.25); z-index:100004; animation: toastSlideIn .3s cubic-bezier(.4,0,.2,1); }
  .rollback-toast{ background:#ff9800; box-shadow:0 4px 20px rgba(255,152,0,.25); }
  @keyframes toastSlideIn{ from{ transform: translateX(100%); opacity:0;} to{ transform: translateX(0); opacity:1;} }
  .fixed-top-left{ position:fixed !important; top:10px !important; right:10px !important; transform:none !important; }
  .toolbar-compact{
  position:absolute; right:16px; bottom:120px; z-index:1000;
  display:flex; gap:6px;
}
.polite-button.small{
  padding:6px 10px; font-size:12px; border-radius:16px;
}
.polite-button.small svg{ width:14px; height:14px; }
`;

/* ===== Utilities ===== */
function injectStyles() {
  if (document.getElementById('gmail-polite-styles')) return;
  const style = document.createElement('style');
  style.id = 'gmail-polite-styles';
  style.textContent = GMAIL_INTEGRATED_STYLES;
  document.head.appendChild(style);
}

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function editableAncestor(node) {
  let n = node;
  while (n && n !== document) {
    if (n.nodeType === 1 && n.isContentEditable) return n;
    n = n.parentNode;
  }
  return null;
}

/** Compose body candidates across locales/UIs */
function findGmailBodyDivCandidates() {
  const sels = [
    'div[aria-label="Message Body"]',
    'div[aria-label="메시지 본문"]',
    'div[aria-label="메일 본문"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"].editable'
  ];
  const cands = [];
  for (const s of sels) cands.push(...document.querySelectorAll(s));
  return cands.filter(isVisible);
}

function findGmailBodyDiv() {
  const focusEditable = editableAncestor(document.activeElement);
  if (focusEditable && isVisible(focusEditable)) return focusEditable;

  const sel = window.getSelection?.();
  if (sel && sel.anchorNode) {
    const n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
    const anchorEditable = editableAncestor(n);
    if (anchorEditable && isVisible(anchorEditable)) return anchorEditable;
  }

  const cands = findGmailBodyDivCandidates();
  return cands[0] || null;
}

function ensureComposeTarget() {
  let bodyDiv = findGmailBodyDiv();
  if (!bodyDiv) {
    console.warn('[content] ✖ compose body not found yet');
    return null;
  }
  lastTarget = bodyDiv;

  const dialog = bodyDiv.closest('[role="dialog"]') || bodyDiv.closest('[role="region"]');
  if (dialog && !dialog.querySelector('#gmail-polite-btn')) {
    const toField = dialog.querySelector('[aria-label="To"], [aria-label="받는 사람"]') ||
      document.querySelector('[aria-label="To"], [aria-label="받는 사람"]');
    const subjField = dialog.querySelector('input[name="subjectbox"]');
    injectPoliteButton(dialog, bodyDiv, toField, subjField);
  }
  console.log('[content] ✅ compose target ensured');
  return bodyDiv;
}

/* ===== Compose detection (Observer + Focus tracking + Bootstrap polling) ===== */
const composeObserver = new MutationObserver(muts => {
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1) {
        if (ensureComposeTarget()) return;
      }
    }
  }
});

injectStyles();
composeObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });

document.addEventListener('focusin', (e) => {
  const ed = editableAncestor(e.target);
  if (ed && isVisible(ed)) {
    lastTarget = ed;
    const dialog = ed.closest('[role="dialog"]') || ed.closest('[role="region"]');
    if (dialog && !dialog.querySelector('#gmail-polite-btn')) {
      const toField = dialog.querySelector('[aria-label="To"], [aria-label="받는 사람"]') ||
        document.querySelector('[aria-label="To"], [aria-label="받는 사람"]');
      const subjField = dialog.querySelector('input[name="subjectbox"]');
      injectPoliteButton(dialog, ed, toField, subjField);
    }
    enableSentenceAnalysis(ed);
  }
});

// Bootstrap: try for ~10s
let tries = 0;
const boot = setInterval(() => {
  if (ensureComposeTarget()) {
    clearInterval(boot);
  } else if (++tries > 20) {
    clearInterval(boot);
  }
}, 500);

/* ===== Rollback history ===== */
function addToRollbackHistory(bodyDiv, originalText, modifiedText, timestamp) {
  if (!rollbackStack.has(bodyDiv)) rollbackStack.set(bodyDiv, []);
  const history = rollbackStack.get(bodyDiv);
  history.push({ original: originalText, modified: modifiedText, timestamp, id: Date.now() + Math.random() });
  if (history.length > 10) history.shift();
  console.log('📝 Added to rollback history');
}
function hasRollbackHistory(bodyDiv) {
  const history = rollbackStack.get(bodyDiv);
  return !!(history && history.length > 0);
}
function getRollbackHistory(bodyDiv) {
  return rollbackStack.get(bodyDiv) || [];
}
function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  return new Date(timestamp).toLocaleDateString();
}

/* ===== UI Injection (toolbar) ===== */
function injectPoliteButton(dialog, bodyDiv) {
  if (dialog.querySelector('#gmail-polite-btn')) return;
  const btnContainer = document.createElement('div');
  btnContainer.className = 'toolbar-compact';
  const makeBtn = (id, text, svgPath, bg) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'polite-button small';
    if (bg) b.style.background = bg;
    b.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="${svgPath}"/></svg>
      <span>${text}</span>`;
    return b;
  };

  const toneBtn = makeBtn(
    'gmail-polite-btn', '톤 체크 (Alt+T)',
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'
  );
  toneBtn.title = '이메일 톤을 분석하고 개선 제안을 받아보세요 (Alt+T)';
  toneBtn.onclick = () => handleToneCheck();

  const rollbackBtn = makeBtn(
    'gmail-rollback-btn', '되돌리기 (Alt+Z)',
    'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
    '#ff9800'
  );
  rollbackBtn.title = '수정된 내용을 이전 상태로 되돌립니다 (Alt+Z: 목록, Alt+Q: 빠른 되돌리기)';
  rollbackBtn.onclick = () => showRollbackPopup(lastTarget);
  updateRollbackButtonState(rollbackBtn, bodyDiv);

  const helpBtn = makeBtn(
    'gmail-help-btn', '도움말 (Alt+H)',
    'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8 8-3.59 8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
    '#5f6368'
  );
  helpBtn.title = '키보드 단축키 도움말 (Alt+H)';
  helpBtn.onclick = () => showShortcutHelp();

  btnContainer.appendChild(toneBtn);
  btnContainer.appendChild(rollbackBtn);
  btnContainer.appendChild(helpBtn);

  dialog.style.position ||= 'relative';
  dialog.appendChild(btnContainer);

  bodyDiv.addEventListener('input', () => {
    setTimeout(() => updateRollbackButtonState(rollbackBtn, bodyDiv), 100);
  });
}

function updateRollbackButtonState(rollbackBtn, bodyDiv) {
  const hasHistory = hasRollbackHistory(bodyDiv);
  rollbackBtn.disabled = !hasHistory;
  rollbackBtn.style.opacity = hasHistory ? '1' : '0.5';
  rollbackBtn.style.cursor = hasHistory ? 'pointer' : 'not-allowed';
}

/* ===== Live sentence analysis ===== */
function enableSentenceAnalysis(bodyDiv) {
  if (!bodyDiv || bodyDiv._politeAnalysisBound) return;
  bodyDiv._politeAnalysisBound = true;

  let analysisTimeout = null;
  bodyDiv.addEventListener('keyup', (ev) => {
    if (!PUNCT_KEYS.includes(ev.key)) return;
    const fullText = bodyDiv.innerText.trim();
    if (!fullText || !PUNCT_REGEX.test(fullText.slice(-1))) return;
    const sentences = fullText.split(/(?<=[.!?؟¡。？！])\s+/);
    if (!sentences.length) return;

    const currentSentence = sentences.pop().trim();
    if (!currentSentence || lastSentMap.get(bodyDiv) === currentSentence) return;

    lastSentMap.set(bodyDiv, currentSentence);
    lastTarget = bodyDiv;

    clearTimeout(analysisTimeout);
    analysisTimeout = setTimeout(() => {
      analyzeEmailTone(bodyDiv, currentSentence, sentences.join(' ').trim());
    }, 500);

    saveCursorPosition(bodyDiv);
  });
}

function saveCursorPosition(bodyDiv) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getBoundingClientRect();
    bodyDiv._lastCursorRect = { top: rect.top + window.scrollY, left: rect.left + window.scrollX };
  }
}

/* ===== AI call via background ===== */
function analyzeEmailTone(bodyDiv, focus = '', context = '') {
  if (!bodyDiv) bodyDiv = ensureComposeTarget();
  if (!bodyDiv) { showError('작성창을 찾을 수 없어요. 작성창을 클릭한 후 다시 시도해주세요.'); return; }
  if (isAnalyzing) return;

  const emailData = {
    type: 'emailContent',
    focus: focus || bodyDiv.innerText.trim(),
    context,
    body: bodyDiv.innerText.trim(),
    timestamp: Date.now()
  };

  console.log('📤 Analyzing email tone...', {
    focusLength: emailData.focus.length, contextLength: emailData.context.length, bodyLength: emailData.body.length
  });

  showAnalyzingIndicator();
  isAnalyzing = true;

  chrome.runtime.sendMessage(emailData, (response) => {
    if (chrome.runtime.lastError) {
      console.error('❌ Runtime message error:', chrome.runtime.lastError);
      showError('확장 프로그램 통신 오류가 발생했습니다.');
      hideAnalyzingIndicator();
      isAnalyzing = false;
    } else if (response?.status === 'error') {
      showError(response.error || 'AI 분석 중 오류가 발생했습니다.');
      hideAnalyzingIndicator();
      isAnalyzing = false;
    } else {
      console.log('✅ Analysis request sent:', response);
    }
  });
}

/* ===== Results & commands from background ===== */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Received from background:', message);

  if (message.type === 'analysis_result') {
    hideAnalyzingIndicator();
    showToneIndicator(message.tone, message.toneText, message.suggestions);
    suggestBuf = message.suggestions || [];
    isAnalyzing = false;
    sendResponse?.({ status: 'displayed' });
    return true;
  }

  if (message.type === 'error') {
    hideAnalyzingIndicator();
    showError(message.error);
    isAnalyzing = false;
    sendResponse?.({ status: 'error_shown' });
    return true;
  }

  if (message.type === 'command') {
    ensureComposeTarget();
    handleCommand(message.command);
    sendResponse?.({ ok: true });
    return true;
  }
  return false;
});

/* ===== Indicator/Popup/Toast ===== */
function showAnalyzingIndicator() {
  hideExistingIndicator();
  if (!lastTarget) return;
  politeIndicator = document.createElement('div');
  politeIndicator.className = 'polite-indicator analyzing fixed-top-left';
  politeIndicator.innerHTML = `
    <div class="tone-badge analyzing"><div class="analyzing-spinner"></div></div>
    <div class="indicator-content">
      <div class="indicator-title">AI가 분석 중...</div>
      <div class="indicator-subtitle">문장의 톤을 확인하고 있어요</div>
    </div>`;
  document.body.appendChild(politeIndicator);
  // fixed-top-left로 고정이므로 위치 계산 불필요
}
function hideAnalyzingIndicator() {
  if (politeIndicator && politeIndicator.classList.contains('analyzing')) {
    politeIndicator.remove(); politeIndicator = null;
  }
}

function showToneIndicator(toneLevel, toneText, suggestions) {
  hideExistingIndicator();
  if (!lastTarget) return;
  const isNeutral = toneLevel === 'polite';
  const hasSuggestions = !isNeutral && suggestions && suggestions.length > 0; 
  politeIndicator = document.createElement('div');
  politeIndicator.className = `polite-indicator tone-${toneLevel}`;
  const config = {
    polite: { icon: '✓', title: '좋은 톤이에요', subtitle: '정중하고 적절한 표현입니다' },
    impolite: { icon: '!', title: '수정을 권장해요', subtitle: hasSuggestions ? `${suggestions.length}개의 개선 제안이 있어요` : '더 정중한 표현을 고려해보세요' }
  };
  const info = config[toneLevel] || config.neutral;
  politeIndicator.innerHTML = `
    <div class="tone-badge ${toneLevel}">${info.icon}</div>
    <div class="indicator-content">
      <div class="indicator-title">${info.title}</div>
      <div class="indicator-subtitle">${info.subtitle}</div>
    </div>`;
  if (hasSuggestions) {
    politeIndicator.onclick = () => showSuggestionsPopup();
    politeIndicator.style.cursor = 'pointer';
    politeIndicator.addEventListener('mouseenter', () => politeIndicator.style.transform = 'translateY(-2px)');
    politeIndicator.addEventListener('mouseleave', () => politeIndicator.style.transform = 'translateY(0)');
  } else {
    politeIndicator.style.cursor = 'default';
    politeIndicator.onclick = null;
  }
  document.body.appendChild(politeIndicator);
  positionIndicator();
  if (isNeutral && !hasSuggestions) {
    setTimeout(() => {
      if (politeIndicator && politeIndicator.classList.contains('tone-neutral')) {
        politeIndicator.style.opacity = '0';
        setTimeout(() => hideExistingIndicator(), 250);
      }
    }, 4000);
  }
}

function showSuggestionsPopup() {
  if (!suggestBuf.length) return;
  hideExistingPopup();

  const popup = document.createElement('div');
  popup.id = 'polite-popup';
  popup.className = 'polite-popup';

  const originalText = lastSentMap.get(lastTarget) || '';
  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        더 정중한 표현 제안
      </div>
      <button class="popup-close" onclick="this.closest('.polite-popup').remove()">×</button>
    </div>
    <div class="popup-body">
      ${originalText ? `
        <div class="original-text">
          <span class="original-label">원래 문장</span>
          ${originalText}
        </div>` : ''}
      <div class="suggestions-list" id="suggestions-container"></div>
    </div>
    <div class="popup-footer">
      Alt+T 톤체크 • Alt+Z 되돌리기 • Alt+Q 빠른되돌리기 • Alt+H 도움말
    </div>`;

  const container = popup.querySelector('#suggestions-container');
  suggestBuf.forEach((suggestion, index) => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="suggestion-number">${index + 1}</div>
      <div class="suggestion-text">${suggestion}</div>`;
    item.onclick = () => applySuggestion(suggestion);
    item.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applySuggestion(suggestion); } };
    container.appendChild(item);
    if (index === 0) setTimeout(() => item.focus(), 100);
  });

  document.body.appendChild(popup);
  positionPopup(popup);
  setupPopupKeyboard(popup);
}

function showRollbackPopup(bodyDiv) {
  const history = getRollbackHistory(bodyDiv);
  if (!history.length) {
    showError('되돌릴 수 있는 변경사항이 없습니다.');
    return;
  }

  hideExistingPopup();

  const popup = document.createElement('div');
  popup.id = 'rollback-popup';
  popup.className = 'rollback-popup';

  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
        </svg>
        변경사항 되돌리기
      </div>
      <button class="popup-close" onclick="this.closest('.rollback-popup').remove()">×</button>
    </div>
    <div class="popup-body">
      <div class="rollback-list" id="rollback-container"></div>
    </div>
    <div class="popup-footer">
      Alt+T 톤체크 • Alt+Z 되돌리기 • Alt+Q 빠른되돌리기 • Alt+H 도움말
    </div>`;

  const container = popup.querySelector('#rollback-container');

  history.slice().reverse().forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'rollback-item';
    item.tabIndex = 0;

    const timeAgo = getTimeAgo(entry.timestamp);

    item.innerHTML = `
      <div class="rollback-number">${index + 1}</div>
      <div class="rollback-text">${entry.original}</div>
      <div class="rollback-meta">
        <span>수정 전 원본</span>
        <span>${timeAgo}</span>
      </div>`;

    item.onclick = () => applyRollback(bodyDiv, entry);
    item.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyRollback(bodyDiv, entry); } };
    container.appendChild(item);

    if (index === 0) setTimeout(() => item.focus(), 100);
  });

  document.body.appendChild(popup);
  positionPopup(popup);
  setupPopupKeyboard(popup);
}

function applySuggestion(suggestion) {
  const bodyDiv = lastTarget;
  if (!bodyDiv) return;

  const originalText = lastSentMap.get(bodyDiv) || '';
  const parts = bodyDiv.innerText.trim().split(/(?<=[.!?؟¡۔。？！])\s+/);

  if (parts.length) {
    const modifiedText = suggestion;
    addToRollbackHistory(bodyDiv, originalText, modifiedText, Date.now());

    parts[parts.length - 1] = suggestion;
    bodyDiv.innerText = parts.join('\n') + ' ';

    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(bodyDiv);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    lastSentMap.set(bodyDiv, suggestion);

    const rollbackBtn = document.querySelector('#gmail-rollback-btn');
    if (rollbackBtn) updateRollbackButtonState(rollbackBtn, bodyDiv);

    chrome.runtime.sendMessage({
      type: 'suggestion_applied',
      original: originalText,
      applied: suggestion,
      timestamp: Date.now()
    }, () => void chrome.runtime.lastError);
  }

  hideExistingPopup();
  hideExistingIndicator();
  showSuccessToast('표현이 개선되었습니다!');
}

function applyRollback(bodyDiv, entry) {
  if (!bodyDiv || !entry) return;

  const currentText = bodyDiv.innerText.trim();
  const newText = currentText.replace(entry.modified, entry.original);
  bodyDiv.innerText = newText;

  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(bodyDiv);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  const history = rollbackStack.get(bodyDiv);
  const entryIndex = history.findIndex(h => h.id === entry.id);
  if (entryIndex > -1) history.splice(entryIndex, 1);

  lastSentMap.set(bodyDiv, entry.original);

  const rollbackBtn = document.querySelector('#gmail-rollback-btn');
  if (rollbackBtn) updateRollbackButtonState(rollbackBtn, bodyDiv);

  hideExistingPopup();
  hideExistingIndicator();
  showRollbackToast('변경사항이 되돌려졌습니다!');

  console.log('🔄 Rollback applied:', { from: entry.modified, to: entry.original });
}

function setupPopupKeyboard(popup) {
  popup.addEventListener('keydown', (e) => {
    const items = [...popup.querySelectorAll('.suggestion-item, .rollback-item')];
    const currentIndex = items.indexOf(document.activeElement);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[(currentIndex + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        popup.remove();
        break;
    }
  });
}

function showShortcutHelp() {
  const helpPopup = document.createElement('div');
  helpPopup.className = 'polite-popup';
  helpPopup.id = 'shortcut-help-popup';

  helpPopup.innerHTML = `
    <div class="popup-header">
      <div class="popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8 8-3.59 8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
        </svg>
        키보드 단축키
      </div>
      <button class="popup-close" onclick="this.remove()">×</button>
    </div>
    <div class="popup-body">
      <div style="font-size:13px; line-height:1.6;">
        <div style="margin-bottom:12px;">
          <strong>🎯 톤 분석 및 제안</strong><br>
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">Alt + T</code> 톤 체크 및 제안 보기
        </div>
        <div style="margin-bottom:12px;">
          <strong>🔄 되돌리기</strong><br>
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">Alt + Z</code> 변경사항 목록에서 되돌리기<br>
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">Alt + Q</code> 마지막 변경사항 빠른 되돌리기
        </div>
        <div style="margin-bottom:12px;">
          <strong>⌨️ 팝업 내 탐색</strong><br>
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">↑ ↓</code> 항목 이동 ·
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">Enter</code> 적용 ·
          <code style="background:#f1f3f4; padding:2px 6px; border-radius:3px; font-family:monospace;">Esc</code> 닫기
        </div>
        <div style="background:#e8f0fe; padding:8px; border-radius:6px; font-size:12px; color:#1565c0;">
          💡 이메일 작성 중일 때만 작동합니다.
        </div>
      </div>
    </div>
    <div class="popup-footer">
      Alt + H로 다시 열 수 있어요
    </div>
  `;

  document.body.appendChild(helpPopup);

  if (lastTarget) {
    positionPopup(helpPopup);
  } else {
    helpPopup.style.position = 'fixed';
    helpPopup.style.top = '50%';
    helpPopup.style.left = '50%';
    helpPopup.style.transform = 'translate(-50%, -50%)';
  }

  setTimeout(() => helpPopup.parentNode && helpPopup.remove(), 8000);
}

function positionIndicator() {
  if (!politeIndicator || !lastTarget) return;

  const targetRect = lastTarget.getBoundingClientRect();
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;

  let top, left;
  if (lastTarget._lastCursorRect) {
    top = lastTarget._lastCursorRect.top + 8;
    left = lastTarget._lastCursorRect.left;
  } else {
    top = scrollTop + targetRect.bottom + 8;
    left = scrollLeft + targetRect.left;
  }

  const indicatorWidth = 280;
  if (left + indicatorWidth > window.innerWidth) {
    left = window.innerWidth - indicatorWidth - 20;
  }

  politeIndicator.style.top = `${Math.max(top, scrollTop + 10)}px`;
  politeIndicator.style.left = `${Math.max(left, scrollLeft + 10)}px`;
}

function positionPopup(popup) {
  if (!lastTarget) return;

  const targetRect = lastTarget.getBoundingClientRect();
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;
  const popupWidth = 420;
  const popupHeight = 400;

  let top = scrollTop + targetRect.bottom + 40;
  let left = scrollLeft + targetRect.left;

  if (left + popupWidth > window.innerWidth) {
    left = window.innerWidth - popupWidth - 20;
  }
  if (top + popupHeight > window.innerHeight + scrollTop) {
    top = scrollTop + targetRect.top - popupHeight - 20;
  }

  popup.style.top = `${Math.max(top, scrollTop + 20)}px`;
  popup.style.left = `${Math.max(left, scrollLeft + 20)}px`;
}

function showSuccessToast(message) {
  const toast = document.createElement('div');
  toast.className = 'success-toast';
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideIn .3s cubic-bezier(.4,0,.2,1) reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function showRollbackToast(message) {
  const toast = document.createElement('div');
  toast.className = 'success-toast rollback-toast';
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideIn .3s cubic-bezier(.4,0,.2,1) reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function showError(errorMessage) {
  hideExistingIndicator();

  if (!lastTarget) return;

  politeIndicator = document.createElement('div');
  politeIndicator.className = 'polite-indicator tone-error';
  politeIndicator.innerHTML = `
    <div class="tone-badge error">!</div>
    <div class="indicator-content">
      <div class="indicator-title">연결 오류</div>
      <div class="indicator-subtitle">${errorMessage}</div>
    </div>`;

  document.body.appendChild(politeIndicator);
  positionIndicator();

  setTimeout(() => {
    if (politeIndicator && politeIndicator.querySelector('.indicator-title')?.textContent === '연결 오류') {
      hideExistingIndicator();
    }
  }, 5000);
}

function hideExistingIndicator() {
  if (politeIndicator) {
    politeIndicator.remove();
    politeIndicator = null;
  }
  if (rollbackIndicator) {
    rollbackIndicator.remove();
    rollbackIndicator = null;
  }
}

function hideExistingPopup() {
  const existingPopup = document.querySelector('#polite-popup, #rollback-popup');
  if (existingPopup) {
    existingPopup.remove();
  }
}

/* ===== Shortcuts (BG + fallback) ===== */
function setupKeyboardShortcuts() {
  const handleKeydown = (e) => {
    const hasEditable = !!ensureComposeTarget();
    if (e.key === 'Escape') { hideExistingPopup(); hideExistingIndicator(); return; }
    if (!hasEditable) return;
    if (!e.altKey) return;
    const k = e.key.toLowerCase();
    if (['t', 'z', 'q', 'h'].includes(k)) e.preventDefault();
    if (k === 't') handleToneCheck();
    if (k === 'z') handleShowRollback();
    if (k === 'q') handleQuickUndo();
    if (k === 'h') showShortcutHelp();
  };
  if (window._politeKeydownHandler) window.removeEventListener('keydown', window._politeKeydownHandler);
  window._politeKeydownHandler = handleKeydown;
  window.addEventListener('keydown', handleKeydown);
}
setupKeyboardShortcuts();

function handleCommand(command) {
  if (!ensureComposeTarget()) return;
  switch (command) {
    case 'tone-check': handleToneCheck(); break;
    case 'show-rollback': handleShowRollback(); break;
    case 'quick-undo': handleQuickUndo(); break;
    case 'show-help': showShortcutHelp(); break;
  }
}
function handleToneCheck() {
  if (!ensureComposeTarget()) return;
  if (suggestBuf.length > 0) showSuggestionsPopup();
  else analyzeEmailTone(lastTarget);
}
function handleShowRollback() {
  if (ensureComposeTarget() && hasRollbackHistory(lastTarget)) showRollbackPopup(lastTarget);
}
function handleQuickUndo() {
  if (!ensureComposeTarget()) return;
  const history = getRollbackHistory(lastTarget);
  if (history.length > 0) applyRollback(lastTarget, history[history.length - 1]);
}

/* ===== Keep positions responsive ===== */
['scroll', 'resize'].forEach(ev => {
  window.addEventListener(ev, () => {
    if (politeIndicator && lastTarget) positionIndicator();
    const popup = document.querySelector('#polite-popup, #rollback-popup');
    if (popup && lastTarget) positionPopup(popup);
  }, { passive: true });
});

/* ===== Background connectivity check ===== */
function checkBackgroundConnection() {
  chrome.runtime.sendMessage({ type: 'ping' }, () => {
    if (chrome.runtime.lastError) {
      console.warn('⚠️ Background not responding:', chrome.runtime.lastError.message);
      showError('확장 프로그램을 다시 로드해주세요.');
    }
  });
}
setTimeout(checkBackgroundConnection, 2000);
setInterval(checkBackgroundConnection, 5 * 60 * 1000);

console.log('✅ Gmail Polite Extension with Rollback (robust) loaded successfully');

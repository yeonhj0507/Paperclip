// background.js — MV3 Native Messaging (emailContent/analyze 둘 다 지원)
const HOST_NAME = 'com.paperclip.host.chrome';
let port = null;
let pingTimer = null;

function log(...args) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[BG ${ts}]`, ...args);
}

function connectNative() {
  if (port) return;
  log('connectNative: start');
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    log('connectNative: connected to host');
  } catch (e) {
    console.error('connectNative: FAILED ->', e);
    port = null;
    setTimeout(connectNative, 1000);
    return;
  }

  port.onMessage.addListener(onHostMessage);

  port.onDisconnect.addListener(() => {
    log('host disconnected');
    try { clearInterval(pingTimer); } catch (_) { }
    pingTimer = null;
    port = null;
    // 끊기면 큐는 남아있을 수 있으니 재연결 시도
    setTimeout(connectNative, 1000);
  });

  // keep-alive / 상태 확인
  pingTimer = setInterval(() => {
    try { port.postMessage({ type: 'ping' }); log('ping -> host'); } catch (_) { }
  }, 20000);
}

/* ---------- 요청 큐 (동시에 1개) ---------- */
const queue = [];
let busy = false;
let currentTarget = null; // {tabId, frameId}

function enqueue(payload, tabId, frameId) {
  queue.push({ payload, tabId, frameId });
  pump();
}

function pump() {
  if (busy || queue.length === 0) return;
  if (!port) connectNative();
  if (!port) { log('host not connected; wait'); return; }

  busy = true;
  const { payload, tabId, frameId } = queue.shift();
  currentTarget = { tabId, frameId };

  // 타임아웃 가드(8초)
  currentTarget._to = setTimeout(() => {
    log('host timeout -> fallback');
    deliverToCurrent({
      type: 'error',
      error: 'AI 응답이 지연됩니다. 잠시 후 다시 시도해 주세요.'
    });
    finishRequest();
  }, 800000);

  try {
    port.postMessage(payload);
    log('posted to host:', payload.type);
  } catch (e) {
    clearTimeout(currentTarget._to);
    deliverToCurrent({ type: 'error', error: String(e) });
    finishRequest();
  }
}

function finishRequest() {
  busy = false;
  currentTarget = null;
  pump();
}

function deliverToCurrent(msg) {
  if (!currentTarget) return;
  const { tabId, frameId } = currentTarget;
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, msg, { frameId }, () => void chrome.runtime.lastError);
  }
}

/* ---------- 호스트 응답 ---------- */
function onHostMessage(msg) {
  // DIAG는 콘솔만
  if (msg && msg.type === 'diag') {
    console.log('[HOST DIAG]', msg.path, msg.note, { in: msg.in_len, out: msg.out_len });
    return;
  }

  log('onMessage from host:', msg);

  if (msg && Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
    // 첫 요소 = tone flag, 나머지 = suggestions
    const [flag, ...rest] = msg.suggestions;

    const tone = flag.toLowerCase() === "impolite" ? "impolite" : "polite";
    const toneText = tone === "impolite" ? "수정을 권장해요" : "좋은 톤이에요";

    if (currentTarget?._to) clearTimeout(currentTarget._to);
    deliverToCurrent({
      type: "analysis_result",
      tone,
      toneText,
      suggestions: rest
    });
    finishRequest();
    return;
  }


  if (msg && msg.type === 'pong') {
    log('pong <- host');
    return;
  }

  if (msg && msg.error) {
    if (currentTarget?._to) clearTimeout(currentTarget._to);
    deliverToCurrent({ type: 'error', error: msg.error });
    finishRequest();
    return;
  }
}

/* ---------- SW 라이프사이클 ---------- */
chrome.runtime.onSuspend.addListener(() => {
  try { clearInterval(pingTimer); } catch (_) { }
  pingTimer = null;
  try { port?.disconnect(); } catch (_) { }
  port = null;
});

/* ---------- 이벤트 ---------- */
// 필요시만 연결(지연 연결 권장)
chrome.runtime.onInstalled.addListener(() => log('onInstalled'));
chrome.runtime.onStartup.addListener(() => log('onStartup'));
chrome.action.onClicked.addListener(() => { log('action clicked'); connectNative(); });

// CS -> BG
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  log('onMessage from CS:', req?.type);

  if (req?.type === 'ping') {
    sendResponse({ ok: true, ts: Date.now() });
    return; // sync
  }

  if (req?.type === 'suggestion_applied') {
    log('suggestion_applied', { ts: Date.now() });
    sendResponse({ ok: true });
    return;
  }

  if (req && (req.type === 'emailContent' || req.type === 'analyze')) {
    const focus = req.focus || req.body || '';
    const context = req.context || '';
    const body = req.body || '';
    const payload = { type: 'analyze', focus, context, body, ts: Date.now() };

    const tabId = sender?.tab?.id ?? null;
    const frameId = sender?.frameId ?? 0;

    enqueue(payload, tabId, frameId);
    sendResponse({ ok: true, status: 'queued' });
    return true; // async OK (응답 이미 반환했지만 MV3에선 true 허용)
  }

  sendResponse({ ok: false, error: 'unknown message' });
});

chrome.commands.onCommand.addListener((cmd) => {
  // 포커스 탭에 전달해서 CS가 처리하게
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: "command", command: cmd }, () => void chrome.runtime.lastError);
  });
});

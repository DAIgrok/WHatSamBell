/* ============================================================================
   NOSSO MUNDO ♡ — VANILLA JS (ES6+) ULTRA-LEVE PARA GALAXY J5
   - Usuários: Gabriel (2010) e Samella (2011) — sessão apenas em sessionStorage
   - Chat em Tempo Real duplo (Supabase Postgres Changes + Broadcast)
   - Menu ⋮ (Limpar mensagens) + Fotos Instagram (Normal, Dupla 2x, Apagar)
   - WebRTC canal único 'nosso-mundo-webrtc' + fila ICE + restartIce()
   - Transmissão de Tela 720p@30fps 1.2Mbps H.264/VP8 + Áudio isolado ao mutar mic
   - Chat invisível estilo Twitch (só texto) + ponto vermelho estilo Discord
   - Barra WhatsApp auto-ocultável + troca PiP + Tela Cheia + Áudio 48kHz / 128kbps
   ============================================================================ */

'use strict';

// ============================================================================
// CONFIGURAÇÃO DO SUPABASE
// ============================================================================
const SUPABASE_URL = 'https://nigimqjplcczxcbygjba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tnBcF8zySL-fuXSnlswfrA_p6afpsYz';

// Opcional: chave pública VAPID caso configure Edge Function de Web Push
const VAPID_PUBLIC_KEY = '';

const USERS = {
  Gabriel: '2010',
  Samella: '2011'
};

// Limites rígidos de hardware para o Samsung Galaxy J5 (1.5GB/2GB RAM)
const MAX_RENDERED_MESSAGES = 80;
const MAX_CALL_CHAT_MESSAGES = 20;
const INITIAL_FETCH_LIMIT = 40;
const IMAGE_MAX_SIDE_PX = 1024;
const IMAGE_JPEG_QUALITY = 0.72;
const WEBRTC_MAX_VIDEO_BITRATE_HD = 1200000;
const WEBRTC_MAX_VIDEO_BITRATE_ECO = 550000;
const AUDIO_RECORDER_BITRATE = 128000;
const CONTROLS_AUTOHIDE_MS = 5000;

const PHOTO_2X_PREFIX = '__NM2X__:';
const CALL_LOG_PREFIX = '__NMCALL__:';
const MSG_DELETED_MARKER = '__NM_DELETED__';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' }
];

// ============================================================================
// ESTADO DA APLICAÇÃO
// ============================================================================
const state = {
  supabase: null,
  chatChannel: null,
  callChannel: null,
  presenceChannel: null,
  statusChannel: null,

  currentUser: sessionStorage.getItem('nm_user') || 'Gabriel',
  partnerName: 'Samella',
  unlocked: sessionStorage.getItem('nm_unlocked') === '1',
  partnerOnlineRealtime: false,
  partnerLastSeen: null,
  partnerTyping: false,
  partnerTypingTimer: null,
  lastTypingSentAt: 0,
  clearedAtIso: sessionStorage.getItem('nm_cleared_at') || null,

  renderedIds: new Set(),
  callChatIds: new Set(),
  messageCache: new Map(),
  oldestTimestamp: null,
  newestTimestamp: null,
  hasMoreOlder: false,
  activeAudio: null,

  pendingPhotoBlob: null,
  pendingPhotoPreviewUrl: null,
  pendingPhotoMode: 'normal', // 'normal' | 'double'
  activeLightboxMsg: null,
  confirmActionCallback: null,

  mediaRecorder: null,
  recordingStream: null,
  audioChunks: [],
  recordingTimerId: null,
  recordingSeconds: 0,
  recordingCancelled: false,

  pc: null,
  localAudioStream: null,
  localVideoStream: null,
  remoteStream: null,
  screenMixCtx: null,
  screenMixMicGain: null,
  screenMixScreenGain: null,
  screenAudioTrack: null,
  localMediaVideoEl: null,
  localMediaObjectUrl: null,
  localMediaCanvas: null,
  localMediaRafId: null,
  localMediaScaleDownBy: 1,
  localMediaSeeking: false,
  localMediaLastUiUpdate: 0,
  pendingOffer: null,
  pendingCallerName: null,
  pendingCallWithVideo: false,
  pendingIceCandidates: [],
  inCall: false,
  incomingRinging: false,
  callMinimized: false,
  callIsInitiator: false,
  callSignaled: false,
  callInitialVideo: false,
  callConnected: false,
  callLogged: false,
  videoMode: 'off', // 'off' | 'camera' | 'screen'
  remoteVideoMode: 'off', // 'off' | 'camera' | 'screen'
  micMuted: false,
  soundMuted: false,
  facingMode: 'user',
  ecoMode480p: false,
  pipSwapped: false,
  controlsHidden: false,
  isStageRotated: false,
  callChatOpen: false,
  inCallUnreadCount: 0,
  controlsAutoHideTimerId: null,
  callTimerId: null,
  callSeconds: 0,
  ringTimeoutId: null,
  callToastTimerId: null,
  ringtoneTimerId: null,
  iceRestartTimerId: null,
  toastTimerId: null,
  wakeLock: null,

  swReg: null,
  audioCtx: null,
  deferredInstallPrompt: null
};

// ============================================================================
// SELETORES DE DOM
// ============================================================================
const el = {
  offlineBanner: document.getElementById('offline-banner'),
  lockScreen: document.getElementById('lock-screen'),
  chatScreen: document.getElementById('chat-screen'),
  unlockForm: document.getElementById('unlock-form'),
  roleButtons: document.querySelectorAll('.role-btn'),
  passcodeInput: document.getElementById('passcode-input'),
  lockError: document.getElementById('lock-error'),
  installLockBtn: document.getElementById('install-pwa-lock-btn'),

  partnerAvatar: document.getElementById('partner-avatar'),
  partnerNameHeader: document.getElementById('partner-name-header'),
  presenceDot: document.getElementById('presence-dot'),
  presenceLabel: document.getElementById('presence-label'),
  startVoiceBtn: document.getElementById('start-voice-call-btn'),
  startVideoBtn: document.getElementById('start-video-call-btn'),
  menuDotsBtn: document.getElementById('menu-dots-btn'),
  headerMenuPopover: document.getElementById('header-menu-popover'),
  clearChatBtn: document.getElementById('clear-chat-btn'),
  notifBtn: document.getElementById('notif-btn'),
  notifBtnLabel: document.getElementById('notif-btn-label'),
  installBtn: document.getElementById('install-pwa-btn'),
  lockAppBtn: document.getElementById('lock-app-btn'),

  chatAlertBanner: document.getElementById('chat-alert-banner'),
  chatAlertText: document.getElementById('chat-alert-text'),
  chatAlertClose: document.getElementById('chat-alert-close'),

  activeCallBanner: document.getElementById('active-call-banner'),
  callBannerText: document.getElementById('call-banner-text'),
  returnToCallBtn: document.getElementById('return-to-call-btn'),
  bannerHangupBtn: document.getElementById('banner-hangup-btn'),

  messagesViewport: document.getElementById('messages-viewport'),
  loadOlderBtn: document.getElementById('load-older-btn'),
  messagesList: document.getElementById('messages-list'),

  recordingBar: document.getElementById('recording-bar'),
  cancelRecordBtn: document.getElementById('cancel-record-btn'),
  recordTimer: document.getElementById('record-timer'),
  sendRecordBtn: document.getElementById('send-record-btn'),

  composerBar: document.getElementById('composer-bar'),
  photoInput: document.getElementById('photo-input'),
  photoBtn: document.getElementById('photo-btn'),
  messageInput: document.getElementById('message-input'),
  recordBtn: document.getElementById('record-btn'),
  sendBtn: document.getElementById('send-btn'),

  remoteAudio: document.getElementById('remote-audio'),

  photoModal: document.getElementById('photo-modal'),
  photoSizeBadge: document.getElementById('photo-size-badge'),
  photoPreviewImg: document.getElementById('photo-preview-img'),
  photoModeButtons: document.querySelectorAll('[data-photo-mode]'),
  photoCaptionInput: document.getElementById('photo-caption-input'),
  cancelPhotoBtn: document.getElementById('cancel-photo-btn'),
  confirmPhotoBtn: document.getElementById('confirm-photo-btn'),

  lightboxModal: document.getElementById('lightbox-modal'),
  lightboxBadge: document.getElementById('lightbox-badge'),
  lightboxDeleteBtn: document.getElementById('lightbox-delete-btn'),
  lightboxImg: document.getElementById('lightbox-img'),
  closeLightboxBtn: document.getElementById('close-lightbox-btn'),

  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
  confirmAcceptBtn: document.getElementById('confirm-accept-btn'),

  incomingModal: document.getElementById('incoming-call-modal'),
  incomingCallerName: document.getElementById('incoming-caller-name'),
  incomingCallType: document.getElementById('incoming-call-type'),
  rejectCallBtn: document.getElementById('reject-call-btn'),
  acceptCallBtn: document.getElementById('accept-call-btn'),

  videoOverlay: document.getElementById('video-call-overlay'),
  remoteVideo: document.getElementById('remote-video'),
  voiceStageFallback: document.getElementById('voice-stage-fallback'),
  stageAvatar: document.getElementById('stage-avatar'),
  stageSubtitle: document.getElementById('stage-subtitle'),
  localVideo: document.getElementById('local-video'),
  minimizeCallBtn: document.getElementById('minimize-call-btn'),
  callPartnerLabel: document.getElementById('call-partner-label'),
  callStateLabel: document.getElementById('call-state-label'),
  rotateStageBtn: document.getElementById('rotate-stage-btn'),
  ecoModeBtn: document.getElementById('eco-mode-btn'),
  callToast: document.getElementById('call-toast'),
  callChatOverlay: document.getElementById('call-chat-overlay'),
  callChatMessages: document.getElementById('call-chat-messages'),
  callChatForm: document.getElementById('call-chat-form'),
  callChatInput: document.getElementById('call-chat-input'),
  localMediaBar: document.getElementById('local-media-bar'),
  mediaPlayPauseBtn: document.getElementById('media-play-pause-btn'),
  mediaBackBtn: document.getElementById('media-back-btn'),
  mediaSeekSlider: document.getElementById('media-seek-slider'),
  mediaFwdBtn: document.getElementById('media-fwd-btn'),
  mediaTimeLabel: document.getElementById('media-time-label'),
  mediaChangeFileBtn: document.getElementById('media-change-file-btn'),
  toggleMicBtn: document.getElementById('toggle-mic-btn'),
  toggleCamBtn: document.getElementById('toggle-cam-btn'),
  switchCamBtn: document.getElementById('switch-cam-btn'),
  shareScreenBtn: document.getElementById('share-screen-btn'),
  toggleSoundBtn: document.getElementById('toggle-sound-btn'),
  toggleCallChatBtn: document.getElementById('toggle-call-chat-btn'),
  callChatBadge: document.getElementById('call-chat-badge'),
  toggleFullscreenBtn: document.getElementById('toggle-fullscreen-btn'),
  hangupBtn: document.getElementById('hangup-btn'),

  screenVideoFileInput: document.getElementById('screen-video-file-input'),
  screenUnsupportedModal: document.getElementById('screen-unsupported-modal'),
  screenErrorReason: document.getElementById('screen-error-reason'),
  streamLocalVideoBtn: document.getElementById('stream-local-video-btn'),
  closeScreenModalBtn: document.getElementById('close-screen-modal-btn'),

  iosInstallModal: document.getElementById('ios-install-modal'),
  closeIosModalBtn: document.getElementById('close-ios-modal-btn'),

  msgToast: document.getElementById('msg-toast'),
  msgToastText: document.getElementById('msg-toast-text')
};

// ============================================================================
// UTILITÁRIOS
// ============================================================================
function hasSupabaseCredentials() {
  return (
    SUPABASE_URL &&
    SUPABASE_URL !== 'SUA_URL_SUPABASE' &&
    SUPABASE_ANON_KEY &&
    SUPABASE_ANON_KEY !== 'SUA_CHAVE_ANON' &&
    SUPABASE_URL.startsWith('https://')
  );
}

function getPartnerFor(user) {
  return user === 'Gabriel' ? 'Samella' : 'Gabriel';
}

function formatTime(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getDateKey(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  const now = new Date();
  const todayKey = getDateKey(now.toISOString());
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const yesterdayKey = getDateKey(yest.toISOString());
  const targetKey = getDateKey(d.toISOString());

  if (targetKey === todayKey) return 'Hoje';
  if (targetKey === yesterdayKey) return 'Ontem';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatLastSeen(isoString) {
  if (!isoString) return 'Offline';
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hhmm = formatTime(isoString);
  return isToday
    ? `visto por último hoje às ${hhmm}`
    : `visto em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hhmm}`;
}

function formatSeconds(totalSeconds) {
  const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function revokePendingPhotoUrl() {
  if (state.pendingPhotoPreviewUrl) {
    URL.revokeObjectURL(state.pendingPhotoPreviewUrl);
    state.pendingPhotoPreviewUrl = null;
  }
}

function stopStreamTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (_) {}
  });
}

function showChatAlert(text) {
  el.chatAlertText.textContent = text;
  el.chatAlertBanner.classList.remove('hidden');
}

function hideChatAlert() {
  el.chatAlertBanner.classList.add('hidden');
}

function showCallToast(text) {
  clearTimeout(state.callToastTimerId);
  el.callToast.textContent = text;
  el.callToast.classList.remove('hidden');
  state.callToastTimerId = setTimeout(() => {
    el.callToast.classList.add('hidden');
  }, 4000);
}

function openConfirmModal(title, message, confirmLabel, callback) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  el.confirmAcceptBtn.textContent = confirmLabel || 'Confirmar';
  state.confirmActionCallback = callback;
  el.confirmModal.classList.remove('hidden');
}

function closeConfirmModal() {
  el.confirmModal.classList.add('hidden');
  state.confirmActionCallback = null;
}

function playSoftTone(freqStart, freqEnd) {
  if (state.inCall || state.incomingRinging) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!state.audioCtx) state.audioCtx = new Ctx();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + 0.14);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  } catch (_) {}
}

function playMessagePlim() {
  if (state.inCall || state.incomingRinging) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!state.audioCtx) state.audioCtx = new Ctx();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch (_) {}
}

function startRingtone() {
  stopRingtone();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!state.audioCtx) state.audioCtx = new Ctx();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const playBell = () => {
      if (!state.ringtoneTimerId) return;
      const now = state.audioCtx.currentTime;
      const notes = [1046.5, 1318.5, 1568.0];
      notes.forEach((freq, idx) => {
        const osc = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.16);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.16 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.26);
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);
        osc.start(now + idx * 0.16);
        osc.stop(now + idx * 0.16 + 0.28);
      });
    };

    playBell();
    state.ringtoneTimerId = setInterval(playBell, 1800);
  } catch (_) {}
}

function stopRingtone() {
  if (state.ringtoneTimerId) {
    clearInterval(state.ringtoneTimerId);
    state.ringtoneTimerId = null;
  }
}

function showMsgToast(text) {
  if (state.inCall || state.incomingRinging) return;
  clearTimeout(state.toastTimerId);
  el.msgToastText.textContent = text;
  el.msgToast.classList.remove('hidden');
  state.toastTimerId = setTimeout(() => {
    el.msgToast.classList.add('hidden');
  }, 4200);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ============================================================================
// METADADOS DE FOTOS (NORMAL, VISUALIZAÇÃO DUPLA 2X E EXCLUSÃO)
// ============================================================================
function parseCallLogMeta(msg) {
  if (!msg || msg.media_type !== 'text' || typeof msg.content !== 'string') return null;
  if (!msg.content.startsWith(CALL_LOG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(msg.content.slice(CALL_LOG_PREFIX.length));
    return {
      isCallLog: true,
      kind: parsed.kind === 'video' ? 'video' : 'voice',
      status: parsed.status || 'missed',
      duration: Math.max(0, Number.parseInt(parsed.duration, 10) || 0)
    };
  } catch (_) {
    return { isCallLog: true, kind: 'voice', status: 'missed', duration: 0 };
  }
}

function serializeCallLogMeta(kind, status, duration) {
  return `${CALL_LOG_PREFIX}${JSON.stringify({
    kind: kind === 'video' ? 'video' : 'voice',
    status: status || 'missed',
    duration: Math.max(0, Math.round(duration || 0))
  })}`;
}

function parsePhotoMeta(msg) {
  const raw = msg && typeof msg.content === 'string' ? msg.content : '';
  if (raw === MSG_DELETED_MARKER) {
    return { deleted: true, isDouble: false, viewsLeft: 0, caption: '' };
  }
  if (raw.startsWith(PHOTO_2X_PREFIX)) {
    const rest = raw.slice(PHOTO_2X_PREFIX.length);
    const sepIdx = rest.indexOf('|');
    const countStr = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
    const caption = sepIdx === -1 ? '' : rest.slice(sepIdx + 1);
    const viewsLeft = Math.max(0, Number.parseInt(countStr, 10) || 0);
    return { deleted: false, isDouble: true, viewsLeft, caption };
  }
  return { deleted: false, isDouble: false, viewsLeft: Infinity, caption: raw };
}

function serializePhotoMeta(isDouble, viewsLeft, caption) {
  if (!isDouble) return caption || null;
  return `${PHOTO_2X_PREFIX}${Math.max(0, viewsLeft)}|${caption || ''}`;
}

function extractStoragePathFromPublicUrl(publicUrl) {
  if (!publicUrl || typeof publicUrl !== 'string') return null;
  const marker = '/storage/v1/object/public/chat-media/';
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(publicUrl.slice(idx + marker.length).split('?')[0]);
}

async function removeMediaFromStorage(publicUrl) {
  if (!state.supabase || !publicUrl) return;
  const path = extractStoragePathFromPublicUrl(publicUrl);
  if (!path) return;
  try {
    await state.supabase.storage.from('chat-media').remove([path]);
  } catch (_) {}
}

// ============================================================================
// PWA, PUSH NOTIFICATIONS E PERSISTÊNCIA EM SEGUNDO PLANO
// ============================================================================
function updateNotifButtonVisual() {
  if (!('Notification' in window)) {
    el.notifBtn.classList.add('hidden');
    return;
  }
  const granted = Notification.permission === 'granted';
  el.notifBtn.classList.toggle('notif-enabled', granted);
  if (el.notifBtnLabel) {
    el.notifBtnLabel.textContent = granted ? 'Notificações ativadas' : 'Ativar notificações';
  }
}

async function activatePushNotifications(interactive) {
  if (!('Notification' in window)) {
    if (interactive) showChatAlert('Este navegador não suporta notificações push.');
    return;
  }

  let perm = Notification.permission;
  if (perm === 'default' && interactive) {
    perm = await Notification.requestPermission();
  }
  updateNotifButtonVisual();

  if (perm === 'denied') {
    if (interactive) {
      showChatAlert('Notificações bloqueadas no navegador. Libere nas configurações do site.');
    }
    return;
  }

  if (perm !== 'granted') return;

  try {
    const reg = state.swReg || (await navigator.serviceWorker.ready);
    state.swReg = reg;

    if (VAPID_PUBLIC_KEY && reg.pushManager && state.supabase) {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      await state.supabase.from('push_subscriptions').upsert({
        username: state.currentUser,
        subscription: sub.toJSON(),
        updated_at: new Date().toISOString()
      });
    }

    if (interactive) {
      showChatAlert('Notificações ativadas! Você receberá alertas em segundo plano ♡');
      setTimeout(hideChatAlert, 3500);
    }
  } catch (_) {}
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        state.swReg = reg;
        reg.update().catch(() => {});
      })
      .catch(() => {});
  }

  const updateOnlineBanner = () => {
    el.offlineBanner.classList.toggle('hidden', navigator.onLine);
    if (navigator.onLine && state.unlocked && state.supabase) {
      syncMissedMessages();
    }
  };
  window.addEventListener('online', updateOnlineBanner);
  window.addEventListener('offline', updateOnlineBanner);
  updateOnlineBanner();

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const showInstallButtons = (visible) => {
    if (isStandalone) {
      el.installBtn.classList.add('hidden');
      el.installLockBtn.classList.add('hidden');
      return;
    }
    el.installBtn.classList.toggle('hidden', !visible);
    el.installLockBtn.classList.toggle('hidden', !visible);
  };

  if (isIOS && !isStandalone) showInstallButtons(true);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    showInstallButtons(true);
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    showInstallButtons(false);
  });

  const triggerInstall = async () => {
    closeHeaderMenu();
    if (state.deferredInstallPrompt) {
      await state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        state.deferredInstallPrompt = null;
        showInstallButtons(false);
      }
      return;
    }
    if (isIOS) el.iosInstallModal.classList.remove('hidden');
  };

  el.installBtn.addEventListener('click', triggerInstall);
  el.installLockBtn.addEventListener('click', triggerInstall);
  el.closeIosModalBtn.addEventListener('click', () => el.iosInstallModal.classList.add('hidden'));

  updateNotifButtonVisual();
  el.notifBtn.addEventListener('click', () => {
    closeHeaderMenu();
    activatePushNotifications(true);
  });
  el.chatAlertClose.addEventListener('click', hideChatAlert);
}

async function notifyBackground(title, body, tag, allowDuringCall = false) {
  if (!allowDuringCall && (state.inCall || state.incomingRinging)) return;
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const opts = {
    body,
    tag: tag || 'nosso-mundo',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    renotify: true,
    vibrate: [220, 100, 220]
  };

  try {
    const reg = state.swReg || (navigator.serviceWorker && (await navigator.serviceWorker.ready));
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, opts);
    } else {
      new Notification(title, opts);
    }
  } catch (_) {}
}

function updateMediaSessionForCall(active) {
  if (!('mediaSession' in navigator)) return;
  try {
    if (active) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Ligação com ${state.partnerName}`,
        artist: 'Nosso Mundo ♡',
        album: 'Chamada ativa em segundo plano',
        artwork: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
      });
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler('stop', () => endCall(true));
      navigator.mediaSession.setActionHandler('pause', () => toggleMic());
    } else {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.setActionHandler('pause', null);
    }
  } catch (_) {}
}

async function manageWakeLock(acquire) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (acquire && !state.wakeLock && state.videoMode !== 'off') {
      state.wakeLock = await navigator.wakeLock.request('screen');
    } else if (!acquire && state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
    }
  } catch (_) {}
}

// ============================================================================
// TELA DE ACESSO (SESSIONSTORAGE APENAS — PEDE SENHA AO FECHAR E ABRIR)
// ============================================================================
function initLockScreen() {
  if (!USERS[state.currentUser]) state.currentUser = 'Gabriel';
  state.partnerName = getPartnerFor(state.currentUser);

  el.roleButtons.forEach((btn) => {
    const selected = btn.dataset.user === state.currentUser;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', String(selected));

    btn.addEventListener('click', () => {
      state.currentUser = btn.dataset.user;
      state.partnerName = getPartnerFor(state.currentUser);
      el.roleButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      el.lockError.classList.add('hidden');
    });
  });

  el.unlockForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = el.passcodeInput.value.trim();

    if (!hasSupabaseCredentials()) {
      showLockError('Credenciais do Supabase ausentes em app.js.');
      return;
    }

    if (pass !== USERS[state.currentUser]) {
      showLockError(`Senha incorreta para ${state.currentUser}.`);
      return;
    }

    el.lockError.classList.add('hidden');
    state.partnerName = getPartnerFor(state.currentUser);
    state.unlocked = true;
    sessionStorage.setItem('nm_user', state.currentUser);
    sessionStorage.setItem('nm_unlocked', '1');
    el.passcodeInput.value = '';
    enterChat();
  });

  el.lockAppBtn.addEventListener('click', () => {
    closeHeaderMenu();
    lockApp();
  });

  if (state.unlocked && hasSupabaseCredentials() && USERS[state.currentUser]) {
    enterChat();
  }
}

function showLockError(msg) {
  el.lockError.textContent = msg;
  el.lockError.classList.remove('hidden');
}

function lockApp() {
  updateMyDbStatus(false);
  state.unlocked = false;
  sessionStorage.removeItem('nm_unlocked');
  sessionStorage.removeItem('nm_user');
  cleanupRealtimeChannels();
  endCall(false);
  cancelAudioRecording();
  closeLightbox();
  closePhotoModal();
  closeConfirmModal();
  el.chatScreen.classList.add('hidden');
  el.lockScreen.classList.remove('hidden');
}

// ============================================================================
// MENU 3 PONTINHOS (⋮) E LIMPEZA DE MENSAGENS
// ============================================================================
function closeHeaderMenu() {
  el.headerMenuPopover.classList.add('hidden');
  el.menuDotsBtn.setAttribute('aria-expanded', 'false');
}

function toggleHeaderMenu() {
  const isOpen = !el.headerMenuPopover.classList.contains('hidden');
  if (isOpen) {
    closeHeaderMenu();
  } else {
    el.headerMenuPopover.classList.remove('hidden');
    el.menuDotsBtn.setAttribute('aria-expanded', 'true');
  }
}

function resetLocalChatDom(emptyLabel) {
  el.messagesList.innerHTML = '';
  el.callChatMessages.innerHTML = '';
  state.renderedIds.clear();
  state.callChatIds.clear();
  state.messageCache.clear();
  state.oldestTimestamp = null;
  state.newestTimestamp = null;
  state.hasMoreOlder = false;
  el.loadOlderBtn.classList.add('hidden');
  renderEmptyState(emptyLabel || `Envie a primeira mensagem para ${state.partnerName} ♡`);
}

async function executeClearChat() {
  const nowIso = new Date().toISOString();
  state.clearedAtIso = nowIso;
  sessionStorage.setItem('nm_cleared_at', nowIso);

  resetLocalChatDom('Mensagens limpas ♡');

  if (state.chatChannel) {
    state.chatChannel.send({
      type: 'broadcast',
      event: 'chat-cleared',
      payload: { clearedAt: nowIso }
    });
  }

  if (!state.supabase) return;

  // Tenta limpar arquivos de mídia do Storage antes de apagar linhas no banco
  try {
    const { data: mediaRows } = await state.supabase
      .from('messages')
      .select('media_url')
      .not('media_url', 'is', null)
      .limit(200);
    if (mediaRows && mediaRows.length > 0) {
      const paths = mediaRows
        .map((r) => extractStoragePathFromPublicUrl(r.media_url))
        .filter(Boolean);
      if (paths.length > 0) {
        await state.supabase.storage.from('chat-media').remove(paths);
      }
    }
  } catch (_) {}

  // Tenta DELETE permanente; se RLS bloquear (SQL antigo), faz UPDATE marcando como apagado
  const { error: delErr } = await state.supabase
    .from('messages')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (delErr) {
    await state.supabase
      .from('messages')
      .update({ content: MSG_DELETED_MARKER, media_url: null, is_read: true })
      .neq('id', '00000000-0000-0000-0000-000000000000');
  }
}

// ============================================================================
// CONEXÃO SUPABASE + REALTIME DUPLO + PRESENÇA + WEBRTC DEDICADO
// ============================================================================
function enterChat() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showLockError('SDK do Supabase não carregado. Verifique sua internet.');
    return;
  }

  state.supabase = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
    realtime: { params: { eventsPerSecond: 20 } }
  });

  state.partnerName = getPartnerFor(state.currentUser);
  el.partnerNameHeader.textContent = state.partnerName;
  el.partnerAvatar.textContent = state.partnerName.charAt(0);
  el.stageAvatar.textContent = state.partnerName.charAt(0);
  el.callPartnerLabel.textContent = state.partnerName;

  el.lockScreen.classList.add('hidden');
  el.chatScreen.classList.remove('hidden');

  updateNotifButtonVisual();
  if ('Notification' in window && Notification.permission === 'granted') {
    activatePushNotifications(false);
  }

  loadPartnerInitialStatus();
  updateMyDbStatus(true);
  loadInitialMessages();
  subscribeRealtime();
}

async function loadPartnerInitialStatus() {
  if (!state.supabase) return;
  const { data } = await state.supabase
    .from('user_status')
    .select('is_online, last_seen')
    .eq('username', state.partnerName)
    .maybeSingle();

  if (data) {
    state.partnerLastSeen = data.last_seen;
    renderPartnerStatus(data.is_online || state.partnerOnlineRealtime, data.last_seen);
  }
}

async function updateMyDbStatus(isOnline) {
  if (!state.supabase) return;
  try {
    await state.supabase.from('user_status').upsert({
      username: state.currentUser,
      is_online: isOnline,
      last_seen: new Date().toISOString()
    });
  } catch (_) {}
}

function renderPartnerStatus(isOnline, lastSeenIso) {
  if (state.partnerTyping) {
    el.presenceDot.classList.add('online');
    el.presenceLabel.textContent = 'digitando...';
    return;
  }
  el.presenceDot.classList.toggle('online', isOnline);
  el.presenceLabel.textContent = isOnline ? 'Online agora' : formatLastSeen(lastSeenIso);
}

function cleanupRealtimeChannels() {
  if (!state.supabase) return;
  [state.chatChannel, state.callChannel, state.presenceChannel, state.statusChannel].forEach((ch) => {
    if (ch) state.supabase.removeChannel(ch);
  });
  state.chatChannel = null;
  state.callChannel = null;
  state.presenceChannel = null;
  state.statusChannel = null;
}

function handleIncomingRealtimeMessage(msg) {
  if (!msg || !msg.id) return;
  if (state.clearedAtIso && msg.created_at && msg.created_at <= state.clearedAtIso) return;
  const photoMeta = parsePhotoMeta(msg);
  if (photoMeta.deleted) return;

  const isNew = !state.renderedIds.has(msg.id);
  appendMessage(msg, true);

  if (!isNew) return;

  // Alimenta o chat invisível estilo Twitch quando em chamada
  appendCallChatMessage(msg);

  if (msg.sender_name !== state.currentUser) {
    state.partnerTyping = false;
    renderPartnerStatus(state.partnerOnlineRealtime, state.partnerLastSeen);

    // Durante chamada/transmissão: ZERO toasts, ZERO som "plim", ZERO push notification!
    // Apenas acende o ponto vermelho no botão de chat estilo Discord se o chat invisível estiver fechado.
    if (state.inCall || state.incomingRinging) {
      if (!state.callChatOpen) {
        state.inCallUnreadCount += 1;
        updateCallChatBadge();
      } else {
        markIncomingAsRead([msg.id]);
      }
      return;
    }

    const callMeta = parseCallLogMeta(msg);
    const preview = callMeta
      ? callMeta.kind === 'video'
        ? '📹 Chamada de vídeo'
        : '📞 Ligação de voz'
      : msg.media_type === 'image'
        ? photoMeta.isDouble
          ? '📷 Enviou uma foto 2x'
          : '📷 Enviou uma foto'
        : msg.media_type === 'audio'
          ? '🎤 Enviou um áudio'
          : msg.content || 'Nova mensagem';

    if (document.visibilityState === 'visible') {
      const viewport = el.messagesViewport;
      const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
      if (callMeta) {
        // Marcador de chamada recém-registrado não precisa disparar toast/som extra
      } else if (nearBottom) {
        playSoftTone(580, 760);
      } else {
        playMessagePlim();
        showMsgToast(`${state.partnerName}: ${preview}`);
      }
      markIncomingAsRead([msg.id]);
    } else {
      notifyBackground(msg.sender_name, preview, 'msg-nosso-mundo');
    }
  }
}

function handleMessageDeletedOrUpdated(msg) {
  if (!msg || !msg.id) return;
  const meta = parsePhotoMeta(msg);
  if (meta.deleted) {
    removeMessageFromDom(msg.id);
    return;
  }
  const cached = state.messageCache.get(msg.id);
  const merged = cached ? { ...cached, ...msg } : msg;
  state.messageCache.set(msg.id, merged);

  updateMessageTicksInDom(merged);
  if (merged.media_type === 'image') {
    updatePhotoMessageInDom(merged);
  }
}

function subscribeRealtime() {
  cleanupRealtimeChannels();

  // 1. Canal do Chat: Postgres Changes + Broadcast instantâneo
  state.chatChannel = state.supabase
    .channel('nosso-mundo-chat', {
      config: { broadcast: { self: false } }
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        if (payload && payload.new) handleIncomingRealtimeMessage(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        if (payload && payload.new) handleMessageDeletedOrUpdated(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        if (payload && payload.old && payload.old.id) {
          removeMessageFromDom(payload.old.id);
        }
      }
    )
    .on('broadcast', { event: 'new-message' }, ({ payload }) => {
      if (payload) handleIncomingRealtimeMessage(payload);
    })
    .on('broadcast', { event: 'read-receipt' }, ({ payload }) => {
      if (payload && Array.isArray(payload.ids)) {
        payload.ids.forEach((id) => updateMessageTicksInDom({ id, is_read: true }));
      }
    })
    .on('broadcast', { event: 'photo-view-updated' }, ({ payload }) => {
      if (payload && payload.id) handleMessageDeletedOrUpdated(payload);
    })
    .on('broadcast', { event: 'message-deleted' }, ({ payload }) => {
      if (payload && payload.id) removeMessageFromDom(payload.id);
    })
    .on('broadcast', { event: 'chat-cleared' }, ({ payload }) => {
      if (payload && payload.clearedAt) {
        state.clearedAtIso = payload.clearedAt;
        sessionStorage.setItem('nm_cleared_at', payload.clearedAt);
      }
      resetLocalChatDom('Mensagens limpas ♡');
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.from === state.currentUser) return;
      state.partnerTyping = true;
      renderPartnerStatus(true, state.partnerLastSeen);
      clearTimeout(state.partnerTypingTimer);
      state.partnerTypingTimer = setTimeout(() => {
        state.partnerTyping = false;
        renderPartnerStatus(state.partnerOnlineRealtime, state.partnerLastSeen);
      }, 2600);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showChatAlert('Reconectando ao tempo real...');
      } else if (status === 'SUBSCRIBED') {
        hideChatAlert();
      }
    });

  // 2. Presença em tempo real (Online / Offline imediato)
  state.presenceChannel = state.supabase.channel('nosso-mundo-presence', {
    config: { presence: { key: state.currentUser } }
  });

  state.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const presenceState = state.presenceChannel.presenceState();
      const online = Boolean(presenceState[state.partnerName]);
      const wasOnline = state.partnerOnlineRealtime;
      state.partnerOnlineRealtime = online;

      if (online) {
        renderPartnerStatus(true, state.partnerLastSeen);
        upgradePendingTicksToDelivered();
      } else {
        if (wasOnline) state.partnerLastSeen = new Date().toISOString();
        renderPartnerStatus(false, state.partnerLastSeen);
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await state.presenceChannel.track({
          user: state.currentUser,
          online_at: new Date().toISOString()
        });
      }
    });

  // 3. Atualização do visto por último via banco
  state.statusChannel = state.supabase
    .channel('nosso-mundo-status')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_status', filter: `username=eq.${state.partnerName}` },
      (payload) => {
        if (!payload || !payload.new) return;
        state.partnerLastSeen = payload.new.last_seen;
        renderPartnerStatus(state.partnerOnlineRealtime || payload.new.is_online, payload.new.last_seen);
      }
    )
    .subscribe();

  // 4. Canal Único de Sinalização WebRTC sempre ativo ('nosso-mundo-webrtc')
  state.callChannel = state.supabase.channel('nosso-mundo-webrtc', {
    config: { broadcast: { self: false } }
  });

  state.callChannel
    .on('broadcast', { event: 'incoming-call' }, ({ payload }) => {
      handleIncomingCall(payload);
    })
    .on('broadcast', { event: 'call-accepted' }, ({ payload }) => {
      handleCallAccepted(payload);
    })
    .on('broadcast', { event: 'call-rejected' }, () => {
      handleCallRejectedOrEnded(true);
    })
    .on('broadcast', { event: 'call-ended' }, () => {
      handleCallRejectedOrEnded(false);
    })
    .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
      handleIncomingIceCandidate(payload);
    })
    .on('broadcast', { event: 'renegotiate-offer' }, ({ payload }) => {
      handleRenegotiateOffer(payload);
    })
    .on('broadcast', { event: 'renegotiate-answer' }, ({ payload }) => {
      handleRenegotiateAnswer(payload);
    })
    .on('broadcast', { event: 'ice-restart-offer' }, ({ payload }) => {
      handleIceRestartOffer(payload);
    })
    .on('broadcast', { event: 'ice-restart-answer' }, ({ payload }) => {
      handleIceRestartAnswer(payload);
    })
    .on('broadcast', { event: 'video-mode-sync' }, ({ payload }) => {
      handleRemoteVideoModeSync(payload);
    })
    .on('broadcast', { event: 'video-off-notify' }, () => {
      state.remoteVideoMode = 'off';
      updateRemoteStageVisibility();
    })
    .on('broadcast', { event: 'video-on-notify' }, () => {
      if (state.remoteStream && state.remoteStream.getVideoTracks().length > 0) {
        el.remoteVideo.srcObject = state.remoteStream;
        updateRemoteStageVisibility();
      }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showChatAlert('Reconectando sinalização de chamada...');
      }
    });
}

// ============================================================================
// CHAT: CARREGAMENTO, SYNC, FOTOS NORMAL/2X/APAGAR E VISTO
// ============================================================================
async function loadInitialMessages() {
  el.messagesList.innerHTML = '';
  el.callChatMessages.innerHTML = '';
  state.renderedIds.clear();
  state.callChatIds.clear();
  state.messageCache.clear();
  state.oldestTimestamp = null;
  state.newestTimestamp = null;

  let query = state.supabase
    .from('messages')
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(INITIAL_FETCH_LIMIT);

  if (state.clearedAtIso) {
    query = query.gt('created_at', state.clearedAtIso);
  }

  const { data, error } = await query;

  if (error) {
    if (error.code === '42501') {
      showChatAlert('Execute os comandos GRANT do supabase_setup.sql no SQL Editor do Supabase.');
    }
    renderEmptyState('Sem acesso às mensagens. Execute o SQL atualizado no Supabase.');
    return;
  }

  const visibleRows = (data || []).filter((m) => !parsePhotoMeta(m).deleted);

  if (visibleRows.length === 0) {
    renderEmptyState(`Envie a primeira mensagem para ${state.partnerName} ♡`);
    el.loadOlderBtn.classList.add('hidden');
    return;
  }

  state.hasMoreOlder = data.length === INITIAL_FETCH_LIMIT;
  el.loadOlderBtn.classList.toggle('hidden', !state.hasMoreOlder);

  const ordered = visibleRows.slice().reverse();
  state.oldestTimestamp = ordered[0].created_at;
  state.newestTimestamp = ordered[ordered.length - 1].created_at;

  const unreadIds = [];
  const frag = document.createDocumentFragment();
  ordered.forEach((msg) => {
    const node = buildMessageNode(msg);
    if (node) frag.appendChild(node);
    appendCallChatMessage(msg);
    if (msg.sender_name !== state.currentUser && !msg.is_read) {
      unreadIds.push(msg.id);
    }
  });
  el.messagesList.appendChild(frag);
  rebuildDayDividers();
  scrollToBottom(true);

  if (unreadIds.length > 0 && document.visibilityState === 'visible') {
    markIncomingAsRead(unreadIds);
  }
}

async function syncMissedMessages() {
  if (!state.supabase || !state.newestTimestamp) return;
  const { data, error } = await state.supabase
    .from('messages')
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .gt('created_at', state.newestTimestamp)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data || data.length === 0) return;
  data.forEach((msg) => handleIncomingRealtimeMessage(msg));
}

async function loadOlderMessages() {
  if (!state.oldestTimestamp) return;
  el.loadOlderBtn.disabled = true;
  el.loadOlderBtn.textContent = 'Carregando...';

  let query = state.supabase
    .from('messages')
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .lt('created_at', state.oldestTimestamp)
    .order('created_at', { ascending: false })
    .limit(INITIAL_FETCH_LIMIT);

  if (state.clearedAtIso) {
    query = query.gt('created_at', state.clearedAtIso);
  }

  const { data, error } = await query;

  el.loadOlderBtn.disabled = false;
  el.loadOlderBtn.textContent = 'Carregar mensagens anteriores';

  if (error || !data || data.length === 0) {
    el.loadOlderBtn.classList.add('hidden');
    return;
  }

  state.hasMoreOlder = data.length === INITIAL_FETCH_LIMIT;
  el.loadOlderBtn.classList.toggle('hidden', !state.hasMoreOlder);

  const visibleRows = data.filter((m) => !parsePhotoMeta(m).deleted);
  if (visibleRows.length === 0) return;

  const prevHeight = el.messagesViewport.scrollHeight;
  const ordered = visibleRows.slice().reverse();
  state.oldestTimestamp = ordered[0].created_at;

  const unreadIds = [];
  const frag = document.createDocumentFragment();
  ordered.forEach((msg) => {
    const node = buildMessageNode(msg);
    if (node) frag.appendChild(node);
    if (msg.sender_name !== state.currentUser && !msg.is_read) {
      unreadIds.push(msg.id);
    }
  });

  el.messagesList.insertBefore(frag, el.messagesList.firstChild);
  rebuildDayDividers();
  el.messagesViewport.scrollTop = el.messagesViewport.scrollHeight - prevHeight;

  if (unreadIds.length > 0 && document.visibilityState === 'visible') {
    markIncomingAsRead(unreadIds);
  }
}

async function markIncomingAsRead(ids) {
  if (!state.supabase || !ids || ids.length === 0) return;

  if (state.chatChannel) {
    state.chatChannel.send({
      type: 'broadcast',
      event: 'read-receipt',
      payload: { ids }
    });
  }

  await state.supabase
    .from('messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .in('id', ids)
    .eq('is_read', false);
}

async function markAllVisibleUnreadAsRead() {
  if (!state.supabase || !state.unlocked) return;
  const { data } = await state.supabase
    .from('messages')
    .select('id')
    .eq('sender_name', state.partnerName)
    .eq('is_read', false)
    .limit(50);

  if (data && data.length > 0) {
    await markIncomingAsRead(data.map((r) => r.id));
  }
}

function renderEmptyState(text) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = text;
  el.messagesList.appendChild(p);
}

function getTickSymbol(msg) {
  if (msg.is_read) return { text: '✓✓', read: true };
  if (state.partnerOnlineRealtime) return { text: '✓✓', read: false };
  return { text: '✓', read: false };
}

function updateMessageTicksInDom(msg) {
  const row = el.messagesList.querySelector(`[data-id="${msg.id}"]`);
  if (!row) return;
  const tickEl = row.querySelector('.msg-ticks');
  if (!tickEl) return;
  const info = getTickSymbol(msg);
  tickEl.textContent = info.text;
  tickEl.classList.toggle('read', info.read);
}

function upgradePendingTicksToDelivered() {
  el.messagesList.querySelectorAll('.msg-row.me .msg-ticks:not(.read)').forEach((tickEl) => {
    tickEl.textContent = '✓✓';
  });
}

function rebuildDayDividers() {
  el.messagesList.querySelectorAll('.day-divider').forEach((d) => d.remove());
  let lastDateKey = '';
  const rows = Array.from(el.messagesList.querySelectorAll('.msg-row'));
  rows.forEach((row) => {
    const key = row.dataset.dateKey;
    if (key && key !== lastDateKey) {
      lastDateKey = key;
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.textContent = formatDayLabel(row.dataset.createdAt);
      el.messagesList.insertBefore(divider, row);
    }
  });
}

function removeMessageFromDom(msgId) {
  state.renderedIds.delete(msgId);
  state.messageCache.delete(msgId);
  const row = el.messagesList.querySelector(`[data-id="${msgId}"]`);
  if (row) row.remove();
  if (state.activeLightboxMsg && state.activeLightboxMsg.id === msgId) {
    state.activeLightboxMsg = null;
    el.lightboxModal.classList.add('hidden');
    el.lightboxImg.removeAttribute('src');
  }
  rebuildDayDividers();
  if (!el.messagesList.querySelector('.msg-row')) {
    renderEmptyState(`Envie a primeira mensagem para ${state.partnerName} ♡`);
  }
}

function renderPhotoContentIntoSlot(slot, msg) {
  slot.innerHTML = '';
  const meta = parsePhotoMeta(msg);
  const isMe = msg.sender_name === state.currentUser;

  if (meta.isDouble) {
    const expired = meta.viewsLeft <= 0 || !msg.media_url;
    const cardBtn = document.createElement('button');
    cardBtn.type = 'button';
    cardBtn.className = `photo-2x-card${expired ? ' expired' : ''}`;
    cardBtn.disabled = expired;

    const icon = document.createElement('span');
    icon.className = 'photo-2x-icon';
    icon.textContent = expired ? '0x' : `${meta.viewsLeft}x`;

    const info = document.createElement('span');
    info.className = 'photo-2x-info';

    const title = document.createElement('span');
    title.className = 'photo-2x-title';
    title.textContent = expired
      ? 'Foto expirada'
      : isMe
        ? 'Foto dupla (2x) enviada'
        : 'Abrir foto (2x)';

    const sub = document.createElement('span');
    sub.className = 'photo-2x-sub';
    if (expired) {
      sub.textContent = 'Visualizada 2 vezes';
    } else if (meta.viewsLeft === 2) {
      sub.textContent = isMe ? '2 visualizações disponíveis' : 'Toque para ver (2 restantes)';
    } else {
      sub.textContent = 'Última visualização (1 restante)';
    }

    info.appendChild(title);
    info.appendChild(sub);
    cardBtn.appendChild(icon);
    cardBtn.appendChild(info);

    if (!expired) {
      cardBtn.addEventListener('click', () => openLightbox(msg));
    }
    slot.appendChild(cardBtn);
  } else if (msg.media_url) {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = msg.media_url;
    img.alt = 'Foto enviada';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('click', () => openLightbox(msg));
    slot.appendChild(img);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'msg-photo-delete-btn';
  delBtn.textContent = 'Apagar foto';
  delBtn.addEventListener('click', () => {
    openConfirmModal(
      'Apagar foto?',
      'Essa foto será removida da conversa para vocês dois.',
      'Apagar',
      () => deletePhotoMessage(msg)
    );
  });
  slot.appendChild(delBtn);

  if (meta.caption) {
    const textEl = document.createElement('p');
    textEl.className = 'msg-text';
    textEl.textContent = meta.caption;
    slot.appendChild(textEl);
  }
}

function updatePhotoMessageInDom(msg) {
  const row = el.messagesList.querySelector(`[data-id="${msg.id}"]`);
  if (!row) return;
  const slot = row.querySelector('.msg-photo-wrap');
  if (!slot) return;
  renderPhotoContentIntoSlot(slot, msg);
}

function buildCallLogCard(callMeta, isMe) {
  const isVideo = callMeta.kind === 'video';
  const isMissed = callMeta.status !== 'answered';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'call-log-card';
  card.title = 'Toque para ligar novamente';
  card.addEventListener('click', () => startOutgoingCall(isVideo));

  const iconWrap = document.createElement('span');
  iconWrap.className = `call-log-icon ${isMissed ? 'missed' : 'answered'}`;

  if (isVideo) {
    iconWrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.89L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>';
  } else if (isMe) {
    // Telefone com seta diagonal saindo (estilo WhatsApp)
    iconWrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.95 21q-3.125 0-6.175-1.362t-5.55-3.863-3.862-5.55T3 4.05q0-.45.3-.75t.75-.3H8.1q.35 0 .625.238t.325.562l.65 3.5q.05.4-.025.675T9.4 8.45L6.975 10.9q.5.925 1.187 1.787t1.513 1.663q.775.775 1.625 1.438T13.1 17l2.35-2.35q.225-.225.588-.337t.712-.063l3.45.7q.35.1.575.363T21 15.9v4.05q0 .45-.3.75t-.75.3z"/><path d="M15 10V5h5v2h-1.6l3.3 3.3-1.4 1.4L17 8.4V10h-2z" transform="rotate(90 18 7.5)"/></svg>';
  } else {
    // Telefone com seta entrando (estilo WhatsApp)
    iconWrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.95 21q-3.125 0-6.175-1.362t-5.55-3.863-3.862-5.55T3 4.05q0-.45.3-.75t.75-.3H8.1q.35 0 .625.238t.325.562l.65 3.5q.05.4-.025.675T9.4 8.45L6.975 10.9q.5.925 1.187 1.787t1.513 1.663q.775.775 1.625 1.438T13.1 17l2.35-2.35q.225-.225.588-.337t.712-.063l3.45.7q.35.1.575.363T21 15.9v4.05q0 .45-.3.75t-.75.3z"/><path d="M14 5h2v4.6l3.3-3.3 1.4 1.4L17.4 11H22v2h-8V5z"/></svg>';
  }

  const body = document.createElement('span');
  body.className = 'call-log-body';

  const title = document.createElement('span');
  title.className = 'call-log-title';
  title.textContent = isVideo ? 'Chamada de vídeo' : 'Ligação de voz';

  const sub = document.createElement('span');
  sub.className = 'call-log-sub';
  if (callMeta.status === 'answered') {
    const mins = Math.floor(callMeta.duration / 60);
    const secs = callMeta.duration % 60;
    sub.textContent =
      mins > 0
        ? secs > 0
          ? `${mins} min ${secs} s`
          : `${mins} min`
        : `${callMeta.duration} s`;
  } else if (callMeta.status === 'rejected') {
    sub.textContent = isMe ? 'Não atendida' : 'Recusada';
  } else {
    sub.textContent = isMe ? 'Não atendida' : 'Perdida';
  }

  body.appendChild(title);
  body.appendChild(sub);
  card.appendChild(iconWrap);
  card.appendChild(body);
  return card;
}

function buildMessageNode(msg) {
  if (!msg || !msg.id || state.renderedIds.has(msg.id)) return null;
  const photoMeta = parsePhotoMeta(msg);
  if (photoMeta.deleted) return null;

  state.renderedIds.add(msg.id);
  state.messageCache.set(msg.id, msg);

  if (!state.newestTimestamp || msg.created_at > state.newestTimestamp) {
    state.newestTimestamp = msg.created_at;
  }

  const isMe = msg.sender_name === state.currentUser;
  const callMeta = parseCallLogMeta(msg);
  const createdIso = msg.created_at || new Date().toISOString();

  const row = document.createElement('article');
  row.className = `msg-row ${isMe ? 'me' : 'other'}`;
  row.dataset.id = msg.id;
  row.dataset.createdAt = createdIso;
  row.dataset.dateKey = getDateKey(createdIso);

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (callMeta) {
    bubble.appendChild(buildCallLogCard(callMeta, isMe));
  } else if (msg.media_type === 'image') {
    const photoSlot = document.createElement('div');
    photoSlot.className = 'msg-photo-wrap';
    renderPhotoContentIntoSlot(photoSlot, msg);
    bubble.appendChild(photoSlot);
  } else if (msg.media_type === 'audio' && msg.media_url) {
    const audio = document.createElement('audio');
    audio.className = 'msg-audio';
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = msg.media_url;
    audio.addEventListener('play', () => {
      if (state.activeAudio && state.activeAudio !== audio) {
        state.activeAudio.pause();
      }
      state.activeAudio = audio;
    });
    bubble.appendChild(audio);
    if (msg.content) {
      const textEl = document.createElement('p');
      textEl.className = 'msg-text';
      textEl.textContent = msg.content;
      bubble.appendChild(textEl);
    }
  } else if (msg.content) {
    const textEl = document.createElement('p');
    textEl.className = 'msg-text';
    textEl.textContent = msg.content;
    bubble.appendChild(textEl);
  }

  const metaEl = document.createElement('div');
  metaEl.className = 'msg-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = formatTime(msg.created_at);
  metaEl.appendChild(timeEl);

  if (isMe && !callMeta) {
    const tickEl = document.createElement('span');
    const info = getTickSymbol(msg);
    tickEl.className = `msg-ticks${info.read ? ' read' : ''}`;
    tickEl.textContent = info.text;
    metaEl.appendChild(tickEl);
  }

  bubble.appendChild(metaEl);
  row.appendChild(bubble);
  return row;
}

function appendMessage(msg, shouldAutoScroll) {
  const empty = el.messagesList.querySelector('.empty-state');
  if (empty) empty.remove();

  const viewport = el.messagesViewport;
  const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;

  const node = buildMessageNode(msg);
  if (!node) return;

  el.messagesList.appendChild(node);

  const renderedRows = el.messagesList.querySelectorAll('.msg-row');
  let excess = renderedRows.length - MAX_RENDERED_MESSAGES;
  for (let i = 0; i < excess; i += 1) {
    const oldRow = renderedRows[i];
    if (oldRow.dataset.id) {
      state.renderedIds.delete(oldRow.dataset.id);
      state.messageCache.delete(oldRow.dataset.id);
    }
    oldRow.remove();
  }

  rebuildDayDividers();

  if (shouldAutoScroll && (nearBottom || msg.sender_name === state.currentUser)) {
    scrollToBottom(false);
  }
}

function scrollToBottom(instant) {
  el.messagesViewport.scrollTo({
    top: el.messagesViewport.scrollHeight,
    behavior: instant ? 'auto' : 'smooth'
  });
}

function broadcastMessage(msg) {
  if (!state.chatChannel || !msg) return;
  state.chatChannel.send({
    type: 'broadcast',
    event: 'new-message',
    payload: msg
  });
}

async function sendTextContent(rawText) {
  const content = (rawText || '').trim();
  if (!content || !state.supabase) return false;

  const { data, error } = await state.supabase
    .from('messages')
    .insert({
      sender_name: state.currentUser,
      content,
      media_type: 'text',
      is_read: false
    })
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .single();

  if (error) {
    if (state.inCall) {
      showCallToast('Erro ao enviar mensagem.');
    } else {
      showChatAlert('Não foi possível enviar. Confira sua internet ou o SQL no Supabase.');
    }
    return false;
  }

  if (data) {
    appendMessage(data, true);
    appendCallChatMessage(data);
    broadcastMessage(data);
  }
  return true;
}

async function sendTextMessage() {
  const content = el.messageInput.value.trim();
  if (!content || !state.supabase) return;

  el.messageInput.value = '';
  el.messageInput.style.height = 'auto';
  toggleComposerButtons();
  await sendTextContent(content);
}

function toggleComposerButtons() {
  const hasText = el.messageInput.value.trim().length > 0;
  el.sendBtn.classList.toggle('hidden', !hasText);
  el.recordBtn.classList.toggle('hidden', hasText);
}

// ============================================================================
// CHAT INVISÍVEL ESTILO TWITCH NA CHAMADA (SOMENTE TEXTO + PONTO VERMELHO)
// ============================================================================
function updateCallChatBadge() {
  el.callChatBadge.classList.toggle('hidden', state.inCallUnreadCount === 0 || state.callChatOpen);
}

function appendCallChatMessage(msg) {
  if (!msg || !msg.id || state.callChatIds.has(msg.id)) return;
  if (parseCallLogMeta(msg)) return;
  const meta = parsePhotoMeta(msg);
  if (meta.deleted) return;

  let textPreview = '';
  if (msg.media_type === 'text') {
    textPreview = msg.content || '';
  } else if (msg.media_type === 'image') {
    textPreview = meta.isDouble ? '📷 Foto dupla (2x)' : '📷 Foto';
  } else if (msg.media_type === 'audio') {
    textPreview = '🎤 Áudio no chat';
  }
  if (!textPreview) return;

  state.callChatIds.add(msg.id);
  const line = document.createElement('div');
  line.className = 'call-chat-line';

  const author = document.createElement('span');
  const isMe = msg.sender_name === state.currentUser;
  author.className = `call-chat-author${isMe ? ' me' : ''}`;
  author.textContent = `${msg.sender_name}:`;

  const body = document.createElement('span');
  body.textContent = textPreview;

  line.appendChild(author);
  line.appendChild(body);
  el.callChatMessages.appendChild(line);

  while (el.callChatMessages.children.length > MAX_CALL_CHAT_MESSAGES) {
    el.callChatMessages.firstElementChild.remove();
  }
  el.callChatMessages.scrollTop = el.callChatMessages.scrollHeight;
}

function toggleCallChatOverlay() {
  state.callChatOpen = !state.callChatOpen;
  el.callChatOverlay.classList.toggle('hidden', !state.callChatOpen);
  el.toggleCallChatBtn.classList.toggle('active-feature', state.callChatOpen);

  if (state.callChatOpen) {
    state.inCallUnreadCount = 0;
    updateCallChatBadge();
    el.callChatMessages.scrollTop = el.callChatMessages.scrollHeight;
    clearTimeout(state.controlsAutoHideTimerId);
    setControlsHidden(false);
    markAllVisibleUnreadAsRead();
  } else {
    scheduleControlsAutoHide();
  }
}

// ============================================================================
// FOTOS: COMPRESSÃO CLIENT-SIDE VIA CANVAS + NORMAL / 2X / APAGAR
// ============================================================================
async function compressImageToJpeg(file) {
  let bitmap = null;
  let objectUrl = null;

  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawSource = null;

    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      drawSource = bitmap;
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });
      sourceWidth = img.naturalWidth;
      sourceHeight = img.naturalHeight;
      drawSource = img;
    }

    const scale = Math.min(1, IMAGE_MAX_SIDE_PX / Math.max(sourceWidth, sourceHeight));
    const targetW = Math.max(1, Math.round(sourceWidth * scale));
    const targetH = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(drawSource, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha na compressão'))),
        'image/jpeg',
        IMAGE_JPEG_QUALITY
      );
    });

    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function setPendingPhotoMode(mode) {
  state.pendingPhotoMode = mode === 'double' ? 'double' : 'normal';
  el.photoModeButtons.forEach((btn) => {
    const active = btn.dataset.photoMode === state.pendingPhotoMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

async function handlePhotoSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  setPendingPhotoMode('normal');
  el.photoModal.classList.remove('hidden');
  el.confirmPhotoBtn.disabled = true;
  el.photoSizeBadge.textContent = 'Comprimindo...';
  el.photoCaptionInput.value = '';
  revokePendingPhotoUrl();

  try {
    const compressedBlob = await compressImageToJpeg(file);
    state.pendingPhotoBlob = compressedBlob;
    state.pendingPhotoPreviewUrl = URL.createObjectURL(compressedBlob);
    el.photoPreviewImg.src = state.pendingPhotoPreviewUrl;
    const kb = Math.max(1, Math.round(compressedBlob.size / 1024));
    el.photoSizeBadge.textContent = `Pronta (${kb} KB)`;
    el.confirmPhotoBtn.disabled = false;
  } catch (_) {
    closePhotoModal();
  }
}

function closePhotoModal() {
  el.photoModal.classList.add('hidden');
  el.photoPreviewImg.removeAttribute('src');
  state.pendingPhotoBlob = null;
  revokePendingPhotoUrl();
}

async function uploadAndSendPhoto() {
  if (!state.pendingPhotoBlob || !state.supabase) return;
  const blob = state.pendingPhotoBlob;
  const caption = el.photoCaptionInput.value.trim();
  const isDouble = state.pendingPhotoMode === 'double';

  el.confirmPhotoBtn.disabled = true;
  el.confirmPhotoBtn.textContent = 'Enviando...';

  try {
    const filePath = `photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: uploadErr } = await state.supabase.storage
      .from('chat-media')
      .upload(filePath, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });

    if (uploadErr) throw uploadErr;

    const { data: pub } = state.supabase.storage.from('chat-media').getPublicUrl(filePath);
    const contentPayload = serializePhotoMeta(isDouble, 2, caption);

    const { data: inserted, error: msgErr } = await state.supabase
      .from('messages')
      .insert({
        sender_name: state.currentUser,
        content: contentPayload,
        media_url: pub.publicUrl,
        media_type: 'image',
        is_read: false
      })
      .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
      .single();

    if (!msgErr && inserted) {
      appendMessage(inserted, true);
      appendCallChatMessage(inserted);
      broadcastMessage(inserted);
    }
    closePhotoModal();
  } catch (_) {
    el.photoSizeBadge.textContent = 'Erro ao enviar';
  } finally {
    el.confirmPhotoBtn.disabled = false;
    el.confirmPhotoBtn.textContent = 'Enviar foto';
  }
}

function openLightbox(msgOrUrl) {
  if (typeof msgOrUrl === 'string') {
    state.activeLightboxMsg = null;
    el.lightboxBadge.classList.add('hidden');
    el.lightboxDeleteBtn.classList.add('hidden');
    el.lightboxImg.src = msgOrUrl;
    el.lightboxModal.classList.remove('hidden');
    return;
  }

  const msg = state.messageCache.get(msgOrUrl.id) || msgOrUrl;
  const meta = parsePhotoMeta(msg);
  if (!msg.media_url || (meta.isDouble && meta.viewsLeft <= 0)) return;

  state.activeLightboxMsg = msg;
  el.lightboxImg.src = msg.media_url;
  el.lightboxDeleteBtn.classList.remove('hidden');

  if (meta.isDouble) {
    const isMe = msg.sender_name === state.currentUser;
    el.lightboxBadge.textContent = isMe
      ? `Foto 2x (${meta.viewsLeft} restantes)`
      : meta.viewsLeft === 2
        ? 'Visualização 1 de 2'
        : 'Última visualização (2 de 2)';
    el.lightboxBadge.classList.remove('hidden');
  } else {
    el.lightboxBadge.classList.add('hidden');
  }

  el.lightboxModal.classList.remove('hidden');
}

async function closeLightbox() {
  const viewedMsg = state.activeLightboxMsg;
  state.activeLightboxMsg = null;
  el.lightboxModal.classList.add('hidden');
  el.lightboxImg.removeAttribute('src');
  el.lightboxBadge.classList.add('hidden');
  el.lightboxDeleteBtn.classList.add('hidden');

  if (!viewedMsg || viewedMsg.sender_name === state.currentUser) return;

  const currentMsg = state.messageCache.get(viewedMsg.id) || viewedMsg;
  const meta = parsePhotoMeta(currentMsg);
  if (!meta.isDouble || meta.viewsLeft <= 0) return;

  const nextViews = Math.max(0, meta.viewsLeft - 1);
  const nextContent = serializePhotoMeta(true, nextViews, meta.caption);
  const nextMediaUrl = nextViews === 0 ? null : currentMsg.media_url;
  const updatedMsg = {
    ...currentMsg,
    content: nextContent,
    media_url: nextMediaUrl,
    is_read: true
  };

  state.messageCache.set(currentMsg.id, updatedMsg);
  updatePhotoMessageInDom(updatedMsg);

  if (state.chatChannel) {
    state.chatChannel.send({
      type: 'broadcast',
      event: 'photo-view-updated',
      payload: updatedMsg
    });
  }

  if (state.supabase) {
    const updateData = {
      content: nextContent,
      is_read: true,
      read_at: new Date().toISOString()
    };
    if (nextViews === 0) updateData.media_url = null;
    await state.supabase.from('messages').update(updateData).eq('id', currentMsg.id);
    if (nextViews === 0 && currentMsg.media_url) {
      removeMediaFromStorage(currentMsg.media_url);
    }
  }
}

async function deletePhotoMessage(msg) {
  if (!msg || !msg.id) return;
  const mediaUrl = msg.media_url;
  removeMessageFromDom(msg.id);

  if (state.chatChannel) {
    state.chatChannel.send({
      type: 'broadcast',
      event: 'message-deleted',
      payload: { id: msg.id }
    });
  }

  if (!state.supabase) return;

  const { error: delErr } = await state.supabase.from('messages').delete().eq('id', msg.id);
  if (delErr) {
    // Fallback caso o usuário ainda não tenha reaplicado o GRANT DELETE no Supabase
    await state.supabase
      .from('messages')
      .update({ content: MSG_DELETED_MARKER, media_url: null, is_read: true })
      .eq('id', msg.id);
  }

  if (mediaUrl) {
    removeMediaFromStorage(mediaUrl);
  }
}

// ============================================================================
// ÁUDIO: GRAVAÇÃO 128KBPS VIA MEDIARECORDER + LIBERAÇÃO IMEDIATA DE TRACKS
// ============================================================================
function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function startAudioRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });

    const mimeType = pickAudioMimeType();
    const options = { audioBitsPerSecond: AUDIO_RECORDER_BITRATE };
    if (mimeType) options.mimeType = mimeType;

    const recorder = new MediaRecorder(stream, options);
    state.recordingStream = stream;
    state.mediaRecorder = recorder;
    state.audioChunks = [];
    state.recordingCancelled = false;
    state.recordingSeconds = 0;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.audioChunks.push(ev.data);
    };

    recorder.onstop = async () => {
      stopStreamTracks(state.recordingStream);
      state.recordingStream = null;
      clearInterval(state.recordingTimerId);
      state.recordingTimerId = null;

      const chunks = state.audioChunks;
      state.audioChunks = [];
      state.mediaRecorder = null;

      el.recordingBar.classList.add('hidden');
      el.composerBar.classList.remove('hidden');

      if (state.recordingCancelled || chunks.length === 0) return;

      const finalMime = recorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(chunks, { type: finalMime });
      await uploadAndSendAudio(audioBlob, finalMime);
    };

    recorder.start();
    el.composerBar.classList.add('hidden');
    el.recordingBar.classList.remove('hidden');
    el.recordTimer.textContent = '00:00';

    state.recordingTimerId = setInterval(() => {
      state.recordingSeconds += 1;
      el.recordTimer.textContent = formatSeconds(state.recordingSeconds);
      if (state.recordingSeconds >= 120) finishAudioRecording();
    }, 1000);
  } catch (_) {
    stopStreamTracks(state.recordingStream);
    state.recordingStream = null;
  }
}

function finishAudioRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.recordingCancelled = false;
    state.mediaRecorder.stop();
  }
}

function cancelAudioRecording() {
  state.recordingCancelled = true;
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  } else {
    stopStreamTracks(state.recordingStream);
    state.recordingStream = null;
    clearInterval(state.recordingTimerId);
    el.recordingBar.classList.add('hidden');
    el.composerBar.classList.remove('hidden');
  }
}

async function uploadAndSendAudio(audioBlob, mimeType) {
  if (!state.supabase) return;
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const filePath = `audios/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: upErr } = await state.supabase.storage
    .from('chat-media')
    .upload(filePath, audioBlob, { contentType: mimeType, cacheControl: '31536000' });

  if (upErr) return;

  const { data: pub } = state.supabase.storage.from('chat-media').getPublicUrl(filePath);
  const { data: inserted, error: msgErr } = await state.supabase
    .from('messages')
    .insert({
      sender_name: state.currentUser,
      media_url: pub.publicUrl,
      media_type: 'audio',
      is_read: false
    })
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .single();

  if (!msgErr && inserted) {
    appendMessage(inserted, true);
    appendCallChatMessage(inserted);
    broadcastMessage(inserted);
  }
}

// ============================================================================
// WEBRTC ESTILO WHATSAPP/DISCORD: VOZ 48KHZ + TELA 720P + ISOLAMENTO DE ÁUDIO
// ============================================================================
function getVideoConstraints(ecoMode, facingMode, exactFacing) {
  const facing = exactFacing ? { exact: facingMode } : facingMode;
  if (ecoMode) {
    return {
      width: { ideal: 854, max: 854 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 24, max: 24 },
      facingMode: facing
    };
  }
  return {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: facing
  };
}

async function acquireAudioStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1
      },
      video: false
    });
  } catch (_) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }
}

async function acquireCameraStream(ecoMode, facingMode, exactFirst = false) {
  const attempts = [
    getVideoConstraints(ecoMode, facingMode, exactFirst),
    getVideoConstraints(ecoMode, facingMode, false),
    { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 }, facingMode }
  ];

  for (const videoConstraint of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraint });
    } catch (_) {}
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((d) => d.kind === 'videoinput');
  if (videoInputs.length > 0) {
    const targetDevice =
      facingMode === 'environment' && videoInputs.length > 1
        ? videoInputs[videoInputs.length - 1]
        : videoInputs[0];

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: targetDevice.deviceId },
        width: { max: 1280 },
        height: { max: 720 },
        frameRate: { max: 30 }
      }
    });
  }

  throw new Error('Nenhuma câmera disponível');
}

function isLowMemoryDevice() {
  return typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2;
}

function getLocalMediaScaleDown(videoEl, ecoMode) {
  if (!videoEl || !videoEl.videoHeight) return 1;
  const maxH = ecoMode || isLowMemoryDevice() ? 480 : 720;
  if (videoEl.videoHeight <= maxH) return 1;
  return Math.max(1, Math.min(4, Number((videoEl.videoHeight / maxH).toFixed(2))));
}

async function applyVideoBitrateLimits(pc, ecoMode) {
  if (!pc || typeof pc.getSenders !== 'function') return;
  const maxBitrate = ecoMode ? WEBRTC_MAX_VIDEO_BITRATE_ECO : WEBRTC_MAX_VIDEO_BITRATE_HD;
  const maxFramerate = ecoMode ? 24 : 30;
  const scaleDown = state.localMediaVideoEl
    ? getLocalMediaScaleDown(state.localMediaVideoEl, ecoMode)
    : 1;
  state.localMediaScaleDownBy = scaleDown;

  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = maxFramerate;
      if (scaleDown > 1) {
        params.encodings[0].scaleResolutionDownBy = scaleDown;
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }
      params.degradationPreference = 'balanced';
      await sender.setParameters(params);
    } catch (_) {}
  }
}

function sendSignal(event, data) {
  if (!state.callChannel) return;
  state.callChannel.send({
    type: 'broadcast',
    event,
    payload: { from: state.currentUser, data: data || null }
  });
}

function unlockRemoteAudioPlayback() {
  el.remoteAudio.muted = state.soundMuted;
  el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
  el.remoteAudio.play().catch(() => {});
  el.remoteVideo.muted = true;
}

function isLocalStageActive() {
  return state.videoMode === 'screen' ? !state.pipSwapped : state.pipSwapped;
}

function updateRemoteStageVisibility() {
  const liveTracks = state.remoteStream
    ? state.remoteStream.getVideoTracks().filter((t) => t.readyState === 'live')
    : [];
  const hasActiveRemoteVideo =
    liveTracks.length > 0 &&
    (state.remoteVideoMode !== 'off' || liveTracks.some((t) => !t.muted));

  const localOnMain = isLocalStageActive() && state.videoMode !== 'off';
  el.videoOverlay.classList.toggle('local-stage', localOnMain);

  el.remoteVideo.classList.toggle('hidden', !hasActiveRemoteVideo);
  el.remoteVideo.classList.toggle('is-screen', state.remoteVideoMode === 'screen');
  el.voiceStageFallback.classList.toggle('hidden', hasActiveRemoteVideo || localOnMain);
  if (hasActiveRemoteVideo && el.remoteVideo.srcObject !== state.remoteStream) {
    el.remoteVideo.srcObject = state.remoteStream;
    el.remoteVideo.muted = true;
    el.remoteVideo.play().catch(() => {});
  }
  applyStageRotationVisual();
}

function handleRemoteVideoModeSync(payload) {
  const mode = payload && payload.data && payload.data.mode;
  if (!mode) return;
  state.remoteVideoMode = mode;
  if (mode !== 'off' && state.remoteStream && state.remoteStream.getVideoTracks().length > 0) {
    el.remoteVideo.srcObject = state.remoteStream;
    el.remoteVideo.play().catch(() => {});
  }
  updateRemoteStageVisibility();
}

function findVideoSender(pc) {
  if (!pc) return null;
  if (typeof pc.getTransceivers === 'function') {
    const trans = pc.getTransceivers().find((t) => {
      const sKind = t.sender && t.sender.track && t.sender.track.kind;
      const rKind = t.receiver && t.receiver.track && t.receiver.track.kind;
      return sKind === 'video' || rKind === 'video';
    });
    if (trans && trans.sender) return trans.sender;
  }
  return pc.getSenders().find((s) => s.track && s.track.kind === 'video') || null;
}

function preferVideoCodecs(pc) {
  if (!pc || typeof pc.getTransceivers !== 'function') return;
  try {
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps || !Array.isArray(caps.codecs)) return;
    const preferred = caps.codecs.filter(
      (c) => c.mimeType === 'video/H264' || c.mimeType === 'video/VP8'
    );
    if (preferred.length === 0) return;
    for (const trans of pc.getTransceivers()) {
      const isVideo =
        (trans.sender && trans.sender.track && trans.sender.track.kind === 'video') ||
        (trans.receiver && trans.receiver.track && trans.receiver.track.kind === 'video');
      if (isVideo) {
        try {
          trans.setCodecPreferences(preferred);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function createPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal('ice-candidate', event.candidate.toJSON());
    }
  };

  pc.ontrack = (event) => {
    if (!state.remoteStream) state.remoteStream = new MediaStream();
    if (!state.remoteStream.getTracks().some((t) => t.id === event.track.id)) {
      state.remoteStream.addTrack(event.track);
    }

    // Todo áudio remoto sai exclusivamente por #remote-audio (evita eco/duplo áudio no Android)
    if (event.track.kind === 'audio') {
      const audioOnlyStream = new MediaStream([event.track]);
      el.remoteAudio.srcObject = audioOnlyStream;
      el.remoteAudio.muted = state.soundMuted;
      el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
      el.remoteAudio.play().catch(() => {});
    }

    // Vídeo remoto permanece sempre mudo (#remote-video muted)
    if (event.track.kind === 'video') {
      el.remoteVideo.srcObject = state.remoteStream;
      el.remoteVideo.muted = true;
      el.remoteVideo.play().catch(() => {});
      event.track.onmute = updateRemoteStageVisibility;
      event.track.onunmute = () => {
        el.remoteVideo.play().catch(() => {});
        updateRemoteStageVisibility();
      };
      event.track.onended = updateRemoteStageVisibility;
    }
    updateRemoteStageVisibility();
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      state.callConnected = true;
      clearTimeout(state.iceRestartTimerId);
      startCallTimer();
      applyVideoBitrateLimits(pc, state.ecoMode480p);
      forcePlayRemoteMedia();
      updateMediaSessionForCall(true);
    } else if (st === 'failed' || st === 'closed') {
      endCall(false);
    } else if (st === 'disconnected') {
      el.callStateLabel.textContent = 'Reconectando...';
      clearTimeout(state.iceRestartTimerId);
      state.iceRestartTimerId = setTimeout(async () => {
        if (!state.pc || state.pc.connectionState !== 'disconnected') return;
        try {
          if (typeof state.pc.restartIce === 'function') state.pc.restartIce();
          const restartOffer = await state.pc.createOffer({ iceRestart: true });
          await state.pc.setLocalDescription(restartOffer);
          sendSignal('ice-restart-offer', restartOffer);
        } catch (_) {}
      }, 2500);
    }
  };

  return pc;
}

async function saveCallLogMarker(status, durationSeconds) {
  if (!state.supabase || !state.callIsInitiator || !state.callSignaled || state.callLogged) return;
  state.callLogged = true;

  const content = serializeCallLogMeta(
    state.callInitialVideo ? 'video' : 'voice',
    status,
    durationSeconds
  );

  try {
    const { data, error } = await state.supabase
      .from('messages')
      .insert({
        sender_name: state.currentUser,
        content,
        media_type: 'text',
        is_read: false
      })
      .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
      .single();

    if (!error && data) {
      appendMessage(data, true);
      broadcastMessage(data);
    }
  } catch (_) {}
}

async function startOutgoingCall(withVideo) {
  if (state.inCall || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  try {
    state.inCall = true;
    state.callMinimized = false;
    state.callIsInitiator = true;
    state.callSignaled = false;
    state.callInitialVideo = Boolean(withVideo);
    state.callConnected = false;
    state.callLogged = false;
    state.pendingIceCandidates = [];
    state.micMuted = false;
    state.soundMuted = false;
    state.facingMode = 'user';
    state.videoMode = withVideo ? 'camera' : 'off';
    state.remoteVideoMode = 'off';
    state.pipSwapped = false;
    state.callChatOpen = false;
    state.inCallUnreadCount = 0;

    unlockRemoteAudioPlayback();
    el.videoOverlay.classList.remove('hidden', 'local-stage', 'has-local-media', 'controls-hidden');
    el.callChatOverlay.classList.add('hidden');
    el.activeCallBanner.classList.add('hidden');
    el.callPartnerLabel.textContent = state.partnerName;
    el.callStateLabel.textContent = withVideo ? 'Iniciando câmera 720p...' : 'Iniciando áudio...';
    updateCallChatBadge();

    state.localAudioStream = await acquireAudioStream();
    state.pc = createPeerConnection();
    state.localAudioStream.getAudioTracks().forEach((track) => {
      state.pc.addTrack(track, state.localAudioStream);
    });

    if (withVideo) {
      state.localVideoStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
      el.localVideo.srcObject = state.localVideoStream;
      state.localVideoStream.getVideoTracks().forEach((track) => {
        state.pc.addTrack(track, state.localVideoStream);
      });
      await applyVideoBitrateLimits(state.pc, state.ecoMode480p);
    }

    updateCallUIState();
    setControlsHidden(false);
    scheduleControlsAutoHide();

    preferVideoCodecs(state.pc);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);

    el.callStateLabel.textContent = 'Chamando...';
    state.callSignaled = true;
    sendSignal('incoming-call', {
      caller: state.currentUser,
      callType: withVideo ? 'video' : 'audio',
      withVideo,
      offer,
      sdp: offer
    });

    clearTimeout(state.ringTimeoutId);
    state.ringTimeoutId = setTimeout(() => {
      if (state.inCall && !state.callConnected) {
        saveCallLogMarker('missed', 0);
        endCall(true);
      }
    }, 45000);
  } catch (_) {
    endCall(false);
    showChatAlert('Erro ao acessar microfone ou câmera para a chamada.');
  }
}

async function acceptIncomingCall() {
  if (!state.pendingOffer) return;

  stopRingtone();
  state.incomingRinging = false;
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  el.incomingModal.style.cssText = '';

  state.inCall = true;
  state.callMinimized = false;
  state.callIsInitiator = false;
  state.callSignaled = false;
  state.callInitialVideo = Boolean(state.pendingCallWithVideo);
  state.callConnected = false;
  state.callLogged = true;
  state.micMuted = false;
  state.soundMuted = false;
  state.facingMode = 'user';
  state.videoMode = state.pendingCallWithVideo ? 'camera' : 'off';
  state.remoteVideoMode = state.pendingCallWithVideo ? 'camera' : 'off';
  state.pipSwapped = false;
  state.callChatOpen = false;
  state.inCallUnreadCount = 0;

  unlockRemoteAudioPlayback();

  try {
    el.videoOverlay.classList.remove('hidden', 'local-stage', 'has-local-media', 'controls-hidden');
    el.callChatOverlay.classList.add('hidden');
    el.activeCallBanner.classList.add('hidden');
    el.callPartnerLabel.textContent = state.pendingCallerName || state.partnerName;
    el.callStateLabel.textContent = 'Conectando...';
    updateCallChatBadge();

    state.localAudioStream = await acquireAudioStream();
    state.pc = createPeerConnection();
    state.localAudioStream.getAudioTracks().forEach((track) => {
      state.pc.addTrack(track, state.localAudioStream);
    });

    if (state.pendingCallWithVideo) {
      state.localVideoStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
      el.localVideo.srcObject = state.localVideoStream;
      state.localVideoStream.getVideoTracks().forEach((track) => {
        state.pc.addTrack(track, state.localVideoStream);
      });
    }

    updateCallUIState();
    setControlsHidden(false);
    scheduleControlsAutoHide();

    await state.pc.setRemoteDescription(new RTCSessionDescription(state.pendingOffer));
    state.pendingOffer = null;

    while (state.pendingIceCandidates.length > 0) {
      const cand = state.pendingIceCandidates.shift();
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (_) {}
    }

    preferVideoCodecs(state.pc);
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    await applyVideoBitrateLimits(state.pc, state.ecoMode480p);

    forcePlayRemoteMedia();
    sendSignal('call-accepted', { caller: state.currentUser, answer });
    sendSignal('video-mode-sync', { mode: state.videoMode });
  } catch (_) {
    endCall(true);
  }
}

function rejectIncomingCall() {
  stopRingtone();
  state.incomingRinging = false;
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  el.incomingModal.style.cssText = '';
  state.pendingOffer = null;
  state.pendingIceCandidates = [];
  sendSignal('call-rejected');
}

async function renegotiateCall() {
  if (!state.pc) return;
  try {
    if (state.pc.signalingState !== 'stable') return;
    preferVideoCodecs(state.pc);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await applyVideoBitrateLimits(state.pc, state.ecoMode480p);
    sendSignal('renegotiate-offer', offer);
  } catch (_) {}
}

function handleIncomingCall(payload) {
  const data = payload && payload.data;
  const offerSdp = data && (data.offer || data.sdp);
  if (!offerSdp) return;

  if (state.inCall) {
    sendSignal('call-rejected');
    return;
  }

  state.incomingRinging = true;
  state.pendingOffer = offerSdp;
  state.pendingCallWithVideo = data.callType === 'video' || Boolean(data.withVideo);
  state.pendingCallerName = (data && data.caller) || payload.from || state.partnerName;
  state.pendingIceCandidates = [];

  el.incomingCallerName.textContent = `${state.pendingCallerName} está ligando ♡`;
  el.incomingCallType.textContent = state.pendingCallWithVideo
    ? 'Ligação com vídeo e transmissão'
    : 'Ligação de voz (estilo Discord)';

  // Força exibição imediata no destinatário (Galaxy J5)
  el.incomingModal.classList.remove('hidden');
  el.incomingModal.classList.add('incoming-backdrop');
  el.incomingModal.style.setProperty('display', 'flex', 'important');
  el.incomingModal.style.setProperty('z-index', '99999', 'important');

  startRingtone();
  notifyBackground(
    `${state.pendingCallerName} está ligando ♡`,
    state.pendingCallWithVideo ? 'Toque para atender o vídeo' : 'Toque para atender a voz',
    'call-nosso-mundo',
    true
  );

  if (navigator.vibrate) {
    try {
      navigator.vibrate([400, 200, 400]);
    } catch (_) {}
  }
}

async function handleCallAccepted(payload) {
  if (!payload || !payload.data || !state.pc) return;
  const answerSdp = payload.data.answer || payload.data;
  clearTimeout(state.ringTimeoutId);
  stopRingtone();
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
    while (state.pendingIceCandidates.length > 0) {
      const cand = state.pendingIceCandidates.shift();
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (_) {}
    }
    sendSignal('video-mode-sync', { mode: state.videoMode });
  } catch (_) {}
}

function handleCallRejectedOrEnded(wasRejected = false) {
  stopRingtone();
  state.incomingRinging = false;
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  el.incomingModal.style.cssText = '';
  state.pendingOffer = null;
  state.pendingIceCandidates = [];
  if (state.inCall) {
    if (state.callIsInitiator) {
      saveCallLogMarker(
        state.callConnected ? 'answered' : wasRejected ? 'rejected' : 'missed',
        state.callSeconds
      );
    }
    endCall(false);
  }
}

async function handleIncomingIceCandidate(payload) {
  if (!payload || !payload.data) return;
  const candidate = payload.data;
  if (state.pc && state.pc.remoteDescription) {
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (_) {}
  } else {
    state.pendingIceCandidates.push(candidate);
  }
}

async function handleRenegotiateOffer(payload) {
  if (!state.pc || !payload || !payload.data) return;
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(payload.data));
    while (state.pendingIceCandidates.length > 0) {
      const cand = state.pendingIceCandidates.shift();
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (_) {}
    }
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    sendSignal('renegotiate-answer', answer);
    forcePlayRemoteMedia();
    updateRemoteStageVisibility();
  } catch (_) {}
}

async function handleRenegotiateAnswer(payload) {
  if (!state.pc || !payload || !payload.data) return;
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(payload.data));
    forcePlayRemoteMedia();
  } catch (_) {}
}

async function handleIceRestartOffer(payload) {
  if (!state.pc || !payload || !payload.data) return;
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(payload.data));
    preferVideoCodecs(state.pc);
    const restartAnswer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(restartAnswer);
    sendSignal('ice-restart-answer', restartAnswer);
  } catch (_) {}
}

async function handleIceRestartAnswer(payload) {
  if (!state.pc || !payload || !payload.data) return;
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(payload.data));
    el.callStateLabel.textContent = 'Reconectado';
  } catch (_) {}
}

// ============================================================================
// MIXER DE ÁUDIO DA TRANSMISSÃO (MIC MUTADO NÃO CORTA ÁUDIO DO FILME!)
// ============================================================================
function updateLocalMediaBarUi(force = false) {
  const v = state.localMediaVideoEl;
  if (!v || !el.localMediaBar) return;
  const now = Date.now();
  if (!force && now - state.localMediaLastUiUpdate < 500) return;
  state.localMediaLastUiUpdate = now;

  if (el.mediaPlayPauseBtn) {
    el.mediaPlayPauseBtn.textContent = v.paused ? '▶' : '❚❚';
  }
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
  if (el.mediaSeekSlider && !state.localMediaSeeking) {
    el.mediaSeekSlider.value = dur > 0 ? String(Math.round((cur / dur) * 1000)) : '0';
  }
  if (el.mediaTimeLabel) {
    el.mediaTimeLabel.textContent =
      dur > 0
        ? `${formatSeconds(Math.floor(cur))} / ${formatSeconds(Math.floor(dur))}`
        : formatSeconds(Math.floor(cur));
  }
}

function cleanupLocalMediaFile() {
  if (state.localMediaRafId) {
    cancelAnimationFrame(state.localMediaRafId);
    state.localMediaRafId = null;
  }
  if (state.localMediaCanvas) {
    try {
      state.localMediaCanvas.width = 0;
      state.localMediaCanvas.height = 0;
    } catch (_) {}
    state.localMediaCanvas = null;
  }
  if (state.localMediaVideoEl) {
    try {
      state.localMediaVideoEl.onended = null;
      state.localMediaVideoEl.ontimeupdate = null;
      state.localMediaVideoEl.pause();
      state.localMediaVideoEl.removeAttribute('src');
      state.localMediaVideoEl.load();
      state.localMediaVideoEl.remove();
    } catch (_) {}
    state.localMediaVideoEl = null;
  }
  if (state.localMediaObjectUrl) {
    try {
      URL.revokeObjectURL(state.localMediaObjectUrl);
    } catch (_) {}
    state.localMediaObjectUrl = null;
  }
  state.localMediaScaleDownBy = 1;
  state.localMediaSeeking = false;
  if (el.localMediaBar) el.localMediaBar.classList.add('hidden');
  if (el.videoOverlay) el.videoOverlay.classList.remove('has-local-media');
}

async function setupScreenAudioMix(screenAudioSource) {
  teardownScreenAudioMix(false);
  if (!screenAudioSource || !state.localAudioStream || !state.pc) return;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    let mixCtx;
    try {
      mixCtx = new Ctx({ sampleRate: 48000 });
    } catch (_) {
      mixCtx = new Ctx();
    }
    if (mixCtx.state === 'suspended') await mixCtx.resume();

    const dest = mixCtx.createMediaStreamDestination();
    const micGain = mixCtx.createGain();
    const screenGain = mixCtx.createGain();

    micGain.gain.value = state.micMuted ? 0 : 1;
    screenGain.gain.value = 1;

    let screenNode = null;
    if (screenAudioSource instanceof HTMLMediaElement) {
      screenNode = mixCtx.createMediaElementSource(screenAudioSource);
      // Permite que quem está transmitindo o arquivo também ouça nos próprios fones/alto-falante
      screenNode.connect(mixCtx.destination);
    } else {
      state.screenAudioTrack = screenAudioSource;
      screenNode = mixCtx.createMediaStreamSource(new MediaStream([screenAudioSource]));
    }

    const micSource = mixCtx.createMediaStreamSource(state.localAudioStream);
    screenNode.connect(screenGain).connect(dest);
    micSource.connect(micGain).connect(dest);

    const mixedTrack = dest.stream.getAudioTracks()[0];
    const audioSender = state.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (audioSender && mixedTrack) {
      state.screenMixCtx = mixCtx;
      state.screenMixMicGain = micGain;
      state.screenMixScreenGain = screenGain;
      await audioSender.replaceTrack(mixedTrack);
    } else {
      mixCtx.close();
    }
  } catch (_) {}
}

function teardownScreenAudioMix(restoreMicTrack = true) {
  if (state.screenAudioTrack) {
    try {
      state.screenAudioTrack.stop();
    } catch (_) {}
    state.screenAudioTrack = null;
  }
  if (state.screenMixCtx) {
    try {
      state.screenMixCtx.close();
    } catch (_) {}
    state.screenMixCtx = null;
  }
  state.screenMixMicGain = null;
  state.screenMixScreenGain = null;

  if (restoreMicTrack && state.pc && state.localAudioStream) {
    const micTrack = state.localAudioStream.getAudioTracks()[0];
    const audioSender = state.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (audioSender && micTrack) {
      micTrack.enabled = !state.micMuted;
      audioSender.replaceTrack(micTrack).catch(() => {});
    }
  }
}

function openScreenUnsupportedModal(reasonText) {
  if (!el.screenUnsupportedModal) {
    showCallToast(reasonText);
    return;
  }
  el.screenErrorReason.textContent = reasonText;
  el.screenUnsupportedModal.classList.remove('hidden');
}

function closeScreenUnsupportedModal() {
  if (el.screenUnsupportedModal) {
    el.screenUnsupportedModal.classList.add('hidden');
  }
}

async function attachOrReplaceVideoStream(newStream, nextMode) {
  const newTrack = newStream.getVideoTracks()[0];
  if (!newTrack) return;

  const existingSender = findVideoSender(state.pc);
  state.localVideoStream = newStream;
  el.localVideo.srcObject = newStream;
  state.pipSwapped = false;

  if (existingSender) {
    await existingSender.replaceTrack(newTrack);
    await applyVideoBitrateLimits(state.pc, state.ecoMode480p);
    sendSignal('video-on-notify');
  } else {
    state.pc.addTrack(newTrack, newStream);
    await renegotiateCall();
  }

  state.videoMode = nextMode;
  sendSignal('video-mode-sync', { mode: nextMode });
  updateCallUIState();
}

function createLowRamCanvasVideoStream(videoEl, targetFps) {
  const srcW = videoEl.videoWidth || 640;
  const srcH = videoEl.videoHeight || 360;
  const maxWidth = state.ecoMode480p || isLowMemoryDevice() ? 640 : 854;
  const scale = Math.min(1, maxWidth / srcW);
  const w = Math.max(2, Math.round((srcW * scale) / 2) * 2);
  const h = Math.max(2, Math.round((srcH * scale) / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  state.localMediaCanvas = canvas;

  const ctx = canvas.getContext('2d', { alpha: false });
  const minIntervalMs = Math.round(1000 / targetFps);
  let lastDrawAt = 0;

  const drawFrame = (now) => {
    if (!state.localMediaVideoEl || !state.localMediaCanvas) return;
    if (!videoEl.paused && !videoEl.ended && now - lastDrawAt >= minIntervalMs) {
      lastDrawAt = now;
      ctx.drawImage(videoEl, 0, 0, w, h);
    }
    state.localMediaRafId = requestAnimationFrame(drawFrame);
  };
  ctx.drawImage(videoEl, 0, 0, w, h);
  state.localMediaRafId = requestAnimationFrame(drawFrame);

  return canvas.captureStream(targetFps);
}

async function startLocalVideoFileStream(file) {
  if (!file || !state.inCall || !state.pc) return;
  closeScreenUnsupportedModal();

  teardownScreenAudioMix(true);
  cleanupLocalMediaFile();
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;

  try {
    // URL.createObjectURL faz streaming direto do armazenamento sem carregar o arquivo inteiro na RAM
    const objectUrl = URL.createObjectURL(file);
    const hiddenVideo = document.createElement('video');
    hiddenVideo.className = 'hidden';
    hiddenVideo.playsInline = true;
    hiddenVideo.loop = false;
    hiddenVideo.preload = 'metadata';
    hiddenVideo.crossOrigin = 'anonymous';
    hiddenVideo.src = objectUrl;
    document.body.appendChild(hiddenVideo);

    state.localMediaObjectUrl = objectUrl;
    state.localMediaVideoEl = hiddenVideo;

    await new Promise((resolve) => {
      const done = () => resolve();
      hiddenVideo.addEventListener('loadedmetadata', done, { once: true });
      hiddenVideo.addEventListener('error', done, { once: true });
      setTimeout(done, 4000);
    });

    await hiddenVideo.play();

    // Ativa automaticamente modo Eco 480p em celulares com pouca RAM (ex.: Galaxy J5) ou vídeos muito pesados
    const targetFps = state.ecoMode480p || isLowMemoryDevice() ? 24 : 30;
    state.localMediaScaleDownBy = getLocalMediaScaleDown(hiddenVideo, state.ecoMode480p);

    const captureFn = hiddenVideo.captureStream || hiddenVideo.mozCaptureStream;
    let rawStream = typeof captureFn === 'function' ? captureFn.call(hiddenVideo, targetFps) : null;
    let videoTrack = rawStream && rawStream.getVideoTracks()[0];

    if (!videoTrack) {
      rawStream = createLowRamCanvasVideoStream(hiddenVideo, 24);
      videoTrack = rawStream && rawStream.getVideoTracks()[0];
    }

    if (!videoTrack) {
      throw new Error('NO_VIDEO_TRACK');
    }

    // Stream enxuto apenas com vídeo para não duplicar faixa de áudio na memória
    const videoOnlyStream = new MediaStream([videoTrack]);
    await setupScreenAudioMix(hiddenVideo);

    hiddenVideo.ontimeupdate = () => updateLocalMediaBarUi(false);
    hiddenVideo.onended = () => {
      if (state.videoMode === 'screen') {
        teardownScreenAudioMix(true);
        stopLocalVideoTrack();
        state.videoMode = 'off';
        sendSignal('video-mode-sync', { mode: 'off' });
        sendSignal('video-off-notify');
        updateCallUIState();
        showCallToast('Vídeo finalizado');
      }
    };

    await attachOrReplaceVideoStream(videoOnlyStream, 'screen');
    updateLocalMediaBarUi(true);
    showCallToast('Transmitindo vídeo do celular (modo leve) ♡');
  } catch (_) {
    cleanupLocalMediaFile();
    teardownScreenAudioMix(true);
    state.videoMode = 'off';
    sendSignal('video-mode-sync', { mode: 'off' });
    updateCallUIState();
    showCallToast('Não foi possível transmitir este arquivo de vídeo.');
  }
}

async function toggleLocalVideoMode(targetMode) {
  if (!state.inCall || !state.pc) return;
  resetControlsAutoHideOnInteraction();

  if (state.videoMode === targetMode) {
    teardownScreenAudioMix(true);
    stopLocalVideoTrack();
    state.videoMode = 'off';
    sendSignal('video-mode-sync', { mode: 'off' });
    sendSignal('video-off-notify');
    updateCallUIState();
    return;
  }

  if (targetMode === 'screen') {
    const hasDisplayCapture = Boolean(
      navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'
    );

    // No Chrome Mobile (Android/iOS), getDisplayMedia não existe: abre direto o seletor de vídeo/filme do celular
    // mantendo a câmera atual intacta caso o usuário cancele o seletor.
    if (!hasDisplayCapture) {
      if (el.screenVideoFileInput) {
        el.screenVideoFileInput.click();
      } else {
        showCallToast('Selecione um arquivo de vídeo para transmitir.');
      }
      return;
    }

    // Libera vídeo anterior de forma síncrona ANTES do getDisplayMedia para não perder o gesto do toque!
    teardownScreenAudioMix(true);
    cleanupLocalMediaFile();
    stopStreamTracks(state.localVideoStream);
    state.localVideoStream = null;
    el.localVideo.srcObject = null;

    const startedAt = Date.now();
    let screenStream = null;

    try {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (firstErr) {
        if (firstErr && (firstErr.name === 'NotAllowedError' || firstErr.name === 'AbortError')) {
          throw firstErr;
        }
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      const screenAudioTrack = screenStream.getAudioTracks()[0];

      if (screenTrack && typeof screenTrack.applyConstraints === 'function') {
        try {
          await screenTrack.applyConstraints({
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 }
          });
        } catch (_) {}
      }

      if (screenAudioTrack) {
        await setupScreenAudioMix(screenAudioTrack);
      } else {
        showCallToast('Tela transmitida (selecione "Compartilhar áudio" para o som do filme).');
      }

      if (screenTrack) {
        screenTrack.onended = () => {
          if (state.videoMode === 'screen') {
            teardownScreenAudioMix(true);
            stopLocalVideoTrack();
            state.videoMode = 'off';
            sendSignal('video-mode-sync', { mode: 'off' });
            sendSignal('video-off-notify');
            updateCallUIState();
          }
        };
      }

      await attachOrReplaceVideoStream(screenStream, 'screen');
      showCallToast('Transmissão de tela ativa ♡');
    } catch (err) {
      stopStreamTracks(screenStream);
      teardownScreenAudioMix(true);
      state.videoMode = 'off';
      sendSignal('video-mode-sync', { mode: 'off' });
      updateCallUIState();

      const elapsed = Date.now() - startedAt;
      if (err && err.name === 'NotAllowedError' && elapsed < 250) {
        openScreenUnsupportedModal(
          'Este navegador bloqueou a captura da tela do sistema. Escolha um vídeo/filme salvo no aparelho para transmitir com baixo consumo de memória:'
        );
      } else if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        showCallToast('Seleção de tela cancelada.');
      } else {
        openScreenUnsupportedModal(
          'Este navegador não suportou captura de tela do sistema. Escolha um vídeo/filme salvo no aparelho para transmitir ao vivo:'
        );
      }
    }
    return;
  }

  // Modo câmera
  teardownScreenAudioMix(true);
  cleanupLocalMediaFile();
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;

  try {
    const camStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
    await attachOrReplaceVideoStream(camStream, 'camera');
  } catch (_) {
    state.videoMode = 'off';
    sendSignal('video-mode-sync', { mode: 'off' });
    updateCallUIState();
    showCallToast('Erro ao ligar a câmera.');
  }
}

function stopLocalVideoTrack() {
  cleanupLocalMediaFile();
  if (state.pc) {
    const sender = findVideoSender(state.pc);
    if (sender) {
      try {
        sender.replaceTrack(null);
      } catch (_) {}
    }
  }
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;
}

async function switchCamera() {
  if (!state.inCall || !state.pc) return;
  resetControlsAutoHideOnInteraction();

  const nextFacing =
    state.videoMode === 'camera'
      ? state.facingMode === 'user'
        ? 'environment'
        : 'user'
      : 'environment';

  // IMPORTANTE NO ANDROID (Galaxy J5): parar a câmera atual ANTES de abrir a outra!
  teardownScreenAudioMix(true);
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;

  try {
    const newStream = await acquireCameraStream(state.ecoMode480p, nextFacing, true);
    state.facingMode = nextFacing;
    await attachOrReplaceVideoStream(newStream, 'camera');
    showCallToast(nextFacing === 'environment' ? 'Câmera traseira ativada' : 'Câmera frontal ativada');
  } catch (_) {
    try {
      const fallbackStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
      await attachOrReplaceVideoStream(fallbackStream, 'camera');
    } catch (_) {
      state.videoMode = 'off';
      sendSignal('video-mode-sync', { mode: 'off' });
      updateCallUIState();
    }
    showCallToast('Não foi possível alternar a câmera neste aparelho.');
  }
}

async function toggleEcoMode() {
  resetControlsAutoHideOnInteraction();
  state.ecoMode480p = !state.ecoMode480p;
  el.ecoModeBtn.textContent = state.ecoMode480p ? '480p Eco' : '720p HD';
  el.ecoModeBtn.classList.toggle('eco-active', state.ecoMode480p);

  if (state.pc) await applyVideoBitrateLimits(state.pc, state.ecoMode480p);

  if (state.videoMode === 'camera' && state.localVideoStream) {
    const track = state.localVideoStream.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints(getVideoConstraints(state.ecoMode480p, state.facingMode, false));
      } catch (_) {}
    }
  }
}

function toggleMic() {
  if (!state.localAudioStream) return;
  resetControlsAutoHideOnInteraction();
  state.micMuted = !state.micMuted;

  if (state.screenMixMicGain) {
    // Quando transmitindo tela com áudio: zera APENAS o ganho do microfone,
    // mantendo a faixa mista ativa e o áudio do filme 100% limpo!
    state.screenMixMicGain.gain.value = state.micMuted ? 0 : 1;
    state.localAudioStream.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    showCallToast(
      state.micMuted
        ? 'Seu mic está mutado (som da transmissão continua)'
        : 'Seu mic está ativo junto com a transmissão'
    );
  } else {
    state.localAudioStream.getAudioTracks().forEach((t) => {
      t.enabled = !state.micMuted;
    });
    showCallToast(state.micMuted ? 'Microfone mutado' : 'Microfone ativo');
  }

  updateCallUIState();
}

function toggleSound() {
  resetControlsAutoHideOnInteraction();
  state.soundMuted = !state.soundMuted;
  el.remoteAudio.muted = state.soundMuted;
  el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
  el.remoteVideo.muted = true;
  if (!state.soundMuted) {
    el.remoteAudio.play().catch(() => {});
  }
  showCallToast(state.soundMuted ? 'Retorno silenciado (transmissão segue normal)' : 'Áudio ativo');
  updateCallUIState();
}

function forcePlayRemoteMedia() {
  el.remoteAudio.muted = state.soundMuted;
  el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
  el.remoteVideo.muted = true;
  el.remoteAudio.play().catch(() => {});
  el.remoteVideo.play().catch(() => {});
}

// ============================================================================
// CONTROLES DE PALCO: PIP, ROTAÇÃO, TELA CHEIA E AUTO-OCULTAR (1 CLIQUE / 5S)
// ============================================================================
function applyStageRotationVisual() {
  const overlayW = el.videoOverlay ? el.videoOverlay.clientWidth : window.innerWidth;
  const overlayH = el.videoOverlay ? el.videoOverlay.clientHeight : window.innerHeight;
  const isNativeLandscape = overlayW > overlayH;
  const useCssRotation = state.isStageRotated && !isNativeLandscape;
  const localOnMain = isLocalStageActive() && state.videoMode !== 'off';

  if (el.videoOverlay && useCssRotation && overlayW > 0 && overlayH > 0) {
    el.videoOverlay.style.setProperty('--stage-rot-w', `${overlayH}px`);
    el.videoOverlay.style.setProperty('--stage-rot-h', `${overlayW}px`);
  } else if (el.videoOverlay) {
    el.videoOverlay.style.removeProperty('--stage-rot-w');
    el.videoOverlay.style.removeProperty('--stage-rot-h');
  }

  el.remoteVideo.classList.toggle('stage-rotated', useCssRotation && !localOnMain);
  el.localVideo.classList.toggle('stage-rotated', useCssRotation && localOnMain);
  if (el.rotateStageBtn) {
    el.rotateStageBtn.classList.toggle('active', state.isStageRotated);
  }
}

async function toggleStageRotation() {
  resetControlsAutoHideOnInteraction();
  state.isStageRotated = !state.isStageRotated;

  if (state.isStageRotated) {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      try {
        if (!document.fullscreenElement && !document.webkitFullscreenElement && el.videoOverlay.requestFullscreen) {
          await el.videoOverlay.requestFullscreen().catch(() => {});
        }
        await screen.orientation.lock('landscape');
      } catch (_) {}
    }
    showCallToast('Tela girada para paisagem');
  } else {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      try {
        screen.orientation.unlock();
      } catch (_) {}
    }
    showCallToast('Tela em modo normal');
  }

  applyStageRotationVisual();
}

function swapPipVideos() {
  if (!state.inCall) return;
  state.pipSwapped = !state.pipSwapped;
  updateCallUIState();
  resetControlsAutoHideOnInteraction();
}

function setControlsHidden(hidden) {
  state.controlsHidden = hidden;
  el.videoOverlay.classList.toggle('controls-hidden', hidden);
}

function scheduleControlsAutoHide() {
  clearTimeout(state.controlsAutoHideTimerId);
  if (!state.inCall || state.callMinimized || state.callChatOpen) return;

  state.controlsAutoHideTimerId = setTimeout(() => {
    if (state.inCall && !state.callMinimized && !state.callChatOpen) {
      setControlsHidden(true);
    }
  }, CONTROLS_AUTOHIDE_MS);
}

function resetControlsAutoHideOnInteraction() {
  if (state.controlsHidden) setControlsHidden(false);
  scheduleControlsAutoHide();
}

function toggleControlsVisibilityByTap() {
  if (!state.inCall) return;
  const nextHidden = !state.controlsHidden;
  setControlsHidden(nextHidden);
  if (!nextHidden) {
    scheduleControlsAutoHide();
  } else {
    clearTimeout(state.controlsAutoHideTimerId);
  }
}

async function toggleFullscreen() {
  resetControlsAutoHideOnInteraction();
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) {}
    el.videoOverlay.classList.remove('pseudo-fullscreen');
    el.toggleFullscreenBtn.classList.remove('active-feature');
    return;
  }

  try {
    if (el.videoOverlay.requestFullscreen) {
      await el.videoOverlay.requestFullscreen();
    } else if (el.videoOverlay.webkitRequestFullscreen) {
      el.videoOverlay.webkitRequestFullscreen();
    } else {
      el.videoOverlay.classList.toggle('pseudo-fullscreen');
    }
    el.toggleFullscreenBtn.classList.add('active-feature');
  } catch (_) {
    const active = el.videoOverlay.classList.toggle('pseudo-fullscreen');
    el.toggleFullscreenBtn.classList.toggle('active-feature', active);
  }
}

function minimizeCallToChat() {
  if (!state.inCall) return;
  state.callMinimized = true;
  clearTimeout(state.controlsAutoHideTimerId);
  el.videoOverlay.classList.add('hidden');
  el.activeCallBanner.classList.remove('hidden');
}

function restoreCallOverlay() {
  if (!state.inCall) return;
  state.callMinimized = false;
  el.activeCallBanner.classList.add('hidden');
  el.videoOverlay.classList.remove('hidden');
  setControlsHidden(false);
  scheduleControlsAutoHide();
}

function updateCallUIState() {
  const hasLocalVideo = state.videoMode !== 'off';
  const hasLocalMediaPlayer = Boolean(state.localMediaVideoEl && state.videoMode === 'screen');
  el.localVideo.classList.toggle('hidden', !hasLocalVideo);
  el.localVideo.classList.toggle('is-screen', state.videoMode === 'screen');
  el.localVideo.classList.toggle('mirrored', state.videoMode === 'camera' && state.facingMode === 'user');
  el.switchCamBtn.disabled = state.videoMode === 'screen';

  if (el.localMediaBar) el.localMediaBar.classList.toggle('hidden', !hasLocalMediaPlayer);
  el.videoOverlay.classList.toggle('has-local-media', hasLocalMediaPlayer);

  el.toggleMicBtn.classList.toggle('muted', state.micMuted);
  el.toggleSoundBtn.classList.toggle('muted-sound', state.soundMuted);
  el.toggleCamBtn.classList.toggle('active-feature', state.videoMode === 'camera');
  el.shareScreenBtn.classList.toggle('active-feature', state.videoMode === 'screen');
  manageWakeLock(hasLocalVideo);
  updateRemoteStageVisibility();
}

function startCallTimer() {
  if (state.callTimerId) return;
  state.callSeconds = 0;
  const updateLabels = () => {
    const t = formatSeconds(state.callSeconds);
    const modeTag =
      state.videoMode === 'screen'
        ? 'Transmitindo tela'
        : state.videoMode === 'camera'
          ? state.ecoMode480p
            ? '480p Eco'
            : '720p HD'
          : 'Voz ativa';
    el.callStateLabel.textContent = `${modeTag} • ${t}`;
    el.callBannerText.textContent = `Em ligação (${state.partnerName}) • ${t}`;
  };
  updateLabels();
  state.callTimerId = setInterval(() => {
    state.callSeconds += 1;
    updateLabels();
  }, 1000);
}

function endCall(notifyPeer) {
  const durationSnapshot = state.callSeconds;
  const shouldLog = state.inCall && state.callIsInitiator && state.callSignaled && !state.callLogged;
  const logStatus = state.callConnected ? 'answered' : 'missed';

  if (shouldLog) {
    saveCallLogMarker(logStatus, durationSnapshot);
  }

  clearTimeout(state.ringTimeoutId);
  clearTimeout(state.callToastTimerId);
  clearTimeout(state.iceRestartTimerId);
  clearTimeout(state.controlsAutoHideTimerId);
  clearInterval(state.callTimerId);
  stopRingtone();
  teardownScreenAudioMix(false);
  cleanupLocalMediaFile();
  closeScreenUnsupportedModal();

  state.callTimerId = null;
  state.callSeconds = 0;
  state.incomingRinging = false;

  if (notifyPeer && state.inCall) sendSignal('call-ended');

  stopStreamTracks(state.localAudioStream);
  stopStreamTracks(state.localVideoStream);
  stopStreamTracks(state.remoteStream);
  state.localAudioStream = null;
  state.localVideoStream = null;
  state.remoteStream = null;

  el.localVideo.srcObject = null;
  el.remoteVideo.srcObject = null;
  el.remoteAudio.srcObject = null;

  if (state.pc) {
    try {
      state.pc.onicecandidate = null;
      state.pc.ontrack = null;
      state.pc.onconnectionstatechange = null;
      state.pc.close();
    } catch (_) {}
    state.pc = null;
  }

  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    try {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) {}
  }

  if (screen.orientation && typeof screen.orientation.unlock === 'function') {
    try {
      screen.orientation.unlock();
    } catch (_) {}
  }

  state.inCall = false;
  state.callMinimized = false;
  state.callIsInitiator = false;
  state.callSignaled = false;
  state.callInitialVideo = false;
  state.callConnected = false;
  state.callLogged = false;
  state.videoMode = 'off';
  state.remoteVideoMode = 'off';
  state.pipSwapped = false;
  state.controlsHidden = false;
  state.isStageRotated = false;
  state.callChatOpen = false;
  state.inCallUnreadCount = 0;
  state.pendingOffer = null;
  state.pendingIceCandidates = [];

  updateMediaSessionForCall(false);
  manageWakeLock(false);
  updateCallChatBadge();

  el.callToast.classList.add('hidden');
  el.callChatOverlay.classList.add('hidden');
  el.remoteVideo.classList.remove('stage-rotated', 'is-screen');
  el.localVideo.classList.remove('stage-rotated', 'is-screen', 'mirrored');
  el.videoOverlay.style.removeProperty('--stage-rot-w');
  el.videoOverlay.style.removeProperty('--stage-rot-h');
  if (el.rotateStageBtn) el.rotateStageBtn.classList.remove('active');
  el.toggleCallChatBtn.classList.remove('active-feature');
  el.toggleFullscreenBtn.classList.remove('active-feature');
  el.videoOverlay.classList.remove('local-stage', 'has-local-media', 'controls-hidden', 'pseudo-fullscreen');
  el.videoOverlay.classList.add('hidden');
  el.activeCallBanner.classList.add('hidden');
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  el.incomingModal.style.cssText = '';
}

// ============================================================================
// EVENTOS GLOBAIS E DE INTERFACE
// ============================================================================
function bindEvents() {
  el.loadOlderBtn.addEventListener('click', loadOlderMessages);

  // Menu lateral 3 pontinhos (⋮)
  el.menuDotsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHeaderMenu();
  });
  document.addEventListener('click', (e) => {
    if (!el.headerMenuPopover.classList.contains('hidden')) {
      if (!el.headerMenuPopover.contains(e.target) && !el.menuDotsBtn.contains(e.target)) {
        closeHeaderMenu();
      }
    }
  });

  el.clearChatBtn.addEventListener('click', () => {
    closeHeaderMenu();
    openConfirmModal(
      'Limpar mensagens?',
      'Isso vai apagar as mensagens e mídias desta conversa.',
      'Limpar tudo',
      executeClearChat
    );
  });

  // Modal de confirmação
  el.confirmCancelBtn.addEventListener('click', closeConfirmModal);
  el.confirmModal.addEventListener('click', (e) => {
    if (e.target === el.confirmModal) closeConfirmModal();
  });
  el.confirmAcceptBtn.addEventListener('click', async () => {
    const cb = state.confirmActionCallback;
    closeConfirmModal();
    if (typeof cb === 'function') await cb();
  });

  // Compositor de texto
  el.messageInput.addEventListener('input', () => {
    el.messageInput.style.height = 'auto';
    el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 112)}px`;
    toggleComposerButtons();

    const now = Date.now();
    if (state.chatChannel && el.messageInput.value.trim() && now - state.lastTypingSentAt > 1800) {
      state.lastTypingSentAt = now;
      state.chatChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { from: state.currentUser }
      });
    }
  });

  el.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  el.sendBtn.addEventListener('click', sendTextMessage);

  // Fotos: Normal, Visualização Dupla (2x) e Apagar
  el.photoBtn.addEventListener('click', () => el.photoInput.click());
  el.photoInput.addEventListener('change', handlePhotoSelected);
  el.photoModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => setPendingPhotoMode(btn.dataset.photoMode));
  });
  el.cancelPhotoBtn.addEventListener('click', closePhotoModal);
  el.confirmPhotoBtn.addEventListener('click', uploadAndSendPhoto);

  el.closeLightboxBtn.addEventListener('click', closeLightbox);
  el.lightboxDeleteBtn.addEventListener('click', () => {
    const targetMsg = state.activeLightboxMsg;
    if (!targetMsg) return;
    openConfirmModal(
      'Apagar foto?',
      'Essa foto será removida da conversa para vocês dois.',
      'Apagar',
      () => deletePhotoMessage(targetMsg)
    );
  });
  el.lightboxModal.addEventListener('click', (e) => {
    if (e.target === el.lightboxModal) closeLightbox();
  });

  // Áudio
  el.recordBtn.addEventListener('click', startAudioRecording);
  el.cancelRecordBtn.addEventListener('click', cancelAudioRecording);
  el.sendRecordBtn.addEventListener('click', finishAudioRecording);

  // Ligação / Transmissão / Twitch Chat / Tela Cheia
  el.startVoiceBtn.addEventListener('click', () => startOutgoingCall(false));
  el.startVideoBtn.addEventListener('click', () => startOutgoingCall(true));
  el.acceptCallBtn.addEventListener('click', acceptIncomingCall);
  el.rejectCallBtn.addEventListener('click', rejectIncomingCall);
  el.minimizeCallBtn.addEventListener('click', minimizeCallToChat);
  el.returnToCallBtn.addEventListener('click', restoreCallOverlay);
  el.bannerHangupBtn.addEventListener('click', () => endCall(true));

  el.toggleMicBtn.addEventListener('click', toggleMic);
  el.toggleSoundBtn.addEventListener('click', toggleSound);
  el.toggleCamBtn.addEventListener('click', () => toggleLocalVideoMode('camera'));
  el.shareScreenBtn.addEventListener('click', () => toggleLocalVideoMode('screen'));
  if (el.streamLocalVideoBtn && el.screenVideoFileInput) {
    el.streamLocalVideoBtn.addEventListener('click', () => el.screenVideoFileInput.click());
    el.screenVideoFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) startLocalVideoFileStream(file);
    });
  }
  if (el.closeScreenModalBtn) {
    el.closeScreenModalBtn.addEventListener('click', closeScreenUnsupportedModal);
  }
  if (el.screenUnsupportedModal) {
    el.screenUnsupportedModal.addEventListener('click', (e) => {
      if (e.target === el.screenUnsupportedModal) closeScreenUnsupportedModal();
    });
  }
  if (el.mediaPlayPauseBtn) {
    el.mediaPlayPauseBtn.addEventListener('click', () => {
      const v = state.localMediaVideoEl;
      if (!v) return;
      resetControlsAutoHideOnInteraction();
      if (v.paused) v.play().catch(() => {});
      else v.pause();
      updateLocalMediaBarUi(true);
    });
  }
  if (el.mediaBackBtn) {
    el.mediaBackBtn.addEventListener('click', () => {
      const v = state.localMediaVideoEl;
      if (!v) return;
      resetControlsAutoHideOnInteraction();
      v.currentTime = Math.max(0, v.currentTime - 15);
      updateLocalMediaBarUi(true);
    });
  }
  if (el.mediaFwdBtn) {
    el.mediaFwdBtn.addEventListener('click', () => {
      const v = state.localMediaVideoEl;
      if (!v) return;
      resetControlsAutoHideOnInteraction();
      const maxDur = Number.isFinite(v.duration) ? v.duration : v.currentTime + 15;
      v.currentTime = Math.min(maxDur, v.currentTime + 15);
      updateLocalMediaBarUi(true);
    });
  }
  if (el.mediaSeekSlider) {
    el.mediaSeekSlider.addEventListener('input', () => {
      state.localMediaSeeking = true;
      resetControlsAutoHideOnInteraction();
    });
    el.mediaSeekSlider.addEventListener('change', () => {
      const v = state.localMediaVideoEl;
      state.localMediaSeeking = false;
      if (v && Number.isFinite(v.duration) && v.duration > 0) {
        const pct = Number(el.mediaSeekSlider.value) / 1000;
        v.currentTime = Math.max(0, Math.min(v.duration, pct * v.duration));
      }
      updateLocalMediaBarUi(true);
    });
  }
  if (el.mediaChangeFileBtn && el.screenVideoFileInput) {
    el.mediaChangeFileBtn.addEventListener('click', () => {
      resetControlsAutoHideOnInteraction();
      el.screenVideoFileInput.click();
    });
  }
  el.switchCamBtn.addEventListener('click', switchCamera);
  if (el.rotateStageBtn) el.rotateStageBtn.addEventListener('click', toggleStageRotation);
  el.ecoModeBtn.addEventListener('click', toggleEcoMode);
  el.toggleCallChatBtn.addEventListener('click', toggleCallChatOverlay);
  el.toggleFullscreenBtn.addEventListener('click', toggleFullscreen);
  el.hangupBtn.addEventListener('click', () => endCall(true));

  el.callChatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = el.callChatInput.value.trim();
    if (!txt) return;
    el.callChatInput.value = '';
    await sendTextContent(txt);
  });

  // Toque no PiP alterna fundo/canto; toque no vídeo de fundo ou área livre oculta/exibe barras com 1 clique
  el.localVideo.addEventListener('click', (e) => {
    e.stopPropagation();
    const localOnMain = isLocalStageActive() && state.videoMode !== 'off';
    if (!localOnMain) {
      swapPipVideos();
    } else {
      toggleControlsVisibilityByTap();
    }
  });

  el.remoteVideo.addEventListener('click', (e) => {
    e.stopPropagation();
    const localOnMain = isLocalStageActive() && state.videoMode !== 'off';
    if (localOnMain) {
      swapPipVideos();
    } else {
      toggleControlsVisibilityByTap();
    }
  });

  el.videoOverlay.addEventListener('click', (e) => {
    if (
      e.target.closest(
        '.call-top-bar, .call-controls, .call-chat-overlay, #local-media-bar, #call-toast, button, input, form'
      )
    ) {
      return;
    }
    toggleControlsVisibilityByTap();
  });

  window.addEventListener('resize', applyStageRotationVisual);
  window.addEventListener('orientationchange', applyStageRotationVisual);

  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    el.toggleFullscreenBtn.classList.toggle('active-feature', active);
    setTimeout(applyStageRotationVisual, 60);
  });

  // Sincroniza mensagens perdidas e marca como lidas ao voltar ao app
  document.addEventListener('visibilitychange', () => {
    if (!state.unlocked) return;
    if (document.visibilityState === 'visible') {
      updateMyDbStatus(true);
      syncMissedMessages();
      if (!state.inCall || state.callChatOpen) markAllVisibleUnreadAsRead();
      if (state.inCall && state.videoMode !== 'off') manageWakeLock(true);
    } else {
      updateMyDbStatus(false);
    }
  });

  window.addEventListener('pagehide', () => {
    updateMyDbStatus(false);
    cancelAudioRecording();
    endCall(true);
    revokePendingPhotoUrl();
  });
}

// ============================================================================
// BOOTSTRAP
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initPWA();
  bindEvents();
  initLockScreen();
});

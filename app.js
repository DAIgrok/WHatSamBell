/* ============================================================================
   NOSSO MUNDO ♡ — VANILLA JS (ES6+) ULTRA-LEVE PARA GALAXY J5
   - Usuários: Gabriel (2010) e Samella (2011)
   - Chat em Tempo Real duplo (Supabase Postgres Changes + WebSocket Broadcast)
   - Visto WhatsApp (✓ / ✓✓ / ✓✓ azul) + Digitando... + Online / Visto por último
   - Fotos comprimidas (Canvas) + Áudios (MediaRecorder)
   - Ligação em tempo real (Voz + Câmera 720p@30fps + Botão Virar Câmera + Transmitir)
   - Notificações Push / Service Worker + MediaSession em segundo plano
   ============================================================================ */

'use strict';

// ============================================================================
// CONFIGURAÇÃO DO SUPABASE
// ============================================================================
const SUPABASE_URL = 'https://nigimqjplcczxcbygjba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tnBcF8zySL-fuXSnlswfrA_p6afpsYz';

// Opcional: cole aqui uma chave pública VAPID se configurar uma Edge Function de Push
const VAPID_PUBLIC_KEY = '';

const USERS = {
  Gabriel: '2010',
  Samella: '2011'
};

// Limites rígidos de hardware para o Samsung Galaxy J5 (1.5GB/2GB RAM)
const MAX_RENDERED_MESSAGES = 80;
const INITIAL_FETCH_LIMIT = 40;
const IMAGE_MAX_SIDE_PX = 1024;
const IMAGE_JPEG_QUALITY = 0.72;
const WEBRTC_MAX_VIDEO_BITRATE_HD = 1200000;
const WEBRTC_MAX_VIDEO_BITRATE_ECO = 550000;
const AUDIO_RECORDER_BITRATE = 128000;

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
  signalChannel: null,
  presenceChannel: null,
  statusChannel: null,

  currentUser: sessionStorage.getItem('nm_user') || localStorage.getItem('nm_last_user') || 'Gabriel',
  partnerName: 'Samella',
  unlocked: sessionStorage.getItem('nm_unlocked') === '1',
  partnerOnlineRealtime: false,
  partnerLastSeen: null,
  partnerTyping: false,
  partnerTypingTimer: null,
  lastTypingSentAt: 0,

  renderedIds: new Set(),
  oldestTimestamp: null,
  newestTimestamp: null,
  hasMoreOlder: false,
  activeAudio: null,

  pendingPhotoBlob: null,
  pendingPhotoPreviewUrl: null,

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
  pendingOffer: null,
  pendingCallerName: null,
  pendingCallWithVideo: false,
  pendingIceCandidates: [],
  inCall: false,
  callMinimized: false,
  videoMode: 'off', // 'off' | 'camera' | 'screen'
  micMuted: false,
  soundMuted: false,
  facingMode: 'user',
  ecoMode480p: false,
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
  notifBtn: document.getElementById('notif-btn'),
  installBtn: document.getElementById('install-pwa-btn'),
  startVoiceBtn: document.getElementById('start-voice-call-btn'),
  startVideoBtn: document.getElementById('start-video-call-btn'),
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
  photoCaptionInput: document.getElementById('photo-caption-input'),
  cancelPhotoBtn: document.getElementById('cancel-photo-btn'),
  confirmPhotoBtn: document.getElementById('confirm-photo-btn'),

  lightboxModal: document.getElementById('lightbox-modal'),
  lightboxImg: document.getElementById('lightbox-img'),
  closeLightboxBtn: document.getElementById('close-lightbox-btn'),

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
  ecoModeBtn: document.getElementById('eco-mode-btn'),
  callToast: document.getElementById('call-toast'),
  toggleMicBtn: document.getElementById('toggle-mic-btn'),
  toggleCamBtn: document.getElementById('toggle-cam-btn'),
  toggleSoundBtn: document.getElementById('toggle-sound-btn'),
  shareScreenBtn: document.getElementById('share-screen-btn'),
  switchCamBtn: document.getElementById('switch-cam-btn'),
  hangupBtn: document.getElementById('hangup-btn'),

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

function playSoftTone(freqStart, freqEnd) {
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

// "Plim" discreto e agradável para nova mensagem (web audio, sem arquivos externos)
function playMessagePlim() {
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

// Toque de chamada suave e discreto em loop (web audio, sem MP3)
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

// Toast flutuante de nova mensagem no topo
function showMsgToast(text) {
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
// PWA, PUSH NOTIFICATIONS E PERSISTÊNCIA EM SEGUNDO PLANO
// ============================================================================
function updateNotifButtonVisual() {
  if (!('Notification' in window)) {
    el.notifBtn.classList.add('hidden');
    return;
  }
  const granted = Notification.permission === 'granted';
  el.notifBtn.classList.toggle('notif-enabled', granted);
  el.notifBtn.title = granted ? 'Notificações push ativadas' : 'Ativar notificações push';
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
  el.notifBtn.addEventListener('click', () => activatePushNotifications(true));
  el.chatAlertClose.addEventListener('click', hideChatAlert);
}

async function notifyBackground(title, body, tag) {
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
// TELA DE ACESSO (GABRIEL: 2010 / SAMELLA: 2011)
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
    localStorage.setItem('nm_last_user', state.currentUser);
    sessionStorage.setItem('nm_user', state.currentUser);
    sessionStorage.setItem('nm_unlocked', '1');
    el.passcodeInput.value = '';
    enterChat();
  });

  el.lockAppBtn.addEventListener('click', lockApp);

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
  sessionStorage.removeItem('nm_unlocked');
  cleanupRealtimeChannels();
  endCall(false);
  cancelAudioRecording();
  el.chatScreen.classList.add('hidden');
  el.lockScreen.classList.remove('hidden');
}

// ============================================================================
// CONEXÃO SUPABASE + REALTIME DUPLO + ONLINE/OFFLINE + VISTO
// ============================================================================
function enterChat() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showLockError('SDK do Supabase não carregado. Verifique sua internet.');
    return;
  }

  state.supabase = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
    realtime: { params: { eventsPerSecond: 15 } }
  });

  state.partnerName = getPartnerFor(state.currentUser);
  el.partnerNameHeader.textContent = state.partnerName;
  el.partnerAvatar.textContent = state.partnerName.charAt(0);
  el.stageAvatar.textContent = state.partnerName.charAt(0);
  el.callPartnerLabel.textContent = state.partnerName;

  el.lockScreen.classList.add('hidden');
  el.chatScreen.classList.remove('hidden');

  updateNotifButtonVisual();
  if (Notification && Notification.permission === 'granted') {
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
  [state.chatChannel, state.signalChannel, state.presenceChannel, state.statusChannel].forEach((ch) => {
    if (ch) state.supabase.removeChannel(ch);
  });
  state.chatChannel = null;
  state.signalChannel = null;
  state.presenceChannel = null;
  state.statusChannel = null;
}

function handleIncomingRealtimeMessage(msg) {
  if (!msg || !msg.id) return;
  const isNew = !state.renderedIds.has(msg.id);
  appendMessage(msg, true);

  if (isNew && msg.sender_name !== state.currentUser) {
    state.partnerTyping = false;
    renderPartnerStatus(state.partnerOnlineRealtime, state.partnerLastSeen);

    const preview =
      msg.media_type === 'image'
        ? '📷 Enviou uma foto'
        : msg.media_type === 'audio'
          ? '🎤 Enviou um áudio'
          : msg.content || 'Nova mensagem';

    if (document.visibilityState === 'visible') {
      const viewport = el.messagesViewport;
      const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
      if (nearBottom && !state.inCall) {
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

function subscribeRealtime() {
  cleanupRealtimeChannels();

  // 1. Canal do Chat: Postgres Changes + Broadcast instantâneo (~30ms)
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
        if (payload && payload.new) updateMessageTicksInDom(payload.new);
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

  // 4. Sinalização WebRTC em baixa latência
  state.signalChannel = state.supabase.channel('nosso-mundo-webrtc', {
    config: { broadcast: { self: false } }
  });

  state.signalChannel
    .on('broadcast', { event: 'webrtc-signal' }, ({ payload }) => {
      if (payload) handleWebRTCSignal(payload);
    })
    .subscribe();
}

// ============================================================================
// CHAT: CARREGAMENTO, SYNC E VISTO DE WHATSAPP (✓ / ✓✓ / ✓✓ AZUL)
// ============================================================================
async function loadInitialMessages() {
  el.messagesList.innerHTML = '';
  state.renderedIds.clear();
  state.oldestTimestamp = null;
  state.newestTimestamp = null;

  const { data, error } = await state.supabase
    .from('messages')
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(INITIAL_FETCH_LIMIT);

  if (error) {
    if (error.code === '42501') {
      showChatAlert('Execute os comandos GRANT do supabase_setup.sql no SQL Editor do Supabase.');
    }
    renderEmptyState('Sem acesso às mensagens. Execute o SQL atualizado no Supabase.');
    return;
  }

  if (!data || data.length === 0) {
    renderEmptyState(`Envie a primeira mensagem para ${state.partnerName} ♡`);
    el.loadOlderBtn.classList.add('hidden');
    return;
  }

  state.hasMoreOlder = data.length === INITIAL_FETCH_LIMIT;
  el.loadOlderBtn.classList.toggle('hidden', !state.hasMoreOlder);

  const ordered = data.slice().reverse();
  state.oldestTimestamp = ordered[0].created_at;
  state.newestTimestamp = ordered[ordered.length - 1].created_at;

  const unreadIds = [];
  const frag = document.createDocumentFragment();
  ordered.forEach((msg) => {
    const node = buildMessageNode(msg);
    if (node) frag.appendChild(node);
    if (msg.sender_name !== state.currentUser && !msg.is_read) {
      unreadIds.push(msg.id);
    }
  });
  el.messagesList.appendChild(frag);
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

  const { data, error } = await state.supabase
    .from('messages')
    .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
    .lt('created_at', state.oldestTimestamp)
    .order('created_at', { ascending: false })
    .limit(INITIAL_FETCH_LIMIT);

  el.loadOlderBtn.disabled = false;
  el.loadOlderBtn.textContent = 'Carregar mensagens anteriores';

  if (error || !data || data.length === 0) {
    el.loadOlderBtn.classList.add('hidden');
    return;
  }

  state.hasMoreOlder = data.length === INITIAL_FETCH_LIMIT;
  el.loadOlderBtn.classList.toggle('hidden', !state.hasMoreOlder);

  const prevHeight = el.messagesViewport.scrollHeight;
  const ordered = data.slice().reverse();
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

function buildMessageNode(msg) {
  if (!msg || !msg.id || state.renderedIds.has(msg.id)) return null;
  state.renderedIds.add(msg.id);

  if (!state.newestTimestamp || msg.created_at > state.newestTimestamp) {
    state.newestTimestamp = msg.created_at;
  }

  const isMe = msg.sender_name === state.currentUser;
  const row = document.createElement('article');
  row.className = `msg-row ${isMe ? 'me' : 'other'}`;
  row.dataset.id = msg.id;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (msg.media_type === 'image' && msg.media_url) {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = msg.media_url;
    img.alt = 'Foto enviada';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('click', () => openLightbox(msg.media_url));
    bubble.appendChild(img);
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
  }

  if (msg.content) {
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

  if (isMe) {
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

  while (el.messagesList.children.length > MAX_RENDERED_MESSAGES) {
    const first = el.messagesList.firstElementChild;
    if (!first) break;
    if (first.dataset.id) state.renderedIds.delete(first.dataset.id);
    first.remove();
  }

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

async function sendTextMessage() {
  const content = el.messageInput.value.trim();
  if (!content || !state.supabase) return;

  el.messageInput.value = '';
  el.messageInput.style.height = 'auto';
  toggleComposerButtons();

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
    showChatAlert('Não foi possível enviar. Confira sua internet ou o SQL no Supabase.');
    return;
  }

  if (data) {
    appendMessage(data, true);
    broadcastMessage(data);
  }
}

function toggleComposerButtons() {
  const hasText = el.messageInput.value.trim().length > 0;
  el.sendBtn.classList.toggle('hidden', !hasText);
  el.recordBtn.classList.toggle('hidden', hasText);
}

// ============================================================================
// FOTOS: COMPRESSÃO CLIENT-SIDE VIA CANVAS API + UPLOAD SUPABASE STORAGE
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

async function handlePhotoSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

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

  el.confirmPhotoBtn.disabled = true;
  el.confirmPhotoBtn.textContent = 'Enviando...';

  try {
    const filePath = `photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: uploadErr } = await state.supabase.storage
      .from('chat-media')
      .upload(filePath, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });

    if (uploadErr) throw uploadErr;

    const { data: pub } = state.supabase.storage.from('chat-media').getPublicUrl(filePath);
    const { data: inserted, error: msgErr } = await state.supabase
      .from('messages')
      .insert({
        sender_name: state.currentUser,
        content: caption || null,
        media_url: pub.publicUrl,
        media_type: 'image',
        is_read: false
      })
      .select('id, sender_name, content, media_url, media_type, is_read, read_at, created_at')
      .single();

    if (!msgErr && inserted) {
      appendMessage(inserted, true);
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

function openLightbox(url) {
  el.lightboxImg.src = url;
  el.lightboxModal.classList.remove('hidden');
}

function closeLightbox() {
  el.lightboxModal.classList.add('hidden');
  el.lightboxImg.removeAttribute('src');
}

// ============================================================================
// ÁUDIO: GRAVAÇÃO VIA MEDIARECORDER + LIBERAÇÃO IMEDIATA DE TRACKS
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
    broadcastMessage(inserted);
  }
}

// ============================================================================
// WEBRTC ESTILO DISCORD: VOZ + VÍDEO 720p@30fps + TRANSMISSÃO + VIRAR CÂMERA
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
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
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

  // Fallback por deviceId caso o aparelho Android ignore facingMode
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

async function applyVideoBitrateLimits(pc, ecoMode) {
  if (!pc || typeof pc.getSenders !== 'function') return;
  const maxBitrate = ecoMode ? WEBRTC_MAX_VIDEO_BITRATE_ECO : WEBRTC_MAX_VIDEO_BITRATE_HD;
  const maxFramerate = ecoMode ? 24 : 30;

  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = maxFramerate;
      params.degradationPreference = 'balanced';
      await sender.setParameters(params);
    } catch (_) {}
  }
}

function sendSignal(kind, data) {
  if (!state.signalChannel) return;
  state.signalChannel.send({
    type: 'broadcast',
    event: 'webrtc-signal',
    payload: { kind, from: state.currentUser, data: data || null }
  });
}

function updateRemoteStageVisibility() {
  const hasActiveRemoteVideo =
    state.remoteStream &&
    state.remoteStream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);

  el.remoteVideo.classList.toggle('hidden', !hasActiveRemoteVideo);
  el.voiceStageFallback.classList.toggle('hidden', hasActiveRemoteVideo);
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
        try { trans.setCodecPreferences(preferred); } catch (_) {}
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

    if (event.track.kind === 'audio') {
      const audioOnlyStream = new MediaStream([event.track]);
      el.remoteAudio.srcObject = audioOnlyStream;
      el.remoteAudio.muted = state.soundMuted;
      el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
      el.remoteAudio.play().catch(() => {});
    }

    if (event.track.kind === 'video') {
      el.remoteVideo.srcObject = state.remoteStream;
      el.remoteVideo.muted = state.soundMuted;
      el.remoteVideo.volume = state.soundMuted ? 0 : 1.0;
      el.remoteVideo.play().catch(() => {});
      event.track.onmute = updateRemoteStageVisibility;
      event.track.onunmute = updateRemoteStageVisibility;
      event.track.onended = updateRemoteStageVisibility;
    }
    updateRemoteStageVisibility();
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
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
          const restartOffer = await state.pc.createOffer({ iceRestart: true });
          await state.pc.setLocalDescription(restartOffer);
          sendSignal('ice-restart-offer', restartOffer);
        } catch (_) {}
      }, 3000);
    }
  };

  return pc;
}

async function startOutgoingCall(withVideo) {
  if (state.inCall || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  try {
    state.inCall = true;
    state.callMinimized = false;
    state.pendingIceCandidates = [];
    state.micMuted = false;
    state.soundMuted = false;
    state.facingMode = 'user';
    state.videoMode = withVideo ? 'camera' : 'off';

    el.videoOverlay.classList.remove('hidden');
    el.activeCallBanner.classList.add('hidden');
    el.callPartnerLabel.textContent = state.partnerName;
    el.callStateLabel.textContent = withVideo ? 'Iniciando câmera 720p...' : 'Iniciando áudio...';

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

    preferVideoCodecs(state.pc);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);

    el.callStateLabel.textContent = 'Chamando...';
    sendSignal('call-offer', { sdp: offer, withVideo });

    clearTimeout(state.ringTimeoutId);
    state.ringTimeoutId = setTimeout(() => {
      if (state.inCall && state.pc && state.pc.connectionState !== 'connected') {
        endCall(true);
      }
    }, 45000);
  } catch (_) {
    endCall(false);
  }
}

async function acceptIncomingCall() {
  if (!state.pendingOffer) return;

  stopRingtone();
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  state.inCall = true;
  state.callMinimized = false;
  state.micMuted = false;
  state.soundMuted = false;
  state.facingMode = 'user';
  state.videoMode = state.pendingCallWithVideo ? 'camera' : 'off';

  try {
    el.videoOverlay.classList.remove('hidden');
    el.activeCallBanner.classList.add('hidden');
    el.callPartnerLabel.textContent = state.pendingCallerName || state.partnerName;
    el.callStateLabel.textContent = 'Conectando...';

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
    sendSignal('call-answer', answer);
  } catch (_) {
    endCall(true);
  }
}

function rejectIncomingCall() {
  stopRingtone();
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
  state.pendingOffer = null;
  state.pendingIceCandidates = [];
  sendSignal('call-reject');
}

async function renegotiateCall() {
  if (!state.pc) return;
  try {
    preferVideoCodecs(state.pc);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await applyVideoBitrateLimits(state.pc, state.ecoMode480p);
    sendSignal('renegotiate-offer', offer);
  } catch (_) {}
}

async function handleWebRTCSignal({ kind, from, data }) {
  if (kind === 'call-offer') {
    if (state.inCall) {
      sendSignal('call-reject');
      return;
    }
    state.pendingOffer = data.sdp;
    state.pendingCallWithVideo = Boolean(data.withVideo);
    state.pendingCallerName = from || state.partnerName;
    state.pendingIceCandidates = [];

    el.incomingCallerName.textContent = `${state.pendingCallerName} está ligando ♡`;
    el.incomingCallType.textContent = state.pendingCallWithVideo
      ? 'Ligação com vídeo e transmissão'
      : 'Ligação de voz (estilo Discord)';
    el.incomingModal.classList.add('incoming-backdrop');
    el.incomingModal.classList.remove('hidden');

    startRingtone();
    notifyBackground(
      `${state.pendingCallerName} está ligando ♡`,
      state.pendingCallWithVideo ? 'Toque para atender o vídeo' : 'Toque para atender a voz',
      'call-nosso-mundo'
    );

    if (navigator.vibrate) {
      try {
        navigator.vibrate([400, 200, 400, 200, 400, 200, 400]);
      } catch (_) {}
    }
    return;
  }

  if (kind === 'call-answer') {
    clearTimeout(state.ringTimeoutId);
    stopRingtone();
    if (!state.pc) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(data));
      while (state.pendingIceCandidates.length > 0) {
        const cand = state.pendingIceCandidates.shift();
        await state.pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (_) {}
    return;
  }

  if (kind === 'renegotiate-offer') {
    if (!state.pc) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      sendSignal('renegotiate-answer', answer);
      updateRemoteStageVisibility();
    } catch (_) {}
    return;
  }

  if (kind === 'renegotiate-answer') {
    if (!state.pc) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(data));
    } catch (_) {}
    return;
  }

  if (kind === 'ice-restart-offer') {
    if (!state.pc) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(data));
      preferVideoCodecs(state.pc);
      const restartAnswer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(restartAnswer);
      sendSignal('ice-restart-answer', restartAnswer);
    } catch (_) {}
    return;
  }

  if (kind === 'ice-restart-answer') {
    if (!state.pc) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(data));
      el.callStateLabel.textContent = 'Reconectado';
    } catch (_) {}
    return;
  }

  if (kind === 'video-off-notify') {
    el.remoteVideo.classList.add('hidden');
    el.voiceStageFallback.classList.remove('hidden');
    return;
  }

  if (kind === 'video-on-notify') {
    if (state.remoteStream && state.remoteStream.getVideoTracks().length > 0) {
      el.remoteVideo.srcObject = state.remoteStream;
      el.remoteVideo.classList.remove('hidden');
      el.voiceStageFallback.classList.add('hidden');
    }
    return;
  }

  if (kind === 'ice-candidate' && data) {
    if (state.pc && state.pc.remoteDescription) {
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(data));
      } catch (_) {}
    } else {
      state.pendingIceCandidates.push(data);
    }
    return;
  }

  if (kind === 'call-reject' || kind === 'call-hangup') {
    stopRingtone();
    el.incomingModal.classList.remove('incoming-backdrop');
    el.incomingModal.classList.add('hidden');
    state.pendingOffer = null;
    state.pendingIceCandidates = [];
    if (state.inCall) endCall(false);
  }
}

async function attachOrReplaceVideoStream(newStream, nextMode) {
  const newTrack = newStream.getVideoTracks()[0];
  if (!newTrack) return;

  const existingSender = state.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
  state.localVideoStream = newStream;
  el.localVideo.srcObject = newStream;

  if (existingSender) {
    await existingSender.replaceTrack(newTrack);
    await applyVideoBitrateLimits(state.pc, state.ecoMode480p);
    sendSignal('video-on-notify');
  } else {
    state.pc.addTrack(newTrack, newStream);
    await renegotiateCall();
  }

  state.videoMode = nextMode;
  updateCallUIState();
}

async function toggleLocalVideoMode(targetMode) {
  if (!state.inCall || !state.pc) return;

  if (state.videoMode === targetMode) {
    stopLocalVideoTrack();
    state.videoMode = 'off';
    updateCallUIState();
    sendSignal('video-off-notify');
    return;
  }

  // Libera câmera/vídeo anterior ANTES de abrir nova fonte (crucial no hardware Android J5)
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;

  try {
    if (targetMode === 'camera') {
      const camStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
      await attachOrReplaceVideoStream(camStream, 'camera');
      return;
    }

    if (targetMode === 'screen') {
      const canDisplay =
        navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';

      if (canDisplay) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } },
          audio: true
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        const screenAudioTrack = screenStream.getAudioTracks()[0];

        // Mistura áudio da tela com o microfone (voz continua ativa, sem cortes)
        if (screenAudioTrack && state.localAudioStream && state.pc) {
          try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const mixCtx = new Ctx();
            const dest = mixCtx.createMediaStreamDestination();
            mixCtx.createMediaStreamSource(new MediaStream([screenAudioTrack])).connect(dest);
            mixCtx.createMediaStreamSource(state.localAudioStream).connect(dest);
            const mixedTrack = dest.stream.getAudioTracks()[0];
            const audioSender = state.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
            if (audioSender) {
              state.screenMixCtx = mixCtx;
              await audioSender.replaceTrack(mixedTrack);
            } else {
              mixCtx.close();
            }
          } catch (_) {}
        }

        if (screenTrack) {
          screenTrack.onended = () => {
            if (state.videoMode === 'screen') {
              if (state.screenMixCtx) {
                try { state.screenMixCtx.close(); } catch (_) {}
                state.screenMixCtx = null;
                const audioSender = state.pc && state.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
                if (audioSender && state.localAudioStream) {
                  audioSender.replaceTrack(state.localAudioStream.getAudioTracks()[0]).catch(() => {});
                }
              }
              stopLocalVideoTrack();
              state.videoMode = 'off';
              updateCallUIState();
              sendSignal('video-off-notify');
            }
          };
        }
        await attachOrReplaceVideoStream(screenStream, 'screen');
        return;
      }

      // Fallback no celular antigo (sem getDisplayMedia): inicia transmissão pela câmera traseira
      state.facingMode = 'environment';
      const rearStream = await acquireCameraStream(state.ecoMode480p, 'environment', true);
      await attachOrReplaceVideoStream(rearStream, 'camera');
      showCallToast('Captura de tela externa indisponível no Android antigo — transmitindo pela câmera traseira ♡');
    }
  } catch (_) {
    state.videoMode = 'off';
    updateCallUIState();
    showCallToast('Não foi possível iniciar a transmissão.');
  }
}

function stopLocalVideoTrack() {
  if (state.pc) {
    const sender = state.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
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

  // Se a câmera estava desligada, o botão de virar já liga a câmera
  const nextFacing =
    state.videoMode === 'camera'
      ? state.facingMode === 'user'
        ? 'environment'
        : 'user'
      : 'environment';

  // IMPORTANTE NO ANDROID (Galaxy J5): parar a câmera atual ANTES de abrir a outra!
  stopStreamTracks(state.localVideoStream);
  state.localVideoStream = null;
  el.localVideo.srcObject = null;

  try {
    const newStream = await acquireCameraStream(state.ecoMode480p, nextFacing, true);
    state.facingMode = nextFacing;
    await attachOrReplaceVideoStream(newStream, 'camera');
    showCallToast(nextFacing === 'environment' ? 'Câmera traseira ativada' : 'Câmera frontal ativada');
  } catch (_) {
    // Tenta recuperar a câmera anterior se a troca falhar
    try {
      const fallbackStream = await acquireCameraStream(state.ecoMode480p, state.facingMode, false);
      await attachOrReplaceVideoStream(fallbackStream, 'camera');
    } catch (_) {
      state.videoMode = 'off';
      updateCallUIState();
    }
    showCallToast('Não foi possível alternar a câmera neste aparelho.');
  }
}

async function toggleEcoMode() {
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
  state.micMuted = !state.micMuted;
  state.localAudioStream.getAudioTracks().forEach((t) => {
    t.enabled = !state.micMuted;
  });
  showCallToast(state.micMuted ? 'Microfone mutado' : 'Microfone ativo');
  updateCallUIState();
}

function toggleSound() {
  state.soundMuted = !state.soundMuted;
  el.remoteAudio.muted = state.soundMuted;
  el.remoteVideo.muted = state.soundMuted;
  if (!state.soundMuted) {
    el.remoteAudio.volume = 1.0;
    el.remoteVideo.volume = 1.0;
    el.remoteAudio.play().catch(() => {});
    el.remoteVideo.play().catch(() => {});
  }
  showCallToast(state.soundMuted ? 'Áudio do parceiro silenciado' : 'Áudio do parceiro ativo');
  updateCallUIState();
}

function forcePlayRemoteMedia() {
  el.remoteAudio.muted = state.soundMuted;
  el.remoteVideo.muted = state.soundMuted;
  el.remoteAudio.volume = state.soundMuted ? 0 : 1.0;
  el.remoteVideo.volume = state.soundMuted ? 0 : 1.0;
  el.remoteAudio.play().catch(() => {});
  el.remoteVideo.play().catch(() => {});
}

function minimizeCallToChat() {
  if (!state.inCall) return;
  state.callMinimized = true;
  el.videoOverlay.classList.add('hidden');
  el.activeCallBanner.classList.remove('hidden');
}

function restoreCallOverlay() {
  if (!state.inCall) return;
  state.callMinimized = false;
  el.activeCallBanner.classList.add('hidden');
  el.videoOverlay.classList.remove('hidden');
}

function updateCallUIState() {
  const hasLocalVideo = state.videoMode !== 'off';
  el.localVideo.classList.toggle('hidden', !hasLocalVideo);
  el.localVideo.classList.toggle('mirrored', state.videoMode === 'camera' && state.facingMode === 'user');
  el.switchCamBtn.disabled = state.videoMode === 'screen';

  el.toggleMicBtn.classList.toggle('muted', state.micMuted);
  el.toggleSoundBtn.classList.toggle('muted-sound', state.soundMuted);
  el.toggleCamBtn.classList.toggle('active-feature', state.videoMode === 'camera');
  el.shareScreenBtn.classList.toggle('active-feature', state.videoMode === 'screen');
  manageWakeLock(hasLocalVideo);
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
  clearTimeout(state.ringTimeoutId);
  clearTimeout(state.callToastTimerId);
  clearTimeout(state.iceRestartTimerId);
  clearInterval(state.callTimerId);
  stopRingtone();
  if (state.screenMixCtx) {
    try { state.screenMixCtx.close(); } catch (_) {}
    state.screenMixCtx = null;
  }
  state.callTimerId = null;
  state.callSeconds = 0;

  if (notifyPeer && state.inCall) sendSignal('call-hangup');

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

  state.inCall = false;
  state.callMinimized = false;
  state.videoMode = 'off';
  state.pendingOffer = null;
  state.pendingIceCandidates = [];

  updateMediaSessionForCall(false);
  manageWakeLock(false);

  el.callToast.classList.add('hidden');
  el.videoOverlay.classList.add('hidden');
  el.activeCallBanner.classList.add('hidden');
  el.incomingModal.classList.remove('incoming-backdrop');
  el.incomingModal.classList.add('hidden');
}

// ============================================================================
// EVENTOS GLOBAIS E DE INTERFACE
// ============================================================================
function bindEvents() {
  el.loadOlderBtn.addEventListener('click', loadOlderMessages);

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

  // Fotos
  el.photoBtn.addEventListener('click', () => el.photoInput.click());
  el.photoInput.addEventListener('change', handlePhotoSelected);
  el.cancelPhotoBtn.addEventListener('click', closePhotoModal);
  el.confirmPhotoBtn.addEventListener('click', uploadAndSendPhoto);
  el.closeLightboxBtn.addEventListener('click', closeLightbox);
  el.lightboxModal.addEventListener('click', (e) => {
    if (e.target === el.lightboxModal) closeLightbox();
  });

  // Áudio
  el.recordBtn.addEventListener('click', startAudioRecording);
  el.cancelRecordBtn.addEventListener('click', cancelAudioRecording);
  el.sendRecordBtn.addEventListener('click', finishAudioRecording);

  // Ligação / Transmissão estilo Discord
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
  el.switchCamBtn.addEventListener('click', switchCamera);
  el.ecoModeBtn.addEventListener('click', toggleEcoMode);
  el.hangupBtn.addEventListener('click', () => endCall(true));

  // Sincroniza mensagens perdidas e marca como lidas ao voltar ao app
  document.addEventListener('visibilitychange', () => {
    if (!state.unlocked) return;
    if (document.visibilityState === 'visible') {
      updateMyDbStatus(true);
      syncMissedMessages();
      markAllVisibleUnreadAsRead();
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

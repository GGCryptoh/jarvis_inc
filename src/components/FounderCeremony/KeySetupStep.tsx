import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeyToLocalStorage,
  loadKeyFromLocalStorage,
  downloadKeyFile,
  type KeyFileData,
} from '../../lib/jarvisKey';
import { registerOnMarketplace, getMarketplaceStatus, signedMarketplacePost, cacheRawPrivateKey, getCachedRawPrivateKey, clearSigningCache, getUnlockDuration, setUnlockDuration, getSigningExpiry, MARKETPLACE_URL, type UnlockDuration, type RegisterResult } from '../../lib/marketplaceClient';

interface KeySetupStepProps {
  onComplete: () => void;
}

type Phase = 'existing' | 'intro' | 'form' | 'generating' | 'success';
type ExistingTab = 'profile' | 'key';

export default function KeySetupStep({ onComplete }: KeySetupStepProps) {
  // Check if key already exists — start on 'existing' phase if so
  const existingKey = loadKeyFromLocalStorage();
  const [phase, setPhase] = useState<Phase>(existingKey ? 'existing' : 'intro');
  const [existingTab, setExistingTab] = useState<ExistingTab>('profile');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [keyData, setKeyData] = useState<KeyFileData | null>(null);
  const [showCursor, setShowCursor] = useState(true);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [marketplaceResult, setMarketplaceResult] = useState<string | null>(null);
  const [registerPassword, setRegisterPassword] = useState('');
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [sessionUnlocked, setSessionUnlocked] = useState(!!getCachedRawPrivateKey());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockForm, setShowUnlockForm] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockDuration, setUnlockDurationState] = useState<UnlockDuration>(getUnlockDuration());
  const signingExpiry = getSigningExpiry();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [reregistering, setReregistering] = useState(false);

  // Avatar editor state
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveMsg, setProfileSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarColor, setAvatarColor] = useState('#50fa7b');
  const [avatarIcon, setAvatarIcon] = useState('bot');
  const [avatarBorder, setAvatarBorder] = useState('#ff79c6');
  const [profileNickname, setProfileNickname] = useState('');
  const [profileDescription, setProfileDescription] = useState('');

  const COLOR_SWATCHES = ['#50fa7b', '#ff79c6', '#8be9fd', '#ffb86c', '#bd93f9', '#f1fa8c', '#ff5555', '#f8f8f2'];
  const ICON_OPTIONS = [
    { id: 'bot', label: 'BT' },
    { id: 'cpu', label: 'CP' },
    { id: 'zap', label: 'ZP' },
    { id: 'star', label: 'ST' },
    { id: 'shield', label: 'SH' },
    { id: 'crown', label: 'CR' },
  ];

  // Load profile from marketplace on mount (when registered)
  const loadProfile = useCallback(async () => {
    const mStatus = getMarketplaceStatus();
    if (!mStatus.registered || !mStatus.instanceId) return;
    setProfileLoading(true);
    try {
      const res = await fetch(`${MARKETPLACE_URL}/api/profile/${mStatus.instanceId}`);
      if (res.ok) {
        const data = await res.json();
        const inst = data.instance;
        if (inst) {
          setAvatarColor(inst.avatar_color || '#50fa7b');
          setAvatarIcon(inst.avatar_icon || 'bot');
          setAvatarBorder(inst.avatar_border || '#ff79c6');
          setProfileNickname(inst.nickname || '');
          setProfileDescription(inst.description || '');
        }
      }
    } catch { /* silent — network error */ }
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSaveProfile() {
    const mStatus = getMarketplaceStatus();
    if (!mStatus.registered || !mStatus.instanceId) return;
    setProfileSaving(true);
    setProfileSaveMsg(null);
    const result = await signedMarketplacePost(`/api/profile/${mStatus.instanceId}`, {
      avatar_color: avatarColor,
      avatar_icon: avatarIcon,
      avatar_border: avatarBorder,
      nickname: profileNickname,
      description: profileDescription,
    });
    if (result.success) {
      setProfileSaveMsg({ ok: true, text: 'Profile updated.' });
    } else {
      setProfileSaveMsg({ ok: false, text: result.error || 'Update failed.' });
    }
    setProfileSaving(false);
    // Clear success message after 4s
    if (result.success) {
      setTimeout(() => setProfileSaveMsg(null), 4000);
    }
  }

  // Blinking cursor
  useEffect(() => {
    const interval = setInterval(() => setShowCursor((c) => !c), 530);
    return () => clearInterval(interval);
  }, []);

  // Fake progress during key generation (real work is async, progress is cosmetic)
  useEffect(() => {
    if (phase !== 'generating') return;
    const interval = setInterval(() => {
      setGenerationProgress((p) => {
        if (p >= 90) {
          clearInterval(interval);
          return 90;
        }
        return p + Math.random() * 15;
      });
    }, 120);
    return () => clearInterval(interval);
  }, [phase]);

  function validatePassword(): string | null {
    if (password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match';
    }
    return null;
  }

  async function handleGenerate() {
    const validationError = validatePassword();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setPhase('generating');
    setGenerationProgress(0);

    try {
      // Generate Ed25519 keypair
      const keyPair = await generateKeyPair();

      // Encrypt private key with master password
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, password);

      const fileData: KeyFileData = {
        publicKey: keyPair.publicKey,
        publicKeyHash: keyPair.publicKeyHash,
        encryptedPrivateKey,
        createdAt: new Date().toISOString(),
      };

      // Save to localStorage
      saveKeyToLocalStorage(fileData);

      // Cache raw key for browser-side skill handlers (CEO marketplace commands)
      // Auto-unlock forever during ceremony so founder never needs to manually unlock
      setUnlockDuration('forever');
      cacheRawPrivateKey(keyPair.privateKey);

      // Marketplace registration deferred to after CEO ceremony (so we have full instance data)
      // The raw key is cached above — registration happens in CEOCeremony or onboarding

      // Complete the progress animation
      setGenerationProgress(100);
      setKeyData(fileData);

      // Brief pause then show success
      setTimeout(() => setPhase('success'), 600);
    } catch (err) {
      console.error('Key generation failed:', err);
      setError(
        err instanceof Error
          ? `Key generation failed: ${err.message}`
          : 'Key generation failed. Your browser may not support Ed25519.',
      );
      setPhase('form');
    }
  }

  async function handleRegisterExisting() {
    if (!existingKey || !registerPassword) return;
    setRegistering(true);
    setRegisterError('');
    try {
      // Decrypt private key with master password
      const rawPrivateKey = await decryptPrivateKey(existingKey.encryptedPrivateKey, registerPassword);
      // Cache raw key for browser-side skill handlers (CEO marketplace commands)
      cacheRawPrivateKey(rawPrivateKey);
      // Register on marketplace
      const result = await registerOnMarketplace(rawPrivateKey, existingKey.publicKey);
      if (result.success) {
        setMarketplaceResult('registered');
        setShowRegisterForm(false);
        setRegisterPassword('');
      } else {
        setRegisterError(result.error || 'Registration failed');
      }
    } catch {
      setRegisterError('Wrong password or decryption failed');
    }
    setRegistering(false);
  }

  async function handleReregister() {
    if (!existingKey) return;
    const rawKey = getCachedRawPrivateKey();
    if (!rawKey) {
      setShowUnlockForm(true);
      return;
    }
    setReregistering(true);
    try {
      const result = await registerOnMarketplace(rawKey, existingKey.publicKey);
      if (result.success) {
        setMarketplaceResult('registered');
        setProfileSaveMsg({ ok: true, text: 'Re-registered with latest data.' });
        loadProfile(); // Reload profile from server
      } else {
        setProfileSaveMsg({ ok: false, text: result.error || 'Re-registration failed.' });
      }
    } catch {
      setProfileSaveMsg({ ok: false, text: 'Re-registration failed.' });
    }
    setReregistering(false);
    setTimeout(() => setProfileSaveMsg(null), 4000);
  }

  async function handleUnlockSession() {
    if (!existingKey || !unlockPassword) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      const rawPrivateKey = await decryptPrivateKey(existingKey.encryptedPrivateKey, unlockPassword);
      setUnlockDuration(unlockDuration); // Persist duration preference before caching key
      cacheRawPrivateKey(rawPrivateKey);
      setSessionUnlocked(true);
      setShowUnlockForm(false);
      setUnlockPassword('');
    } catch {
      setUnlockError('Wrong password');
    }
    setUnlocking(false);
  }

  function handleLockSession() {
    clearSigningCache();
    setSessionUnlocked(false);
  }

  function handleDurationChange(d: UnlockDuration) {
    setUnlockDurationState(d);
    if (sessionUnlocked) {
      // Already unlocked — just update the persistence
      setUnlockDuration(d);
    }
  }

  function handleDownload() {
    if (keyData) {
      downloadKeyFile(keyData);
      localStorage.setItem('jarvis-key-downloaded', 'true');
      setDownloaded(true);
    }
  }

  function handleImportKey() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as KeyFileData;
      if (!data.publicKey || !data.publicKeyHash || !data.encryptedPrivateKey || !data.createdAt) {
        setError('Invalid key file — missing required fields');
        return;
      }
      saveKeyToLocalStorage(data);
      setKeyData(data);
      // Reload to pick up the imported key
      window.location.reload();
    } catch {
      setError('Failed to read key file — must be valid JSON');
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Format the hash with spacing for readability
  function formatHash(hash: string): string {
    return hash.match(/.{1,8}/g)?.join(' ') ?? hash;
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[100] overflow-y-auto">
      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.04]"
        style={{
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)',
        }}
      />

      {/* Corner vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Hidden file input for key import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelected}
        className="hidden"
      />

      <div className="relative z-20 w-full max-w-2xl px-8 py-8 my-auto">
        {/* Phase: existing — key already generated — TABBED LAYOUT */}
        {phase === 'existing' && existingKey && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            {/* Header — always visible */}
            <div className="text-center mb-4">
              <div
                className="font-pixel text-2xl text-pixel-green tracking-wider mb-1"
                style={{ textShadow: '0 0 30px rgba(0,255,136,0.5), 0 0 60px rgba(0,255,136,0.2)' }}
              >
                IDENTITY ACTIVE
              </div>
              {/* Session signing status — compact inline */}
              <div className="flex items-center justify-center gap-3 mt-2">
                <span className={`w-2 h-2 rounded-full ${sessionUnlocked ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                <span className="font-pixel text-[8px] tracking-widest text-pixel-green/50">
                  {sessionUnlocked ? `SIGNING ${signingExpiry.label}` : 'SESSION LOCKED'}
                </span>
                {!sessionUnlocked ? (
                  <button
                    onClick={() => setShowUnlockForm(true)}
                    className="font-pixel text-[7px] tracking-wider px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    UNLOCK
                  </button>
                ) : (
                  <button
                    onClick={handleLockSession}
                    className="font-pixel text-[7px] tracking-wider px-2 py-0.5 rounded border border-red-500/30 text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  >
                    LOCK
                  </button>
                )}
              </div>
              {/* Unlock form — slides in below header */}
              {showUnlockForm && !sessionUnlocked && (
                <div className="mt-3 max-w-sm mx-auto border border-pixel-green/20 rounded-sm bg-black/80 p-3 animate-[fadeIn_0.3s_ease-out]">
                  {/* Duration selector */}
                  <div className="mb-3">
                    <div className="font-pixel text-[7px] text-pixel-green/40 tracking-wider mb-1.5">UNLOCK FOR</div>
                    <div className="flex gap-1">
                      {([
                        { val: 'session' as UnlockDuration, label: 'SESSION' },
                        { val: 'day' as UnlockDuration, label: '1 DAY' },
                        { val: 'week' as UnlockDuration, label: '1 WEEK' },
                        { val: 'month' as UnlockDuration, label: '1 MONTH' },
                        { val: 'forever' as UnlockDuration, label: 'FOREVER' },
                      ]).map(opt => (
                        <button
                          key={opt.val}
                          onClick={() => handleDurationChange(opt.val)}
                          className={`flex-1 font-pixel text-[6px] tracking-wider py-1 rounded-sm border transition-colors ${
                            unlockDuration === opt.val
                              ? opt.val === 'forever'
                                ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                                : 'border-pixel-green text-pixel-green bg-pixel-green/10'
                              : 'border-pixel-green/20 text-pixel-green/30 hover:text-pixel-green/50 hover:border-pixel-green/30'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {unlockDuration === 'forever' && (
                      <div className="font-pixel text-[6px] text-amber-400/60 tracking-wider mt-1">
                        Key stored in browser until manually locked
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(''); }}
                      placeholder="Master password"
                      autoFocus
                      className="flex-1 bg-black border border-pixel-green/30 text-pixel-green font-mono text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockSession(); }}
                    />
                    <button
                      onClick={handleUnlockSession}
                      disabled={!unlockPassword || unlocking}
                      className={`font-pixel text-[8px] tracking-wider px-3 py-2 rounded-sm border transition-colors ${
                        unlockPassword && !unlocking
                          ? 'border-pixel-green text-pixel-green hover:bg-pixel-green/10 cursor-pointer'
                          : 'border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                      }`}
                    >
                      {unlocking ? '...' : 'UNLOCK'}
                    </button>
                  </div>
                  {unlockError && (
                    <div className="font-pixel text-[8px] text-red-400 tracking-wider mt-2">{unlockError}</div>
                  )}
                </div>
              )}
              {/* Duration changer — when already unlocked */}
              {sessionUnlocked && (
                <div className="mt-2 flex items-center justify-center gap-1">
                  {([
                    { val: 'session' as UnlockDuration, label: 'SESSION' },
                    { val: 'day' as UnlockDuration, label: 'DAY' },
                    { val: 'week' as UnlockDuration, label: 'WEEK' },
                    { val: 'month' as UnlockDuration, label: 'MONTH' },
                    { val: 'forever' as UnlockDuration, label: '\u221E' },
                  ]).map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => handleDurationChange(opt.val)}
                      className={`font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded-sm border transition-colors ${
                        unlockDuration === opt.val
                          ? 'border-pixel-green/50 text-pixel-green bg-pixel-green/10'
                          : 'border-transparent text-pixel-green/20 hover:text-pixel-green/40'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tab bar */}
            <div className="flex gap-0 max-w-lg mx-auto w-full mb-4">
              {(['profile', 'key'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setExistingTab(tab)}
                  className={`flex-1 font-pixel text-[10px] tracking-[0.2em] py-2.5 border-2 transition-all duration-200 ${
                    existingTab === tab
                      ? 'bg-pixel-green/10 border-pixel-green text-pixel-green'
                      : 'bg-transparent border-pixel-green/20 text-pixel-green/40 hover:text-pixel-green/60 hover:border-pixel-green/30'
                  } ${tab === 'profile' ? 'rounded-l-sm' : 'rounded-r-sm border-l-0'}`}
                >
                  {tab === 'profile' ? 'PROFILE' : 'KEY'}
                </button>
              ))}
            </div>

            {/* Tab content — scrollable */}
            <div>
              {/* ═══════════════ PROFILE TAB ═══════════════ */}
              {existingTab === 'profile' && (
                <div className="animate-[fadeIn_0.3s_ease-out]">
                  {/* Marketplace status bar */}
                  {(() => {
                    const mStatus = marketplaceResult === 'registered'
                      ? { registered: true }
                      : getMarketplaceStatus();
                    return (
                      <div className="max-w-lg mx-auto mb-4">
                        <div className="flex items-center justify-between px-1 py-2 border border-pixel-green/20 rounded-sm bg-black/50">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${mStatus.registered ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            <span className="font-pixel text-[9px] tracking-widest text-pixel-green/60">MARKETPLACE</span>
                          </div>
                          {mStatus.registered ? (
                            <div className="flex items-center gap-2">
                              <a href={`${MARKETPLACE_URL}/gallery`} target="_blank" rel="noopener noreferrer"
                                className="font-mono text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                                REGISTERED
                              </a>
                              <button
                                onClick={handleReregister}
                                disabled={reregistering}
                                className={`font-pixel text-[7px] tracking-wider px-2 py-0.5 rounded border transition-colors ${
                                  reregistering
                                    ? 'border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                                    : 'border-pixel-cyan/40 text-pixel-cyan/70 hover:bg-pixel-cyan/10 hover:text-pixel-cyan cursor-pointer'
                                }`}
                              >
                                {reregistering ? 'SYNCING...' : 'SYNC'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={async () => {
                                // If key is already unlocked, register immediately
                                const rawKey = getCachedRawPrivateKey();
                                if (rawKey && existingKey) {
                                  setRegistering(true);
                                  try {
                                    const result = await registerOnMarketplace(rawKey, existingKey.publicKey);
                                    if (result.success) {
                                      setMarketplaceResult('registered');
                                    } else {
                                      setRegisterError(result.error || 'Registration failed');
                                      setShowRegisterForm(true);
                                    }
                                  } catch {
                                    setShowRegisterForm(true);
                                  }
                                  setRegistering(false);
                                } else {
                                  setShowRegisterForm(true);
                                }
                              }}
                              disabled={registering}
                              className={`font-pixel text-[8px] tracking-wider px-2 py-1 rounded border transition-colors ${
                                registering
                                  ? 'border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                                  : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                              }`}
                            >
                              {registering ? 'REGISTERING...' : 'REGISTER NOW'}
                            </button>
                          )}
                        </div>
                        {/* Register form */}
                        {showRegisterForm && !mStatus.registered && (
                          <div className="mt-3 border border-pixel-green/20 rounded-sm bg-black/80 p-4 animate-[fadeIn_0.3s_ease-out]">
                            <div className="font-pixel text-[9px] text-pixel-green/60 tracking-wider mb-2">
                              ENTER MASTER PASSWORD TO SIGN REGISTRATION
                            </div>
                            <div className="flex gap-2">
                              <input type="password" value={registerPassword}
                                onChange={(e) => { setRegisterPassword(e.target.value); setRegisterError(''); }}
                                placeholder="Master password" autoFocus
                                className="flex-1 bg-black border border-pixel-green/30 text-pixel-green font-mono text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRegisterExisting(); }}
                              />
                              <button onClick={handleRegisterExisting} disabled={!registerPassword || registering}
                                className={`font-pixel text-[8px] tracking-wider px-3 py-2 rounded-sm border transition-colors ${
                                  registerPassword && !registering
                                    ? 'border-pixel-green text-pixel-green hover:bg-pixel-green/10 cursor-pointer'
                                    : 'border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                                }`}>
                                {registering ? 'SIGNING...' : 'REGISTER'}
                              </button>
                            </div>
                            {registerError && (
                              <div className="font-pixel text-[8px] text-red-400 tracking-wider mt-2">{registerError}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Profile editor — only when registered */}
                  {(() => {
                    const pStatus = marketplaceResult === 'registered'
                      ? { registered: true }
                      : getMarketplaceStatus();
                    if (!pStatus.registered) return (
                      <div className="max-w-lg mx-auto text-center py-8">
                        <div className="font-pixel text-[10px] text-pixel-green/30 tracking-wider">
                          Register on the marketplace to edit your profile
                        </div>
                      </div>
                    );
                    return (
                      <div className="max-w-lg mx-auto">
                        {profileLoading ? (
                          <div className="text-center py-8 font-pixel text-[8px] text-pixel-green/40 animate-pulse tracking-wider">
                            LOADING PROFILE...
                          </div>
                        ) : (
                          <div className="border border-pixel-green/20 rounded-sm bg-black/50 p-4">
                            {/* Avatar preview */}
                            <div className="flex items-center gap-4 mb-5">
                              <div
                                className="w-14 h-14 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: `${avatarColor}26`, border: `2px solid ${avatarBorder}` }}
                              >
                                <span className="font-pixel text-xs font-bold" style={{ color: avatarColor }}>
                                  {ICON_OPTIONS.find(i => i.id === avatarIcon)?.label || 'BT'}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-pixel text-[11px] text-pixel-green/80 truncate">
                                  {profileNickname || 'No nickname'}
                                </div>
                                <div className="font-mono text-[10px] text-pixel-green/40 truncate">
                                  {profileDescription || 'No description'}
                                </div>
                              </div>
                            </div>

                            {/* Color pickers side-by-side */}
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div>
                                <div className="font-pixel text-[8px] text-pixel-green/40 tracking-wider mb-1.5">AVATAR COLOR</div>
                                <div className="flex gap-1.5 flex-wrap">
                                  {COLOR_SWATCHES.map(c => (
                                    <button key={`ac-${c}`} onClick={() => setAvatarColor(c)}
                                      className="w-6 h-6 rounded-full transition-all duration-150 cursor-pointer"
                                      style={{ backgroundColor: c, boxShadow: avatarColor === c ? `0 0 0 2px black, 0 0 0 3px ${c}` : 'none', opacity: avatarColor === c ? 1 : 0.5 }}
                                    />
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className="font-pixel text-[8px] text-pixel-green/40 tracking-wider mb-1.5">BORDER COLOR</div>
                                <div className="flex gap-1.5 flex-wrap">
                                  {COLOR_SWATCHES.map(c => (
                                    <button key={`bc-${c}`} onClick={() => setAvatarBorder(c)}
                                      className="w-6 h-6 rounded-full transition-all duration-150 cursor-pointer"
                                      style={{ backgroundColor: c, boxShadow: avatarBorder === c ? `0 0 0 2px black, 0 0 0 3px ${c}` : 'none', opacity: avatarBorder === c ? 1 : 0.5 }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Icon */}
                            <div className="mb-4">
                              <div className="font-pixel text-[8px] text-pixel-green/40 tracking-wider mb-1.5">ICON</div>
                              <div className="flex gap-2">
                                {ICON_OPTIONS.map(opt => (
                                  <button key={opt.id} onClick={() => setAvatarIcon(opt.id)}
                                    className={`w-8 h-8 rounded-sm flex items-center justify-center font-pixel text-[8px] transition-all duration-150 cursor-pointer border ${
                                      avatarIcon === opt.id
                                        ? 'border-pixel-green text-pixel-green bg-pixel-green/10'
                                        : 'border-pixel-green/20 text-pixel-green/40 hover:border-pixel-green/40'
                                    }`}>
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Nickname + Description */}
                            <div className="grid grid-cols-1 gap-3 mb-4">
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-pixel text-[8px] text-pixel-green/40 tracking-wider">NICKNAME</span>
                                  <span className="font-mono text-[7px] text-pixel-green/20">{profileNickname.length}/24</span>
                                </div>
                                <input type="text" value={profileNickname}
                                  onChange={(e) => setProfileNickname(e.target.value.substring(0, 24))} maxLength={24}
                                  placeholder="Max 24 characters"
                                  className="w-full bg-black border border-pixel-green/30 text-pixel-green font-mono text-xs px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40"
                                />
                              </div>
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-pixel text-[8px] text-pixel-green/40 tracking-wider">DESCRIPTION</span>
                                  <span className="font-mono text-[7px] text-pixel-green/20">{profileDescription.length}/200</span>
                                </div>
                                <input type="text" value={profileDescription}
                                  onChange={(e) => setProfileDescription(e.target.value.substring(0, 200))} maxLength={200}
                                  placeholder="Max 200 characters"
                                  className="w-full bg-black border border-pixel-green/30 text-pixel-green font-mono text-xs px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40"
                                />
                              </div>
                            </div>

                            {/* Save button + status */}
                            <div className="flex items-center gap-3">
                              <button onClick={handleSaveProfile} disabled={profileSaving}
                                className={`font-pixel text-[8px] tracking-wider px-4 py-2 rounded-sm border transition-all duration-200 ${
                                  profileSaving
                                    ? 'border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                                    : 'border-pixel-cyan/50 text-pixel-cyan hover:bg-pixel-cyan/10 hover:border-pixel-cyan/70 cursor-pointer'
                                }`}>
                                {profileSaving ? 'UPDATING...' : 'UPDATE PROFILE'}
                              </button>
                              {profileSaveMsg && (
                                <span className={`font-pixel text-[8px] tracking-wider ${profileSaveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {profileSaveMsg.text}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Done button */}
                  <div className="max-w-lg mx-auto mt-4">
                    <button onClick={onComplete}
                      className="w-full font-pixel text-[10px] tracking-[0.2em] py-3 rounded-sm border-2 bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer transition-all duration-300">
                      DONE {'\u25B6'}
                    </button>
                  </div>
                </div>
              )}

              {/* ═══════════════ KEY TAB ═══════════════ */}
              {existingTab === 'key' && (
                <div className="animate-[fadeIn_0.3s_ease-out]">
                  {/* Instance ID */}
                  <div className="border-2 border-pixel-green/40 bg-black/90 rounded-sm p-4 mb-4 max-w-lg mx-auto"
                    style={{ boxShadow: '0 0 30px rgba(0,255,136,0.08)' }}>
                    <div className="font-pixel text-[9px] text-pixel-green/50 tracking-widest mb-2">INSTANCE ID (SHA-256 HASH)</div>
                    <div className="font-mono text-sm text-pixel-cyan tracking-wider break-all leading-relaxed"
                      style={{ textShadow: '0 0 8px rgba(139,233,253,0.3)' }}>
                      {formatHash(existingKey.publicKeyHash)}
                    </div>
                    <button onClick={() => {
                      navigator.clipboard.writeText(existingKey.publicKeyHash);
                      setCopiedField('hash'); setTimeout(() => setCopiedField(null), 2000);
                    }} className="mt-2 font-pixel text-[7px] tracking-wider text-pixel-green/40 hover:text-pixel-green/70 transition-colors">
                      {copiedField === 'hash' ? '\u2713 COPIED' : 'COPY HASH'}
                    </button>
                  </div>

                  {/* Public Key — full + copyable */}
                  <div className="border border-pixel-green/20 bg-black/50 rounded-sm p-4 mb-4 max-w-lg mx-auto">
                    <div className="font-pixel text-[9px] text-pixel-green/50 tracking-widest mb-2">PUBLIC KEY (BASE64)</div>
                    <div className="font-mono text-xs text-pixel-green/70 break-all leading-relaxed">
                      {existingKey.publicKey}
                    </div>
                    <button onClick={() => {
                      navigator.clipboard.writeText(existingKey.publicKey);
                      setCopiedField('pubkey'); setTimeout(() => setCopiedField(null), 2000);
                    }} className="mt-2 font-pixel text-[7px] tracking-wider text-pixel-green/40 hover:text-pixel-green/70 transition-colors">
                      {copiedField === 'pubkey' ? '\u2713 COPIED' : 'COPY PUBLIC KEY'}
                    </button>
                  </div>

                  {/* Key details */}
                  <div className="max-w-lg mx-auto mb-4 space-y-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">ALGORITHM</span>
                      <span className="font-mono text-xs text-pixel-green/70">Ed25519</span>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">ENCRYPTION</span>
                      <span className="font-mono text-xs text-pixel-green/70">AES-256-GCM + PBKDF2</span>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">CREATED</span>
                      <span className="font-mono text-xs text-pixel-green/70">{new Date(existingKey.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 max-w-lg mx-auto mb-4">
                    <button onClick={() => { downloadKeyFile(existingKey); localStorage.setItem('jarvis-key-downloaded', 'true'); setDownloaded(true); }}
                      className={`flex-1 font-pixel text-[10px] tracking-[0.2em] py-3 rounded-sm border-2 transition-all duration-300 ${
                        downloaded
                          ? 'bg-pixel-green/5 border-pixel-green/30 text-pixel-green/50'
                          : 'bg-transparent border-pixel-cyan/40 text-pixel-cyan hover:bg-pixel-cyan/10 hover:border-pixel-cyan/60 cursor-pointer'
                      }`}>
                      {downloaded ? '\u2713 DOWNLOADED' : '\u2193 DOWNLOAD BACKUP'}
                    </button>
                    <button onClick={onComplete}
                      className="flex-1 font-pixel text-[10px] tracking-[0.2em] py-3 rounded-sm border-2 bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer transition-all duration-300">
                      DONE {'\u25B6'}
                    </button>
                  </div>

                  {/* Regenerate option */}
                  <div className="text-center">
                    <button onClick={() => setPhase('intro')}
                      className="font-pixel text-[8px] tracking-wider text-red-400/40 hover:text-red-400/70 transition-colors">
                      REGENERATE KEY (destroys current)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase: intro */}
        {phase === 'intro' && (
          <div className="animate-[fadeIn_0.8s_ease-out]">
            <div className="text-center mb-8">
              {/* Key icon in pixel style */}
              <div
                className="font-pixel text-5xl text-pixel-green mb-6 inline-block"
                style={{ textShadow: '0 0 20px rgba(0,255,136,0.4)' }}
              >
                {'\u26BF'}
              </div>
              <h1
                className="font-pixel text-2xl text-pixel-green tracking-wider mb-6"
                style={{ textShadow: '0 0 20px rgba(0,255,136,0.3), 0 0 40px rgba(0,255,136,0.1)' }}
              >
                CRYPTOGRAPHIC IDENTITY
              </h1>
            </div>

            {/* Terminal-style explanation */}
            <div
              className="border-2 border-pixel-green/30 bg-black/80 rounded-sm p-6 mb-8 max-w-lg mx-auto"
              style={{ boxShadow: '0 0 20px rgba(0,255,136,0.05)' }}
            >
              <div className="font-mono text-sm text-pixel-green/80 leading-relaxed space-y-3">
                <div className="text-pixel-green/50 text-xs tracking-widest mb-3">
                  {'>'} IDENTITY.SYS
                </div>
                <p>
                  Your Jarvis instance needs a cryptographic identity to participate in the
                  marketplace.
                </p>
                <p>
                  This keypair proves you are who you say you are when trading skills, sharing
                  intelligence, and coordinating with other instances.
                </p>
                <p className="text-pixel-yellow/80">
                  A master password will encrypt your private key. Choose something strong
                  &#8212; this cannot be recovered.
                </p>
              </div>
            </div>

            <div className="text-center space-y-3">
              <button
                onClick={() => setPhase('form')}
                className="font-pixel text-sm tracking-[0.3em] py-4 px-12 rounded-sm border-2 bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer transition-all duration-300"
              >
                GENERATE NEW
              </button>
              <div>
                <button
                  onClick={handleImportKey}
                  className="font-pixel text-[10px] tracking-[0.2em] py-3 px-8 rounded-sm border-2 border-pixel-cyan/30 text-pixel-cyan/70 hover:bg-pixel-cyan/10 hover:border-pixel-cyan/50 hover:text-pixel-cyan cursor-pointer transition-all duration-300"
                >
                  IMPORT EXISTING KEY
                </button>
              </div>
              {error && (
                <div className="font-pixel text-[10px] text-red-400 tracking-wider animate-[fadeIn_0.3s_ease-out]">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase: form */}
        {phase === 'form' && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h1
              className="font-pixel text-2xl text-pixel-green tracking-wider mb-8 text-center"
              style={{ textShadow: '0 0 20px rgba(0,255,136,0.3)' }}
            >
              SET MASTER PASSWORD
            </h1>

            <div className="space-y-6 max-w-md mx-auto">
              {/* Password */}
              <div>
                <label className="block font-pixel text-xs text-pixel-green/70 tracking-widest mb-2">
                  MASTER PASSWORD
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel text-sm text-pixel-green/40">
                    {'\u2588'}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="Min 8 characters"
                    autoFocus
                    className="w-full bg-black border-2 border-pixel-green/30 text-pixel-green font-pixel text-base tracking-wider px-7 py-3 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40 transition-colors"
                    style={{ textShadow: '0 0 4px rgba(0,255,136,0.3)' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        document.getElementById('confirm-password')?.focus();
                      }
                    }}
                  />
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block font-pixel text-xs text-pixel-green/70 tracking-widest mb-2">
                  CONFIRM PASSWORD
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel text-sm text-pixel-green/40">
                    {'\u2588'}
                  </span>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="Repeat password"
                    className="w-full bg-black border-2 border-pixel-green/30 text-pixel-green font-pixel text-base tracking-wider px-7 py-3 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/40 transition-colors"
                    style={{ textShadow: '0 0 4px rgba(0,255,136,0.3)' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleGenerate();
                    }}
                  />
                </div>
              </div>

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 flex-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className="h-1 flex-1 rounded-sm transition-colors duration-300"
                        style={{
                          backgroundColor:
                            password.length >= level * 4
                              ? level <= 1
                                ? '#ef4444'
                                : level <= 2
                                  ? '#f59e0b'
                                  : level <= 3
                                    ? '#50fa7b'
                                    : '#8be9fd'
                              : 'rgba(80, 250, 123, 0.15)',
                        }}
                      />
                    ))}
                  </div>
                  <span className="font-pixel text-[10px] text-pixel-green/50 tracking-wider">
                    {password.length < 8
                      ? 'WEAK'
                      : password.length < 12
                        ? 'OK'
                        : password.length < 16
                          ? 'STRONG'
                          : 'FORTRESS'}
                  </span>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="font-pixel text-[10px] text-red-400 tracking-wider text-center px-2 animate-[fadeIn_0.3s_ease-out]">
                  {error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!password || !confirmPassword}
                className={`w-full font-pixel text-sm tracking-[0.3em] py-4 rounded-sm border-2 transition-all duration-300 ${
                  password && confirmPassword
                    ? 'bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer'
                    : 'bg-transparent border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                }`}
              >
                {'\u26A1'} GENERATE IDENTITY
              </button>

              <p className="font-pixel text-[10px] text-pixel-green/30 text-center tracking-wider leading-relaxed">
                Your private key is encrypted locally.
                <br />
                If you lose the password, it cannot be recovered.
              </p>
            </div>
          </div>
        )}

        {/* Phase: generating */}
        {phase === 'generating' && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <h2
              className="font-pixel text-xl text-pixel-green tracking-[0.3em] mb-6"
              style={{ textShadow: '0 0 10px rgba(0,255,136,0.4)' }}
            >
              GENERATING KEYPAIR
            </h2>

            {/* Progress bar */}
            <div className="max-w-md mx-auto mb-4">
              <div className="w-full h-3 border border-pixel-green/40 rounded-sm overflow-hidden bg-black">
                <div
                  className="h-full bg-pixel-green transition-all duration-100"
                  style={{
                    width: `${Math.min(generationProgress, 100)}%`,
                    boxShadow: '0 0 10px rgba(0,255,136,0.5)',
                  }}
                />
              </div>
              <div className="font-pixel text-sm text-pixel-green/60 tracking-wider mt-2">
                {generationProgress < 30
                  ? 'Generating Ed25519 keypair...'
                  : generationProgress < 60
                    ? 'Deriving encryption key (PBKDF2)...'
                    : generationProgress < 90
                      ? 'Encrypting private key (AES-256-GCM)...'
                      : 'Finalizing...'}
              </div>
            </div>

            <div className="font-pixel text-base text-pixel-green/80 tracking-wider">
              {Math.round(Math.min(generationProgress, 100))}%
            </div>
          </div>
        )}

        {/* Phase: success */}
        {phase === 'success' && keyData && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <div className="text-center mb-6">
              <div
                className="font-pixel text-3xl text-pixel-green tracking-wider mb-2"
                style={{ textShadow: '0 0 30px rgba(0,255,136,0.5), 0 0 60px rgba(0,255,136,0.2)' }}
              >
                IDENTITY CREATED
              </div>
              <div className="font-pixel text-xs text-pixel-green/50 tracking-wider">
                Ed25519 keypair generated and encrypted
              </div>
            </div>

            {/* Instance ID display */}
            <div
              className="border-2 border-pixel-green/40 bg-black/90 rounded-sm p-5 mb-6 max-w-lg mx-auto"
              style={{ boxShadow: '0 0 30px rgba(0,255,136,0.08)' }}
            >
              <div className="font-pixel text-[10px] text-pixel-green/50 tracking-widest mb-3">
                YOUR JARVIS INSTANCE ID
              </div>
              <div
                className="font-mono text-sm text-pixel-cyan tracking-wider break-all leading-relaxed"
                style={{ textShadow: '0 0 8px rgba(139,233,253,0.3)' }}
              >
                {formatHash(keyData.publicKeyHash)}
              </div>
              <div className="mt-4 pt-3 border-t border-pixel-green/20">
                <div className="font-pixel text-[10px] text-pixel-green/40 tracking-wider leading-relaxed">
                  This hash is your Jarvis ID on the marketplace.
                  <br />
                  Your private key is encrypted and stored locally.
                </div>
              </div>
            </div>

            {/* Key details */}
            <div className="max-w-lg mx-auto mb-6 space-y-2">
              <div className="flex justify-between items-center px-1">
                <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">
                  ALGORITHM
                </span>
                <span className="font-mono text-xs text-pixel-green/70">Ed25519</span>
              </div>
              <div className="flex justify-between items-center px-1">
                <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">
                  ENCRYPTION
                </span>
                <span className="font-mono text-xs text-pixel-green/70">
                  AES-256-GCM + PBKDF2
                </span>
              </div>
              <div className="flex justify-between items-center px-1">
                <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">
                  STORAGE
                </span>
                <span className="font-mono text-xs text-pixel-green/70">
                  localStorage {downloaded ? '+ file' : ''}
                </span>
              </div>
              <div className="flex justify-between items-center px-1">
                <span className="font-pixel text-[10px] text-pixel-green/40 tracking-wider">
                  MARKETPLACE
                </span>
                <span className="font-mono text-xs text-pixel-green/40">
                  After CEO setup
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 max-w-lg mx-auto mb-6">
              <button
                onClick={handleDownload}
                className={`flex-1 font-pixel text-[10px] tracking-[0.2em] py-3 rounded-sm border-2 transition-all duration-300 ${
                  downloaded
                    ? 'bg-pixel-green/5 border-pixel-green/30 text-pixel-green/50'
                    : 'bg-transparent border-pixel-cyan/40 text-pixel-cyan hover:bg-pixel-cyan/10 hover:border-pixel-cyan/60 cursor-pointer'
                }`}
              >
                {downloaded ? '\u2713 DOWNLOADED' : '\u2193 DOWNLOAD BACKUP'}
              </button>

              <button
                onClick={onComplete}
                className="flex-1 font-pixel text-[10px] tracking-[0.2em] py-3 rounded-sm border-2 bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer transition-all duration-300"
              >
                CONTINUE {'\u25B6'}
              </button>
            </div>

            <p className="font-pixel text-[9px] text-pixel-green/25 text-center tracking-wider leading-relaxed max-w-lg mx-auto">
              Backup recommended. The key file can be imported later
              <br />
              if localStorage is cleared.
            </p>
          </div>
        )}

        {/* Blinking cursor at bottom (intro + form phases) */}
        {(phase === 'intro' || phase === 'form') && (
          <div className="text-center mt-8">
            <span
              className={`inline-block w-2 h-4 bg-pixel-green ${
                showCursor ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
        )}
      </div>

      {/* CSS for fadeIn */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

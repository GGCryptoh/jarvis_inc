import { useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, Loader2, AlertCircle, ArrowRight, ExternalLink, Key } from 'lucide-react';
import { getVaultEntryByService, saveVaultEntry, updateVaultEntry } from '../../lib/database';

interface GoogleOAuthWizardProps {
  skillId: string;
  skillName: string;
  vaultService: string;
  oauthConfig: { provider: string; auth_url: string; token_url: string; scopes: string[]; pkce?: boolean };
  onComplete: () => void;
  onClose: () => void;
}

export default function GoogleOAuthWizard({
  skillId,
  skillName,
  vaultService,
  oauthConfig,
  onComplete,
  onClose,
}: GoogleOAuthWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingClient, setExistingClient] = useState(false);

  const providerName = oauthConfig.provider ?? 'Google';
  const clientVaultService = `${providerName} OAuth Client`;
  const redirectUri = `${window.location.origin}/oauth/callback`;

  // Check for existing client credentials on mount — skip to step 3 if found
  useEffect(() => {
    (async () => {
      const entry = await getVaultEntryByService(clientVaultService);
      if (entry) {
        try {
          const creds = JSON.parse(entry.key_value);
          if (creds.client_id && creds.client_secret) {
            setClientId(creds.client_id);
            setClientSecret(creds.client_secret);
            setExistingClient(true);
            // Auto-skip to authorize step — credentials are already saved
            setStep(3);
          }
        } catch { /* not JSON — ignore */ }
      }
    })();
  }, [clientVaultService]);

  // Step 2: Save client credentials
  const handleSaveCredentials = useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setLoading(true);
    setError('');
    try {
      const value = JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() });
      const existing = await getVaultEntryByService(clientVaultService);
      if (existing) {
        await updateVaultEntry(existing.id, { key_value: value });
      } else {
        await saveVaultEntry({
          id: `vault-${Date.now()}`,
          service: clientVaultService,
          name: `${providerName} OAuth Client ID & Secret`,
          key_value: value,
          type: 'credential',
        });
      }
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Failed to save credentials');
    } finally {
      setLoading(false);
    }
  }, [clientId, clientSecret, clientVaultService, providerName]);

  // Step 3: Open OAuth popup and listen for callback
  const handleAuthorize = useCallback(async () => {
    setLoading(true);
    setError('');

    const params = new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: redirectUri,
      scope: oauthConfig.scopes.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `${oauthConfig.auth_url}?${params.toString()}`;
    const popup = window.open(authUrl, 'oauth-popup', 'width=600,height=700');

    // Listen for postMessage from popup
    const handler = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oauth-callback') return;
      window.removeEventListener('message', handler);

      if (event.data.error) {
        setError(`Authorization denied: ${event.data.error}`);
        setLoading(false);
        return;
      }

      const code = event.data.code;
      if (!code) {
        setError('No authorization code received');
        setLoading(false);
        return;
      }

      // Exchange code for tokens
      try {
        const resp = await fetch('/api/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            redirect_uri: redirectUri,
            token_url: oauthConfig.token_url,
          }),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({ error: resp.statusText }));
          throw new Error(errData.error_description || errData.error || `Token exchange failed: ${resp.status}`);
        }

        const tokenData = await resp.json();

        // Save tokens to vault
        const tokenValue = JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
        });

        const existingToken = await getVaultEntryByService(vaultService);
        if (existingToken) {
          await updateVaultEntry(existingToken.id, { key_value: tokenValue });
        } else {
          await saveVaultEntry({
            id: `vault-${Date.now()}`,
            service: vaultService,
            name: `${skillName} OAuth Token`,
            key_value: tokenValue,
            type: 'token',
          });
        }

        window.dispatchEvent(new Event('vault-changed'));
        setStep(4);
      } catch (err: any) {
        setError(err.message || 'Token exchange failed');
      } finally {
        setLoading(false);
      }
    };

    window.addEventListener('message', handler);

    // Check if popup was blocked
    if (!popup) {
      window.removeEventListener('message', handler);
      setError('Popup was blocked. Please allow popups for this site.');
      setLoading(false);
      return;
    }

    // Poll for popup close (user closed without completing)
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        // Give a moment for the message to arrive
        setTimeout(() => {
          setLoading(prev => {
            if (prev) {
              window.removeEventListener('message', handler);
              // Only set error if still loading (no callback received)
              setError('Authorization window was closed');
            }
            return false;
          });
        }, 500);
      }
    }, 500);
  }, [clientId, clientSecret, redirectUri, oauthConfig, vaultService, skillName]);

  const stepLabels = ['Setup', 'Credentials', 'Authorize', 'Done'];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className="bg-jarvis-surface border border-cyan-500/25 rounded-xl shadow-[0_0_40px_rgba(6,182,212,0.08)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-cyan-500/5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <Key size={18} className="text-cyan-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-jarvis-text tracking-wide">CONNECT {skillName.toUpperCase()}</h2>
                <p className="text-xs text-jarvis-muted mt-0.5">
                  Step {step} of 4 — {stepLabels[step - 1]}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-jarvis-muted hover:text-jarvis-text transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-jarvis-bg">
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {/* Step 1: Instructions */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-jarvis-text leading-relaxed">
                  To connect <span className="text-cyan-400 font-medium">{skillName}</span>, you need {providerName} Cloud OAuth credentials.
                </p>
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Go to{' '}
                      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline inline-flex items-center gap-1">
                        Google Cloud Console <ExternalLink size={10} />
                      </a>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Create or select a project, enable the relevant API (Gmail API, Calendar API, etc.)
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Create an <span className="text-jarvis-text font-medium">OAuth 2.0 Client ID</span> (Web application type)
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">4</span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Add this redirect URI:
                      <code className="block mt-1 bg-cyan-500/10 text-cyan-400 px-2 py-1 rounded text-xs font-mono break-all">
                        {redirectUri}
                      </code>
                    </span>
                  </li>
                </ol>
                {oauthConfig.scopes.length > 0 && (
                  <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
                    <p className="text-xs text-zinc-500 mb-1.5 font-semibold tracking-wider">REQUIRED SCOPES</p>
                    {oauthConfig.scopes.map(scope => (
                      <code key={scope} className="block text-[10px] text-zinc-400 font-mono break-all">{scope}</code>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Client Credentials */}
            {step === 2 && (
              <div className="space-y-4">
                {existingClient && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                    <CheckCircle size={14} className="text-cyan-400 flex-shrink-0" />
                    <span className="text-xs text-cyan-400">Existing {providerName} OAuth credentials found — update or keep them.</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-jarvis-muted uppercase tracking-wider mb-2">
                    CLIENT ID
                  </label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={e => { setClientId(e.target.value); setError(''); }}
                    placeholder="123456789-abc.apps.googleusercontent.com"
                    autoFocus
                    className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-jarvis-muted uppercase tracking-wider mb-2">
                    CLIENT SECRET
                  </label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={e => { setClientSecret(e.target.value); setError(''); }}
                    placeholder="GOCSPX-..."
                    className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                    <span className="text-xs text-red-400">{error}</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Authorize */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-jarvis-text leading-relaxed">
                  Click below to authorize Jarvis to access your <span className="text-cyan-400 font-medium">{skillName}</span> data.
                </p>
                <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <AlertCircle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-yellow-300 leading-relaxed">
                    <span className="font-semibold">Scope Notice:</span> This skill requests{' '}
                    <span className="font-medium">{oauthConfig.scopes?.some(s => s.includes('readonly')) ? 'read-only' : 'full'} access</span>.
                    {oauthConfig.scopes?.some(s => s.includes('readonly'))
                      ? ' Jarvis can only read data — it cannot send emails, create events, or modify anything.'
                      : ' Jarvis will have full read/write access. Only authorize this if you want Jarvis to take actions on your behalf.'}
                    {' '}In Google&apos;s consent screen, review the requested permissions before granting access.
                  </div>
                </div>
                <p className="text-xs text-jarvis-muted leading-relaxed">
                  A Google sign-in popup will open. After you grant access, the window will close automatically.
                </p>
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                    <span className="text-xs text-red-400">{error}</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Done */}
            {step === 4 && (
              <div className="space-y-4 text-center py-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/25 mx-auto">
                  <CheckCircle size={28} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-jarvis-text">Connected!</h3>
                  <p className="text-sm text-jarvis-muted mt-1">
                    <span className="text-cyan-400 font-medium">{skillName}</span> is ready to use.
                  </p>
                  <p className="text-xs text-zinc-500 mt-2">
                    Tokens will auto-refresh when they expire.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06] bg-jarvis-bg/50">
            <div>
              {step > 1 && step < 4 && (
                <button
                  onClick={() => { setError(''); setStep((step - 1) as any); }}
                  className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded-lg transition-colors"
                >
                  BACK
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {step !== 4 && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  CANCEL
                </button>
              )}

              {/* Step 1: Ready */}
              {step === 1 && (
                <button
                  onClick={() => setStep(existingClient ? 3 : 2)}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors"
                >
                  {existingClient ? 'SKIP TO AUTHORIZE' : 'READY'}
                  <ArrowRight size={14} />
                </button>
              )}

              {/* Step 2: Save credentials */}
              {step === 2 && (
                <button
                  onClick={handleSaveCredentials}
                  disabled={!clientId.trim() || !clientSecret.trim() || loading}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      SAVING...
                    </>
                  ) : (
                    <>
                      SAVE & CONTINUE
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              )}

              {/* Step 3: Authorize */}
              {step === 3 && (
                <button
                  onClick={handleAuthorize}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      WAITING FOR AUTH...
                    </>
                  ) : (
                    <>
                      <ExternalLink size={14} />
                      AUTHORIZE WITH {providerName.toUpperCase()}
                    </>
                  )}
                </button>
              )}

              {/* Step 4: Done */}
              {step === 4 && (
                <button
                  onClick={onComplete}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                >
                  <CheckCircle size={14} />
                  DONE
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const code = params.get('code');
  const error = params.get('error');

  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth-callback', code, error },
        window.location.origin,
      );
    }
  }, [code, error]);

  return (
    <div className="min-h-screen bg-jarvis-bg flex items-center justify-center text-white">
      <div className="text-center">
        <p className="text-lg">{error ? `Authorization failed: ${error}` : 'Authorization complete.'}</p>
        <p className="text-zinc-400 mt-2">You can close this window.</p>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-jarvis-surface/60 border border-jarvis-border/40 hover:bg-jarvis-surface hover:border-jarvis-border transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-pixel-green" />
        : <Copy className="w-3.5 h-3.5 text-jarvis-muted hover:text-jarvis-text" />
      }
    </button>
  );
}

import { useState, useMemo } from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';

interface WebPreviewProps {
  html: string;
  title?: string;
}

export default function WebPreview({ html, title }: WebPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  // For React/JSX code, wrap in a basic HTML template with React CDN
  const srcdoc = useMemo(() => {
    if (html.includes('<html') || html.includes('<!DOCTYPE')) return html;
    // Wrap bare HTML in a template
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:16px;color:#333}</style>
</head><body>${html}</body></html>`;
  }, [html]);

  const openInNewTab = () => {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(srcdoc);
      w.document.close();
    }
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 overflow-hidden my-3">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-700">
        <span className="font-pixel text-[8px] tracking-widest text-zinc-400">
          {title || 'HTML PREVIEW'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-300"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={openInNewTab}
            className="p-1 rounded hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-300"
            title="Open in new tab"
          >
            <ExternalLink size={12} />
          </button>
        </div>
      </div>
      <iframe
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        className={`w-full bg-white ${expanded ? 'h-[500px]' : 'h-[250px]'} transition-all`}
        title="Web Preview"
      />
    </div>
  );
}

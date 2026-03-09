import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
}

export default function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Lazy-load highlight.js
    import('highlight.js/lib/core').then(async (hljs) => {
      // Register common languages on demand
      const langMap: Record<string, () => Promise<{ default: unknown }>> = {
        python: () => import('highlight.js/lib/languages/python'),
        javascript: () => import('highlight.js/lib/languages/javascript'),
        typescript: () => import('highlight.js/lib/languages/typescript'),
        html: () => import('highlight.js/lib/languages/xml'),
        xml: () => import('highlight.js/lib/languages/xml'),
        css: () => import('highlight.js/lib/languages/css'),
        json: () => import('highlight.js/lib/languages/json'),
        bash: () => import('highlight.js/lib/languages/bash'),
        shell: () => import('highlight.js/lib/languages/shell'),
        sql: () => import('highlight.js/lib/languages/sql'),
        yaml: () => import('highlight.js/lib/languages/yaml'),
        markdown: () => import('highlight.js/lib/languages/markdown'),
        go: () => import('highlight.js/lib/languages/go'),
        rust: () => import('highlight.js/lib/languages/rust'),
        java: () => import('highlight.js/lib/languages/java'),
        cpp: () => import('highlight.js/lib/languages/cpp'),
        c: () => import('highlight.js/lib/languages/c'),
        ruby: () => import('highlight.js/lib/languages/ruby'),
        php: () => import('highlight.js/lib/languages/php'),
        swift: () => import('highlight.js/lib/languages/swift'),
        kotlin: () => import('highlight.js/lib/languages/kotlin'),
        r: () => import('highlight.js/lib/languages/r'),
        powershell: () => import('highlight.js/lib/languages/powershell'),
      };

      const lang = language.toLowerCase();
      const loader = langMap[lang];
      if (loader) {
        const mod = await loader();
        hljs.default.registerLanguage(lang, mod.default as Parameters<typeof hljs.default.registerLanguage>[1]);
      }

      if (codeRef.current) {
        hljs.default.highlightElement(codeRef.current);
      }
    });
  }, [code, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const extMap: Record<string, string> = {
      python: 'py', javascript: 'js', typescript: 'ts', html: 'html',
      css: 'css', json: 'json', bash: 'sh', shell: 'sh', sql: 'sql',
      yaml: 'yml', go: 'go', rust: 'rs', java: 'java', cpp: 'cpp',
      c: 'c', ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
      r: 'r', powershell: 'ps1', jsx: 'jsx', tsx: 'tsx',
    };
    const ext = extMap[language.toLowerCase()] || 'txt';
    const fname = filename || `code.${ext}`;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 overflow-hidden my-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-700">
        <span className="font-pixel text-[8px] tracking-widest text-zinc-400 uppercase">
          {language}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-300"
            title="Copy to clipboard"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1 rounded hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-300"
            title="Download file"
          >
            <Download size={12} />
          </button>
        </div>
      </div>
      {/* Code */}
      <div className="overflow-x-auto p-3">
        <pre className="text-[11px] leading-relaxed">
          <code ref={codeRef} className={`language-${language}`}>
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}

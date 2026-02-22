import { useState } from 'react';
import { ExternalLink, FileText, Table2, Image as ImageIcon, ArrowRight, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Content Detection
// ---------------------------------------------------------------------------

export interface DetectedContent {
  type: 'image' | 'link' | 'document' | 'collateral';
  url: string;
  label?: string;   // filename or domain
  mimeType?: string;
}

/** Extract domain from a URL for display */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Extract filename from a URL */
function extractFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? url;
  } catch {
    return url;
  }
}

const IMAGE_RE = /https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?/gi;
const DATA_IMAGE_RE = /data:image\/\S+/gi;
const DOCUMENT_RE = /https?:\/\/\S+\.(pdf|docx?|xlsx?|csv)(\?\S*)?/gi;
const GENERIC_URL_RE = /https?:\/\/\S+/gi;
const COLLATERAL_RE = /collateral/i;

/** Scan message text for rich content (images, docs, links, collateral references) */
export function detectRichContent(text: string): DetectedContent[] {
  const results: DetectedContent[] = [];
  const consumedRanges: Array<[number, number]> = [];

  // Utility: check if a match overlaps with already-consumed ranges
  const isConsumed = (start: number, end: number) =>
    consumedRanges.some(([s, e]) => start < e && end > s);
  const consume = (start: number, end: number) => consumedRanges.push([start, end]);

  // 1. Images (URL-based)
  let m: RegExpExecArray | null;
  IMAGE_RE.lastIndex = 0;
  while ((m = IMAGE_RE.exec(text)) !== null) {
    if (!isConsumed(m.index, m.index + m[0].length)) {
      consume(m.index, m.index + m[0].length);
      results.push({
        type: 'image',
        url: m[0],
        label: extractFilename(m[0]),
      });
    }
  }

  // 2. Data-URI images
  DATA_IMAGE_RE.lastIndex = 0;
  while ((m = DATA_IMAGE_RE.exec(text)) !== null) {
    if (!isConsumed(m.index, m.index + m[0].length)) {
      consume(m.index, m.index + m[0].length);
      results.push({
        type: 'image',
        url: m[0],
        label: 'Generated Image',
      });
    }
  }

  // 3. Documents
  DOCUMENT_RE.lastIndex = 0;
  while ((m = DOCUMENT_RE.exec(text)) !== null) {
    if (!isConsumed(m.index, m.index + m[0].length)) {
      consume(m.index, m.index + m[0].length);
      const filename = extractFilename(m[0]);
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      results.push({
        type: 'document',
        url: m[0],
        label: filename,
        mimeType: ext,
      });
    }
  }

  // 4. Generic links (anything not already captured)
  GENERIC_URL_RE.lastIndex = 0;
  while ((m = GENERIC_URL_RE.exec(text)) !== null) {
    if (!isConsumed(m.index, m.index + m[0].length)) {
      consume(m.index, m.index + m[0].length);
      const url = m[0];

      // Check if nearby text mentions collateral
      const vicinity = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      const isCollateral = COLLATERAL_RE.test(vicinity) || /\/collateral/.test(url);

      if (isCollateral) {
        results.push({
          type: 'collateral',
          url: url,
          label: 'Collateral',
        });
      } else {
        results.push({
          type: 'link',
          url: url,
          label: extractDomain(url),
        });
      }
    }
  }

  // 5. Collateral mention without URL -> link to /collateral
  if (!results.some(r => r.type === 'collateral') && COLLATERAL_RE.test(text)) {
    results.push({
      type: 'collateral',
      url: '/collateral',
      label: 'Collateral',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Card Components
// ---------------------------------------------------------------------------

/** Expandable image lightbox */
function ImageCard({ item }: { item: DetectedContent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        className="my-2 rounded-lg border border-zinc-700/50 bg-zinc-800/60 overflow-hidden cursor-pointer group/img"
        onClick={() => setExpanded(true)}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700/40 bg-zinc-900/40">
          <ImageIcon size={10} className="text-zinc-400" />
          <span className="font-pixel text-[9px] tracking-widest text-zinc-500">IMAGE</span>
        </div>
        <div className="p-2 flex items-center justify-center">
          <img
            src={item.url}
            alt={item.label ?? 'Image result'}
            className="max-w-[300px] max-h-[200px] rounded object-contain group-hover/img:opacity-80 transition-opacity"
            loading="lazy"
          />
        </div>
        {item.label && item.label !== 'Generated Image' && (
          <div className="px-3 py-1.5 border-t border-zinc-700/30">
            <span className="font-pixel text-[8px] tracking-wider text-zinc-600 truncate block">
              {item.label}
            </span>
          </div>
        )}
      </div>

      {/* Lightbox overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
          <img
            src={item.url}
            alt={item.label ?? 'Image result'}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}

/** External link card */
function LinkCard({ item }: { item: DetectedContent }) {
  return (
    <div className="my-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <ExternalLink size={12} className="text-emerald-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-emerald-300 truncate">
            {item.label}
          </div>
          <div className="font-pixel text-[8px] tracking-wider text-zinc-600 truncate mt-0.5">
            {item.url.length > 60 ? item.url.slice(0, 60) + '...' : item.url}
          </div>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 font-pixel text-[9px] tracking-widest text-emerald-400 px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
        >
          OPEN
        </a>
      </div>
    </div>
  );
}

/** Document file card */
function DocumentCard({ item }: { item: DetectedContent }) {
  const ext = item.mimeType ?? '';
  const isSpreadsheet = ['xls', 'xlsx', 'csv'].includes(ext);
  const DocIcon = isSpreadsheet ? Table2 : FileText;

  return (
    <div className="my-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <DocIcon size={12} className="text-cyan-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-cyan-300 truncate">
            {item.label}
          </div>
          <div className="font-pixel text-[8px] tracking-wider text-zinc-600 uppercase mt-0.5">
            {ext || 'DOCUMENT'}
          </div>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 font-pixel text-[9px] tracking-widest text-cyan-400 px-3 py-1.5 rounded border border-cyan-400/30 bg-cyan-400/10 hover:bg-cyan-400/20 transition-colors"
        >
          OPEN
        </a>
      </div>
    </div>
  );
}

/** Collateral CTA card */
function CollateralCard({ item }: { item: DetectedContent }) {
  const href = item.url.startsWith('/') ? item.url : '/collateral';

  return (
    <div className="my-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <FileText size={12} className="text-amber-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-amber-300">
            COLLATERAL
          </div>
        </div>
        <a
          href={href}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 flex-shrink-0 font-pixel text-[9px] tracking-widest text-amber-400 px-3 py-1.5 rounded border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-colors"
        >
          VIEW IN COLLATERAL
          <ArrowRight size={10} />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RichResultCard — dispatches to the correct sub-card
// ---------------------------------------------------------------------------

interface RichResultCardProps {
  item: DetectedContent;
}

export default function RichResultCard({ item }: RichResultCardProps) {
  switch (item.type) {
    case 'image':
      return <ImageCard item={item} />;
    case 'link':
      return <LinkCard item={item} />;
    case 'document':
      return <DocumentCard item={item} />;
    case 'collateral':
      return <CollateralCard item={item} />;
    default:
      return null;
  }
}

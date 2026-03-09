interface SpeechBubbleProps {
  text: string;
  /** Position as % coordinates (matches sprite positioning) */
  position: { x: number; y: number };
  visible: boolean;
}

export default function SpeechBubble({ text, position, visible }: SpeechBubbleProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute z-[15] pointer-events-none"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -100%) translateY(-60px)',
      }}
    >
      {/* Bubble */}
      <div
        className="px-3 py-2 rounded-sm font-pixel text-[7px] tracking-wider text-pixel-green whitespace-nowrap"
        style={{
          background: 'rgba(26, 26, 46, 0.95)',
          border: '2px solid #3a3a5a',
          boxShadow: '0 0 12px rgba(0,255,136,0.15), 2px 2px 0 rgba(0,0,0,0.4)',
          textShadow: '0 0 4px rgba(80,250,123,0.4)',
        }}
      >
        {text}
      </div>
      {/* Tail — pixel-style 3 descending dots */}
      <div className="flex flex-col items-center gap-[2px] mt-[2px]">
        <div className="w-[4px] h-[4px] rounded-[1px] bg-[#3a3a5a]" />
        <div className="w-[3px] h-[3px] rounded-[1px] bg-[#3a3a5a]" />
        <div className="w-[2px] h-[2px] rounded-[1px] bg-[#3a3a5a]" />
      </div>
    </div>
  );
}

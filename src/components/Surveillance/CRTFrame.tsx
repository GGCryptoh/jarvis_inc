interface CRTFrameProps {
  children: React.ReactNode;
}

export default function CRTFrame({ children }: CRTFrameProps) {
  return (
    <div className="relative flex-1 rounded-lg border-4 border-pixel-crt-border bg-black overflow-hidden shadow-[inset_0_0_60px_rgba(0,255,136,0.05)]">
      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
        style={{
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />

      {/* Screen content */}
      <div className="relative z-0 h-full bg-pixel-bg p-2 animate-screen-flicker">
        {children}
      </div>

      {/* Corner vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-20 rounded-lg"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)',
        }}
      />
    </div>
  );
}

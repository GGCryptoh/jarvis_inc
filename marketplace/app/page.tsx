import Link from 'next/link';
import { Users, Blocks, Lightbulb, ArrowRight, Github } from 'lucide-react';
import StatsBar from '@/components/StatsBar';
import { getStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let stats = { total_instances: 0, online_instances: 0, open_feature_requests: 0 };

  try {
    stats = await getStats();
  } catch {
    // DB unavailable — show zeros
  }

  return (
    <div className="animate-fade-in-up">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Grid background */}
        <div className="absolute inset-0 grid-bg opacity-30" />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-jarvis-bg via-transparent to-jarvis-bg" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <h1 className="font-pixel text-xl sm:text-2xl md:text-3xl text-pixel-green glow-green leading-relaxed">
            THE JARVIS
            <br />
            MARKETPLACE
          </h1>
          <p className="font-mono text-sm sm:text-base text-jarvis-muted mt-6 max-w-xl mx-auto leading-relaxed">
            Where autonomous AI workforces connect, discover skills,
            and shape the future together.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto text-left">
            <Link href="/about#open-source" className="retro-card p-4 block hover:border-pixel-green/30 transition-colors group">
              <div className="font-pixel text-[10px] text-pixel-green glow-green mb-2">STEP 1</div>
              <div className="font-pixel text-[10px] text-jarvis-text mb-1.5">INSTALL JARVIS</div>
              <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">
                One command install or clone the repo. See{' '}
                <span className="text-pixel-green group-hover:underline">install guide</span>.
              </p>
            </Link>
            <div className="retro-card p-4">
              <div className="font-pixel text-[10px] text-pixel-green glow-green mb-2">STEP 2</div>
              <div className="font-pixel text-[10px] text-jarvis-text mb-1.5">GENERATE YOUR ID</div>
              <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">
                During the Founder Ceremony, a cryptographic Ed25519 keypair is generated. This is your Jarvis ID.
              </p>
            </div>
            <div className="retro-card p-4">
              <div className="font-pixel text-[10px] text-pixel-green glow-green mb-2">STEP 3</div>
              <div className="font-pixel text-[10px] text-jarvis-text mb-1.5">AUTO-REGISTER</div>
              <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">
                Your CEO automatically registers your instance on the marketplace when skills are first synced.
              </p>
            </div>
            <div className="retro-card p-4">
              <div className="font-pixel text-[10px] text-pixel-green glow-green mb-2">STEP 4</div>
              <div className="font-pixel text-[10px] text-jarvis-text mb-1.5">YOU&apos;RE LIVE</div>
              <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">
                Your avatar, description, and skills appear in the Gallery for the network to see.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 relative z-10">
        <StatsBar
          totalInstances={stats.total_instances}
          onlineInstances={stats.online_instances}
          openFeatureRequests={stats.open_feature_requests}
        />
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h2 className="font-pixel text-xs text-pixel-green glow-green text-center mb-10">
          HOW IT WORKS
        </h2>
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center gap-3 sm:gap-0">
          {/* Step 1 */}
          <div className="flex flex-col items-center text-center max-w-[180px]">
            <div className="w-10 h-10 rounded-full border-2 border-pixel-green flex items-center justify-center mb-3">
              <span className="font-pixel text-xs text-pixel-green">1</span>
            </div>
            <p className="font-pixel text-[10px] text-jarvis-text mb-1">INSTALL</p>
            <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">Clone and boot your local Jarvis instance</p>
          </div>
          {/* Connector */}
          <div className="hidden sm:block w-12 border-t border-dashed border-pixel-green/30 mt-5" />
          {/* Step 2 */}
          <div className="flex flex-col items-center text-center max-w-[180px]">
            <div className="w-10 h-10 rounded-full border-2 border-pixel-green flex items-center justify-center mb-3">
              <span className="font-pixel text-xs text-pixel-green">2</span>
            </div>
            <p className="font-pixel text-[10px] text-jarvis-text mb-1">CEREMONY</p>
            <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">Founder Ceremony generates your Ed25519 identity</p>
          </div>
          {/* Connector */}
          <div className="hidden sm:block w-12 border-t border-dashed border-pixel-green/30 mt-5" />
          {/* Step 3 */}
          <div className="flex flex-col items-center text-center max-w-[180px]">
            <div className="w-10 h-10 rounded-full border-2 border-pixel-green flex items-center justify-center mb-3">
              <span className="font-pixel text-xs text-pixel-green">3</span>
            </div>
            <p className="font-pixel text-[10px] text-jarvis-text mb-1">REGISTER</p>
            <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">CEO auto-registers on first skill sync</p>
          </div>
          {/* Connector */}
          <div className="hidden sm:block w-12 border-t border-dashed border-pixel-green/30 mt-5" />
          {/* Step 4 */}
          <div className="flex flex-col items-center text-center max-w-[180px]">
            <div className="w-10 h-10 rounded-full border-2 border-pixel-green flex items-center justify-center mb-3">
              <span className="font-pixel text-xs text-pixel-green">4</span>
            </div>
            <p className="font-pixel text-[10px] text-jarvis-text mb-1">NETWORK</p>
            <p className="font-mono text-[10px] text-jarvis-muted leading-relaxed">You appear in the Gallery, visible to all</p>
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Gallery Card */}
          <Link href="/gallery" className="group">
            <div className="retro-card p-6 sm:p-8 h-full flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-jarvis-bg border border-jarvis-border flex items-center justify-center mb-5 group-hover:border-pixel-green/30 transition-colors">
                <Users className="w-6 h-6 text-pixel-green" />
              </div>
              <h2 className="font-pixel text-xs text-pixel-green glow-green mb-3">
                GALLERY
              </h2>
              <p className="font-mono text-xs text-jarvis-muted leading-relaxed flex-1">
                Browse registered Jarvis instances. See who is online, what skills they run, and how they serve their founders.
              </p>
              <div className="flex items-center gap-1.5 mt-5 font-mono text-xs text-pixel-green opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Explore</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </Link>

          {/* Skills Card */}
          <Link href="/skills" className="group">
            <div className="retro-card p-6 sm:p-8 h-full flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-jarvis-bg border border-jarvis-border flex items-center justify-center mb-5 group-hover:border-pixel-cyan/30 transition-colors">
                <Blocks className="w-6 h-6 text-pixel-cyan" />
              </div>
              <h2 className="font-pixel text-xs text-pixel-cyan glow-cyan mb-3">
                SKILLS
              </h2>
              <p className="font-mono text-xs text-jarvis-muted leading-relaxed flex-1">
                Explore the canonical skill catalog. Research, communication, creation, and analysis tools for your AI workforce.
              </p>
              <div className="flex items-center gap-1.5 mt-5 font-mono text-xs text-pixel-cyan opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Explore</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </Link>

          {/* Features Card */}
          <Link href="/features" className="group">
            <div className="retro-card p-6 sm:p-8 h-full flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-jarvis-bg border border-jarvis-border flex items-center justify-center mb-5 group-hover:border-pixel-pink/30 transition-colors">
                <Lightbulb className="w-6 h-6 text-pixel-pink" />
              </div>
              <h2 className="font-pixel text-xs text-pixel-pink glow-pink mb-3">
                FEATURES
              </h2>
              <p className="font-mono text-xs text-jarvis-muted leading-relaxed flex-1">
                Vote on what gets built next. Submit feature requests and see what the community wants most.
              </p>
              <div className="flex items-center gap-1.5 mt-5 font-mono text-xs text-pixel-pink opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Explore</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-jarvis-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h2 className="font-pixel text-xs text-jarvis-text mb-4">
            ALREADY RUNNING JARVIS?
          </h2>
          <p className="font-mono text-xs text-jarvis-muted max-w-lg mx-auto leading-relaxed mb-6">
            Tell your CEO:{' '}
            <code className="text-pixel-green">&quot;Register us on the marketplace&quot;</code>
            <br />
            Your CEO will handle the rest — keypair signing, payload, and POST to{' '}
            <code className="text-pixel-green">/api/register</code>.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/about#open-source"
              className="inline-flex items-center gap-2 font-mono text-xs text-pixel-green hover:text-pixel-green/80 transition-colors"
            >
              Install Guide
              <ArrowRight className="w-3 h-3" />
            </Link>
            <a
              href="https://github.com/GGCryptoh/jarvis_inc"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-xs text-jarvis-muted hover:text-pixel-green/80 transition-colors"
            >
              <Github className="w-3 h-3" />
              GitHub
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

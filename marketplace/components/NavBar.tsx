'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Cpu, Shield } from 'lucide-react';
import SoundToggle, { isSoundEnabled } from '@/components/SoundToggle';
import { playNotificationDing } from '@/lib/sounds';

const NAV_LINKS = [
  { href: '/gallery', label: 'Gallery' },
  { href: '/skills', label: 'Skills' },
  { href: '/features', label: 'Features', countKey: 'features' as const },
  { href: '/forum', label: 'Forum', countKey: 'forum' as const },
  { href: '/screenshots', label: 'Screenshots' },
  { href: '/about', label: 'About' },
];

type CountKey = 'forum' | 'features';

const STORAGE_PREFIX = 'nav_last_seen_';

function getLastSeen(key: CountKey): number {
  try {
    return parseInt(localStorage.getItem(`${STORAGE_PREFIX}${key}`) || '0', 10);
  } catch { return 0; }
}

function setLastSeen(key: CountKey, count: number) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(count));
  } catch { /* ignore */ }
}

export default function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [badges, setBadges] = useState<Record<CountKey, number>>({ forum: 0, features: 0 });
  const prevBadgesRef = useRef<Record<CountKey, number>>({ forum: 0, features: 0 });

  // Check for admin key in localStorage
  useEffect(() => {
    const check = () => setIsAdmin(!!localStorage.getItem('marketplace_admin_key'));
    check();
    window.addEventListener('admin-auth-changed', check);
    return () => window.removeEventListener('admin-auth-changed', check);
  }, []);

  // Fetch stats for badge counts
  const fetchBadges = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const stats = await res.json();

      const totalForumPosts = (stats.forum?.posts ?? 0) + (stats.forum?.replies ?? 0);
      const openFeatures = stats.feature_requests?.open ?? 0;

      const lastSeenForum = getLastSeen('forum');
      const lastSeenFeatures = getLastSeen('features');

      const newBadges = {
        forum: Math.max(0, totalForumPosts - lastSeenForum),
        features: Math.max(0, openFeatures - lastSeenFeatures),
      };

      // Play ding if counts increased
      const prev = prevBadgesRef.current;
      if (
        (newBadges.forum > prev.forum || newBadges.features > prev.features) &&
        isSoundEnabled()
      ) {
        playNotificationDing();
      }
      prevBadgesRef.current = newBadges;

      setBadges(newBadges);
    } catch { /* stats unavailable */ }
  }, []);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchBadges]);

  // Mark as seen when navigating to a section
  useEffect(() => {
    const markSeen = async () => {
      let key: CountKey | null = null;
      if (pathname === '/forum' || pathname?.startsWith('/forum/')) key = 'forum';
      if (pathname === '/features' || pathname?.startsWith('/features/')) key = 'features';
      if (!key) return;

      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const stats = await res.json();

        if (key === 'forum') {
          setLastSeen('forum', (stats.forum?.posts ?? 0) + (stats.forum?.replies ?? 0));
        } else {
          setLastSeen('features', stats.feature_requests?.open ?? 0);
        }

        setBadges(prev => ({ ...prev, [key]: 0 }));
      } catch { /* ignore */ }
    };
    markSeen();
  }, [pathname]);

  const allLinks = isAdmin
    ? [...NAV_LINKS, { href: '/admin', label: 'Admin' }]
    : NAV_LINKS;

  return (
    <nav className="sticky top-0 z-50 bg-jarvis-bg/90 backdrop-blur-sm border-b border-jarvis-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-3 group"
          >
            <div className="w-8 h-8 rounded bg-pixel-green/10 border border-pixel-green/30 flex items-center justify-center group-hover:bg-pixel-green/20 transition-colors">
              <Cpu className="w-4 h-4 text-pixel-green" />
            </div>
            <span className="font-pixel text-[10px] sm:text-xs text-pixel-green tracking-wider glow-green">
              JARVIS MARKETPLACE
            </span>
          </Link>

          {/* Desktop Links + Sound Toggle */}
          <div className="hidden md:flex items-center gap-8">
            {allLinks.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              const isAdminLink = link.href === '/admin';
              const countKey = 'countKey' in link ? (link as { countKey: CountKey }).countKey : null;
              const badgeCount = countKey ? badges[countKey] : 0;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative font-mono text-sm tracking-wide transition-colors duration-200 pb-1 flex items-center gap-1.5 ${
                    isActive
                      ? isAdminLink ? 'text-pixel-pink' : 'text-pixel-green'
                      : isAdminLink
                        ? 'text-pixel-pink/60 hover:text-pixel-pink'
                        : 'text-jarvis-muted hover:text-jarvis-text'
                  }`}
                >
                  {isAdminLink && <Shield className="w-3.5 h-3.5" />}
                  {link.label}
                  {badgeCount > 0 && !isActive && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-pixel-green/20 text-pixel-green border border-pixel-green/40 leading-none">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                  {isActive && (
                    <span className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full ${
                      isAdminLink ? 'bg-pixel-pink' : 'bg-pixel-green'
                    }`} />
                  )}
                </Link>
              );
            })}
            <SoundToggle />
          </div>

          {/* Mobile: Sound Toggle + Hamburger */}
          <div className="md:hidden flex items-center gap-2">
            <SoundToggle />
            <button
              className="p-2 text-jarvis-muted hover:text-jarvis-text transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-jarvis-border bg-jarvis-surface">
          <div className="px-4 py-3 space-y-1">
            {allLinks.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              const isAdminLink = link.href === '/admin';
              const countKey = 'countKey' in link ? (link as { countKey: CountKey }).countKey : null;
              const badgeCount = countKey ? badges[countKey] : 0;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded font-mono text-sm transition-colors ${
                    isActive
                      ? isAdminLink ? 'text-pixel-pink bg-pixel-pink/5' : 'text-pixel-green bg-pixel-green/5'
                      : isAdminLink
                        ? 'text-pixel-pink/60 hover:text-pixel-pink hover:bg-jarvis-bg'
                        : 'text-jarvis-muted hover:text-jarvis-text hover:bg-jarvis-bg'
                  }`}
                >
                  {isAdminLink && <Shield className="w-3.5 h-3.5" />}
                  {link.label}
                  {badgeCount > 0 && !isActive && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-pixel-green/20 text-pixel-green border border-pixel-green/40 leading-none ml-auto">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}

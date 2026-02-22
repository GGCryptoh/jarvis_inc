'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Cpu, Shield } from 'lucide-react';

const NAV_LINKS = [
  { href: '/gallery', label: 'Gallery' },
  { href: '/skills', label: 'Skills' },
  { href: '/features', label: 'Features' },
  { href: '/forum', label: 'Forum' },
  { href: '/about', label: 'About' },
];

export default function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check for admin key in localStorage
  useEffect(() => {
    const check = () => setIsAdmin(!!localStorage.getItem('marketplace_admin_key'));
    check();
    window.addEventListener('admin-auth-changed', check);
    return () => window.removeEventListener('admin-auth-changed', check);
  }, []);

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

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-8">
            {allLinks.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              const isAdminLink = link.href === '/admin';
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
                  {isActive && (
                    <span className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full ${
                      isAdminLink ? 'bg-pixel-pink' : 'bg-pixel-green'
                    }`} />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Mobile Hamburger */}
          <button
            className="md:hidden p-2 text-jarvis-muted hover:text-jarvis-text transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-jarvis-border bg-jarvis-surface">
          <div className="px-4 py-3 space-y-1">
            {allLinks.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              const isAdminLink = link.href === '/admin';
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
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}

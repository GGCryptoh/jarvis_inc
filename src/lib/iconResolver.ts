/**
 * Icon Resolver — Maps icon name strings to Lucide React components
 * ==================================================================
 * Shared between all components that need to render skill icons.
 * Skill JSON stores icon as a string (e.g. "Globe"), this converts
 * to the actual React component.
 */

import {
  Mail, Send, Image, Sparkles, Globe, MessageCircle, FileText, Code, BarChart3,
  Calendar, Search, Rss, Monitor, ScanSearch, Video, Eye, BookOpen,
  Languages, Blocks, CloudRain, Terminal, Twitter, Network, ServerCrash,
  Cpu, Shield,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  Mail, Send, Image, Sparkles, Globe, MessageCircle, FileText, Code, BarChart3,
  Calendar, Search, Rss, Monitor, ScanSearch, Video, Eye, BookOpen,
  Languages, Blocks, CloudRain, Terminal, Twitter, Network, ServerCrash,
  Cpu, Shield,
};

/**
 * Resolve an icon name string to a Lucide React component.
 * Returns Blocks as fallback for unknown icon names.
 */
export function resolveIcon(iconName: string): React.ElementType {
  return ICON_MAP[iconName] ?? Blocks;
}

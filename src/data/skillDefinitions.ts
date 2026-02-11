import {
  Mail,
  Send,
  Image,
  Twitter,
  Globe,
  MessageCircle,
  FileText,
  Code,
  BarChart3,
  Calendar,
  Search,
  Rss,
} from 'lucide-react';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  category: 'communication' | 'research' | 'creation' | 'analysis';
  status: 'available' | 'coming_soon';
  serviceType: 'llm' | 'fixed';
  fixedService?: string;
  defaultModel?: string;
}

export const skills: SkillDefinition[] = [
  // Communication
  {
    id: 'read-email',
    name: 'Read Email',
    description: 'Read and parse incoming emails from connected accounts',
    icon: Mail,
    category: 'communication',
    status: 'available',
    serviceType: 'fixed',
    fixedService: 'Google',
  },
  {
    id: 'write-email',
    name: 'Write Email',
    description: 'Compose and send emails on behalf of agents',
    icon: Send,
    category: 'communication',
    status: 'available',
    serviceType: 'fixed',
    fixedService: 'Google',
  },
  {
    id: 'send-slack',
    name: 'Send Slack Message',
    description: 'Post messages and updates to Slack channels',
    icon: MessageCircle,
    category: 'communication',
    status: 'coming_soon',
    serviceType: 'fixed',
  },
  {
    id: 'schedule-meeting',
    name: 'Schedule Meeting',
    description: 'Create and manage calendar events and invites',
    icon: Calendar,
    category: 'communication',
    status: 'coming_soon',
    serviceType: 'fixed',
  },

  // Research
  {
    id: 'research-web',
    name: 'Research Web',
    description: 'Search and analyze web pages for information gathering',
    icon: Globe,
    category: 'research',
    status: 'available',
    serviceType: 'llm',
    defaultModel: 'Claude Opus 4.6',
  },
  {
    id: 'read-tweets',
    name: 'Read X / Tweets',
    description: 'Monitor and analyze posts from X (Twitter) feeds',
    icon: Twitter,
    category: 'research',
    status: 'available',
    serviceType: 'llm',
    defaultModel: 'Claude Opus 4.6',
  },
  {
    id: 'research-reddit',
    name: 'Research Reddit',
    description: 'Search subreddits and threads for insights and trends',
    icon: Rss,
    category: 'research',
    status: 'available',
    serviceType: 'llm',
    defaultModel: 'Claude Opus 4.6',
  },
  {
    id: 'deep-search',
    name: 'Deep Search',
    description: 'Multi-source deep research across web, papers, and forums',
    icon: Search,
    category: 'research',
    status: 'coming_soon',
    serviceType: 'llm',
  },

  // Creation
  {
    id: 'create-images',
    name: 'Create Images',
    description: 'Generate images using AI image models (DALL-E, Midjourney)',
    icon: Image,
    category: 'creation',
    status: 'available',
    serviceType: 'fixed',
    fixedService: 'OpenAI',
  },
  {
    id: 'write-document',
    name: 'Write Document',
    description: 'Draft reports, memos, proposals, and other documents',
    icon: FileText,
    category: 'creation',
    status: 'available',
    serviceType: 'llm',
    defaultModel: 'Claude Opus 4.6',
  },
  {
    id: 'generate-code',
    name: 'Generate Code',
    description: 'Write, review, and debug code in multiple languages',
    icon: Code,
    category: 'creation',
    status: 'available',
    serviceType: 'llm',
    defaultModel: 'Claude Opus 4.6',
  },

  // Analysis
  {
    id: 'analyze-data',
    name: 'Analyze Data',
    description: 'Process datasets, generate charts, and extract insights',
    icon: BarChart3,
    category: 'analysis',
    status: 'coming_soon',
    serviceType: 'llm',
  },
];

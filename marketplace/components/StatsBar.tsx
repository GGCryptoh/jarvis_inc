import { Users, Wifi, MessageSquarePlus, MessagesSquare } from 'lucide-react';

interface StatsBarProps {
  totalInstances: number;
  onlineInstances: number;
  openFeatureRequests: number;
  forumPosts: number;
}

export default function StatsBar({
  totalInstances,
  onlineInstances,
  openFeatureRequests,
  forumPosts,
}: StatsBarProps) {
  const stats = [
    {
      label: 'Instances',
      value: totalInstances,
      icon: Users,
      color: 'text-pixel-green',
      glow: 'glow-green',
      pulse: false,
    },
    {
      label: 'Online Now',
      value: onlineInstances,
      icon: Wifi,
      color: 'text-pixel-cyan',
      glow: 'glow-cyan',
      pulse: true,
    },
    {
      label: 'Forum Posts',
      value: forumPosts,
      icon: MessagesSquare,
      color: 'text-pixel-orange',
      glow: 'glow-orange',
      pulse: false,
    },
    {
      label: 'Feature Requests',
      value: openFeatureRequests,
      icon: MessageSquarePlus,
      color: 'text-pixel-pink',
      glow: 'glow-pink',
      pulse: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="retro-card p-4 flex items-center gap-3"
        >
          <div
            className="w-9 h-9 rounded-lg bg-jarvis-bg border border-jarvis-border flex items-center justify-center flex-shrink-0"
          >
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
          </div>
          <div>
            <p
              className={`font-pixel text-lg sm:text-xl ${stat.color} ${stat.glow} ${stat.pulse ? 'animate-pulse-glow' : ''}`}
            >
              {stat.value}
            </p>
            <p className="font-mono text-[10px] text-jarvis-muted mt-0.5">
              {stat.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

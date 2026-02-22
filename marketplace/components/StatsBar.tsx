import { Users, Wifi, MessageSquarePlus } from 'lucide-react';

interface StatsBarProps {
  totalInstances: number;
  onlineInstances: number;
  openFeatureRequests: number;
}

export default function StatsBar({
  totalInstances,
  onlineInstances,
  openFeatureRequests,
}: StatsBarProps) {
  const stats = [
    {
      label: 'Instances',
      value: totalInstances,
      icon: Users,
      color: 'text-pixel-green',
      glow: 'glow-green',
    },
    {
      label: 'Online Now',
      value: onlineInstances,
      icon: Wifi,
      color: 'text-pixel-cyan',
      glow: 'glow-cyan',
    },
    {
      label: 'Feature Requests',
      value: openFeatureRequests,
      icon: MessageSquarePlus,
      color: 'text-pixel-pink',
      glow: 'glow-pink',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="retro-card p-5 flex items-center gap-4"
        >
          <div
            className={`w-10 h-10 rounded-lg bg-jarvis-bg border border-jarvis-border flex items-center justify-center`}
          >
            <stat.icon className={`w-5 h-5 ${stat.color}`} />
          </div>
          <div>
            <p
              className={`font-pixel text-lg sm:text-xl ${stat.color} ${stat.glow}`}
            >
              {stat.value}
            </p>
            <p className="font-mono text-xs text-jarvis-muted mt-0.5">
              {stat.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

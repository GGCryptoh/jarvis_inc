export type AgentStatus = 'working' | 'meeting' | 'idle' | 'walking' | 'break' | 'arriving' | 'celebrating';

export type SceneMode = 'working' | 'meeting' | 'welcome' | 'all_hands' | 'break';

export interface Position {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  color: string;      // primary color for sprite
  skinTone: string;
  status: AgentStatus;
  position: Position;
  targetPosition: Position;
  currentTask: string;
  confidence: number;  // 0-100
  costSoFar: number;
  model: string;       // e.g. "GPT-4o", "Claude 3.5"
  isNew?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CEO {
  id: string;
  name: string;
  model: string;
  philosophy: string;
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  status: 'nominal' | 'thinking' | 'error';
}

export interface DashboardStat {
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
}

export interface Mission {
  id: string;
  title: string;
  status: 'backlog' | 'in_progress' | 'review' | 'done';
  assignee: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  details: string;
  severity: 'info' | 'warning' | 'error';
}

export interface VaultEntry {
  id: string;
  name: string;
  type: 'api_key' | 'credential' | 'token' | 'secret';
  service: string;
  keyValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: 'pending' | 'approved' | 'dismissed';
  metadata: string | null;
  createdAt: string;
}

export interface FinancialEntry {
  month: string;
  budget: number;
  actual: number;
  category: string;
}

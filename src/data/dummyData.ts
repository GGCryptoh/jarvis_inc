import { Agent, DashboardStat, Mission, AuditEntry, FinancialEntry } from '../types';
import { generateDeskPositions } from '../lib/positionGenerator';

export const ENTRANCE_POSITION = { x: 50, y: 92 };

// Generate initial desk positions for the default 6 agents
const INITIAL_DESKS = generateDeskPositions(7); // 6 agents + 1 spare

export const initialAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'ARIA',
    role: 'Research Analyst',
    color: '#ff6b9d',
    skinTone: '#ffcc99',
    status: 'working',
    position: INITIAL_DESKS[0],
    targetPosition: INITIAL_DESKS[0],
    currentTask: 'Scraping competitor_analysis.pdf',
    confidence: 88,
    costSoFar: 0.14,
    model: 'Claude 3.5',
  },
  {
    id: 'agent-2',
    name: 'BOLT',
    role: 'Code Generator',
    color: '#50fa7b',
    skinTone: '#e8b88a',
    status: 'working',
    position: INITIAL_DESKS[1],
    targetPosition: INITIAL_DESKS[1],
    currentTask: 'Building auth microservice',
    confidence: 92,
    costSoFar: 0.38,
    model: 'GPT-4o',
  },
  {
    id: 'agent-3',
    name: 'CIPHER',
    role: 'Security Auditor',
    color: '#bd93f9',
    skinTone: '#ffcc99',
    status: 'working',
    position: INITIAL_DESKS[2],
    targetPosition: INITIAL_DESKS[2],
    currentTask: 'Scanning dependencies for CVEs',
    confidence: 95,
    costSoFar: 0.07,
    model: 'Claude 3.5',
  },
  {
    id: 'agent-4',
    name: 'DELTA',
    role: 'Data Analyst',
    color: '#ffb86c',
    skinTone: '#c8956c',
    status: 'working',
    position: INITIAL_DESKS[3],
    targetPosition: INITIAL_DESKS[3],
    currentTask: 'Processing Q4 revenue data',
    confidence: 76,
    costSoFar: 0.22,
    model: 'GPT-4o',
  },
  {
    id: 'agent-5',
    name: 'ECHO',
    role: 'Content Writer',
    color: '#8be9fd',
    skinTone: '#ffcc99',
    status: 'working',
    position: INITIAL_DESKS[4],
    targetPosition: INITIAL_DESKS[4],
    currentTask: 'Drafting blog post: AI Trends 2026',
    confidence: 84,
    costSoFar: 0.11,
    model: 'Claude 3.5',
  },
  {
    id: 'agent-6',
    name: 'FORGE',
    role: 'DevOps Engineer',
    color: '#f1fa8c',
    skinTone: '#e8b88a',
    status: 'working',
    position: INITIAL_DESKS[5],
    targetPosition: INITIAL_DESKS[5],
    currentTask: 'Deploying staging environment',
    confidence: 91,
    costSoFar: 0.05,
    model: 'GPT-4o',
  },
];

export const dashboardStats: DashboardStat[] = [
  { label: 'Active Agents', value: '6', change: '+2', trend: 'up' },
  { label: 'Tasks Completed', value: '147', change: '+23', trend: 'up' },
  { label: 'Total Spend', value: '$12.84', change: '+$3.20', trend: 'up' },
  { label: 'Avg Confidence', value: '87.6%', change: '+2.1%', trend: 'up' },
  { label: 'API Calls (24h)', value: '2,847', change: '-156', trend: 'down' },
  { label: 'Uptime', value: '99.97%', change: '0%', trend: 'neutral' },
];

export const missions: Mission[] = [
  { id: 'm1', title: 'Competitor analysis report', status: 'in_progress', assignee: 'ARIA', priority: 'high', dueDate: '2026-02-12' },
  { id: 'm2', title: 'Auth service v2', status: 'in_progress', assignee: 'BOLT', priority: 'critical', dueDate: '2026-02-11' },
  { id: 'm3', title: 'Security audit Q1', status: 'in_progress', assignee: 'CIPHER', priority: 'high', dueDate: '2026-02-15' },
  { id: 'm4', title: 'Revenue dashboard', status: 'review', assignee: 'DELTA', priority: 'medium', dueDate: '2026-02-13' },
  { id: 'm5', title: 'Blog content pipeline', status: 'in_progress', assignee: 'ECHO', priority: 'low', dueDate: '2026-02-18' },
  { id: 'm6', title: 'CI/CD pipeline optimization', status: 'done', assignee: 'FORGE', priority: 'medium', dueDate: '2026-02-10' },
  { id: 'm7', title: 'Customer churn prediction model', status: 'backlog', assignee: 'DELTA', priority: 'high', dueDate: '2026-02-20' },
  { id: 'm8', title: 'API rate limiter', status: 'backlog', assignee: 'BOLT', priority: 'medium', dueDate: '2026-02-22' },
  { id: 'm9', title: 'Penetration test: prod endpoints', status: 'backlog', assignee: 'CIPHER', priority: 'critical', dueDate: '2026-02-14' },
  { id: 'm10', title: 'Investor update draft', status: 'done', assignee: 'ECHO', priority: 'high', dueDate: '2026-02-09' },
];

export const auditLog: AuditEntry[] = [
  { id: 'a1', timestamp: '2026-02-10 14:32:01', agent: 'BOLT', action: 'DEPLOY', details: 'Deployed auth-service v2.1.0 to staging', severity: 'info' },
  { id: 'a2', timestamp: '2026-02-10 14:28:44', agent: 'CIPHER', action: 'ALERT', details: 'CVE-2026-1234 detected in lodash@4.17.20', severity: 'warning' },
  { id: 'a3', timestamp: '2026-02-10 14:15:22', agent: 'ARIA', action: 'FETCH', details: 'Downloaded 3 competitor reports from web', severity: 'info' },
  { id: 'a4', timestamp: '2026-02-10 13:58:10', agent: 'DELTA', action: 'QUERY', details: 'Executed 47 SQL queries against analytics_db', severity: 'info' },
  { id: 'a5', timestamp: '2026-02-10 13:45:00', agent: 'FORGE', action: 'ERROR', details: 'Docker build failed: out of memory on builder-2', severity: 'error' },
  { id: 'a6', timestamp: '2026-02-10 13:30:55', agent: 'ECHO', action: 'PUBLISH', details: 'Draft saved: "AI Trends 2026" (2,400 words)', severity: 'info' },
  { id: 'a7', timestamp: '2026-02-10 13:15:33', agent: 'BOLT', action: 'COMMIT', details: 'Pushed 12 commits to feature/auth-v2', severity: 'info' },
  { id: 'a8', timestamp: '2026-02-10 12:58:20', agent: 'CIPHER', action: 'SCAN', details: 'Completed dependency scan: 4 issues found', severity: 'warning' },
];

export const financials: FinancialEntry[] = [
  { month: "Sep '25", budget: 500, actual: 420, category: 'API Costs' },
  { month: "Oct '25", budget: 500, actual: 485, category: 'API Costs' },
  { month: "Nov '25", budget: 600, actual: 560, category: 'API Costs' },
  { month: "Dec '25", budget: 600, actual: 620, category: 'API Costs' },
  { month: "Jan '26", budget: 750, actual: 680, category: 'API Costs' },
  { month: "Feb '26", budget: 750, actual: 310, category: 'API Costs' },
];

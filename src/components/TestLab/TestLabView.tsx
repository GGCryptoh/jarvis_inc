import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertTriangle,
  Clock,
  Copy,
  Loader2,
  Trash2,
  FlaskConical,
} from 'lucide-react';
import { ALL_TESTS, TEST_CATEGORIES, type TestDefinition, type TestCategory } from '../../lib/testDefinitions';
import { saveTestRun, getLatestRunPerTest, deleteAllTestRuns, type TestRunRow } from '../../lib/testRunsDb';
import { AUTO_RUNNERS } from '../../lib/testAutoRunners';
import { getSupabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string | undefined) {
  switch (status) {
    case 'passed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400"><CheckCircle2 size={12} /> PASSED</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-400"><XCircle size={12} /> FAILED</span>;
    case 'running':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-yellow-500/20 text-yellow-400 animate-pulse"><Loader2 size={12} className="animate-spin" /> RUNNING</span>;
    case 'skipped':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-400"><AlertTriangle size={12} /> SKIPPED</span>;
    default:
      return <span className="text-zinc-600 text-xs font-mono">&mdash;</span>;
  }
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function modeBadge(mode: string) {
  switch (mode) {
    case 'auto':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">AUTO</span>;
    case 'playwright':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">PW</span>;
    case 'manual':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-mono">MANUAL</span>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TestLabView() {
  const [results, setResults] = useState<Record<string, TestRunRow>>({});
  const [activeCategory, setActiveCategory] = useState<TestCategory | 'all'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());
  const [runAllRunning, setRunAllRunning] = useState(false);
  const [ccPromptCopied, setCcPromptCopied] = useState(false);
  const [manualPanels, setManualPanels] = useState<Set<string>>(new Set());

  // ---- Load latest results ----
  const loadResults = useCallback(async () => {
    const latest = await getLatestRunPerTest();
    setResults(latest);
  }, []);

  useEffect(() => { loadResults(); }, [loadResults]);

  // ---- Realtime subscription ----
  useEffect(() => {
    const sb = getSupabase();
    const channel = sb.channel('test_runs_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_runs' }, () => {
        loadResults();
      })
      .subscribe();

    return () => { sb.removeChannel(channel); };
  }, [loadResults]);

  // ---- Filter tests ----
  const filteredTests = useMemo(() => {
    if (activeCategory === 'all') return ALL_TESTS;
    return ALL_TESTS.filter(t => t.category === activeCategory);
  }, [activeCategory]);

  // ---- Stats ----
  const stats = useMemo(() => {
    let passed = 0, failed = 0, skipped = 0, untested = 0;
    for (const t of ALL_TESTS) {
      const r = results[t.id];
      if (!r) { untested++; continue; }
      if (r.status === 'passed') passed++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'skipped') skipped++;
      else untested++;
    }
    return { total: ALL_TESTS.length, passed, failed, skipped, untested };
  }, [results]);

  // ---- Category stats ----
  const categoryStats = useCallback((cat: TestCategory) => {
    const tests = ALL_TESTS.filter(t => t.category === cat);
    let passed = 0, failed = 0;
    for (const t of tests) {
      const r = results[t.id];
      if (r?.status === 'passed') passed++;
      else if (r?.status === 'failed') failed++;
    }
    return { total: tests.length, passed, failed, untested: tests.length - passed - failed };
  }, [results]);

  // ---- Group tests by group or keep flat ----
  const groupedTests = useMemo(() => {
    const groups: Record<string, TestDefinition[]> = {};
    for (const t of filteredTests) {
      const key = t.group ?? t.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [filteredTests]);

  // ---- Toggle group ----
  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // ---- Toggle test detail ----
  const toggleTest = (id: string) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Run single auto test ----
  const runAutoTest = useCallback(async (test: TestDefinition) => {
    if (!test.autoRunner || !AUTO_RUNNERS[test.autoRunner]) return;

    const runId = `run-${test.id}-${Date.now()}`;
    setRunningTests(prev => new Set(prev).add(test.id));

    // Save running state
    const runRow: TestRunRow = {
      id: runId,
      test_id: test.id,
      category: test.category,
      label: test.label,
      status: 'running',
      mode: test.mode,
      duration_ms: null,
      output: null,
      verified_by: null,
      run_by: 'ui',
      notes: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    await saveTestRun(runRow);

    const start = performance.now();
    try {
      const runner = AUTO_RUNNERS[test.autoRunner];
      const result = await runner(test.autoParams);
      const duration = Math.round(performance.now() - start);

      await saveTestRun({
        ...runRow,
        status: result.passed ? 'passed' : 'failed',
        duration_ms: duration,
        output: { ...result } as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      });
    } catch (e: unknown) {
      const duration = Math.round(performance.now() - start);
      await saveTestRun({
        ...runRow,
        status: 'failed',
        duration_ms: duration,
        output: { error: (e as Error).message } as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      });
    }

    setRunningTests(prev => {
      const next = new Set(prev);
      next.delete(test.id);
      return next;
    });
  }, []);

  // ---- Run All Auto ----
  const runAllAuto = useCallback(async () => {
    setRunAllRunning(true);
    const autoTests = ALL_TESTS.filter(t => t.mode === 'auto' && t.autoRunner && AUTO_RUNNERS[t.autoRunner]);
    for (const test of autoTests) {
      await runAutoTest(test);
    }
    setRunAllRunning(false);
  }, [runAutoTest]);

  // ---- Manual pass/fail ----
  const recordManualResult = useCallback(async (test: TestDefinition, passed: boolean, notes?: string) => {
    const runId = `run-${test.id}-${Date.now()}`;
    await saveTestRun({
      id: runId,
      test_id: test.id,
      category: test.category,
      label: test.label,
      status: passed ? 'passed' : 'failed',
      mode: test.mode,
      duration_ms: null,
      output: notes ? { notes } as Record<string, unknown> : null,
      verified_by: 'founder',
      run_by: 'manual',
      notes: notes ?? null,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    setManualPanels(prev => {
      const next = new Set(prev);
      next.delete(test.id);
      return next;
    });
  }, []);

  // ---- Claude Code prompt generator ----
  const generateCCPrompt = useCallback(() => {
    const failing = ALL_TESTS.filter(t => results[t.id]?.status === 'failed').map(t => t.id);
    const untested = ALL_TESTS.filter(t => !results[t.id]).map(t => t.id);
    const pwTests = ALL_TESTS.filter(t => t.mode === 'playwright');

    let prompt = `# Jarvis Test Lab — Current Status\n\n`;
    prompt += `Total: ${stats.total} | Passed: ${stats.passed} | Failed: ${stats.failed} | Untested: ${stats.untested}\n\n`;

    if (failing.length > 0) {
      prompt += `## Failing Tests (${failing.length})\n`;
      failing.forEach(id => { prompt += `- ${id}\n`; });
      prompt += '\n';
    }

    if (untested.length > 0) {
      prompt += `## Untested (${untested.length})\n`;
      untested.forEach(id => { prompt += `- ${id}\n`; });
      prompt += '\n';
    }

    prompt += `## Playwright Tests (${pwTests.length})\n`;
    pwTests.forEach(t => {
      prompt += `### ${t.id}\n`;
      prompt += `Steps:\n`;
      t.playwrightSteps?.forEach((s, i) => { prompt += `${i + 1}. ${s}\n`; });
      prompt += '\n';
    });

    prompt += `\nSee APPTEST-PLAYWRIGHT.md for full details and psql commands to write results.\n`;
    return prompt;
  }, [results, stats]);

  const copyCCPrompt = useCallback(() => {
    navigator.clipboard.writeText(generateCCPrompt());
    setCcPromptCopied(true);
    setTimeout(() => setCcPromptCopied(false), 2000);
  }, [generateCCPrompt]);

  // ---- Clear all results ----
  const clearResults = useCallback(async () => {
    if (!confirm('Delete all test results? This cannot be undone.')) return;
    await deleteAllTestRuns();
    setResults({});
  }, []);

  // ---- Render ----
  return (
    <div className="h-full overflow-y-auto bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="text-violet-400" size={24} />
          <h1 className="text-xl font-bold text-white tracking-wide">TEST LAB</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearResults}
            className="px-3 py-1.5 rounded text-xs font-mono bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 size={12} /> Clear
          </button>
          <button
            onClick={runAllAuto}
            disabled={runAllRunning}
            className="px-3 py-1.5 rounded text-xs font-mono bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {runAllRunning ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
            Run All Auto
          </button>
          <button
            onClick={copyCCPrompt}
            className="px-3 py-1.5 rounded text-xs font-mono bg-violet-600/20 text-violet-400 hover:bg-violet-600/30 flex items-center gap-1.5 transition-colors"
          >
            <Copy size={12} /> {ccPromptCopied ? 'Copied!' : 'Copy CC Prompt'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="text-xs text-zinc-400 font-mono mb-4">
        {stats.total} tests &middot;{' '}
        <span className="text-emerald-400">{stats.passed} passed</span> &middot;{' '}
        <span className="text-red-400">{stats.failed} failed</span> &middot;{' '}
        {stats.skipped > 0 && <><span className="text-amber-400">{stats.skipped} skipped</span> &middot;{' '}</>}
        <span className="text-zinc-600">{stats.untested} untested</span>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
            activeCategory === 'all' ? 'bg-zinc-700 text-white' : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          All ({stats.total})
        </button>
        {TEST_CATEGORIES.map(cat => {
          const cs = categoryStats(cat.key);
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeCategory === cat.key ? 'bg-zinc-700 text-white' : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {cat.label} ({cs.total})
            </button>
          );
        })}
      </div>

      {/* Test groups */}
      {activeCategory === 'all' ? (
        // Render by category
        TEST_CATEGORIES.map(cat => {
          const catTests = filteredTests.filter(t => t.category === cat.key);
          if (catTests.length === 0) return null;
          const cs = categoryStats(cat.key);
          return (
            <CategorySection
              key={cat.key}
              label={cat.label}
              stats={cs}
              tests={catTests}
              results={results}
              runningTests={runningTests}
              expandedGroups={expandedGroups}
              expandedTests={expandedTests}
              manualPanels={manualPanels}
              toggleGroup={toggleGroup}
              toggleTest={toggleTest}
              runAutoTest={runAutoTest}
              recordManualResult={recordManualResult}
              onOpenManual={(id) => setManualPanels(prev => new Set(prev).add(id))}
            />
          );
        })
      ) : (
        <CategorySection
          label={TEST_CATEGORIES.find(c => c.key === activeCategory)?.label ?? ''}
          stats={categoryStats(activeCategory)}
          tests={filteredTests}
          results={results}
          runningTests={runningTests}
          expandedGroups={expandedGroups}
          expandedTests={expandedTests}
          manualPanels={manualPanels}
          toggleGroup={toggleGroup}
          toggleTest={toggleTest}
          runAutoTest={runAutoTest}
          recordManualResult={recordManualResult}
          onOpenManual={(id) => setManualPanels(prev => new Set(prev).add(id))}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategorySection
// ---------------------------------------------------------------------------

function CategorySection({
  label,
  stats,
  tests,
  results,
  runningTests,
  expandedGroups,
  expandedTests,
  manualPanels,
  toggleGroup,
  toggleTest,
  runAutoTest,
  recordManualResult,
  onOpenManual,
}: {
  label: string;
  stats: { total: number; passed: number; failed: number; untested: number };
  tests: TestDefinition[];
  results: Record<string, TestRunRow>;
  runningTests: Set<string>;
  expandedGroups: Set<string>;
  expandedTests: Set<string>;
  manualPanels: Set<string>;
  toggleGroup: (g: string) => void;
  toggleTest: (id: string) => void;
  runAutoTest: (t: TestDefinition) => void;
  recordManualResult: (t: TestDefinition, passed: boolean, notes?: string) => void;
  onOpenManual: (id: string) => void;
}) {
  // Group tests
  const groups: Record<string, TestDefinition[]> = {};
  for (const t of tests) {
    const key = t.group ?? t.id;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  const groupKeys = Object.keys(groups);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-zinc-300 tracking-wider">
          {label.toUpperCase()} ({stats.total})
        </h2>
        <div className="text-xs font-mono text-zinc-500">
          {stats.passed > 0 && <span className="text-emerald-400">{stats.passed}&#10003;</span>}
          {stats.failed > 0 && <span className="text-red-400 ml-2">{stats.failed}&#10007;</span>}
          {stats.untested > 0 && <span className="text-zinc-600 ml-2">{stats.untested}&ndash;</span>}
        </div>
      </div>

      <div className="space-y-1">
        {groupKeys.map(groupKey => {
          const groupTests = groups[groupKey];
          const isMulti = groupTests.length > 1;
          const isExpanded = !isMulti || expandedGroups.has(groupKey);

          if (isMulti) {
            return (
              <div key={groupKey} className="bg-jarvis-surface border border-jarvis-border rounded overflow-hidden">
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown size={14} className="text-zinc-500" />
                    : <ChevronRight size={14} className="text-zinc-500" />
                  }
                  <span className="text-xs font-mono text-zinc-300">{groupKey}</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{groupTests.length} commands</span>
                </button>
                {isExpanded && (
                  <div className="border-t border-jarvis-border">
                    {groupTests.map(t => (
                      <TestRow
                        key={t.id}
                        test={t}
                        result={results[t.id]}
                        isRunning={runningTests.has(t.id)}
                        isExpanded={expandedTests.has(t.id)}
                        isManualOpen={manualPanels.has(t.id)}
                        onToggle={() => toggleTest(t.id)}
                        onRun={() => runAutoTest(t)}
                        onManualResult={(passed, notes) => recordManualResult(t, passed, notes)}
                        onOpenManual={() => onOpenManual(t.id)}
                        indent
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={groupKey} className="bg-jarvis-surface border border-jarvis-border rounded overflow-hidden">
              {groupTests.map(t => (
                <TestRow
                  key={t.id}
                  test={t}
                  result={results[t.id]}
                  isRunning={runningTests.has(t.id)}
                  isExpanded={expandedTests.has(t.id)}
                  isManualOpen={manualPanels.has(t.id)}
                  onToggle={() => toggleTest(t.id)}
                  onRun={() => runAutoTest(t)}
                  onManualResult={(passed, notes) => recordManualResult(t, passed, notes)}
                  onOpenManual={() => onOpenManual(t.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TestRow
// ---------------------------------------------------------------------------

function TestRow({
  test,
  result,
  isRunning,
  isExpanded,
  isManualOpen,
  onToggle,
  onRun,
  onManualResult,
  onOpenManual,
  indent,
}: {
  test: TestDefinition;
  result: TestRunRow | undefined;
  isRunning: boolean;
  isExpanded: boolean;
  isManualOpen: boolean;
  onToggle: () => void;
  onRun: () => void;
  onManualResult: (passed: boolean, notes?: string) => void;
  onOpenManual: () => void;
  indent?: boolean;
}) {
  const status = isRunning ? 'running' : result?.status;

  return (
    <div className={indent ? 'border-t border-jarvis-border first:border-t-0' : ''}>
      <div
        className={`flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/30 transition-colors cursor-pointer ${indent ? 'pl-8' : ''}`}
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs text-zinc-300 font-mono truncate">{test.label}</span>
          {modeBadge(test.mode)}
          {test.requires && test.requires.length > 0 && (
            <span className="text-[9px] text-zinc-600 font-mono">({test.requires.join(', ')})</span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {statusBadge(status)}
          {result && (
            <span className="text-[10px] text-zinc-600 font-mono w-16 text-right">{timeAgo(result.completed_at)}</span>
          )}
          {result?.duration_ms != null && (
            <span className="text-[10px] text-zinc-600 font-mono w-12 text-right flex items-center gap-0.5">
              <Clock size={9} /> {result.duration_ms}ms
            </span>
          )}
          {/* Run button */}
          {test.mode === 'auto' && test.autoRunner && (
            <button
              onClick={(e) => { e.stopPropagation(); onRun(); }}
              disabled={isRunning}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              title="Run test"
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
          )}
          {(test.mode === 'manual' || test.mode === 'playwright') && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenManual(); }}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-violet-400 transition-colors"
              title="Open manual verification"
            >
              <Play size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className={`px-3 pb-3 ${indent ? 'pl-8' : ''}`}>
          <p className="text-xs text-zinc-500 mb-2">{test.description}</p>
          {result?.output && (
            <pre className="text-[10px] font-mono bg-zinc-900 rounded p-2 overflow-x-auto text-zinc-400 max-h-48 overflow-y-auto">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          )}
          {result?.output && (result.output as Record<string, unknown>).error != null && (
            <p className="text-xs text-red-400 mt-1 font-mono">{`${(result.output as Record<string, unknown>).error}`}</p>
          )}
        </div>
      )}

      {/* Manual verification panel */}
      {isManualOpen && (
        <div className={`px-3 pb-3 ${indent ? 'pl-8' : ''}`}>
          <div className="bg-zinc-900 rounded p-3 border border-zinc-700">
            {test.mode === 'playwright' && test.playwrightSteps && (
              <div className="mb-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Steps</p>
                <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-0.5">
                  {test.playwrightSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
            {test.mode === 'manual' && test.manualInstructions && (
              <p className="text-xs text-zinc-400 mb-3">{test.manualInstructions}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => onManualResult(true)}
                className="px-3 py-1 rounded text-xs font-mono bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
              >
                Pass
              </button>
              <button
                onClick={() => onManualResult(false)}
                className="px-3 py-1 rounded text-xs font-mono bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Fail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

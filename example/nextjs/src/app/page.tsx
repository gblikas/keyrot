'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { GridScan } from '@/components/GridScan';
import { useKeyPool, type RequestResult } from '@/lib/useKeyPool';

export default function Home() {
  const {
    isReady,
    health,
    keyStats,
    makeRequest,
    burstRequests,
    resetPool,
  } = useKeyPool();

  const [results, setResults] = useState<RequestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [simulate429, setSimulate429] = useState(false);
  const [simulate500, setSimulate500] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [getStartedOpen, setGetStartedOpen] = useState(false);
  const [starCount, setStarCount] = useState<number | null>(null);
  const [animationPlaying, setAnimationPlaying] = useState(true);

  // Fetch GitHub star count
  useEffect(() => {
    fetch('https://api.github.com/repos/gblikas/keyrot')
      .then(res => res.json())
      .then(data => {
        if (data.stargazers_count !== undefined) {
          setStarCount(data.stargazers_count);
        }
      })
      .catch(() => {
        // Silently fail - star count just won't show
      });
  }, []);

  const handleMakeRequest = async () => {
    setLoading(true);
    try {
      const result = await makeRequest({ simulate429, simulate500 });
      setResults(prev => [result, ...prev.slice(0, 19)]);
    } finally {
      setLoading(false);
    }
  };

  const handleBurstRequests = async (count: number) => {
    setLoading(true);
    try {
      const burstResults = await burstRequests(count);
      setResults(prev => [...burstResults, ...prev].slice(0, 50));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPool = () => {
    resetPool();
    setResults([]);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-emerald-400';
      case 'degraded': return 'text-amber-400';
      case 'critical': return 'text-orange-400';
      case 'exhausted': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-emerald-400 shadow-emerald-400/50 shadow-[0_0_10px]';
      case 'degraded': return 'bg-amber-400 shadow-amber-400/50 shadow-[0_0_10px]';
      case 'critical': return 'bg-orange-400 shadow-orange-400/50 shadow-[0_0_10px]';
      case 'exhausted': return 'bg-red-400 shadow-red-400/50 shadow-[0_0_10px]';
      default: return 'bg-muted-foreground';
    }
  };

  const quotaPercent = health ? (health.effectiveQuotaRemaining / health.effectiveQuotaTotal) * 100 : 0;

  const openDemo = () => {
    setDemoOpen(true);
    setGetStartedOpen(false);
    document.body.style.overflow = 'hidden';
  };

  const closeDemo = useCallback(() => {
    setDemoOpen(false);
    document.body.style.overflow = '';
  }, []);

  const openGetStarted = () => {
    setGetStartedOpen(true);
    setDemoOpen(false);
    document.body.style.overflow = 'hidden';
  };

  const closeGetStarted = useCallback(() => {
    setGetStartedOpen(false);
    document.body.style.overflow = '';
  }, []);

  // Handle Escape key to close overlays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (demoOpen) closeDemo();
        if (getStartedOpen) closeGetStarted();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [demoOpen, getStartedOpen, closeDemo, closeGetStarted]);

  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* Persistent GridScan Background */}
      <div className="fixed inset-0 -z-10">
        <GridScan
          linesColor="#1a3a2a"
          scanColor="#34d399"
          lineThickness={1}
          gridScale={0.12}
          scanOpacity={0.5}
          scanGlow={0.6}
          scanSoftness={2.5}
          scanDuration={3}
          scanDelay={1}
          noiseIntensity={0.02}
          enablePost={true}
          bloomIntensity={0.3}
          chromaticAberration={0.001}
          paused={!animationPlaying}
          timeScale={(demoOpen || getStartedOpen) ? 0.15 : 1.0}
          className=""
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Play/Pause Animation Button - z-[60] to stay above popovers (z-50) */}
      <button
        onClick={() => setAnimationPlaying(!animationPlaying)}
        className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[60] w-10 h-10 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-500/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-emerald-900/90 hover:border-emerald-500/50 transition-all shadow-lg shadow-emerald-900/40"
        aria-label={animationPlaying ? 'Pause animation' : 'Play animation'}
        title={animationPlaying ? 'Pause animation' : 'Play animation'}
      >
        {animationPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Hero Landing */}
      <section className={`min-h-screen flex flex-col transition-all duration-500 ${(demoOpen || getStartedOpen) ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}>
        {/* Top Banner */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 relative z-10">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold text-base sm:text-lg text-foreground">Keyrot</span>
          </div>
          
          {/* GitHub Stars */}
          <a
            href="https://github.com/gblikas/keyrot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-emerald-950/50 backdrop-blur-sm border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-950/70 transition-all text-xs sm:text-sm text-muted-foreground hover:text-foreground"
          >
            <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="tabular-nums font-medium">
              {starCount !== null ? starCount.toLocaleString() : 'Star'}
            </span>
          </a>
        </header>

        {/* Centered Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
          <div className="text-center max-w-3xl relative z-10">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 sm:mb-6 leading-tight">
              One pool.<br />
              <span className="text-emerald-400">Many keys.</span><br />
              Zero downtime.
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-2xl mx-auto px-2">
              API key rotation and multiplexing for TypeScript. Automatic rate limiting, quota tracking, and circuit breaker patterns.
            </p>
            
            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mb-8 sm:mb-10 px-2">
              <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm bg-emerald-950/50 border border-emerald-500/20 text-emerald-300">
                Rate Limiting
              </span>
              <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm bg-emerald-950/50 border border-emerald-500/20 text-emerald-300">
                Quota Tracking
              </span>
              <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm bg-emerald-950/50 border border-emerald-500/20 text-emerald-300">
                Circuit Breaker
              </span>
              <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm bg-emerald-950/50 border border-emerald-500/20 text-emerald-300">
                Auto Failover
              </span>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center px-4 sm:px-0">
              <Button
                onClick={openGetStarted}
                size="lg"
                variant="outline"
                className="border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-foreground font-medium px-6 sm:px-8 h-11 sm:h-12"
              >
                Get Started
              </Button>
              <Button
                onClick={openDemo}
                size="lg"
                className="bg-emerald-500 hover:bg-emerald-600 text-emerald-950 font-medium px-6 sm:px-8 h-11 sm:h-12"
              >
                Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Get Started Overlay */}
      <div 
        className={`fixed inset-0 z-50 overflow-y-auto transition-all duration-500 ${getStartedOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        {/* Floating Close Button */}
        <button
          onClick={closeGetStarted}
          className={`fixed top-4 right-4 md:top-6 md:right-6 z-20 w-10 h-10 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-500/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-emerald-900/90 hover:border-emerald-500/50 transition-all duration-300 shadow-lg shadow-emerald-900/40 ${getStartedOpen ? 'scale-100 rotate-0' : 'scale-0 rotate-90'}`}
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Content */}
        <div className="min-h-screen flex flex-col items-center justify-start sm:justify-center px-3 sm:px-4 md:px-8 py-8 sm:py-12">
          <div className="w-full max-w-4xl space-y-4 sm:space-y-8 pt-12 sm:pt-0">
            {/* Header */}
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2 sm:mb-4">
                Get Started
              </h2>
              <p className="text-sm sm:text-lg text-muted-foreground px-2">
                Install keyrot and start managing your API keys in minutes.
              </p>
            </div>

            {/* Installation */}
            <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-6">
              <h3 className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">Installation</h3>
              <pre className="bg-black/40 rounded-lg p-3 sm:p-4 overflow-x-auto">
                <code className="text-emerald-300 text-xs sm:text-sm font-mono">npm install keyrot</code>
              </pre>
            </div>

            {/* Basic Usage */}
            <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-6">
              <h3 className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">Basic Usage</h3>
              <pre className="bg-black/40 rounded-lg p-3 sm:p-4 overflow-x-auto text-[10px] sm:text-sm font-mono">
                <code className="text-gray-300">{`import { createKeyPool } from 'keyrot';

const pool = createKeyPool({
  keys: [
    { id: 'key-1', value: 'sk-xxx', quota: { type: 'monthly', limit: 10000 }, rps: 10 },
    { id: 'key-2', value: 'sk-yyy', quota: { type: 'unlimited' }, rps: 5 },
  ],
  isRateLimited: (res) => res.status === 429,
  isError: (res) => res.status >= 500,
});

// Execute requests through the pool
const response = await pool.execute(async (keyValue) => {
  return fetch('https://api.example.com/data', {
    headers: { Authorization: \`Bearer \${keyValue}\` },
  });
});`}</code>
              </pre>
            </div>

            {/* Features Grid */}
            <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-foreground text-sm sm:text-base">Automatic Failover</h4>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">Seamlessly switches to available keys when one is rate-limited or fails.</p>
              </div>

              <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 011 1v3h3a1 1 0 110 2H7a1 1 0 01-1-1V8a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-foreground text-sm sm:text-base">Quota Tracking</h4>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">Track monthly, yearly, or total quotas with automatic reset handling.</p>
              </div>

              <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-foreground text-sm sm:text-base">Health Monitoring</h4>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">Real-time pool health status: healthy, degraded, critical, or exhausted.</p>
              </div>

              <div className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-foreground text-sm sm:text-base">Circuit Breaker</h4>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">Automatic failure detection with configurable recovery thresholds.</p>
              </div>
            </div>

            {/* CTA */}
            <div className="text-center pt-2 sm:pt-4 pb-8 sm:pb-0">
              <Button
                onClick={() => { closeGetStarted(); openDemo(); }}
                size="lg"
                className="bg-emerald-500 hover:bg-emerald-600 text-emerald-950 font-medium px-6 sm:px-8 h-10 sm:h-11 group"
              >
                Demo
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Overlay - Floating Cards */}
      <div
        className={`fixed inset-0 z-50 overflow-y-auto transition-all duration-500 ${demoOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        {/* Floating Close Button */}
        <button
          onClick={closeDemo}
          className={`fixed top-4 right-4 md:top-6 md:right-6 z-20 w-10 h-10 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-500/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-emerald-900/90 hover:border-emerald-500/50 transition-all duration-300 shadow-lg shadow-emerald-900/40 ${demoOpen ? 'scale-100 rotate-0' : 'scale-0 rotate-90'}`}
          aria-label="Close demo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Content */}
        <div className="px-3 sm:px-4 md:px-8 py-8 sm:py-12">
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-8">
            {/* Header */}
            <div className="text-center pt-8 sm:pt-0">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2 sm:mb-4">
                Demo
              </h2>
              <p className="text-sm sm:text-lg text-muted-foreground px-4">
                Interact with a live key pool running entirely in your browser.
              </p>
            </div>

            {/* Status Bar - Mobile optimized */}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs sm:text-sm px-2">
              {!isReady ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/50 border border-emerald-500/20">
                  <span className="text-muted-foreground">Initializing...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-emerald-950/50 border border-emerald-500/20" title={`Pool Status: ${health?.status ?? 'loading'}`}>
                    <div className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full ${getStatusDot(health?.status || 'unknown')}`} />
                    <span className={`uppercase font-medium tracking-wide ${getStatusColor(health?.status || 'unknown')}`}>
                      {health?.status || '...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-emerald-950/50 border border-emerald-500/20">
                    <span className="text-muted-foreground">Keys:</span>
                    <span className="text-foreground tabular-nums font-medium">{health?.availableKeys ?? '-'}/{health?.totalKeys ?? '-'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-emerald-950/50 border border-emerald-500/20">
                    <span className="text-muted-foreground">RPS:</span>
                    <span className="text-foreground tabular-nums font-medium">{health?.effectiveRps ?? '-'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-emerald-950/50 border border-emerald-500/20">
                    <span className="text-muted-foreground">Quota:</span>
                    <span className="text-foreground tabular-nums font-medium">{health?.effectiveQuotaRemaining?.toLocaleString() ?? '-'}</span>
                    <Progress value={quotaPercent} className="h-1.5 w-12 sm:w-16 bg-secondary" />
                  </div>
                </>
              )}
            </div>
            {/* Main Content Grid */}
            <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
              {/* Key Status - Cards on mobile, Table on desktop */}
              <Card className="lg:col-span-2 border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30">
                <CardHeader className="pb-2 sm:pb-6">
                  <CardTitle className="text-base font-medium">Key Pool</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Real-time status of all API keys in the pool</CardDescription>
                </CardHeader>
                <CardContent className="px-3 sm:px-6">
                  {/* Mobile Card Layout */}
                  <div className="md:hidden space-y-3">
                    {keyStats.map((key) => {
                      const isAvailable = !key.isRateLimited && !key.isCircuitOpen && !key.isExhausted;
                      return (
                        <div
                          key={key.id}
                          className={`rounded-lg border border-border/50 bg-black/20 p-3 ${!isAvailable ? 'opacity-60' : ''}`}
                        >
                          {/* Key ID Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${isAvailable ? 'bg-emerald-400 shadow-emerald-400/50 shadow-[0_0_6px]' : 'bg-red-400 shadow-red-400/50 shadow-[0_0_6px]'}`} />
                              <span className="font-mono text-sm font-medium">{key.id}</span>
                            </div>
                            <Badge
                              variant="outline"
                              className={key.isRateLimited
                                ? 'border-red-500/30 text-red-400 bg-red-500/10 text-xs'
                                : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs'
                              }
                            >
                              {key.isRateLimited ? 'Limited' : 'OK'}
                            </Badge>
                          </div>
                          
                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between items-center bg-black/20 rounded px-2 py-1.5">
                              <span className="text-muted-foreground">Quota Used</span>
                              <span className="tabular-nums font-medium">{key.quotaUsed}</span>
                            </div>
                            <div className="flex justify-between items-center bg-black/20 rounded px-2 py-1.5">
                              <span className="text-muted-foreground">Remaining</span>
                              <span className={`tabular-nums font-medium ${key.isExhausted ? 'text-red-400' : ''}`}>
                                {key.isExhausted ? '0' : key.quotaRemaining}
                              </span>
                            </div>
                            <div className="flex justify-between items-center bg-black/20 rounded px-2 py-1.5">
                              <span className="text-muted-foreground">RPS</span>
                              <span className="tabular-nums font-medium">{key.currentRps.toFixed(1)}/{key.rpsLimit ?? '∞'}</span>
                            </div>
                            <div className="flex justify-between items-center bg-black/20 rounded px-2 py-1.5">
                              <span className="text-muted-foreground">Circuit</span>
                              <span className={key.isCircuitOpen ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
                                {key.isCircuitOpen ? 'Open' : 'Closed'}
                              </span>
                            </div>
                          </div>
                          
                          {/* Failures indicator - only show if there are failures */}
                          {key.consecutiveFailures > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              <span>{key.consecutiveFailures} consecutive failure{key.consecutiveFailures > 1 ? 's' : ''}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Desktop Table Layout */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50 hover:bg-transparent">
                          <TableHead className="text-muted-foreground">Key</TableHead>
                          <TableHead className="text-right text-muted-foreground">Quota Used</TableHead>
                          <TableHead className="text-right text-muted-foreground">Remaining</TableHead>
                          <TableHead className="text-center text-muted-foreground">RPS</TableHead>
                          <TableHead className="text-center text-muted-foreground">Rate Limit</TableHead>
                          <TableHead className="text-center text-muted-foreground">Circuit</TableHead>
                          <TableHead className="text-right text-muted-foreground">Failures</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {keyStats.map((key) => {
                          const isAvailable = !key.isRateLimited && !key.isCircuitOpen && !key.isExhausted;
                          return (
                            <TableRow
                              key={key.id}
                              className={`border-border/50 ${!isAvailable ? 'opacity-60' : ''}`}
                            >
                              <TableCell className="font-mono text-sm">
                                <div className="flex items-center gap-2">
                                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-emerald-400' : 'bg-red-400'
                                    }`} />
                                  {key.id}
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{key.quotaUsed}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {key.isExhausted ? (
                                  <span className="text-red-400">0</span>
                                ) : (
                                  key.quotaRemaining
                                )}
                              </TableCell>
                              <TableCell className="text-center tabular-nums text-muted-foreground">
                                <span title={`Current: ${key.currentRps.toFixed(1)} / Limit: ${key.rpsLimit ?? '∞'}`}>
                                  {key.currentRps.toFixed(1)}/{key.rpsLimit ?? '∞'}
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant="outline"
                                  className={key.isRateLimited
                                    ? 'border-red-500/30 text-red-400 bg-red-500/10'
                                    : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                  }
                                  title={key.isRateLimited ? 'Key is rate limited - waiting for cooldown' : 'Key has rate limit capacity'}
                                >
                                  {key.isRateLimited ? 'Limited' : 'OK'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant="outline"
                                  className={key.isCircuitOpen
                                    ? 'border-red-500/30 text-red-400 bg-red-500/10'
                                    : 'border-border/50 text-muted-foreground'
                                  }
                                  title={key.isCircuitOpen ? 'Circuit breaker is open due to failures' : 'Circuit breaker is closed (normal operation)'}
                                >
                                  {key.isCircuitOpen ? 'Open' : 'Closed'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                <span className={key.consecutiveFailures > 0 ? 'text-amber-400' : 'text-muted-foreground'}>
                                  {key.consecutiveFailures}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Controls Panel */}
              <Card className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30">
                <CardHeader className="pb-2 sm:pb-6">
                  <CardTitle className="text-base font-medium">Controls</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Test pool behavior</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 sm:space-y-6 px-3 sm:px-6">
                  {/* Action Buttons */}
                  <div className="space-y-2 sm:space-y-3">
                    <Button
                      onClick={handleMakeRequest}
                      disabled={loading || !isReady}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-emerald-950 font-medium h-10 sm:h-11"
                    >
                      {loading ? 'Sending...' : 'Make Request'}
                    </Button>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => handleBurstRequests(5)}
                        disabled={loading || !isReady}
                        variant="outline"
                        className="border-border/50 hover:bg-accent hover:border-border h-9 sm:h-10 text-sm"
                      >
                        Burst 5
                      </Button>
                      <Button
                        onClick={() => handleBurstRequests(20)}
                        disabled={loading || !isReady}
                        variant="outline"
                        className="border-border/50 hover:bg-accent hover:border-border h-9 sm:h-10 text-sm"
                      >
                        Burst 20
                      </Button>
                    </div>

                    <Button
                      onClick={handleResetPool}
                      variant="ghost"
                      className="w-full text-muted-foreground hover:text-foreground h-9 sm:h-10"
                    >
                      Reset Pool
                    </Button>
                  </div>

                  <Separator className="bg-border/50" />

                  {/* Simulation Toggles */}
                  <div className="space-y-3 sm:space-y-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Simulate Errors
                    </p>

                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <label className="text-sm font-medium">429 Rate Limit</label>
                        <p className="text-xs text-muted-foreground">Force rate limit</p>
                      </div>
                      <Switch
                        checked={simulate429}
                        onCheckedChange={setSimulate429}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <label className="text-sm font-medium">500 Server Error</label>
                        <p className="text-xs text-muted-foreground">Force server error</p>
                      </div>
                      <Switch
                        checked={simulate500}
                        onCheckedChange={setSimulate500}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Health Summary */}
            {health && (
              <Card className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30">
                <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
                  <CardTitle className="text-sm sm:text-base font-medium flex flex-wrap items-center gap-2">
                    <div className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full flex-shrink-0 ${getStatusDot(health.status)}`} />
                    <span>Pool Health:</span>
                    <span className={getStatusColor(health.status)}>{health.status.charAt(0).toUpperCase() + health.status.slice(1)}</span>
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    {health.status === 'healthy' && 'All keys are available and functioning normally'}
                    {health.status === 'degraded' && 'Some keys are unavailable but pool is still operational'}
                    {health.status === 'critical' && 'Limited capacity available - most keys are unavailable'}
                    {health.status === 'exhausted' && 'No keys available - all requests will be queued or rejected'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-3 sm:px-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                    <div className="space-y-0.5 sm:space-y-1 bg-black/20 rounded-lg p-2 sm:p-3 sm:bg-transparent sm:rounded-none">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Available Keys</p>
                      <p className="text-lg sm:text-2xl font-semibold tabular-nums">
                        {health.availableKeys}<span className="text-muted-foreground text-sm sm:text-lg">/{health.totalKeys}</span>
                      </p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                        {health.totalKeys - health.availableKeys > 0
                          ? `${health.totalKeys - health.availableKeys} unavailable`
                          : 'All keys ready'}
                      </p>
                    </div>
                    <div className="space-y-0.5 sm:space-y-1 bg-black/20 rounded-lg p-2 sm:p-3 sm:bg-transparent sm:rounded-none">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Effective RPS</p>
                      <p className="text-lg sm:text-2xl font-semibold tabular-nums">{health.effectiveRps}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">requests/second</p>
                    </div>
                    <div className="space-y-0.5 sm:space-y-1 bg-black/20 rounded-lg p-2 sm:p-3 sm:bg-transparent sm:rounded-none">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Quota Left</p>
                      <p className="text-lg sm:text-2xl font-semibold tabular-nums">{health.effectiveQuotaRemaining.toLocaleString()}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                        of {health.effectiveQuotaTotal.toLocaleString()} ({quotaPercent.toFixed(1)}%)
                      </p>
                    </div>
                    <div className="space-y-0.5 sm:space-y-1 bg-black/20 rounded-lg p-2 sm:p-3 sm:bg-transparent sm:rounded-none">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Warnings</p>
                      <p className={`text-lg sm:text-2xl font-semibold tabular-nums ${health.warnings.length > 0 ? 'text-amber-400' : ''}`}>
                        {health.warnings.length}
                      </p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                        {health.warnings.length === 0 ? 'No issues' : 'Requires attention'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Request Log */}
            <Card className="border-emerald-500/20 bg-emerald-950/60 backdrop-blur-md shadow-lg shadow-emerald-900/30">
              <CardHeader className="pb-2 sm:pb-6 px-3 sm:px-6">
                <CardTitle className="text-sm sm:text-base font-medium">Request Log</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Recent API requests ({results.length} recorded)</CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                {results.length === 0 ? (
                  <div className="text-center py-8 sm:py-12 text-muted-foreground">
                    <div className="mx-auto w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-secondary/50 flex items-center justify-center mb-3 sm:mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <p className="text-xs sm:text-sm">No requests yet</p>
                    <p className="text-[10px] sm:text-xs mt-1">Click &quot;Make Request&quot; to start</p>
                  </div>
                ) : (
                  <div className="max-h-64 sm:max-h-96 overflow-y-auto space-y-1 sm:space-y-1.5">
                    {results.map((result) => (
                      <div
                        key={result.id}
                        className={`flex flex-col px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm overflow-hidden ${result.success
                            ? 'bg-emerald-500/5 border border-emerald-500/10'
                            : 'bg-red-500/5 border border-red-500/10'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                            <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${result.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            {result.success ? (
                              <code className="text-emerald-400 font-mono text-[10px] sm:text-xs flex-shrink-0">{result.keyUsed}</code>
                            ) : (
                              <span className="text-red-400 text-[10px] sm:text-xs truncate" title={result.error}>{result.error}</span>
                            )}
                          </div>
                          {result.duration !== undefined && (
                            <span className="text-[10px] sm:text-xs text-muted-foreground font-mono tabular-nums flex-shrink-0">
                              {result.duration}ms
                            </span>
                          )}
                        </div>
                        {result.health && (
                          <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 sm:gap-y-1 mt-1 sm:mt-1.5 pl-3 sm:pl-4 text-[10px] sm:text-xs text-muted-foreground">
                            <div className="flex items-center gap-1 sm:gap-1.5">
                              <div className={`h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full flex-shrink-0 ${getStatusDot(result.health.status)}`} />
                              <span className={getStatusColor(result.health.status)}>{result.health.status}</span>
                            </div>
                            <span className="hidden sm:inline">•</span>
                            <span className="tabular-nums">{result.health.availableKeys}/{result.health.totalKeys} keys</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="tabular-nums hidden sm:inline">{result.health.effectiveRps} rps</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="tabular-nums hidden sm:inline">{result.health.effectiveQuotaRemaining.toLocaleString()} quota</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Warnings */}
            {health?.warnings && health.warnings.length > 0 && (
              <Card className="border-amber-500/20 bg-amber-500/5">
                <CardHeader className="pb-2 px-3 sm:px-6">
                  <CardTitle className="text-sm sm:text-base font-medium text-amber-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>Active Warnings ({health.warnings.length})</span>
                  </CardTitle>
                  <CardDescription className="text-amber-400/60 text-xs sm:text-sm">
                    Issues detected in key pool that may affect availability
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-3 sm:px-6">
                  <div className="space-y-2">
                    {health.warnings.map((warning, i) => (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-2 text-xs sm:text-sm">
                        <Badge
                          variant="outline"
                          className={`text-[10px] sm:text-xs flex-shrink-0 w-fit ${warning.type === 'quota_exhausted'
                              ? 'border-red-500/30 text-red-400 bg-red-500/10'
                              : warning.type === 'circuit_open'
                                ? 'border-orange-500/30 text-orange-400 bg-orange-500/10'
                                : warning.type === 'rate_limited'
                                  ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10'
                                  : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                            }`}
                        >
                          {warning.type === 'quota_exhausted' ? 'Exhausted'
                            : warning.type === 'circuit_open' ? 'Circuit Open'
                              : warning.type === 'rate_limited' ? 'Rate Limited'
                                : warning.type === 'quota_warning' ? 'Quota Warning'
                                  : warning.type}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <span className="text-amber-400/80 break-words text-xs sm:text-sm">{warning.message}</span>
                          <span className="text-amber-400/40 text-[10px] sm:text-xs ml-1 sm:ml-2">({warning.keyId})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Footer */}
            <div className="text-center text-[10px] sm:text-xs text-muted-foreground pt-4 sm:pt-6 pb-16 sm:pb-8">
              <p>Built with keyrot - API key rotation and multiplexing</p>
              <p className="mt-1 text-emerald-400/60">Demo runs entirely in your browser - no server required</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

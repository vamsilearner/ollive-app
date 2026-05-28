'use client';

import { useState, useEffect } from 'react';
import { LatencyChart } from '@/components/dashboard/LatencyChart';
import { ThroughputChart } from '@/components/dashboard/ThroughputChart';
import { ErrorRateChart } from '@/components/dashboard/ErrorRateChart';

interface DashboardMetrics {
  latencyOverTime: { timestamp: string; avgLatencyMs: number }[];
  throughputOverTime: { timestamp: string; avgThroughput: number }[];
  errorRateOverTime: { timestamp: string; errorRate: number; totalRequests: number }[];
  summary: {
    totalRequests: number;
    totalErrors: number;
    avgLatency: number;
    avgThroughput: number;
  };
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => {
        setMetrics(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center text-red-500">
          <p className="text-lg font-medium">Failed to load metrics</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const summary = metrics?.summary;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <a href="/chat" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Chat
          </a>
          <h1 className="text-xl font-semibold text-gray-800">Analytics Dashboard</h1>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            title="Total Requests"
            value={summary?.totalRequests ?? 0}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
          <SummaryCard
            title="Avg Latency"
            value={summary?.avgLatency ? `${Math.round(summary.avgLatency)}ms` : 'N/A'}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <SummaryCard
            title="Avg Throughput"
            value={summary?.avgThroughput ? `${summary.avgThroughput.toFixed(1)} tok/s` : 'N/A'}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <SummaryCard
            title="Error Rate"
            value={summary?.totalRequests
              ? `${((summary.totalErrors / summary.totalRequests) * 100).toFixed(1)}%`
              : 'N/A'}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            variant={summary?.totalErrors ? 'warning' : 'default'}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LatencyChart data={metrics?.latencyOverTime ?? []} />
          <ThroughputChart data={metrics?.throughputOverTime ?? []} />
          <ErrorRateChart data={metrics?.errorRateOverTime ?? []} />
        </div>

        {(!metrics?.latencyOverTime?.length) && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg font-medium">No data yet</p>
            <p className="text-sm mt-1">Send some messages to see analytics appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon, variant = 'default' }: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: 'default' | 'warning';
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`text-2xl font-semibold mt-1 ${variant === 'warning' ? 'text-red-600' : 'text-gray-900'}`}>
            {value}
          </p>
        </div>
        <div className="p-2 bg-gray-100 rounded-lg text-gray-600">{icon}</div>
      </div>
    </div>
  );
}

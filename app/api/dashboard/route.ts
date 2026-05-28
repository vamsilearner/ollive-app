/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { db } from '@/src/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const client = db.$client;

    // Latency over time (hourly buckets, last 7 days)
    const latencyResult = client.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', timestamp) as bucket,
        AVG(latency_ms) as avg_latency_ms
      FROM inference_logs
      WHERE timestamp > datetime('now', '-7 days')
        AND status_code = 'SUCCESS'
      GROUP BY bucket
      ORDER BY bucket
    `).all();

    // Throughput over time (hourly buckets, last 7 days)
    const throughputResult = client.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', timestamp) as bucket,
        AVG(CAST(throughput_tokens_per_sec AS REAL)) as avg_throughput
      FROM inference_logs
      WHERE timestamp > datetime('now', '-7 days')
        AND status_code = 'SUCCESS'
      GROUP BY bucket
      ORDER BY bucket
    `).all();

    // Error rate over time (hourly buckets, last 7 days)
    const errorRateResult = client.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', timestamp) as bucket,
        SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END) as error_count,
        COUNT(*) as total_count,
        ROUND(CAST(SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) as error_rate
      FROM inference_logs
      WHERE timestamp > datetime('now', '-7 days')
      GROUP BY bucket
      ORDER BY bucket
    `).all();

    // Summary stats
    const summaryResult = client.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END) as total_errors,
        AVG(CASE WHEN status_code = 'SUCCESS' THEN latency_ms END) as avg_latency,
        AVG(CASE WHEN status_code = 'SUCCESS' THEN CAST(throughput_tokens_per_sec AS REAL) END) as avg_throughput
      FROM inference_logs
    `).all();

    const toNum = (v: unknown) => {
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };

    const rows = (r: any) => (Array.isArray(r) ? r : []);

    return NextResponse.json({
      latencyOverTime: rows(latencyResult).map((r: any) => ({
        timestamp: r.bucket,
        avgLatencyMs: toNum(r.avg_latency_ms),
      })),
      throughputOverTime: rows(throughputResult).map((r: any) => ({
        timestamp: r.bucket,
        avgThroughput: toNum(r.avg_throughput),
      })),
      errorRateOverTime: rows(errorRateResult).map((r: any) => ({
        timestamp: r.bucket,
        errorRate: toNum(r.error_rate),
        totalRequests: toNum(r.total_count),
      })),
      summary: Array.isArray(summaryResult) && summaryResult.length > 0 ? {
        totalRequests: toNum((summaryResult[0] as any).total_requests),
        totalErrors: toNum((summaryResult[0] as any).total_errors),
        avgLatency: toNum((summaryResult[0] as any).avg_latency),
        avgThroughput: toNum((summaryResult[0] as any).avg_throughput),
      } : { totalRequests: 0, totalErrors: 0, avgLatency: 0, avgThroughput: 0 },
    });
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
package io.github.syndred.keepany;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class MetadataCoordinator implements AutoCloseable {
    // Process-wide: activity/plugin recreation cannot bypass a still-running DNS lookup.
    private static final Semaphore slots = new Semaphore(MetadataPolicy.MAX_ACTIVE);
    interface Completion { void result(MetadataFetcher.Result result, String error); }
    private final MetadataFetcher fetcher;
    private final long timeoutMs;
    private final ExecutorService workers = Executors.newFixedThreadPool(MetadataPolicy.MAX_ACTIVE);
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, Job> active = new HashMap<>();
    private boolean closed;
    private static final class Job {
        final MetadataFetcher.Budget budget;
        final Completion completion;
        final AtomicBoolean settled = new AtomicBoolean(false);
        Job(long timeoutMs, Completion completion) { this.budget = new MetadataFetcher.Budget(timeoutMs); this.completion = completion; }
        void finish(MetadataFetcher.Result result, String error) { if (settled.compareAndSet(false, true)) completion.result(result, error); }
        void cancel() { budget.cancel(); finish(null, "metadata-timeout"); }
    }
    MetadataCoordinator() { this(new MetadataFetcher(), MetadataPolicy.TIMEOUT_MS); }
    MetadataCoordinator(MetadataFetcher fetcher, long timeoutMs) { this.fetcher = fetcher; this.timeoutMs = timeoutMs; }

    synchronized void read(String requestId, String url, Completion completion) {
        if (closed || active.size() >= MetadataPolicy.MAX_ACTIVE || active.containsKey(requestId) || !slots.tryAcquire()) { completion.result(null, "metadata-busy"); return; }
        Job job = new Job(timeoutMs, completion);
        active.put(requestId, job);
        ScheduledFuture<?> timeout = timer.schedule(job::cancel, timeoutMs, TimeUnit.MILLISECONDS);
        workers.execute(() -> {
            try { job.finish(fetcher.read(url, job.budget), null); }
            catch (Exception error) {
                job.finish(null, job.budget.expired() ? "metadata-timeout" : error instanceof MetadataPolicy.Failure ? ((MetadataPolicy.Failure) error).code : "metadata-network");
            } finally {
                timeout.cancel(false);
                synchronized (MetadataCoordinator.this) { active.remove(requestId, job); slots.release(); }
            }
        });
    }
    synchronized void cancel(String requestId) { Job job = active.get(requestId); if (job != null) job.cancel(); }
    synchronized int activeCount() { return active.size(); }
    @Override public synchronized void close() {
        closed = true;
        for (Job job : active.values()) job.cancel();
        // Cancelled queued jobs must still run their finally block and return
        // process-wide slots; shutdownNow would discard those tasks entirely.
        workers.shutdown(); timer.shutdownNow();
    }
}

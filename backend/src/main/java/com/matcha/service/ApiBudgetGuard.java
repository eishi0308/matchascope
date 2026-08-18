package com.matcha.service;

import com.matcha.model.ApiUsageCounter;
import com.matcha.repository.ApiUsageCounterRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.YearMonth;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A hard stop for the two metered APIs the photo-verification pipeline spends against, plus
 * regular progress checkpoints so a long discovery run can be watched rather than only found
 * out about afterward.
 *
 * <p>Counters are persisted via JPA rather than an in-memory field or a file, because the
 * ceiling is meant to hold across restarts within the same month — a counter that resets
 * every time the backend redeploys (Render's filesystem is ephemeral; the database is not)
 * would defeat the point.
 *
 * <p>The guarantee this can honestly make: this pipeline will never knowingly issue a request
 * past the configured ceiling. It cannot see usage from outside this pipeline (a shared API
 * key used elsewhere, manual testing against the same project) — pair this with a real
 * Google Cloud Billing budget alert for that gap.
 */
@Service
public class ApiBudgetGuard {

    @Autowired
    private ApiUsageCounterRepository repository;

    @Value("${photoverify.places.freeTierCeiling:950}")
    private int placesCeiling;

    @Value("${photoverify.openai.dollarCeiling:5.00}")
    private double openAiDollarCeiling;

    @Value("${photoverify.checkpointEvery:50}")
    private int checkpointEvery;

    // gpt-4o-mini pricing, per 1M tokens (developers.openai.com/api/docs/pricing, checked Aug 2026).
    // Revisit if OpenAI repriced the model — this only affects the *estimated* dollar ceiling,
    // never the Places ceiling, which is counted in raw requests regardless.
    private static final double INPUT_PRICE_PER_MILLION  = 0.15;
    private static final double OUTPUT_PRICE_PER_MILLION = 0.60;

    private static final String PLACES_METER    = "placesPhoto";
    private static final String OPENAI_IN_METER  = "openAiVisionTokensIn";
    private static final String OPENAI_OUT_METER = "openAiVisionTokensOut";
    private static final String OPENAI_REQ_METER = "openAiVisionRequests";

    // Guards against re-logging "STOPPED" on every subsequent call once a ceiling is hit —
    // in-memory only (per process), the persisted counters are the actual source of truth.
    private final Set<String> trippedLogged = ConcurrentHashMap.newKeySet();

    public ApiBudgetGuard() {}

    /** Test-only seam — production wiring always goes through the no-arg constructor + @Autowired. */
    ApiBudgetGuard(ApiUsageCounterRepository repository, int placesCeiling,
                   double openAiDollarCeiling, int checkpointEvery) {
        this.repository = repository;
        this.placesCeiling = placesCeiling;
        this.openAiDollarCeiling = openAiDollarCeiling;
        this.checkpointEvery = checkpointEvery;
    }

    public record UsageSnapshot(
            long placesUsed, int placesCeiling,
            double openAiSpent, double openAiDollarCeiling
    ) {}

    /** @return true if the request may proceed; false if it would exceed the free-tier ceiling. */
    public synchronized boolean tryConsumePlacesPhotoRequest() {
        String key  = periodKey(PLACES_METER);
        long   used = currentCount(key);

        if (used >= placesCeiling) {
            logStoppedOnce(key, String.format(
                    "%d/%d free Places Photo requests reached — halted before spending beyond the free tier",
                    used, placesCeiling));
            return false;
        }

        long updated = used + 1;
        saveCount(key, updated);

        if (updated % checkpointEvery == 0) {
            System.out.printf("[PhotoVerify] checkpoint — %d/%d free Places Photo requests used (%d remaining)%n",
                    updated, placesCeiling, placesCeiling - updated);
        }
        return true;
    }

    /** @return true if the call may proceed; false if it would exceed the configured dollar ceiling. */
    public synchronized boolean tryConsumeOpenAiVision(long estInputTokens, long estOutputTokens) {
        String inKey  = periodKey(OPENAI_IN_METER);
        String outKey = periodKey(OPENAI_OUT_METER);
        String reqKey = periodKey(OPENAI_REQ_METER);

        long inUsed  = currentCount(inKey);
        long outUsed = currentCount(outKey);

        // Checked against what spend would BECOME after this call, not what it is now — a
        // pre-check against current spend alone would let a single call overshoot the ceiling
        // by up to its own cost, which is exactly the "stop before it reaches the limit"
        // promise this guard exists to keep.
        double projectedSpend = dollarCost(inUsed + estInputTokens, outUsed + estOutputTokens);
        if (projectedSpend > openAiDollarCeiling) {
            logStoppedOnce(reqKey, String.format(
                    "OpenAI vision spend would exceed its $%.2f ceiling — halted before spending further",
                    openAiDollarCeiling));
            return false;
        }

        saveCount(inKey, inUsed + estInputTokens);
        saveCount(outKey, outUsed + estOutputTokens);
        long requests = currentCount(reqKey) + 1;
        saveCount(reqKey, requests);

        if (requests % checkpointEvery == 0) {
            System.out.printf("[PhotoVerify] checkpoint — OpenAI vision spend $%.4f / $%.2f ceiling (%d requests)%n",
                    projectedSpend, openAiDollarCeiling, requests);
        }
        return true;
    }

    /** Used/ceiling/remaining for both meters — for an end-of-run summary or a status endpoint. */
    public synchronized UsageSnapshot snapshot() {
        long placesUsed = currentCount(periodKey(PLACES_METER));
        long inUsed  = currentCount(periodKey(OPENAI_IN_METER));
        long outUsed = currentCount(periodKey(OPENAI_OUT_METER));
        return new UsageSnapshot(placesUsed, placesCeiling, dollarCost(inUsed, outUsed), openAiDollarCeiling);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private long currentCount(String key) {
        return repository.findById(key).map(ApiUsageCounter::getCount).orElse(0L);
    }

    private void saveCount(String key, long value) {
        repository.save(new ApiUsageCounter(key, value));
    }

    private double dollarCost(long inputTokens, long outputTokens) {
        return (inputTokens / 1_000_000.0) * INPUT_PRICE_PER_MILLION
                + (outputTokens / 1_000_000.0) * OUTPUT_PRICE_PER_MILLION;
    }

    /** Free-tier meters reset monthly, so the period is folded into the counter's own key. */
    private String periodKey(String meter) {
        return meter + ":" + YearMonth.now();
    }

    private void logStoppedOnce(String meterKey, String message) {
        if (trippedLogged.add(meterKey)) {
            System.out.println("[PhotoVerify] STOPPED — " + message);
        }
    }
}

package com.matcha.service;

import com.matcha.model.ApiUsageCounter;
import com.matcha.repository.ApiUsageCounterRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The guard's whole job is to never let a request through once a ceiling is reached, and to
 * keep enforcing that correctly across what simulates a restart — a fresh guard instance
 * reading counters an earlier instance persisted. A counter that only lived in memory would
 * pass a same-instance version of these assertions and still be wrong in production, where
 * the backend redeploys mid-month.
 */
class ApiBudgetGuardTest {

    private Map<String, ApiUsageCounter> store;
    private ApiUsageCounterRepository repository;

    @BeforeEach
    void setUp() {
        store = new HashMap<>();
        repository = mock(ApiUsageCounterRepository.class);
        when(repository.findById(anyString()))
                .thenAnswer(inv -> Optional.ofNullable(store.get(inv.getArgument(0, String.class))));
        when(repository.save(any(ApiUsageCounter.class)))
                .thenAnswer(inv -> {
                    ApiUsageCounter c = inv.getArgument(0);
                    store.put(c.getPeriodKey(), c);
                    return c;
                });
    }

    @Test
    @DisplayName("Places requests are allowed up to the ceiling, then refused")
    void placesCeilingTripsExactly() {
        ApiBudgetGuard guard = new ApiBudgetGuard(repository, 3, 5.00, 100);

        assertTrue(guard.tryConsumePlacesPhotoRequest());
        assertTrue(guard.tryConsumePlacesPhotoRequest());
        assertTrue(guard.tryConsumePlacesPhotoRequest());
        assertFalse(guard.tryConsumePlacesPhotoRequest(), "the 4th request must be refused at ceiling 3");
        assertFalse(guard.tryConsumePlacesPhotoRequest(), "stays refused, does not creep past the ceiling");
    }

    @Test
    @DisplayName("A ceiling reached in an earlier run stays reached after a restart")
    void ceilingSurvivesRestart() {
        ApiBudgetGuard firstRun = new ApiBudgetGuard(repository, 2, 5.00, 100);
        assertTrue(firstRun.tryConsumePlacesPhotoRequest());
        assertTrue(firstRun.tryConsumePlacesPhotoRequest());

        // A brand-new instance, same backing store — simulates the process restarting.
        ApiBudgetGuard afterRestart = new ApiBudgetGuard(repository, 2, 5.00, 100);
        assertFalse(afterRestart.tryConsumePlacesPhotoRequest(),
                "the counter must be read from storage, not reset just because the guard object is new");
    }

    @Test
    @DisplayName("OpenAI vision spend is refused once the dollar ceiling is reached")
    void openAiDollarCeilingTrips() {
        // $0.15/1M input + $0.60/1M output → 1M in + 1M out per call = $0.75/call, ceiling $1.00
        ApiBudgetGuard guard = new ApiBudgetGuard(repository, 1000, 1.00, 100);

        assertTrue(guard.tryConsumeOpenAiVision(1_000_000, 1_000_000), "first call: $0.75 spent, under $1.00");
        assertFalse(guard.tryConsumeOpenAiVision(1_000_000, 1_000_000),
                "second call would bring spend to $1.50 — must be refused, not charged");
    }

    @Test
    @DisplayName("A checkpoint logs exactly on the configured multiple, not on every request")
    void checkpointFiresOnMultiple() {
        ApiBudgetGuard guard = new ApiBudgetGuard(repository, 100, 5.00, 3);

        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        PrintStream original = System.out;
        System.setOut(new PrintStream(captured));
        try {
            for (int i = 0; i < 7; i++) {
                guard.tryConsumePlacesPhotoRequest();
            }
        } finally {
            System.setOut(original);
        }

        long checkpointLines = captured.toString().lines().filter(l -> l.contains("checkpoint")).count();
        assertEquals(2, checkpointLines, "checkpoints should fire at request 3 and request 6, not the other five");
    }

    @Test
    @DisplayName("snapshot() reports used/ceiling for both meters without mutating them")
    void snapshotIsReadOnly() {
        ApiBudgetGuard guard = new ApiBudgetGuard(repository, 10, 2.00, 100);
        guard.tryConsumePlacesPhotoRequest();
        guard.tryConsumeOpenAiVision(500_000, 100_000);

        ApiBudgetGuard.UsageSnapshot before = guard.snapshot();
        ApiBudgetGuard.UsageSnapshot after  = guard.snapshot();

        assertEquals(1, before.placesUsed());
        assertEquals(10, before.placesCeiling());
        assertTrue(before.openAiSpent() > 0);
        assertEquals(before.placesUsed(), after.placesUsed(), "reading the snapshot must not itself consume budget");
        assertEquals(before.openAiSpent(), after.openAiSpent());
    }

    @Test
    @DisplayName("Meters are keyed by month, so the ceiling resets on a new period")
    void periodKeyIncludesMonth() {
        ApiBudgetGuard guard = new ApiBudgetGuard(repository, 1, 5.00, 100);
        assertTrue(guard.tryConsumePlacesPhotoRequest());
        assertTrue(store.containsKey("placesPhoto:" + YearMonth.now()),
                "the counter row must be keyed with the current year-month");
    }
}

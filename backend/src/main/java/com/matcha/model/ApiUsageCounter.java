package com.matcha.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A persisted request/spend counter, one row per meter per period — e.g. id
 * {@code "placesPhoto:2026-08"}. Backed by the database rather than a file because the
 * production filesystem (Render) is ephemeral across deploys while the database is not, and
 * a counter that silently resets on every deploy defeats the point of a free-tier guard.
 *
 * @see com.matcha.service.ApiBudgetGuard
 */
@Entity
@Table(name = "api_usage_counters")
public class ApiUsageCounter {

    @Id
    private String periodKey;

    private long count;

    public ApiUsageCounter() {}

    public ApiUsageCounter(String periodKey, long count) {
        this.periodKey = periodKey;
        this.count = count;
    }

    public String getPeriodKey() { return periodKey; }
    public void setPeriodKey(String periodKey) { this.periodKey = periodKey; }

    public long getCount() { return count; }
    public void setCount(long count) { this.count = count; }
}

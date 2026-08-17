package com.matcha.repository;

import com.matcha.model.ApiUsageCounter;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ApiUsageCounterRepository extends JpaRepository<ApiUsageCounter, String> {
}

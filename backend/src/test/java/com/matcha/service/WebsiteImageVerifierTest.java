package com.matcha.service;

import com.matcha.model.TransparencyLevel;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * WebsiteImageVerifier's contract: try images in order, stop at the first one that
 * discloses sourcing, never check more than the configured cap, and never call OpenAI once
 * the budget guard has refused.
 */
class WebsiteImageVerifierTest {

    private final OpenAiService openAi = mock(OpenAiService.class);
    private final ApiBudgetGuard guard = mock(ApiBudgetGuard.class);

    @Test
    @DisplayName("No images on the page — returns empty without touching any API")
    void noImages() {
        WebsiteImageVerifier verifier = new WebsiteImageVerifier(openAi, guard, 4);
        assertTrue(verifier.verify(List.of()).isEmpty());
        verifyNoInteractions(openAi, guard);
    }

    @Test
    @DisplayName("Stops at the first image that discloses sourcing — does not check the rest")
    void earlyStopsOnFirstHit() {
        WebsiteImageVerifier verifier = new WebsiteImageVerifier(openAi, guard, 4);
        List<String> images = List.of("https://cafe.com/banner1.jpg", "https://cafe.com/banner2.jpg");

        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(openAi.classifyAndOcrWebsiteImage("https://cafe.com/banner1.jpg"))
                .thenReturn(new OpenAiService.ImageOcrResult(true, "Our matcha is grown in Nishio, Japan."));

        Optional<WebsiteImageVerifier.ImageEvidence> result = verifier.verify(images);

        assertTrue(result.isPresent());
        assertEquals(TransparencyLevel.A, result.get().level());
        assertEquals("https://cafe.com/banner1.jpg", result.get().imageUrl());
        verify(openAi, never()).classifyAndOcrWebsiteImage("https://cafe.com/banner2.jpg");
    }

    @Test
    @DisplayName("Never checks more images than photoverify.maxImagesPerCafe, even if more exist")
    void respectsMaxImagesPerCafe() {
        WebsiteImageVerifier verifier = new WebsiteImageVerifier(openAi, guard, 2);
        List<String> images = List.of("a.jpg", "b.jpg", "c.jpg", "d.jpg");

        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(openAi.classifyAndOcrWebsiteImage(anyString()))
                .thenReturn(new OpenAiService.ImageOcrResult(false, null));

        Optional<WebsiteImageVerifier.ImageEvidence> result = verifier.verify(images);

        assertTrue(result.isEmpty());
        verify(openAi, times(2)).classifyAndOcrWebsiteImage(anyString());
    }

    @Test
    @DisplayName("Stops the moment the budget guard refuses a request, mid-loop")
    void stopsWhenBudgetExhausted() {
        WebsiteImageVerifier verifier = new WebsiteImageVerifier(openAi, guard, 4);
        List<String> images = List.of("a.jpg", "b.jpg", "c.jpg");

        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true, false);
        when(openAi.classifyAndOcrWebsiteImage(anyString()))
                .thenReturn(new OpenAiService.ImageOcrResult(false, null));

        Optional<WebsiteImageVerifier.ImageEvidence> result = verifier.verify(images);

        assertTrue(result.isEmpty());
        verify(openAi, times(1)).classifyAndOcrWebsiteImage(anyString());
        verify(guard, times(2)).tryConsumeOpenAiVision(anyLong(), anyLong());
    }

    @Test
    @DisplayName("An image with no relevant text is skipped, not fatal")
    void noTextImageSkipped() {
        WebsiteImageVerifier verifier = new WebsiteImageVerifier(openAi, guard, 4);
        List<String> images = List.of("logo-free-photo.jpg", "story.jpg");

        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(openAi.classifyAndOcrWebsiteImage("logo-free-photo.jpg"))
                .thenReturn(new OpenAiService.ImageOcrResult(false, null));
        when(openAi.classifyAndOcrWebsiteImage("story.jpg"))
                .thenReturn(new OpenAiService.ImageOcrResult(true, "Our matcha is sourced directly from a farm in Uji, Kyoto."));

        Optional<WebsiteImageVerifier.ImageEvidence> result = verifier.verify(images);

        assertTrue(result.isPresent());
        assertEquals("story.jpg", result.get().imageUrl());
    }
}

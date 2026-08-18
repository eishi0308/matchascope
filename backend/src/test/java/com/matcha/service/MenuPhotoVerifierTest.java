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
 * MenuPhotoVerifier's contract with the discovery pipeline: try photos in order, stop at the
 * first one that discloses sourcing, never check more than the configured cap, and never call
 * an API the budget guard has already refused.
 */
class MenuPhotoVerifierTest {

    private final GooglePlacesService places = mock(GooglePlacesService.class);
    private final OpenAiService openAi       = mock(OpenAiService.class);
    private final ApiBudgetGuard guard       = mock(ApiBudgetGuard.class);

    private GooglePlacesService.PlaceInfo placeWithPhotos(List<String> photoNames) {
        return new GooglePlacesService.PlaceInfo(
                "gid-1", "Test Cafe", null, null, -33.8, 151.2, "Newtown", "1 Test St", photoNames);
    }

    @Test
    @DisplayName("No photos on the listing — returns empty without touching any API")
    void noPhotos() {
        MenuPhotoVerifier verifier = new MenuPhotoVerifier(places, openAi, guard, 4, 1024);
        assertTrue(verifier.verify(placeWithPhotos(List.of())).isEmpty());
        verifyNoInteractions(places, openAi, guard);
    }

    @Test
    @DisplayName("Stops at the first photo that discloses sourcing — does not check the rest")
    void earlyStopsOnFirstHit() {
        MenuPhotoVerifier verifier = new MenuPhotoVerifier(places, openAi, guard, 4, 1024);
        List<String> photoNames = List.of("photos/1", "photos/2", "photos/3");

        when(guard.tryConsumePlacesPhotoRequest()).thenReturn(true);
        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(places.fetchPhotoUri(eq("photos/1"), anyInt())).thenReturn("https://cdn/1.jpg");
        when(openAi.classifyAndOcrMenuPhoto("https://cdn/1.jpg"))
                .thenReturn(new OpenAiService.PhotoOcrResult(true,
                        "Our matcha is sourced from Uji, Kyoto. Latte $6.50"));

        Optional<MenuPhotoVerifier.PhotoEvidence> result = verifier.verify(placeWithPhotos(photoNames));

        assertTrue(result.isPresent());
        assertEquals(TransparencyLevel.A, result.get().level());
        assertEquals("photos/1", result.get().photoName());
        verify(places, times(1)).fetchPhotoUri(anyString(), anyInt());
        verify(places, never()).fetchPhotoUri(eq("photos/2"), anyInt());
        verify(places, never()).fetchPhotoUri(eq("photos/3"), anyInt());
    }

    @Test
    @DisplayName("Never checks more photos than photoverify.maxPhotosPerCafe, even if more exist")
    void respectsMaxPhotosPerCafe() {
        MenuPhotoVerifier verifier = new MenuPhotoVerifier(places, openAi, guard, 2, 1024);
        List<String> photoNames = List.of("photos/1", "photos/2", "photos/3", "photos/4");

        when(guard.tryConsumePlacesPhotoRequest()).thenReturn(true);
        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(places.fetchPhotoUri(anyString(), anyInt())).thenReturn("https://cdn/x.jpg");
        when(openAi.classifyAndOcrMenuPhoto(anyString()))
                .thenReturn(new OpenAiService.PhotoOcrResult(false, null)); // never a menu

        Optional<MenuPhotoVerifier.PhotoEvidence> result = verifier.verify(placeWithPhotos(photoNames));

        assertTrue(result.isEmpty());
        verify(places, times(2)).fetchPhotoUri(anyString(), anyInt());
    }

    @Test
    @DisplayName("Stops the moment the budget guard refuses a request, mid-loop")
    void stopsWhenBudgetExhausted() {
        MenuPhotoVerifier verifier = new MenuPhotoVerifier(places, openAi, guard, 4, 1024);
        List<String> photoNames = List.of("photos/1", "photos/2", "photos/3");

        // First photo: Places quota granted but nothing found; second photo: quota refused.
        when(guard.tryConsumePlacesPhotoRequest()).thenReturn(true, false);
        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(places.fetchPhotoUri(anyString(), anyInt())).thenReturn("https://cdn/x.jpg");
        when(openAi.classifyAndOcrMenuPhoto(anyString()))
                .thenReturn(new OpenAiService.PhotoOcrResult(false, null));

        Optional<MenuPhotoVerifier.PhotoEvidence> result = verifier.verify(placeWithPhotos(photoNames));

        assertTrue(result.isEmpty());
        verify(places, times(1)).fetchPhotoUri(anyString(), anyInt());
        verify(guard, times(2)).tryConsumePlacesPhotoRequest();
    }

    @Test
    @DisplayName("A photo that fails to fetch is skipped, not fatal — the next one is still tried")
    void unfetchablePhotoIsSkipped() {
        MenuPhotoVerifier verifier = new MenuPhotoVerifier(places, openAi, guard, 4, 1024);
        List<String> photoNames = List.of("photos/1", "photos/2");

        when(guard.tryConsumePlacesPhotoRequest()).thenReturn(true);
        when(guard.tryConsumeOpenAiVision(anyLong(), anyLong())).thenReturn(true);
        when(places.fetchPhotoUri(eq("photos/1"), anyInt())).thenReturn(null); // fetch failed
        when(places.fetchPhotoUri(eq("photos/2"), anyInt())).thenReturn("https://cdn/2.jpg");
        when(openAi.classifyAndOcrMenuPhoto("https://cdn/2.jpg"))
                .thenReturn(new OpenAiService.PhotoOcrResult(true, "Matcha sourced from Nishio, Japan."));

        Optional<MenuPhotoVerifier.PhotoEvidence> result = verifier.verify(placeWithPhotos(photoNames));

        assertTrue(result.isPresent());
        assertEquals("photos/2", result.get().photoName());
        verify(openAi, never()).classifyAndOcrMenuPhoto(isNull());
    }
}

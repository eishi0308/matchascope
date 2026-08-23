package com.matcha.service;

import com.matcha.model.TransparencyLevel;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Every string below is real text taken from the audited cafe sites, so a regression
 * here means a live cafe would be graded wrongly again.
 */
class TransparencyGraderTest {

    // ── A cafe whose disclosure only exists once the page is rendered ─────────────

    @Test
    @DisplayName("Tori's: origins stated only on a JS-built shop page grade A once the text is read")
    void renderedShopPageGradesA() {
        // Verbatim from the rendered /s/order page. Fetched statically the same URL returns
        // 200 with zero occurrences of any of these words, which is why this cafe sat at D
        // while publishing four Japanese growing regions.
        String rendered = "Ami - Artisan Matcha Shizuoka Matcha Powder Tasting note: Nutty, sweet, "
                + "aromatic Net 30g. A$52.00 Kai - Artisan Matcha Uji and Mie Matcha Powder "
                + "Tasting note: Umami, balanced, buttery Net 30g. A$55.00 Mika - Artisan Matcha "
                + "Yame, Fukuoka Matcha Powder Tasting note: Natural subtle, seaweed, aromatic Net 30g.";

        TransparencyGrader.Evidence evidence = TransparencyGrader.findBestEvidence(rendered);
        assertNotNull(evidence, "a named growing region on a shop page is a disclosure");
        assertEquals(TransparencyLevel.A, evidence.level(),
                "Shizuoka, Uji and Yame are named growing regions — Level A");
    }

    @Test
    @DisplayName("A shell is not a silent cafe: 13 characters of chrome must not be gradeable")
    void emptyShellIsNotReadable() {
        // The entire visible text of a 77 KB Square Online homepage.
        assertTrue(ScraperService.looksUnread("Home | Tori's"),
                "a page whose whole text is its title was not read");
        // A rendered shell reaches a few hundred characters of navigation before its
        // content paints — still nothing on the subject, so still not a reading.
        assertTrue(ScraperService.looksUnread(
                "Home About Contact Order Online Gift Cards Careers Privacy Policy Terms of Service "
                        + "Follow us Instagram Facebook Sign in Create account Search Cart 0 items"),
                "navigation is not content");
        // A cafe that really was read and really said nothing must stay gradeable.
        assertFalse(ScraperService.looksUnread(
                "We serve matcha lattes made with ceremonial grade matcha, sourced from our supplier. "
                        + "Our cafe opened in 2019 and we roast our own coffee in house every week. "
                        + "Come and try our matcha soft serve, matcha cake and iced matcha drinks today. "
                        + "We are open seven days a week from 7am, and we welcome dogs on the terrace."),
                "a real page that discloses nothing is a finding, not a failure to read");
    }

    // ── A disclosure past the first matcha mention, in punctuation-free text ──────

    @Test
    @DisplayName("OUJI Instagram bio: a later, specific mention must not be shadowed by an earlier generic one")
    void secondMatchaMentionCarriesTheDisclosure() {
        // Real text rendered from Instagram — no sentence punctuation at all, which is
        // exactly what leaves candidatePassages() unable to split it into separate
        // sentences. The passage stays one long run-on segment, and tightening used to
        // anchor its one window to the FIRST "matcha" ("Matcha Cafe" in the name) —
        // ~190 characters before the real disclosure, outside a single ±150 window.
        String bio = "OUJI | Matcha Cafe & Pop Up - Matcha in Sydney ouji.sydney 📍"
                + "Sydney matcha cafe, Haymarket 𝗢𝗣𝗘𝗡 7 days "
                + "Mon-Fri : 6.30am - 7pm Sat-Sun: 6.30am - 6pm we’re using 1st harvest Uji matcha";

        TransparencyGrader.Evidence evidence = TransparencyGrader.findBestEvidence(bio);
        assertNotNull(evidence, "the 'Uji matcha' disclosure must not be discarded for sitting past the first mention");
        assertEquals(TransparencyLevel.A, evidence.level());
        assertTrue(evidence.quote().toLowerCase().contains("uji"), "the kept passage must actually carry the region name");
    }

    // ── Cases that were wrongly stuck at B ────────────────────────────────────

    @Test
    @DisplayName("Cha Haus: region in a product name is Level A even when the AI quoted something weaker")
    void chaHaus() {
        String page = "Our collection includes a variety of teas sourced from different regions of Japan. "
                + "CHA HAUS - Matcha Powder 50g | 抹茶パウダー | Uji, Kyoto 50g Regular price $39.00 AUD "
                + "CHA HAUS - Matcha Powder 50g | 抹茶パウダー | Yame, Fukuoka 50g Regular price $38.00 AUD";
        String weakAiQuote = "Our collection includes a variety of teas sourced from different regions of Japan.";

        // Not even B on its own: it places a collection of teas in Japan without saying
        // anything about the matcha. The page scan has always read it that way, and the
        // analyser channel now agrees rather than grading the same words one step higher.
        assertEquals(TransparencyLevel.C, TransparencyGrader.gradeVerifiedQuote(weakAiQuote),
                "'a variety of teas' is not a claim about this cafe's matcha");
        assertEquals(TransparencyGrader.gradeVerifiedQuote(weakAiQuote),
                TransparencyGrader.decide(null, weakAiQuote) == null
                        ? TransparencyLevel.C
                        : TransparencyGrader.decide(null, weakAiQuote).level(),
                "both channels must reach the same verdict on the same sentence");

        TransparencyGrader.Evidence decided = TransparencyGrader.decide(weakAiQuote, page);
        assertNotNull(decided);
        assertEquals(TransparencyLevel.A, decided.level(), "the page names Uji and Yame");
        assertTrue(page.contains(decided.quote()), "stored quote must be verbatim from the page");
        assertTrue(decided.quote().toLowerCase().contains("matcha"));
    }

    @Test
    @DisplayName("OOOZY: 'ceremonial matcha from Uji'")
    void ooozy() {
        String page = "sourcing the finest global ingredients — ceremonial matcha from Uji, "
                + "authentic Filipino ube, and fresh local berries.";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide("ceremonial matcha from Japan", page).level());
    }

    @Test
    @DisplayName("T Totaler: 'Ceremonial Matcha - Kagoshima' product line")
    void tTotaler() {
        String page = "highest quality tea to you as ethically as possible. GREEN TEA Quick View "
                + "Ceremonial Matcha - Kagoshima Price $39.50 Quick View Hojicha Powder";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(
                "We have been working with matcha for over a decade importing monthly shipments directly from Japan.",
                page).level());
    }

    @Test
    @DisplayName("Chatime: 'Tencha leaves grown in Nishio'")
    void chatime() {
        String page = "This is premium Japanese matcha, stone-milled from 100% single-origin "
                + "Tencha leaves grown in Nishio, one of the world's most respected matcha regions.";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(null, page).level());
    }

    @Test
    @DisplayName("LUPICIA: 'Yame Matcha Gokou ... from Fukuoka'")
    void lupicia() {
        String page = "Matcha Yame Gokou This stone-milled Yame Matcha Gokou uses first-flush "
                + "Gokou leaves from Fukuoka's famed Yame region.";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(null, page).level());
    }

    @Test
    @DisplayName("Taka Tea Garden: 'Matcha Ujicha' — region fused into the product name")
    void compoundOriginInProductName() {
        String page = "Shopping Cart Matcha Ujicha $ 42.00 Weight: 30g Tea Species: Camellia Sinensis "
                + "(Unfermented green tea leaves powder) Origin: Japan";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(null, page).level());
    }

    @Test
    @DisplayName("Dulcet: a named Japanese tea house is A")
    void namedJapaneseProducer() {
        String page = "MATCHA YUZU, fresh and zesty flavour combination. Authentic Marukyu Koyamaen "
                + "Matcha Powder elevated by the tang of yuzu.";
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(null, page).level());
    }

    // ── Cases that must NOT move ──────────────────────────────────────────────

    @Test
    @DisplayName("Oh!Matcha: 'harvested in Japan' with no region stays B")
    void japanOnlyStaysB() {
        String page = "Our Matcha and other teas are grow and harvested in Japan. The leaves are picked "
                + "to ensure only the youngest, most tender leaves are selected.";
        assertEquals(TransparencyLevel.B, TransparencyGrader.decide(null, page).level());
    }

    @Test
    @DisplayName("Taka Tea Garden: prefectures inside academic citations are not sourcing evidence")
    void academicCitationsRejected() {
        String page = "Prof. of Food Sciences, Dept of Food & Nutritional Services, University of Shizuoka, "
                + "Hamamatsu College. Green tea catechin research at the Aichi Cancer Institute. "
                + "Every cup of matcha you enjoy contains EGCG naturally.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "a university named after a prefecture is not an origin disclosure");
    }

    @Test
    @DisplayName("A region named for a non-matcha product does not lift the matcha grade")
    void regionForOtherProductIgnored() {
        String page = "JSY Japanese Chiran Sencha 100g Green Tea Tin Loose Leaf Premium Tea $58.00. "
                + "Mino-yaki teaware crafted from the rich local clay of Gifu Prefecture. "
                + "Elsewhere on the page: Japanese Premium Matcha 50g Green Tea $50.00";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "Chiran sencha and Gifu pottery say nothing about the matcha");
    }

    @Test
    @DisplayName("JSY Tea: a region describing the sencha base is not the matcha's origin")
    void regionBelongingToAnotherTeaRejected() {
        String page = "GRAPES SENCHA Shizuoka Sencha is used as the base tea, and it is blended "
                + "with grape powder and matcha powder.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "Shizuoka qualifies the sencha, not the matcha");

        String hojicha = "JSY Japanese Yame Hojicha Green Tea Tea Bags 15pcs $25.00 matcha available";
        TransparencyGrader.Evidence h = TransparencyGrader.decide(null, hojicha);
        assertTrue(h == null || h.level() != TransparencyLevel.A, "Yame qualifies the hojicha");
    }

    @Test
    @DisplayName("LUPICIA: a navigation menu is not a sourcing disclosure")
    void navigationMenuRejected() {
        String menu = "G reen Tea Single Es tate Plantation Specified Single Origin Estate, "
                + "Plantation, Specified Japanese Green Teas Sencha Matcha G reen Tea + Accessories";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, menu);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "'Estate/Plantation' in a menu names no farm and no region");
    }

    @Test
    @DisplayName("The farm+Japan route to A survives for an analyser-chosen quote")
    void facilityRouteStillWorksForAiQuote() {
        String page = "Our matcha comes from a single family farm in Japan that we visit each spring.";
        assertEquals(TransparencyLevel.A, TransparencyGrader.gradeVerifiedQuote(
                "Our matcha comes from a single family farm in Japan that we visit each spring."));
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(
                "Our matcha comes from a single family farm in Japan that we visit each spring.", page).level());
    }

    @Test
    @DisplayName("Among equally strong passages, the one that reads as a sourcing statement wins")
    void prefersSourcingStatementOverProductLabel() {
        String page = "Uji Matcha Latte $9.00. Our matcha is stone-milled and sourced from Uji, Kyoto, "
                + "where the leaf has been shaded for centuries.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertEquals(TransparencyLevel.A, e.level());
        assertTrue(e.quote().toLowerCase().contains("sourced from uji"),
                "should quote the sentence, not the menu line; got: " + e.quote());
    }

    @Test
    @DisplayName("JSY Tea: a Gifu matcha bowl is teaware, not a matcha origin")
    void teawareOriginRejected() {
        String page = "Japanese Matcha Bowl Tea Cup Mino-yaki, or Minoware, refers to traditional "
                + "Japanese pottery originating from the former Mino Province, centered around the "
                + "towns of Tajimi, Toki, Mizunami, and Kawagoe in Gifu Prefecture.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "pottery provenance is not leaf provenance; got: " + (e == null ? "null" : e.quote()));

        String whisk = "Matcha Whisk Chasen handcrafted in Nara for the tea ceremony.";
        TransparencyGrader.Evidence w = TransparencyGrader.decide(null, whisk);
        assertTrue(w == null || w.level() != TransparencyLevel.A, "a whisk made in Nara is not matcha from Nara");
    }

    @Test
    @DisplayName("Equipment on the page does not suppress a real matcha disclosure beside it")
    void equipmentDoesNotMaskRealEvidence() {
        String page = "Matcha Bowl handmade in Gifu. Our ceremonial matcha is grown in Uji, Kyoto.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertEquals(TransparencyLevel.A, e.level());
        assertTrue(e.quote().toLowerCase().contains("uji"));
    }

    @Test
    @DisplayName("Storefront chrome is trimmed off the quote, and the quote stays verbatim")
    void chromeTrimmedButStillVerbatim() {
        String page = "Couldn't load pickup availability Refresh Grown in the misty mountain valleys "
                + "of Yame, Fukuoka, this premium matcha is celebrated for its rich umami.";
        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, page);
        assertEquals(TransparencyLevel.A, e.level());
        assertTrue(e.quote().startsWith("Grown in the misty"), "got: " + e.quote());
        assertTrue(page.contains(e.quote()), "quote must remain a verbatim substring");
    }

    @Test
    @DisplayName("Resellers and grade words remain C")
    void resellersStayC() {
        assertEquals(TransparencyLevel.C, TransparencyGrader.gradeVerifiedQuote("Matcha Maiden matcha."));
        assertEquals(TransparencyLevel.C, TransparencyGrader.gradeVerifiedQuote("to premium matcha from Zen Wonders"));
        assertEquals(TransparencyLevel.C, TransparencyGrader.gradeVerifiedQuote("first harvest matcha latte"));
        assertNull(TransparencyGrader.decide("Somage for matcha and chai.", "Somage for matcha and chai."));
    }

    @Test
    @DisplayName("A hallucinated quote is still rejected, and cannot be laundered into evidence")
    void hallucinationStillRejected() {
        String page = "We serve matcha lattes and cakes daily.";
        String invented = "Our matcha is sourced from a family farm in Uji, Kyoto.";
        assertFalse(TransparencyGrader.appearsVerbatim(invented, page));
        TransparencyGrader.Evidence e = TransparencyGrader.decide(invented, page);
        assertTrue(e == null || !e.quote().equals(invented), "invented text must never be stored");
    }

    @Test
    @DisplayName("Evidence returned is always a verbatim substring of the page")
    void evidenceIsAlwaysVerbatim() {
        String page = "Welcome. CHA HAUS - Matcha Powder 50g | Uji, Kyoto 50g Regular price $39.00 AUD. Visit us.";
        TransparencyGrader.Evidence e = TransparencyGrader.findBestEvidence(page);
        assertNotNull(e);
        assertTrue(page.contains(e.quote()));
        assertTrue(TransparencyGrader.appearsVerbatim(e.quote(), page));
    }

    @Test
    @DisplayName("Empty and null input never produce a grade above C")
    void emptyInput() {
        assertNull(TransparencyGrader.decide(null, null));
        assertNull(TransparencyGrader.decide(null, ""));
        assertNull(TransparencyGrader.findBestEvidence(""));
        assertEquals(TransparencyLevel.C, TransparencyGrader.grade(null, ""));
        assertEquals(TransparencyLevel.C, TransparencyGrader.grade("", "we serve coffee"));
    }

    @Test
    @DisplayName("A missing AI quote no longer caps the grade — the page is still read")
    void absentQuoteNoLongerCapsGrade() {
        assertEquals(TransparencyLevel.A, TransparencyGrader.grade(null, "our matcha comes from Uji"),
                "the page proves Uji whether or not the analyser quoted it");
    }

    // ── One ladder for both channels ──────────────────────────────────────────
    // A cafe holding a stored quote was graded on a different rule set from one
    // holding none: the farm+Japan route to A existed only for the quote. Levels C
    // and B were regraded on opposite sides of that split, so the same sentence
    // could yield A on one row and B on another.

    @Test
    @DisplayName("The farm+Japan route reaches A from page text too, not only from a quote")
    void facilityRouteReachableFromPageText() {
        String sentence = "Our matcha is grown on a single family farm in Japan and milled the week it ships.";

        assertEquals(TransparencyLevel.A, TransparencyGrader.gradeVerifiedQuote(sentence),
                "quote channel");
        assertEquals(TransparencyLevel.A, TransparencyGrader.decide(null, sentence).level(),
                "text channel must reach the same level on the same words");
    }

    @Test
    @DisplayName("Without a sourcing verb the facility route still cannot fire on raw page text")
    void facilityRouteNeedsSourcingVerbInPageText() {
        String menu = "Japanese Green Teas Single Estate Plantation Matcha Sencha Gyokuro Accessories";

        TransparencyGrader.Evidence e = TransparencyGrader.decide(null, menu);
        assertTrue(e == null || e.level() != TransparencyLevel.A,
                "a menu listing 'Estate' and 'Japanese' states no sourcing; got: " + e);
    }

    @Test
    @DisplayName("A cafe with no stored quote grades the same as one whose quote says the same thing")
    void bothChannelsAgreeOnTheSamePage() {
        String page = "We serve matcha sourced from our own tea garden in Japan, harvested each May.";

        TransparencyGrader.Evidence withQuote = TransparencyGrader.decide(page, page);
        TransparencyGrader.Evidence withoutQuote = TransparencyGrader.decide(null, page);

        assertNotNull(withoutQuote);
        assertEquals(withQuote.level(), withoutQuote.level(),
                "the grade must not depend on whether a quote happened to be stored");
    }
}

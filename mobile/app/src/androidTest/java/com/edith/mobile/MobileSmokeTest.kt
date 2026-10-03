package com.edith.mobile

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class MobileSmokeTest {
    @get:Rule val composeRule = createAndroidComposeRule<MainActivity>()

    @Test fun honestUnconfiguredHomeIsVisible() {
        composeRule.onNodeWithText("E.D.I.T.H.").assertIsDisplayed()
        composeRule.onNodeWithText("Seçili trusted PC yok").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Emergency Stop gönder")
            .assertIsDisplayed()
            .assertIsNotEnabled()
    }

    @Test fun pairingScreenDoesNotRequestOrExposeASecret() {
        composeRule.onNodeWithText("PC'ler").performClick()
        composeRule.onNodeWithText("Güvenli eşleştirmeyi başlat").assertIsDisplayed()
        composeRule.onNodeWithText("Eşleştirme başlatılmadı").assertIsDisplayed()
        composeRule.onAllNodesWithText("One-time code").assertCountEquals(0)
    }

    @Test fun handoffScreenShowsHonestUnavailableState() {
        composeRule.onNodeWithText("Handoff").performClick()
        composeRule.onNodeWithText("CROSS-DEVICE HANDOFF").assertIsDisplayed()
        composeRule.onNodeWithText("Capability handshake bekleniyor").assertIsDisplayed()
        composeRule.onNodeWithText("Dosya seç ve doğrulanmış aktarımı başlat").assertIsNotEnabled()
    }
}

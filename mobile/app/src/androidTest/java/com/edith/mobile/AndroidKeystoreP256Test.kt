package com.edith.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.edith.mobile.security.MobilePairingKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidKeystoreP256Test {
    @Test
    fun createsSeparateSigningAndAgreementKeysWithoutSoftwareFallback() {
        val keys = MobilePairingKeys(aliasPrefix = "edith.mobile.test.p256")
        try {
            val publicKeys = keys.ensureKeys()
            assertEquals("ECDSA-P256-SHA256", publicKeys.signing.algorithm)
            assertEquals("ECDH-P256", publicKeys.agreement.algorithm)
            assertNotEquals(publicKeys.signing.fingerprint, publicKeys.agreement.fingerprint)
            assertTrue(publicKeys.signing.fingerprint.matches(Regex("^[a-f0-9]{64}$")))
            assertTrue(publicKeys.agreement.fingerprint.matches(Regex("^[a-f0-9]{64}$")))
        } finally {
            keys.delete()
        }
    }
}

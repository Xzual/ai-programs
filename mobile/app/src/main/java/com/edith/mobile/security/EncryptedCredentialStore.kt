package com.edith.mobile.security

import android.content.Context
import android.annotation.SuppressLint
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface CredentialStore {
    fun putEncrypted(id: String, secret: ByteArray): Boolean
    fun readDecrypted(id: String): ByteArray?
    fun remove(id: String): Boolean
    fun wipeAll(): Boolean
}

class AndroidKeystoreCredentialStore(context: Context) : CredentialStore {
    private val preferences = context.getSharedPreferences("edith_mobile_ciphertext_v1", Context.MODE_PRIVATE)
    private val alias = "edith_mobile_credential_wrap_v1"
    private val keyStore: KeyStore get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @SuppressLint("ApplySharedPref")
    override fun putEncrypted(id: String, secret: ByteArray): Boolean {
        require(id.matches(Regex("^[A-Za-z0-9._-]{1,128}$")))
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val ciphertext = cipher.doFinal(secret)
            val packed = cipher.iv + ciphertext
            return preferences.edit().putString(id, android.util.Base64.encodeToString(packed, android.util.Base64.NO_WRAP)).commit()
        } finally {
            secret.fill(0)
        }
    }

    override fun readDecrypted(id: String): ByteArray? {
        val encoded = preferences.getString(id, null) ?: return null
        val packed = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
        if (packed.size <= IV_BYTES) return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, packed.copyOfRange(0, IV_BYTES)))
        return cipher.doFinal(packed.copyOfRange(IV_BYTES, packed.size))
    }

    @SuppressLint("ApplySharedPref")
    override fun remove(id: String): Boolean = preferences.edit().remove(id).commit()

    @SuppressLint("ApplySharedPref")
    override fun wipeAll(): Boolean {
        // Synchronous deletion is intentional: callers report wipe success only after disk commit.
        val persisted = preferences.edit().clear().commit()
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
        return persisted
    }

    private fun key(): SecretKey {
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object { const val IV_BYTES = 12 }
}

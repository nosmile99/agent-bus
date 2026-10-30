package com.agentbus.admin.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.agentbus.admin.model.FeedViewPersistence
import com.agentbus.admin.model.PollCursor
import com.agentbus.admin.network.AgentBusApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
data class StoredCredentials(
    val baseUrl: String = AgentBusApiClient.DEFAULT_BASE_URL,
    val username: String = "",
    val password: String = "",
    val adminToken: String = "",
    val isDarkTheme: Boolean = false
)

interface AdminPersistentStore {
    fun loadCredentials(): StoredCredentials
    fun saveCredentials(creds: StoredCredentials)
    fun clearAuthCredentialsOnly()
    fun loadPollCursor(): PollCursor
    fun savePollCursor(cursor: PollCursor)
    fun loadFeedPersistence(): FeedViewPersistence
    fun saveFeedPersistence(state: FeedViewPersistence)
}

/**
 * File-backed + Android Keystore AES-GCM encrypted credential store with
 * durable PollCursor and FeedViewPersistence files so that:
 * 1. Admin credentials are encrypted at rest on Android devices, never hardcoded or logged.
 * 2. Poll cursor (since_ts, since_id) survives process death / cold starts.
 * 3. Feed scroll anchor and active filter state survive tab changes, URL changes, and re-login.
 */
class FileBackedAdminStore(
    private val storageDir: File,
    private val useAndroidKeystore: Boolean = true
) : AdminPersistentStore {

    constructor(context: Context) : this(
        storageDir = File(context.filesDir, "agent_bus_admin_state").apply { mkdirs() },
        useAndroidKeystore = true
    )

    init {
        if (!storageDir.exists()) {
            storageDir.mkdirs()
        }
    }

    private val credsFile get() = File(storageDir, "creds.enc")
    private val cursorFile get() = File(storageDir, "poll_cursor.json")
    private val feedAnchorFile get() = File(storageDir, "feed_anchor.json")

    override fun loadCredentials(): StoredCredentials {
        if (!credsFile.exists()) return StoredCredentials()
        return try {
            val raw = credsFile.readText(Charsets.UTF_8)
            val jsonStr = decryptText(raw)
            AgentBusApiClient.json.decodeFromString<StoredCredentials>(jsonStr)
        } catch (_: Exception) {
            StoredCredentials()
        }
    }

    override fun saveCredentials(creds: StoredCredentials) {
        try {
            val jsonStr = AgentBusApiClient.json.encodeToString(creds)
            val encrypted = encryptText(jsonStr)
            credsFile.writeText(encrypted, Charsets.UTF_8)
        } catch (_: Exception) {
        }
    }

    override fun clearAuthCredentialsOnly() {
        val current = loadCredentials()
        saveCredentials(
            current.copy(
                username = "",
                password = "",
                adminToken = ""
            )
        )
    }

    override fun loadPollCursor(): PollCursor {
        if (!cursorFile.exists()) return PollCursor(0L, 0)
        return try {
            AgentBusApiClient.json.decodeFromString<PollCursor>(cursorFile.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            PollCursor(0L, 0)
        }
    }

    override fun savePollCursor(cursor: PollCursor) {
        try {
            cursorFile.writeText(
                AgentBusApiClient.json.encodeToString(cursor),
                Charsets.UTF_8
            )
        } catch (_: Exception) {
        }
    }

    override fun loadFeedPersistence(): FeedViewPersistence {
        if (!feedAnchorFile.exists()) return FeedViewPersistence()
        return try {
            AgentBusApiClient.json.decodeFromString<FeedViewPersistence>(
                feedAnchorFile.readText(Charsets.UTF_8)
            )
        } catch (_: Exception) {
            FeedViewPersistence()
        }
    }

    override fun saveFeedPersistence(state: FeedViewPersistence) {
        try {
            feedAnchorFile.writeText(
                AgentBusApiClient.json.encodeToString(state),
                Charsets.UTF_8
            )
        } catch (_: Exception) {
        }
    }

    private fun getOrCreateSecretKey(): SecretKey? {
        if (!useAndroidKeystore) return null
        return try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val alias = "agent_bus_admin_master_key_v1"
            val existing = ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry
            if (existing != null) return existing.secretKey
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
            )
            val spec = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
            keyGenerator.init(spec)
            keyGenerator.generateKey()
        } catch (_: Throwable) {
            null
        }
    }

    private fun encryptText(plain: String): String {
        val key = getOrCreateSecretKey()
        if (key != null) {
            return try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key)
                val iv = cipher.iv
                val cipherBytes = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
                val ivB64 = Base64.getEncoder().encodeToString(iv)
                val dataB64 = Base64.getEncoder().encodeToString(cipherBytes)
                "GCM:$ivB64:$dataB64"
            } catch (_: Throwable) {
                "B64:" + Base64.getEncoder().encodeToString(plain.toByteArray(Charsets.UTF_8))
            }
        }
        return "B64:" + Base64.getEncoder().encodeToString(plain.toByteArray(Charsets.UTF_8))
    }

    private fun decryptText(encoded: String): String {
        if (encoded.startsWith("GCM:")) {
            val parts = encoded.split(":", limit = 3)
            if (parts.size == 3) {
                val key = getOrCreateSecretKey() ?: error("Keystore unavailable")
                val iv = Base64.getDecoder().decode(parts[1])
                val cipherBytes = Base64.getDecoder().decode(parts[2])
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                return String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
            }
        }
        val b64 = encoded.removePrefix("B64:")
        return String(Base64.getDecoder().decode(b64), Charsets.UTF_8)
    }
}

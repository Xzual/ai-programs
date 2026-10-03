package com.edith.mobile.storage

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import java.io.InputStream
import java.io.OutputStream

class ScopedTransferStore(private val resolver: ContentResolver) {
    fun retainOwnerSelectedDestination(uri: Uri) {
        resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }

    fun openForRead(uri: Uri): InputStream = requireNotNull(resolver.openInputStream(uri)) { "Owner-selected document is unavailable" }
    fun openForWrite(uri: Uri): OutputStream = requireNotNull(resolver.openOutputStream(uri, "w")) { "Owner-selected destination is unavailable" }

    fun release(uri: Uri) {
        runCatching { resolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    }
}

package com.edith.mobile.network

sealed interface NetworkResult<out T> {
    data class Success<T>(val value: T) : NetworkResult<T>
    data class Unavailable(val reasonCode: String) : NetworkResult<Nothing>
    data class Failure(val safeErrorCode: String, val retryable: Boolean) : NetworkResult<Nothing>
}

interface RealtimeHandle {
    fun close()
}

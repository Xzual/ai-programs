package com.edith.mobile.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val EdithDark = darkColorScheme(
    primary = Color(0xFF38BDF8),
    onPrimary = Color(0xFF02131F),
    secondary = Color(0xFF818CF8),
    tertiary = Color(0xFF67E8F9),
    background = Color(0xFF020617),
    surface = Color(0xFF07111F),
    surfaceVariant = Color(0xFF0F1B2D),
    onBackground = Color(0xFFE2E8F0),
    onSurface = Color(0xFFE2E8F0),
    error = Color(0xFFFB7185),
)

@Composable
fun EdithTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = EdithDark,
        shapes = MaterialTheme.shapes.copy(
            small = RoundedCornerShape(4.dp),
            medium = RoundedCornerShape(8.dp),
            large = RoundedCornerShape(8.dp),
        ),
        content = content,
    )
}

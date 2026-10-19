package com.astryx.kitchensink.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

/**
 * Kitchen-sink theme: Material3 wired to the generated design tokens
 * (see design-tokens/tokens.json — the single source of truth).
 *
 * Light theme uses one-step-darker brand derivatives for 4.5:1 contrast;
 * the dark theme uses the exact brand hexes on OLED-friendly near-black.
 */

private val LightColorScheme = lightColorScheme(
    primary = ColorSemanticLightPrimary,
    onPrimary = ColorSemanticLightOnPrimary,
    primaryContainer = ColorSemanticLightPrimaryContainer,
    onPrimaryContainer = ColorSemanticLightOnPrimaryContainer,
    secondary = ColorSemanticLightSecondary,
    onSecondary = ColorSemanticLightOnSecondary,
    secondaryContainer = ColorSemanticLightSecondaryContainer,
    onSecondaryContainer = ColorSemanticLightOnSecondaryContainer,
    tertiary = ColorSemanticLightTertiary,
    onTertiary = ColorSemanticLightOnTertiary,
    tertiaryContainer = ColorSemanticLightTertiaryContainer,
    onTertiaryContainer = ColorSemanticLightOnTertiaryContainer,
    error = ColorSemanticLightError,
    onError = ColorSemanticLightOnError,
    errorContainer = ColorSemanticLightErrorContainer,
    onErrorContainer = ColorSemanticLightOnErrorContainer,
    background = ColorSemanticLightBackground,
    onBackground = ColorSemanticLightOnBackground,
    surface = ColorSemanticLightSurface,
    onSurface = ColorSemanticLightOnSurface,
    surfaceVariant = ColorSemanticLightSurfaceVariant,
    onSurfaceVariant = ColorSemanticLightOnSurfaceVariant,
    surfaceTint = ColorSemanticLightPrimary,
    outline = ColorSemanticLightOutline,
    outlineVariant = ColorSemanticLightOutlineVariant,
    scrim = ColorSemanticLightScrim,
    inverseSurface = ColorSemanticLightInverseSurface,
    inverseOnSurface = ColorSemanticLightInverseOnSurface,
    inversePrimary = ColorSemanticLightInversePrimary,
    surfaceDim = ColorNeutral200,
    surfaceBright = ColorNeutral0,
    surfaceContainerLowest = ColorSemanticLightSurfaceContainerLowest,
    surfaceContainerLow = ColorSemanticLightSurfaceContainerLow,
    surfaceContainer = ColorSemanticLightSurfaceContainer,
    surfaceContainerHigh = ColorSemanticLightSurfaceContainerHigh,
    surfaceContainerHighest = ColorSemanticLightSurfaceContainerHighest,
)

private val DarkColorScheme = darkColorScheme(
    primary = ColorSemanticDarkPrimary,
    onPrimary = ColorSemanticDarkOnPrimary,
    primaryContainer = ColorSemanticDarkPrimaryContainer,
    onPrimaryContainer = ColorSemanticDarkOnPrimaryContainer,
    secondary = ColorSemanticDarkSecondary,
    onSecondary = ColorSemanticDarkOnSecondary,
    secondaryContainer = ColorSemanticDarkSecondaryContainer,
    onSecondaryContainer = ColorSemanticDarkOnSecondaryContainer,
    tertiary = ColorSemanticDarkTertiary,
    onTertiary = ColorSemanticDarkOnTertiary,
    tertiaryContainer = ColorSemanticDarkTertiaryContainer,
    onTertiaryContainer = ColorSemanticDarkOnTertiaryContainer,
    error = ColorSemanticDarkError,
    onError = ColorSemanticDarkOnError,
    errorContainer = ColorSemanticDarkErrorContainer,
    onErrorContainer = ColorSemanticDarkOnErrorContainer,
    background = ColorSemanticDarkBackground,
    onBackground = ColorSemanticDarkOnBackground,
    surface = ColorSemanticDarkSurface,
    onSurface = ColorSemanticDarkOnSurface,
    surfaceVariant = ColorSemanticDarkSurfaceVariant,
    onSurfaceVariant = ColorSemanticDarkOnSurfaceVariant,
    surfaceTint = ColorSemanticDarkPrimary,
    outline = ColorSemanticDarkOutline,
    outlineVariant = ColorSemanticDarkOutlineVariant,
    scrim = ColorSemanticDarkScrim,
    inverseSurface = ColorSemanticDarkInverseSurface,
    inverseOnSurface = ColorSemanticDarkInverseOnSurface,
    inversePrimary = ColorSemanticDarkInversePrimary,
    surfaceDim = ColorNeutral950,
    surfaceBright = ColorNeutral800,
    surfaceContainerLowest = ColorSemanticDarkSurfaceContainerLowest,
    surfaceContainerLow = ColorSemanticDarkSurfaceContainerLow,
    surfaceContainer = ColorSemanticDarkSurfaceContainer,
    surfaceContainerHigh = ColorSemanticDarkSurfaceContainerHigh,
    surfaceContainerHighest = ColorSemanticDarkSurfaceContainerHighest,
)

@Composable
fun KitchenSinkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = KitchenSinkTypography,
        shapes = KitchenSinkShapes,
        content = content,
    )
}

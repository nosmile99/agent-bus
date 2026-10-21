package com.astryx.kitchensink.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * OP-01 type system. Static TTF instances are bundled in res/font — never
 * downloaded at runtime. Fraunces carries editorial authority, Plus Jakarta Sans
 * carries body copy, IBM Plex Mono carries every label and telemetry readout.
 */
val Fraunces: FontFamily = FontFamily(
    Font(R.font.fraunces_bold, FontWeight.Bold),
)

val PlusJakartaSans: FontFamily = FontFamily(
    Font(R.font.plus_jakarta_sans_regular, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_medium, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_semibold, FontWeight.SemiBold),
    Font(R.font.plus_jakarta_sans_bold, FontWeight.Bold),
)

val IbmPlexMono: FontFamily = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
    Font(R.font.ibm_plex_mono_bold, FontWeight.Bold),
)

@Immutable
data class Op01Typography(
    val headlineLg: TextStyle,
    val headlineMd: TextStyle,
    val headlineSm: TextStyle,
    val titleCard: TextStyle,
    val bodyLg: TextStyle,
    val bodyMd: TextStyle,
    val bodySm: TextStyle,
    val monoCode: TextStyle,
    val labelLg: TextStyle,
    val labelMd: TextStyle,
    val labelCaps: TextStyle,
)

val Op01TypographyDefault = Op01Typography(
    headlineLg = TextStyle(
        fontFamily = Fraunces, fontWeight = FontWeight.Bold,
        fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-0.01).em,
    ),
    headlineMd = TextStyle(
        fontFamily = Fraunces, fontWeight = FontWeight.Bold,
        fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.01).em,
    ),
    headlineSm = TextStyle(
        fontFamily = Fraunces, fontWeight = FontWeight.Bold,
        fontSize = 18.sp, lineHeight = 24.sp,
    ),
    titleCard = TextStyle(
        fontFamily = Fraunces, fontWeight = FontWeight.Bold,
        fontSize = 16.sp, lineHeight = 22.sp,
    ),
    bodyLg = TextStyle(
        fontFamily = PlusJakartaSans, fontWeight = FontWeight.Medium,
        fontSize = 16.sp, lineHeight = 24.sp,
    ),
    bodyMd = TextStyle(
        fontFamily = PlusJakartaSans, fontWeight = FontWeight.Normal,
        fontSize = 14.sp, lineHeight = 22.sp,
    ),
    bodySm = TextStyle(
        fontFamily = PlusJakartaSans, fontWeight = FontWeight.Normal,
        fontSize = 12.sp, lineHeight = 18.sp,
    ),
    monoCode = TextStyle(
        fontFamily = IbmPlexMono, fontWeight = FontWeight.Normal,
        fontSize = 14.sp, lineHeight = 22.sp,
    ),
    labelLg = TextStyle(
        fontFamily = IbmPlexMono, fontWeight = FontWeight.Bold,
        fontSize = 12.sp, lineHeight = 14.sp,
    ),
    labelMd = TextStyle(
        fontFamily = IbmPlexMono, fontWeight = FontWeight.Bold,
        fontSize = 11.sp, lineHeight = 12.sp, letterSpacing = (-0.01).em,
    ),
    labelCaps = TextStyle(
        fontFamily = IbmPlexMono, fontWeight = FontWeight.Bold,
        fontSize = 11.sp, lineHeight = 12.sp, letterSpacing = 0.06.em,
    ),
)

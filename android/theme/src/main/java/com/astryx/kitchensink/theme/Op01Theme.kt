package com.astryx.kitchensink.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

val LocalOp01Colors = staticCompositionLocalOf { Op01LightColors }
val LocalOp01Typography = staticCompositionLocalOf { Op01TypographyDefault }

/** Token access point, mirroring the MaterialTheme shape without Material. */
object Op01Theme {
    val colors: Op01Colors
        @Composable
        @ReadOnlyComposable
        get() = LocalOp01Colors.current

    val type: Op01Typography
        @Composable
        @ReadOnlyComposable
        get() = LocalOp01Typography.current
}

@Composable
fun Op01Theme(
    darkTheme: Boolean,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalOp01Colors provides if (darkTheme) Op01DarkColors else Op01LightColors,
        LocalOp01Typography provides Op01TypographyDefault,
        content = content,
    )
}

/** OP-01 shape scale. Two tiers of logic: tight chrome inside, generous shells outside. */
object Op01Radius {
    val xs: Dp = 4.dp // badges
    val sm: Dp = 6.dp // status tags
    val md: Dp = 8.dp // agent chips, counters
    val lg: Dp = 12.dp // buttons, inputs, nav tabs
    val xl: Dp = 16.dp // cards, columns, swipe shells
    val xxl: Dp = 24.dp // bottom sheets, drawers (top corners)
    val full: Dp = 9999.dp
}

/** OP-01 spacing scale (4dp base) and ergonomic constants. */
object Op01Space {
    val xxs: Dp = 4.dp
    val xs: Dp = 6.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 14.dp
    val xl: Dp = 16.dp
    val xxl: Dp = 20.dp
    val xxxl: Dp = 24.dp
    val tapTarget: Dp = 44.dp
    val headerHeight: Dp = 54.dp
    val swipeThreshold: Dp = 70.dp
    val columnMaxWidth: Dp = 330.dp
}

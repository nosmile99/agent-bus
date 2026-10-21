package com.astryx.kitchensink.ui.components

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateValueAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * OP-01 motion language: fast and mechanical, never bouncy. Everything runs
 * 120–300ms on either FastOutSlowIn or the spec's snap curve
 * (cubic-bezier(0.22, 1, 0.36, 1) — the same curve as the swipe snap-back).
 */
object Op01Motion {
    val SnapEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

    /** 140ms — segment color flips, small state changes. */
    fun <T> fast(): TweenSpec<T> = tween(140, easing = FastOutSlowInEasing)

    /** 180ms — selection color changes. */
    fun <T> color(): TweenSpec<T> = tween(180, easing = FastOutSlowInEasing)

    /** 240ms — container growth, composer, banners. */
    fun <T> medium(): TweenSpec<T> = tween(240, easing = FastOutSlowInEasing)

    /** 280ms — sheets and content swaps on the snap curve. */
    fun <T> snap(): TweenSpec<T> = tween(280, easing = SnapEasing)

    /** 300ms — theme color travel. */
    fun <T> theme(): TweenSpec<T> = tween(320, easing = FastOutSlowInEasing)
}

/**
 * First-appearance animation for list content: fade in with a small 16dp
 * rise on the snap curve. [delayMillis] staggers siblings (keep it small —
 * the console should feel instant, not choreographed).
 */
@Composable
fun EnterItem(
    modifier: Modifier = Modifier,
    delayMillis: Int = 0,
    content: @Composable () -> Unit,
) {
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (delayMillis > 0) delay(delayMillis.toLong())
        entered = true
    }
    val progress by animateFloatAsState(
        targetValue = if (entered) 1f else 0f,
        animationSpec = Op01Motion.snap(),
        label = "enter-item",
    )
    Box(
        modifier = modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * 16.dp.toPx()
        },
    ) { content() }
}

/**
 * Color tween on the shared motion spec, built on animation-core's
 * [animateValueAsState] + [Color.VectorConverter] — the dedicated
 * animateColorAsState helper is not on this module's classpath.
 */
@Composable
fun animateOp01Color(target: Color, label: String): State<Color> =
    animateValueAsState(
        targetValue = target,
        typeConverter = Color.VectorConverter,
        animationSpec = Op01Motion.color(),
        label = label,
    )

package com.astryx.kitchensink.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Theme

/**
 * OP-01 hardware primitives. Everything visible is built from these — solid
 * carbon borders, hard zero-blur offset shadows, keycap press physics.
 * No Material components anywhere: if it looks like a template, it failed.
 */

/** Hard shadow: a solid copy of the surface, offset down, zero blur. Drawn behind via drawBehind. */
fun Modifier.hardShadow(radius: Dp, offsetY: Dp, color: Color): Modifier = drawBehind {
    val o = offsetY.toPx()
    if (o > 0f) {
        drawRoundRect(
            color = color,
            topLeft = Offset(0f, o),
            size = size,
            cornerRadius = CornerRadius(radius.toPx()),
        )
    }
}

/** Recessed-well inner shadow: a soft dark falloff clipped to the top edge of the well. */
fun Modifier.insetTopShadow(radius: Dp): Modifier = drawWithContent {
    drawContent()
    val r = radius.toPx()
    val path = Path().apply {
        addRoundRect(
            androidx.compose.ui.geometry.RoundRect(
                0f, 0f, size.width, size.height, CornerRadius(r),
            ),
        )
    }
    with(drawContext.canvas) {
        save()
        clipPath(path)
        drawRect(
            brush = Brush.verticalGradient(
                listOf(Color.Black.copy(alpha = 0.13f), Color.Transparent),
                startY = 0f,
                endY = 4.dp.toPx(),
            ),
        )
        restore()
    }
}

@Composable
fun HwText(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
) {
    BasicText(
        text = text,
        modifier = modifier,
        style = style.copy(color = color),
        maxLines = maxLines,
        overflow = overflow,
    )
}

/** Elevated hardware card: card surface, 1.5dp carbon border, `0 3dp 0` hard shadow. */
@Composable
fun HwCard(
    modifier: Modifier = Modifier,
    radius: Dp = Op01Radius.xl,
    background: Color = Op01Theme.colors.card,
    borderColor: Color = Op01Theme.colors.borderHardware,
    shadowOffset: Dp = 3.dp,
    contentPadding: Dp = 14.dp,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .hardShadow(radius, shadowOffset, Op01Theme.colors.shadow)
            .background(background, shape)
            .border(1.5.dp, borderColor, shape)
            .clip(shape)
            .padding(contentPadding),
    ) { content() }
}

/** Recessed well: stone surface pushed below the paper plane with an inset top shadow. */
@Composable
fun HwInset(
    modifier: Modifier = Modifier,
    radius: Dp = Op01Radius.lg,
    contentPadding: Dp = 12.dp,
    content: @Composable () -> Unit,
) {
    val colors = Op01Theme.colors
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .background(colors.recessed, shape)
            .border(1.5.dp, colors.borderInset, shape)
            .clip(shape)
            .insetTopShadow(radius)
            .padding(contentPadding),
    ) { content() }
}

enum class HwButtonStyle { Primary, Positive, Danger, Secondary, CardSurface }

/**
 * Tactile keycap button. Rest: 1.5dp border, `0 2.5dp 0` hard shadow.
 * Pressed: translates down 2dp and the shadow collapses to 0.5dp (80ms, the
 * physical switch travel from the spec). No ripple — the motion is the feedback.
 */
@Composable
fun HwButton(
    text: String,
    onClick: () -> Unit,
    style: HwButtonStyle = HwButtonStyle.Secondary,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = Op01Theme.colors
    val (bg, fg) = when (style) {
        HwButtonStyle.Primary -> colors.ink to colors.paper
        HwButtonStyle.Positive -> colors.forest to Color.White
        HwButtonStyle.Danger -> colors.vermilion to Color.White
        HwButtonStyle.Secondary -> colors.recessed to colors.ink
        HwButtonStyle.CardSurface -> colors.card to colors.ink
    }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val travel by animateDpAsState(
        targetValue = if (pressed && enabled) 2.dp else 0.dp,
        animationSpec = tween(80),
        label = "keycap-travel",
    )
    val shadow by animateDpAsState(
        targetValue = if (pressed && enabled) 0.5.dp else 2.5.dp,
        animationSpec = tween(80),
        label = "keycap-shadow",
    )
    val shape = RoundedCornerShape(Op01Radius.lg)
    Box(
        modifier = modifier
            .offset(y = travel)
            .hardShadow(Op01Radius.lg, shadow, colors.shadow)
            .background(if (enabled) bg else bg.copy(alpha = 0.45f), shape)
            .border(1.5.dp, colors.borderHardware, shape)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            )
            .heightIn(min = 44.dp)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        HwText(
            text = text,
            style = Op01Theme.type.labelLg,
            color = if (enabled) fg else fg.copy(alpha = 0.6f),
            maxLines = 1,
        )
    }
}

/** Small telemetry badge: mono label on a tinted fill with a hardware border. */
@Composable
fun Op01Badge(
    text: String,
    bg: Color,
    textColor: Color,
    modifier: Modifier = Modifier,
    borderColor: Color = Op01Theme.colors.borderHardware,
) {
    Box(
        modifier = modifier
            .background(bg, RoundedCornerShape(Op01Radius.sm))
            .border(1.5.dp, borderColor, RoundedCornerShape(Op01Radius.sm))
            .padding(horizontal = 7.dp, vertical = 4.dp),
    ) {
        HwText(text, Op01Theme.type.labelMd, textColor, maxLines = 1)
    }
}

/** Caution stripe: repeating -45° diagonal bands, 8dp each, hard color stops. */
@Composable
fun CautionStripe(
    colorA: Color,
    colorB: Color,
    modifier: Modifier = Modifier,
) {
    val bandPx = with(LocalDensity.current) { 8.dp.toPx() }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(10.dp)
            .drawBehind {
                drawRect(
                    brush = Brush.linearGradient(
                        colorStops = arrayOf(
                            0f to colorA, 0.5f to colorA,
                            0.5f to colorB, 1f to colorB,
                        ),
                        start = Offset.Zero,
                        end = Offset(bandPx, bandPx),
                        tileMode = TileMode.Repeated,
                    ),
                )
            },
    )
}

/** Pulsing live LED: emerald dot with a breathing alpha halo. */
@Composable
fun LedDot(
    modifier: Modifier = Modifier,
    color: Color = Op01Theme.colors.led,
) {
    val transition = rememberInfiniteTransition(label = "led")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "led-alpha",
    )
    Box(modifier = modifier.size(16.dp), contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .size(16.dp)
                .background(color.copy(alpha = 0.25f * alpha), CircleShape),
        )
        Box(
            modifier = Modifier
                .size(10.dp)
                .background(color.copy(alpha = 0.55f + 0.45f * alpha), CircleShape),
        )
    }
}

/** Field label in tracked mono caps, per the spec's label-caps style. */
@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    HwText(
        text = text.uppercase(),
        style = Op01Theme.type.labelCaps,
        color = Op01Theme.colors.secondary,
        modifier = modifier.padding(bottom = 5.dp),
    )
}

/**
 * Recessed text field. Text never renders below 16sp on standard fields
 * (body-lg); the mono variant is the spec's 14sp mono-code for notes.
 */
@Composable
fun HwTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String = "",
    mono: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
) {
    val colors = Op01Theme.colors
    val shape = RoundedCornerShape(Op01Radius.lg)
    Column(modifier = modifier) {
        if (label != null) FieldLabel(label)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.recessed, shape)
                .border(1.5.dp, colors.borderInset, shape)
                .insetTopShadow(Op01Radius.lg)
                .padding(horizontal = 12.dp, vertical = 11.dp),
        ) {
            if (value.isEmpty()) {
                HwText(
                    text = placeholder,
                    style = if (mono) Op01Theme.type.monoCode else Op01Theme.type.bodyLg,
                    color = colors.secondary,
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                textStyle = (if (mono) Op01Theme.type.monoCode else Op01Theme.type.bodyLg)
                    .copy(color = colors.ink),
                cursorBrush = SolidColor(colors.forest),
                singleLine = singleLine,
                minLines = minLines,
            )
        }
    }
}

/**
 * Hardware selector: a recessed field that expands an in-flow option list.
 * Options are 44dp rows; selecting collapses. No Material dropdown chrome.
 */
@Composable
fun HwSelect(
    label: String,
    value: String,
    options: List<String>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    var expanded by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Op01Radius.lg)
    Column(modifier = modifier) {
        FieldLabel(label)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.recessed, shape)
                .border(1.5.dp, colors.borderInset, shape)
                .insetTopShadow(Op01Radius.lg)
                .clickable { expanded = !expanded }
                .heightIn(min = 44.dp)
                .padding(horizontal = 12.dp, vertical = 11.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                HwText(
                    text = value,
                    style = Op01Theme.type.bodyLg,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                HwText(if (expanded) "▴" else "▾", Op01Theme.type.bodyLg, colors.secondary)
            }
        }
        if (expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp)
                    .background(colors.card, shape)
                    .border(1.5.dp, colors.borderHardware, shape)
                    .clip(shape),
            ) {
                options.forEachIndexed { index, option ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(
                                if (option == value) {
                                    Modifier.background(colors.recessed)
                                } else {
                                    Modifier
                                },
                            )
                            .clickable {
                                onSelect(option)
                                expanded = false
                            }
                            .heightIn(min = 44.dp)
                            .padding(horizontal = 12.dp, vertical = 11.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        HwText(option, Op01Theme.type.bodyMd, colors.ink, maxLines = 1)
                    }
                    if (index < options.lastIndex) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(colors.borderSubtle),
                        )
                    }
                }
            }
        }
    }
}

/** Rate-quota meter: recessed track, hardware border, forest fill (ochre at >= 85%). */
@Composable
fun QuotaMeter(percent: Int, modifier: Modifier = Modifier) {
    val colors = Op01Theme.colors
    val fill = if (percent >= 85) colors.ochre else colors.forest
    val shape = RoundedCornerShape(Op01Radius.full)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(12.dp)
            .background(colors.recessed, shape)
            .border(1.5.dp, colors.borderHardware, shape)
            .clip(shape),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(percent.coerceIn(0, 100) / 100f)
                .height(12.dp)
                .background(fill),
        )
    }
}

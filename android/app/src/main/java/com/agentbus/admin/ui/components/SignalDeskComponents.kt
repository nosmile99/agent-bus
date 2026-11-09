package com.agentbus.admin.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.agentbus.admin.ui.theme.SdTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

enum class SdButtonVariant {
    PRIMARY,
    SECONDARY,
    GHOST,
    DANGER,
    COBALT
}

private val TagShape = RoundedCornerShape(2.dp)
private val ControlShape = RoundedCornerShape(4.dp)
private val PanelShape = RoundedCornerShape(6.dp)

@Composable
fun SdText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = SdTheme.typo.bodyPrimary,
    color: Color = Color.Unspecified,
    fontWeight: FontWeight? = null,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip
) {
    val resolvedStyle = style.merge(
        TextStyle(
            color = if (color != Color.Unspecified) color else style.color,
            fontWeight = fontWeight ?: style.fontWeight
        )
    )
    BasicText(
        text = text,
        modifier = modifier,
        style = resolvedStyle,
        maxLines = maxLines,
        overflow = overflow
    )
}

@Composable
fun SdButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: SdButtonVariant = SdButtonVariant.PRIMARY,
    enabled: Boolean = true,
    compact: Boolean = false
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    val isPressed by interactionSource.collectIsPressedAsState()

    val bgColor = when {
        !enabled -> colors.bgSubtle
        variant == SdButtonVariant.PRIMARY -> colors.signalVermilion
        variant == SdButtonVariant.COBALT -> colors.cobaltInk
        variant == SdButtonVariant.DANGER -> colors.dangerCrimson
        variant == SdButtonVariant.SECONDARY -> colors.bgSurface
        else -> Color.Transparent
    }

    val fgColor = when {
        !enabled -> colors.inkMuted
        variant == SdButtonVariant.PRIMARY -> colors.onSignalVermilion
        variant == SdButtonVariant.COBALT -> colors.onCobaltInk
        variant == SdButtonVariant.DANGER -> colors.onDangerCrimson
        variant == SdButtonVariant.SECONDARY -> colors.inkPrimary
        else -> colors.inkPrimary
    }

    val borderColor = when {
        isFocused -> colors.cobaltInk
        !enabled -> colors.borderSubtle
        variant == SdButtonVariant.PRIMARY -> colors.signalVermilion
        variant == SdButtonVariant.COBALT -> colors.cobaltInk
        variant == SdButtonVariant.DANGER -> colors.dangerCrimson
        else -> colors.borderStrong
    }

    val borderWidth = if (isFocused) 2.5.dp else if (isPressed) 2.dp else 1.dp

    Box(
        modifier = modifier
            .defaultMinSize(
                minWidth = 48.dp,
                minHeight = if (compact) 44.dp else 48.dp
            )
            .clip(ControlShape)
            .background(bgColor)
            .border(borderWidth, borderColor, ControlShape)
            .onPreviewKeyEvent { event ->
                if (enabled && event.type == KeyEventType.KeyDown &&
                    (event.key == Key.Enter || event.key == Key.Spacebar)
                ) {
                    onClick()
                    true
                } else false
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick
            )
            .padding(horizontal = if (compact) 12.dp else 16.dp, vertical = if (compact) 8.dp else 10.dp),
        contentAlignment = Alignment.Center
    ) {
        SdText(
            text = label,
            style = SdTheme.typo.buttonLabel,
            color = fgColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun SdFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()

    val bg = if (selected) colors.cobaltInk else colors.bgSurface
    val fg = if (selected) colors.onCobaltInk else colors.inkPrimary
    val border = when {
        isFocused -> colors.signalVermilion
        selected -> colors.cobaltInk
        else -> colors.borderStrong
    }

    Box(
        modifier = modifier
            .defaultMinSize(minWidth = 44.dp, minHeight = 44.dp)
            .clip(ControlShape)
            .background(bg)
            .border(if (isFocused || selected) 2.dp else 1.dp, border, ControlShape)
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    (event.key == Key.Enter || event.key == Key.Spacebar)
                ) {
                    onClick()
                    true
                } else false
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Tab,
                onClick = onClick
            )
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (selected) {
                Canvas(modifier = Modifier.size(6.dp)) {
                    drawRect(color = fg)
                }
            }
            SdText(
                text = label,
                style = SdTheme.typo.monoTag,
                color = fg
            )
        }
    }
}

@Composable
fun SdTag(
    text: String,
    modifier: Modifier = Modifier,
    bgColor: Color = SdTheme.colors.bgSubtle,
    textColor: Color = SdTheme.colors.inkPrimary,
    borderColor: Color = SdTheme.colors.borderSubtle
) {
    Box(
        modifier = modifier
            .clip(TagShape)
            .background(bgColor)
            .border(1.dp, borderColor, TagShape)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center
    ) {
        SdText(
            text = text,
            style = SdTheme.typo.monoTag,
            color = textColor,
            maxLines = 1
        )
    }
}

@Composable
fun SdPriorityTag(priority: String, modifier: Modifier = Modifier) {
    val colors = SdTheme.colors
    val (bg, fg, border) = when (priority.lowercase()) {
        "urgent" -> Triple(colors.dangerCrimson, colors.onDangerCrimson, colors.dangerCrimson)
        "low" -> Triple(colors.bgSubtle, colors.inkSecondary, colors.borderSubtle)
        else -> Triple(colors.cobaltInk, colors.onCobaltInk, colors.cobaltInk)
    }
    SdTag(
        text = "PRI:${priority.uppercase()}",
        modifier = modifier,
        bgColor = bg,
        textColor = fg,
        borderColor = border
    )
}

@Composable
fun SdStatusTag(status: String, modifier: Modifier = Modifier) {
    val colors = SdTheme.colors
    val (bg, fg, border) = when (status.lowercase()) {
        "doing" -> Triple(colors.cobaltInk, colors.onCobaltInk, colors.cobaltInk)
        "blocked" -> Triple(colors.dangerCrimson, colors.onDangerCrimson, colors.dangerCrimson)
        "done" -> Triple(colors.forestOk, colors.onForestOk, colors.forestOk)
        else -> Triple(colors.bgSubtle, colors.inkPrimary, colors.borderStrong)
    }
    SdTag(
        text = status.uppercase(),
        modifier = modifier,
        bgColor = bg,
        textColor = fg,
        borderColor = border
    )
}

@Composable
fun SdLaneTag(lane: String, modifier: Modifier = Modifier) {
    val colors = SdTheme.colors
    val (bg, fg, border) = when (lane.lowercase()) {
        "backend" -> Triple(colors.amberWarn, colors.onAmberWarn, colors.amberWarn)
        "android" -> Triple(colors.forestOk, colors.onForestOk, colors.forestOk)
        else -> Triple(colors.bgSubtle, colors.inkSecondary, colors.borderSubtle)
    }
    SdTag(
        text = "LANE:${lane.uppercase()}",
        modifier = modifier,
        bgColor = bg,
        textColor = fg,
        borderColor = border
    )
}

@Composable
fun SdTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    isPassword: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
    errorText: String? = null,
    helperText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()

    val borderColor = when {
        errorText != null -> colors.dangerCrimson
        isFocused -> colors.cobaltInk
        else -> colors.borderStrong
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (label.isNotEmpty()) {
            SdText(
                text = label,
                style = SdTheme.typo.monoTag,
                color = if (errorText != null) colors.dangerCrimson else colors.inkSecondary
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 48.dp)
                .clip(ControlShape)
                .background(colors.bgSurface)
                .border(if (isFocused || errorText != null) 2.dp else 1.dp, borderColor, ControlShape)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart
        ) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                SdText(
                    text = placeholder,
                    style = SdTheme.typo.bodySecondary,
                    color = colors.inkMuted
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                textStyle = SdTheme.typo.bodyPrimary.copy(color = colors.inkPrimary),
                singleLine = singleLine,
                minLines = minLines,
                cursorBrush = SolidColor(colors.signalVermilion),
                visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
                interactionSource = interactionSource,
                keyboardOptions = keyboardOptions,
                keyboardActions = keyboardActions
            )
        }
        if (errorText != null) {
            SdText(
                text = "[!] $errorText",
                style = SdTheme.typo.bodySecondary,
                color = colors.dangerCrimson
            )
        } else if (helperText != null) {
            SdText(
                text = helperText,
                style = SdTheme.typo.bodySecondary,
                color = colors.inkMuted
            )
        }
    }
}

@Composable
fun SdCheckboxRow(
    checked: Boolean,
    label: String,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()

    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(ControlShape)
            .border(
                width = if (isFocused) 2.dp else 0.dp,
                color = if (isFocused) colors.cobaltInk else Color.Transparent,
                shape = ControlShape
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Checkbox
            ) { onCheckedChange(!checked) }
            .padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(TagShape)
                .background(if (checked) colors.forestOk else colors.bgSurface)
                .border(2.dp, if (checked) colors.forestOk else colors.borderStrong, TagShape),
            contentAlignment = Alignment.Center
        ) {
            if (checked) {
                Canvas(modifier = Modifier.size(12.dp)) {
                    drawLine(
                        color = colors.onForestOk,
                        start = Offset(size.width * 0.15f, size.height * 0.55f),
                        end = Offset(size.width * 0.42f, size.height * 0.82f),
                        strokeWidth = 2.5.dp.toPx(),
                        cap = StrokeCap.Square
                    )
                    drawLine(
                        color = colors.onForestOk,
                        start = Offset(size.width * 0.42f, size.height * 0.82f),
                        end = Offset(size.width * 0.85f, size.height * 0.2f),
                        strokeWidth = 2.5.dp.toPx(),
                        cap = StrokeCap.Square
                    )
                }
            }
        }
        SdText(
            text = label,
            style = SdTheme.typo.bodyPrimary,
            color = if (checked) colors.inkSecondary else colors.inkPrimary
        )
    }
}

@Composable
fun SdCard(
    modifier: Modifier = Modifier,
    accentTopColor: Color? = null,
    padding: Dp = 14.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()

    val borderCol = if (isFocused) colors.cobaltInk else colors.borderStrong
    val borderWidth = if (isFocused) 2.dp else 1.dp

    val clickableModifier = if (onClick != null) {
        Modifier
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    (event.key == Key.Enter || event.key == Key.Spacebar)
                ) {
                    onClick()
                    true
                } else false
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
    } else Modifier

    Column(
        modifier = modifier
            .clip(PanelShape)
            .background(colors.bgSurface)
            .border(borderWidth, borderCol, PanelShape)
            .then(clickableModifier)
    ) {
        if (accentTopColor != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(accentTopColor)
            )
        }
        Column(
            modifier = Modifier.padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content
        )
    }
}

@Composable
fun SdSectionHeader(
    indexCode: String,
    title: String,
    subtitle: String? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null
) {
    val colors = SdTheme.colors
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                Box(
                    modifier = Modifier
                        .clip(TagShape)
                        .background(colors.signalVermilion)
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    SdText(
                        text = indexCode,
                        style = SdTheme.typo.monoTag,
                        color = colors.onSignalVermilion
                    )
                }
                SdText(
                    text = title,
                    style = SdTheme.typo.sectionHeader,
                    color = colors.inkPrimary
                )
            }
            if (trailing != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = trailing
                )
            }
        }
        if (!subtitle.isNullOrBlank()) {
            SdText(
                text = subtitle,
                style = SdTheme.typo.bodySecondary,
                color = colors.inkSecondary
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.borderSubtle)
        )
    }
}

// Required UI States per R-27: Loading, Empty, Error (each explicit, perceivable, and actionable)
@Composable
fun SdLoadingState(message: String, modifier: Modifier = Modifier) {
    val colors = SdTheme.colors
    SdCard(modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Canvas(modifier = Modifier.size(16.dp)) {
                drawRect(color = colors.cobaltInk, size = Size(size.width, size.height))
            }
            Column {
                SdText(
                    text = "LOADING DATA",
                    style = SdTheme.typo.monoTag,
                    color = colors.cobaltInk
                )
                SdText(
                    text = message,
                    style = SdTheme.typo.bodyPrimary,
                    color = colors.inkPrimary
                )
            }
        }
    }
}

@Composable
fun SdEmptyState(
    title: String,
    causeAndNextStep: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val colors = SdTheme.colors
    SdCard(modifier = modifier.fillMaxWidth()) {
        SdText(
            text = "[EMPTY] $title",
            style = SdTheme.typo.cardTitle,
            color = colors.inkPrimary
        )
        SdText(
            text = causeAndNextStep,
            style = SdTheme.typo.bodySecondary,
            color = colors.inkSecondary
        )
        if (actionLabel != null && onAction != null) {
            SdButton(
                label = actionLabel,
                onClick = onAction,
                variant = SdButtonVariant.COBALT,
                compact = true
            )
        }
    }
}

@Composable
fun SdErrorState(
    title: String,
    cause: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SdTheme.colors
    SdCard(
        modifier = modifier.fillMaxWidth(),
        accentTopColor = colors.dangerCrimson
    ) {
        SdText(
            text = "[ERROR] $title",
            style = SdTheme.typo.cardTitle,
            color = colors.dangerCrimson
        )
        SdText(
            text = cause,
            style = SdTheme.typo.bodySecondary,
            color = colors.inkPrimary
        )
        SdButton(
            label = "Retry Request",
            onClick = onRetry,
            variant = SdButtonVariant.DANGER,
            compact = true
        )
    }
}

@Composable
fun SdModalDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = SdTheme.colors
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnBackPress = true,
            dismissOnClickOutside = true,
            usePlatformDefaultWidth = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .widthIn(max = 600.dp)
                .clip(PanelShape)
                .background(colors.bgSurface)
                .border(2.dp, colors.borderStrong, PanelShape)
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown && event.key == Key.Escape) {
                        onDismiss()
                        true
                    } else false
                }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    SdText(
                        text = title,
                        style = SdTheme.typo.sectionHeader,
                        color = colors.inkPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    SdButton(
                        label = "Close [Esc]",
                        onClick = onDismiss,
                        variant = SdButtonVariant.SECONDARY,
                        compact = true
                    )
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(colors.borderSubtle)
                )
                content()
            }
        }
    }
}

object SdTimeFormatter {
    private val wibZone = ZoneId.of("Asia/Jakarta")
    private val utcZone = ZoneId.of("UTC")
    private val dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    fun formatEpochSecWib(epochSec: Long?): String {
        if (epochSec == null || epochSec <= 0L) return "not set"
        return try {
            Instant.ofEpochSecond(epochSec).atZone(wibZone).format(dtf) + " WIB"
        } catch (_: Exception) {
            "$epochSec"
        }
    }

    fun formatIsoWithWibAndUtc(iso: String): String {
        if (iso.isBlank()) return "-"
        return try {
            val instant = Instant.parse(iso)
            val wib = instant.atZone(wibZone).format(dtf)
            val utc = instant.atZone(utcZone).format(DateTimeFormatter.ofPattern("HH:mm"))
            "$wib WIB ($utc UTC)"
        } catch (_: Exception) {
            iso
        }
    }
}

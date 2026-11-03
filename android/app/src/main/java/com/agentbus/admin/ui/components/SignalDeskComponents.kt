package com.agentbus.admin.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.agentbus.admin.ui.theme.DarkLuxePalette
import com.agentbus.admin.ui.theme.ObsidianShapes
import com.agentbus.admin.ui.theme.ObsidianTheme
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

private val TagShape = ObsidianShapes.radius8
private val ControlShape = ObsidianShapes.radius10
private val PanelShape = ObsidianShapes.radius14

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
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale = if (isPressed) 0.97f else 1f
    val shape = if (compact) ObsidianShapes.radius10 else ObsidianShapes.radius12

    val bgBrush: Brush = when {
        !enabled -> SolidColor(colors.fill)
        variant == SdButtonVariant.PRIMARY -> colors.goldGradient
        variant == SdButtonVariant.COBALT -> SolidColor(colors.statusDoing)
        variant == SdButtonVariant.DANGER -> SolidColor(colors.fill)
        variant == SdButtonVariant.SECONDARY -> SolidColor(colors.fill)
        else -> SolidColor(Color.Transparent)
    }

    val fgColor = when {
        !enabled -> colors.faint
        variant == SdButtonVariant.PRIMARY -> colors.onGold
        variant == SdButtonVariant.COBALT -> colors.onGold
        variant == SdButtonVariant.DANGER -> colors.danger
        variant == SdButtonVariant.SECONDARY -> colors.goldPale
        else -> colors.textSoft
    }

    val borderColor = when {
        !enabled -> colors.line
        variant == SdButtonVariant.PRIMARY -> colors.goldEdge
        variant == SdButtonVariant.COBALT -> colors.statusDoing
        variant == SdButtonVariant.DANGER -> colors.dangerLine
        variant == SdButtonVariant.SECONDARY -> colors.amberLine
        else -> Color.Transparent
    }

    val paddingV = if (compact) 6.dp else 9.dp
    val paddingH = if (compact) 12.dp else 16.dp

    Box(
        modifier = modifier
            .scale(scale)
            .clip(shape)
            .background(bgBrush)
            .then(
                if (borderColor != Color.Transparent) Modifier.border(1.dp, borderColor, shape)
                else Modifier
            )
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
            .padding(horizontal = paddingH, vertical = paddingV),
        contentAlignment = Alignment.Center
    ) {
        SdText(
            text = label,
            style = if (compact) typo.small else typo.label,
            color = fgColor,
            fontWeight = if (variant == SdButtonVariant.PRIMARY) FontWeight.Bold else FontWeight.SemiBold,
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
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val shape = ObsidianShapes.radiusFull

    val bgBrush = if (selected) colors.goldGradient else SolidColor(colors.fill)
    val borderCol = if (selected) colors.goldEdge else colors.lineChip
    val fg = if (selected) colors.onGold else colors.textDim

    Box(
        modifier = modifier
            .clip(shape)
            .background(bgBrush)
            .border(1.dp, borderCol, shape)
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    (event.key == Key.Enter || event.key == Key.Spacebar)
                ) {
                    onClick()
                    true
                } else false
            }
            .clickable(
                role = Role.Tab,
                onClick = onClick
            )
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (selected) {
                Canvas(modifier = Modifier.size(5.dp)) {
                    drawCircle(color = fg)
                }
            }
            SdText(
                text = label,
                style = typo.small,
                color = fg,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold
            )
        }
    }
}

@Composable
fun SdTag(
    text: String,
    modifier: Modifier = Modifier,
    bgColor: Color = ObsidianTheme.colors.fill,
    textColor: Color = ObsidianTheme.colors.text,
    borderColor: Color = ObsidianTheme.colors.line
) {
    Box(
        modifier = modifier
            .clip(TagShape)
            .background(bgColor)
            .border(1.dp, borderColor, TagShape)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center
    ) {
        SdText(
            text = text,
            style = ObsidianTheme.typography.tag,
            color = textColor,
            maxLines = 1
        )
    }
}

@Composable
fun SdPriorityTag(priority: String, modifier: Modifier = Modifier) {
    val colors = ObsidianTheme.colors
    val (tone, fg) = when (priority.lowercase()) {
        "urgent" -> colors.danger to colors.danger
        "low" -> colors.faint to colors.faint
        else -> colors.accent to colors.accent
    }
    SdTag(
        text = "PRI:${priority.uppercase()}",
        modifier = modifier,
        bgColor = tone.copy(alpha = 0.14f),
        textColor = fg,
        borderColor = tone.copy(alpha = 0.35f)
    )
}

@Composable
fun SdStatusTag(status: String, modifier: Modifier = Modifier) {
    val colors = ObsidianTheme.colors
    val tone = when (status.lowercase()) {
        "doing" -> colors.statusDoing
        "blocked" -> colors.statusBlocked
        "done" -> colors.statusDone
        else -> colors.statusBacklog
    }
    SdTag(
        text = status.uppercase(),
        modifier = modifier,
        bgColor = tone.copy(alpha = 0.14f),
        textColor = tone,
        borderColor = tone.copy(alpha = 0.35f)
    )
}

@Composable
fun SdLaneTag(lane: String, modifier: Modifier = Modifier) {
    val colors = ObsidianTheme.colors
    val tone = when (lane.lowercase()) {
        "backend" -> colors.accent
        "android" -> colors.statusDone
        else -> colors.muted
    }
    SdTag(
        text = "LANE:${lane.uppercase()}",
        modifier = modifier,
        bgColor = tone.copy(alpha = 0.14f),
        textColor = tone,
        borderColor = tone.copy(alpha = 0.35f)
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
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()

    val borderColor = when {
        errorText != null -> colors.errorLine
        isFocused -> colors.focusLine
        else -> colors.lineStrong
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (label.isNotEmpty()) {
            SdText(
                text = label,
                style = typo.fieldLabel,
                color = if (errorText != null) colors.danger else colors.muted
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = if (singleLine) 38.dp else 72.dp)
                .clip(ControlShape)
                .background(colors.fill)
                .border(if (isFocused || errorText != null) 1.5.dp else 1.dp, borderColor, ControlShape)
                .padding(horizontal = 12.dp, vertical = if (singleLine) 8.dp else 10.dp),
            contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart
        ) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                SdText(
                    text = placeholder,
                    style = typo.body,
                    color = colors.faint
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                textStyle = typo.body.copy(color = colors.text),
                singleLine = singleLine,
                minLines = minLines,
                cursorBrush = SolidColor(colors.accent),
                visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
                interactionSource = interactionSource,
                keyboardOptions = keyboardOptions,
                keyboardActions = keyboardActions
            )
        }
        if (errorText != null) {
            SdText(
                text = errorText,
                style = typo.meta,
                color = colors.danger,
                fontWeight = FontWeight.SemiBold
            )
        } else if (helperText != null) {
            SdText(
                text = helperText,
                style = typo.meta,
                color = colors.faint
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
    val colors = ObsidianTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

    Row(
        modifier = modifier
            .clip(ControlShape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Checkbox
            ) { onCheckedChange(!checked) }
            .padding(horizontal = 6.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(ObsidianShapes.radius6)
                .then(
                    if (checked) {
                        Modifier
                            .background(colors.goldGradient)
                            .border(1.dp, colors.goldEdge, ObsidianShapes.radius6)
                    } else {
                        Modifier
                            .background(Color.Transparent)
                            .border(1.5.dp, colors.accent.copy(alpha = 0.5f), ObsidianShapes.radius6)
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            if (checked) {
                BasicText(
                    text = "✓",
                    style = TextStyle(
                        color = colors.onGold,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold
                    )
                )
            }
        }
        SdText(
            text = label,
            style = ObsidianTheme.typography.body,
            color = if (checked) colors.faint else colors.text
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
    val colors = ObsidianTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

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
            .background(Brush.verticalGradient(listOf(colors.surfaceTop, colors.surfaceBottom)))
            .border(1.dp, colors.surfaceLine, PanelShape)
            .then(clickableModifier)
    ) {
        if (accentTopColor != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(3.dp)
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
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

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
                        .background(colors.accent)
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    SdText(
                        text = indexCode,
                        style = typo.tag,
                        color = colors.accentInk
                    )
                }
                SdText(
                    text = title,
                    style = typo.blockTitle,
                    color = colors.text
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
                style = typo.meta,
                color = colors.muted
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.surfaceLine)
        )
    }
}

@Composable
fun SdLoadingState(message: String, modifier: Modifier = Modifier) {
    val colors = ObsidianTheme.colors
    SdCard(modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(ObsidianShapes.radius6)
                    .background(colors.accent)
            )
            Column {
                SdText(
                    text = "MEMUAT",
                    style = ObsidianTheme.typography.overline,
                    color = colors.accent
                )
                SdText(
                    text = message,
                    style = ObsidianTheme.typography.body,
                    color = colors.text
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
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(ObsidianShapes.radius12)
            .border(1.dp, colors.lineChip, ObsidianShapes.radius12)
            .padding(18.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            SdText(
                text = title,
                style = typo.cardTitle,
                color = colors.text
            )
            SdText(
                text = causeAndNextStep,
                style = typo.body,
                color = colors.faint
            )
            if (actionLabel != null && onAction != null) {
                Spacer(modifier = Modifier.height(6.dp))
                SdButton(
                    label = actionLabel,
                    onClick = onAction,
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
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
    val colors = ObsidianTheme.colors
    SdCard(
        modifier = modifier.fillMaxWidth(),
        accentTopColor = colors.danger
    ) {
        SdText(
            text = title,
            style = ObsidianTheme.typography.cardTitle,
            color = colors.danger
        )
        SdText(
            text = cause,
            style = ObsidianTheme.typography.body,
            color = colors.text
        )
        SdButton(
            label = "Coba Lagi",
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
    val colors = ObsidianTheme.colors
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
                .fillMaxSize()
                .background(colors.backdrop)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss
                )
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.95f)
                    .widthIn(max = 640.dp)
                    .clip(ObsidianShapes.radius18)
                    .background(Brush.verticalGradient(listOf(colors.surfaceTop, colors.surfaceBottom)))
                    .border(1.dp, colors.surfaceLine, ObsidianShapes.radius18)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {}
                    )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(22.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        SdText(
                            text = title,
                            style = ObsidianTheme.typography.modalTitle,
                            color = colors.text,
                            modifier = Modifier.weight(1f)
                        )
                        SdButton(
                            label = "Tutup",
                            onClick = onDismiss,
                            variant = SdButtonVariant.SECONDARY,
                            compact = true
                        )
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(colors.line)
                    )
                    content()
                }
            }
        }
    }
}

object SdTimeFormatter {
    private val wibZone = ZoneId.of("Asia/Jakarta")
    private val utcZone = ZoneId.of("UTC")
    private val dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    fun formatEpochSecWib(epochSec: Long?): String {
        if (epochSec == null || epochSec <= 0L) return "Belum diatur"
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

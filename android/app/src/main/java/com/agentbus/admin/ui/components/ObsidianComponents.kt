package com.agentbus.admin.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.agentbus.admin.ui.theme.DarkLuxePalette
import com.agentbus.admin.ui.theme.ObsidianShapes
import com.agentbus.admin.ui.theme.ObsidianTheme
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

// ============================================================================
// 1. SURFACE (v-obsidian-surface & v-obsidian-item)
// ============================================================================

enum class ObsidianSurfaceVariant {
    SURFACE, // 18dp radius, radial/vertical surface gradient, 1px gold hairline (surface-line)
    ITEM     // 12dp radius, linear item gradient (item-top -> item-bottom), 1px line
}

@Composable
fun ObsidianSurface(
    modifier: Modifier = Modifier,
    variant: ObsidianSurfaceVariant = ObsidianSurfaceVariant.SURFACE,
    shape: RoundedCornerShape = if (variant == ObsidianSurfaceVariant.SURFACE) ObsidianShapes.radius18 else ObsidianShapes.radius12,
    borderWidth: Dp = 1.dp,
    borderColor: Color = if (variant == ObsidianSurfaceVariant.SURFACE) ObsidianTheme.colors.surfaceLine else ObsidianTheme.colors.line,
    content: @Composable BoxScope.() -> Unit
) {
    val bgBrush = if (variant == ObsidianSurfaceVariant.SURFACE) {
        Brush.verticalGradient(listOf(ObsidianTheme.colors.surfaceTop, ObsidianTheme.colors.surfaceBottom))
    } else {
        Brush.verticalGradient(listOf(ObsidianTheme.colors.itemTop, ObsidianTheme.colors.itemBottom))
    }

    Box(
        modifier = modifier
            .clip(shape)
            .background(bgBrush)
            .border(borderWidth, borderColor, shape)
    ) {
        content()
    }
}

// ============================================================================
// 2. BUTTON (v-obsidian-btn, btn-2, danger, btn-sm, icon-btn, is-confirmed)
// ============================================================================

enum class ObsidianButtonVariant {
    PRIMARY,   // Gold-light to gold-deep gradient at 135deg, on-gold text, 1px gold-edge
    SECONDARY, // Fill ground, amber-line border, gold-pale text
    DANGER,    // Fill ground, danger-line border, danger text
    GHOST,     // Transparent ground, muted text
    CONFIRMED  // Success-light to success-deep gradient, on-gold text
}

@Composable
fun ObsidianButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ObsidianButtonVariant = ObsidianButtonVariant.PRIMARY,
    enabled: Boolean = true,
    compact: Boolean = false,
    icon: (@Composable () -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.97f else 1f,
        animationSpec = tween(durationMillis = 161),
        label = "btn-press-scale"
    )

    val shape = if (compact) ObsidianShapes.radius10 else ObsidianShapes.radius12

    val bgBrush = when {
        !enabled -> SolidColor(colors.fill)
        variant == ObsidianButtonVariant.PRIMARY -> colors.goldGradient
        variant == ObsidianButtonVariant.CONFIRMED -> colors.successGradient
        variant == ObsidianButtonVariant.GHOST -> SolidColor(Color.Transparent)
        else -> SolidColor(colors.fill)
    }

    val fgColor = when {
        !enabled -> colors.faint
        variant == ObsidianButtonVariant.PRIMARY -> colors.onGold
        variant == ObsidianButtonVariant.CONFIRMED -> colors.onGold
        variant == ObsidianButtonVariant.DANGER -> colors.danger
        variant == ObsidianButtonVariant.SECONDARY -> colors.goldPale
        variant == ObsidianButtonVariant.GHOST -> colors.textSoft
        else -> colors.text
    }

    val borderColor = when {
        !enabled -> colors.line
        variant == ObsidianButtonVariant.PRIMARY -> colors.goldEdge
        variant == ObsidianButtonVariant.CONFIRMED -> colors.successEdge
        variant == ObsidianButtonVariant.DANGER -> colors.dangerLine
        variant == ObsidianButtonVariant.SECONDARY -> colors.amberLine
        variant == ObsidianButtonVariant.GHOST -> Color.Transparent
        else -> colors.line
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
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (icon != null) {
                icon()
                Spacer(modifier = Modifier.width(6.dp))
            }
            BasicText(
                text = text,
                style = (if (compact) typo.small else typo.label).copy(
                    color = fgColor,
                    fontWeight = if (variant == ObsidianButtonVariant.PRIMARY) FontWeight.Bold else FontWeight.SemiBold
                )
            )
        }
    }
}

@Composable
fun ObsidianIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: Dp = 34.dp,
    content: @Composable () -> Unit
) {
    val colors = ObsidianTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val shape = ObsidianShapes.radius11

    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(colors.fill)
            .border(1.dp, colors.amberLine, shape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

// ============================================================================
// 3. TOPBAR (.topbar, brand, logo, crumbs, seg, actions)
// ============================================================================

@Composable
fun ObsidianTopBar(
    brandName: String = "Signal Desk",
    crumb: String? = null,
    modifier: Modifier = Modifier,
    navigationSegment: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.topbarFill)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Logo Tile ◆
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(ObsidianShapes.radius9)
                    .background(colors.accent),
                contentAlignment = Alignment.Center
            ) {
                BasicText(
                    text = "◆",
                    style = TextStyle(
                        color = colors.accentInk,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                )
            }

            Spacer(modifier = Modifier.width(10.dp))

            // Brand title
            BasicText(
                text = brandName,
                style = typo.brand.copy(color = colors.text)
            )

            if (crumb != null) {
                Spacer(modifier = Modifier.width(8.dp))
                BasicText(
                    text = "· $crumb",
                    style = typo.meta.copy(color = colors.faint)
                )
            }

            if (navigationSegment != null) {
                Spacer(modifier = Modifier.width(12.dp))
                navigationSegment()
            }

            Spacer(modifier = Modifier.weight(1f))

            if (actions != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    content = actions
                )
            }
        }

        // Bottom hairline
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.surfaceLine)
        )
    }
}

// ============================================================================
// 4. SEGMENTED CONTROL (.seg, .seg-lens, .seg-btn)
// ============================================================================

@Composable
fun ObsidianSegmentedControl(
    items: List<String>,
    selectedIndex: Int,
    onSelectIndex: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Row(
        modifier = modifier
            .clip(ObsidianShapes.radius14)
            .background(colors.fill)
            .border(1.dp, colors.accent.copy(alpha = 0.20f), ObsidianShapes.radius14)
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        items.forEachIndexed { index, title ->
            val isSelected = index == selectedIndex
            val itemShape = ObsidianShapes.radius10

            Box(
                modifier = Modifier
                    .clip(itemShape)
                    .then(
                        if (isSelected) {
                            Modifier
                                .background(colors.lensGradient)
                                .border(1.dp, colors.lensTop.copy(alpha = 0.8f), itemShape)
                        } else {
                            Modifier.background(Color.Transparent)
                        }
                    )
                    .clickable(role = Role.Tab) { onSelectIndex(index) }
                    .padding(horizontal = 14.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center
            ) {
                BasicText(
                    text = title,
                    style = typo.label.copy(
                        color = if (isSelected) colors.onGold else colors.textDim,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold
                    )
                )
            }
        }
    }
}

// ============================================================================
// 5. BADGE (.badge, amber-fill, amber-line, gold-pale)
// ============================================================================

@Composable
fun ObsidianBadge(
    text: String,
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Box(
        modifier = modifier
            .clip(ObsidianShapes.radius8)
            .background(colors.amberFill)
            .border(1.dp, colors.amberLine, ObsidianShapes.radius8)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center
    ) {
        BasicText(
            text = text,
            style = typo.tag.copy(
                color = colors.goldPale,
                fontWeight = FontWeight.Bold
            )
        )
    }
}

// ============================================================================
// 6. STATUS PILL (.pill, .status-btn, .tone-*)
// ============================================================================

enum class ObsidianStatusTone {
    BACKLOG,
    DOING,
    BLOCKED,
    DONE
}

@Composable
fun ObsidianStatusPill(
    status: String,
    tone: ObsidianStatusTone = ObsidianStatusTone.BACKLOG,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    val baseToneColor = when (tone) {
        ObsidianStatusTone.BACKLOG -> colors.statusBacklog
        ObsidianStatusTone.DOING -> colors.statusDoing
        ObsidianStatusTone.BLOCKED -> colors.statusBlocked
        ObsidianStatusTone.DONE -> colors.statusDone
    }

    val pillBg = baseToneColor.copy(alpha = 0.12f)
    val pillBorder = baseToneColor.copy(alpha = 0.35f)
    val shape = ObsidianShapes.radiusFull

    val clickableMod = if (onClick != null) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else Modifier

    Row(
        modifier = modifier
            .clip(shape)
            .background(pillBg)
            .border(1.dp, pillBorder, shape)
            .then(clickableMod)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(baseToneColor)
        )
        BasicText(
            text = status,
            style = typo.fieldLabel.copy(
                color = baseToneColor,
                fontWeight = FontWeight.Bold
            )
        )
    }
}

// ============================================================================
// 7. TAG (.tag, .tone-dev, .tone-desain, .tone-riset, etc.)
// ============================================================================

@Composable
fun ObsidianTag(
    label: String,
    modifier: Modifier = Modifier,
    customTone: Color? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    val toneColor = customTone ?: when (label.lowercase(Locale.ROOT)) {
        "dev" -> colors.labelDev
        "desain" -> colors.labelDesain
        "riset" -> colors.labelRiset
        "konten" -> colors.labelKonten
        "docs" -> colors.labelDocs
        else -> colors.muted
    }

    val tagBg = toneColor.copy(alpha = 0.14f)
    val tagBorder = toneColor.copy(alpha = 0.30f)
    val shape = ObsidianShapes.radius8

    Box(
        modifier = modifier
            .clip(shape)
            .background(tagBg)
            .border(1.dp, tagBorder, shape)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center
    ) {
        BasicText(
            text = label,
            style = typo.tag.copy(
                color = toneColor,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp
            )
        )
    }
}

// ============================================================================
// 8. AVATAR (.avatar, hsl(--h 72% 74%), on-gold initials)
// ============================================================================

@Composable
fun ObsidianAvatar(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 24.dp
) {
    val colors = ObsidianTheme.colors
    val initials = name.trim().split(" ")
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .take(2)
        .joinToString("")
        .ifEmpty { name.take(2).uppercase(Locale.ROOT) }

    val hash = abs(name.hashCode()) % 360
    // Generate two harmonious gradient stops based on hash
    val color1 = Color.hsl(hash.toFloat(), 0.72f, 0.74f)
    val color2 = Color.hsl(hash.toFloat(), 0.60f, 0.52f)

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(color1, color2))),
        contentAlignment = Alignment.Center
    ) {
        BasicText(
            text = initials,
            style = TextStyle(
                color = colors.onGold,
                fontSize = (size.value * 0.42f).sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center
            )
        )
    }
}

// ============================================================================
// 9. KANBAN CARD (.card, .card-title, .card-bar, .card-meta)
// ============================================================================

@Composable
fun ObsidianKanbanCard(
    title: String,
    modifier: Modifier = Modifier,
    labels: List<String> = emptyList(),
    dueDate: String? = null,
    checklistProgress: Pair<Int, Int>? = null, // done to total
    commentsCount: Int = 0,
    ownerName: String? = null,
    onCardClick: (() -> Unit)? = null,
    onMoveClick: (() -> Unit)? = null,
    isDone: Boolean = false
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.ITEM,
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (onCardClick != null) Modifier.clickable(role = Role.Button, onClick = onCardClick)
                else Modifier
            )
            .padding(12.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Tags row
            if (labels.isNotEmpty()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    labels.forEach { label ->
                        ObsidianTag(label = label)
                    }
                }
            }

            // Card title
            BasicText(
                text = title,
                style = typo.cardTitle.copy(
                    color = if (isDone) colors.faint else colors.text,
                    textDecoration = if (isDone) TextDecoration.LineThrough else null
                ),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            // Progress bar
            if (checklistProgress != null && checklistProgress.second > 0) {
                val ratio = checklistProgress.first.toFloat() / checklistProgress.second.toFloat()
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color(0x12FFFFFF))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(fraction = ratio.coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(2.dp))
                            .background(colors.goldGradient)
                    )
                }
            }

            // Meta row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (dueDate != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        BasicText(text = "📅", style = TextStyle(fontSize = 11.sp))
                        BasicText(
                            text = dueDate,
                            style = typo.meta.copy(color = colors.muted)
                        )
                    }
                }

                if (checklistProgress != null && checklistProgress.second > 0) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        BasicText(text = "☑", style = TextStyle(fontSize = 11.sp))
                        BasicText(
                            text = "${checklistProgress.first}/${checklistProgress.second}",
                            style = typo.meta.copy(color = colors.muted)
                        )
                    }
                }

                if (commentsCount > 0) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        BasicText(text = "💬", style = TextStyle(fontSize = 11.sp))
                        BasicText(
                            text = commentsCount.toString(),
                            style = typo.meta.copy(color = colors.muted)
                        )
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                if (onMoveClick != null && !isDone) {
                    ObsidianButton(
                        text = "Pindah →",
                        onClick = onMoveClick,
                        variant = ObsidianButtonVariant.SECONDARY,
                        compact = true
                    )
                }

                if (ownerName != null) {
                    ObsidianAvatar(name = ownerName, size = 22.dp)
                }
            }
        }
    }
}

// ============================================================================
// 10. BOARD COLUMN (.col, .col-head, .col-title, .col-add, .col-body)
// ============================================================================

@Composable
fun ObsidianBoardColumn(
    title: String,
    count: Int,
    tone: ObsidianStatusTone,
    modifier: Modifier = Modifier,
    onAddClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.SURFACE,
        modifier = modifier
            .width(280.dp)
            .padding(horizontal = 6.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            // Column Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val dotColor = when (tone) {
                    ObsidianStatusTone.BACKLOG -> colors.statusBacklog
                    ObsidianStatusTone.DOING -> colors.statusDoing
                    ObsidianStatusTone.BLOCKED -> colors.statusBlocked
                    ObsidianStatusTone.DONE -> colors.statusDone
                }
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(dotColor)
                )

                Spacer(modifier = Modifier.width(8.dp))

                BasicText(
                    text = title,
                    style = typo.columnTitle.copy(color = colors.text)
                )

                Spacer(modifier = Modifier.width(8.dp))

                ObsidianBadge(text = count.toString())

                Spacer(modifier = Modifier.weight(1f))

                if (onAddClick != null) {
                    ObsidianIconButton(
                        onClick = onAddClick,
                        size = 28.dp
                    ) {
                        BasicText(
                            text = "+",
                            style = typo.label.copy(color = colors.goldPale, fontSize = 16.sp)
                        )
                    }
                }
            }

            // Cards Column Content
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content
            )
        }
    }
}

// ============================================================================
// 11. CHECKLIST (.ck, .ck-box, .ck-t, .ck-bar, .ck-add)
// ============================================================================

@Composable
fun ObsidianChecklistItem(
    text: String,
    isChecked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    onDelete: (() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ObsidianShapes.radius10)
            .background(colors.fill)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Custom animated square checkbox
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(ObsidianShapes.radius6)
                .then(
                    if (isChecked) {
                        Modifier
                            .background(colors.goldGradient)
                            .border(1.dp, colors.goldEdge, ObsidianShapes.radius6)
                    } else {
                        Modifier
                            .background(Color.Transparent)
                            .border(1.5.dp, colors.accent.copy(alpha = 0.5f), ObsidianShapes.radius6)
                    }
                )
                .clickable(role = Role.Checkbox) { onCheckedChange(!isChecked) },
            contentAlignment = Alignment.Center
        ) {
            if (isChecked) {
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

        Spacer(modifier = Modifier.width(10.dp))

        BasicText(
            text = text,
            style = typo.body.copy(
                color = if (isChecked) colors.faint else colors.text,
                textDecoration = if (isChecked) TextDecoration.LineThrough else null
            ),
            modifier = Modifier.weight(1f)
        )

        if (onDelete != null) {
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .clip(ObsidianShapes.radius8)
                    .clickable(role = Role.Button, onClick = onDelete),
                contentAlignment = Alignment.Center
            ) {
                BasicText(
                    text = "×",
                    style = TextStyle(color = colors.faint, fontSize = 16.sp)
                )
            }
        }
    }
}

// ============================================================================
// 12. COMMENT THREAD (.cm, .cm-bubble, .cm-meta, .cm-form)
// ============================================================================

@Composable
fun ObsidianCommentItem(
    author: String,
    time: String,
    body: String,
    modifier: Modifier = Modifier,
    onReply: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        ObsidianAvatar(name = author, size = 28.dp)

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                BasicText(
                    text = author,
                    style = typo.cardTitle.copy(color = colors.text, fontSize = 13.sp)
                )
                BasicText(
                    text = time,
                    style = typo.monoMeta.copy(color = colors.faint, fontSize = 11.sp)
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            ObsidianSurface(
                variant = ObsidianSurfaceVariant.ITEM,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(10.dp)
            ) {
                BasicText(
                    text = body,
                    style = typo.body.copy(color = colors.textSoft)
                )
            }

            if (onReply != null || onDelete != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (onReply != null) {
                        BasicText(
                            text = "Balas",
                            style = typo.tag.copy(color = colors.muted),
                            modifier = Modifier.clickable(onClick = onReply)
                        )
                    }
                    if (onDelete != null) {
                        BasicText(
                            text = "Hapus",
                            style = typo.tag.copy(color = colors.danger),
                            modifier = Modifier.clickable(onClick = onDelete)
                        )
                    }
                }
            }
        }
    }
}

// ============================================================================
// 13. COVER (.cover, .art, .words, geometric art, Instrument Serif)
// ============================================================================

@Composable
fun ObsidianCover(
    title: String = "Obsidian",
    tagline: String = "Dark Luxe surfaces, Honey Bubble motion.",
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.SURFACE,
        modifier = modifier
            .fillMaxWidth()
            .height(180.dp)
            .padding(18.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                BasicText(
                    text = title,
                    style = typo.display.copy(fontSize = 38.sp, lineHeight = 42.sp)
                )
                Spacer(modifier = Modifier.height(8.dp))
                BasicText(
                    text = tagline,
                    style = typo.body.copy(color = colors.muted)
                )
            }

            // Geometric art slabs & bubble discs
            Box(
                modifier = Modifier
                    .width(140.dp)
                    .fillMaxHeight(),
                contentAlignment = Alignment.CenterEnd
            ) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    // Gold slab
                    drawRoundRect(
                        color = colors.accent,
                        topLeft = Offset(size.width * 0.4f, 0f),
                        size = Size(size.width * 0.55f, size.height * 0.85f),
                        cornerRadius = CornerRadius(14f, 14f)
                    )
                    // Satellite deep slab
                    drawRoundRect(
                        color = colors.goldDeep,
                        topLeft = Offset(size.width * 0.1f, size.height * 0.35f),
                        size = Size(size.width * 0.4f, size.height * 0.55f),
                        cornerRadius = CornerRadius(12f, 12f)
                    )
                    // Doing signal pill
                    drawRoundRect(
                        color = colors.statusDoing,
                        topLeft = Offset(0f, size.height * 0.75f),
                        size = Size(size.width * 0.3f, size.height * 0.18f),
                        cornerRadius = CornerRadius(8f, 8f)
                    )
                }
            }
        }
    }
}

// ============================================================================
// 14. DATE PICKER (.cal, .cal-head, .cal-dow, .cal-grid, .cal-day)
// ============================================================================

@Composable
fun ObsidianDatePickerDialog(
    selectedDate: LocalDate?,
    onDateSelected: (LocalDate?) -> Unit,
    onDismissRequest: () -> Unit
) {
    var viewMonth by remember { mutableStateOf(YearMonth.now()) }
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Dialog(onDismissRequest = onDismissRequest) {
        ObsidianSurface(
            variant = ObsidianSurfaceVariant.SURFACE,
            modifier = Modifier
                .width(300.dp)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Header with navigation
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ObsidianIconButton(
                        onClick = { viewMonth = viewMonth.minusMonths(1) },
                        size = 30.dp
                    ) {
                        BasicText("‹", style = TextStyle(color = colors.goldPale, fontSize = 18.sp))
                    }

                    BasicText(
                        text = viewMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale("id"))),
                        style = typo.columnTitle.copy(color = colors.text)
                    )

                    ObsidianIconButton(
                        onClick = { viewMonth = viewMonth.plusMonths(1) },
                        size = 30.dp
                    ) {
                        BasicText("›", style = TextStyle(color = colors.goldPale, fontSize = 18.sp))
                    }
                }

                // Days of week
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min").forEach { day ->
                        BasicText(
                            text = day,
                            style = typo.overline.copy(color = colors.faint)
                        )
                    }
                }

                // Days Grid (6 weeks)
                val firstOfMonth = viewMonth.atDay(1)
                val dayOfWeek = (firstOfMonth.dayOfWeek.value - 1) // 0 for Monday
                val startDay = firstOfMonth.minusDays(dayOfWeek.toLong())

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    for (week in 0 until 6) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceAround
                        ) {
                            for (col in 0 until 7) {
                                val date = startDay.plusDays((week * 7 + col).toLong())
                                val isCurrentMonth = date.month == viewMonth.month
                                val isSelected = date == selectedDate
                                val isToday = date == LocalDate.now()

                                val dayShape = ObsidianShapes.radius10

                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(dayShape)
                                        .then(
                                            when {
                                                isSelected -> Modifier
                                                    .background(colors.goldGradient)
                                                    .border(1.dp, colors.goldEdge, dayShape)
                                                isToday -> Modifier.border(1.dp, colors.focusLine, dayShape)
                                                else -> Modifier
                                            }
                                        )
                                        .clickable { onDateSelected(date) },
                                    contentAlignment = Alignment.Center
                                ) {
                                    BasicText(
                                        text = date.dayOfMonth.toString(),
                                        style = typo.label.copy(
                                            color = when {
                                                isSelected -> colors.onGold
                                                isToday -> colors.goldPale
                                                !isCurrentMonth -> colors.faint
                                                else -> colors.text
                                            },
                                            fontWeight = if (isSelected || isToday) FontWeight.Bold else FontWeight.Normal
                                        )
                                    )
                                }
                            }
                        }
                    }
                }

                // Actions Footer
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ObsidianButton(
                        text = "Hari ini",
                        onClick = { onDateSelected(LocalDate.now()) },
                        variant = ObsidianButtonVariant.SECONDARY,
                        compact = true
                    )
                    ObsidianButton(
                        text = "Hapus",
                        onClick = { onDateSelected(null) },
                        variant = ObsidianButtonVariant.GHOST,
                        compact = true
                    )
                }
            }
        }
    }
}

// ============================================================================
// 15. EMPTY STATE (.col-empty, dashed outline, faint text)
// ============================================================================

@Composable
fun ObsidianEmptyState(
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onActionClick: (() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(ObsidianShapes.radius12)
            .border(1.dp, colors.lineChip, ObsidianShapes.radius12)
            .padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            BasicText(
                text = message,
                style = typo.body.copy(color = colors.faint, textAlign = TextAlign.Center)
            )

            if (actionLabel != null && onActionClick != null) {
                ObsidianButton(
                    text = actionLabel,
                    onClick = onActionClick,
                    variant = ObsidianButtonVariant.SECONDARY,
                    compact = true
                )
            }
        }
    }
}

// ============================================================================
// 16. INPUT (.inp, .field, search, textarea, select)
// ============================================================================

@Composable
fun ObsidianTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val shape = if (singleLine) ObsidianShapes.radius10 else ObsidianShapes.radius12

    Column(modifier = modifier) {
        if (label != null) {
            BasicText(
                text = label,
                style = typo.fieldLabel.copy(color = colors.muted)
            )
            Spacer(modifier = Modifier.height(6.dp))
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (singleLine) Modifier.height(38.dp) else Modifier.heightIn(min = 84.dp))
                .clip(shape)
                .background(colors.fill)
                .border(
                    width = if (isError) 1.5.dp else 1.dp,
                    color = if (isError) colors.errorLine else colors.lineStrong,
                    shape = shape
                )
                .padding(horizontal = 12.dp, vertical = if (singleLine) 8.dp else 10.dp),
            contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top
            ) {
                if (leadingIcon != null) {
                    leadingIcon()
                    Spacer(modifier = Modifier.width(8.dp))
                }

                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder != null) {
                        BasicText(
                            text = placeholder,
                            style = typo.body.copy(color = colors.faint)
                        )
                    }

                    BasicTextField(
                        value = value,
                        onValueChange = onValueChange,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = typo.body.copy(color = colors.text),
                        cursorBrush = SolidColor(colors.accent),
                        singleLine = singleLine,
                        keyboardOptions = keyboardOptions,
                        keyboardActions = keyboardActions
                    )
                }

                if (trailingIcon != null) {
                    Spacer(modifier = Modifier.width(8.dp))
                    trailingIcon()
                }
            }
        }

        if (isError && errorMessage != null) {
            Spacer(modifier = Modifier.height(4.dp))
            BasicText(
                text = errorMessage,
                style = typo.meta.copy(color = colors.danger, fontWeight = FontWeight.SemiBold)
            )
        }
    }
}

// ============================================================================
// 17. MENU (.menu, .menu-item, .menu-title)
// ============================================================================

data class ObsidianMenuItemData(
    val title: String,
    val leadingIcon: String? = null,
    val trailingBadge: String? = null,
    val isSelected: Boolean = false,
    val onClick: () -> Unit
)

@Composable
fun ObsidianMenu(
    items: List<ObsidianMenuItemData>,
    modifier: Modifier = Modifier,
    title: String? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.SURFACE,
        shape = ObsidianShapes.radius14,
        modifier = modifier
            .widthIn(min = 190.dp)
            .padding(8.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            if (title != null) {
                BasicText(
                    text = title.uppercase(Locale.ROOT),
                    style = typo.overline.copy(color = colors.faint),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }

            items.forEach { item ->
                val itemShape = ObsidianShapes.radius10
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(itemShape)
                        .then(
                            if (item.isSelected) {
                                Modifier
                                    .background(colors.accent.copy(alpha = 0.08f))
                                    .border(1.dp, colors.itemHoverLine, itemShape)
                            } else Modifier
                        )
                        .clickable(role = Role.Button, onClick = item.onClick)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (item.leadingIcon != null) {
                        BasicText(text = item.leadingIcon, style = TextStyle(fontSize = 13.sp))
                        Spacer(modifier = Modifier.width(8.dp))
                    }

                    BasicText(
                        text = item.title,
                        style = typo.label.copy(color = colors.text),
                        modifier = Modifier.weight(1f)
                    )

                    if (item.trailingBadge != null) {
                        BasicText(
                            text = item.trailingBadge,
                            style = typo.monoMeta.copy(color = colors.faint)
                        )
                    }

                    if (item.isSelected) {
                        Spacer(modifier = Modifier.width(6.dp))
                        BasicText(
                            text = "✓",
                            style = TextStyle(color = colors.accent, fontWeight = FontWeight.Bold)
                        )
                    }
                }
            }
        }
    }
}

// ============================================================================
// 18. METRIC (.metric, .metrics, dl/dt/dd, digit roller, pct, bar)
// ============================================================================

@Composable
fun ObsidianMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    percentage: Int? = null,
    showProgressBar: Boolean = false
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Box(
        modifier = modifier
            .clip(ObsidianShapes.radius12)
            .background(colors.fill)
            .border(1.dp, colors.lineStrong, ObsidianShapes.radius12)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Label in mono overline
            BasicText(
                text = label.uppercase(Locale.ROOT),
                style = typo.overline.copy(color = colors.faint)
            )

            // Value + optional percent sign
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                BasicText(
                    text = value,
                    style = typo.metric.copy(color = colors.text)
                )

                if (percentage != null) {
                    BasicText(
                        text = "%",
                        style = typo.meta.copy(color = colors.muted, fontSize = 16.sp)
                    )
                }
            }

            // Progress bar
            if (showProgressBar && percentage != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(colors.line)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(fraction = (percentage / 100f).coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(3.dp))
                            .background(colors.goldGradient)
                    )
                }
            }
        }
    }
}

// ============================================================================
// 19. MODAL (.modal, .backdrop, .m-top, .m-title, .props, .m-actions)
// ============================================================================

@Composable
fun ObsidianModal(
    title: String,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    actions: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        // Modal Backdrop
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.backdrop)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismissRequest
                )
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            // Modal Card Surface
            ObsidianSurface(
                variant = ObsidianSurfaceVariant.SURFACE,
                modifier = modifier
                    .fillMaxWidth(0.95f)
                    .widthIn(max = 680.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {} // Consume click
                    )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp)
                ) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        BasicText(
                            text = title,
                            style = typo.modalTitle.copy(color = colors.text),
                            modifier = Modifier.weight(1f)
                        )

                        ObsidianIconButton(
                            onClick = onDismissRequest,
                            size = 32.dp
                        ) {
                            BasicText("×", style = TextStyle(color = colors.faint, fontSize = 20.sp))
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Content
                    content()

                    // Actions row
                    if (actions != null) {
                        Spacer(modifier = Modifier.height(18.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(colors.line)
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                            content = actions
                        )
                    }
                }
            }
        }
    }
}

// ============================================================================
// 20. MORPHING LABEL (.ml, .ml-cur)
// ============================================================================

@Composable
fun ObsidianMorphingLabel(
    text: String,
    style: TextStyle = ObsidianTheme.typography.body,
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    BasicText(
        text = text,
        style = style.copy(color = if (style.color != Color.Unspecified) style.color else colors.text),
        modifier = modifier
    )
}

// ============================================================================
// 21. ROLLER (.roller, .rl-col, .rl-strip)
// ============================================================================

@Composable
fun ObsidianRoller(
    value: Int,
    style: TextStyle = ObsidianTheme.typography.metric,
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    BasicText(
        text = value.toString(),
        style = style.copy(
            color = if (style.color != Color.Unspecified) style.color else colors.text,
            fontFamily = FontFamily.Monospace
        ),
        modifier = modifier
    )
}

// ============================================================================
// 22. CHIP (.chip, .chips, .is-selected)
// ============================================================================

@Composable
fun ObsidianChip(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val shape = ObsidianShapes.radiusFull

    val bgBrush = if (isSelected) colors.goldGradient else SolidColor(colors.fill)
    val borderColor = if (isSelected) colors.goldEdge else colors.lineChip
    val fgColor = if (isSelected) colors.onGold else colors.textDim

    Row(
        modifier = modifier
            .clip(shape)
            .background(bgBrush)
            .border(1.dp, borderColor, shape)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        BasicText(
            text = label,
            style = typo.small.copy(
                color = fgColor,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold
            )
        )

        if (count != null) {
            BasicText(
                text = count.toString(),
                style = typo.monoMeta.copy(color = fgColor)
            )
        }
    }
}

// ============================================================================
// 23. SWITCH (.switch, 44x26px, gold on, sliding circular thumb)
// ============================================================================

@Composable
fun ObsidianSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val colors = ObsidianTheme.colors
    val thumbOffset by animateFloatAsState(
        targetValue = if (checked) 18f else 0f,
        animationSpec = tween(durationMillis = 161),
        label = "switch-thumb"
    )

    val shape = ObsidianShapes.radiusFull

    Box(
        modifier = modifier
            .size(width = 44.dp, height = 26.dp)
            .clip(shape)
            .then(
                if (checked) {
                    Modifier
                        .background(colors.goldGradient)
                        .border(1.dp, colors.goldEdge, shape)
                } else {
                    Modifier
                        .background(colors.fillHover)
                        .border(1.dp, Color(0x24FFFFFF), shape)
                }
            )
            .clickable(
                enabled = enabled,
                role = Role.Switch,
                onClick = { onCheckedChange(!checked) }
            )
            .padding(2.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        Box(
            modifier = Modifier
                .offset(x = thumbOffset.dp)
                .size(20.dp)
                .clip(CircleShape)
                .background(if (checked) colors.onGold else colors.text)
        )
    }
}

// ============================================================================
// 24. TABLE ROW (.tbl, .trow, .tgrid, .thead)
// ============================================================================

@Composable
fun ObsidianTableRow(
    title: String,
    status: String,
    tone: ObsidianStatusTone,
    modifier: Modifier = Modifier,
    tags: List<String> = emptyList(),
    dueDate: String? = null,
    ownerName: String? = null,
    onClick: (() -> Unit)? = null
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.ITEM,
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick)
                else Modifier
            )
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Title
            BasicText(
                text = title,
                style = typo.cardTitle.copy(color = colors.text),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(2f)
            )

            // Status Pill
            ObsidianStatusPill(
                status = status,
                tone = tone
            )

            // First tag if any
            if (tags.isNotEmpty()) {
                ObsidianTag(label = tags.first())
            }

            // Due Date
            if (dueDate != null) {
                BasicText(
                    text = dueDate,
                    style = typo.monoMeta.copy(color = colors.muted)
                )
            }

            // Owner Avatar
            if (ownerName != null) {
                ObsidianAvatar(name = ownerName, size = 22.dp)
            }
        }
    }
}

// ============================================================================
// 25. TOAST (.toast, .toasts, status dot, message)
// ============================================================================

@Composable
fun ObsidianToast(
    message: String,
    toneColor: Color = ObsidianTheme.colors.statusDone,
    modifier: Modifier = Modifier
) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.SURFACE,
        shape = ObsidianShapes.radius14,
        modifier = modifier
            .widthIn(max = 480.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(toneColor)
            )

            BasicText(
                text = message,
                style = typo.label.copy(color = colors.text)
            )
        }
    }
}

// ============================================================================
// 26. ACCORDION (.acc, .acc-item, .acc-head, .acc-body, .acc-line)
// ============================================================================

@Composable
fun ObsidianAccordion(
    title: String,
    lines: List<String>,
    modifier: Modifier = Modifier,
    initialExpanded: Boolean = false
) {
    var expanded by remember { mutableStateOf(initialExpanded) }
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography

    ObsidianSurface(
        variant = ObsidianSurfaceVariant.ITEM,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    BasicText(
                        text = if (expanded) "▾" else "▸",
                        style = TextStyle(color = colors.accent, fontSize = 14.sp)
                    )
                    BasicText(
                        text = title,
                        style = typo.blockTitle.copy(color = colors.text)
                    )
                }

                ObsidianBadge(text = lines.size.toString())
            }

            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 36.dp, end = 14.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    lines.forEach { line ->
                        Row(
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 6.dp)
                                    .size(5.dp)
                                    .clip(CircleShape)
                                    .background(colors.accent)
                            )
                            BasicText(
                                text = line,
                                style = typo.body.copy(color = colors.textSoft)
                            )
                        }
                    }
                }
            }
        }
    }
}

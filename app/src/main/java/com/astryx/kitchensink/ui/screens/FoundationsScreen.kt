package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.ColorAmber100
import com.astryx.kitchensink.theme.ColorAmber300
import com.astryx.kitchensink.theme.ColorAmber500
import com.astryx.kitchensink.theme.ColorAmber700
import com.astryx.kitchensink.theme.ColorAmber900
import com.astryx.kitchensink.theme.ColorGreen500
import com.astryx.kitchensink.theme.ColorNeutral100
import com.astryx.kitchensink.theme.ColorNeutral300
import com.astryx.kitchensink.theme.ColorNeutral500
import com.astryx.kitchensink.theme.ColorNeutral700
import com.astryx.kitchensink.theme.ColorNeutral900
import com.astryx.kitchensink.theme.ColorRed500
import com.astryx.kitchensink.theme.ColorSky100
import com.astryx.kitchensink.theme.ColorSky300
import com.astryx.kitchensink.theme.ColorSky400
import com.astryx.kitchensink.theme.ColorSky700
import com.astryx.kitchensink.theme.ColorSky900
import com.astryx.kitchensink.theme.ColorViolet100
import com.astryx.kitchensink.theme.ColorViolet300
import com.astryx.kitchensink.theme.ColorViolet500
import com.astryx.kitchensink.theme.ColorViolet700
import com.astryx.kitchensink.theme.ColorViolet900
import com.astryx.kitchensink.ui.components.Section

private data class Ramp(val name: String, val stops: List<Pair<String, Color>>)

private val ramps = listOf(
    Ramp(
        "Violet — Nyx",
        listOf("100" to ColorViolet100, "300" to ColorViolet300, "500" to ColorViolet500, "700" to ColorViolet700, "900" to ColorViolet900),
    ),
    Ramp(
        "Sky — Ryuki",
        listOf("100" to ColorSky100, "300" to ColorSky300, "400" to ColorSky400, "700" to ColorSky700, "900" to ColorSky900),
    ),
    Ramp(
        "Amber — nosmile99",
        listOf("100" to ColorAmber100, "300" to ColorAmber300, "500" to ColorAmber500, "700" to ColorAmber700, "900" to ColorAmber900),
    ),
    Ramp(
        "Neutral",
        listOf("100" to ColorNeutral100, "300" to ColorNeutral300, "500" to ColorNeutral500, "700" to ColorNeutral700, "900" to ColorNeutral900),
    ),
    Ramp("Functional", listOf("red 500" to ColorRed500, "green 500" to ColorGreen500)),
)

@Composable
fun FoundationsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
    ) {
        Section("Color ramps") {
            ramps.forEach { ramp ->
                Text(ramp.name, style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ramp.stops.forEach { (label, color) ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(color)
                                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp)),
                            )
                            Text(label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
        Section("Type scale") {
            val styles = listOf(
                "Display Large" to MaterialTheme.typography.displayLarge,
                "Headline Medium" to MaterialTheme.typography.headlineMedium,
                "Title Large" to MaterialTheme.typography.titleLarge,
                "Title Medium" to MaterialTheme.typography.titleMedium,
                "Body Large" to MaterialTheme.typography.bodyLarge,
                "Body Medium" to MaterialTheme.typography.bodyMedium,
                "Body Small" to MaterialTheme.typography.bodySmall,
                "Label Large" to MaterialTheme.typography.labelLarge,
                "Label Small" to MaterialTheme.typography.labelSmall,
            )
            styles.forEach { (name, style) ->
                Text(text = name, style = style)
            }
        }
        Section("Spacing (4dp base)") {
            val steps = listOf(4.dp to "xs", 8.dp to "sm", 12.dp to "md", 16.dp to "lg", 24.dp to "xl", 32.dp to "2xl")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                steps.forEach { (size, name) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            modifier = Modifier
                                .width(size)
                                .height(24.dp)
                                .background(MaterialTheme.colorScheme.primary),
                        )
                        Text(name, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Section("Radii") {
            val radii = listOf(4.dp to "xs", 8.dp to "sm", 12.dp to "md", 16.dp to "lg", 24.dp to "xl")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                radii.forEach { (radius, name) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(RoundedCornerShape(radius))
                                .background(MaterialTheme.colorScheme.secondaryContainer),
                        )
                        Text(name, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Section("Elevation") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf(0.dp to "0", 1.dp to "1", 3.dp to "2", 6.dp to "3", 12.dp to "5").forEach { (elevation, name) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Surface(
                            modifier = Modifier.size(56.dp),
                            shape = RoundedCornerShape(12.dp),
                            tonalElevation = elevation,
                            shadowElevation = elevation,
                        ) {}
                        Text("L$name", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

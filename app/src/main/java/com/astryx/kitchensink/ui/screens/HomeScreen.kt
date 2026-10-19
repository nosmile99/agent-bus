package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section

@Composable
fun HomeScreen(onOpenComponents: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Welcome") {
            Text(
                text = "Reference implementation of the kitchen-sink design system.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = "Every token on this screen comes from design-tokens/tokens.json, " +
                    "mapped to Material3 in the :android:theme module. Toggle the sun/moon " +
                    "icon up top to compare the light theme against the OLED-friendly dark theme.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = onOpenComponents) {
                Text("Browse components")
            }
        }
        Section("What lives here") {
            val bullets = listOf(
                "Foundations — color ramps, type scale, spacing, radii, elevation",
                "Components — buttons, cards, inputs, selection, feedback, lists, navigation",
                "Brand — the three agent identities: Nyx, Ryuki, nosmile99",
            )
            bullets.forEach { bullet ->
                Text(
                    text = "• $bullet",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

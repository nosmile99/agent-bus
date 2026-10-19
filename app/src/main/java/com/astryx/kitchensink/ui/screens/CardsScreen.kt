package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section

@Composable
private fun DemoCard(title: String, body: String) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun CardsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Elevated") {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                DemoCard("Elevated card", "Tonal + shadow elevation. Use for content that floats above the surface.")
            }
        }
        Section("Filled") {
            Card(modifier = Modifier.fillMaxWidth()) {
                DemoCard("Filled card", "Surface-container fill, no shadow. The default workhorse.")
            }
        }
        Section("Outlined") {
            OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                DemoCard("Outlined card", "Border only. Use for selectable or grouped content.")
            }
        }
    }
}

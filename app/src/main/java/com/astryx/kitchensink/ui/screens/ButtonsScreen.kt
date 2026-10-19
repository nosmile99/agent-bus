package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFloatingActionButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section

@Composable
fun ButtonsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Contained") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {}) { Text("Filled") }
                ElevatedButton(onClick = {}) { Text("Elevated") }
                Button(onClick = {}, enabled = false) { Text("Disabled") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = {}) { Text("Tonal") }
                OutlinedButton(onClick = {}) { Text("Outlined") }
                TextButton(onClick = {}) { Text("Text") }
            }
        }
        Section("Icon buttons") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(onClick = {}) { Icon(Icons.Filled.Favorite, contentDescription = "Like") }
                FilledIconButton(onClick = {}) { Icon(Icons.Filled.Favorite, contentDescription = "Like") }
                FilledTonalIconButton(onClick = {}) { Icon(Icons.Filled.Favorite, contentDescription = "Like") }
                OutlinedIconButton(onClick = {}) { Icon(Icons.Filled.Favorite, contentDescription = "Like") }
            }
        }
        Section("Floating action buttons") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SmallFloatingActionButton(onClick = {}) { Icon(Icons.Filled.Add, contentDescription = "Add") }
                FloatingActionButton(onClick = {}) { Icon(Icons.Filled.Add, contentDescription = "Add") }
                LargeFloatingActionButton(onClick = {}) { Icon(Icons.Filled.Add, contentDescription = "Add") }
            }
            ExtendedFloatingActionButton(
                onClick = {},
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Create") },
            )
        }
    }
}

package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedbackScreen() {
    var showDialog by rememberSaveable { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0.35f) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Progress indicators") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                CircularProgressIndicator(progress = { progress })
                CircularProgressIndicator()
            }
            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Button(onClick = { progress = (progress + 0.15f) % 1.05f }) {
                Text("Advance determinate")
            }
        }
        Section("Dialog") {
            Button(onClick = { showDialog = true }) { Text("Show dialog") }
            if (showDialog) {
                AlertDialog(
                    onDismissRequest = { showDialog = false },
                    title = { Text("Delete project?") },
                    text = { Text("This is a kitchen-sink demo dialog. Nothing will actually be deleted.") },
                    confirmButton = {
                        TextButton(onClick = { showDialog = false }) { Text("Delete") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showDialog = false }) { Text("Cancel") }
                    },
                )
            }
        }
        Section("Badges") {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                BadgedBox(badge = { Badge { Text("3") } }) {
                    Icon(Icons.Filled.Notifications, contentDescription = "Notifications")
                }
                BadgedBox(badge = { Badge() }) {
                    Icon(Icons.Filled.Notifications, contentDescription = "Notifications")
                }
                BadgedBox(
                    badge = { Badge(containerColor = MaterialTheme.colorScheme.tertiary) { Text("!") } },
                ) {
                    Icon(Icons.Filled.Notifications, contentDescription = "Notifications")
                }
            }
        }
        Section("Snackbar") {
            Button(
                onClick = {
                    scope.launch {
                        snackbarHostState.showSnackbar(
                            message = "Kitchen-sink snackbar",
                            actionLabel = "Undo",
                        )
                    }
                },
            ) { Text("Show snackbar") }
            SnackbarHost(hostState = snackbarHostState)
        }
    }
}

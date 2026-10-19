package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NavigationScreen() {
    var primaryTab by rememberSaveable { mutableIntStateOf(0) }
    var secondaryTab by rememberSaveable { mutableIntStateOf(1) }
    var segmented by rememberSaveable { mutableIntStateOf(0) }
    val tabs = listOf("Home", "Search", "Settings")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Primary tabs") {
            PrimaryTabRow(selectedTabIndex = primaryTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = primaryTab == index,
                        onClick = { primaryTab = index },
                        text = { Text(title) },
                    )
                }
            }
            Text(
                "Selected: ${tabs[primaryTab]}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Section("Secondary tabs") {
            SecondaryTabRow(selectedTabIndex = secondaryTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = secondaryTab == index,
                        onClick = { secondaryTab = index },
                        text = { Text(title) },
                    )
                }
            }
            Text(
                "Selected: ${tabs[secondaryTab]}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Section("Segmented buttons") {
            val options = listOf("Day", "Week", "Month")
            SingleChoiceSegmentedButtonRow {
                options.forEachIndexed { index, option ->
                    SegmentedButton(
                        selected = segmented == index,
                        onClick = { segmented = index },
                        shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    ) { Text(option) }
                }
            }
            Text(
                "Selected: ${options[segmented]}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

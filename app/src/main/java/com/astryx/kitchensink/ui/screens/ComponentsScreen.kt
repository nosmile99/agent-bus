package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Feedback
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.SmartButton
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.Buttons
import com.astryx.kitchensink.ui.Cards
import com.astryx.kitchensink.ui.Feedback
import com.astryx.kitchensink.ui.Inputs
import com.astryx.kitchensink.ui.Lists
import com.astryx.kitchensink.ui.Navigation
import com.astryx.kitchensink.ui.Selection

private data class Category(val route: Any, val label: String, val blurb: String, val icon: ImageVector)

private val categories = listOf(
    Category(Buttons, "Buttons", "Filled, tonal, outlined, text, icon, FAB", Icons.Filled.SmartButton),
    Category(Cards, "Cards", "Elevated, filled, outlined", Icons.Filled.CreditCard),
    Category(Inputs, "Inputs", "Text fields, search, password", Icons.Filled.TextFields),
    Category(Selection, "Selection", "Checkbox, radio, switch, slider", Icons.Filled.CheckBox),
    Category(Feedback, "Feedback", "Progress, dialogs, badges, snackbar", Icons.Filled.Feedback),
    Category(Lists, "Lists", "List items, dividers, lazy rows", Icons.Filled.List),
    Category(Navigation, "Navigation", "Tabs, segmented buttons", Icons.Filled.Navigation),
)

@Composable
fun ComponentsScreen(onOpen: (Any) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(categories) { category ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(category.route) },
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.Start,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(category.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(category.label, style = MaterialTheme.typography.titleMedium)
                    Text(
                        category.blurb,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

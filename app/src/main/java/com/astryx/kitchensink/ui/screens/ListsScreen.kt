package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private data class Person(val name: String, val role: String)

private val people = listOf(
    Person("Nyx", "Primary — brand accent"),
    Person("Ryuki", "Secondary — info accent"),
    Person("nosmile99", "Highlight — warning accent"),
    Person("Wren", "Coming soon"),
    Person("Argon", "Advisor"),
)

@Composable
fun ListsScreen() {
    var favorites by rememberSaveable { mutableStateOf(setOf<String>()) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(vertical = 8.dp),
    ) {
        item {
            Text(
                "One-line, two-line and three-line list items with dividers.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        items(people) { person ->
            val isFavorite = person.name in favorites
            ListItem(
                headlineContent = { Text(person.name) },
                supportingContent = { Text(person.role) },
                leadingContent = { Icon(Icons.Filled.Person, contentDescription = null) },
                trailingContent = {
                    IconButton(
                        onClick = {
                            favorites = if (isFavorite) favorites - person.name else favorites + person.name
                        },
                    ) {
                        Icon(
                            imageVector = if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            contentDescription = "Favorite",
                            tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
            )
            HorizontalDivider()
        }
    }
}

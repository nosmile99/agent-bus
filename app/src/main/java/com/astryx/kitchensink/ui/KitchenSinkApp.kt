package com.astryx.kitchensink.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Token
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.astryx.kitchensink.ui.screens.BrandScreen
import com.astryx.kitchensink.ui.screens.ButtonsScreen
import com.astryx.kitchensink.ui.screens.CardsScreen
import com.astryx.kitchensink.ui.screens.ComponentsScreen
import com.astryx.kitchensink.ui.screens.FeedbackScreen
import com.astryx.kitchensink.ui.screens.FoundationsScreen
import com.astryx.kitchensink.ui.screens.HomeScreen
import com.astryx.kitchensink.ui.screens.InputsScreen
import com.astryx.kitchensink.ui.screens.ListsScreen
import com.astryx.kitchensink.ui.screens.NavigationScreen
import com.astryx.kitchensink.ui.screens.SelectionScreen
import kotlinx.serialization.Serializable

/** All destinations. Bottom-nav tabs are the four roots; the rest are detail screens. */
@Serializable object Home
@Serializable object Foundations
@Serializable object Components
@Serializable object Brand
@Serializable object Buttons
@Serializable object Cards
@Serializable object Inputs
@Serializable object Selection
@Serializable object Feedback
@Serializable object Lists
@Serializable object Navigation

private data class Tab(val route: Any, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Home, "Home", Icons.Filled.Apps),
    Tab(Foundations, "Foundations", Icons.Filled.Token),
    Tab(Components, "Components", Icons.Filled.Widgets),
    Tab(Brand, "Brand", Icons.Filled.Palette),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KitchenSinkApp(darkTheme: Boolean, onToggleTheme: () -> Unit) {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val destination = backStack?.destination

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kitchen Sink") },
                actions = {
                    IconButton(onClick = onToggleTheme) {
                        Icon(
                            imageVector = if (darkTheme) Icons.Filled.LightMode else Icons.Filled.DarkMode,
                            contentDescription = "Toggle theme",
                        )
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    val selected = destination?.hierarchy?.any { it.hasRoute(tab.route::class) } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(Home) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Home,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable<Home> { HomeScreen(onOpenComponents = { navController.navigate(Components) }) }
            composable<Foundations> { FoundationsScreen() }
            composable<Components> {
                ComponentsScreen(
                    onOpen = { route ->
                        navController.navigate(route) {
                            launchSingleTop = true
                        }
                    },
                )
            }
            composable<Brand> { BrandScreen() }
            composable<Buttons> { ButtonsScreen() }
            composable<Cards> { CardsScreen() }
            composable<Inputs> { InputsScreen() }
            composable<Selection> { SelectionScreen() }
            composable<Feedback> { FeedbackScreen() }
            composable<Lists> { ListsScreen() }
            composable<Navigation> { NavigationScreen() }
        }
    }
}

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

/** Route names. Bottom-nav tabs are the four roots; the rest are detail screens. */
object Routes {
    const val HOME = "home"
    const val FOUNDATIONS = "foundations"
    const val COMPONENTS = "components"
    const val BRAND = "brand"
    const val BUTTONS = "buttons"
    const val CARDS = "cards"
    const val INPUTS = "inputs"
    const val SELECTION = "selection"
    const val FEEDBACK = "feedback"
    const val LISTS = "lists"
    const val NAVIGATION = "navigation"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Routes.HOME, "Home", Icons.Filled.Apps),
    Tab(Routes.FOUNDATIONS, "Foundations", Icons.Filled.Token),
    Tab(Routes.COMPONENTS, "Components", Icons.Filled.Widgets),
    Tab(Routes.BRAND, "Brand", Icons.Filled.Palette),
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
                    val selected = destination?.hierarchy?.any { it.route == tab.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(Routes.HOME) { saveState = true }
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
            startDestination = Routes.HOME,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Routes.HOME) { HomeScreen(onOpenComponents = { navController.navigate(Routes.COMPONENTS) }) }
            composable(Routes.FOUNDATIONS) { FoundationsScreen() }
            composable(Routes.COMPONENTS) {
                ComponentsScreen(
                    onOpen = { route ->
                        navController.navigate(route) {
                            launchSingleTop = true
                        }
                    },
                )
            }
            composable(Routes.BRAND) { BrandScreen() }
            composable(Routes.BUTTONS) { ButtonsScreen() }
            composable(Routes.CARDS) { CardsScreen() }
            composable(Routes.INPUTS) { InputsScreen() }
            composable(Routes.SELECTION) { SelectionScreen() }
            composable(Routes.FEEDBACK) { FeedbackScreen() }
            composable(Routes.LISTS) { ListsScreen() }
            composable(Routes.NAVIGATION) { NavigationScreen() }
        }
    }
}

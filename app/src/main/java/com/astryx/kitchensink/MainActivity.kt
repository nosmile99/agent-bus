package com.astryx.kitchensink

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.astryx.kitchensink.theme.LocalOp01Colors
import com.astryx.kitchensink.theme.Op01DarkColors
import com.astryx.kitchensink.theme.Op01LightColors
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.AnimatedOp01Colors
import com.astryx.kitchensink.ui.Op01App

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            // OP-01 is light-first: the limestone console is the default face.
            var darkTheme by rememberSaveable { mutableStateOf(false) }
            Op01Theme(darkTheme = darkTheme) {
                // Glide every color token toward the target scheme so the
                // light/dark toggle never hard-cuts.
                val animatedColors =
                    AnimatedOp01Colors(if (darkTheme) Op01DarkColors else Op01LightColors)
                CompositionLocalProvider(LocalOp01Colors provides animatedColors) {
                    Op01App(
                        darkTheme = darkTheme,
                        onToggleTheme = { darkTheme = !darkTheme },
                    )
                }
            }
        }
    }
}

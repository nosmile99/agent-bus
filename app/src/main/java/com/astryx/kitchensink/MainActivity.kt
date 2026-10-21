package com.astryx.kitchensink

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.Op01App

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            // OP-01 is light-first: the limestone console is the default face.
            var darkTheme by rememberSaveable { mutableStateOf(false) }
            Op01Theme(darkTheme = darkTheme) {
                Op01App(
                    darkTheme = darkTheme,
                    onToggleTheme = { darkTheme = !darkTheme },
                )
            }
        }
    }
}

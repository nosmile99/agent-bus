package com.agentbus.admin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.storage.FileBackedAdminStore
import com.agentbus.admin.ui.SignalDeskApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = FileBackedAdminStore(storageDir = applicationContext.filesDir)
        setContent {
            val scope = rememberCoroutineScope()
            val controller = remember {
                AdminAppController(
                    store = store,
                    scope = scope
                )
            }
            SignalDeskApp(controller = controller)
        }
    }
}

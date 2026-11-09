package com.agentbus.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.SdTheme

@Composable
fun LoginScreen(controller: AdminAppController) {
    val colors = SdTheme.colors
    var urlInput by remember(controller.baseUrl) { mutableStateOf(controller.baseUrl) }
    var userInput by remember(controller.loginUsername) { mutableStateOf(controller.loginUsername) }
    var passInput by remember { mutableStateOf("") }
    var tokenInput by remember(controller.adminToken) { mutableStateOf(controller.adminToken) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgCanvas)
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 520.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    SdTag(
                        text = "SIGNAL DESK // ADMIN CLIENT",
                        bgColor = colors.signalVermilion,
                        textColor = colors.onSignalVermilion,
                        borderColor = colors.signalVermilion
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    SdText(
                        text = "Agent Bus Dispatch Ledger",
                        style = SdTheme.typo.displayTitle
                    )
                }
                SdButton(
                    label = if (colors.isDark) "Theme: Night" else "Theme: Paper",
                    onClick = { controller.toggleTheme() },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }

            SdCard(accentTopColor = colors.signalVermilion) {
                SdText(
                    text = "HTTP Basic Admin Authentication",
                    style = SdTheme.typo.cardTitle
                )
                SdText(
                    text = "Credentials are encrypted at rest on device and never hardcoded or logged. Your Feed scroll anchor (#${controller.feedPersistence.anchorMessageId ?: "top"}) and poll cursor (${controller.pollCursor.sinceTs}:${controller.pollCursor.sinceId}) persist across re-login and URL changes.",
                    style = SdTheme.typo.bodySecondary
                )

                if (controller.authLoading) {
                    SdLoadingState(message = "Verifying HTTP Basic credentials against /admin/api/stats...")
                }

                if (controller.authError != null) {
                    SdErrorState(
                        title = "Authentication Failed",
                        cause = controller.authError ?: "Unauthorized",
                        onRetry = {
                            controller.login(urlInput, userInput, passInput, tokenInput)
                        }
                    )
                }

                SdTextField(
                    value = urlInput,
                    onValueChange = { urlInput = it },
                    label = "BACKEND BASE URL",
                    placeholder = "https://agent-bus-do.lukiznr.workers.dev"
                )

                SdTextField(
                    value = userInput,
                    onValueChange = { userInput = it },
                    label = "ADMIN USERNAME",
                    placeholder = "Enter admin username (e.g. luki)"
                )

                SdTextField(
                    value = passInput,
                    onValueChange = { passInput = it },
                    label = "ADMIN PASSWORD",
                    placeholder = "Enter admin password",
                    isPassword = true
                )

                SdTextField(
                    value = tokenInput,
                    onValueChange = { tokenInput = it },
                    label = "OPTIONAL X-ADMIN-TOKEN (FOR /admin/export & /admin/import)",
                    placeholder = "Leave blank unless using export/import",
                    isPassword = true
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    SdButton(
                        label = if (controller.authLoading) "Signing In..." else "Sign In to Dispatch Desk",
                        enabled = !controller.authLoading && userInput.isNotBlank() && passInput.isNotEmpty(),
                        onClick = {
                            controller.login(urlInput, userInput, passInput, tokenInput)
                        }
                    )
                }
            }
        }
    }
}

package com.agentbus.admin.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.agentbus.admin.model.ValidationRules
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.SdTheme
import kotlinx.coroutines.launch

@Composable
fun AgentsScreen(controller: AdminAppController) {
    val colors = SdTheme.colors
    val scope = rememberCoroutineScope()
    var newAgentName by remember { mutableStateOf("") }

    val cleanName = newAgentName.trim()
    val nameError = remember(cleanName) {
        if (cleanName.isEmpty()) null
        else if (!ValidationRules.isValidAgentName(cleanName)) {
            "Must match ^[a-z0-9][a-z0-9_-]{0,31}$ (lowercase alnum, _, -)"
        } else null
    }

    val liveByAgent = remember(controller.liveAgents) {
        controller.liveAgents.associateBy { it.agent }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Register New Agent Card (POST /admin/api/agents)
        SdCard(padding = 12.dp, accentTopColor = colors.cobaltInk) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    SdText(
                        text = "AGENT REGISTRY & LIVE CONNECTIONS",
                        style = SdTheme.typo.monoTag,
                        color = colors.cobaltInk
                    )
                    SdText(
                        text = "Registered: ${controller.registeredAgents.size}  |  Active WebSocket Agents: ${controller.liveAgents.size}. Secrets are shown once upon registration or rotation and never stored.",
                        style = SdTheme.typo.bodySecondary
                    )
                }
                SdButton(
                    label = "Refresh",
                    onClick = { scope.launch { controller.refreshAgents() } },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = newAgentName,
                    onValueChange = { newAgentName = it },
                    label = "REGISTER NEW AGENT (POST /admin/api/agents)",
                    placeholder = "e.g. worker-01",
                    errorText = nameError,
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Register Agent",
                    enabled = cleanName.isNotEmpty() && nameError == null,
                    onClick = {
                        controller.registerNewAgent(cleanName) {
                            newAgentName = ""
                        }
                    },
                    variant = SdButtonVariant.PRIMARY
                )
            }
        }

        when {
            controller.agentsLoading && controller.registeredAgents.isEmpty() -> {
                SdLoadingState(message = "Loading registered agents and live WebSocket connections...")
            }
            controller.agentsError != null && controller.registeredAgents.isEmpty() -> {
                SdErrorState(
                    title = "Agent Registry Load Failed",
                    cause = controller.agentsError ?: "Unknown error",
                    onRetry = { scope.launch { controller.refreshAgents() } }
                )
            }
            controller.registeredAgents.isEmpty() -> {
                SdEmptyState(
                    title = "No Agents Registered",
                    causeAndNextStep = "GET /admin/api/registered returned an empty list. Register an agent above to issue a bearer secret."
                )
            }
            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(controller.registeredAgents, key = { it.agent }) { ag ->
                        val liveConn = liveByAgent[ag.agent]
                        val isWs = ag.transport == "ws" || (liveConn != null && liveConn.connections > 0)
                        SdCard(
                            accentTopColor = if (isWs) colors.forestOk else null,
                            padding = 12.dp
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.weight(1f)
                                ) {
                                    SdText(
                                        text = ag.agent,
                                        style = SdTheme.typo.cardTitle
                                    )
                                    SdTag(
                                        text = "TRANSPORT:${(ag.transport ?: "poll").uppercase()}",
                                        bgColor = if (isWs) colors.forestOk else colors.bgSubtle,
                                        textColor = if (isWs) colors.onForestOk else colors.inkPrimary,
                                        borderColor = if (isWs) colors.forestOk else colors.borderSubtle
                                    )
                                    if (ag.rate != null) {
                                        SdTag(
                                            text = "RATE:${ag.rate.used}/${ag.rate.limit} (${ag.rate.windowSec}s)"
                                        )
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    SdButton(
                                        label = "Rotate Secret",
                                        onClick = { controller.rotateAgentSecret(ag.agent) },
                                        variant = SdButtonVariant.COBALT,
                                        compact = true
                                    )
                                    SdButton(
                                        label = "Delete",
                                        onClick = { controller.confirmDeleteAgent(ag.agent) },
                                        variant = SdButtonVariant.DANGER,
                                        compact = true
                                    )
                                }
                            }

                            SdText(
                                text = "Created: ${SdTimeFormatter.formatIsoWithWibAndUtc(ag.created)}  |  Last seen: ${ag.lastSeen?.let { SdTimeFormatter.formatIsoWithWibAndUtc(it) } ?: "never"}",
                                style = SdTheme.typo.monoCode,
                                color = colors.inkSecondary
                            )

                            if (liveConn != null) {
                                SdText(
                                    text = "Live WS Connections: ${liveConn.connections}  |  Connected since: ${liveConn.connectedSince?.let { SdTimeFormatter.formatIsoWithWibAndUtc(it) } ?: "-"}  |  Subscribed: ${liveConn.channels.joinToString(", ")}",
                                    style = SdTheme.typo.monoCode,
                                    color = colors.forestOk
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun OneTimeSecretDialog(
    agent: String,
    secret: String,
    isRotation: Boolean,
    onDismiss: () -> Unit
) {
    val colors = SdTheme.colors
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    SdModalDialog(
        title = if (isRotation) "New Secret Issued for '$agent'" else "Agent '$agent' Registered",
        onDismiss = onDismiss
    ) {
        SdCard(accentTopColor = colors.amberWarn, padding = 12.dp) {
            SdText(
                text = "ONE-TIME DISPLAY WARNING (SPEC SECTION 11)",
                style = SdTheme.typo.monoTag,
                color = colors.amberWarn
            )
            SdText(
                text = "Copy this bearer secret now. The backend never returns agent secrets in list endpoints, and this client does not persist agent secrets.",
                style = SdTheme.typo.bodyPrimary
            )
            SdCard(padding = 10.dp) {
                SdText(
                    text = secret,
                    style = SdTheme.typo.monoCode,
                    color = colors.inkPrimary
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
            ) {
                SdButton(
                    label = if (copied) "Copied to Clipboard" else "Copy Secret",
                    onClick = {
                        clipboard.setText(AnnotatedString(secret))
                        copied = true
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
                SdButton(
                    label = "I Have Saved It (Wipe from Memory)",
                    onClick = onDismiss,
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }
    }
}

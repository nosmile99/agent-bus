package com.agentbus.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentbus.admin.model.RouteDescriptor
import com.agentbus.admin.model.RouteExecutionResult
import com.agentbus.admin.model.RouteGroup
import com.agentbus.admin.network.RouteRegistry
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.ObsidianShapes
import com.agentbus.admin.ui.theme.ObsidianTheme
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun ApiConsoleScreen(controller: AdminAppController) {
    val colors = ObsidianTheme.colors
    val typo = ObsidianTheme.typography
    val scope = rememberCoroutineScope()

    var searchQuery by remember { mutableStateOf("") }
    var selectedGroup by remember { mutableStateOf<RouteGroup?>(null) }
    var selectedMethod by remember { mutableStateOf<String?>(null) }
    var activeRouteId by remember { mutableStateOf<Int?>(null) }

    // Execution state per route
    val executionResults = remember { mutableStateMapOf<Int, RouteExecutionResult>() }
    val isExecuting = remember { mutableStateMapOf<Int, Boolean>() }
    val paramInputs = remember { mutableStateMapOf<Int, MutableMap<String, String>>() }
    val bodyInputs = remember { mutableStateMapOf<Int, String>() }

    val allRoutes = RouteRegistry.ALL_ROUTES

    val filteredRoutes = remember(searchQuery, selectedGroup, selectedMethod) {
        allRoutes.filter { route ->
            val matchGroup = selectedGroup == null || route.group == selectedGroup
            val matchMethod = selectedMethod == null || route.method.equals(selectedMethod, ignoreCase = true)
            val matchQuery = searchQuery.isBlank() ||
                route.path.contains(searchQuery, ignoreCase = true) ||
                route.description.contains(searchQuery, ignoreCase = true)
            matchGroup && matchMethod && matchQuery
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Hero / Header Section
        ObsidianSurface(
            variant = ObsidianSurfaceVariant.SURFACE,
            modifier = Modifier.fillMaxWidth().padding(14.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            ObsidianTag(label = "BACKEND v12", customTone = colors.accent)
                            ObsidianBadge(text = "100% COVERAGE")
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        BasicText(
                            text = "API Console & Endpoint Runner",
                            style = typo.blockTitle.copy(color = colors.text, fontSize = 18.sp)
                        )
                    }

                    // Live target host
                    ObsidianSurface(
                        variant = ObsidianSurfaceVariant.ITEM,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        BasicText(
                            text = controller.baseUrl,
                            style = typo.monoMeta.copy(color = colors.accent)
                        )
                    }
                }

                BasicText(
                    text = "Registri lengkap 124 route backend live revamp-v12 (72 admin, 45 agent /api, 7 root/core). Setiap endpoint dapat diinspeksi, diparameterisasi, dan dieksekusi langsung secara interaktif.",
                    style = typo.body.copy(color = colors.muted)
                )

                // Quick stats row
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    ObsidianMetric(label = "TOTAL ROUTE", value = "${allRoutes.size}", modifier = Modifier.width(130.dp))
                    ObsidianMetric(label = "ADMIN", value = "${allRoutes.count { it.group == RouteGroup.ADMIN }}", modifier = Modifier.width(110.dp))
                    ObsidianMetric(label = "AGENT /API", value = "${allRoutes.count { it.group == RouteGroup.AGENT }}", modifier = Modifier.width(120.dp))
                    ObsidianMetric(label = "ROOT / CORE", value = "${allRoutes.count { it.group == RouteGroup.CORE }}", modifier = Modifier.width(110.dp))
                    ObsidianMetric(label = "TERFILTER", value = "${filteredRoutes.size}", modifier = Modifier.width(110.dp))
                }
            }
        }

        // Search & Filter Toolbar
        ObsidianSurface(
            variant = ObsidianSurfaceVariant.ITEM,
            modifier = Modifier.fillMaxWidth().padding(10.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Search field
                ObsidianTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = "Cari route (mis. /ledger, /cutover, /kanban, /wake, /channels)...",
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                // Group Chips
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicText(text = "GROUP:", style = typo.overline.copy(color = colors.faint))
                    ObsidianChip(
                        label = "Semua (${allRoutes.size})",
                        isSelected = selectedGroup == null,
                        onClick = { selectedGroup = null }
                    )
                    ObsidianChip(
                        label = "Admin (72)",
                        isSelected = selectedGroup == RouteGroup.ADMIN,
                        onClick = { selectedGroup = if (selectedGroup == RouteGroup.ADMIN) null else RouteGroup.ADMIN }
                    )
                    ObsidianChip(
                        label = "Agent /api (45)",
                        isSelected = selectedGroup == RouteGroup.AGENT,
                        onClick = { selectedGroup = if (selectedGroup == RouteGroup.AGENT) null else RouteGroup.AGENT }
                    )
                    ObsidianChip(
                        label = "Root / Core (7)",
                        isSelected = selectedGroup == RouteGroup.CORE,
                        onClick = { selectedGroup = if (selectedGroup == RouteGroup.CORE) null else RouteGroup.CORE }
                    )
                }

                // Method Chips
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicText(text = "METHOD:", style = typo.overline.copy(color = colors.faint))
                    listOf("GET", "POST", "PUT", "DELETE").forEach { m ->
                        ObsidianChip(
                            label = m,
                            isSelected = selectedMethod.equals(m, ignoreCase = true),
                            onClick = { selectedMethod = if (selectedMethod.equals(m, ignoreCase = true)) null else m }
                        )
                    }
                }
            }
        }

        // Routes List
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            items(filteredRoutes, key = { it.id }) { route ->
                val isExpanded = activeRouteId == route.id
                val result = executionResults[route.id]
                val loading = isExecuting[route.id] ?: false

                val routeParams = remember(route.id) {
                    paramInputs.getOrPut(route.id) {
                        mutableStateMapOf(
                            "id" to "1",
                            "agent" to "default-agent",
                            "channel" to "general",
                            "comment_id" to "1",
                            "blocker_id" to "2",
                            "label" to "dev"
                        )
                    }
                }

                var currentBody by remember(route.id) {
                    mutableStateOf(bodyInputs.getOrPut(route.id) { route.sampleBody ?: "" })
                }

                ObsidianSurface(
                    variant = ObsidianSurfaceVariant.ITEM,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Header row
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    activeRouteId = if (isExpanded) null else route.id
                                },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // Route ID Badge
                            BasicText(
                                text = "#${route.id}",
                                style = typo.monoMeta.copy(color = colors.faint)
                            )

                            // Method tag with Obsidian tone
                            val methodTone = when (route.method) {
                                "GET" -> colors.statusDoing
                                "POST" -> colors.accent
                                "PUT" -> colors.labelRiset
                                "DELETE" -> colors.danger
                                else -> colors.muted
                            }
                            ObsidianTag(label = route.method, customTone = methodTone)

                            // Path
                            BasicText(
                                text = route.path,
                                style = typo.cardTitle.copy(
                                    fontFamily = FontFamily.Monospace,
                                    color = colors.text,
                                    fontSize = 13.sp
                                ),
                                modifier = Modifier.weight(1f)
                            )

                            // Group pill
                            ObsidianBadge(text = route.group.title)

                            // Expand arrow
                            BasicText(
                                text = if (isExpanded) "▲" else "▼",
                                style = TextStyle(color = colors.accent, fontSize = 12.sp)
                            )
                        }

                        // Last executed status pill if available
                        if (result != null && !isExpanded) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                ObsidianStatusPill(
                                    status = "Status: ${result.statusCode}",
                                    tone = if (result.isSuccess) ObsidianStatusTone.DONE else ObsidianStatusTone.BLOCKED
                                )
                                BasicText(
                                    text = "Latency: ${result.latencyMs}ms",
                                    style = typo.monoMeta.copy(color = colors.muted)
                                )
                            }
                        }

                        // Expanded Runner Panel
                        if (isExpanded) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(1.dp)
                                    .background(colors.line)
                            )

                            // Path parameter inputs if path has placeholders
                            val hasParams = route.path.contains(":")
                            if (hasParams) {
                                BasicText(
                                    text = "PARAMETER PATH:",
                                    style = typo.overline.copy(color = colors.faint)
                                )
                                Row(
                                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    if (route.path.contains(":id")) {
                                        ObsidianTextField(
                                            value = routeParams["id"] ?: "1",
                                            onValueChange = { routeParams["id"] = it },
                                            label = ":id",
                                            modifier = Modifier.width(100.dp)
                                        )
                                    }
                                    if (route.path.contains(":agent")) {
                                        ObsidianTextField(
                                            value = routeParams["agent"] ?: "default-agent",
                                            onValueChange = { routeParams["agent"] = it },
                                            label = ":agent",
                                            modifier = Modifier.width(140.dp)
                                        )
                                    }
                                    if (route.path.contains(":channel")) {
                                        ObsidianTextField(
                                            value = routeParams["channel"] ?: "general",
                                            onValueChange = { routeParams["channel"] = it },
                                            label = ":channel",
                                            modifier = Modifier.width(130.dp)
                                        )
                                    }
                                    if (route.path.contains(":comment_id")) {
                                        ObsidianTextField(
                                            value = routeParams["comment_id"] ?: "1",
                                            onValueChange = { routeParams["comment_id"] = it },
                                            label = ":comment_id",
                                            modifier = Modifier.width(110.dp)
                                        )
                                    }
                                    if (route.path.contains(":blocker_id")) {
                                        ObsidianTextField(
                                            value = routeParams["blocker_id"] ?: "2",
                                            onValueChange = { routeParams["blocker_id"] = it },
                                            label = ":blocker_id",
                                            modifier = Modifier.width(110.dp)
                                        )
                                    }
                                    if (route.path.contains(":label")) {
                                        ObsidianTextField(
                                            value = routeParams["label"] ?: "dev",
                                            onValueChange = { routeParams["label"] = it },
                                            label = ":label",
                                            modifier = Modifier.width(110.dp)
                                        )
                                    }
                                }
                            }

                            // Request Body JSON editor for POST / PUT
                            if (route.method in listOf("POST", "PUT", "PATCH")) {
                                ObsidianTextField(
                                    value = currentBody,
                                    onValueChange = {
                                        currentBody = it
                                        bodyInputs[route.id] = it
                                    },
                                    label = "REQUEST BODY (JSON):",
                                    placeholder = "{\"key\": \"value\"}",
                                    singleLine = false,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }

                            // Runner action bar
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                BasicText(
                                    text = if (loading) "Mengirim permintaan..." else "Siap dieksekusi",
                                    style = typo.monoMeta.copy(color = if (loading) colors.accent else colors.faint)
                                )

                                ObsidianButton(
                                    text = if (loading) "Mengeksekusi..." else "Jalankan Permintaan",
                                    enabled = !loading,
                                    onClick = {
                                        scope.launch {
                                            isExecuting[route.id] = true
                                            val res = controller.apiClient.executeRoute(
                                                route = route,
                                                pathParams = routeParams,
                                                bodyJson = if (route.method in listOf("POST", "PUT", "PATCH")) currentBody.ifBlank { null } else null,
                                                useAdminToken = false
                                            )
                                            executionResults[route.id] = res
                                            isExecuting[route.id] = false
                                        }
                                    },
                                    variant = ObsidianButtonVariant.PRIMARY,
                                    compact = true
                                )
                            }

                            // Execution Result Viewer
                            if (result != null) {
                                Spacer(modifier = Modifier.height(4.dp))
                                ObsidianSurface(
                                    variant = ObsidianSurfaceVariant.SURFACE,
                                    modifier = Modifier.fillMaxWidth().padding(10.dp)
                                ) {
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                                            ) {
                                                ObsidianStatusPill(
                                                    status = "HTTP ${result.statusCode}",
                                                    tone = if (result.isSuccess) ObsidianStatusTone.DONE else ObsidianStatusTone.BLOCKED
                                                )
                                                BasicText(
                                                    text = "${result.latencyMs} ms",
                                                    style = typo.monoMeta.copy(color = colors.accent)
                                                )
                                            }

                                            BasicText(
                                                text = result.path,
                                                style = typo.monoMeta.copy(color = colors.faint, fontSize = 11.sp)
                                            )
                                        }

                                        // Response text
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .heightIn(max = 240.dp)
                                                .clip(ObsidianShapes.radius8)
                                                .background(colors.optionFill)
                                                .padding(8.dp)
                                                .verticalScroll(rememberScrollState())
                                        ) {
                                            BasicText(
                                                text = result.responseBody.ifBlank { "(empty response)" },
                                                style = TextStyle(
                                                    fontFamily = FontFamily.Monospace,
                                                    fontSize = 12.sp,
                                                    color = if (result.isSuccess) colors.textSoft else colors.danger,
                                                    lineHeight = 16.sp
                                                )
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

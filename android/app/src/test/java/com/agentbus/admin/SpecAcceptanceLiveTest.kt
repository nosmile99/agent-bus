package com.agentbus.admin

import androidx.compose.ui.graphics.Color
import com.agentbus.admin.model.*
import com.agentbus.admin.network.AgentBusApiClient
import com.agentbus.admin.storage.FileBackedAdminStore
import com.agentbus.admin.storage.StoredCredentials
import com.agentbus.admin.ui.theme.NightWatchPalette
import com.agentbus.admin.ui.theme.PaperLedgerPalette
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class SpecAcceptanceLiveTest {

    private fun relativeLuminance(color: Color): Double {
        fun channel(c: Float): Double {
            val v = c.toDouble()
            return if (v <= 0.03928) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }

    private fun contrastRatio(fg: Color, bg: Color): Double {
        val l1 = relativeLuminance(fg)
        val l2 = relativeLuminance(bg)
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    }

    @Test
    fun verifyDesignContrastAndValidationRules() {
        // Verify Obsidian Dark Luxe tokens contrast according to tokens.json specification
        val op = com.agentbus.admin.ui.theme.DarkLuxePalette
        assertTrue("text on bg >= 15.0", contrastRatio(op.text, op.bg) >= 15.0)
        assertTrue("accent on bg >= 10.0", contrastRatio(op.accent, op.bg) >= 10.0)
        assertTrue("onGold on goldDeep >= 7.0", contrastRatio(op.onGold, op.goldDeep) >= 7.0)
        assertTrue("muted on bg >= 7.0", contrastRatio(op.muted, op.bg) >= 7.0)
        assertTrue("danger on surfaceTop >= 7.0", contrastRatio(op.danger, op.surfaceTop) >= 7.0)
        assertTrue("statusDone on bg >= 4.5", contrastRatio(op.statusDone, op.bg) >= 4.5)
        assertTrue("statusDoing on bg >= 4.5", contrastRatio(op.statusDoing, op.bg) >= 4.5)

        // Verify SPEC validation rules
        assertTrue(ValidationRules.isValidAgentName("agent_01-bus"))
        assertFalse(ValidationRules.isValidAgentName("bad name!"))
        assertEquals("bug-fix_v1", ValidationRules.normalizeAndValidateLabel("  BUG-FIX_v1 "))
        assertNull(ValidationRules.normalizeAndValidateLabel("invalid label!"))
        assertTrue(ValidationRules.isValidPassword("123456789012"))
        assertFalse(ValidationRules.isValidPassword("shortpass"))
        assertTrue(ValidationRules.isSystemManagedChannel("dm:alice:bob"))
        assertTrue(ValidationRules.isSystemManagedChannel("all-agent"))
        assertFalse(ValidationRules.isSystemManagedChannel("general"))
        assertEquals(
            listOf("service", "env"),
            ValidationRules.extractTemplatePlaceholders(
                TaskTemplateRecord(
                    name = "deploy",
                    title = "Deploy {service} to {env}",
                    description = "Check {service}"
                )
            )
        )
    }

    @Test
    fun verifyDurablePersistenceAndFeedAnchorAcrossReloginAndUrlChange() {
        val tempDir: File = Files.createTempDirectory("signal-desk-store-test").toFile()
        try {
            val store1 = FileBackedAdminStore(tempDir)
            store1.saveCredentials(
                StoredCredentials(
                    baseUrl = "https://agent-bus-do.lukiznr.workers.dev",
                    username = "luki",
                    password = "secret-password-123",
                    adminToken = "token-abc",
                    isDarkTheme = true
                )
            )
            store1.savePollCursor(PollCursor(sinceTs = 1761830000123L, sinceId = 42))
            store1.saveFeedPersistence(
                FeedViewPersistence(
                    channelFilter = "general",
                    senderFilter = "luki",
                    priorityFilter = "urgent",
                    searchQuery = "deploy",
                    anchorMessageId = 99,
                    firstVisibleItemIndex = 4,
                    firstVisibleItemScrollOffset = 128,
                    observedReplyTo = mapOf(100 to 99),
                    observedEditedIds = setOf(99)
                )
            )

            // Cold start with a fresh store instance pointing to the same directory
            val store2 = FileBackedAdminStore(tempDir)
            val loadedCreds = store2.loadCredentials()
            assertEquals("https://agent-bus-do.lukiznr.workers.dev", loadedCreds.baseUrl)
            assertEquals("luki", loadedCreds.username)
            assertEquals("secret-password-123", loadedCreds.password)
            assertEquals("token-abc", loadedCreds.adminToken)
            assertTrue(loadedCreds.isDarkTheme)

            val loadedCursor = store2.loadPollCursor()
            assertEquals(1761830000123L, loadedCursor.sinceTs)
            assertEquals(42, loadedCursor.sinceId)

            // Verify logout/re-login and URL change preserve Feed scroll anchor & poll cursor
            store2.clearAuthCredentialsOnly()
            val afterLogoutCreds = store2.loadCredentials()
            assertEquals("", afterLogoutCreds.password)
            val preservedFeed = store2.loadFeedPersistence()
            assertEquals(Integer.valueOf(99), preservedFeed.anchorMessageId)
            assertEquals(4, preservedFeed.firstVisibleItemIndex)
            assertEquals(128, preservedFeed.firstVisibleItemScrollOffset)
            assertEquals("general", preservedFeed.channelFilter)
            assertEquals(Integer.valueOf(99), preservedFeed.observedReplyTo[100])
            assertTrue(99 in preservedFeed.observedEditedIds)
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun verifyLiveSpecSection15Acceptance() = runBlocking {
        val liveUrl = System.getenv("LIVE_BUS_URL")?.takeIf { it.isNotBlank() } ?: "http://127.0.0.1:18787"
        val adminUser = System.getenv("LIVE_ADMIN_USER")?.takeIf { it.isNotBlank() } ?: "luki"
        val adminPass = System.getenv("LIVE_ADMIN_PASS")?.takeIf { it.isNotBlank() } ?: "secret123456"
        val adminToken = System.getenv("LIVE_ADMIN_TOKEN")?.takeIf { it.isNotBlank() } ?: "admintoken123"

        val isReachable = try {
            val uri = java.net.URI.create(liveUrl)
            val host = uri.host ?: "127.0.0.1"
            val port = if (uri.port != -1) uri.port else (if (uri.scheme == "https") 443 else 80)
            java.net.Socket().use { sock ->
                sock.connect(java.net.InetSocketAddress(host, port), 1000)
            }
            true
        } catch (_: Exception) {
            false
        }
        org.junit.Assume.assumeTrue("Skipping live acceptance test: $liveUrl is unreachable", isReachable)

        val client = AgentBusApiClient()

        // 1. Admin HTTP Basic login & 401 check
        try {
            client.verifyCredentials(liveUrl, adminUser, "wrong-password-000")
            fail("Expected 401 for wrong password")
        } catch (e: ApiException) {
            assertEquals(401, e.statusCode)
        }

        val initialStats = client.verifyCredentials(liveUrl, adminUser, adminPass)
        assertNotNull(initialStats)
        client.updateConnection(liveUrl, adminUser, adminPass, adminToken)

        // 2. Password change (>= 12 chars) + old password rejected + restore password
        val rotatedPass = "new-secret-password-987654"
        val pwChangeRes = client.changePassword(newUser = adminUser, newPassword = rotatedPass)
        assertTrue(pwChangeRes.ok)

        try {
            client.verifyCredentials(liveUrl, adminUser, adminPass)
            fail("Expected old password to be rejected with 401 after changePassword")
        } catch (e: ApiException) {
            assertEquals(401, e.statusCode)
        }

        client.updateConnection(liveUrl, adminUser, rotatedPass, adminToken)
        val statsWithNewPass = client.getStats()
        assertTrue(statsWithNewPass.totalMessages >= 0)

        // Restore original password
        val restoreRes = client.changePassword(newUser = adminUser, newPassword = adminPass)
        assertTrue(restoreRes.ok)
        client.updateConnection(liveUrl, adminUser, adminPass, adminToken)

        // 3. Agents: register, rotate secret, verify secret returned once & omitted from registered list
        val suffix = (System.currentTimeMillis() % 100000).toString()
        val agentA = "a_spec_agent_a_$suffix"
        val agentB = "b_spec_agent_b_$suffix"

        val regA = client.registerAgent(agentA)
        assertTrue(regA.ok)
        assertEquals(agentA, regA.agent)
        assertTrue("Secret must be non-empty on register", regA.secret.length >= 16)

        val regB = client.registerAgent(agentB)
        assertTrue(regB.ok)
        assertTrue(regB.secret.length >= 16)

        val regList = client.getRegisteredAgents()
        assertTrue(regList.agents.any { it.agent == agentA })
        assertTrue(regList.agents.any { it.agent == agentB })

        val rotatedA = client.rotateAgentSecret(agentA)
        assertTrue(rotatedA.ok)
        assertNotEquals(regA.secret, rotatedA.secret)

        // 4. Channels: create, add/remove member, dm:* system-managed rejection, delete
        val testChannel = "ops-room-$suffix"
        val chCreate = client.createChannel(testChannel)
        assertTrue(chCreate.ok)
        assertEquals(testChannel, chCreate.name)

        val chAdd = client.addChannelMember(testChannel, agentB)
        assertTrue(chAdd.ok)

        try {
            client.addChannelMember("dm:$agentA:$agentB", agentA)
            fail("Expected 400 when modifying dm:* channel membership")
        } catch (e: ApiException) {
            assertEquals(400, e.statusCode)
        }

        // 5. Feed: send message, reply_to, filter by channel/sender/priority/q, edit, delete, and live /poll
        val pollBefore = client.poll(0L, 0)
        val cursorBefore = if (pollBefore.events.isNotEmpty()) {
            val last = pollBefore.events.last()
            PollCursor(last.ts, last.id)
        } else {
            PollCursor(0L, 0)
        }

        val sent1 = client.sendMessage(
            channel = testChannel,
            body = "Primary dispatch signal $suffix",
            priority = TaskPriority.NORMAL
        )
        assertTrue(sent1.ok)
        assertTrue(sent1.id > 0)

        // Verify GET /admin/api/channels lists testChannel and its members now that testChannel has messages
        val channelsNow = client.getChannels().channels
        val foundChannel = channelsNow.firstOrNull { it.name == testChannel }
        assertNotNull(foundChannel)
        assertTrue(agentB in foundChannel!!.members)

        val chRemove = client.removeChannelMember(testChannel, agentB)
        assertTrue(chRemove.ok)
        val channelsAfterRemove = client.getChannels().channels.firstOrNull { it.name == testChannel }
        assertNotNull(channelsAfterRemove)
        assertFalse(agentB in channelsAfterRemove!!.members)

        val sentReply = client.sendMessage(
            channel = testChannel,
            body = "Reply dispatch signal $suffix",
            priority = TaskPriority.URGENT,
            replyTo = sent1.id
        )
        assertTrue(sentReply.ok)
        assertTrue(sentReply.id > sent1.id)

        val filteredMsgs = client.getMessages(
            channel = testChannel,
            sender = "luki",
            priority = TaskPriority.URGENT,
            q = "Reply dispatch"
        ).messages
        assertEquals(1, filteredMsgs.size)
        assertEquals(sentReply.id, filteredMsgs.first().id)

        val editRes = client.editMessage(sent1.id, "Updated dispatch signal $suffix")
        assertTrue(editRes.ok)

        val delRes = client.deleteMessage(sentReply.id)
        assertTrue(delRes.ok)

        val pollAfter = client.poll(cursorBefore.sinceTs, cursorBefore.sinceId)
        assertTrue("Expected live poll events after send/edit/delete", pollAfter.events.isNotEmpty())
        assertTrue(pollAfter.events.any { it.type == "bus.message" })
        assertTrue(pollAfter.events.any { it.type == "bus.message.edited" })
        assertTrue(pollAfter.events.any { it.type == "bus.message.deleted" })

        // Verify expired/future cursor triggers resync_required
        val pollExpired = client.poll(sinceTs = 1L, sinceId = 99999999)
        assertTrue("Invalid/expired cursor must report resyncRequired", pollExpired.resyncRequired)

        // 6. WIP config & Lane mapping
        val wipRes = client.updateWipConfig(1)
        assertTrue(wipRes.ok)
        assertEquals(Integer.valueOf(1), client.getWipConfig().perAssigneeDoingLimit)

        val laneName = TaskLane.ANDROID
        val laneMapRes = client.updateLaneMapping(agent = agentA, lane = laneName)
        assertTrue(laneMapRes.ok)
        assertTrue(client.getLaneMapping().laneMapping.any { it.agent == agentA && it.lane == laneName })

        // 7. Projects: create, update, subscribers, task_count, archive, delete
        val projCreate = client.createProject("Project-$suffix", "Acceptance test project", subscribers = listOf(agentA))
        assertTrue(projCreate.ok)
        val projectId = projCreate.id

        val subs = client.getProjectSubscribers(projectId).subscribers
        assertTrue(subs.any { it.agent == agentA })

        // 8. Templates & Tasks (with template placeholder substitution and auto-assign lane owner)
        val tplName = "tpl-$suffix"
        val tplCreate = client.createTemplate(
            name = tplName,
            title = "Deploy {service} to {env}",
            description = "Verify {service} in {env}",
            notes = "Run smoke suite for {service}",
            priority = TaskPriority.URGENT,
            lane = laneName,
            labels = listOf("release-v1")
        )
        assertTrue(tplCreate.ok)

        val taskFromTpl = client.createTask(
            projectId = projectId,
            title = null,
            template = tplName,
            templateVars = mapOf("service" to "auth-api", "env" to "prod")
        )
        assertTrue(taskFromTpl.ok)
        assertEquals(laneName, taskFromTpl.lane)
        assertEquals("Auto-assigned lane owner must match lane_mapping", agentA, taskFromTpl.assignee)

        val detail1 = client.getTaskDetail(taskFromTpl.id)
        assertEquals("Deploy auth-api to prod", detail1.title)
        assertEquals("Verify auth-api in prod", detail1.description)
        assertTrue("release-v1" in detail1.labels)

        val taskDirect = client.createTask(
            projectId = projectId,
            title = "Second task $suffix",
            priority = TaskPriority.NORMAL,
            assignee = agentA,
            lane = TaskLane.BACKEND
        )
        assertTrue(taskDirect.ok)

        // 9. Blocked rev5 rules:
        // 9a. Block without blocked_reason -> 400
        try {
            client.updateTask(
                taskId = taskFromTpl.id,
                status = TaskStatus.BLOCKED,
                blockedKind = BlockedKind.WAITING_HUMAN,
                blockedReason = null
            )
            fail("Expected 400 when setting status=blocked without blocked_reason")
        } catch (e: ApiException) {
            assertEquals(400, e.statusCode)
        }

        // 9b. Block with blocked_reason & waiting-human -> succeeds
        val blockRes = client.updateTask(
            taskId = taskFromTpl.id,
            status = TaskStatus.BLOCKED,
            blockedKind = BlockedKind.WAITING_HUMAN,
            blockedReason = "Needs production credentials approval"
        )
        assertTrue(blockRes.ok)
        val blockedDetail = client.getTaskDetail(taskFromTpl.id)
        assertEquals(TaskStatus.BLOCKED, blockedDetail.status)
        assertEquals(BlockedKind.WAITING_HUMAN, blockedDetail.blockedKind)
        assertEquals("Needs production credentials approval", blockedDetail.blockedReason)
        assertNotNull(blockedDetail.statusChangedAt)

        // Verify Needs view global search finds this waiting-human task
        val needsSearch = client.searchTasksGlobal(
            TaskSearchOpts(
                status = TaskStatus.BLOCKED,
                blockedKind = BlockedKind.WAITING_HUMAN,
                sort = "blocked_since"
            )
        )
        assertTrue(needsSearch.tasks.any { it.id == taskFromTpl.id })

        // 9c. Blocked-to-blocked update changes kind/reason while staying blocked
        val reblockRes = client.updateTask(
            taskId = taskFromTpl.id,
            status = TaskStatus.BLOCKED,
            blockedKind = BlockedKind.WAITING_EXTERNAL,
            blockedReason = "Upstream DNS propagation pending"
        )
        assertTrue(reblockRes.ok)
        val reblockedDetail = client.getTaskDetail(taskFromTpl.id)
        assertEquals(TaskStatus.BLOCKED, reblockedDetail.status)
        assertEquals(BlockedKind.WAITING_EXTERNAL, reblockedDetail.blockedKind)
        assertEquals("Upstream DNS propagation pending", reblockedDetail.blockedReason)

        // 9d. Unblock clears blocked_kind and blocked_reason to null
        val unblockRes = client.updateTask(
            taskId = taskFromTpl.id,
            unblock = true,
            comment = "DNS resolved, unblocking"
        )
        assertTrue(unblockRes.ok)
        val unblockedDetail = client.getTaskDetail(taskFromTpl.id)
        assertEquals(TaskStatus.DOING, unblockedDetail.status)
        assertNull(unblockedDetail.blockedKind)
        assertNull(unblockedDetail.blockedReason)

        // 10. WIP warning when second task for same assignee enters 'doing' (limit = 1)
        val secondDoingRes = client.updateTask(
            taskId = taskDirect.id,
            status = TaskStatus.DOING
        )
        assertTrue(secondDoingRes.ok)
        assertNotNull("Expected wip_warning when assignee exceeds WIP limit of 1", secondDoingRes.wipWarning)
        assertEquals(agentA, secondDoingRes.wipWarning?.assignee)

        // 11. 409 lane_change_conflict when moving a 'doing' task assigned to agentB into agentA's lane without explicit assignee
        client.updateTask(
            taskId = taskDirect.id,
            assignee = agentB,
            includeAssignee = true
        )
        try {
            client.updateTask(
                taskId = taskDirect.id,
                lane = laneName
            )
            fail("Expected 409 lane_change_conflict when changing lane of a doing task to another owner's lane without explicit assignee")
        } catch (e: ApiException) {
            assertEquals(409, e.statusCode)
            assertEquals("lane_change_conflict", e.error)
            assertNotNull(e.laneConflict)
            assertEquals(agentB, e.laneConflict?.assignee)
        }

        // Resolve 409 by passing explicit assignee
        val resolvedLaneChange = client.updateTask(
            taskId = taskDirect.id,
            lane = laneName,
            assignee = agentA,
            includeAssignee = true
        )
        assertTrue(resolvedLaneChange.ok)

        // 12. Todos, Comments, Labels CRUD + Activity + Summary consistency
        val todoCreate = client.createTodo(taskFromTpl.id, "Run database migration", 1)
        assertTrue(todoCreate.ok)
        val todoUpdate = client.updateTodo(todoCreate.id, text = "Run database migration v2", done = true, sortOrder = 2)
        assertTrue(todoUpdate.ok)
        val detailWithTodo = client.getTaskDetail(taskFromTpl.id)
        assertEquals(1, detailWithTodo.todos.size)
        assertEquals(1, detailWithTodo.todos.first().done)
        val todoDel = client.deleteTodo(todoCreate.id)
        assertTrue(todoDel.ok)

        val commentAdd = client.addTaskComment(taskFromTpl.id, "Verified deployment health check")
        assertTrue(commentAdd.ok)
        val commentsList = client.getTaskComments(taskFromTpl.id).comments
        assertTrue(commentsList.any { it.body.contains("Verified deployment health check") })

        val labelAdd = client.addTaskLabel(taskFromTpl.id, "verified-ok")
        assertTrue(labelAdd.ok)
        val projectLabels = client.getProjectLabels(projectId).labels
        assertTrue("verified-ok" in projectLabels)
        val labelRemove = client.removeTaskLabel(taskFromTpl.id, "verified-ok")
        assertTrue(labelRemove.ok)

        val activityList = client.getActivity(limit = 25, projectId = projectId).activity
        assertTrue("Expected recorded kanban activity for project", activityList.isNotEmpty())

        val summary = client.getSummary(projectId = projectId, includeArchived = false)
        assertTrue(summary.byStatus.doing >= 2)

        // 13. Export & Import with X-Admin-Token
        val exported = client.exportData(adminToken)
        assertNotNull(exported.messages)
        val importRes = client.importData(
            payload = ExportPayload(messages = emptyList(), agents = emptyList()),
            customAdminToken = adminToken
        )
        assertEquals(0, importRes.imported)

        // 14. Archive project (0 -> 1) and clean up created resources
        val archiveRes = client.updateProject(id = projectId, archived = 1)
        assertTrue(archiveRes.ok)
        val allProjects = client.getProjects().projects
        val archivedProj = allProjects.firstOrNull { it.id == projectId }
        assertNotNull(archivedProj)
        assertEquals(1, archivedProj!!.archived)
        assertTrue(archivedProj.taskCount >= 2)

        assertTrue(client.deleteTask(taskFromTpl.id).ok)
        assertTrue(client.deleteTask(taskDirect.id).ok)
        assertTrue(client.deleteProject(projectId).ok)
        assertTrue(client.deleteChannel(testChannel).ok)
        client.updateLaneMapping(agent = agentA, lane = TaskLane.UNASSIGNED)
        assertTrue(client.deleteAgent(agentA).ok)
        assertTrue(client.deleteAgent(agentB).ok)
        client.updateWipConfig(null)

        // Verify stats endpoint reflects clean state
        val finalStats = client.getStats()
        assertTrue(finalStats.totalMessages >= initialStats.totalMessages)
    }
}
